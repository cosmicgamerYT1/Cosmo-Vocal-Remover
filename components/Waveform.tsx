"use client";

import { useMemo } from "react";
import type { WaveformPeaks } from "@/lib/waveformPeaks";

interface WaveformProps {
  peaks: WaveformPeaks | null;
  progress?: number; // 0-1, portion of the waveform to render as "played"
  height?: number;
  color?: string;
  playedColor?: string;
}

export default function Waveform({
  peaks,
  progress = 0,
  height = 56,
  color = "#2b3542",
  playedColor = "#45c47f",
}: WaveformProps) {
  const bars = useMemo(() => {
    if (!peaks) return [];
    const n = peaks.min.length;
    const out: { x: number; h: number }[] = [];
    for (let i = 0; i < n; i++) {
      const amp = Math.max(Math.abs(peaks.min[i]!), Math.abs(peaks.max[i]!));
      out.push({ x: i, h: Math.max(0.03, amp) });
    }
    return out;
  }, [peaks]);

  if (!peaks || bars.length === 0) {
    return (
      <div
        className="w-full rounded-md shimmer-bg"
        style={{ height }}
        role="img"
        aria-label="Waveform loading"
      />
    );
  }

  const n = bars.length;
  const playedIndex = Math.floor(progress * n);
  const barWidth = 100 / n;

  return (
    <svg
      viewBox={`0 0 100 ${height}`}
      preserveAspectRatio="none"
      className="w-full"
      style={{ height }}
      role="img"
      aria-label="Audio waveform"
    >
      {bars.map((bar, i) => {
        const barHeight = bar.h * height;
        const y = (height - barHeight) / 2;
        return (
          <rect
            key={i}
            x={bar.x * barWidth}
            y={y}
            width={Math.max(0.4, barWidth - 0.3)}
            height={Math.max(1, barHeight)}
            rx={0.6}
            fill={i <= playedIndex ? playedColor : color}
          />
        );
      })}
    </svg>
  );
}
