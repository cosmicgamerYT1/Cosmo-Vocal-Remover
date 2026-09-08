"use client";

import { FileAudio2, FileVideo2, X, Wand2 } from "lucide-react";
import { formatBytes, formatDuration } from "@/lib/fileType";
import type { SelectedMedia } from "@/lib/types";

interface MediaCardProps {
  media: SelectedMedia;
  onRemove: () => void;
  onProcess: () => void;
}

export default function MediaCard({ media, onRemove, onProcess }: MediaCardProps) {
  const { file, kind, url, durationSec, width, height } = media;
  const ext = file.name.split(".").pop()?.toUpperCase() ?? "";

  return (
    <div className="glass rounded-2xl p-5 animate-fade-in">
      <div className="flex items-start gap-4">
        <div className="shrink-0">
          {kind === "video" ? (
            <div className="w-28 h-20 rounded-lg overflow-hidden bg-black/40 flex items-center justify-center">
              <video src={url} className="w-full h-full object-cover" muted preload="metadata" />
            </div>
          ) : (
            <div className="w-20 h-20 rounded-lg bg-accent-500/10 flex items-center justify-center text-accent-400">
              <FileAudio2 size={28} />
            </div>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <p className="font-medium text-white truncate">{file.name}</p>
            <button
              onClick={onRemove}
              className="focus-ring shrink-0 text-white/40 hover:text-white/80 transition-colors p-1"
              aria-label="Remove file"
            >
              <X size={18} />
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mt-2 text-xs text-white/50">
            <span className="inline-flex items-center gap-1">
              {kind === "video" ? <FileVideo2 size={13} /> : <FileAudio2 size={13} />}
              {ext} · {kind === "video" ? "Video" : "Audio"}
            </span>
            <span>{formatDuration(durationSec)}</span>
            <span>{formatBytes(file.size)}</span>
            {kind === "video" && width && height && (
              <span>
                {width}×{height}
              </span>
            )}
          </div>
        </div>
      </div>

      <button
        onClick={onProcess}
        className="focus-ring mt-5 w-full flex items-center justify-center gap-2 rounded-xl bg-accent-500 hover:bg-accent-400 text-surface-950 font-semibold py-3.5 transition-colors"
      >
        <Wand2 size={18} />
        Remove Vocals
      </button>
    </div>
  );
}
