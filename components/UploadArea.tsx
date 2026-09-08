"use client";

import { useCallback, useRef, useState } from "react";
import { UploadCloud } from "lucide-react";
import { ACCEPT_ATTRIBUTE, isSupportedFile, MAX_FILE_SIZE_BYTES, formatBytes } from "@/lib/fileType";

interface UploadAreaProps {
  onFileSelected: (file: File) => void;
  onRejected: (reason: string) => void;
}

export default function UploadArea({ onFileSelected, onRejected }: UploadAreaProps) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const dragCounter = useRef(0);

  const handleFiles = useCallback(
    (files: FileList | null) => {
      const file = files?.[0];
      if (!file) return;
      if (!isSupportedFile(file)) {
        onRejected(
          "That file type isn't supported. Please choose an MP3, WAV, FLAC, M4A, AAC, OGG, WebM, MP4, or MKV file."
        );
        return;
      }
      if (file.size > MAX_FILE_SIZE_BYTES) {
        onRejected(`That file is too large (${formatBytes(file.size)}). The maximum supported size is ${formatBytes(MAX_FILE_SIZE_BYTES)}.`);
        return;
      }
      onFileSelected(file);
    },
    [onFileSelected, onRejected]
  );

  return (
    <div
      className={`relative rounded-3xl border-2 border-dashed transition-all duration-200 ${
        isDragging
          ? "border-accent-400 bg-accent-500/5 scale-[1.01]"
          : "border-white/10 hover:border-white/20 bg-white/[0.02]"
      }`}
      onDragEnter={(e) => {
        e.preventDefault();
        dragCounter.current++;
        setIsDragging(true);
      }}
      onDragLeave={(e) => {
        e.preventDefault();
        dragCounter.current--;
        if (dragCounter.current <= 0) setIsDragging(false);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        dragCounter.current = 0;
        setIsDragging(false);
        handleFiles(e.dataTransfer.files);
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT_ATTRIBUTE}
        className="sr-only"
        onChange={(e) => handleFiles(e.target.files)}
        aria-label="Choose an audio or video file"
      />

      <div className="flex flex-col items-center justify-center gap-4 px-6 py-16 sm:py-20 text-center">
        <div className="relative">
          <div className="absolute inset-0 rounded-full bg-accent-500/20 animate-pulse-ring" />
          <div className="relative flex items-center justify-center w-16 h-16 rounded-full bg-accent-500/10 text-accent-400">
            <UploadCloud size={28} />
          </div>
        </div>

        <div>
          <p className="text-lg sm:text-xl font-medium text-white">Drop your audio or video here</p>
          <p className="text-white/40 text-sm mt-1">or</p>
        </div>

        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="focus-ring rounded-xl bg-accent-500 hover:bg-accent-400 text-surface-950 font-medium px-6 py-3 transition-colors"
        >
          Choose a file
        </button>

        <p className="text-xs text-white/35 max-w-sm">
          Supported: MP3, WAV, FLAC, M4A, AAC, OGG, WebM, MP4, MKV
        </p>
      </div>
    </div>
  );
}
