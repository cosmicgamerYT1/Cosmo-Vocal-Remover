import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";

const FFMPEG_CORE_VERSION = "0.12.6";
const FFMPEG_LIB_VERSION = "0.12.10"; // must match the @ffmpeg/ffmpeg version in package.json

// Multiple CDN mirrors, tried in order. A single provider being blocked by
// an ad-blocker/firewall, rate-limited, or briefly down shouldn't hard-fail
// the whole app with an opaque "Failed to fetch".
const FFMPEG_CORE_CDN_CANDIDATES = [
  `https://cdn.jsdelivr.net/npm/@ffmpeg/[email protected]${FFMPEG_CORE_VERSION}/dist/esm`,
  `https://unpkg.com/@ffmpeg/[email protected]${FFMPEG_CORE_VERSION}/dist/esm`,
];

// The @ffmpeg/ffmpeg wrapper spawns its own internal worker via
// `new Worker(new URL("./worker.js", import.meta.url))`. That pattern
// relies on the bundler statically resolving a node_modules-relative URL,
// which Next.js's webpack config does not reliably do -- the worker then
// fails to start with an error that has nothing to do with network access.
// The fix, matching the CDN candidates above index-for-index, is to fetch
// that worker script ourselves and pass it explicitly as `classWorkerURL`,
// bypassing the bundler's URL resolution entirely.
const FFMPEG_LIB_CDN_CANDIDATES = [
  `https://cdn.jsdelivr.net/npm/@ffmpeg/[email protected]${FFMPEG_LIB_VERSION}/dist/esm`,
  `https://unpkg.com/@ffmpeg/[email protected]${FFMPEG_LIB_VERSION}/dist/esm`,
];

let ffmpegInstance: FFmpeg | null = null;
let loadPromise: Promise<FFmpeg> | null = null;

class FFmpegLoadError extends Error {
  constructor(causes: unknown[]) {
    super(
      "Couldn't load the video-processing engine (FFmpeg). " +
        summarizeCauses(causes) +
        " If this persists, try an incognito window with extensions disabled, or a different network."
    );
    this.name = "FFmpegLoadError";
    this.cause = causes;
  }
}

function summarizeCauses(causes: unknown[]): string {
  const last = causes[causes.length - 1];
  const msg = last instanceof Error ? last.message : String(last ?? "");
  if (/fetch|network|cors/i.test(msg)) {
    return "A required file couldn't be downloaded -- this is usually an ad-blocker/privacy extension blocking cdn.jsdelivr.net or unpkg.com, or a network/firewall restriction.";
  }
  if (/worker/i.test(msg)) {
    return "The browser couldn't start FFmpeg's background worker.";
  }
  return "An unexpected error occurred while starting FFmpeg.";
}

/**
 * Lazily loads ffmpeg.wasm (single-threaded core -- no COOP/COEP headers
 * required, which keeps Vercel deployment configuration-free). Tries each
 * CDN candidate in turn, fetching the core JS/WASM *and* the ffmpeg.wasm
 * wrapper's own worker script explicitly (see FFMPEG_LIB_CDN_CANDIDATES
 * above for why). Everything is cached by the browser's HTTP cache after
 * first successful use.
 */
export async function getFFmpeg(onLog?: (message: string) => void): Promise<FFmpeg> {
  if (ffmpegInstance) return ffmpegInstance;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    const ffmpeg = new FFmpeg();
    // Always surface FFmpeg's own log lines to the console — this is the
    // single most useful signal for diagnosing a stalled/slow command,
    // since it shows whether FFmpeg is actively working or has gone silent.
    ffmpeg.on("log", ({ message }) => {
      console.debug("[ffmpeg]", message);
      onLog?.(message);
    });

    const errors: unknown[] = [];
    for (let i = 0; i < FFMPEG_CORE_CDN_CANDIDATES.length; i++) {
      const coreBase = FFMPEG_CORE_CDN_CANDIDATES[i]!;
      const libBase = FFMPEG_LIB_CDN_CANDIDATES[i]!;
      try {
        const [coreURL, wasmURL, classWorkerURL] = await Promise.all([
          toBlobURL(`${coreBase}/ffmpeg-core.js`, "text/javascript"),
          toBlobURL(`${coreBase}/ffmpeg-core.wasm`, "application/wasm"),
          toBlobURL(`${libBase}/worker.js`, "text/javascript"),
        ]);
        await ffmpeg.load({ coreURL, wasmURL, classWorkerURL });
        ffmpegInstance = ffmpeg;
        return ffmpeg;
      } catch (err) {
        errors.push(err);
        // try the next candidate
      }
    }

    loadPromise = null; // allow a future retry to attempt the CDNs again
    throw new FFmpegLoadError(errors);
  })();

  return loadPromise;
}

/**
 * Forcibly kills the FFmpeg worker and clears cached state, so the next
 * call to getFFmpeg() starts fresh. Used both to implement "Cancel" during
 * processing and as a recovery path if a command appears to have stalled.
 */
export function terminateFFmpeg(): void {
  ffmpegInstance?.terminate();
  ffmpegInstance = null;
  loadPromise = null;
}

class FFmpegTimeoutError extends Error {
  constructor(what: string, ms: number) {
    super(
      `${what} is taking much longer than expected (over ${Math.round(ms / 1000)}s) and may have stalled. ` +
        "This can happen with very large/complex files, or if FFmpeg's worker got stuck. " +
        'Try a shorter clip, or click "Cancel" and try again.'
    );
    this.name = "FFmpegTimeoutError";
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new FFmpegTimeoutError(what, ms)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

const EXTRACT_TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes
const MUX_TIMEOUT_MS = 6 * 60 * 1000; // 6 minutes (re-encode fallback can be slow)

/**
 * Extracts the audio track from a video file.
 *
 * We first try the browser's native media pipeline. This is intentionally the
 * default for MP4/WebM/MOV files because it does not copy the entire video
 * into FFmpeg's in-memory filesystem. The audio is recorded through a
 * MediaElementAudioSourceNode into a MediaRecorder, so memory usage stays
 * proportional to the compressed audio chunks rather than the size of the
 * source video.
 *
 * If the browser cannot decode/capture the source (notably some MKV/codecs),
 * we fall back to FFmpeg WASM.
 */
export async function extractAudioFromVideo(
  file: File,
  onProgress?: (ratio: number) => void
): Promise<Uint8Array> {
  try {
    return await extractAudioWithBrowser(file, onProgress);
  } catch (nativeError) {
    console.debug("[vocal-remover] Native video audio extraction unavailable; falling back to FFmpeg.", nativeError);
    return extractAudioWithFFmpeg(file, onProgress);
  }
}

async function extractAudioWithBrowser(
  file: File,
  onProgress?: (ratio: number) => void
): Promise<Uint8Array> {
  if (typeof window === "undefined" || typeof MediaRecorder === "undefined") {
    throw new Error("Browser audio recording is unavailable.");
  }

  const video = document.createElement("video");
  const objectURL = URL.createObjectURL(file);
  let audioContext: AudioContext | null = null;
  let source: MediaElementAudioSourceNode | null = null;
  let destination: MediaStreamAudioDestinationNode | null = null;
  let recorder: MediaRecorder | null = null;

  try {
    video.preload = "auto";
    video.playsInline = true;
    video.volume = 0;
    video.src = objectURL;

    await waitForVideoMetadata(video);

    const AudioContextCtor =
      (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
    if (!AudioContextCtor) throw new Error("Web Audio API unavailable.");

    audioContext = new AudioContextCtor();
    if (audioContext.state === "suspended") await audioContext.resume();

    source = audioContext.createMediaElementSource(video);
    destination = audioContext.createMediaStreamDestination();
    source.connect(destination);

    const mimeType = chooseRecordingMimeType();
    recorder = mimeType
      ? new MediaRecorder(destination.stream, { mimeType, audioBitsPerSecond: 192000 })
      : new MediaRecorder(destination.stream);

    const chunks: Blob[] = [];
    const recording = new Promise<Blob>((resolve, reject) => {
      recorder!.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      recorder!.onerror = () => reject(new Error("The browser failed while recording the extracted audio."));
      recorder!.onstop = () => resolve(new Blob(chunks, { type: recorder!.mimeType || "audio/webm" }));
    });

    const progressTimer = window.setInterval(() => {
      if (video.duration > 0 && Number.isFinite(video.duration)) {
        onProgress?.(Math.max(0, Math.min(1, video.currentTime / video.duration)));
      }
    }, 250);

    const ended = new Promise<void>((resolve, reject) => {
      video.onended = () => resolve();
      video.onerror = () => reject(new Error("The browser could not decode this video's audio track."));
    });

    recorder.start(1000);
    try {
      await video.play();
      await ended;
    } finally {
      window.clearInterval(progressTimer);
      if (recorder.state !== "inactive") recorder.stop();
    }

    const blob = await recording;
    if (blob.size === 0) throw new Error("No audio track was produced by the browser.");

    onProgress?.(1);
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    video.pause();
    video.removeAttribute("src");
    video.load();
    source?.disconnect();
    destination?.disconnect();
    await audioContext?.close().catch(() => {});
    URL.revokeObjectURL(objectURL);
  }
}

function chooseRecordingMimeType(): string | undefined {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/ogg",
  ];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type));
}

function waitForVideoMetadata(video: HTMLVideoElement): Promise<void> {
  return new Promise((resolve, reject) => {
    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) {
      resolve();
      return;
    }
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error("The browser could not read the video's metadata."));
  });
}

async function extractAudioWithFFmpeg(
  file: File,
  onProgress?: (ratio: number) => void
): Promise<Uint8Array> {
  const ffmpeg = await getFFmpeg();
  const inputName = "input" + extensionOf(file.name);
  const outputName = "extracted-audio.wav";

  const progressHandler = ({ progress }: { progress: number }) =>
    onProgress?.(Math.min(1, Math.max(0, progress)));
  if (onProgress) ffmpeg.on("progress", progressHandler);

  try {
    // FFmpeg WASM requires the input to be present in its virtual filesystem.
    // The native path above is therefore important for large browser-friendly
    // videos; this remains the compatibility fallback for formats/codecs the
    // browser cannot decode itself.
    onProgress?.(0);
    await ffmpeg.writeFile(inputName, await fetchFile(file));
    await withTimeout(
      ffmpeg.exec(["-i", inputName, "-vn", "-sn", "-dn", "-acodec", "pcm_s16le", "-ar", "44100", outputName]),
      EXTRACT_TIMEOUT_MS,
      "Extracting audio from the video"
    );
    const data = await ffmpeg.readFile(outputName);
    onProgress?.(1);
    return data as Uint8Array;
  } finally {
    if (onProgress) ffmpeg.off("progress", progressHandler);
    await ffmpeg.deleteFile(inputName).catch(() => {});
    await ffmpeg.deleteFile(outputName).catch(() => {});
  }
}

/**
 * Combines the original video's picture stream with a new (processed) audio
 * track into a genuine MP4 container. The video stream is copied
 * bit-for-bit (`-c:v copy`) whenever the source codec is MP4-compatible, so
 * visual quality is fully preserved and re-encoding is avoided; audio is
 * encoded as AAC, which every MP4 player supports.
 */
export async function muxVideoWithAudio(
  videoFile: File,
  audioWavBytes: Uint8Array,
  onProgress?: (ratio: number) => void
): Promise<Uint8Array> {
  const ffmpeg = await getFFmpeg();
  const inputVideoName = "input-video" + extensionOf(videoFile.name);
  const inputAudioName = "processed-audio.wav";
  const outputName = "output.mp4";

  const progressHandler = ({ progress }: { progress: number }) =>
    onProgress?.(Math.min(1, Math.max(0, progress)));
  if (onProgress) ffmpeg.on("progress", progressHandler);

  await ffmpeg.writeFile(inputVideoName, await fetchFile(videoFile));
  await ffmpeg.writeFile(inputAudioName, audioWavBytes);

  const tryCopyArgs = [
    "-i",
    inputVideoName,
    "-i",
    inputAudioName,
    "-map",
    "0:v:0",
    "-map",
    "1:a:0",
    "-c:v",
    "copy",
    "-c:a",
    "aac",
    "-b:a",
    "256k",
    "-shortest",
    "-movflags",
    "+faststart",
    outputName,
  ];

  try {
    await withTimeout(ffmpeg.exec(tryCopyArgs), MUX_TIMEOUT_MS, "Combining audio with video");
  } catch (err) {
    if (err instanceof FFmpegTimeoutError) throw err;
    // Some source codecs (e.g. certain MKV video codecs) aren't valid inside
    // an MP4 container without re-encoding. Fall back to a high-quality
    // H.264 re-encode so the output is still a fully valid, playable MP4.
    await ffmpeg.deleteFile(outputName).catch(() => {});
    const reencodeArgs = [
      "-i",
      inputVideoName,
      "-i",
      inputAudioName,
      "-map",
      "0:v:0",
      "-map",
      "1:a:0",
      "-c:v",
      "libx264",
      "-preset",
      "medium",
      "-crf",
      "18",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "256k",
      "-shortest",
      "-movflags",
      "+faststart",
      outputName,
    ];
    await withTimeout(ffmpeg.exec(reencodeArgs), MUX_TIMEOUT_MS, "Re-encoding video");
  } finally {
    if (onProgress) ffmpeg.off("progress", progressHandler);
  }

  const data = await ffmpeg.readFile(outputName);

  await ffmpeg.deleteFile(inputVideoName).catch(() => {});
  await ffmpeg.deleteFile(inputAudioName).catch(() => {});
  await ffmpeg.deleteFile(outputName).catch(() => {});

  return data as Uint8Array;
}

function extensionOf(name: string): string {
  const idx = name.lastIndexOf(".");
  return idx >= 0 ? name.slice(idx) : "";
}
