import { useState, useRef, useEffect, useCallback } from 'react';
import { Play, Pause, Volume2, VolumeX, RotateCcw, RotateCw, Gauge } from 'lucide-react';

interface AudioPlayerProps {
  src: string;
  onDuration?: (d: number) => void;
  seekTo?: { time: number; nonce: number } | null;
}

const SPEEDS = [0.75, 1, 1.25, 1.5];

function fmt(t: number): string {
  if (!isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function AudioPlayer({ src, onDuration, seekTo }: AudioPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [error, setError] = useState(false);

  const toggle = useCallback(() => {
    const a = audioRef.current;
    if (!a) return;
    if (a.paused) { a.play().catch(() => setError(true)); }
    else a.pause();
  }, []);

  const skip = useCallback((delta: number) => {
    const a = audioRef.current;
    if (!a) return;
    a.currentTime = Math.min(Math.max(0, a.currentTime + delta), a.duration || 0);
  }, []);

  const changeSpeed = useCallback(() => {
    const idx = SPEEDS.indexOf(speed);
    const next = SPEEDS[(idx + 1) % SPEEDS.length];
    setSpeed(next);
    if (audioRef.current) audioRef.current.playbackRate = next;
  }, [speed]);

  useEffect(() => {
    const a = audioRef.current;
    if (!a || !seekTo) return;
    a.currentTime = Math.min(seekTo.time, a.duration || seekTo.time);
    a.play().catch(() => setError(true));
  }, [seekTo]);

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          if (isFinite(d)) { setDuration(d); onDuration?.(d); }
        }}
        onError={() => setError(true)}
      />
      {error && (
        <p className="mb-2 text-xs font-medium text-red-500">Không tải được audio. Kiểm tra file/URL.</p>
      )}
      <input
        type="range"
        min={0}
        max={duration || 0}
        step={0.1}
        value={current}
        onChange={(e) => { const a = audioRef.current; if (a) a.currentTime = Number(e.target.value); }}
        className="mb-2 h-2 w-full cursor-pointer accent-blue-600"
        aria-label="Tiến trình audio"
      />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <button
            onClick={toggle}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-blue-600 text-white shadow-md transition-all hover:bg-blue-700 active:scale-95"
            aria-label={playing ? 'Tạm dừng' : 'Phát'}
          >
            {playing ? <Pause size={20} /> : <Play size={20} className="ml-0.5" />}
          </button>
          <button onClick={() => skip(-5)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Lùi 5 giây">
            <RotateCcw size={18} />
          </button>
          <button onClick={() => skip(5)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" aria-label="Tới 5 giây">
            <RotateCw size={18} />
          </button>
          <span className="ml-1 text-xs font-medium tabular-nums text-slate-600">
            {fmt(current)} / {fmt(duration)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={changeSpeed} className="flex items-center gap-1 rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-bold text-slate-700 hover:bg-slate-200" aria-label="Đổi tốc độ">
            <Gauge size={14} /> {speed}x
          </button>
          <button
            onClick={() => { setMuted((m) => !m); if (audioRef.current) audioRef.current.muted = !muted; }}
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
            aria-label={muted ? 'Bật âm lượng' : 'Tắt âm lượng'}
          >
            {muted || volume === 0 ? <VolumeX size={18} /> : <Volume2 size={18} />}
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={muted ? 0 : volume}
            onChange={(e) => {
              const v = Number(e.target.value);
              setVolume(v); setMuted(v === 0);
              if (audioRef.current) { audioRef.current.volume = v; audioRef.current.muted = v === 0; }
            }}
            className="hidden h-1.5 w-20 cursor-pointer accent-blue-600 sm:block"
            aria-label="Âm lượng"
          />
        </div>
      </div>
    </div>
  );
}
