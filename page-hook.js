(function () {
  'use strict';

  if (window.__chatgptAudioGrabberV4) return;
  window.__chatgptAudioGrabberV4 = true;

  var MESSAGE = 'CHATGPT_AUDIO_GRABBER_V4';
  var TTS_URL = /\/backend-api\/(?:synthesize|speech\/generation)(?:[/?#]|$)/i;
  var READ_ALOUD = /(read.?aloud|озвучить|прочитать\s+вслух|читать\s+вслух)/i;
  var MAX_BYTES = 80 * 1024 * 1024;
  // ChatGPT may request the next TTS piece only when playback nears the end
  // of the current piece. Keep the same capture session alive across those gaps.
  var FETCH_FINAL_DELAY = 75000;
  var MSE_FINAL_DELAY = 10000;
  var nativeFetch = window.fetch && window.fetch.bind(window);
  var nativeCreateObjectURL = URL.createObjectURL.bind(URL);
  var nativeRevokeObjectURL = URL.revokeObjectURL.bind(URL);

  var forceNew = false;
  var fetchSeq = 0;
  var fetchSession = null;
  var fetchPublishTimer = 0;
  var fetchFinalTimer = 0;
  var lastFetchActivity = 0;
  var fetchCapturedForPlayback = false;
  var mseSeq = 0;
  var mseSession = null;
  var msePublishTimer = 0;
  var mseFinalTimer = 0;

  function debug() {
    try {
      var args = Array.prototype.slice.call(arguments);
      args.unshift('[Audio Grabber]');
      console.debug.apply(console, args);
    } catch (_) {}
  }

  function mimeBase(value) {
    return String(value || 'audio/aac').split(';')[0].trim().toLowerCase() || 'audio/aac';
  }

  function isAudioMime(value) {
    var type = mimeBase(value);
    return type.indexOf('audio/') === 0 || type.indexOf('aac') >= 0 || type.indexOf('mpeg') >= 0;
  }

  function bytesCopy(value) {
    try {
      if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
      if (ArrayBuffer.isView(value)) {
        var start = value.byteOffset || 0;
        return new Uint8Array(value.buffer.slice(start, start + value.byteLength));
      }
    } catch (_) {}
    return null;
  }

  function blobUrl(blob) {
    var url = nativeCreateObjectURL(blob);
    setTimeout(function () {
      try { nativeRevokeObjectURL(url); } catch (_) {}
    }, 6 * 60 * 60 * 1000);
    return url;
  }

  function send(session, method, isFinal) {
    if (!session || !session.chunks.length || !session.size) return;
    try {
      var blob = new Blob(session.chunks, { type: session.mime });
      window.postMessage({
        type: MESSAGE,
        payload: {
          blobUrl: blobUrl(blob),
          mime: blob.type || session.mime,
          size: blob.size,
          method: method,
          sessionId: session.id,
          startedAt: session.startedAt,
          partCount: session.partCount,
          isFinal: !!isFinal
        }
      }, location.origin);
    } catch (_) {}
  }

  function urlOf(resource, response) {
    try {
      if (typeof resource === 'string') return resource;
      if (resource instanceof URL) return resource.href;
      if (resource instanceof Request) return resource.url;
      if (resource && resource.url) return String(resource.url);
    } catch (_) {}
    return response && response.url || '';
  }

  function fetchMeta(url, response) {
    var messageId = '';
    var format = '';
    try {
      var parsed = new URL(url, location.origin);
      messageId = parsed.searchParams.get('message_id') || parsed.searchParams.get('messageId') || '';
      format = parsed.searchParams.get('format') || '';
    } catch (_) {}
    var mime = response && response.headers && response.headers.get('content-type') || '';
    if (!isAudioMime(mime)) {
      if (/mp3|mpeg/i.test(format)) mime = 'audio/mpeg';
      else if (/wav/i.test(format)) mime = 'audio/wav';
      else if (/ogg|opus/i.test(format)) mime = 'audio/ogg';
      else mime = 'audio/aac';
    }
    return { messageId: messageId, mime: mimeBase(mime) };
  }

  function newFetchSession(meta) {
    fetchSession = {
      id: 'fetch-' + Date.now() + '-' + (++fetchSeq),
      messageId: meta.messageId,
      mime: meta.mime,
      chunks: [],
      size: 0,
      partCount: 0,
      active: 0,
      startedAt: Date.now(),
      lastAt: Date.now(),
      final: false
    };
    forceNew = false;
    return fetchSession;
  }

  function beginFetch(meta) {
    var now = Date.now();
    var sameMessage = !!(fetchSession && fetchSession.messageId && meta.messageId && fetchSession.messageId === meta.messageId);
    var differentMessage = !!(fetchSession && fetchSession.messageId && meta.messageId && fetchSession.messageId !== meta.messageId);
    var anonymousExpired = !!(fetchSession && !fetchSession.messageId && !meta.messageId && now - fetchSession.lastAt > 120000);

    // Important: one Read Aloud run can consist of several HTTP TTS responses
    // spaced tens of seconds apart. If message_id is the same, keep appending
    // even if the previous response had already been marked final.
    var mustStart = !fetchSession || forceNew || differentMessage || (!sameMessage && anonymousExpired);
    if (mustStart) newFetchSession(meta);

    fetchCapturedForPlayback = true;
    clearTimeout(fetchFinalTimer);
    fetchSession.final = false;
    fetchSession.partCount += 1;
    fetchSession.active += 1;
    fetchSession.lastAt = now;
    lastFetchActivity = now;
    return fetchSession.id;
  }

  function publishFetchSoon() {
    if (fetchPublishTimer) return;
    fetchPublishTimer = setTimeout(function () {
      fetchPublishTimer = 0;
      send(fetchSession, 'fetch-stream', false);
    }, 1200);
  }

  function appendFetch(id, value) {
    if (!fetchSession || fetchSession.id !== id) return false;
    var bytes = bytesCopy(value);
    if (!bytes || !bytes.byteLength) return true;
    if (fetchSession.size + bytes.byteLength > MAX_BYTES) return false;
    fetchSession.chunks.push(bytes);
    fetchSession.size += bytes.byteLength;
    fetchSession.lastAt = Date.now();
    lastFetchActivity = fetchSession.lastAt;
    publishFetchSoon();
    return true;
  }

  function finishFetch(id) {
    if (!fetchSession || fetchSession.id !== id) return;
    fetchSession.active = Math.max(0, fetchSession.active - 1);
    fetchSession.lastAt = Date.now();
    lastFetchActivity = fetchSession.lastAt;
    send(fetchSession, 'fetch-stream', false);
    clearTimeout(fetchFinalTimer);
    if (fetchSession.active) return;
    fetchFinalTimer = setTimeout(function () {
      if (!fetchSession || fetchSession.active) return;
      fetchSession.final = true;
      send(fetchSession, 'fetch-stream', true);
      debug('fetch capture complete', fetchSession.size + ' bytes');
    }, FETCH_FINAL_DELAY);
  }

  async function collectFetch(response, id) {
    try {
      if (response.body && response.body.getReader) {
        var reader = response.body.getReader();
        while (true) {
          var item = await reader.read();
          if (item.done) break;
          if (!appendFetch(id, item.value)) {
            try { await reader.cancel(); } catch (_) {}
            break;
          }
        }
      } else {
        appendFetch(id, await response.arrayBuffer());
      }
    } catch (error) {
      debug('fetch capture error', error && error.message || error);
    } finally {
      finishFetch(id);
    }
  }

  if (nativeFetch) {
    window.fetch = async function () {
      var args = Array.prototype.slice.call(arguments);
      var response = await nativeFetch.apply(window, args);
      try {
        var url = urlOf(args[0], response);
        if (TTS_URL.test(url)) {
          var meta = fetchMeta(url, response);
          var id = beginFetch(meta);
          debug('TTS fetch intercepted', meta.messageId || url);
          collectFetch(response.clone(), id);
        }
      } catch (error) {
        debug('fetch hook error', error && error.message || error);
      }
      return response;
    };
  }

  function newMseSession(mime) {
    mseSession = {
      id: 'mse-' + Date.now() + '-' + (++mseSeq),
      mime: mimeBase(mime),
      chunks: [],
      size: 0,
      partCount: 0,
      startedAt: Date.now(),
      lastAt: Date.now(),
      final: false
    };
    forceNew = false;
    return mseSession;
  }

  function publishMse(isFinal) {
    // MSE sees the same bytes that the fetch hook already captured. Once the
    // fetch path works for this playback, never let the fallback overwrite the
    // accumulated TTS session with a shorter duplicate.
    if (!mseSession || fetchCapturedForPlayback) return;
    send(mseSession, 'mse-stream', isFinal);
  }

  function appendMse(value, mime) {
    var bytes = bytesCopy(value);
    if (!bytes || !bytes.byteLength) return;
    var now = Date.now();
    if (!mseSession || forceNew || mseSession.final || now - mseSession.lastAt > 90000 || mimeBase(mseSession.mime) !== mimeBase(mime)) {
      newMseSession(mime);
    }
    if (mseSession.size + bytes.byteLength > MAX_BYTES) return;
    mseSession.chunks.push(bytes);
    mseSession.size += bytes.byteLength;
    mseSession.partCount += 1;
    mseSession.lastAt = now;
    mseSession.final = false;
    clearTimeout(mseFinalTimer);
    mseFinalTimer = setTimeout(function () {
      if (!mseSession) return;
      mseSession.final = true;
      publishMse(true);
    }, MSE_FINAL_DELAY);
    if (!msePublishTimer) {
      msePublishTimer = setTimeout(function () {
        msePublishTimer = 0;
        publishMse(false);
      }, 1200);
    }
  }

  function patchMediaSource(SourceClass) {
    try {
      var proto = SourceClass && SourceClass.prototype;
      if (!proto || !proto.addSourceBuffer || proto.__audioGrabberV4) return;
      var originalAdd = proto.addSourceBuffer;
      Object.defineProperty(proto, '__audioGrabberV4', { value: true });
      proto.addSourceBuffer = function (mime) {
        var buffer = originalAdd.call(this, mime);
        if (!isAudioMime(mime)) return buffer;
        var originalAppend = buffer.appendBuffer.bind(buffer);
        buffer.appendBuffer = function (value) {
          try { appendMse(value, mime); } catch (_) {}
          return originalAppend(value);
        };
        return buffer;
      };
    } catch (_) {}
  }

  patchMediaSource(window.MediaSource);
  patchMediaSource(window.ManagedMediaSource);

  document.addEventListener('click', function (event) {
    try {
      var path = event.composedPath ? event.composedPath() : [];
      var button = path.find(function (node) {
        return node instanceof HTMLElement && node.matches && node.matches('button,[role="button"]');
      });
      if (!button) return;
      var label = [button.getAttribute('aria-label'), button.getAttribute('title'), button.getAttribute('data-testid'), button.textContent].filter(Boolean).join(' ');
      if (READ_ALOUD.test(label)) {
        forceNew = true;
        fetchCapturedForPlayback = false;
        mseSession = null;
        clearTimeout(mseFinalTimer);
      }
    } catch (_) {}
  }, true);

  debug('v0.4.1 installed');
})();
