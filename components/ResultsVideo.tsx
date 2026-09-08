"use client";

import { Download, RotateCcw } from "lucide-react";
import VideoPlayer from "./VideoPlayer";
import { downloadBlob } from "@/lib/download";
import type { SeparationResultVideo } from "@/lib/types";

interface ResultsVideoProps {
  result: SeparationResultVideo;
  onStartOver: () => void;
}

export default function ResultsVideo({ result, onStartOver }: ResultsVideoProps) {
  return (
    <div className="flex flex-col gap-5 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-semibold text-white">Separation complete</h2>
          <p className="text-white/45 text-sm mt-0.5">{result.sourceFileBaseName}</p>
        </div>
        <button
          onClick={onStartOver}
          className="focus-ring inline-flex items-center gap-2 text-sm text-white/60 hover:text-white transition-colors"
        >
          <RotateCcw size={15} />
          Start over
        </button>
      </div>

      <VideoPlayer src={result.video.url} />

      <div className="flex flex-wrap gap-3">
        <button
          onClick={() => downloadBlob(result.video.blob, result.video.fileName)}
          className="focus-ring inline-flex items-center gap-2 rounded-xl bg-accent-500 hover:bg-accent-400 text-surface-950 text-sm font-semibold px-4 py-2.5 transition-colors"
        >
          <Download size={15} />
          Download Vocal-Removed Video
        </button>
        {result.instrumental && (
          <button
            onClick={() => downloadBlob(result.instrumental!.blob, result.instrumental!.fileName)}
            className="focus-ring inline-flex items-center gap-2 rounded-xl border border-white/15 hover:bg-white/5 text-white text-sm font-medium px-4 py-2.5 transition-colors"
          >
            <Download size={15} />
            Download Instrumental Audio
          </button>
        )}
        {result.vocals && (
          <button
            onClick={() => downloadBlob(result.vocals!.blob, result.vocals!.fileName)}
            className="focus-ring inline-flex items-center gap-2 rounded-xl border border-white/15 hover:bg-white/5 text-white text-sm font-medium px-4 py-2.5 transition-colors"
          >
            <Download size={15} />
            Download Vocals
          </button>
        )}
      </div>
    </div>
  );
}
