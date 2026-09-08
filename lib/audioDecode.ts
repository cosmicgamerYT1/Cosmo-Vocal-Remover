export interface DecodedAudio {
  channels: Float32Array[]; // one Float32Array per channel
  sampleRate: number;
  durationSec: number;
}

/**
 * Decodes an ArrayBuffer of encoded audio (mp3/wav/flac/aac/ogg/m4a/webm — whatever
 * the browser's media engine supports) into raw PCM using the Web Audio API.
 * This never touches a server: decoding happens fully client-side.
 */
export async function decodeAudioBuffer(
  arrayBuffer: ArrayBuffer,
  targetSampleRate?: number
): Promise<DecodedAudio> {
  const AudioContextCtor =
    (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;

  if (!AudioContextCtor) {
    throw new Error("This browser does not support the Web Audio API required to decode audio.");
  }

  // A throwaway context just for decodeAudioData (works even before resampling).
  const probeCtx = new AudioContextCtor();
  let decoded: AudioBuffer;
  try {
    // Safari requires the ArrayBuffer not be detached/reused, so we clone it.
    decoded = await probeCtx.decodeAudioData(arrayBuffer.slice(0));
  } catch (err) {
    await probeCtx.close().catch(() => {});
    throw new DOMException(
      "The file could not be decoded. It may be corrupted or in an unsupported codec.",
      "EncodingError"
    );
  }
  await probeCtx.close().catch(() => {});

  const finalBuffer = targetSampleRate && targetSampleRate !== decoded.sampleRate
    ? await resampleAudioBuffer(decoded, targetSampleRate)
    : decoded;

  const channels: Float32Array[] = [];
  for (let ch = 0; ch < finalBuffer.numberOfChannels; ch++) {
    channels.push(finalBuffer.getChannelData(ch).slice());
  }

  return {
    channels,
    sampleRate: finalBuffer.sampleRate,
    durationSec: finalBuffer.duration,
  };
}

export async function resampleAudioBuffer(
  buffer: AudioBuffer,
  targetSampleRate: number
): Promise<AudioBuffer> {
  const OfflineCtor = (window.OfflineAudioContext ||
    (window as any).webkitOfflineAudioContext) as typeof OfflineAudioContext;

  const targetLength = Math.ceil((buffer.duration * targetSampleRate));
  const offlineCtx = new OfflineCtor(
    buffer.numberOfChannels,
    Math.max(targetLength, 1),
    targetSampleRate
  );
  const source = offlineCtx.createBufferSource();
  source.buffer = buffer;
  source.connect(offlineCtx.destination);
  source.start(0);
  return offlineCtx.startRendering();
}

/** Gets duration + basic metadata for a file without fully decoding it (cheap, for the upload card). */
export function probeMediaElement(
  file: File,
  kind: "audio" | "video"
): Promise<{ durationSec: number | null; width?: number; height?: number }> {
  return new Promise((resolve) => {
    const el = document.createElement(kind === "video" ? "video" : "audio");
    el.preload = "metadata";
    const url = URL.createObjectURL(file);
    el.src = url;

    const cleanup = () => {
      URL.revokeObjectURL(url);
      el.removeAttribute("src");
      el.load();
    };

    const timeout = setTimeout(() => {
      cleanup();
      resolve({ durationSec: null });
    }, 8000);

    el.onloadedmetadata = () => {
      clearTimeout(timeout);
      const result = {
        durationSec: isFinite(el.duration) ? el.duration : null,
        width: (el as HTMLVideoElement).videoWidth || undefined,
        height: (el as HTMLVideoElement).videoHeight || undefined,
      };
      cleanup();
      resolve(result);
    };
    el.onerror = () => {
      clearTimeout(timeout);
      cleanup();
      resolve({ durationSec: null });
    };
  });
}
