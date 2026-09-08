import { AlertTriangle, RotateCcw, FileUp } from "lucide-react";
import type { AppError } from "@/lib/types";

interface ErrorStateProps {
  error: AppError;
  onRetry: () => void;
  onChooseAnother: () => void;
}

export default function ErrorState({ error, onRetry, onChooseAnother }: ErrorStateProps) {
  return (
    <div className="glass rounded-2xl p-8 flex flex-col items-center text-center gap-4 animate-fade-in">
      <div className="flex items-center justify-center w-14 h-14 rounded-full bg-red-500/10 text-red-400">
        <AlertTriangle size={26} />
      </div>
      <div>
        <h3 className="text-lg font-semibold text-white">{error.title}</h3>
        <p className="text-white/50 text-sm mt-2 max-w-md">{error.message}</p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-3 mt-2">
        {error.recoverable && (
          <button
            onClick={onRetry}
            className="focus-ring inline-flex items-center gap-2 rounded-xl bg-accent-500 hover:bg-accent-400 text-surface-950 font-medium px-5 py-2.5 transition-colors"
          >
            <RotateCcw size={16} />
            Try again
          </button>
        )}
        <button
          onClick={onChooseAnother}
          className="focus-ring inline-flex items-center gap-2 rounded-xl border border-white/15 hover:bg-white/5 text-white font-medium px-5 py-2.5 transition-colors"
        >
          <FileUp size={16} />
          Choose another file
        </button>
      </div>
    </div>
  );
}
