"use client";

import { useEffect, useRef, useState } from "react";
import { Play, Pause, Volume2, VolumeX, Maximize, PictureInPicture2 } from "lucide-react";
import { formatDuration } from "@/lib/fileType";

interface VideoPlayerProps {
  src: string;
}

export default function VideoPlayer({ src }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [pipSupported, setPipSupported] = useState(false);

  useEffect(() => {
    setPipSupported(typeof document !== "undefined" && "pictureInPictureEnabled" in document);
  }, []);

  useEffect(() => {
    const el = videoRef.current;
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
    const el = videoRef.current;
    if (!el) return;
    el.volume = volume;
    el.muted = muted;
  }, [volume, muted]);

  const togglePlay = () => {
    const el = videoRef.current;
    if (!el) return;
    if (isPlaying) el.pause();
    else el.play().catch(() => {});
    setIsPlaying(!isPlaying);
  };

  const seekTo = (fraction: number) => {
    const el = videoRef.current;
    if (!el || !duration) return;
    el.currentTime = fraction * duration;
    setCurrentTime(el.currentTime);
  };

  const toggleFullscreen = () => {
    const container = containerRef.current;
    if (!container) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      container.requestFullscreen().catch(() => {});
    }
  };

  const togglePip = async () => {
    const el = videoRef.current;
    if (!el) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else {
        await el.requestPictureInPicture();
      }
    } catch {
      // PiP can fail silently on unsupported browsers; the button is hidden when unsupported.
    }
  };

  const progress = duration > 0 ? currentTime / duration : 0;

  return (
    <div ref={containerRef} className="glass rounded-2xl overflow-hidden">
      <div className="relative bg-black aspect-video">
        <video
          ref={videoRef}
          src={src}
          className="w-full h-full"
          onClick={togglePlay}
          playsInline
        />
        {!isPlaying && (
          <button
            onClick={togglePlay}
            className="focus-ring absolute inset-0 flex items-center justify-center bg-black/20 hover:bg-black/30 transition-colors"
            aria-label="Play"
          >
            <span className="flex items-center justify-center w-16 h-16 rounded-full bg-white/90 text-surface-950">
              <Play size={26} fill="currentColor" className="ml-1" />
            </span>
          </button>
        )}
      </div>

      <div className="p-4 flex flex-col gap-3">
        <input
          type="range"
          min={0}
          max={1}
          step={0.001}
          value={progress || 0}
          onChange={(e) => seekTo(Number(e.target.value))}
          className="w-full"
          aria-label="Playback position"
        />

        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={togglePlay}
            className="focus-ring flex items-center justify-center w-9 h-9 rounded-full bg-accent-500 hover:bg-accent-400 text-surface-950 transition-colors shrink-0"
            aria-label={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" className="ml-0.5" />}
          </button>

          <span className="text-xs text-white/50 tabular-nums shrink-0">
            {formatDuration(currentTime)} / {formatDuration(duration)}
          </span>

          <div className="flex items-center gap-2 ml-2">
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
              }}
              className="w-20"
              aria-label="Volume"
            />
          </div>

          <div className="flex items-center gap-1 ml-auto">
            {pipSupported && (
              <button
                onClick={togglePip}
                className="focus-ring text-white/60 hover:text-white transition-colors p-1.5"
                aria-label="Picture in picture"
              >
                <PictureInPicture2 size={16} />
              </button>
            )}
            <button
              onClick={toggleFullscreen}
              className="focus-ring text-white/60 hover:text-white transition-colors p-1.5"
              aria-label="Fullscreen"
            >
              <Maximize size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
