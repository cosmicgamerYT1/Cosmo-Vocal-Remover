"use client";

import { useEffect, useRef, useState } from "react";
import { Play, Pause, Volume2, VolumeX, Download } from "lucide-react";
import Waveform from "./Waveform";
import { formatDuration } from "@/lib/fileType";
import type { WaveformPeaks } from "@/lib/waveformPeaks";

interface AudioPlayerProps {
  title: string;
  subtitle?: string;
  src: string;
  peaks: WaveformPeaks | null;
  accentClassName?: string;
  onDownload: () => void;
}

const SPEEDS = [0.75, 1, 1.25, 1.5, 2];

export default function AudioPlayer({ title, subtitle, src, peaks, onDownload }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState(1);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    const onTime = () => setCurrentTime(el.currentTime);
    const onLoaded = () => setDuration(el.duration || 0);
    const onEnd = () => setIsPlaying(false);
    el.addEventListener("timeupdate", onTime);
    el.addEventListener("loadedmetadata", onLoaded);
    el.addEventListener("ended", onEnd);
    return () => {
      el.removeEventListener("timeupdate", onTime);
      el.removeEventListener("loadedmetadata", onLoaded);
      el.removeEventListener("ended", onEnd);
    };
  }, []);

  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    el.volume = volume;
    el.muted = muted;
  }, [volume, muted]);

  const togglePlay = () => {
    const el = audioRef.current;
    if (!el) return;
    if (isPlaying) {
      el.pause();
    } else {
      el.play().catch(() => {});
    }
    setIsPlaying(!isPlaying);
  };

  const seekTo = (fraction: number) => {
    const el = audioRef.current;
    if (!el || !duration) return;
    el.currentTime = fraction * duration;
    setCurrentTime(el.currentTime);
  };

  const progress = duration > 0 ? currentTime / duration : 0;

  return (
    <div className="glass rounded-2xl p-5 flex flex-col gap-4">
      <audio ref={audioRef} src={src} preload="metadata" />

      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold text-white">{title}</h4>
          {subtitle && <p className="text-xs text-white/50 mt-0.5">{subtitle}</p>}
        </div>
        <button
          onClick={onDownload}
          className="focus-ring flex items-center gap-1.5 rounded-lg bg-accent-500/10 hover:bg-accent-500/20 text-accent-400 text-xs font-medium px-3 py-1.5 transition-colors"
          aria-label={`Download ${title}`}
        >
          <Download size={14} />
          Download
        </button>
      </div>

      <button
        type="button"
        className="focus-ring w-full cursor-pointer"
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          seekTo((e.clientX - rect.left) / rect.width);
        }}
        aria-label="Seek"
      >
        <Waveform peaks={peaks} progress={progress} height={48} />
      </button>

      <div className="flex items-center gap-3">
        <button
          onClick={togglePlay}
          className="focus-ring flex items-center justify-center w-10 h-10 rounded-full bg-accent-500 hover:bg-accent-400 text-surface-950 transition-colors shrink-0"
          aria-label={isPlaying ? "Pause" : "Play"}
        >
          {isPlaying ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" className="ml-0.5" />}
        </button>

        <input
          type="range"
          min={0}
          max={1}
          step={0.001}
          value={progress || 0}
          onChange={(e) => seekTo(Number(e.target.value))}
          className="flex-1"
          aria-label="Playback position"
        />

        <span className="text-xs text-white/50 tabular-nums w-20 text-right shrink-0">
          {formatDuration(currentTime)} / {formatDuration(duration)}
        </span>
      </div>

      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2 min-w-[120px]">
          <button
            onClick={() => setMuted((m) => !m)}
            className="focus-ring text-white/60 hover:text-white transition-colors"
            aria-label={muted ? "Unmute" : "Mute"}
          >
            {muted || volume === 0 ? <VolumeX size={16} /> : <Volume2 size={16} />}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={muted ? 0 : volume}
            onChange={(e) => {
              const v = Number(e.target.value);
              setVolume(v);
              setMuted(v === 0);
              if (audioRef.current) audioRef.current.volume = v;
            }}
            className="w-24"
            aria-label="Volume"
          />
        </div>

        <div className="flex items-center gap-1 ml-auto" role="group" aria-label="Playback speed">
          {SPEEDS.map((s) => (
            <button
              key={s}
              onClick={() => {
                setSpeed(s);
                if (audioRef.current) audioRef.current.playbackRate = s;
              }}
              className={`focus-ring text-xs px-2 py-1 rounded-md transition-colors ${
                speed === s ? "bg-white/10 text-white" : "text-white/40 hover:text-white/70"
              }`}
              aria-pressed={speed === s}
            >
              {s}×
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
