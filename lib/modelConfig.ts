/**
 * The separation engine is architecture-agnostic in principle, but by
 * default it's wired to the tensor contract used by UVR-MDX-Net ONNX
 * models — the same format produced by the widely-used, open-source
 * python-audio-separator / Ultimate Vocal Remover project. That's a real,
 * actively-maintained model family (not bundled here — see README.md →
 * "Bring your own model" for where to get one and why it isn't shipped
 * in this repo).
 *
 * Contract (matches UVR-MDX-Net ONNX exports):
 *   Input  "input": float32 [1, 4, dimF, dimT]
 *     - 4 channels = [Left.real, Left.imag, Right.real, Right.imag]
 *       of the mix's complex STFT, cropped to the first `dimF` frequency
 *       bins (a fixed per-model convention, not necessarily fftSize/2+1).
 *   Output (first output tensor): float32 [1, 4, dimF, dimT]
 *     - Same layout, but it's the complex STFT of the model's "primary"
 *       stem (see `primaryStem`) predicted directly — not a mask.
 *
 * Configure via environment variables at build time:
 *   NEXT_PUBLIC_MODEL_URL           - URL to the .onnx model file
 *   NEXT_PUBLIC_MODEL_FFT_SIZE      - n_fft the model was trained with (default 6144)
 *   NEXT_PUBLIC_MODEL_HOP_SIZE      - STFT hop size (default 1024)
 *   NEXT_PUBLIC_MODEL_DIM_F         - frequency bins kept in the input/output (default 2048)
 *   NEXT_PUBLIC_MODEL_DIM_T         - time frames per inference chunk (default 256)
 *   NEXT_PUBLIC_MODEL_SAMPLE_RATE   - sample rate the model was trained at (default 44100)
 *   NEXT_PUBLIC_MODEL_PRIMARY_STEM  - "vocals" | "instrumental" — which stem the
 *                                     model outputs directly (default "vocals")
 *   NEXT_PUBLIC_MODEL_COMPENSATE    - gain-compensation multiplier some UVR
 *                                     models specify (default 1.0)
 *   NEXT_PUBLIC_MODEL_INPUT_NAME    - ONNX graph input name (default "input")
 *   NEXT_PUBLIC_MODEL_OUTPUT_NAME   - ONNX graph output name (default: use the
 *                                     model's first/only output, whatever it's named)
 */
export interface ModelConfig {
  url: string;
  fftSize: number;
  hopSize: number;
  dimF: number;
  dimT: number;
  sampleRate: number;
  primaryStem: "vocals" | "instrumental";
  compensate: number;
  inputName: string;
  outputName: string; // empty string = use the first output tensor regardless of name
}

export function getModelConfig(): ModelConfig {
  const primaryStemEnv = (process.env.NEXT_PUBLIC_MODEL_PRIMARY_STEM ?? "vocals").toLowerCase();
  return {
    url: process.env.NEXT_PUBLIC_MODEL_URL ?? "",
    fftSize: numFromEnv(process.env.NEXT_PUBLIC_MODEL_FFT_SIZE, 6144),
    hopSize: numFromEnv(process.env.NEXT_PUBLIC_MODEL_HOP_SIZE, 1024),
    dimF: numFromEnv(process.env.NEXT_PUBLIC_MODEL_DIM_F, 2048),
    dimT: numFromEnv(process.env.NEXT_PUBLIC_MODEL_DIM_T, 256),
    sampleRate: numFromEnv(process.env.NEXT_PUBLIC_MODEL_SAMPLE_RATE, 44100),
    primaryStem: primaryStemEnv === "instrumental" ? "instrumental" : "vocals",
    compensate: numFromEnv(process.env.NEXT_PUBLIC_MODEL_COMPENSATE, 1.0),
    inputName: process.env.NEXT_PUBLIC_MODEL_INPUT_NAME ?? "input",
    outputName: process.env.NEXT_PUBLIC_MODEL_OUTPUT_NAME ?? "",
  };
}

function numFromEnv(value: string | undefined, fallback: number): number {
  const n = value ? Number(value) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function isModelConfigured(config: ModelConfig): boolean {
  return config.url.trim().length > 0;
}
