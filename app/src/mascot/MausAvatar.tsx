// Ported from Project_References/OpenMausBot (src/components/Avatar.tsx, src/lib/mascot.ts) - see NOTICE.
import { memo, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { create } from "zustand";
import { CursorAvatar, type CursorAvatarHandle, type CursorState } from "./CursorAvatar";
import { MASCOT_BODIES, MASCOT_BODY_IDS, botMascotBody, type MascotBodyId } from "./mascot-bodies";
import "./mascot.css";

export type MausState = CursorState;
export { MASCOT_BODY_IDS, type MascotBodyId };

export const MAUS_COLORS = {
  green: "#009957", blue: "#377FE6", red: "#D94B52", orange: "#E78531", purple: "#8057C8",
  cyan: "#0EA5C6", pink: "#D84F8B", yellow: "#D8A729", teal: "#01A492", coral: "#E5634E",
} as const;
export type MausColor = keyof typeof MAUS_COLORS;
export const MAUS_COLOR_NAMES = Object.keys(MAUS_COLORS) as MausColor[];

export type MausMotion = "none" | "arrive" | "switch" | "customize" | "alert" | "success" | "celebrate" | "blink" | "surprise" | "failure";
const MOTION_FACE: Record<Exclude<MausMotion, "none">, { state?: MausState; blink?: boolean; spin?: number }> = {
  arrive: { state: "spawning", spin: 900 }, switch: { state: "waking", spin: 620 }, customize: { state: "proud", blink: true },
  alert: { state: "alerting" }, success: { state: "happy", blink: true }, celebrate: { state: "celebrate", spin: 700 },
  blink: { blink: true }, surprise: { state: "surprised", blink: true }, failure: { state: "sad" },
};

function mix(hex: string, toward: string, t: number): string {
  const a = Number.parseInt(hex.slice(1), 16), b = Number.parseInt(toward.slice(1), 16);
  const ch = (sh: number) => Math.round(((a >> sh) & 255) + (((b >> sh) & 255) - ((a >> sh) & 255)) * t);
  return "#" + [ch(16), ch(8), ch(0)].map((p) => p.toString(16).padStart(2, "0")).join("");
}
const gradientFor = (c: MausColor): [string, string, string] => { const f = MAUS_COLORS[c] ?? MAUS_COLORS.green; return [mix(f, "#ffffff", 0.55), f, mix(f, "#000000", 0.42)]; };

export interface MausAvatarProps {
  color: MausColor; state?: MausState; size?: number; label?: string; motion?: MausMotion; motionKey?: number;
  bodyId?: MascotBodyId; animated?: boolean; trackPointer?: boolean;
}

export const MausAvatar = memo(function MausAvatar({ color, state = "idle", size = 40, label, motion = "none", motionKey = 0, bodyId, animated = true, trackPointer = true }: MausAvatarProps) {
  const inner = useRef<CursorAvatarHandle>(null);
  const [motionState, setMotionState] = useState<MausState | null>(null);
  useEffect(() => {
    if (motion === "none" || !animated) return;
    const beat = MOTION_FACE[motion];
    if (beat.blink) inner.current?.blink();
    if (beat.spin) inner.current?.spin(beat.spin);
    if (!beat.state) return;
    setMotionState(beat.state);
    const t = setTimeout(() => setMotionState(null), 1400);
    return () => clearTimeout(t);
  }, [motion, motionKey, animated]);
  const [pointer, setPointer] = useState({ x: 0, y: 0 });
  const onMove = (e: ReactPointerEvent<HTMLSpanElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setPointer({ x: Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width) * 2 - 1)), y: Math.max(-1, Math.min(1, ((e.clientY - r.top) / r.height) * 2 - 1)) });
  };
  return (
    <span className="inline-flex shrink-0" onPointerMove={trackPointer && animated ? onMove : undefined} onPointerLeave={() => setPointer({ x: 0, y: 0 })}>
      <CursorAvatar ref={inner} state={motionState ?? state} size={size} silhouette={MASCOT_BODIES[botMascotBody(bodyId)]}
        gradient={gradientFor(color)} title={label ?? null} lookAround={0} gaze={pointer} paused={!animated} />
    </span>
  );
});

// ── per-bot look (colour + body), customisable from the chat header, saved locally ──
export interface BotLook { color: MausColor; body: MascotBodyId; name?: string }
const KEY = "jasper.botLook.v1";
const DEFAULTS: Record<string, BotLook> = { jasper: { color: "blue", body: "cursor" } };
const FALLBACK_COLORS: MausColor[] = ["green", "orange", "purple", "cyan", "pink", "teal", "coral", "yellow", "red"];
const hash = (s: string) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);

interface LookState { looks: Record<string, BotLook>; set: (slug: string, p: Partial<BotLook>) => void }
const saved = (): Record<string, BotLook> => { try { return JSON.parse(localStorage.getItem(KEY) ?? "{}"); } catch { return {}; } };
export const useBotLook = create<LookState>((set) => ({
  looks: saved(),
  set: (slug, p) => set((s) => {
    const looks = { ...s.looks, [slug]: { ...lookFor(s.looks, slug), ...p } };
    try { localStorage.setItem(KEY, JSON.stringify(looks)); } catch { /* ignore */ }
    return { looks };
  }),
}));
export function lookFor(looks: Record<string, BotLook>, slug: string): BotLook {
  return looks[slug] ?? DEFAULTS[slug] ?? { color: FALLBACK_COLORS[hash(slug) % FALLBACK_COLORS.length], body: "cursor" };
}

/** Maps a live agent state from the event bus to a mascot face. */
export function stateFromAgent(s: string | undefined): MausState {
  switch (s) {
    case "working": return "working";
    case "planning": return "thinking";
    case "blocked": case "waiting_approval": return "alerting";
    case "error": case "failed": return "sad";
    case "sleeping": case "offline": return "sleeping";
    default: return "idle";
  }
}
