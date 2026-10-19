"use client";

import { useEffect, useRef, useState } from "react";
import {
  Settings, RotateCcw, Save, RefreshCw,
  ChevronDown, ChevronRight, Info, Play, Loader, Send, CheckCircle, XCircle,
} from "lucide-react";
import { useSettings, AISettings, DEFAULT_SETTINGS, AgentName, AgentConfig, AGENT_DEFAULTS } from "@/hooks/useSettings";

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

type Tab = "inference" | "approvals" | "agents" | "load" | "telegram" | "data" | "about";

// ── Main Component ────────────────────────────────────────────────────────────

export function SettingsPanel() {
  const { settings, save, reset, saved } = useSettings();
  const [d, setD] = useState<AISettings>(settings);       // draft
  const [tab, setTab] = useState<Tab>("inference");

  // Phase 9E — Telegram
  const [tgStatus, setTgStatus] = useState<{configured:boolean;enabled:boolean;has_token:boolean;has_chat_id:boolean}|null>(null);
  const [tgToken, setTgToken]   = useState("");
  const [tgChatId, setTgChatId] = useState("");
  const [tgSaving, setTgSaving] = useState(false);
  const [tgTesting, setTgTesting] = useState(false);
  const [tgMsg, setTgMsg]       = useState("");
  const [models, setModels] = useState<{ id: string }[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [stopInput, setStopInput] = useState("");
  const [reloading, setReloading] = useState(false);
  const [reloadMsg, setReloadMsg] = useState("");
  const [alertCfg, setAlertCfg] = useState<Record<string, boolean>>({});

  useEffect(() => { setD(settings); }, [settings]);

  useEffect(() => {
    fetch("http://localhost:8000/api/alert-config")
      .then(r => r.json())
      .then(setAlertCfg)
      .catch(() => {});
  }, []);

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
        {(["inference", "approvals", "agents", "load", "telegram", "data", "about"] as Tab[]).map(t => (
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

        {/* ══ APPROVALS TAB ══════════════════════════════════════════════════ */}
        {tab === "approvals" && <>
          <div style={{ padding: "var(--sp-4) 0", display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>

            <Section title="Auto-Approve">
              {/* Global kill-switch */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontSize: 12.5, color: "var(--color-text-primary)" }}>Auto-approve everything</div>
                  <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginTop: 2 }}>
                    Agents act without asking. Useful once you trust the system.
                  </div>
                </div>
                <Toggle
                  value={d.approvals?.autoApproveAll ?? false}
                  onChange={v => p({ approvals: { ...d.approvals, autoApproveAll: v } })}
                />
              </div>

              {/* Per-action-type list */}
              <div>
                <div style={{ fontSize: 12, color: "var(--color-text-secondary)", marginBottom: 8 }}>
                  Always allowed (without asking):
                </div>
                {(d.approvals?.autoApproveTypes ?? []).length === 0 ? (
                  <p style={{ fontSize: 11, color: "var(--color-text-muted)", margin: 0 }}>
                    None. Use the Approve overlay to add actions here.
                  </p>
                ) : (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {(d.approvals?.autoApproveTypes ?? []).map((t: string) => (
                      <div key={t} style={{
                        display: "flex", alignItems: "center", gap: 4,
                        background: "var(--color-surface-raised)",
                        border: "var(--border-hi)", borderRadius: 4,
                        padding: "3px 8px", fontSize: 11,
                      }}>
                        <span>{t}</span>
                        <button
                          onClick={() => p({
                            approvals: {
                              ...d.approvals,
                              autoApproveTypes: (d.approvals?.autoApproveTypes ?? []).filter((x: string) => x !== t),
                            }
                          })}
                          style={{ background: "none", border: "none", cursor: "pointer", color: "#ef4444", padding: 0, display: "flex" }}
                        >
                          ×
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </Section>

          </div>
        </>}

        {/* ══ AGENTS TAB ═════════════════════════════════════════════════════ */}
        {tab === "agents" && <>
          <div style={{ padding: "var(--sp-4) 0", display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>

            <p className="sj-micro" style={{ color: "var(--color-text-muted)", marginBottom: "var(--sp-1)" }}>
              Configure each specialist agent individually. Disabled agents are never called.
              Model overrides use your Groq API key — leave blank to use the agent default.
            </p>

            {(Object.keys(d.agents ?? AGENT_DEFAULTS) as AgentName[]).map(name => {
              const cfg: AgentConfig = d.agents[name];
              const def = AGENT_DEFAULTS[name];
              const AGENT_EMOJI: Record<AgentName, string> = { Scout: "🔍", Hermes: "📧", Sage: "🧠", Lens: "📷", Atlas: "📋", Phantom: "👻" };
              const AGENT_DESC: Record<AgentName, string> = {
                Scout:   "Web search & live information",
                Hermes:  "Gmail — read, send, reply, manage",
                Sage:    "Memory — recall & store user facts",
                Lens:    "Vision — image & camera analysis",
                Atlas:   "Jobs — search, apply, track (coming)",
                Phantom: "Browser — scraping & automation (coming)",
              };

              return (
                <div key={name} className="sj-card" style={{
                  opacity: cfg.enabled ? 1 : 0.5,
                  transition: "var(--ease-soft)",
                }}>
                  {/* Agent header row */}
                  <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", marginBottom: "var(--sp-3)" }}>
                    <span style={{ fontSize: 18 }}>{AGENT_EMOJI[name]}</span>
                    <div style={{ flex: 1 }}>
                      <div className="sj-label">{name}</div>
                      <div className="sj-micro" style={{ color: "var(--color-text-muted)" }}>{AGENT_DESC[name]}</div>
                    </div>
                    <Toggle
                      value={cfg.enabled}
                      onChange={v => p({ agents: { ...d.agents, [name]: { ...cfg, enabled: v } } })}
                    />
                  </div>

                  {cfg.enabled && <>
                    {/* Model */}
                    <Row label="Model" hint={`Default: ${def.model}`}>
                      <input
                        className="sj-input"
                        value={cfg.model}
                        onChange={e => p({ agents: { ...d.agents, [name]: { ...cfg, model: e.target.value } } })}
                        placeholder={def.model}
                        style={{ flex: 1, fontSize: 11 }}
                      />
                    </Row>

                    {/* Temperature */}
                    <Row label={`Temperature  ${cfg.temperature.toFixed(2)}`}>
                      <div style={{ flex: 1 }}>
                        <Slider
                          value={cfg.temperature} min={0} max={2} step={0.05}
                          onChange={v => p({ agents: { ...d.agents, [name]: { ...cfg, temperature: v } } })}
                        />
                      </div>
                    </Row>

                    {/* Max tokens */}
                    <Row label="Max Tokens">
                      <NumberInput
                        value={cfg.maxTokens} min={64} max={4096} step={64}
                        onChange={v => p({ agents: { ...d.agents, [name]: { ...cfg, maxTokens: v } } })}
                      />
                    </Row>

                    {/* Priority */}
                    <Row label={`Priority  ${cfg.priority}`} hint="1 = highest, called first when multiple agents match">
                      <div style={{ flex: 1 }}>
                        <Slider
                          value={cfg.priority} min={1} max={5} step={1}
                          onChange={v => p({ agents: { ...d.agents, [name]: { ...cfg, priority: v } } })}
                        />
                      </div>
                    </Row>

                    {/* System prompt override */}
                    <Row label="System Prompt Override" hint="Leave blank to use built-in agent prompt">
                      <textarea
                        className="sj-textarea"
                        value={cfg.systemPromptOverride}
                        onChange={e => p({ agents: { ...d.agents, [name]: { ...cfg, systemPromptOverride: e.target.value } } })}
                        placeholder="Optional override..."
                        rows={2}
                        style={{ flex: 1, fontSize: 11, minHeight: 48 }}
                      />
                    </Row>

                    {/* Reset to defaults */}
                    <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "var(--sp-1)" }}>
                      <button
                        className="sj-btn"
                        onClick={() => p({ agents: { ...d.agents, [name]: { ...def } } })}
                        style={{ fontSize: 10 }}
                      >
                        Reset {name} defaults
                      </button>
                    </div>
                  </>}
                </div>
              );
            })}

            <p className="sj-micro" style={{ color: "var(--color-text-muted)", marginTop: "var(--sp-2)" }}>
              Groq free tier: llama-3.1-8b-instant — 500k tok/day · llama-3.3-70b-versatile — 100k tok/day · llama-4-scout-17b — 500k tok/day
            </p>
          </div>
        </>}

        {/* ══ TELEGRAM TAB ═══════════════════════════════════════════════════ */}
        {tab === "telegram" && (() => {
          const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
          if (!tgStatus) {
            fetch(`${API_BASE}/api/telegram/status`).then(r => r.json()).then(setTgStatus).catch(() => {});
          }
          async function saveTg() {
            setTgSaving(true); setTgMsg("");
            try {
              await fetch(`${API_BASE}/api/telegram/configure`, {
                method:"POST", headers:{"Content-Type":"application/json"},
                body: JSON.stringify({ bot_token: tgToken, chat_id: tgChatId, enabled: true }),
              });
              setTgMsg("Saved"); setTgStatus(null);
            } finally { setTgSaving(false); }
          }
          async function testTg() {
            setTgTesting(true); setTgMsg("");
            try {
              const res = await fetch(`${API_BASE}/api/telegram/test`, { method:"POST" });
              const data = await res.json();
              setTgMsg(data.ok ? "Test message sent!" : `Error: ${data.detail}`);
            } finally { setTgTesting(false); }
          }
          async function clearTg() {
            await fetch(`${API_BASE}/api/telegram/configure`, { method:"DELETE" });
            setTgToken(""); setTgChatId(""); setTgStatus(null); setTgMsg("Cleared");
          }
          return (
            <div style={{ padding:"var(--sp-4) 0", display:"flex", flexDirection:"column", gap:"var(--sp-4)" }}>
              <div style={{ display:"flex", alignItems:"center", gap:"var(--sp-2)", marginBottom:"var(--sp-2)" }}>
                <Send size={14} style={{ color:"#60a5fa" }}/>
                <span style={{ fontSize:14, fontWeight:600, color:"var(--color-text-primary)" }}>Telegram Push Notifications</span>
              </div>

              {tgStatus && (
                <div style={{ display:"flex", alignItems:"center", gap:"var(--sp-2)", padding:"var(--sp-2) var(--sp-3)",
                  borderRadius:"var(--r-sm)", background:`color-mix(in srgb, ${tgStatus.configured&&tgStatus.enabled?"#22c55e":"#6b7280"} 10%, transparent)`,
                  border:`1px solid color-mix(in srgb, ${tgStatus.configured&&tgStatus.enabled?"#22c55e":"#6b7280"} 25%, transparent)` }}>
                  {tgStatus.configured && tgStatus.enabled
                    ? <CheckCircle size={13} style={{ color:"#22c55e" }}/>
                    : <XCircle size={13} style={{ color:"#6b7280" }}/>}
                  <span style={{ fontSize:12 }}>
                    {tgStatus.configured && tgStatus.enabled ? "Connected & active" : tgStatus.configured ? "Configured but disabled" : "Not configured"}
                  </span>
                </div>
              )}

              <div>
                <label style={{ fontSize:11, color:"var(--color-text-muted)", display:"block", marginBottom:4 }}>
                  Bot Token <span style={{ color:"#64748b" }}>(from @BotFather)</span>
                </label>
                <input type="password" value={tgToken} onChange={e => setTgToken(e.target.value)}
                  placeholder="1234567890:ABC..."
                  style={{ width:"100%", background:"var(--color-surface-raised)", border:"var(--border-hi)",
                    borderRadius:"var(--r-sm)", padding:"var(--sp-2) var(--sp-3)", color:"var(--color-text-primary)",
                    fontSize:12, boxSizing:"border-box" as const }}/>
              </div>

              <div>
                <label style={{ fontSize:11, color:"var(--color-text-muted)", display:"block", marginBottom:4 }}>
                  Chat ID <span style={{ color:"#64748b" }}>(from @userinfobot — your personal chat ID)</span>
                </label>
                <input value={tgChatId} onChange={e => setTgChatId(e.target.value)}
                  placeholder="123456789"
                  style={{ width:"100%", background:"var(--color-surface-raised)", border:"var(--border-hi)",
                    borderRadius:"var(--r-sm)", padding:"var(--sp-2) var(--sp-3)", color:"var(--color-text-primary)",
                    fontSize:12, boxSizing:"border-box" as const }}/>
              </div>

              <div style={{ fontSize:11, color:"var(--color-text-muted)", background:"var(--color-surface-raised)",
                borderRadius:"var(--r-sm)", padding:"var(--sp-3)", border:"var(--border-lo)" }}>
                <strong style={{ color:"var(--color-text-secondary)" }}>Setup:</strong>{" "}
                1. Message @BotFather → /newbot → copy the token above.{" "}
                2. Send a message to your bot, then message @userinfobot to get your Chat ID.{" "}
                3. Save & test below.
              </div>

              {tgMsg && (
                <div style={{ fontSize:12, padding:"var(--sp-2) var(--sp-3)", borderRadius:"var(--r-sm)",
                  background:`color-mix(in srgb, ${tgMsg.includes("Error")?"#ef4444":"#22c55e"} 10%, transparent)`,
                  color: tgMsg.includes("Error") ? "#f87171" : "#4ade80", border:"var(--border-lo)" }}>
                  {tgMsg}
                </div>
              )}

              <div style={{ display:"flex", gap:"var(--sp-2)" }}>
                <button onClick={saveTg} disabled={tgSaving || !tgToken || !tgChatId}
                  style={{ background:"var(--color-accent)", border:"none", borderRadius:"var(--r-sm)",
                    padding:"var(--sp-2) var(--sp-4)", cursor:"pointer", fontSize:12, color:"#fff",
                    display:"flex", alignItems:"center", gap:4, opacity: (!tgToken||!tgChatId) ? 0.5 : 1 }}>
                  <Save size={11}/> {tgSaving ? "Saving…" : "Save"}
                </button>
                <button onClick={testTg} disabled={tgTesting || !tgStatus?.configured}
                  style={{ background:"none", border:"var(--border-hi)", borderRadius:"var(--r-sm)",
                    padding:"var(--sp-2) var(--sp-4)", cursor:"pointer", fontSize:12,
                    color:"var(--color-text-secondary)", display:"flex", alignItems:"center", gap:4,
                    opacity: !tgStatus?.configured ? 0.4 : 1 }}>
                  <Play size={11}/> {tgTesting ? "Sending…" : "Test"}
                </button>
                <button onClick={clearTg}
                  style={{ background:"none", border:"var(--border-hi)", borderRadius:"var(--r-sm)",
                    padding:"var(--sp-2) var(--sp-4)", cursor:"pointer", fontSize:12,
                    color:"#ef4444", marginLeft:"auto" }}>
                  Clear
                </button>
              </div>

              {/* ── Alert Settings ── */}
              <Section title="Alert Settings" defaultOpen={false}>
                <div style={{ display:"flex", flexDirection:"column", gap:"var(--sp-3)" }}>
                  {([
                    ["recruiter_email",  "Recruiter Emails"],
                    ["interview_invite", "Interview Invites"],
                    ["job_rejection",    "Job Rejections"],
                    ["offer_letter",     "Job Offers"],
                    ["action_required",  "Action Required"],
                    ["important_email",  "Important Emails"],
                  ] as [string, string][]).map(([field, label]) => (
                    <div key={field} style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                      <span style={{ fontSize:12.5, color:"var(--color-text-primary)" }}>{label}</span>
                      <Toggle
                        value={!!alertCfg[field]}
                        onChange={v => {
                          setAlertCfg(prev => ({ ...prev, [field]: v }));
                          fetch("http://localhost:8000/api/alert-config", {
                            method:"POST",
                            headers:{"Content-Type":"application/json"},
                            body: JSON.stringify({ [field]: v }),
                          }).catch(() => {});
                        }}
                      />
                    </div>
                  ))}
                  <p style={{ fontSize:11, color:"var(--color-text-muted)", margin:0 }}>
                    Requires Telegram to be configured above.
                  </p>
                </div>
              </Section>
            </div>
          );
        })()}

        {/* ══ DATA TAB ═══════════════════════════════════════════════════════ */}
        {tab === "data" && (() => {
          async function handleExport() {
            try {
              const res = await fetch("http://localhost:8000/api/export");
              if (!res.ok) throw new Error(`HTTP ${res.status}`);
              const blob = await res.blob();
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              const today = new Date().toISOString().slice(0, 10);
              a.href = url;
              a.download = `sirjazper-export-${today}.json`;
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              URL.revokeObjectURL(url);
            } catch (e) {
              alert(e instanceof Error ? e.message : "Export failed");
            }
          }

          return (
            <div style={{ padding: "var(--sp-4) 0", display: "flex", flexDirection: "column", gap: "var(--sp-4)" }}>
              <Section title="Export & Backup">
                <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}>
                  <p style={{ fontSize: 12, color: "var(--color-text-muted)", margin: 0 }}>
                    Download all your data as a single JSON file — tasks, contacts, job applications, knowledge base,
                    habits, and notifications. Use this for backups or to migrate to another system.
                  </p>
                  <div className="sj-card" style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
                    {[
                      ["Tasks", "All tasks with status, priority, and due dates"],
                      ["Contacts", "CRM entries with company, email, and notes"],
                      ["Applications", "Job applications with cover letters"],
                      ["Knowledge", "Saved articles and notes"],
                      ["Habits", "Habit definitions and completion history (last 365 days)"],
                      ["Notifications", "Last 500 agent notifications"],
                    ].map(([label, desc]) => (
                      <div key={label} style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)", padding: "2px 0" }}>
                        <span style={{ fontSize: 11, fontWeight: 500, color: "var(--color-text)", width: 100, flexShrink: 0 }}>{label}</span>
                        <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>{desc}</span>
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={handleExport}
                    style={{
                      background: "var(--color-accent)", border: "none", borderRadius: "var(--r-sm)",
                      padding: "10px 20px", fontSize: 13, color: "#fff", cursor: "pointer",
                      fontWeight: 500, display: "flex", alignItems: "center", gap: "var(--sp-2)",
                      justifyContent: "center",
                    }}
                  >
                    ⬇ Export All Data (JSON)
                  </button>
                  <p style={{ fontSize: 11, color: "var(--color-text-muted)", margin: 0, textAlign: "center" }}>
                    File will download as <code style={{ fontFamily: "var(--font-mono)" }}>sirjazper-export-YYYY-MM-DD.json</code>
                  </p>
                </div>
              </Section>

              <Section title="Data Summary" defaultOpen={false}>
                <p style={{ fontSize: 12, color: "var(--color-text-muted)", margin: 0 }}>
                  Visit the Dashboard, Tasks, Contacts, and other panels to see live counts.
                  The export includes everything visible across all panels.
                </p>
              </Section>
            </div>
          );
        })()}

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
