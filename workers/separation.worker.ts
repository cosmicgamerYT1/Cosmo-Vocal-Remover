/// <reference lib="webworker" />

// This worker keeps the UI thread responsive during model download,
// compilation, and inference. It speaks a small message protocol defined
// in lib/types.ts (WorkerInboundMessage / WorkerOutboundMessage).
//
// Separation approach: STFT-domain masking.
//   1. STFT each channel of the mixed-down audio.
//   2. Feed magnitude spectrogram chunks through the ONNX model, which
//      predicts a vocal mask in [0, 1] per time-frequency bin.
//   3. Apply the mask to the complex mix spectrogram -> vocal spectrogram.
//   4. ISTFT back to a waveform for vocals.
//   5. Instrumental = mix - vocals in the time domain (guarantees the two
//      stems sum back to the original mix, avoiding phase artifacts from
//      re-synthesizing the instrumental independently).
//
// This is genuine learned source separation (the mask comes from a neural
// network's weights), not an EQ/phase-cancellation trick.

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

function classifyError(err: any): "no-webgpu-no-wasm" | "model-download-failed" | "model-load-failed" | "out-of-memory" | "inference-failed" | "unknown" {
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

  // The model expects a fixed channel count (stereo). Downmix/upmix as needed.
  const stereo = toStereo(channels);

  post({ type: "progress", stage: "processing", progress: 0, detail: "Analyzing audio" });

  const stftL = stft(stereo[0]!, config.fftSize, config.hopSize);
  const stftR = stft(stereo[1]!, config.fftSize, config.hopSize);

  const dimF = config.fftSize / 2; // drop the Nyquist bin, standard MDX-style convention
  const numFrames = stftL.real.length;
  const chunkFrames = config.chunkFrames;
  const numChunks = Math.max(1, Math.ceil(numFrames / chunkFrames));

  const vocalMaskL: Float32Array[] = new Array(numFrames);
  const vocalMaskR: Float32Array[] = new Array(numFrames);

  for (let c = 0; c < numChunks; c++) {
    const startFrame = c * chunkFrames;
    const endFrame = Math.min(numFrames, startFrame + chunkFrames);
    const framesInChunk = endFrame - startFrame;

    const inputData = new Float32Array(1 * 2 * dimF * chunkFrames);
    fillMagnitudeChunk(inputData, stftL, startFrame, framesInChunk, dimF, chunkFrames, 0);
    fillMagnitudeChunk(inputData, stftR, startFrame, framesInChunk, dimF, chunkFrames, 1);

    const tensor = new ort.Tensor("float32", inputData, [1, 2, dimF, chunkFrames]);
    const feeds: Record<string, ort.Tensor> = { [config.inputName]: tensor };

    const outputMap = await session.run(feeds);
    const output = outputMap[config.outputName];
    if (!output) {
      throw new Error(
        `Model did not return an output named "${config.outputName}". Check NEXT_PUBLIC_MODEL_OUTPUT_NAME.`
      );
    }
    const outData = output.data as Float32Array;

    for (let f = 0; f < framesInChunk; f++) {
      const frameIdx = startFrame + f;
      const maskL = new Float32Array(dimF);
      const maskR = new Float32Array(dimF);
      for (let bin = 0; bin < dimF; bin++) {
        // Layout: [batch, channel(2), freq(dimF), time(chunkFrames)]
        const idxL = (0 * dimF + bin) * chunkFrames + f;
        const idxR = (1 * dimF + bin) * chunkFrames + f;
        maskL[bin] = clamp01(outData[idxL]!);
        maskR[bin] = clamp01(outData[idxR]!);
      }
      vocalMaskL[frameIdx] = maskL;
      vocalMaskR[frameIdx] = maskR;
    }

    post({
      type: "progress",
      stage: "processing",
      progress: (c + 1) / numChunks,
      detail: "Separating vocals",
    });
  }

  const vocalStftL = applyMask(stftL, vocalMaskL, dimF);
  const vocalStftR = applyMask(stftR, vocalMaskR, dimF);

  post({ type: "progress", stage: "processing", progress: null, detail: "Reconstructing audio" });

  const vocalsL = istft(vocalStftL);
  const vocalsR = istft(vocalStftR);

  const instrumentalL = new Float32Array(stereo[0]!.length);
  const instrumentalR = new Float32Array(stereo[1]!.length);
  for (let i = 0; i < instrumentalL.length; i++) {
    instrumentalL[i] = stereo[0]![i]! - vocalsL[i]!;
    instrumentalR[i] = stereo[1]![i]! - vocalsR[i]!;
  }

  post({ type: "progress", stage: "done", progress: 1 });
  post({
    type: "result",
    vocals: [vocalsL, vocalsR],
    instrumental: [instrumentalL, instrumentalR],
    sampleRate,
  });
}

function fillMagnitudeChunk(
  target: Float32Array,
  frames: StftFrames,
  startFrame: number,
  framesInChunk: number,
  dimF: number,
  chunkFrames: number,
  channelIndex: number
) {
  for (let f = 0; f < chunkFrames; f++) {
    const frameIdx = startFrame + f;
    for (let bin = 0; bin < dimF; bin++) {
      let mag = 0;
      if (f < framesInChunk && frameIdx < frames.real.length) {
        const re = frames.real[frameIdx]![bin]!;
        const im = frames.imag[frameIdx]![bin]!;
        mag = Math.sqrt(re * re + im * im);
      }
      const idx = (channelIndex * dimF + bin) * chunkFrames + f;
      target[idx] = mag;
    }
  }
}

function applyMask(frames: StftFrames, masks: Float32Array[], dimF: number): StftFrames {
  const real: Float32Array[] = new Array(frames.real.length);
  const imag: Float32Array[] = new Array(frames.imag.length);
  for (let f = 0; f < frames.real.length; f++) {
    const srcRe = frames.real[f]!;
    const srcIm = frames.imag[f]!;
    const mask = masks[f]!;
    const outRe = new Float32Array(frames.numFreqBins);
    const outIm = new Float32Array(frames.numFreqBins);
    for (let bin = 0; bin < frames.numFreqBins; bin++) {
      const m = bin < dimF ? mask[bin]! : 0; // Nyquist bin dropped by the model -> fully masked out
      outRe[bin] = srcRe[bin]! * m;
      outIm[bin] = srcIm[bin]! * m;
    }
    real[f] = outRe;
    imag[f] = outIm;
  }
  return { ...frames, real, imag };
}

function toStereo(channels: Float32Array[]): [Float32Array, Float32Array] {
  if (channels.length >= 2) {
    return [channels[0]!, channels[1]!];
  }
  const mono = channels[0]!;
  return [mono, mono.slice()];
}

function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

export {};
