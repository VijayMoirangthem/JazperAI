"use client";
import { useEffect, useRef } from "react";
import { Pause, Play, Repeat, Shuffle, SkipBack, SkipForward, Volume2, X } from "lucide-react";
import { useMediaPlayer } from "@/stores/mediaPlayerStore";

export function MiniPlayer() {
  const audio = useRef<HTMLAudioElement>(null); const { track, queue, playing, volume, repeat, shuffle, setPlaying, setVolume, clear, next, previous, cycleRepeat, toggleShuffle } = useMediaPlayer();
  useEffect(() => { const el = audio.current; if (!el) return; el.volume = volume; if (playing && track) void el.play().catch(() => setPlaying(false)); else el.pause(); }, [playing, track, volume, setPlaying]);
  useEffect(() => {
    if (!track || !("mediaSession" in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({ title: track.title, artist: track.artist || "Jazper Files", album: track.album, artwork: track.artwork ? [{ src: track.artwork }] : undefined });
    navigator.mediaSession.setActionHandler("play", () => setPlaying(true));
    navigator.mediaSession.setActionHandler("pause", () => setPlaying(false));
    navigator.mediaSession.setActionHandler("previoustrack", previous);
    navigator.mediaSession.setActionHandler("nexttrack", next);
    navigator.mediaSession.setActionHandler("seekbackward", () => { if (audio.current) audio.current.currentTime = Math.max(0, audio.current.currentTime - 10); });
    navigator.mediaSession.setActionHandler("seekforward", () => { if (audio.current) audio.current.currentTime += 10; });
    return () => { for (const action of ["play", "pause", "previoustrack", "nexttrack", "seekbackward", "seekforward"] as MediaSessionAction[]) navigator.mediaSession.setActionHandler(action, null); };
  }, [next, previous, setPlaying, track]);
  if (!track) return null;
  return <div className="fixed bottom-3 left-1/2 z-50 flex w-[min(680px,calc(100vw-32px))] -translate-x-1/2 items-center gap-3 rounded-2xl border border-white/15 bg-[#111827]/95 px-4 py-2 shadow-2xl backdrop-blur"><audio ref={audio} src={track.src} onEnded={next} /><button aria-label="Previous" onClick={previous}><SkipBack size={16} /></button><button onClick={() => setPlaying(!playing)} aria-label={playing ? "Pause" : "Play"}>{playing ? <Pause size={17} /> : <Play size={17} />}</button><button aria-label="Next" onClick={next}><SkipForward size={16} /></button><button aria-label={`Shuffle ${shuffle ? "on" : "off"}`} className={shuffle ? "text-indigo-300" : "opacity-60"} onClick={toggleShuffle}><Shuffle size={15} /></button><button aria-label={`Repeat ${repeat}`} className={repeat !== "off" ? "text-indigo-300" : "opacity-60"} onClick={cycleRepeat}><Repeat size={15} /><sup>{repeat === "one" ? "1" : ""}</sup></button><span className="min-w-0 flex-1 truncate text-sm">{track.title}<span className="ml-1 text-xs opacity-50">({queue.length})</span></span><Volume2 size={15} /><input aria-label="Volume" type="range" min="0" max="1" step="0.05" value={volume} onChange={e => setVolume(Number(e.target.value))} className="w-20" /><button aria-label="Close player" onClick={clear}><X size={15} /></button></div>;
}
