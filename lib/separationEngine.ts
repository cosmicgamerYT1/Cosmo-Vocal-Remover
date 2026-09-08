import type { WorkerOutboundMessage } from "./types";
import { getModelConfig, isModelConfigured } from "./modelConfig";

type ProgressStage = Extract<WorkerOutboundMessage, { type: "progress" }>["stage"];

export interface SeparationProgress {
  stage: ProgressStage;
  progress: number | null;
  detail?: string;
}

export interface SeparationOutcome {
  vocals: Float32Array[];
  instrumental: Float32Array[];
  sampleRate: number;
}

export class SeparationEngineError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
    this.name = "SeparationEngineError";
  }
}

export async function detectExecutionProviders(): Promise<Array<"webgpu" | "wasm">> {
  const providers: Array<"webgpu" | "wasm"> = [];
  const nav = navigator as any;
  if (nav.gpu) {
    try {
      const adapter = await nav.gpu.requestAdapter();
      if (adapter) providers.push("webgpu");
    } catch {
      // ignore, fall through to wasm
    }
  }
  providers.push("wasm");
  return providers;
}

/**
 * Runs vocal/instrumental separation in a dedicated Web Worker so the model
 * download, compilation, and inference never block the UI thread.
 */
export function runSeparation(
  channels: Float32Array[],
  sampleRate: number,
  onProgress: (p: SeparationProgress) => void
): { promise: Promise<SeparationOutcome>; cancel: () => void } {
  const config = getModelConfig();

  if (!isModelConfigured(config)) {
    return {
      promise: Promise.reject(
        new SeparationEngineError(
          "No separation model is configured. Set NEXT_PUBLIC_MODEL_URL to a compatible ONNX model — see README.md.",
          "model-not-configured"
        )
      ),
      cancel: () => {},
    };
  }

  const worker = new Worker(new URL("../workers/separation.worker.ts", import.meta.url), {
    type: "module",
  });

  let settled = false;

  const promise = new Promise<SeparationOutcome>(async (resolve, reject) => {
    worker.addEventListener("message", (event: MessageEvent<WorkerOutboundMessage>) => {
      const msg = event.data;
      if (msg.type === "progress") {
        onProgress({ stage: msg.stage as any, progress: msg.progress, detail: msg.detail });
      } else if (msg.type === "result") {
        settled = true;
        resolve({ vocals: msg.vocals, instrumental: msg.instrumental, sampleRate: msg.sampleRate });
        worker.terminate();
      } else if (msg.type === "error") {
        settled = true;
        reject(new SeparationEngineError(msg.message, msg.code));
        worker.terminate();
      }
    });

    worker.addEventListener("error", (event) => {
      if (settled) return;
      settled = true;
      reject(new SeparationEngineError(event.message || "The separation worker crashed unexpectedly.", "unknown"));
      worker.terminate();
    });

    try {
      const providers = await detectExecutionProviders();
      worker.postMessage({ type: "init", modelUrl: config.url, executionProviders: providers });
      worker.postMessage(
        { type: "separate", channels, sampleRate },
        channels.map((c) => c.buffer)
      );
    } catch (err: any) {
      if (!settled) {
        settled = true;
        reject(new SeparationEngineError(err?.message ?? "Failed to start separation.", "unknown"));
      }
    }
  });

  return {
    promise,
    cancel: () => {
      if (!settled) worker.terminate();
    },
  };
}
