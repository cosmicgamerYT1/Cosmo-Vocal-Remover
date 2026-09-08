"use client";

import { useEffect, useState } from "react";
import { Download, RotateCcw } from "lucide-react";
import AudioPlayer from "./AudioPlayer";
import { downloadBlob, downloadMultiple } from "@/lib/download";
import { computePeaks } from "@/lib/waveformPeaks";
import type { SeparationResultAudio } from "@/lib/types";
import type { WaveformPeaks } from "@/lib/waveformPeaks";

interface ResultsAudioProps {
  result: SeparationResultAudio;
  onStartOver: () => void;
}

export default function ResultsAudio({ result, onStartOver }: ResultsAudioProps) {
  const [vocalPeaks, setVocalPeaks] = useState<WaveformPeaks | null>(null);
  const [instPeaks, setInstPeaks] = useState<WaveformPeaks | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
      try {
        const [vocalBuf, instBuf] = await Promise.all([
          result.vocals.blob.arrayBuffer().then((b) => ctx.decodeAudioData(b)),
          result.instrumental.blob.arrayBuffer().then((b) => ctx.decodeAudioData(b)),
        ]);
        if (!cancelled) {
          setVocalPeaks(computePeaks(vocalBuf.getChannelData(0), 200));
          setInstPeaks(computePeaks(instBuf.getChannelData(0), 200));
        }
      } finally {
        ctx.close().catch(() => {});
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [result]);

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

      <div className="grid sm:grid-cols-2 gap-5">
        <AudioPlayer
          title="Vocals"
          subtitle={result.vocals.fileName}
          src={result.vocals.url}
          peaks={vocalPeaks}
          onDownload={() => downloadBlob(result.vocals.blob, result.vocals.fileName)}
        />
        <AudioPlayer
          title="Instrumental"
          subtitle={result.instrumental.fileName}
          src={result.instrumental.url}
          peaks={instPeaks}
          onDownload={() => downloadBlob(result.instrumental.blob, result.instrumental.fileName)}
        />
      </div>

      <div className="flex flex-wrap gap-3">
        <button
          onClick={() => downloadBlob(result.vocals.blob, result.vocals.fileName)}
          className="focus-ring inline-flex items-center gap-2 rounded-xl border border-white/15 hover:bg-white/5 text-white text-sm font-medium px-4 py-2.5 transition-colors"
        >
          <Download size={15} />
          Download Vocals
        </button>
        <button
          onClick={() => downloadBlob(result.instrumental.blob, result.instrumental.fileName)}
          className="focus-ring inline-flex items-center gap-2 rounded-xl border border-white/15 hover:bg-white/5 text-white text-sm font-medium px-4 py-2.5 transition-colors"
        >
          <Download size={15} />
          Download Instrumental
        </button>
        <button
          onClick={() =>
            downloadMultiple([
              { blob: result.vocals.blob, fileName: result.vocals.fileName },
              { blob: result.instrumental.blob, fileName: result.instrumental.fileName },
            ])
          }
          className="focus-ring inline-flex items-center gap-2 rounded-xl bg-accent-500 hover:bg-accent-400 text-surface-950 text-sm font-semibold px-4 py-2.5 transition-colors ml-auto"
        >
          <Download size={15} />
          Download Both
        </button>
      </div>
    </div>
  );
}
