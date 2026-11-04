"use client";
import { useEffect, useState } from "react";
import { defaultAppearance, parseAppearance, type Appearance } from "../core/appearance";

const crewPalette = ["#3b82f6", "#0f766e", "#7c3aed", "#be123c", "#b45309"];
const hairPalette = ["#2b1d14", "#111827", "#713f12", "#9f1239", "#e5e7eb"];
const skinPalette = ["#e0ac8a", "#c68662", "#8d5524", "#f1c7a5", "#6b3e26"];
const voices = ["en-GB-RyanNeural", "en-GB-SoniaNeural", "en-US-GuyNeural", "en-US-JennyNeural"];
const pick = <T,>(items: readonly T[]): T => items[Math.floor(Math.random() * items.length)]!;
const randomAppearance = (look: string): Appearance => ({ ...defaultAppearance(look), bodyType: pick(["a", "b", "c"] as const), scale: Number((.9 + Math.random() * .2).toFixed(2)), tints: { skin: pick(skinPalette), hair: pick(hairPalette), top: pick(crewPalette), bottom: pick(["#111827", "#1e3a5f", "#3f3f46", "#4c1d95"]), shoes: pick(["#111827", "#1f2937", "#f8fafc"]) }, parts: { hair: pick(["short-02", "long-01", "none"]), hat: pick(["none", "cap-01"]), glasses: pick(["none", "round"]), badge: pick(["lanyard", "pin", "none"]) }, badge: { style: pick(["plate", "floating", "none"] as const), showRole: Math.random() >= .2 }, voice: pick(voices) });
export function AppearanceEditor({ onApply, soundEnabled = true }: { onApply(appearance: Appearance): void; soundEnabled?: boolean }) {
  const [appearance, setAppearance] = useState(defaultAppearance());
  const [open, setOpen] = useState(false);
  useEffect(() => { const show = () => setOpen(true); const sync = (event: Event) => { try { setAppearance(parseAppearance((event as CustomEvent<unknown>).detail)); } catch { /* ignore malformed local event */ } }; window.addEventListener("office3:open-appearance-editor", show); window.addEventListener("office3:appearance-changed", sync); return () => { window.removeEventListener("office3:open-appearance-editor", show); window.removeEventListener("office3:appearance-changed", sync); }; }, []);
  const update = (next: Partial<Appearance>) => { const value = { ...appearance, ...next }; setAppearance(value); onApply(value); };
  const tint = (key: keyof Appearance["tints"], value: string) => update({ tints: { ...appearance.tints, [key]: value } });
  const applyRandom = () => { const value = randomAppearance(appearance.look); setAppearance(value); onApply(value); };
  const previewVoice = () => {
    if (!soundEnabled || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance("This is your Office voice preview.");
    const locale = appearance.voice.startsWith("en-GB") ? "en-GB" : "en-US";
    const requested = appearance.voice.replace("Neural", "").toLowerCase();
    utterance.voice = window.speechSynthesis.getVoices().find(voice => voice.name.toLowerCase().includes(requested)) ?? window.speechSynthesis.getVoices().find(voice => voice.lang.startsWith(locale)) ?? null;
    utterance.lang = locale;
    utterance.rate = 1;
    window.speechSynthesis.speak(utterance);
  };
  return <details open={open} onToggle={event => setOpen((event.currentTarget as HTMLDetailsElement).open)} className="absolute bottom-3 left-[23rem] max-h-80 w-60 overflow-auto rounded-lg bg-black/70 p-2 text-xs text-white">
    <summary className="cursor-pointer">Appearance editor</summary>
    <label className="mt-2 block">Body <select value={appearance.bodyType} onChange={event => update({ bodyType: event.target.value as Appearance["bodyType"] })}><option value="a">A</option><option value="b">B</option><option value="c">C</option></select></label>
    <fieldset className="mt-2 rounded border border-white/10 p-1"><legend className="px-1 text-[10px] text-slate-300">Colours</legend>{(["skin", "hair", "top", "bottom", "shoes"] as const).map(key => <label key={key} className="block capitalize">{key} <input type="color" value={appearance.tints[key]} onChange={event => tint(key, event.target.value)} /></label>)}<div className="mt-1 flex flex-wrap gap-1" aria-label="Crew colour shortcuts">{crewPalette.map(colour => <button key={colour} type="button" title={`Use crew colour ${colour}`} className="h-4 w-4 rounded ring-1 ring-white/30" style={{ backgroundColor: colour }} onClick={() => tint("top", colour)} />)}</div></fieldset>
    <label className="mt-2 block">Hair style <select value={appearance.parts.hair} onChange={event => update({ parts: { ...appearance.parts, hair: event.target.value } })}><option value="short-02">Short</option><option value="long-01">Long</option><option value="none">None</option></select></label>
    <label className="block">Hat <select value={appearance.parts.hat} onChange={event => update({ parts: { ...appearance.parts, hat: event.target.value } })}><option value="none">None</option><option value="cap-01">Cap</option></select></label>
    <label className="block">Glasses <select value={appearance.parts.glasses} onChange={event => update({ parts: { ...appearance.parts, glasses: event.target.value } })}><option value="none">None</option><option value="round">Round</option></select></label>
    <label className="block">Badge attachment <select value={appearance.parts.badge} onChange={event => update({ parts: { ...appearance.parts, badge: event.target.value } })}><option value="lanyard">Lanyard</option><option value="pin">Pin</option><option value="none">None</option></select></label>
    <label className="block">Badge style <select value={appearance.badge.style} onChange={event => update({ badge: { ...appearance.badge, style: event.target.value as Appearance["badge"]["style"] } })}><option value="plate">Plate</option><option value="floating">Floating</option><option value="none">None</option></select></label>
    <label className="block">Voice <select value={appearance.voice} onChange={event => update({ voice: event.target.value })}>{voices.map(voice => <option key={voice} value={voice}>{voice.replace("Neural", "")}</option>)}</select></label><button type="button" className="mt-1 rounded bg-slate-700 px-2 py-1 disabled:cursor-not-allowed disabled:opacity-50" disabled={!soundEnabled} title={soundEnabled ? "Play a local preview of the selected voice" : "Enable Office sounds to preview voices"} onClick={previewVoice}>Preview voice</button>
    <label className="block">Scale <input className="w-full" type="range" min="0.85" max="1.15" step="0.01" value={appearance.scale} onChange={event => update({ scale: Number(event.target.value) })} /></label>
    <div className="mt-2 flex gap-1"><button className="rounded bg-blue-700 px-2 py-1" onClick={applyRandom}>Randomise</button><button className="rounded bg-slate-700 px-2 py-1" onClick={() => { const value = defaultAppearance(appearance.look); setAppearance(value); onApply(value); }}>Reset</button></div>
  </details>;
}
