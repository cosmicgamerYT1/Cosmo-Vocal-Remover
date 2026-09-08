import type { MediaKind } from "./types";

export const SUPPORTED_AUDIO_EXTENSIONS = [
  "mp3",
  "wav",
  "flac",
  "m4a",
  "aac",
  "ogg",
  "webm",
] as const;

export const SUPPORTED_VIDEO_EXTENSIONS = ["mp4", "mkv", "webm", "mov"] as const;

export const SUPPORTED_AUDIO_MIME_PREFIXES = ["audio/"];
export const SUPPORTED_VIDEO_MIME_PREFIXES = ["video/"];

export const ACCEPT_ATTRIBUTE = [
  ...SUPPORTED_AUDIO_EXTENSIONS.map((e) => `.${e}`),
  ...SUPPORTED_VIDEO_EXTENSIONS.map((e) => `.${e}`),
  "audio/*",
  "video/*",
].join(",");

export const MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB hard ceiling
export const LARGE_FILE_WARNING_BYTES = 350 * 1024 * 1024; // warn above ~350MB

function extOf(name: string): string {
  const parts = name.toLowerCase().split(".");
  return parts.length > 1 ? (parts.pop() as string) : "";
}

export function detectMediaKind(file: File): MediaKind | null {
  const ext = extOf(file.name);
  const mime = file.type;

  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";

  // MKV rarely reports a usable MIME type in browsers, and some audio
  // formats (m4a, flac) are inconsistently tagged — fall back to extension.
  if ((SUPPORTED_VIDEO_EXTENSIONS as readonly string[]).includes(ext)) {
    return "video";
  }
  if ((SUPPORTED_AUDIO_EXTENSIONS as readonly string[]).includes(ext)) {
    return "audio";
  }

  return null;
}

export function isSupportedFile(file: File): boolean {
  return detectMediaKind(file) !== null;
}

export function baseNameWithoutExtension(fileName: string): string {
  const idx = fileName.lastIndexOf(".");
  return idx > 0 ? fileName.slice(0, idx) : fileName;
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / Math.pow(1024, i);
  return `${value >= 100 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
}

export function formatDuration(totalSeconds: number | null | undefined): string {
  if (totalSeconds == null || !isFinite(totalSeconds) || totalSeconds < 0) return "--:--";
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
