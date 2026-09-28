# ChatGPT Audio Grabber

Chromium extension for saving ChatGPT Read Aloud audio.

Version 0.4.1 captures the streaming TTS response from ChatGPT before it reaches MediaSource. The file grows while the response is arriving. ChatGPT can request the next TTS piece only near the end of the current 30-50 second playback chunk, so v0.4.1 keeps one capture session alive across those gaps instead of resetting at every piece. The UI marks the capture ready after an inactivity grace period; you can still download the accumulated audio at any time.

There is also a MediaSource fallback that mirrors audio bytes passed to SourceBuffer.appendBuffer().

## Install

1. Download or clone the repository.
2. Open the browser extensions page and enable Developer mode.
3. Choose Load unpacked.
4. Select the directory containing manifest.json.
5. Reload ChatGPT with Ctrl+R.
6. Press the native Read Aloud / Озвучить button.

The extension does not replace or block ChatGPT's native playback controls.

## 0.4.1

- Keep sequential TTS requests for the same message in one session.
- Do not let the MediaSource fallback overwrite a working fetch capture.
- Extend the completion grace period so playback-driven gaps between TTS requests do not split the recording.
