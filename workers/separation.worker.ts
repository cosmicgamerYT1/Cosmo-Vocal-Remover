/// <reference lib="webworker" />

// This worker keeps the UI thread responsive during model download,
// compilation, and inference. It speaks a small message protocol defined
// in lib/types.ts (WorkerInboundMessage / WorkerOutboundMessage).
//
// Separation approach: chunked complex-STFT inference, matching the
// tensor contract used by real UVR-MDX-Net ONNX models (see
// lib/modelConfig.ts for the full contract description and citations).
// In short, for each ~6-second chunk of audio:
//   1. STFT each of the L/R channels (Hann window, center-padded).
//   2. Pack [L.re, L.im, R.re, R.im], cropped to `dimF` frequency bins,
//      into a [1, 4, dimF, dimT] tensor and run it through the ONNX model.
//   3. The model predicts the complex STFT of its "primary" stem directly
//      (this is a real neural network prediction — not an EQ/phase trick).
//   4. Zero-pad the frequency axis back out and ISTFT to get a waveform,
//      trimming the STFT context margin used for each chunk.
//   5. The non-primary stem = mix − primary in the time domain, which
//      guarantees the two stems always sum back to the original mix.
//
// All of this runs off the main thread so the tab stays responsive.

import * as ort from "onnxruntime-web";
import { stft, istft, type StftFrames } from "../lib/stft";
import { fetchModelWithCache } from "../lib/modelCache";
import type {
  WorkerInboundMessage,
  WorkerOutboundMessage,
  WorkerInitMessage,
  WorkerSeparateMessage,
} from "../lib/types";
import { getModelConfig } from "../lib/modelConfig";

const ctx: DedicatedWorkerGlobalScope = self as any;

let session: ort.InferenceSession | null = null;

function post(msg: WorkerOutboundMessage) {
  ctx.postMessage(msg);
}

ctx.addEventListener("message", async (event: MessageEvent<WorkerInboundMessage>) => {
  const msg = event.data;
  try {
    if (msg.type === "init") {
      await handleInit(msg);
    } else if (msg.type === "separate") {
      await handleSeparate(msg);
    }
  } catch (err: any) {
    post({
      type: "error",
      code: classifyError(err),
      message: err?.message ?? "An unknown error occurred during processing.",
    });
  }
});

function classifyError(
  err: any
): "no-webgpu-no-wasm" | "model-download-failed" | "model-load-failed" | "out-of-memory" | "inference-failed" | "unknown" {
  const msg = String(err?.message ?? err ?? "").toLowerCase();
  if (msg.includes("download")) return "model-download-failed";
  if (msg.includes("out of memory") || msg.includes("oom") || msg.includes("allocation failed")) return "out-of-memory";
  if (msg.includes("webgpu") || msg.includes("wasm")) return "no-webgpu-no-wasm";
  if (msg.includes("session") || msg.includes("load")) return "model-load-failed";
  if (msg.includes("run") || msg.includes("infer")) return "inference-failed";
  return "unknown";
}

async function handleInit(msg: WorkerInitMessage) {
  // Serve the ONNX Runtime Web WASM/WebGPU artifacts from a versioned CDN so
  // the Next.js bundle doesn't need custom asset copying to work on Vercel.
  ort.env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/[email protected]/dist/";
  ort.env.wasm.numThreads = 1; // single-threaded: no COOP/COEP headers required
  ort.env.logLevel = "warning";

  post({ type: "progress", stage: "downloading-model", progress: 0, detail: "Downloading separation model" });

  const modelBytes = await fetchModelWithCache(msg.modelUrl, (fraction) => {
    post({
      type: "progress",
      stage: "downloading-model",
      progress: fraction,
      detail: "Downloading separation model",
    });
  });

  post({ type: "progress", stage: "compiling-model", progress: null, detail: "Preparing model" });

  const providers = msg.executionProviders;
  let lastError: unknown = null;
  for (const provider of providers) {
    try {
      session = await ort.InferenceSession.create(modelBytes, {
        executionProviders: [provider],
        graphOptimizationLevel: "all",
      });
      break;
    } catch (err) {
      lastError = err;
      session = null;
    }
  }

  if (!session) {
    throw new Error(
      `Failed to initialize the model on any available backend (${providers.join(", ")}). ${
        lastError instanceof Error ? lastError.message : ""
      }`
    );
  }

  post({ type: "progress", stage: "loading-model", progress: 1, detail: "Model ready" });
}

async function handleSeparate(msg: WorkerSeparateMessage) {
  if (!session) {
    throw new Error("Model session was not initialized before separation was requested.");
  }
  const config = getModelConfig();
  const { channels, sampleRate } = msg;
  const [mixL, mixR] = toStereo(channels);
  const nSamples = mixL.length;

  const { fftSize, hopSize, dimF, dimT, inputName, outputName, compensate, primaryStem } = config;
  const nBins = fftSize / 2 + 1;
  if (dimF > nBins) {
    throw new Error(
      `NEXT_PUBLIC_MODEL_DIM_F (${dimF}) can't exceed fftSize/2 + 1 (${nBins}). Check your model configuration.`
    );
  }

  const trim = Math.floor(fftSize / 2);
  const chunkSize = hopSize * (dimT - 1);
  const genSize = chunkSize - 2 * trim;
  if (genSize <= 0) {
    throw new Error(
      "Invalid model chunking configuration: NEXT_PUBLIC_MODEL_DIM_T is too small for the configured fftSize/hopSize."
    );
  }

  const remainder = nSamples % genSize;
  const pad = remainder === 0 ? genSize : genSize - remainder;

  const paddedL = padChannel(mixL, trim, pad);
  const paddedR = padChannel(mixR, trim, pad);

  const numChunks = (nSamples + pad) / genSize;

  // Accumulates the model's predicted "primary" stem waveform.
  const primaryL = new Float32Array(nSamples + pad);
  const primaryR = new Float32Array(nSamples + pad);

  post({ type: "progress", stage: "processing", progress: 0, detail: "Separating vocals" });

  for (let c = 0; c < numChunks; c++) {
    const start = c * genSize;

    const chunkL = extractChunk(paddedL, start, chunkSize);
    const chunkR = extractChunk(paddedR, start, chunkSize);

    const framesL = stft(chunkL, fftSize, hopSize);
    const framesR = stft(chunkR, fftSize, hopSize);

    const inputData = new Float32Array(4 * dimF * dimT);
    packComplexChannel(inputData, framesL, 0, dimF, dimT);
    packComplexChannel(inputData, framesR, 2, dimF, dimT);

    const tensor = new ort.Tensor("float32", inputData, [1, 4, dimF, dimT]);
    const outputMap = await session.run({ [inputName]: tensor });
    const outTensor =
      (outputName && outputMap[outputName]) || outputMap[Object.keys(outputMap)[0]!];
    if (!outTensor) {
      throw new Error("The model did not return any output tensor.");
    }
    const outData = outTensor.data as Float32Array;

    const primaryFramesL = unpackComplexChannel(outData, 0, dimF, dimT, nBins, fftSize, hopSize, chunkSize);
    const primaryFramesR = unpackComplexChannel(outData, 2, dimF, dimT, nBins, fftSize, hopSize, chunkSize);

    const chunkPrimaryL = istft(primaryFramesL);
    const chunkPrimaryR = istft(primaryFramesR);

    // Trim the STFT context margin from each chunk's output, then place it
    // at its stride position — chunks were spaced by `genSize`, so the
    // trimmed regions tile perfectly with no overlap and no gaps.
    for (let k = 0; k < genSize; k++) {
      const dst = start + k;
      if (dst >= primaryL.length) break;
      primaryL[dst] = chunkPrimaryL[trim + k]! * compensate;
      primaryR[dst] = chunkPrimaryR[trim + k]! * compensate;
    }

    post({
      type: "progress",
      stage: "processing",
      progress: (c + 1) / numChunks,
      detail: "Separating vocals",
    });
  }

  const finalPrimaryL = primaryL.subarray(0, nSamples);
  const finalPrimaryR = primaryR.subarray(0, nSamples);

  let vocals: Float32Array[];
  let instrumental: Float32Array[];
  if (primaryStem === "vocals") {
    vocals = [Float32Array.from(finalPrimaryL), Float32Array.from(finalPrimaryR)];
    instrumental = [subtract(mixL, finalPrimaryL), subtract(mixR, finalPrimaryR)];
  } else {
    instrumental = [Float32Array.from(finalPrimaryL), Float32Array.from(finalPrimaryR)];
    vocals = [subtract(mixL, finalPrimaryL), subtract(mixR, finalPrimaryR)];
  }

  post({ type: "progress", stage: "done", progress: 1 });
  post({ type: "result", vocals, instrumental, sampleRate });
}

function padChannel(channel: Float32Array, trim: number, pad: number): Float32Array {
  const out = new Float32Array(trim + channel.length + pad + trim);
  out.set(channel, trim);
  return out;
}

function extractChunk(padded: Float32Array, start: number, length: number): Float32Array {
  const end = Math.min(padded.length, start + length);
  const out = new Float32Array(length);
  out.set(padded.subarray(start, end));
  return out;
}

/** Writes [re, im] of `frames` (cropped to dimF bins) into channels [chOffset, chOffset+1] of a [4, dimF, dimT] buffer. */
function packComplexChannel(
  target: Float32Array,
  frames: StftFrames,
  chOffset: number,
  dimF: number,
  dimT: number
) {
  const numFrames = Math.min(dimT, frames.real.length);
  for (let f = 0; f < numFrames; f++) {
    const re = frames.real[f]!;
    const im = frames.imag[f]!;
    for (let bin = 0; bin < dimF; bin++) {
      const reIdx = (chOffset * dimF + bin) * dimT + f;
      const imIdx = ((chOffset + 1) * dimF + bin) * dimT + f;
      target[reIdx] = bin < re.length ? re[bin]! : 0;
      target[imIdx] = bin < im.length ? im[bin]! : 0;
    }
  }
}

/** Reads channels [chOffset, chOffset+1] of a [4, dimF, dimT] model output back into full-bandwidth StftFrames (zero-padding bins >= dimF). */
function unpackComplexChannel(
  data: Float32Array,
  chOffset: number,
  dimF: number,
  dimT: number,
  nBins: number,
  fftSize: number,
  hopSize: number,
  signalLength: number
): StftFrames {
  const real: Float32Array[] = new Array(dimT);
  const imag: Float32Array[] = new Array(dimT);
  for (let f = 0; f < dimT; f++) {
    const frameRe = new Float32Array(nBins);
    const frameIm = new Float32Array(nBins);
    for (let bin = 0; bin < dimF; bin++) {
      const reIdx = (chOffset * dimF + bin) * dimT + f;
      const imIdx = ((chOffset + 1) * dimF + bin) * dimT + f;
      frameRe[bin] = data[reIdx]!;
      frameIm[bin] = data[imIdx]!;
    }
    // Bins >= dimF are left at 0 (the model's own convention — see
    // `freq_pad` in the reference UVR-MDX-Net implementation).
    real[f] = frameRe;
    imag[f] = frameIm;
  }
  return { real, imag, numFreqBins: nBins, fftSize, hopSize, signalLength };
}

function subtract(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i]! - b[i]!;
  return out;
}

function toStereo(channels: Float32Array[]): [Float32Array, Float32Array] {
  if (channels.length >= 2) {
    return [channels[0]!, channels[1]!];
  }
  const mono = channels[0]!;
  return [mono, mono.slice()];
}

export {};
