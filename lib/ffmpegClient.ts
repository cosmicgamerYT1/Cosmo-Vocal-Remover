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
    if (onLog) {
      ffmpeg.on("log", ({ message }) => onLog(message));
    }

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

/** Extracts the audio track from a video file as WAV bytes, for decoding/separation. */
export async function extractAudioFromVideo(
  file: File,
  onProgress?: (ratio: number) => void
): Promise<Uint8Array> {
  const ffmpeg = await getFFmpeg();
  const inputName = "input" + extensionOf(file.name);
  const outputName = "extracted-audio.wav";

  if (onProgress) {
    ffmpeg.on("progress", ({ progress }) => onProgress(Math.min(1, Math.max(0, progress))));
  }

  await ffmpeg.writeFile(inputName, await fetchFile(file));
  await ffmpeg.exec(["-i", inputName, "-vn", "-acodec", "pcm_s16le", "-ar", "44100", outputName]);
  const data = await ffmpeg.readFile(outputName);

  await ffmpeg.deleteFile(inputName).catch(() => {});
  await ffmpeg.deleteFile(outputName).catch(() => {});

  return data as Uint8Array;
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
    await ffmpeg.exec(tryCopyArgs);
  } catch {
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
    await ffmpeg.exec(reencodeArgs);
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
