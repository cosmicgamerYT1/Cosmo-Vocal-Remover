import { FFT, hannWindow } from "./fft";

export interface StftFrames {
  /** [numFrames][numFreqBins] real part */
  real: Float32Array[];
  /** [numFrames][numFreqBins] imaginary part */
  imag: Float32Array[];
  numFreqBins: number;
  fftSize: number;
  hopSize: number;
  signalLength: number;
}

/**
 * Computes the short-time Fourier transform of a real-valued signal.
 * Only the non-redundant bins [0, fftSize/2] are kept (real signal symmetry).
 */
export function stft(signal: Float32Array, fftSize: number, hopSize: number): StftFrames {
  const window = hannWindow(fftSize);
  const fft = new FFT(fftSize);
  const numFreqBins = fftSize / 2 + 1;

  // Center-pad so the first frame is centered at t=0 (matches common STFT conventions).
  const padAmount = fftSize / 2;
  const padded = new Float32Array(signal.length + padAmount * 2);
  padded.set(signal, padAmount);

  const numFrames = Math.max(1, Math.floor((padded.length - fftSize) / hopSize) + 1);

  const real: Float32Array[] = new Array(numFrames);
  const imag: Float32Array[] = new Array(numFrames);

  const reBuf = new Float32Array(fftSize);
  const imBuf = new Float32Array(fftSize);

  for (let frame = 0; frame < numFrames; frame++) {
    const start = frame * hopSize;
    for (let i = 0; i < fftSize; i++) {
      const sampleIdx = start + i;
      const sample = sampleIdx < padded.length ? padded[sampleIdx]! : 0;
      reBuf[i] = sample * window[i]!;
      imBuf[i] = 0;
    }
    fft.forward(reBuf, imBuf);

    const frameRe = new Float32Array(numFreqBins);
    const frameIm = new Float32Array(numFreqBins);
    for (let bin = 0; bin < numFreqBins; bin++) {
      frameRe[bin] = reBuf[bin]!;
      frameIm[bin] = imBuf[bin]!;
    }
    real[frame] = frameRe;
    imag[frame] = frameIm;
  }

  return { real, imag, numFreqBins, fftSize, hopSize, signalLength: signal.length };
}

/**
 * Reconstructs a real-valued signal from STFT frames via overlap-add,
 * normalizing by the sum of squared analysis windows (the standard
 * COLA-correct inverse for Hann windows at typical hop sizes).
 */
export function istft(frames: StftFrames): Float32Array {
  const { real, imag, fftSize, hopSize, signalLength } = frames;
  const window = hannWindow(fftSize);
  const fft = new FFT(fftSize);
  const numFreqBins = fftSize / 2 + 1;
  const padAmount = fftSize / 2;

  const paddedLength = signalLength + padAmount * 2;
  const output = new Float32Array(paddedLength + fftSize);
  const windowSumSq = new Float32Array(paddedLength + fftSize);

  const reBuf = new Float32Array(fftSize);
  const imBuf = new Float32Array(fftSize);

  for (let frame = 0; frame < real.length; frame++) {
    const frameRe = real[frame]!;
    const frameIm = imag[frame]!;

    // Rebuild the full (conjugate-symmetric) spectrum from the kept bins.
    for (let bin = 0; bin < fftSize; bin++) {
      if (bin < numFreqBins) {
        reBuf[bin] = frameRe[bin]!;
        imBuf[bin] = frameIm[bin]!;
      } else {
        const mirror = fftSize - bin;
        reBuf[bin] = frameRe[mirror]!;
        imBuf[bin] = -frameIm[mirror]!;
      }
    }

    fft.inverse(reBuf, imBuf);

    const start = frame * hopSize;
    for (let i = 0; i < fftSize; i++) {
      const idx = start + i;
      const w = window[i]!;
      output[idx]! += reBuf[i]! * w;
      windowSumSq[idx]! += w * w;
    }
  }

  const result = new Float32Array(signalLength);
  for (let i = 0; i < signalLength; i++) {
    const idx = i + padAmount;
    const norm = windowSumSq[idx]!;
    result[i] = norm > 1e-8 ? output[idx]! / norm : 0;
  }
  return result;
}

export function magnitude(re: Float32Array, im: Float32Array): Float32Array {
  const out = new Float32Array(re.length);
  for (let i = 0; i < re.length; i++) {
    out[i] = Math.sqrt(re[i]! * re[i]! + im[i]! * im[i]!);
  }
  return out;
}
