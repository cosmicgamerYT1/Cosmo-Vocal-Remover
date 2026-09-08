"use client";

import { useCallback, useRef, useState } from "react";
import { Sparkles } from "lucide-react";
import UploadArea from "@/components/UploadArea";
import MediaCard from "@/components/MediaCard";
import ProcessingScreen from "@/components/ProcessingScreen";
import ResultsAudio from "@/components/ResultsAudio";
import ResultsVideo from "@/components/ResultsVideo";
import ErrorState from "@/components/ErrorState";
import PrivacyBadge from "@/components/PrivacyBadge";
import { detectMediaKind, baseNameWithoutExtension, formatBytes, LARGE_FILE_WARNING_BYTES } from "@/lib/fileType";
import { probeMediaElement, decodeAudioBuffer } from "@/lib/audioDecode";
import { encodeWav } from "@/lib/wavEncode";
import { runSeparation, SeparationEngineError } from "@/lib/separationEngine";
import { extractAudioFromVideo, muxVideoWithAudio } from "@/lib/ffmpegClient";
import { getModelConfig, isModelConfigured } from "@/lib/modelConfig";
import type {
  AppStage,
  AppError,
  ProcessingState,
  ProcessingStep,
  SelectedMedia,
  SeparationResult,
} from "@/lib/types";

const AUDIO_STEPS: ProcessingStep[] = [
  { id: "load", label: "Loading audio", weight: 0.05 },
  { id: "model", label: "Preparing model", weight: 0.2 },
  { id: "process", label: "Processing audio", weight: 0.1 },
  { id: "separate", label: "Separating vocals", weight: 0.45 },
  { id: "instrumental", label: "Creating instrumental", weight: 0.1 },
  { id: "finalize", label: "Finalizing audio", weight: 0.1 },
];

const VIDEO_STEPS: ProcessingStep[] = [
  { id: "load", label: "Loading video", weight: 0.05 },
  { id: "extract", label: "Extracting audio", weight: 0.1 },
  { id: "model", label: "Preparing model", weight: 0.15 },
  { id: "separate", label: "Separating vocals", weight: 0.35 },
  { id: "instrumental", label: "Creating instrumental audio", weight: 0.05 },
  { id: "combine", label: "Combining audio with video", weight: 0.05 },
  { id: "encode", label: "Encoding MP4", weight: 0.2 },
  { id: "finalize", label: "Finalizing video", weight: 0.05 },
];

export default function HomePage() {
  const [stage, setStage] = useState<AppStage>("landing");
  const [media, setMedia] = useState<SelectedMedia | null>(null);
  const [result, setResult] = useState<SeparationResult | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const [processing, setProcessing] = useState<ProcessingState | null>(null);
  const [largeFileWarning, setLargeFileWarning] = useState<string | null>(null);
  const cancelRef = useRef<(() => void) | null>(null);

  const resetToLanding = useCallback(() => {
    cancelRef.current?.();
    setStage("landing");
    setMedia(null);
    setResult(null);
    setError(null);
    setProcessing(null);
    setLargeFileWarning(null);
  }, []);

  const handleFileSelected = useCallback(async (file: File) => {
    const kind = detectMediaKind(file);
    if (!kind) {
      setError({
        title: "Unsupported file",
        message: "Please choose an MP3, WAV, FLAC, M4A, AAC, OGG, WebM, MP4, or MKV file.",
        recoverable: false,
      });
      setStage("error");
      return;
    }

    setLargeFileWarning(
      file.size > LARGE_FILE_WARNING_BYTES
        ? `This is a large file (${formatBytes(file.size)}). Processing may take a while and use significant memory. Keep this tab open and avoid switching to low-power mode.`
        : null
    );

    const url = URL.createObjectURL(file);
    const meta = await probeMediaElement(file, kind);
    setMedia({ file, kind, url, durationSec: meta.durationSec, width: meta.width, height: meta.height });
    setStage("landing");
  }, []);

  const handleRejected = useCallback((reason: string) => {
    setError({ title: "Can't use this file", message: reason, recoverable: false });
    setStage("error");
  }, []);

  const makeStepUpdater = (steps: ProcessingStep[]) => {
    return (stepId: string, localProgress: number | null) => {
      const stepIndex = steps.findIndex((s) => s.id === stepId);
      if (stepIndex === -1) return;
      let cumulative = 0;
      for (let i = 0; i < stepIndex; i++) cumulative += steps[i]!.weight;
      const overall =
        localProgress == null
          ? null
          : cumulative + steps[stepIndex]!.weight * Math.max(0, Math.min(1, localProgress));
      setProcessing({
        stepIndex,
        steps,
        progress: overall,
        detail: steps[stepIndex]?.label,
      });
    };
  };

  const runAudioPipeline = useCallback(async (file: File) => {
    const update = makeStepUpdater(AUDIO_STEPS);
    update("load", 0);

    const arrayBuffer = await file.arrayBuffer();
    const config = getModelConfig();
    const decoded = await decodeAudioBuffer(arrayBuffer, config.sampleRate);
    update("load", 1);

    update("model", 0);
    const { promise, cancel } = runSeparation(decoded.channels, decoded.sampleRate, (p) => {
      if (p.stage === "downloading-model" || p.stage === "compiling-model" || p.stage === "loading-model") {
        update("model", p.progress);
      } else if (p.stage === "processing") {
        update("separate", p.progress);
      }
    });
    cancelRef.current = cancel;

    const outcome = await promise;
    update("process", 1);
    update("separate", 1);

    update("instrumental", 0.5);
    const vocalsBlob = encodeWav(outcome.vocals, outcome.sampleRate);
    const instrumentalBlob = encodeWav(outcome.instrumental, outcome.sampleRate);
    update("instrumental", 1);

    update("finalize", 0.5);
    const baseName = baseNameWithoutExtension(file.name);
    const audioResult: SeparationResult = {
      kind: "audio",
      vocals: {
        blob: vocalsBlob,
        url: URL.createObjectURL(vocalsBlob),
        durationSec: decoded.durationSec,
        fileName: `${baseName}_vocals.wav`,
      },
      instrumental: {
        blob: instrumentalBlob,
        url: URL.createObjectURL(instrumentalBlob),
        durationSec: decoded.durationSec,
        fileName: `${baseName}_instrumental.wav`,
      },
      sourceFileBaseName: file.name,
    };
    update("finalize", 1);
    return audioResult;
  }, []);

  const runVideoPipeline = useCallback(async (file: File) => {
    const update = makeStepUpdater(VIDEO_STEPS);
    update("load", 1);

    update("extract", 0);
    const extractedWavBytes = await extractAudioFromVideo(file, (ratio) => update("extract", ratio));
    update("extract", 1);

    const config = getModelConfig();
    const decoded = await decodeAudioBuffer(extractedWavBytes.buffer as ArrayBuffer, config.sampleRate);

    update("model", 0);
    const { promise, cancel } = runSeparation(decoded.channels, decoded.sampleRate, (p) => {
      if (p.stage === "downloading-model" || p.stage === "compiling-model" || p.stage === "loading-model") {
        update("model", p.progress);
      } else if (p.stage === "processing") {
        update("separate", p.progress);
      }
    });
    cancelRef.current = cancel;

    const outcome = await promise;
    update("separate", 1);

    update("instrumental", 0.5);
    const instrumentalBlob = encodeWav(outcome.instrumental, outcome.sampleRate);
    const vocalsBlob = encodeWav(outcome.vocals, outcome.sampleRate);
    const instrumentalWavBytes = new Uint8Array(await instrumentalBlob.arrayBuffer());
    update("instrumental", 1);

    update("combine", 0.3);
    update("encode", 0);
    const mp4Bytes = await muxVideoWithAudio(file, instrumentalWavBytes, (ratio) => update("encode", ratio));
    update("combine", 1);
    update("encode", 1);

    update("finalize", 0.5);
    const baseName = baseNameWithoutExtension(file.name);
    const videoBlob = new Blob([mp4Bytes], { type: "video/mp4" });
    const videoResult: SeparationResult = {
      kind: "video",
      video: {
        blob: videoBlob,
        url: URL.createObjectURL(videoBlob),
        durationSec: decoded.durationSec,
        fileName: `${baseName}-vocal-removed.mp4`,
      },
      instrumental: {
        blob: instrumentalBlob,
        url: URL.createObjectURL(instrumentalBlob),
        durationSec: decoded.durationSec,
        fileName: `${baseName}_instrumental.wav`,
      },
      vocals: {
        blob: vocalsBlob,
        url: URL.createObjectURL(vocalsBlob),
        durationSec: decoded.durationSec,
        fileName: `${baseName}_vocals.wav`,
      },
      sourceFileBaseName: file.name,
    };
    update("finalize", 1);
    return videoResult;
  }, []);

  const handleProcess = useCallback(async () => {
    if (!media) return;
    const config = getModelConfig();

    if (!isModelConfigured(config)) {
      setError({
        title: "No separation model configured",
        message:
          "This deployment doesn't have a vocal-separation model configured yet. Set the NEXT_PUBLIC_MODEL_URL environment variable to a compatible ONNX model and redeploy — see the README's 'Bring your own model' section for details.",
        recoverable: false,
      });
      setStage("error");
      return;
    }

    setStage("processing");
    setProcessing({
      stepIndex: 0,
      steps: media.kind === "video" ? VIDEO_STEPS : AUDIO_STEPS,
      progress: 0,
    });

    try {
      const outcome =
        media.kind === "video" ? await runVideoPipeline(media.file) : await runAudioPipeline(media.file);
      setResult(outcome);
      setStage("results");
    } catch (err) {
      setStage("error");
      setError(mapErrorToAppError(err));
    } finally {
      cancelRef.current = null;
    }
  }, [media, runAudioPipeline, runVideoPipeline]);

  const handleRetry = useCallback(() => {
    if (media) {
      setError(null);
      handleProcess();
    } else {
      resetToLanding();
    }
  }, [media, handleProcess, resetToLanding]);

  return (
    <main className="min-h-screen flex flex-col">
      <header className="flex items-center justify-center pt-10 pb-2 px-4">
        <div className="flex items-center gap-2 text-white/80">
          <Sparkles size={18} className="text-accent-400" />
          <span className="font-semibold tracking-tight">Vocal Remover</span>
        </div>
      </header>

      <div className="flex-1 flex items-start justify-center px-4 pb-16">
        <div className="w-full max-w-2xl mt-6 sm:mt-10">
          {stage === "landing" && !media && (
            <div className="flex flex-col items-center text-center gap-6 animate-fade-in">
              <div>
                <h1 className="text-3xl sm:text-4xl font-semibold text-white tracking-tight">
                  Remove vocals from your music and videos with AI.
                </h1>
              </div>
              <UploadArea onFileSelected={handleFileSelected} onRejected={handleRejected} />
              <PrivacyBadge />
            </div>
          )}

          {stage === "landing" && media && (
            <div className="flex flex-col gap-4">
              {largeFileWarning && (
                <div className="rounded-xl border border-amber-500/25 bg-amber-500/10 text-amber-300 text-sm px-4 py-3">
                  {largeFileWarning}
                </div>
              )}
              <MediaCard media={media} onRemove={resetToLanding} onProcess={handleProcess} />
              <PrivacyBadge className="self-center" />
            </div>
          )}

          {stage === "processing" && processing && media && (
            <ProcessingScreen state={processing} fileName={media.file.name} isLocal />
          )}

          {stage === "results" && result?.kind === "audio" && (
            <ResultsAudio result={result} onStartOver={resetToLanding} />
          )}

          {stage === "results" && result?.kind === "video" && (
            <ResultsVideo result={result} onStartOver={resetToLanding} />
          )}

          {stage === "error" && error && (
            <ErrorState error={error} onRetry={handleRetry} onChooseAnother={resetToLanding} />
          )}
        </div>
      </div>

      <footer className="text-center text-xs text-white/25 pb-8 px-4">
        Works entirely in your browser — no uploads, no accounts, no waiting in a queue.
      </footer>
    </main>
  );
}

function mapErrorToAppError(err: unknown): AppError {
  if (err instanceof SeparationEngineError) {
    switch (err.code) {
      case "model-not-configured":
        return {
          title: "No separation model configured",
          message: err.message,
          recoverable: false,
        };
      case "no-webgpu-no-wasm":
        return {
          title: "Your browser can't run the separation model",
          message:
            "This browser doesn't support the WebAssembly features required for AI inference. Try the latest version of Chrome, Edge, or Firefox.",
          recoverable: false,
        };
      case "model-download-failed":
        return {
          title: "Couldn't download the separation model",
          message: "Check your internet connection and try again. The model only needs to download once.",
          recoverable: true,
        };
      case "out-of-memory":
        return {
          title: "Ran out of memory",
          message:
            "Your device ran out of memory while processing this file. Try a shorter clip, close other tabs, or use a device with more RAM.",
          recoverable: true,
        };
      default:
        return {
          title: "Separation failed",
          message: err.message || "Something went wrong while separating the audio. Please try again.",
          recoverable: true,
        };
    }
  }

  if (err instanceof DOMException && err.name === "EncodingError") {
    return {
      title: "Couldn't decode this file",
      message: "The audio or video track appears to be corrupted or uses an unsupported codec.",
      recoverable: false,
    };
  }

  const message = err instanceof Error ? err.message : "An unexpected error occurred.";
  return { title: "Something went wrong", message, recoverable: true };
}
