# ChatGPT Audio Grabber

Chromium extension for saving ChatGPT Read Aloud audio.

Version 0.4.0 captures the streaming TTS response from ChatGPT before it reaches MediaSource. The file grows while the response is arriving and is marked ready after the stream finishes. This avoids treating ChatGPT's internal 30-50 second playback pieces as separate recordings.

There is also a MediaSource fallback that mirrors audio bytes passed to SourceBuffer.appendBuffer().

## Install

1. Download or clone the repository.
2. Open the browser extensions page and enable Developer mode.
3. Choose Load unpacked.
4. Select the directory containing manifest.json.
5. Reload ChatGPT with Ctrl+R.
6. Press the native Read Aloud / Озвучить button.

The extension does not replace or block ChatGPT's native playback controls.
