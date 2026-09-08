/**
 * The separation engine is architecture-agnostic: it runs whatever ONNX
 * source-separation model you point it at, as long as the model follows
 * the STFT-domain masking contract described in README.md ("Bring your
 * own model"). This keeps the app itself free of any bundled model
 * weights (which would bloat the repo and often carry restrictive
 * licenses), while still doing genuine ML-based separation rather than
 * naive EQ/phase tricks.
 *
 * Configure these via environment variables at build time:
 *   NEXT_PUBLIC_MODEL_URL         - URL to the .onnx model file
 *   NEXT_PUBLIC_MODEL_FFT_SIZE    - STFT window size the model expects (default 4096)
 *   NEXT_PUBLIC_MODEL_HOP_SIZE    - STFT hop size the model expects (default 1024)
 *   NEXT_PUBLIC_MODEL_SAMPLE_RATE - sample rate the model was trained at (default 44100)
 *   NEXT_PUBLIC_MODEL_CHUNK_FRAMES- number of STFT time-frames per inference chunk (default 256)
 *   NEXT_PUBLIC_MODEL_INPUT_NAME  - ONNX graph input name (default "input")
 *   NEXT_PUBLIC_MODEL_OUTPUT_NAME - ONNX graph output name (default "output")
 */
export interface ModelConfig {
  url: string;
  fftSize: number;
  hopSize: number;
  sampleRate: number;
  chunkFrames: number;
  inputName: string;
  outputName: string;
}

export function getModelConfig(): ModelConfig {
  return {
    url: process.env.NEXT_PUBLIC_MODEL_URL ?? "",
    fftSize: numFromEnv(process.env.NEXT_PUBLIC_MODEL_FFT_SIZE, 4096),
    hopSize: numFromEnv(process.env.NEXT_PUBLIC_MODEL_HOP_SIZE, 1024),
    sampleRate: numFromEnv(process.env.NEXT_PUBLIC_MODEL_SAMPLE_RATE, 44100),
    chunkFrames: numFromEnv(process.env.NEXT_PUBLIC_MODEL_CHUNK_FRAMES, 256),
    inputName: process.env.NEXT_PUBLIC_MODEL_INPUT_NAME ?? "input",
    outputName: process.env.NEXT_PUBLIC_MODEL_OUTPUT_NAME ?? "output",
  };
}

function numFromEnv(value: string | undefined, fallback: number): number {
  const n = value ? Number(value) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function isModelConfigured(config: ModelConfig): boolean {
  return config.url.trim().length > 0;
}
