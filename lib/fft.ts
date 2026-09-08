/**
 * Minimal, dependency-free iterative radix-2 Cooley-Tukey FFT operating
 * in-place on separate real/imaginary Float32Arrays. `size` must be a
 * power of two (STFT window sizes below are chosen accordingly).
 *
 * This runs inside the separation Web Worker, off the UI thread.
 */
export class FFT {
  readonly size: number;
  private readonly reverseTable: Uint32Array;
  private readonly cosTable: Float32Array;
  private readonly sinTable: Float32Array;

  constructor(size: number) {
    if (size <= 0 || (size & (size - 1)) !== 0) {
      throw new Error(`FFT size must be a power of two, got ${size}`);
    }
    this.size = size;
    this.reverseTable = new Uint32Array(size);
    this.cosTable = new Float32Array(size / 2);
    this.sinTable = new Float32Array(size / 2);

    const bits = Math.log2(size);
    for (let i = 0; i < size; i++) {
      let rev = 0;
      let x = i;
      for (let b = 0; b < bits; b++) {
        rev = (rev << 1) | (x & 1);
        x >>= 1;
      }
      this.reverseTable[i] = rev;
    }
    for (let i = 0; i < size / 2; i++) {
      const angle = (-2 * Math.PI * i) / size;
      this.cosTable[i] = Math.cos(angle);
      this.sinTable[i] = Math.sin(angle);
    }
  }

  /** Forward FFT. re/im are modified in place and must have length === size. */
  forward(re: Float32Array, im: Float32Array): void {
    this.transform(re, im, false);
  }

  /** Inverse FFT (includes 1/N scaling). re/im are modified in place. */
  inverse(re: Float32Array, im: Float32Array): void {
    this.transform(re, im, true);
    const n = this.size;
    for (let i = 0; i < n; i++) {
      re[i]! /= n;
      im[i]! /= n;
    }
  }

  private transform(re: Float32Array, im: Float32Array, inverse: boolean): void {
    const n = this.size;
    const { reverseTable } = this;

    for (let i = 0; i < n; i++) {
      const j = reverseTable[i]!;
      if (j > i) {
        const tr = re[i]!;
        re[i] = re[j]!;
        re[j] = tr;
        const ti = im[i]!;
        im[i] = im[j]!;
        im[j] = ti;
      }
    }

    const sign = inverse ? 1 : -1;
    for (let size = 2; size <= n; size *= 2) {
      const half = size / 2;
      const tableStep = n / size;
      for (let i = 0; i < n; i += size) {
        for (let k = 0; k < half; k++) {
          const tableIndex = k * tableStep;
          const cos = this.cosTable[tableIndex]!;
          const sin = sign * this.sinTable[tableIndex]!;

          const evenIndex = i + k;
          const oddIndex = i + k + half;

          const evenRe = re[evenIndex]!;
          const evenIm = im[evenIndex]!;
          const oddReRaw = re[oddIndex]!;
          const oddImRaw = im[oddIndex]!;

          const twiddleRe = oddReRaw * cos - oddImRaw * sin;
          const twiddleIm = oddReRaw * sin + oddImRaw * cos;

          re[evenIndex] = evenRe + twiddleRe;
          im[evenIndex] = evenIm + twiddleIm;
          re[oddIndex] = evenRe - twiddleRe;
          im[oddIndex] = evenIm - twiddleIm;
        }
      }
    }
  }
}

export function hannWindow(size: number): Float32Array {
  const w = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1));
  }
  return w;
}
