import { Check, Loader2, Cpu } from "lucide-react";
import type { ProcessingState } from "@/lib/types";

interface ProcessingScreenProps {
  state: ProcessingState;
  fileName: string;
  isLocal: boolean;
}

export default function ProcessingScreen({ state, fileName, isLocal }: ProcessingScreenProps) {
  const { steps, stepIndex, progress } = state;
  const overallPercent =
    progress != null ? Math.round(Math.max(0, Math.min(1, progress)) * 100) : null;

  return (
    <div className="glass rounded-2xl p-8 animate-fade-in">
      <div className="flex flex-col items-center text-center gap-3 mb-8">
        <div className="relative flex items-center justify-center w-16 h-16">
          <div className="absolute inset-0 rounded-full bg-accent-500/15 animate-pulse-ring" />
          <div className="relative flex items-center justify-center w-14 h-14 rounded-full bg-accent-500/10 text-accent-400">
            <Loader2 size={26} className="animate-spin" />
          </div>
        </div>
        <div>
          <h3 className="text-lg font-semibold text-white truncate max-w-xs">{fileName}</h3>
          <p className="text-white/45 text-sm mt-1">
            {state.detail ?? steps[stepIndex]?.label ?? "Processing…"}
          </p>
        </div>
        {isLocal && (
          <span className="inline-flex items-center gap-1.5 text-xs text-accent-400 bg-accent-500/10 rounded-full px-3 py-1">
            <Cpu size={12} />
            Processing locally in your browser
          </span>
        )}
      </div>

      <div className="mb-6">
        <div className="h-2 rounded-full bg-white/[0.06] overflow-hidden">
          {overallPercent != null ? (
            <div
              className="h-full bg-accent-500 rounded-full transition-all duration-300 ease-out"
              style={{ width: `${overallPercent}%` }}
            />
          ) : (
            <div className="h-full w-1/3 bg-accent-500 rounded-full shimmer-bg animate-[shimmer_1.6s_linear_infinite]" />
          )}
        </div>
        <div className="flex justify-between mt-2 text-xs text-white/40">
          <span>{overallPercent != null ? `${overallPercent}% complete` : "Working…"}</span>
          <span>
            Step {Math.min(stepIndex + 1, steps.length)} of {steps.length}
          </span>
        </div>
      </div>

      <ol className="flex flex-col gap-2.5" aria-label="Processing steps">
        {steps.map((step, i) => {
          const status = i < stepIndex ? "done" : i === stepIndex ? "active" : "pending";
          return (
            <li key={step.id} className="flex items-center gap-3">
              <span
                className={`flex items-center justify-center w-6 h-6 rounded-full text-xs shrink-0 transition-colors ${
                  status === "done"
                    ? "bg-accent-500 text-surface-950"
                    : status === "active"
                    ? "bg-accent-500/20 text-accent-400 border border-accent-500/40"
                    : "bg-white/5 text-white/30 border border-white/10"
                }`}
              >
                {status === "done" ? <Check size={13} /> : i + 1}
              </span>
              <span
                className={`text-sm transition-colors ${
                  status === "pending" ? "text-white/35" : "text-white/85"
                }`}
              >
                {step.label}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
