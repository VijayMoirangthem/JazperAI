"use client";

import { useEffect, useRef, useState } from "react";
import {
  Settings, RotateCcw, Save, RefreshCw,
  ChevronDown, ChevronRight, Info, Play, Loader,
} from "lucide-react";
import { useSettings, AISettings, DEFAULT_SETTINGS } from "@/hooks/useSettings";

// ── Primitives ────────────────────────────────────────────────────────────────

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!value)}
      style={{
        width: 36, height: 20, borderRadius: "var(--r-full)",
        border: "none", cursor: "pointer", position: "relative", flexShrink: 0,
        background: value ? "var(--color-cta-bg)" : "var(--color-surface-float)",
        transition: "var(--ease-soft)",
      }}
    >
      <span style={{
        position: "absolute", top: 3,
        left: value ? 19 : 3,
        width: 14, height: 14, borderRadius: "var(--r-full)",
        background: value ? "var(--color-cta-text)" : "var(--color-text-muted)",
        transition: "var(--ease-soft)",
      }} />
    </button>
  );
}

function Slider({
  value, min, max, step, onChange, disabled,
}: {
  value: number; min: number; max: number; step: number;
  onChange: (v: number) => void; disabled?: boolean;
}) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <input
      type="range" min={min} max={max} step={step} value={value} disabled={disabled}
      onChange={e => onChange(parseFloat(e.target.value))}
      style={{
        width: "100%", height: 2, appearance: "none", outline: "none",
        cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.4 : 1,
        background: `linear-gradient(to right, var(--color-text-primary) ${pct}%, var(--color-surface-float) ${pct}%)`,
        borderRadius: "var(--r-full)",
      }}
    />
  );
}

function NumberInput({ value, min, max, step, onChange, disabled }: {
  value: number; min: number; max: number; step: number;
  onChange: (v: number) => void; disabled?: boolean;
}) {
  return (
    <input
      type="number" value={value} min={min} max={max} step={step} disabled={disabled}
      onChange={e => onChange(parseFloat(e.target.value))}
      style={{
        width: 64, height: 28, background: "var(--color-surface-raised)",
        border: "var(--border-hi)", borderRadius: "var(--r-sm)",
        padding: "0 var(--sp-2)", fontSize: 12, color: "var(--color-text-primary)",
        textAlign: "right", outline: "none", opacity: disabled ? 0.4 : 1,
        fontFamily: "var(--font-mono)",
      }}
    />
  );
}

function Section({ title, children, icon, defaultOpen = true }: {
  title: string; children: React.ReactNode;
  icon?: React.ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ borderBottom: "var(--border-lo)", paddingBottom: open ? "var(--sp-4)" : 0 }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: "100%", display: "flex", alignItems: "center",
          gap: "var(--sp-2)", padding: "var(--sp-3) 0",
          background: "none", border: "none", cursor: "pointer",
          color: "var(--color-text-secondary)",
        }}
      >
        {icon && <span style={{ color: "var(--color-icon)", display: "flex" }}>{icon}</span>}
        <span style={{ fontSize: 12, fontWeight: 500, color: "var(--color-text-secondary)" }}>{title}</span>
        <span style={{ marginLeft: "auto", color: "var(--color-icon)" }}>
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>
      </button>
      {open && <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>{children}</div>}
    </div>
  );
}

function Row({ label, hint, children, toggle, onToggle, checked }: {
  label: string; hint?: string; children: React.ReactNode;
  toggle?: boolean; onToggle?: () => void; checked?: boolean;
}) {
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--sp-2)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
          {toggle !== undefined && (
            <input
              type="checkbox" checked={checked} onChange={onToggle}
              style={{ width: 13, height: 13, accentColor: "var(--color-text-primary)", cursor: "pointer" }}
            />
          )}
          <span style={{ fontSize: 12.5, color: "var(--color-text-primary)" }}>{label}</span>
        </div>
        {hint && <span style={{ fontSize: 11, fontFamily: "var(--font-mono)", color: "var(--color-text-muted)" }}>{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function SliderRow({ label, value, min, max, step, onChange, disabled, hint }: {
  label: string; value: number; min: number; max: number; step: number;
  onChange: (v: number) => void; disabled?: boolean; hint?: string;
  toggle?: boolean; checked?: boolean; onToggle?: () => void;
}) {
  return (
    <Row label={label} hint={hint ?? (step < 1 ? value.toFixed(2) : String(value))}>
      <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-3)" }}>
        <div style={{ flex: 1 }}>
          <Slider value={value} min={min} max={max} step={step} onChange={onChange} disabled={disabled} />
        </div>
        <NumberInput value={value} min={min} max={max} step={step} onChange={onChange} disabled={disabled} />
      </div>
    </Row>
  );
}

// ── TTS Voices ────────────────────────────────────────────────────────────────

const TTS_VOICES = [
  { id: "en-US-AriaNeural",      label: "Aria",      desc: "Warm & natural (US female)" },
  { id: "en-US-JennyNeural",     label: "Jenny",     desc: "Friendly & clear (US female)" },
  { id: "en-US-GuyNeural",       label: "Guy",       desc: "Confident & smooth (US male)" },
  { id: "en-US-DavisNeural",     label: "Davis",     desc: "Deep & calm (US male)" },
  { id: "en-US-JasonNeural",     label: "Jason",     desc: "Casual & conversational (US male)" },
  { id: "en-US-SaraNeural",      label: "Sara",      desc: "Bright & energetic (US female)" },
  { id: "en-GB-SoniaNeural",     label: "Sonia",     desc: "Polished British accent (female)" },
  { id: "en-GB-RyanNeural",      label: "Ryan",      desc: "Crisp British accent (male)" },
  { id: "en-AU-NatashaNeural",   label: "Natasha",   desc: "Clear Australian accent (female)" },
  { id: "en-IN-NeerjaNeural",    label: "Neerja",    desc: "Indian accent (female)" },
];

const PREVIEW_TEXT = "Hey! I'm Jazper, your personal AI assistant. How can I help you today?";
const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

function VoiceSelector({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [playing, setPlaying] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  async function preview(voiceId: string) {
    if (playing === voiceId) {
      audioRef.current?.pause();
      setPlaying(null);
      return;
    }
    setPlaying(voiceId);
    try {
      const res = await fetch(`${API}/api/voice/speak`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: PREVIEW_TEXT, voice: voiceId }),
      });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      if (audioRef.current) audioRef.current.pause();
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => setPlaying(null);
      audio.onerror = () => setPlaying(null);
      audio.play();
    } catch {
      setPlaying(null);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {TTS_VOICES.map(v => (
        <div
          key={v.id}
          onClick={() => onChange(v.id)}
          style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "8px 10px", borderRadius: "var(--r-md)", cursor: "pointer",
            border: value === v.id ? "1px solid var(--color-cta-bg)" : "var(--border)",
            background: value === v.id ? "color-mix(in srgb, var(--color-cta-bg) 12%, transparent)" : "var(--color-surface)",
            transition: "var(--ease-soft)",
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12.5, fontWeight: 500, color: "var(--color-text-primary)" }}>{v.label}</div>
            <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginTop: 1 }}>{v.desc}</div>
          </div>
          <button
            onClick={e => { e.stopPropagation(); preview(v.id); }}
            title="Preview voice"
            style={{
              width: 28, height: 28, borderRadius: "var(--r-full)", border: "var(--border)",
              background: "var(--color-surface-float)", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: playing === v.id ? "var(--color-cta-bg)" : "var(--color-text-muted)",
              flexShrink: 0,
            }}
          >
            {playing === v.id
              ? <Loader size={12} className="animate-spin" />
              : <Play size={12} />
            }
          </button>
        </div>
      ))}
    </div>
  );
}

// ── Tabs ──────────────────────────────────────────────────────────────────────

type Tab = "inference" | "load" | "about";

// ── Main Component ────────────────────────────────────────────────────────────

export function SettingsPanel() {
  const { settings, save, reset, saved } = useSettings();
  const [d, setD] = useState<AISettings>(settings);       // draft
  const [tab, setTab] = useState<Tab>("inference");
  const [models, setModels] = useState<{ id: string }[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [stopInput, setStopInput] = useState("");
  const [reloading, setReloading] = useState(false);
  const [reloadMsg, setReloadMsg] = useState("");

  useEffect(() => { setD(settings); }, [settings]);

  function p(patch: Partial<AISettings>) { setD(prev => ({ ...prev, ...patch })); }

  async function fetchModels() {
    setLoadingModels(true);
    try {
      const r = await fetch(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"}/api/models`);
      const data = await r.json();
      setModels(data.models ?? []);
    } catch { setModels([]); }
    finally { setLoadingModels(false); }
  }

  useEffect(() => { fetchModels(); }, []);

  function addStop(e: React.KeyboardEvent) {
    if (e.key === "Enter" && stopInput.trim()) {
      p({ stopStrings: [...d.stopStrings, stopInput.trim()] });
      setStopInput("");
    }
  }

  async function reloadModel() {
    setReloading(true);
    setReloadMsg("Sending load request to LM Studio...");
    try {
      const r = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"}/api/models/load`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            model: d.model,
            contextLength: d.contextLength,
            gpuOffload: d.gpuOffload,
            cpuThreads: d.cpuThreads,
            flashAttention: d.flashAttention,
          }),
        }
      );
      const data = await r.json();
      setReloadMsg(data.success ? "Model reloaded successfully!" : (data.error ?? "Reload failed."));
    } catch { setReloadMsg("Failed — is FastAPI running?"); }
    finally { setReloading(false); setTimeout(() => setReloadMsg(""), 4000); }
  }

  const TAB_STYLE = (active: boolean): React.CSSProperties => ({
    flex: 1, height: 30, border: "none", cursor: "pointer", fontSize: 12, fontWeight: 500,
    borderRadius: "var(--r-sm)",
    background: active ? "var(--color-surface-raised)" : "transparent",
    color: active ? "var(--color-text-primary)" : "var(--color-text-muted)",
    transition: "var(--ease-snap)", fontFamily: "var(--font-sans)",
  });

  return (
    <div className="sj-panel" style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>

      {/* Header */}
      <div className="sj-panel-header" style={{ flexShrink: 0 }}>
        <Settings size={13} style={{ color: "var(--color-icon)" }} />
        <span className="sj-label">Settings</span>
        <div className="sj-ml-auto sj-flex sj-items-center sj-gap-2">
          {saved && <span className="sj-badge sj-badge-live">Saved</span>}
          <button className="sj-btn sj-btn-ghost" onClick={() => { reset(); setD(DEFAULT_SETTINGS); }}
            style={{ fontSize: 11, padding: "3px 8px", display: "flex", alignItems: "center", gap: 4 }}>
            <RotateCcw size={10} /> Reset
          </button>
          <button className="sj-btn sj-btn-primary" onClick={() => save(d)}
            style={{ fontSize: 11, padding: "3px 10px", display: "flex", alignItems: "center", gap: 4 }}>
            <Save size={10} /> Save
          </button>
        </div>
      </div>

      {/* Model badge */}
      <div style={{ padding: "var(--sp-2) var(--sp-4)", borderBottom: "var(--border)", display: "flex", alignItems: "center", gap: "var(--sp-2)", background: "var(--color-surface)", flexShrink: 0 }}>
        <span style={{ fontSize: 16 }}>🤖</span>
        <span style={{ fontSize: 13, fontWeight: 500, color: "var(--color-text-primary)" }}>
          {d.model.split("/").pop()}
        </span>
        <span className="sj-badge" style={{ marginLeft: 2 }}>
          {d.model.split("/")[0]}
        </span>
      </div>

      {/* Tabs */}
      <div style={{ padding: "var(--sp-2) var(--sp-4)", borderBottom: "var(--border)", display: "flex", gap: 2, background: "var(--color-surface)", flexShrink: 0 }}>
        {(["inference", "load", "about"] as Tab[]).map(t => (
          <button key={t} style={TAB_STYLE(tab === t)} onClick={() => setTab(t)}>
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflowY: "auto", padding: "0 var(--sp-4)" }}>

        {/* ══ INFERENCE TAB ══════════════════════════════════════════════════ */}
        {tab === "inference" && <>

          <Section title="System Prompt">
            <textarea
              className="sj-textarea"
              value={d.systemPrompt}
              onChange={e => p({ systemPrompt: e.target.value })}
              rows={5}
              style={{ fontSize: 12 }}
            />
          </Section>

          <Section title="Custom Fields">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontSize: 12.5, color: "var(--color-text-primary)" }}>Enable Thinking</div>
                <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginTop: 2 }}>
                  Model reasons internally before replying (slower but more accurate)
                </div>
              </div>
              <Toggle value={d.enableThinking} onChange={v => p({ enableThinking: v })} />
            </div>
          </Section>

          <Section title="Settings">
            <SliderRow label="Temperature" value={d.temperature} min={0} max={2} step={0.01} onChange={v => p({ temperature: v })} />

            <Row label="Limit Response Length"
              toggle checked={d.limitResponseLength}
              onToggle={() => p({ limitResponseLength: !d.limitResponseLength })}>
              {d.limitResponseLength && (
                <SliderRow label="Max Tokens" value={d.maxTokens} min={64} max={4096} step={64}
                  onChange={v => p({ maxTokens: v })} hint={String(d.maxTokens)} />
              )}
            </Row>

            <Row label="Context Overflow">
              <select
                value={d.contextOverflow}
                onChange={e => p({ contextOverflow: e.target.value as AISettings["contextOverflow"] })}
                style={{
                  width: "100%", height: 32, background: "var(--color-surface)", border: "var(--border-hi)",
                  borderRadius: "var(--r-md)", padding: "0 var(--sp-3)", fontSize: 12,
                  color: "var(--color-text-primary)", outline: "none", cursor: "pointer",
                }}
              >
                <option value="truncate-middle">Truncate Middle</option>
                <option value="truncate-end">Truncate End</option>
                <option value="stop-at-limit">Stop at Limit</option>
              </select>
            </Row>

            <Row label="Stop Strings">
              <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-1)" }}>
                <input
                  className="sj-input"
                  placeholder="Enter a string and press Enter"
                  value={stopInput}
                  onChange={e => setStopInput(e.target.value)}
                  onKeyDown={addStop}
                />
                {d.stopStrings.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "var(--sp-1)" }}>
                    {d.stopStrings.map((s, i) => (
                      <button key={i} onClick={() => p({ stopStrings: d.stopStrings.filter((_, j) => j !== i) })}
                        className="sj-badge" style={{ cursor: "pointer" }}>
                        {s} ×
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </Row>
          </Section>

          <Section title="Sampling">
            <SliderRow label="Top K Sampling" value={d.topK} min={1} max={200} step={1} onChange={v => p({ topK: v })} />

            <Row label="Repeat Penalty"
              toggle checked={d.repeatPenalty}
              onToggle={() => p({ repeatPenalty: !d.repeatPenalty })}
              hint={d.repeatPenalty ? d.repeatPenaltyValue.toFixed(2) : undefined}>
              {d.repeatPenalty && (
                <Slider value={d.repeatPenaltyValue} min={1} max={2} step={0.01}
                  onChange={v => p({ repeatPenaltyValue: v })} />
              )}
            </Row>

            <Row label="Presence Penalty"
              toggle checked={d.presencePenalty}
              onToggle={() => p({ presencePenalty: !d.presencePenalty })}
              hint={d.presencePenalty ? d.presencePenaltyValue.toFixed(2) : undefined}>
              {d.presencePenalty && (
                <Slider value={d.presencePenaltyValue} min={0} max={2} step={0.05}
                  onChange={v => p({ presencePenaltyValue: v })} />
              )}
            </Row>

            <Row label="Frequency Penalty"
              toggle checked={d.frequencyPenalty}
              onToggle={() => p({ frequencyPenalty: !d.frequencyPenalty })}
              hint={d.frequencyPenalty ? d.frequencyPenaltyValue.toFixed(2) : undefined}>
              {d.frequencyPenalty && (
                <Slider value={d.frequencyPenaltyValue} min={0} max={2} step={0.05}
                  onChange={v => p({ frequencyPenaltyValue: v })} />
              )}
            </Row>

            <Row label="Top P Sampling"
              toggle checked={d.topP}
              onToggle={() => p({ topP: !d.topP })}
              hint={d.topP ? d.topPValue.toFixed(2) : undefined}>
              {d.topP && (
                <Slider value={d.topPValue} min={0} max={1} step={0.01}
                  onChange={v => p({ topPValue: v })} />
              )}
            </Row>

            <Row label="Min P Sampling"
              toggle checked={d.minP}
              onToggle={() => p({ minP: !d.minP })}
              hint={d.minP ? d.minPValue.toFixed(2) : undefined}>
              {d.minP && (
                <Slider value={d.minPValue} min={0} max={0.5} step={0.01}
                  onChange={v => p({ minPValue: v })} />
              )}
            </Row>
          </Section>

          <Section title="Voice (TTS)">
            <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginBottom: 8 }}>
              Click a voice to select it. Press ▶ to hear a preview.
            </div>
            <VoiceSelector value={d.ttsVoice} onChange={v => p({ ttsVoice: v })} />
          </Section>

          <div style={{ height: "var(--sp-4)" }} />
        </>}

        {/* ══ LOAD TAB ═══════════════════════════════════════════════════════ */}
        {tab === "load" && <>

          <Section title="Model">
            <Row label="Active Model">
              <div style={{ display: "flex", gap: "var(--sp-2)" }}>
                <select
                  value={d.model}
                  onChange={e => p({ model: e.target.value })}
                  style={{
                    flex: 1, height: 36, background: "var(--color-surface)", border: "var(--border-hi)",
                    borderRadius: "var(--r-md)", padding: "0 var(--sp-3)", fontSize: 12,
                    color: "var(--color-text-primary)", outline: "none", cursor: "pointer",
                  }}
                >
                  {models.length === 0
                    ? <option value={d.model}>{d.model}</option>
                    : models.map(m => <option key={m.id} value={m.id}>{m.id}</option>)
                  }
                </select>
                <button className="sj-btn sj-btn-ghost" onClick={fetchModels}
                  style={{ padding: "0 10px", display: "flex", alignItems: "center" }}>
                  <RefreshCw size={12} style={{ animation: loadingModels ? "spin 1s linear infinite" : "none" }} />
                </button>
              </div>
            </Row>
          </Section>

          <Section title="Context and Offload">
            <SliderRow label="Context Length" value={d.contextLength} min={256} max={8192} step={256}
              onChange={v => p({ contextLength: v })} hint={String(d.contextLength)} />

            <SliderRow label="GPU Offload" value={d.gpuOffload} min={0} max={50} step={1}
              onChange={v => p({ gpuOffload: v })} hint={String(d.gpuOffload)} />
          </Section>

          <Section title="Advanced">
            <SliderRow label="CPU Thread Pool Size" value={d.cpuThreads} min={1} max={16} step={1}
              onChange={v => p({ cpuThreads: v })} hint={String(d.cpuThreads)} />

            <SliderRow label="Evaluation Batch Size" value={d.evalBatchSize} min={64} max={2048} step={64}
              onChange={v => p({ evalBatchSize: v })} hint={String(d.evalBatchSize)} />

            <SliderRow label="Max Concurrent Predictions" value={d.maxConcurrentPredictions} min={1} max={8} step={1}
              onChange={v => p({ maxConcurrentPredictions: v })} hint={String(d.maxConcurrentPredictions)} />

            {[
              { label: "Unified KV Cache", key: "unifiedKvCache", exp: true },
              { label: "Offload KV Cache to GPU Memory", key: "offloadKvCacheToGpu" },
              { label: "Keep Model in Memory", key: "keepModelInMemory" },
              { label: "Try mmap()", key: "tryMmap" },
              { label: "Flash Attention", key: "flashAttention" },
            ].map(({ label, key, exp }) => (
              <div key={key} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
                  <span style={{ fontSize: 12.5, color: "var(--color-text-primary)" }}>{label}</span>
                  {exp && <span className="sj-badge" style={{ fontSize: 9 }}>Experimental</span>}
                </div>
                <Toggle
                  value={d[key as keyof AISettings] as boolean}
                  onChange={v => p({ [key]: v })}
                />
              </div>
            ))}
          </Section>

          {/* Apply & Reload */}
          <div style={{ padding: "var(--sp-4) 0" }}>
            <button
              className="sj-btn sj-btn-primary"
              onClick={reloadModel}
              disabled={reloading}
              style={{ width: "100%", justifyContent: "center", opacity: reloading ? 0.6 : 1 }}
            >
              {reloading ? "Reloading..." : "Apply & Reload Model"}
            </button>
            {reloadMsg && (
              <p style={{ fontSize: 11, color: "var(--color-text-muted)", marginTop: "var(--sp-2)", textAlign: "center" }}>
                {reloadMsg}
              </p>
            )}
            <p style={{ fontSize: 11, color: "var(--color-text-muted)", marginTop: "var(--sp-2)", textAlign: "center" }}>
              Context Length, GPU Offload and model changes require a reload.
            </p>
          </div>
        </>}

        {/* ══ ABOUT TAB ══════════════════════════════════════════════════════ */}
        {tab === "about" && <>
          <div style={{ padding: "var(--sp-4) 0", display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>

            <div style={{ textAlign: "center", padding: "var(--sp-6) 0" }}>
              <div style={{ fontSize: 40, marginBottom: "var(--sp-2)" }}>⚡</div>
              <p style={{ fontSize: 18, fontWeight: 300, color: "var(--color-text-primary)" }}>Sir Jazper OS</p>
              <p className="sj-micro" style={{ marginTop: "var(--sp-1)" }}>Version 1.0 — Phase 1</p>
            </div>

            <div className="sj-card" style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
              {[
                ["Frontend",  "Next.js 16 + TypeScript"],
                ["Styling",   "Tailwind + Custom Design System"],
                ["Backend",   "FastAPI (Python)"],
                ["AI",        "LM Studio — OpenAI-compatible"],
                ["Database",  "PostgreSQL + pgvector"],
                ["Cache",     "Redis"],
                ["Storage",   "MinIO (S3-compatible)"],
                ["Automation","Playwright (coming)"],
                ["Voice",     "Faster Whisper (coming)"],
              ].map(([k, v]) => (
                <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "2px 0", borderBottom: "var(--border-lo)" }}>
                  <span className="sj-micro" style={{ color: "var(--color-text-muted)" }}>{k}</span>
                  <span className="sj-mono" style={{ fontSize: 11 }}>{v}</span>
                </div>
              ))}
            </div>

            <div className="sj-card">
              <p className="sj-label" style={{ marginBottom: "var(--sp-2)" }}>Current Model Config</p>
              {[
                ["Model",         settings.model],
                ["Temperature",   settings.temperature.toFixed(2)],
                ["Max Tokens",    settings.limitResponseLength ? String(settings.maxTokens) : "Unlimited"],
                ["Top K",         String(settings.topK)],
                ["Top P",         settings.topP ? settings.topPValue.toFixed(2) : "Off"],
                ["Min P",         settings.minP ? settings.minPValue.toFixed(2) : "Off"],
                ["Thinking",      settings.enableThinking ? "On" : "Off"],
                ["GPU Offload",   String(settings.gpuOffload)],
                ["Context",       String(settings.contextLength)],
              ].map(([k, v]) => (
                <div key={k} style={{ display: "flex", justifyContent: "space-between", padding: "2px 0", borderBottom: "var(--border-lo)" }}>
                  <span className="sj-micro" style={{ color: "var(--color-text-muted)" }}>{k}</span>
                  <span className="sj-mono" style={{ fontSize: 11 }}>{v}</span>
                </div>
              ))}
            </div>
          </div>
        </>}

      </div>
    </div>
  );
}
