(function () {
  'use strict';

  var MESSAGE = 'CHATGPT_AUDIO_GRABBER_V4';
  var current = null;
  var host = null;
  var audio = null;
  var meta = null;
  var state = null;
  var download = null;

  function injectHook() {
    var script = document.createElement('script');
    script.src = chrome.runtime.getURL('page-hook.js');
    script.onload = function () { script.remove(); };
    (document.head || document.documentElement).appendChild(script);
  }

  function sizeText(bytes) {
    if (!bytes) return '';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  }

  function extension(mime) {
    mime = String(mime || '').toLowerCase();
    if (mime.indexOf('mpeg') >= 0 || mime.indexOf('mp3') >= 0) return 'mp3';
    if (mime.indexOf('wav') >= 0) return 'wav';
    if (mime.indexOf('ogg') >= 0) return 'ogg';
    if (mime.indexOf('mp4') >= 0 || mime.indexOf('m4a') >= 0) return 'm4a';
    return 'aac';
  }

  function fileName(item) {
    var d = new Date(item.startedAt || Date.now());
    function pad(n) { return String(n).padStart(2, '0'); }
    return 'chatgpt-read-aloud_' + d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + '_' + pad(d.getHours()) + '-' + pad(d.getMinutes()) + '-' + pad(d.getSeconds()) + '.' + extension(item.mime);
  }

  function save() {
    if (!current || !current.blobUrl) return;
    var a = document.createElement('a');
    a.href = current.blobUrl;
    a.download = fileName(current);
    a.style.display = 'none';
    (document.body || document.documentElement).appendChild(a);
    a.click();
    a.remove();
  }

  function mount() {
    if (host && host.isConnected) return;
    host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:2147483647;display:none';
    var root = host.attachShadow({ mode: 'open' });
    root.innerHTML = '<style>:host{all:initial}.box{box-sizing:border-box;width:min(900px,calc(100vw - 28px));padding:12px 14px;border:1px solid #555;border-radius:16px;background:rgba(28,28,30,.97);color:#f5f5f5;box-shadow:0 14px 44px #0006;font:13px/1.35 system-ui,sans-serif}.top{display:flex;align-items:center;gap:10px;margin-bottom:9px}.name{font-weight:700;white-space:nowrap}.meta{color:#aaa;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.state{font-weight:700;white-space:nowrap}.row{display:flex;gap:9px;align-items:center}audio{width:100%;height:36px}button,select{height:31px;border:1px solid #555;border-radius:9px;background:#ffffff12;color:inherit;padding:0 10px;cursor:pointer}button:hover,select:hover{background:#ffffff20}.close{width:32px;padding:0;font-size:18px}</style><div class="box"><div class="top"><span class="name">🎧 ChatGPT Audio</span><span class="meta"></span><span class="state"></span><button class="download">↓ Скачать</button><button class="close">×</button></div><div class="row"><audio controls preload="metadata"></audio><select class="speed"><option>.75×</option><option selected>1×</option><option>1.25×</option><option>1.5×</option><option>2×</option><option>2.5×</option></select></div></div>';
    audio = root.querySelector('audio');
    meta = root.querySelector('.meta');
    state = root.querySelector('.state');
    download = root.querySelector('.download');
    root.querySelector('.close').onclick = function () { host.style.display = 'none'; };
    download.onclick = save;
    root.querySelector('.speed').onchange = function (event) { audio.playbackRate = parseFloat(event.target.value) || 1; };
    document.documentElement.appendChild(host);
  }

  function show(item) {
    if (!item || !item.blobUrl) return;
    mount();
    current = item;
    audio.src = item.blobUrl;
    audio.load();
    var method = item.method === 'fetch-stream' ? 'TTS stream' : 'MSE fallback';
    var parts = item.partCount > 1 ? ' · ' + item.partCount + ' фрагм.' : '';
    meta.textContent = method + ' · ' + (item.mime || 'audio') + ' · ' + sizeText(item.size) + parts;
    state.textContent = item.isFinal ? '✓ готово' : '● собирается';
    download.textContent = item.isFinal ? '↓ Скачать' : '↓ Скачать сейчас';
    host.style.display = 'block';
  }

  window.addEventListener('message', function (event) {
    if (event.source !== window || event.origin !== location.origin) return;
    if (!event.data || event.data.type !== MESSAGE) return;
    show(event.data.payload);
  });

  injectHook();
})();
