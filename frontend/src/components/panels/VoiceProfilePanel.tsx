"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
  Mic, MicOff, Play, Square, CheckCircle, RefreshCw,
  ChevronDown, Volume2, User, Brain,
} from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

// ── Types ─────────────────────────────────────────────────────────────────────

type Gender = "male" | "female";
type AgeGroup = "teen" | "young_adult" | "adult" | "mature" | "elder";

type AnalysisResult = {
  analyzed: boolean;
  mean_f0_hz?: number;
  age_range?: string;
  gender?: string;
  confidence?: number;
  duration_s?: number;
  reason?: string;
};

type VoiceVariant = {
  id: string;
  label: string;
  emoji: string;
  voice: string;
  prosody: string;
};

type Assignment = { voice_id: string; prosody: string };

// ── TIPI questionnaire ────────────────────────────────────────────────────────

const TIPI_QUESTIONS = [
  { id: 1,  text: "I see myself as extraverted, enthusiastic.",          trait: "extraversion",      reverse: false },
  { id: 2,  text: "I see myself as critical, quarrelsome.",              trait: "agreeableness",     reverse: true  },
  { id: 3,  text: "I see myself as dependable, self-disciplined.",       trait: "conscientiousness", reverse: false },
  { id: 4,  text: "I see myself as anxious, easily upset.",              trait: "neuroticism",       reverse: false },
  { id: 5,  text: "I see myself as open to new experiences, complex.",   trait: "openness",          reverse: false },
  { id: 6,  text: "I see myself as reserved, quiet.",                    trait: "extraversion",      reverse: true  },
  { id: 7,  text: "I see myself as sympathetic, warm.",                  trait: "agreeableness",     reverse: false },
  { id: 8,  text: "I see myself as disorganized, careless.",             trait: "conscientiousness", reverse: true  },
  { id: 9,  text: "I see myself as calm, emotionally stable.",           trait: "neuroticism",       reverse: true  },
  { id: 10, text: "I see myself as conventional, uncreative.",           trait: "openness",          reverse: true  },
] as const;

const TRAIT_LABELS: Record<string, string> = {
  openness: "Openness", conscientiousness: "Conscientiousness",
  extraversion: "Extraversion", agreeableness: "Agreeableness", neuroticism: "Neuroticism",
};

const TRAIT_COLORS: Record<string, string> = {
  openness: "#8b5cf6", conscientiousness: "#3b82f6",
  extraversion: "#f59e0b", agreeableness: "#22c55e", neuroticism: "#ef4444",
};

const TRAIT_DESC: Record<string, [string, string]> = {
  openness:          ["conventional",  "creative & curious"],
  conscientiousness: ["spontaneous",   "organized & disciplined"],
  extraversion:      ["introverted",   "extraverted & bold"],
  agreeableness:     ["competitive",   "cooperative & warm"],
  neuroticism:       ["emotionally stable", "anxious & reactive"],
};

const PERSONALITIES = [
  { id: "past-self",      name: "Past Self",      emoji: "⏪" },
  { id: "current-self",   name: "Current Self",   emoji: "🎯" },
  { id: "future-self",    name: "Future Self",    emoji: "🚀" },
  { id: "logical-self",   name: "Logical Self",   emoji: "🧮" },
  { id: "emotional-self", name: "Emotional Self", emoji: "❤️" },
];

// ── Utility: compute TIPI scores ──────────────────────────────────────────────

function computeBigFive(answers: Record<number, number>): Record<string, number> {
  const sums: Record<string, number[]> = {
    openness: [], conscientiousness: [], extraversion: [],
    agreeableness: [], neuroticism: [],
  };
  for (const q of TIPI_QUESTIONS) {
    const raw = answers[q.id];
    if (raw === undefined) continue;
    const val = q.reverse ? (8 - raw) : raw;
    sums[q.trait].push(val);
  }
  const result: Record<string, number> = {};
  for (const [trait, vals] of Object.entries(sums)) {
    const avg = vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : 4;
    result[trait] = Math.round(((avg - 1) / 6) * 100);
  }
  return result;
}

// ── Small components ──────────────────────────────────────────────────────────

function TraitBar({ trait, value, label }: { trait: string; value: number; label: string }) {
  const color = TRAIT_COLORS[trait] ?? "var(--color-accent)";
  const [lo, hi] = TRAIT_DESC[trait] ?? ["low", "high"];
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
        <span style={{ fontSize: 11, fontWeight: 600 }}>{label}</span>
        <span style={{ fontSize: 11, opacity: 0.6 }}>{value}%</span>
      </div>
      <div style={{ height: 6, borderRadius: 3, background: "var(--color-surface-float)", overflow: "hidden", position: "relative" }}>
        <div style={{ width: `${value}%`, height: "100%", borderRadius: 3, background: color, transition: "width 0.4s ease" }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 3 }}>
        <span style={{ fontSize: 9, opacity: 0.4 }}>{lo}</span>
        <span style={{ fontSize: 9, opacity: 0.4 }}>{hi}</span>
      </div>
    </div>
  );
}

function VoiceDropdown({
  value, onChange, voices,
}: { value: string; onChange: (v: string) => void; voices: string[] }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      style={{
        background: "var(--color-bg)", border: "1px solid var(--color-border)",
        borderRadius: 5, padding: "3px 6px", fontSize: 11, color: "var(--color-text)",
        cursor: "pointer", minWidth: 160,
      }}
    >
      {voices.map(v => (
        <option key={v} value={v}>{v.replace("en-US-", "").replace("Neural", "")}</option>
      ))}
    </select>
  );
}

// ── All available EN-US Edge-TTS voices (from /api/voice/voices, fallback list)
const FALLBACK_VOICES = [
  "en-US-AnaNeural","en-US-AriaNeural","en-US-AshleyNeural","en-US-BrandonNeural",
  "en-US-ChristopherNeural","en-US-CoraNeural","en-US-DavisNeural","en-US-ElizabethNeural",
  "en-US-EricNeural","en-US-GuyNeural","en-US-JacobNeural","en-US-JaneNeural",
  "en-US-JasonNeural","en-US-JennyNeural","en-US-MichelleNeural","en-US-MonicaNeural",
  "en-US-NancyNeural","en-US-RogerNeural","en-US-SaraNeural","en-US-SteffanNeural",
  "en-US-TonyNeural",
];

// ── Tab: Voice Profile ────────────────────────────────────────────────────────

function VoiceTab() {
  const [recording,    setRecording]    = useState(false);
  const [countdown,    setCountdown]    = useState(0);
  const [analysis,     setAnalysis]     = useState<AnalysisResult | null>(null);
  const [analyzing,    setAnalyzing]    = useState(false);
  const [assignments,  setAssignments]  = useState<Record<string, string>>({});
  const [prosodyMap,   setProsodyMap]   = useState<Record<string, string>>({});
  const [variants,     setVariants]     = useState<VoiceVariant[]>([]);
  const [voices,       setVoices]       = useState<string[]>(FALLBACK_VOICES);
  const [saved,        setSaved]        = useState(false);
  const [previewing,   setPreviewing]   = useState<string | null>(null);
  const [manualGender, setManualGender] = useState<Gender>("male");
  const [showManual,   setShowManual]   = useState(false);

  const recorderRef  = useRef<MediaRecorder | null>(null);
  const chunksRef    = useRef<Blob[]>([]);
  const timerRef     = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load existing config + available voices
  useEffect(() => {
    fetch(`${API}/api/voice-profile/config`)
      .then(r => r.json())
      .then(d => {
        if (d.voices && Object.keys(d.voices).length) {
          const va: Record<string, string> = {};
          const pa: Record<string, string> = {};
          for (const [pid, cfg] of Object.entries(d.voices as Record<string, Assignment>)) {
            va[pid] = cfg.voice_id;
            pa[pid] = cfg.prosody;
          }
          setAssignments(va);
          setProsodyMap(pa);
        }
      })
      .catch(() => {});

    fetch(`${API}/api/voice/voices`)
      .then(r => r.json())
      .then(d => {
        if (d.voices?.length) setVoices(d.voices.map((v: { short: string }) => v.short));
      })
      .catch(() => {});
  }, []);

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
      chunksRef.current = [];
      recorder.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
        handleAudioReady(new Blob(chunksRef.current, { type: "audio/webm" }));
      };
      recorder.start(200);
      recorderRef.current = recorder;
      setRecording(true);
      setCountdown(12);
      timerRef.current = setInterval(() => {
        setCountdown(c => {
          if (c <= 1) { stopRecording(); return 0; }
          return c - 1;
        });
      }, 1000);
    } catch {
      alert("Microphone access denied. Please allow mic access and try again.");
    }
  }

  function stopRecording() {
    if (timerRef.current) clearInterval(timerRef.current);
    recorderRef.current?.stop();
    setRecording(false);
    setCountdown(0);
  }

  async function handleAudioReady(blob: Blob) {
    setAnalyzing(true);
    const form = new FormData();
    form.append("file", blob, "voice_sample.webm");
    try {
      const r = await fetch(`${API}/api/voice-profile/analyze`, { method: "POST", body: form });
      const d = await r.json();
      setAnalysis(d.analysis);
      if (d.assignments) setAssignments(d.assignments);
      if (d.variants)    setVariants(d.variants);
      if (d.manual_mode) setShowManual(true);
      // Persist to DB
      if (d.analysis?.analyzed) {
        const base = d.base_voice ?? d.assignments?.["current-self"] ?? "";
        fetch(`${API}/api/voice-profile/profile`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...d.analysis, base_voice: base }),
        }).catch(() => {});
      }
    } catch {
      setAnalysis({ analyzed: false, reason: "Network error" });
      setShowManual(true);
    }
    setAnalyzing(false);
  }

  async function applyManual() {
    const r = await fetch(`${API}/api/voice-profile/manual`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gender: manualGender, age_range: "adult" }),
    });
    const d = await r.json();
    if (d.assignments) setAssignments(d.assignments);
    if (d.variants)    setVariants(d.variants);
    setShowManual(false);
  }

  async function previewVoice(voice: string, prosody: string, label: string) {
    setPreviewing(label);
    try {
      const r = await fetch(`${API}/api/voice-profile/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          voice, prosody,
          text: "Hello. I am a version of you. Ask me anything about your decisions, your past, or where you are headed.",
        }),
      });
      const blob = await r.blob();
      const url  = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.onended = () => { URL.revokeObjectURL(url); setPreviewing(null); };
      audio.play();
    } catch { setPreviewing(null); }
  }

  async function saveAll() {
    const assignments_payload = PERSONALITIES.map(p => ({
      personality_id: p.id,
      voice_id:       assignments[p.id] ?? "en-US-DavisNeural",
      prosody:        prosodyMap[p.id]  ?? "",
    }));
    await fetch(`${API}/api/voice-profile/voices`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assignments: assignments_payload }),
    });
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  }

  const baseVoice = assignments["current-self"] ?? "en-US-DavisNeural";

  return (
    <div style={{ padding: "16px 18px", display: "flex", flexDirection: "column", gap: 20, overflowY: "auto", flex: 1 }}>

      {/* ── Step 1: Record ─────────────────────────────────────────────────── */}
      <section>
        <div style={{ fontSize: 11, fontWeight: 700, opacity: 0.5, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 10 }}>
          Step 1 — Record your voice
        </div>

        <div style={{
          background: "var(--color-surface)", border: "1px solid var(--color-border)",
          borderRadius: 10, padding: 16, display: "flex", flexDirection: "column", alignItems: "center", gap: 12,
        }}>
          <p style={{ fontSize: 12, opacity: 0.65, textAlign: "center", margin: 0, lineHeight: 1.6 }}>
            Record ~10 seconds of your natural speaking voice.<br />
            AI will analyze pitch and suggest matching voices for each personality.
          </p>

          {!recording && !analyzing && (
            <button
              onClick={startRecording}
              style={{
                display: "flex", alignItems: "center", gap: 8,
                background: "var(--color-accent)", border: "none", borderRadius: 8,
                padding: "10px 24px", fontSize: 13, fontWeight: 700, color: "#000",
                cursor: "pointer",
              }}
            >
              <Mic size={16} /> Start Recording
            </button>
          )}

          {recording && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
              <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                {[...Array(12)].map((_, i) => (
                  <div key={i} style={{
                    width: 4, borderRadius: 2,
                    height: 8 + Math.sin(i * 0.8 + Date.now() / 300) * 8,
                    background: i < (12 - countdown) ? "var(--color-accent)" : "var(--color-border)",
                    transition: "all 0.1s",
                  }} />
                ))}
              </div>
              <span style={{ fontSize: 12, opacity: 0.6 }}>Recording… {countdown}s remaining</span>
              <button onClick={stopRecording} style={{
                display: "flex", alignItems: "center", gap: 6,
                background: "#ef4444", border: "none", borderRadius: 6,
                padding: "6px 16px", fontSize: 12, color: "#fff", cursor: "pointer",
              }}>
                <Square size={12} /> Stop Early
              </button>
            </div>
          )}

          {analyzing && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, opacity: 0.7, fontSize: 12 }}>
              <RefreshCw size={14} style={{ animation: "spin 1s linear infinite" }} /> Analyzing pitch…
            </div>
          )}

          {analysis && (
            <div style={{
              background: analysis.analyzed ? "rgba(34,197,94,0.08)" : "rgba(245,158,11,0.08)",
              border: `1px solid ${analysis.analyzed ? "rgba(34,197,94,0.25)" : "rgba(245,158,11,0.25)"}`,
              borderRadius: 7, padding: "10px 14px", width: "100%",
            }}>
              {analysis.analyzed ? (
                <div style={{ fontSize: 12, lineHeight: 1.7 }}>
                  <div><strong>Detected gender:</strong> {analysis.gender}</div>
                  <div><strong>Avg pitch:</strong> {analysis.mean_f0_hz?.toFixed(0)} Hz</div>
                  <div><strong>Age range:</strong> {analysis.age_range}</div>
                  <div><strong>Duration:</strong> {analysis.duration_s}s</div>
                  <div style={{ fontSize: 10, opacity: 0.5, marginTop: 4 }}>Confidence: {((analysis.confidence ?? 0) * 100).toFixed(0)}%</div>
                </div>
              ) : (
                <div style={{ fontSize: 12, color: "#f59e0b" }}>
                  Auto-analysis unavailable ({analysis.reason ?? "unknown"}).<br />
                  Use manual selection below.
                </div>
              )}
            </div>
          )}

          {/* Manual fallback */}
          {(showManual || (!analysis?.analyzed && analysis)) && (
            <div style={{ width: "100%", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 11, opacity: 0.6 }}>Select manually:</span>
              {(["male", "female"] as Gender[]).map(g => (
                <button key={g} onClick={() => setManualGender(g)} style={{
                  padding: "4px 12px", borderRadius: 5, fontSize: 11, cursor: "pointer",
                  background: manualGender === g ? "var(--color-accent)" : "var(--color-surface)",
                  color:      manualGender === g ? "#000" : "var(--color-text)",
                  border:     "1px solid var(--color-border)", fontWeight: manualGender === g ? 700 : 400,
                }}>
                  {g === "male" ? "👨 Male" : "👩 Female"}
                </button>
              ))}
              <button onClick={applyManual} style={{
                padding: "4px 12px", borderRadius: 5, fontSize: 11, cursor: "pointer",
                background: "var(--color-surface)", border: "1px solid var(--color-border)", color: "var(--color-text)",
              }}>
                Apply →
              </button>
            </div>
          )}
        </div>
      </section>

      {/* ── Step 2: Age / Gender variants ────────────────────────────────────── */}
      {variants.length > 0 && (
        <section>
          <div style={{ fontSize: 11, fontWeight: 700, opacity: 0.5, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 10 }}>
            Step 2 — Hear your voice variants
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {variants.map(v => (
              <div key={v.id} style={{
                background: "var(--color-surface)", border: "1px solid var(--color-border)",
                borderRadius: 8, padding: "10px 14px", minWidth: 130, flex: "1 1 130px",
              }}>
                <div style={{ fontSize: 18, marginBottom: 4 }}>{v.emoji}</div>
                <div style={{ fontSize: 11, fontWeight: 600, marginBottom: 2 }}>{v.label}</div>
                <div style={{ fontSize: 10, opacity: 0.45, marginBottom: 8 }}>
                  {v.voice.replace("en-US-", "").replace("Neural", "")}
                  {v.prosody && <span style={{ marginLeft: 4, color: "var(--color-accent)" }}>♬</span>}
                </div>
                <button
                  onClick={() => previewVoice(v.voice, v.prosody, v.id)}
                  disabled={previewing === v.id}
                  style={{
                    display: "flex", alignItems: "center", gap: 5,
                    background: "none", border: "1px solid var(--color-border)", borderRadius: 5,
                    padding: "3px 8px", fontSize: 10, cursor: "pointer", color: "var(--color-text)",
                    opacity: previewing === v.id ? 0.5 : 1,
                  }}
                >
                  {previewing === v.id ? <RefreshCw size={10} /> : <Play size={10} />}
                  {previewing === v.id ? "Playing…" : "Preview"}
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Step 3: Per-personality voice assignment ──────────────────────────── */}
      {Object.keys(assignments).length > 0 && (
        <section>
          <div style={{ fontSize: 11, fontWeight: 700, opacity: 0.5, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 10 }}>
            Step 3 — Assign voice per personality
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {PERSONALITIES.map(p => {
              const voice   = assignments[p.id] ?? baseVoice;
              const prosody = prosodyMap[p.id]  ?? "";
              return (
                <div key={p.id} style={{
                  display: "flex", alignItems: "center", gap: 10,
                  background: "var(--color-surface)", border: "1px solid var(--color-border)",
                  borderRadius: 7, padding: "8px 12px",
                }}>
                  <span style={{ fontSize: 18, flexShrink: 0 }}>{p.emoji}</span>
                  <span style={{ fontSize: 11, fontWeight: 600, flex: 1, minWidth: 90 }}>{p.name}</span>
                  <VoiceDropdown
                    value={voice}
                    voices={voices}
                    onChange={v => setAssignments(prev => ({ ...prev, [p.id]: v }))}
                  />
                  <button
                    onClick={() => previewVoice(voice, prosody, p.id)}
                    disabled={previewing === p.id}
                    title="Preview this voice"
                    style={{
                      background: "none", border: "1px solid var(--color-border)", borderRadius: 5,
                      padding: "3px 7px", cursor: "pointer", color: "var(--color-text)", flexShrink: 0,
                      opacity: previewing === p.id ? 0.5 : 1,
                    }}
                  >
                    {previewing === p.id ? <RefreshCw size={11} /> : <Volume2 size={11} />}
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* ── Save ─────────────────────────────────────────────────────────────── */}
      {Object.keys(assignments).length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, paddingBottom: 8 }}>
          <button
            onClick={saveAll}
            style={{
              background: "var(--color-accent)", border: "none", borderRadius: 7,
              padding: "8px 20px", fontSize: 12, fontWeight: 700, color: "#000", cursor: "pointer",
            }}
          >
            Save Voice Profile
          </button>
          {saved && (
            <span style={{ fontSize: 12, color: "#22c55e", display: "flex", alignItems: "center", gap: 4 }}>
              <CheckCircle size={13} /> Saved
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// ── Tab: Big Five ─────────────────────────────────────────────────────────────

function BigFiveTab() {
  const [answers, setAnswers]   = useState<Record<number, number>>({});
  const [saved,   setSaved]     = useState(false);
  const [saving,  setSaving]    = useState(false);
  const [overrides, setOverrides] = useState<Record<string, Record<string, number>> | null>(null);

  const scores    = computeBigFive(answers);
  const allFilled = Object.keys(answers).length === TIPI_QUESTIONS.length;

  // Load saved Big Five on mount
  useEffect(() => {
    fetch(`${API}/api/voice-profile/config`)
      .then(r => r.json())
      .then(d => {
        if (!d.profile) return;
        const p = d.profile;
        const prefilled: Record<string, number> = {
          openness: p.openness, conscientiousness: p.conscientiousness,
          extraversion: p.extraversion, agreeableness: p.agreeableness, neuroticism: p.neuroticism,
        };
        // Reverse-map scores to approximate TIPI answers (just seed the bars)
        setAnswers(prev => {
          if (Object.keys(prev).length) return prev;  // don't overwrite if user already touched
          return {};  // can't reverse TIPI exactly; just show empty so user re-fills
        });
      })
      .catch(() => {});
  }, []);

  async function handleSave() {
    setSaving(true);
    try {
      const r = await fetch(`${API}/api/voice-profile/big-five`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(scores),
      });
      const d = await r.json();
      setOverrides(d.trait_overrides ?? null);
      setSaved(true);
      setTimeout(() => setSaved(false), 4000);
    } catch { /* offline */ }
    setSaving(false);
  }

  return (
    <div style={{ padding: "16px 18px", overflowY: "auto", flex: 1, display: "flex", flexDirection: "column", gap: 20 }}>

      {/* Intro */}
      <div style={{
        background: "rgba(139,92,246,0.07)", border: "1px solid rgba(139,92,246,0.2)",
        borderRadius: 8, padding: "12px 14px",
      }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#8b5cf6", marginBottom: 6 }}>TIPI — Ten-Item Personality Inventory</div>
        <p style={{ fontSize: 11, opacity: 0.7, margin: 0, lineHeight: 1.6 }}>
          Rate how well each description fits you on a 1–7 scale.
          Your Big Five scores auto-tune each personality's emotional weight, logic level, and risk tolerance.
        </p>
      </div>

      {/* Questions */}
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {TIPI_QUESTIONS.map(q => (
          <div key={q.id}>
            <div style={{ fontSize: 12, marginBottom: 6, lineHeight: 1.5 }}>
              <span style={{ opacity: 0.4, marginRight: 6, fontSize: 10 }}>{q.id}.</span>
              {q.text}
              {q.reverse && <span style={{ opacity: 0.35, fontSize: 10, marginLeft: 6 }}>(reversed)</span>}
            </div>
            <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
              <span style={{ fontSize: 9, opacity: 0.4, width: 60 }}>Disagree</span>
              {[1, 2, 3, 4, 5, 6, 7].map(val => (
                <button
                  key={val}
                  onClick={() => setAnswers(prev => ({ ...prev, [q.id]: val }))}
                  style={{
                    width: 30, height: 30, borderRadius: "50%", flexShrink: 0,
                    border: `2px solid ${answers[q.id] === val ? TRAIT_COLORS[q.trait] : "var(--color-border)"}`,
                    background: answers[q.id] === val ? TRAIT_COLORS[q.trait] : "var(--color-surface)",
                    color: answers[q.id] === val ? "#fff" : "var(--color-text)",
                    cursor: "pointer", fontSize: 11, fontWeight: 600,
                    transition: "all 0.15s",
                  }}
                >
                  {val}
                </button>
              ))}
              <span style={{ fontSize: 9, opacity: 0.4, width: 60, textAlign: "right" }}>Agree</span>
            </div>
          </div>
        ))}
      </div>

      {/* Live scores */}
      {Object.keys(answers).length > 0 && (
        <section>
          <div style={{ fontSize: 11, fontWeight: 700, opacity: 0.5, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 12 }}>
            Your Big Five profile
          </div>
          {Object.entries(TRAIT_LABELS).map(([trait, label]) => (
            <TraitBar key={trait} trait={trait} value={scores[trait] ?? 50} label={label} />
          ))}
        </section>
      )}

      {/* Save */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, paddingBottom: 8 }}>
        <button
          onClick={handleSave}
          disabled={!allFilled || saving}
          style={{
            background: allFilled ? "var(--color-accent)" : "var(--color-surface)",
            border: "1px solid var(--color-border)", borderRadius: 7,
            padding: "8px 20px", fontSize: 12, fontWeight: 700,
            color: allFilled ? "#000" : "var(--color-text-muted)",
            cursor: allFilled ? "pointer" : "not-allowed",
            opacity: saving ? 0.6 : 1,
          }}
        >
          {saving ? "Applying…" : "Apply to My Phases"}
        </button>
        {saved && (
          <span style={{ fontSize: 12, color: "#22c55e", display: "flex", alignItems: "center", gap: 4 }}>
            <CheckCircle size={13} /> Applied — personalities updated
          </span>
        )}
        {!allFilled && (
          <span style={{ fontSize: 11, opacity: 0.4 }}>Answer all 10 questions to apply</span>
        )}
      </div>

      {/* Trait overrides preview */}
      {overrides && (
        <section style={{ paddingBottom: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, opacity: 0.5, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 10 }}>
            Updated personality traits
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {Object.entries(overrides).map(([pid, traits]) => {
              const p = PERSONALITIES.find(x => x.id === pid);
              if (!p) return null;
              return (
                <div key={pid} style={{
                  background: "var(--color-surface)", border: "1px solid var(--color-border)",
                  borderRadius: 7, padding: "8px 12px", display: "flex", gap: 10, alignItems: "center",
                }}>
                  <span style={{ fontSize: 16, flexShrink: 0 }}>{p.emoji}</span>
                  <div style={{ flex: 1, display: "flex", flexWrap: "wrap", gap: 12 }}>
                    {Object.entries(traits as Record<string, number>).map(([k, v]) => (
                      <span key={k} style={{ fontSize: 10 }}>
                        <span style={{ opacity: 0.5 }}>{k.replace(/([A-Z])/g, " $1").trim()}: </span>
                        <strong>{Math.round((v as number) * 100)}%</strong>
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

// ── Tab: Timeline ─────────────────────────────────────────────────────────────

function TimelineTab() {
  const [year,     setYear]     = useState(2020);
  const [persona,  setPersona]  = useState<Record<string, unknown> | null>(null);
  const [loading,  setLoading]  = useState(false);
  const [messages, setMessages] = useState<{ role: string; content: string; id: string }[]>([]);
  const [input,    setInput]    = useState("");
  const [thinking, setThinking] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => loadPersona(year), 400);
  }, [year]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function loadPersona(y: number) {
    setLoading(true);
    try {
      const r = await fetch(`${API}/api/phases/timeline/persona?year=${y}`);
      const d = await r.json();
      setPersona(d);
    } catch { setPersona(null); }
    setLoading(false);
  }

  async function sendMessage() {
    if (!input.trim() || thinking) return;
    const text = input.trim();
    setInput("");
    const userMsg = { role: "user", content: text, id: Date.now().toString() };
    setMessages(prev => [...prev, userMsg]);
    setThinking(true);

    const history = messages.slice(-8).map(m => ({ role: m.role === "user" ? "user" : "assistant", content: m.content }));

    try {
      const res = await fetch(`${API}/api/phases/timeline`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year, message: text, history }),
      });

      const reader  = res.body!.getReader();
      const decoder = new TextDecoder();
      let msgId = `era-${Date.now()}`;
      let buffer = "";

      setMessages(prev => [...prev, { role: "personality", content: "", id: msgId }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (raw === "[DONE]") break;
          try {
            const evt = JSON.parse(raw);
            if (evt.type === "token") {
              setMessages(prev => prev.map(m => m.id === msgId ? { ...m, content: m.content + evt.text } : m));
            }
          } catch { /* non-JSON */ }
        }
      }
    } catch (e) {
      setMessages(prev => [...prev, { role: "personality", content: `Error: ${e}`, id: Date.now().toString() }]);
    }
    setThinking(false);
  }

  const yearLabel = (y: number) => {
    if (y < 2018) return "Pre-formation";
    if (y < 2022) return "Early career";
    if (y < 2025) return "Building phase";
    if (y === 2025) return "Today";
    if (y < 2030) return "Near future";
    return "Far future";
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, overflow: "hidden" }}>

      {/* Year selector */}
      <div style={{ padding: "14px 18px", borderBottom: "1px solid var(--color-border)", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
          <span style={{ fontSize: 24 }}>🕰️</span>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700 }}>Year {year}</div>
            <div style={{ fontSize: 11, opacity: 0.5 }}>{yearLabel(year)}</div>
          </div>
          <button onClick={() => setMessages([])} style={{
            marginLeft: "auto", background: "none", border: "1px solid var(--color-border)",
            borderRadius: 5, padding: "3px 10px", fontSize: 10, cursor: "pointer", color: "var(--color-text-muted)",
          }}>
            Clear
          </button>
        </div>

        <input
          type="range" min={2010} max={2040} step={1} value={year}
          onChange={e => setYear(Number(e.target.value))}
          style={{ width: "100%", accentColor: "var(--color-accent)" }}
        />
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, opacity: 0.4 }}>
          <span>2010</span><span>2025 (now)</span><span>2040</span>
        </div>

        {/* Interpolated traits mini-preview */}
        {!loading && persona && (
          <div style={{ display: "flex", gap: 12, marginTop: 10, flexWrap: "wrap" }}>
            {(["riskTolerance", "logicLevel", "emotionLevel", "optimism"] as const).map(k => (
              <div key={k} style={{ fontSize: 10, display: "flex", alignItems: "center", gap: 5 }}>
                <span style={{ opacity: 0.5 }}>{k.replace(/([A-Z])/g, " $1").trim()}:</span>
                <div style={{ width: 50, height: 4, borderRadius: 2, background: "var(--color-border)", overflow: "hidden" }}>
                  <div style={{ width: `${(persona[k] as number) * 100}%`, height: "100%", background: "var(--color-accent)", borderRadius: 2 }} />
                </div>
                <span style={{ opacity: 0.6 }}>{Math.round((persona[k] as number) * 100)}%</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Messages */}
      <div style={{ flex: 1, overflowY: "auto", padding: "14px 18px" }}>
        {messages.length === 0 && (
          <div style={{ textAlign: "center", marginTop: 40, opacity: 0.4 }}>
            <div style={{ fontSize: 32, marginBottom: 8 }}>🕰️</div>
            <p style={{ fontSize: 12, margin: 0 }}>You in {year}.</p>
            <p style={{ fontSize: 11, marginTop: 6 }}>Ask anything — what were you thinking? what did you fear? what did you hope?</p>
          </div>
        )}
        {messages.map(m => (
          <div key={m.id} style={{ marginBottom: 12, display: "flex", justifyContent: m.role === "user" ? "flex-end" : "flex-start" }}>
            {m.role !== "user" && <span style={{ fontSize: 16, marginRight: 8, flexShrink: 0, marginTop: 2 }}>🕰️</span>}
            <div style={{
              maxWidth: "75%", padding: "8px 12px", fontSize: 12, lineHeight: 1.7,
              background:   m.role === "user" ? "var(--color-accent)" : "var(--color-surface)",
              color:        m.role === "user" ? "#000" : "var(--color-text)",
              borderRadius: m.role === "user" ? "12px 12px 2px 12px" : "2px 12px 12px 12px",
            }}>
              {m.content || <span style={{ opacity: 0.4 }}>…</span>}
            </div>
          </div>
        ))}
        {thinking && (
          <div style={{ fontSize: 12, opacity: 0.45, display: "flex", gap: 6, alignItems: "center" }}>
            <span>🕰️</span> thinking from {year}…
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* Input */}
      <div style={{ padding: "10px 18px", borderTop: "1px solid var(--color-border)", display: "flex", gap: 8, flexShrink: 0 }}>
        <input
          value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
          placeholder={`Ask yourself from ${year}…`}
          style={{
            flex: 1, background: "var(--color-bg)", border: "1px solid var(--color-border)",
            borderRadius: 6, padding: "7px 10px", fontSize: 12, color: "var(--color-text)", outline: "none",
          }}
        />
        <button
          onClick={sendMessage}
          disabled={!input.trim() || thinking}
          style={{
            background: "var(--color-accent)", border: "none", borderRadius: 6,
            padding: "0 16px", fontSize: 12, fontWeight: 700, color: "#000",
            cursor: "pointer", opacity: (!input.trim() || thinking) ? 0.4 : 1,
          }}
        >
          Ask
        </button>
      </div>
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

type Tab = "voice" | "big5" | "timeline";

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: "voice",    label: "Voice Profile", icon: <Mic size={12} />   },
  { id: "big5",     label: "Big Five",      icon: <Brain size={12} /> },
  { id: "timeline", label: "Timeline",      icon: <span style={{ fontSize: 12 }}>🕰️</span> },
];

export function VoiceProfilePanel() {
  const [tab, setTab] = useState<Tab>("voice");

  return (
    <div className="sj-panel" style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>

      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 18px 0", flexShrink: 0, borderBottom: "1px solid var(--color-border)", paddingBottom: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, flex: 1 }}>
          <User size={14} style={{ opacity: 0.6 }} />
          <span style={{ fontSize: 13, fontWeight: 700 }}>Voice & Personality Profile</span>
        </div>
        <div style={{ display: "flex" }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              display: "flex", alignItems: "center", gap: 5,
              padding: "8px 14px", fontSize: 11, fontWeight: tab === t.id ? 700 : 400,
              background: "none", border: "none", cursor: "pointer",
              color: tab === t.id ? "var(--color-accent)" : "var(--color-text-muted)",
              borderBottom: tab === t.id ? "2px solid var(--color-accent)" : "2px solid transparent",
              transition: "all 0.15s",
            }}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {tab === "voice"    && <VoiceTab />}
        {tab === "big5"     && <BigFiveTab />}
        {tab === "timeline" && <TimelineTab />}
      </div>
    </div>
  );
}
