import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";

const FFMPEG_CORE_VERSION = "0.12.6";
const FFMPEG_CORE_BASE = `https://unpkg.com/@ffmpeg/[email protected]${FFMPEG_CORE_VERSION}/dist/esm`;

let ffmpegInstance: FFmpeg | null = null;
let loadPromise: Promise<FFmpeg> | null = null;

/**
 * Lazily loads ffmpeg.wasm (single-threaded core — no COOP/COEP headers
 * required, which keeps Vercel deployment configuration-free). The core
 * binary (~25MB) is fetched from a CDN and cached by the browser's HTTP
 * cache after first use.
 */
export async function getFFmpeg(onLog?: (message: string) => void): Promise<FFmpeg> {
  if (ffmpegInstance) return ffmpegInstance;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    const ffmpeg = new FFmpeg();
    if (onLog) {
      ffmpeg.on("log", ({ message }) => onLog(message));
    }
    const coreURL = await toBlobURL(`${FFMPEG_CORE_BASE}/ffmpeg-core.js`, "text/javascript");
    const wasmURL = await toBlobURL(`${FFMPEG_CORE_BASE}/ffmpeg-core.wasm`, "application/wasm");
    await ffmpeg.load({ coreURL, wasmURL });
    ffmpegInstance = ffmpeg;
    return ffmpeg;
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
