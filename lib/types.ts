export type MediaKind = "audio" | "video";

export interface SelectedMedia {
  file: File;
  kind: MediaKind;
  url: string; // object URL for preview
  durationSec: number | null;
  width?: number;
  height?: number;
}

export type AppStage = "landing" | "processing" | "results" | "error";

export interface ProcessingStep {
  id: string;
  label: string;
  /** Roughly how much of the overall job this step represents (sums to 1 across all steps for a run). */
  weight: number;
}

export interface ProcessingState {
  stepIndex: number;
  steps: ProcessingStep[];
  /** 0-1 overall progress, or null when the underlying stage is indeterminate. */
  progress: number | null;
  detail?: string;
}

export interface SeparationResultAudio {
  kind: "audio";
  vocals: {
    blob: Blob;
    url: string;
    durationSec: number;
    fileName: string;
  };
  instrumental: {
    blob: Blob;
    url: string;
    durationSec: number;
    fileName: string;
  };
  sourceFileBaseName: string;
}

export interface SeparationResultVideo {
  kind: "video";
  video: {
    blob: Blob;
    url: string;
    durationSec: number;
    fileName: string;
  };
  vocals?: {
    blob: Blob;
    url: string;
    durationSec: number;
    fileName: string;
  };
  instrumental?: {
    blob: Blob;
    url: string;
    durationSec: number;
    fileName: string;
  };
  sourceFileBaseName: string;
}

export type SeparationResult = SeparationResultAudio | SeparationResultVideo;

export interface AppError {
  title: string;
  message: string;
  /** Whether "Try again" should re-run the same file, vs requiring a new upload. */
  recoverable: boolean;
}

// ---- Worker protocol -------------------------------------------------

export interface WorkerInitMessage {
  type: "init";
  modelUrl: string;
  executionProviders: Array<"webgpu" | "wasm">;
}

export interface WorkerSeparateMessage {
  type: "separate";
  /** Interleaved-per-channel Float32 PCM, one array per channel. */
  channels: Float32Array[];
  sampleRate: number;
}

export type WorkerInboundMessage = WorkerInitMessage | WorkerSeparateMessage;

export interface WorkerProgressMessage {
  type: "progress";
  stage:
    | "loading-model"
    | "downloading-model"
    | "compiling-model"
    | "processing"
    | "done";
  progress: number | null; // 0-1 or null for indeterminate
  detail?: string;
}

export interface WorkerResultMessage {
  type: "result";
  vocals: Float32Array[];
  instrumental: Float32Array[];
  sampleRate: number;
}

export interface WorkerErrorMessage {
  type: "error";
  message: string;
  code:
    | "no-webgpu-no-wasm"
    | "model-download-failed"
    | "model-load-failed"
    | "out-of-memory"
    | "inference-failed"
    | "unknown";
}

export type WorkerOutboundMessage =
  | WorkerProgressMessage
  | WorkerResultMessage
  | WorkerErrorMessage;
