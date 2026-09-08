import { get, set, del } from "idb-keyval";

const CACHE_KEY_PREFIX = "vocal-remover:model:";

/**
 * Downloads the model at `url` with progress reporting, caching the raw
 * bytes in IndexedDB so subsequent visits skip the network entirely.
 * The cache key includes the URL, so pointing NEXT_PUBLIC_MODEL_URL at a
 * new model automatically invalidates the old cached entry.
 */
export async function fetchModelWithCache(
  url: string,
  onProgress: (fractionDownloaded: number | null) => void
): Promise<ArrayBuffer> {
  const cacheKey = CACHE_KEY_PREFIX + url;

  try {
    const cached = await get<ArrayBuffer>(cacheKey);
    if (cached && cached.byteLength > 0) {
      onProgress(1);
      return cached;
    }
  } catch {
    // IndexedDB unavailable (private browsing, quota, etc.) — fall through to a plain fetch.
  }

  const response = await fetch(url);
  if (!response.ok || !response.body) {
    throw new Error(`Model download failed with status ${response.status}`);
  }

  const contentLength = Number(response.headers.get("content-length") ?? 0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      received += value.byteLength;
      onProgress(contentLength > 0 ? Math.min(1, received / contentLength) : null);
    }
  }

  const buffer = new Uint8Array(received);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    await set(cacheKey, buffer.buffer);
  } catch {
    // Best-effort caching; a failure here shouldn't break separation.
  }

  return buffer.buffer;
}

export async function clearModelCache(url: string): Promise<void> {
  await del(CACHE_KEY_PREFIX + url).catch(() => {});
}
