export interface WaveformPeaks {
  min: Float32Array;
  max: Float32Array;
}

export function computePeaks(channel: Float32Array, numBuckets: number): WaveformPeaks {
  const min = new Float32Array(numBuckets);
  const max = new Float32Array(numBuckets);
  const samplesPerBucket = Math.max(1, Math.floor(channel.length / numBuckets));

  for (let b = 0; b < numBuckets; b++) {
    const start = b * samplesPerBucket;
    const end = Math.min(channel.length, start + samplesPerBucket);
    let lo = 0;
    let hi = 0;
    for (let i = start; i < end; i++) {
      const v = channel[i]!;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    min[b] = lo;
    max[b] = hi;
  }

  return { min, max };
}

/** Cheap peak estimation directly from a File, decoding only enough to render a preview waveform. */
export async function computePeaksFromAudioBuffer(
  buffer: AudioBuffer,
  numBuckets: number
): Promise<WaveformPeaks> {
  const channel = buffer.getChannelData(0);
  return computePeaks(channel, numBuckets);
}
