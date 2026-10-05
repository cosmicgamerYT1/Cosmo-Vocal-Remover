# Video extraction fix

The video pipeline now tries the browser's native media/audio pipeline before FFmpeg.

This avoids copying the entire source video into FFmpeg WASM memory for browser-decodable
MP4/WebM/MOV files. Audio is captured through Web Audio + MediaRecorder and progress is
reported continuously while the video plays.

FFmpeg remains the compatibility fallback for formats/codecs the browser cannot decode,
including many MKV combinations.

The final video mux still uses FFmpeg because it needs to produce a genuine MP4 containing
the original video stream and the processed audio.
