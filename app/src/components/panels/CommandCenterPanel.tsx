"use client";

import { useEffect, useState, useRef } from "react";
import dynamic from "next/dynamic";
import { motion, AnimatePresence } from "framer-motion";
import {
  Crown, Brain, Radio, Settings2, Code2, Shield, BarChart2,
  FlaskConical, Network, Palette, User, Megaphone, TrendingUp,
  Wallet, Users, X, RefreshCw, Wifi, WifiOff, ChevronRight, Building2, Activity, ExternalLink, GitBranch,
  Mic, MicOff, Volume2, VolumeX, Settings, Trash2, Save, Map as MapIcon,
  Box, Activity as ActivityIcon, Mail, ListTodo, TerminalSquare,
} from "lucide-react";
import { usePipelineStore } from "@/stores/pipelineStore";
import type { LucideIcon } from "lucide-react";
import { useAgentStore, connectCommandCenterWS } from "@/stores/agentStore";
import type { AgentLive, DeptLive } from "@/stores/agentStore";
import { FloorView, ActivityView, MessagesView, TasksView, TerminalsView } from "./CommandCenterViews";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

// ── Dynamic import (no SSR — Canvas uses WebGL) ───────────────────────────────

const CommandCenter3DScene = dynamic(
  () => import("./CommandCenter3DScene"),
  {
    ssr: false,
    loading: () => (
      <div style={{
        flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
        background: "#04040f", color: "#333355", flexDirection: "column", gap: 12,
      }}>
        <Building2 size={36} />
        <span style={{ fontSize: 12, letterSpacing: "0.1em" }}>INITIALISING 3D SCENE…</span>
      </div>
    ),
  }
);

// ── Department sidebar metadata ───────────────────────────────────────────────

interface DeptMeta { display: string; icon: LucideIcon; color: string }

const DEPT_META: Record<string, DeptMeta> = {
  executive:      { display: "Executive",      icon: Crown,        color: "#f59e0b" },
  intelligence:   { display: "Intelligence",   icon: Brain,        color: "#8b5cf6" },
  communications: { display: "Communications", icon: Radio,        color: "#3b82f6" },
  operations:     { display: "Operations",     icon: Settings2,    color: "#10b981" },
  it:             { display: "IT Department",  icon: Code2,        color: "#06b6d4" },
  security:       { display: "Security",       icon: Shield,       color: "#ef4444" },
  analytics:      { display: "Analytics",      icon: BarChart2,    color: "#f97316" },
  research:       { display: "Research",       icon: FlaskConical, color: "#a78bfa" },
  relations:      { display: "Relations",      icon: Network,      color: "#ec4899" },
  creative:       { display: "Creative",       icon: Palette,      color: "#f43f5e" },
  personal:       { display: "Personal",       icon: User,         color: "#94a3b8" },
  marketing:      { display: "Marketing",      icon: Megaphone,    color: "#fb923c" },
  sales:          { display: "Sales",          icon: TrendingUp,   color: "#22c55e" },
  finance:        { display: "Finance",        icon: Wallet,       color: "#eab308" },
  hr:             { display: "HR",             icon: Users,        color: "#ec4899" },
};

function deptMeta(deptId: string, fallbackColor?: string): DeptMeta {
  return DEPT_META[deptId] ?? {
    display: deptId,
    icon: Activity,
    color: fallbackColor ?? "#64748b",
  };
}

// ── Utilities ─────────────────────────────────────────────────────────────────

function dicebearUrl(style: string, seed: string) {
  return `https://api.dicebear.com/7.x/${style}/svg?seed=${encodeURIComponent(seed)}`;
}

function agentAvatarUrl(agent: AgentLive): string {
  if (agent.avatar_source === "custom" && agent.avatar_custom_path)
    return `${API}${agent.avatar_custom_path}`;
  return dicebearUrl(agent.avatar_style || "bottts", agent.avatar_seed || agent.codename);
}

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  return `${Math.floor(s / 60)}m ago`;
}

// ── Small UI atoms ────────────────────────────────────────────────────────────

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
      <span style={{ fontSize: 9, color: "var(--color-text-dim)", textTransform: "uppercase", letterSpacing: "0.07em" }}>
        {label}
      </span>
      <span style={{ fontSize: 13, fontWeight: 700, color, lineHeight: 1 }}>{value}</span>
    </div>
  );
}

// ── Agent pipeline activity widget (embeds in Overview tab) ──────────────────

function AgentPipelineActivity({ codename, accent }: { codename: string; accent: string }) {
  const runs = usePipelineStore(s => s.runs);

  const recentRuns = runs
    .filter(r => r.nodes.some(n => n.id === `agent-${codename}`))
    .slice(0, 4);

  if (recentRuns.length === 0) return (
    <div style={{ background: "var(--color-card-inner)", borderRadius: 7, padding: "10px 12px" }}>
      <div style={{ fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--color-text-dim)", marginBottom: 6, display: "flex", gap: 5, alignItems: "center" }}>
        <GitBranch size={9} /> Recent Pipeline Runs
      </div>
      <div style={{ fontSize: 10, color: "#475569" }}>No pipeline runs yet</div>
    </div>
  );

  return (
    <div style={{ background: "var(--color-card-inner)", borderRadius: 7, padding: "10px 12px" }}>
      <div style={{ fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--color-text-dim)", marginBottom: 7, display: "flex", gap: 5, alignItems: "center" }}>
        <GitBranch size={9} color={accent} /> Recent Pipeline Runs
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
        {recentRuns.map(run => {
          const node = run.nodes.find(n => n.id === `agent-${codename}`);
          const nodeStatus = node?.data.status ?? "pending";
          const statusColor: Record<string, string> = { done: "#10b981", running: "#f59e0b", error: "#ef4444", pending: "#475569" };
          const dur = run.finishedAt ? `${((run.finishedAt - run.startedAt) / 1000).toFixed(1)}s` : "live";
          return (
            <div key={run.id} style={{
              display: "flex", gap: 8, alignItems: "center",
              padding: "5px 7px", borderRadius: 5,
              background: `color-mix(in srgb, ${statusColor[nodeStatus]} 6%, transparent)`,
              borderLeft: `2px solid ${statusColor[nodeStatus]}`,
            }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 10, color: "var(--color-text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {run.query.slice(0, 35)}{run.query.length > 35 ? "…" : ""}
                </div>
                <div style={{ fontSize: 8, color: "var(--color-text-dim)", marginTop: 2 }}>
                  {node?.data.detail?.toString().slice(0, 40) ?? "—"}
                </div>
              </div>
              <div style={{ fontSize: 8, fontWeight: 800, color: statusColor[nodeStatus], textTransform: "uppercase", flexShrink: 0 }}>
                {dur}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Agent direct chat types ───────────────────────────────────────────────────

interface ToolPreview { ok?: boolean; summary: string; preview?: string }
interface ToolCall    { id: string; name: string; args: Record<string, unknown>; result?: ToolPreview; done?: boolean; approvalPending?: boolean }
interface ChatMsg     { id: string; role: "user" | "assistant"; content: string; streaming?: boolean; toolCalls?: ToolCall[] }
interface DeptChatMsg { id: string; role: "user" | "agent"; codename?: string; name?: string; emoji?: string; color?: string; content: string; streaming?: boolean }
interface LogEntry    { action_type: string; outcome: string; duration_ms: number | null; input_tokens: number | null; output_tokens: number | null; created_at: string | null }

// ── Voice helpers ─────────────────────────────────────────────────────────────

interface VoiceProfile { pitch: number; rate: number; lang: string; gender: "male" | "female"; intro: string }

const _VOICE_PROFILES: Record<string, VoiceProfile> = {
  jazper:  { pitch: 1.0,  rate: 1.0,  lang: "en-US", gender: "male",   intro: "I'm Jazper — the core operating system of this entire network. Every agent, every task, every decision flows through me." },
  sage:    { pitch: 0.9,  rate: 0.78, lang: "en-GB", gender: "female", intro: "Sage here. Head of Intelligence. I don't just gather information — I find the meaning hidden inside it. Ask me anything." },
  scout:   { pitch: 1.25, rate: 1.3,  lang: "en-US", gender: "male",   intro: "Scout. Senior Intelligence Agent. Fast, precise, always on the move. If it's out there, I'll find it." },
  phantom: { pitch: 0.6,  rate: 0.72, lang: "en-US", gender: "male",   intro: "Phantom. Head of Security. I don't raise alarms. I eliminate threats before you even know they existed. Stay sharp." },
  hermes:  { pitch: 1.1,  rate: 0.92, lang: "en-GB", gender: "male",   intro: "Hermes, Head of Communications. Every word carries weight. I craft messages that land exactly as intended — every time." },
  atlas:   { pitch: 0.82, rate: 1.18, lang: "en-US", gender: "male",   intro: "Atlas. Head of Operations. No fluff, no delays. I keep this whole operation moving. What do you need done?" },
  darwin:  { pitch: 0.78, rate: 0.85, lang: "en-GB", gender: "male",   intro: "Darwin, Engineering Manager for IT. I diagnose before I fix. Root cause, always. The system tells me everything if I listen carefully." },
  oracle:  { pitch: 0.68, rate: 0.88, lang: "en-US", gender: "male",   intro: "Oracle. IT Diagnostician. I read logs, traces, and stack dumps the way others read books. Nothing in this system is hidden from me." },
  forge:   { pitch: 0.88, rate: 1.08, lang: "en-US", gender: "male",   intro: "Forge. I write code — clean, targeted, production-ready. No bloat, no excuses. I ship things that actually work." },
  lens:    { pitch: 1.2,  rate: 1.12, lang: "en-US", gender: "female", intro: "Lens, Visual Intelligence Specialist. Everything is data. Every pixel, every pattern — it all means something. I find what others miss." },
};

const _DEFAULT_VOICE_PROFILE: VoiceProfile = { pitch: 1.0, rate: 1.0, lang: "en-US", gender: "male", intro: "Hello. I am an agent of the Sir Jazper network." };

function _pickVoice(lang: string, gender: "male" | "female"): SpeechSynthesisVoice | null {
  if (typeof window === "undefined") return null;
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;
  const prefix = lang.slice(0, 2).toLowerCase();
  const byLang = voices.filter(v => v.lang.toLowerCase().startsWith(prefix));
  const pool   = byLang.length ? byLang : voices;
  const femaleKw = /female|woman|zira|aria|jenny|natasha|samantha|karen|moira|fiona|victoria|ava|hazel|susan|kate|emma/i;
  const maleKw   = /male|man|david|mark|george|daniel|thomas|reed|guy|james|william|fred|albert|bruce|ryan|ryan/i;
  const match = gender === "female"
    ? pool.find(v => femaleKw.test(v.name)) ?? pool.find(v => !maleKw.test(v.name))
    : pool.find(v => maleKw.test(v.name))  ?? pool.find(v => !femaleKw.test(v.name));
  return match ?? pool[0] ?? null;
}

function speakAs(text: string, codename: string, prosodyOverride?: {pitch?: number; rate?: number; voiceName?: string}) {
  if (typeof window === "undefined" || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const prof = _VOICE_PROFILES[codename.toLowerCase()] ?? _DEFAULT_VOICE_PROFILE;
  const utt  = new SpeechSynthesisUtterance(text);
  // Priority: explicit voiceName override → auto gender-pick
  const explicitName = prosodyOverride?.voiceName;
  if (explicitName) {
    const voices = window.speechSynthesis.getVoices();
    const found  = voices.find(v => v.name === explicitName);
    if (found) utt.voice = found;
  } else {
    const voice = _pickVoice(prof.lang, prof.gender);
    if (voice) utt.voice = voice;
  }
  utt.pitch = prosodyOverride?.pitch ?? prof.pitch;
  utt.rate  = prosodyOverride?.rate  ?? prof.rate;
  window.speechSynthesis.speak(utt);
}

function agentIntro(codename: string, name?: string): string {
  return _VOICE_PROFILES[codename.toLowerCase()]?.intro
    ?? `Hello, I'm ${name ?? codename}. I'm an agent in the Sir Jazper network.`;
}

function stopSpeaking() {
  if (typeof window !== "undefined" && window.speechSynthesis)
    window.speechSynthesis.cancel();
}

function _toolLabel(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case "list_agents":           return args.department ? `Scanning ${args.department} agents…` : "Scanning all agents…";
    case "get_agent_info":        return `Reading ${args.codename}'s profile…`;
    case "update_agent_settings": return `Updating ${args.codename}'s settings…`;
    case "update_agent_status":   return `Setting ${args.codename} → ${args.status}…`;
    case "list_departments":      return "Checking department roster…";
    case "update_dept_settings":  return `Updating ${args.dept_id} department…`;
    case "create_agent":          return `Creating agent: ${args.codename}…`;
    case "delete_agent":          return `Decommissioning ${args.codename}…`;
    case "list_files":            return `Listing ${args.directory ?? "."}…`;
    case "read_file":             return `Reading ${args.path}…`;
    case "write_file":            return `Writing ${args.path}…`;
    case "run_command":           return `$ ${String(args.command ?? "").slice(0, 55)}…`;
    case "install_package":       return `Installing ${args.package_type === "npm" ? "npm" : "pip"}: ${args.package_name}…`;
    case "web_search":            return `Searching: "${args.query}"…`;
    case "save_memory":           return `Saving memory: "${args.key}"…`;
    case "recall_memory":         return args.key ? `Recalling "${args.key}"…` : `Searching memories…`;
    default:                      return `${name}…`;
  }
}

function _toolIcon(name: string): string {
  const map: Record<string, string> = {
    list_agents: "👥", get_agent_info: "👤",
    list_departments: "🏢", update_dept_settings: "🏢",
    create_agent: "🤖", update_agent_settings: "⚙", update_agent_status: "🔄", delete_agent: "🗑",
    list_files: "📁", read_file: "📖", write_file: "✎",
    run_command: "$", install_package: "📦",
    web_search: "🔍",
    save_memory: "💾", recall_memory: "🧠",
  };
  return map[name] ?? "⚙";
}

function _toolColor(name: string, accent: string): string {
  if (["write_file", "delete_agent", "install_package"].includes(name)) return "#f59e0b";
  if (["run_command"].includes(name))                                     return "#10b981";
  if (["web_search"].includes(name))                                      return "#3b82f6";
  if (["create_agent"].includes(name))                                    return "#a855f7";
  if (["read_file", "list_files"].includes(name))                        return "#64748b";
  return accent;
}

// ── Agent detail sidebar ──────────────────────────────────────────────────────

function AgentDetailPanel({ agentId, onClose }: { agentId: string; onClose: () => void }) {
  const { agents, fetchLive } = useAgentStore();
  const agent = agents.find(a => a.agent_id === agentId);

  // ── Position + size state ─────────────────────────────────────────────
  const [panelPos,  setPanelPos]  = useState(() => ({ x: Math.max(20, (typeof window !== "undefined" ? window.innerWidth : 1200) - 320), y: 80 }));
  const [panelSize, setPanelSize] = useState({ w: 320, h: 600 });
  const [tab, setTab] = useState<"overview" | "chat" | "activity" | "settings">("overview");

  // Chat thread state
  const [chatInput,     setChatInput]     = useState("");
  const [chatMsgs,      setChatMsgs]      = useState<ChatMsg[]>([]);
  const [chatStreaming,  setChatStreaming]  = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [autoSpeak,     setAutoSpeak]     = useState(false);
  const [speaking,      setSpeaking]      = useState(false);

  // Voice recording (STT)
  const [recording,  setRecording]  = useState(false);
  const mediaRecRef  = useRef<MediaRecorder | null>(null);
  const audioChunks  = useRef<Blob[]>([]);

  // Activity log state
  const [logs,       setLogs]       = useState<LogEntry[]>([]);
  const [logsLoaded, setLogsLoaded] = useState(false);

  // Settings form state
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [settingsForm,   setSettingsForm]   = useState<{
    system_prompt_override: string;
    model: string;
    temperature: number;
    max_tokens: number;
    voice_pitch: number;
    voice_rate: number;
    voice_name: string;   // browser SpeechSynthesisVoice.name — "" = auto
  } | null>(null);

  // Available browser TTS voices
  const [ttsVoices, setTtsVoices] = useState<SpeechSynthesisVoice[]>([]);

  const [busy, setBusy] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const dragging     = useRef(false);
  const resizing     = useRef(false);
  const dragOffset   = useRef({ mx: 0, my: 0, px: 0, py: 0 });
  const resizeOrigin = useRef({ mx: 0, my: 0, w: 0, h: 0 });

  // ── Global mouse events for drag + resize ─────────────────────────────
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (dragging.current) {
        setPanelPos({
          x: Math.max(0, Math.min((typeof window !== "undefined" ? window.innerWidth : 1200)  - panelSize.w,  e.clientX - dragOffset.current.mx + dragOffset.current.px)),
          y: Math.max(0, Math.min((typeof window !== "undefined" ? window.innerHeight : 800) - 60, e.clientY - dragOffset.current.my + dragOffset.current.py)),
        });
      }
      if (resizing.current) {
        const dw = e.clientX - resizeOrigin.current.mx;
        const dh = e.clientY - resizeOrigin.current.my;
        setPanelSize({
          w: Math.max(260, Math.min(520, resizeOrigin.current.w + dw)),
          h: Math.max(400, Math.min(780, resizeOrigin.current.h + dh)),
        });
      }
    };
    const onUp = () => { dragging.current = false; resizing.current = false; };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup",  onUp);
    return () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
  }, [panelSize.w]);

  // ── Escape key close ─────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // ── Load history when Chat tab opens ────────────────────────────────
  useEffect(() => {
    if (tab !== "chat" || !agent || historyLoaded) return;
    fetch(`${API}/api/direct/agent/${agent.codename}/history?limit=60`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d?.messages) {
          setChatMsgs(
            d.messages.map((m: { id: string; role: string; content: string }) => ({
              id: m.id, role: m.role as "user" | "assistant", content: m.content,
            }))
          );
        }
        setHistoryLoaded(true);
      })
      .catch(() => setHistoryLoaded(true));
  }, [tab, agent?.codename, historyLoaded]);

  // ── Load activity logs when Activity tab opens ───────────────────────
  useEffect(() => {
    if (tab !== "activity" || !agent || logsLoaded) return;
    fetch(`${API}/api/direct/agent/${agent.codename}/logs?limit=30`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d?.logs) setLogs(d.logs);
        setLogsLoaded(true);
      })
      .catch(() => setLogsLoaded(true));
  }, [tab, agent?.codename, logsLoaded]);

  // ── Load available TTS voices (Chrome needs onvoiceschanged) ────────
  useEffect(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    const load = () => setTtsVoices(window.speechSynthesis.getVoices());
    load();
    window.speechSynthesis.onvoiceschanged = load;
    return () => { window.speechSynthesis.onvoiceschanged = null; };
  }, []);

  // ── Abort in-flight stream when panel unmounts ──────────────────────
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => { abortRef.current?.abort(); stopSpeaking(); }, []);

  // ── Load agent settings when Settings tab opens ──────────────────────
  useEffect(() => {
    if (tab !== "settings" || !agent || settingsForm !== null) return;
    fetch(`${API}/api/agents/${agent.agent_id}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        const prosody = d?.voice_prosody ?? {};
        setSettingsForm({
          system_prompt_override: d?.system_prompt_override ?? "",
          model:       d?.model       ?? "llama-3.1-8b-instant",
          temperature: d?.temperature ?? 0.6,
          max_tokens:  d?.max_tokens  ?? 1024,
          voice_pitch: prosody.pitch  ?? (_VOICE_PROFILES[agent.codename]?.pitch ?? 1.0),
          voice_rate:  prosody.rate   ?? (_VOICE_PROFILES[agent.codename]?.rate  ?? 1.0),
          voice_name:  d?.voice_id    ?? "",   // stored browser voice name
        });
      })
      .catch(() => setSettingsForm({
        system_prompt_override: "", model: "llama-3.1-8b-instant",
        temperature: 0.6, max_tokens: 1024, voice_pitch: 1.0, voice_rate: 1.0,
        voice_name: "",
      }));
  }, [tab, agent?.agent_id, settingsForm]);

  // ── Auto-scroll chat to bottom ───────────────────────────────────────
  useEffect(() => {
    if (tab === "chat") chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMsgs, tab]);

  if (!agent) return null;

  const meta   = deptMeta(agent.department, agent.badge_color);
  const Icon   = meta.icon;
  const accent = agent.badge_color || meta.color;

  const runtimeColor: Record<string, string> = {
    idle: "#64748b", thinking: "#f59e0b", working: "#10b981", error: "#ef4444",
  };
  const runtimeIcon: Record<string, string> = {
    idle: "○", thinking: "◌", working: "◉", error: "✕",
  };

  const health = agent.health_score ?? 0;
  const healthColor = health >= 80 ? "#10b981" : health >= 50 ? "#f59e0b" : "#ef4444";

  async function deleteHistory() {
    if (!agent) return;
    await fetch(`${API}/api/direct/agent/${agent.codename}/history`, { method: "DELETE" });
    setChatMsgs([]);
    setHistoryLoaded(false);
    setTimeout(() => setHistoryLoaded(true), 0);
  }

  async function saveSettings() {
    if (!agent || !settingsForm) return;
    setSettingsSaving(true);
    await fetch(`${API}/api/direct/agent/${agent.codename}/settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_prompt_override: settingsForm.system_prompt_override || null,
        model:       settingsForm.model,
        temperature: settingsForm.temperature,
        max_tokens:  settingsForm.max_tokens,
        voice_id:    settingsForm.voice_name || null,
        voice_prosody: { pitch: settingsForm.voice_pitch, rate: settingsForm.voice_rate },
      }),
    });
    setSettingsSaving(false);
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      audioChunks.current = [];
      mr.ondataavailable = e => { if (e.data.size > 0) audioChunks.current.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(audioChunks.current, { type: "audio/webm" });
        const fd   = new FormData();
        fd.append("audio", blob, "recording.webm");
        try {
          const res  = await fetch(`${API}/api/voice/transcribe`, { method: "POST", body: fd });
          const data = await res.json();
          if (data.text) setChatInput(data.text);
        } catch { /**/ }
        setRecording(false);
      };
      mr.start();
      mediaRecRef.current = mr;
      setRecording(true);
    } catch { setRecording(false); }
  }

  function stopRecording() {
    mediaRecRef.current?.stop();
    mediaRecRef.current = null;
  }

  async function sendChatMessage(msg: string) {
    if (!msg.trim() || chatStreaming || !agent) return;
    const userMsg = msg.trim();

    // Optimistically append the user message
    const uid = `u-${Date.now()}`;
    const aid = `a-${Date.now()}`;
    setChatMsgs(prev => [
      ...prev,
      { id: uid, role: "user",      content: userMsg },
      { id: aid, role: "assistant", content: "",      streaming: true },
    ]);
    setChatStreaming(true);

    const abort = new AbortController();
    abortRef.current = abort;

    try {
      const res = await fetch(`${API}/api/direct/agent/${agent.codename}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userMsg }),
        signal: abort.signal,
      });
      const reader = res.body?.getReader();
      const dec    = new TextDecoder();
      let   acc    = "";
      let   buf    = "";  // accumulate across TCP chunk boundaries

      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        // SSE frames end with \n\n — process only complete frames
        const frames = buf.split("\n\n");
        buf = frames.pop() ?? "";  // keep the incomplete tail
        for (const frame of frames) {
          for (const line of frame.split("\n")) {
            if (!line.startsWith("data: ")) continue;
            const payload = line.slice(6);
            if (payload.startsWith("[ERROR]")) {
              let errMsg = "Agent error";
              try { errMsg = JSON.parse(payload.slice(7)).error ?? errMsg; } catch { /**/ }
              setChatMsgs(prev => prev.map(m =>
                m.id === aid ? { ...m, content: `⚠ ${errMsg}`, streaming: false } : m
              ));
              return;
            }
            if (payload.startsWith("[TOOL]")) {
              try {
                const t = JSON.parse(payload.slice(6));
                const tc: ToolCall = { id: t.id ?? "", name: t.name, args: t.args, done: false };
                setChatMsgs(prev => prev.map(m =>
                  m.id === aid ? { ...m, toolCalls: [...(m.toolCalls ?? []), tc] } : m
                ));
              } catch { /**/ }
              continue;
            }
            if (payload.startsWith("[TOOL_RESULT]")) {
              try {
                const r = JSON.parse(payload.slice(13));
                setChatMsgs(prev => prev.map(m =>
                  m.id === aid ? {
                    ...m,
                    toolCalls: m.toolCalls?.map(tc =>
                      tc.id === r.id ? { ...tc, result: r.preview as ToolPreview, done: true, approvalPending: false } : tc
                    ),
                  } : m
                ));
              } catch { /**/ }
              continue;
            }
            if (payload.startsWith("[APPROVAL]")) {
              try {
                const a = JSON.parse(payload.slice(10));
                setChatMsgs(prev => prev.map(m =>
                  m.id === aid ? {
                    ...m,
                    toolCalls: m.toolCalls?.map(tc =>
                      tc.id === a.id ? { ...tc, approvalPending: true } : tc
                    ),
                  } : m
                ));
              } catch { /**/ }
              continue;
            }
            if (payload.startsWith("[")) continue;  // [DONE] and future sentinels
            acc += payload.replace(/\\n/g, "\n");
            setChatMsgs(prev => prev.map(m =>
              m.id === aid ? { ...m, content: acc } : m
            ));
          }
        }
      }
      // Mark streaming done + optionally speak
      setChatMsgs(prev => {
        const updated = prev.map(m => m.id === aid ? { ...m, streaming: false } : m);
        if (autoSpeak && agent) {
          const final = updated.find(m => m.id === aid);
          if (final?.content) { setSpeaking(true); speakAs(final.content, agent.codename); setTimeout(() => setSpeaking(false), 500); }
        }
        return updated;
      });
    } catch (err: unknown) {
      const aborted = err instanceof Error && err.name === "AbortError";
      setChatMsgs(prev => prev.map(m =>
        m.id === aid ? {
          ...m,
          content: aborted ? "" : "⚠ Error — could not reach agent.",
          streaming: false,
        } : m
      ));
    }
    setChatStreaming(false);
  }

  async function toggleStatus() {
    setBusy(true);
    try {
      await fetch(`${API}/api/agents/${agent!.agent_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: agent!.status === "active" ? "standby" : "active" }),
      });
      await fetchLive();
    } catch { /**/ }
    setBusy(false);
  }

  const tabStyle = (t: string) => ({
    flex: 1, padding: "6px 4px", background: "none", border: "none",
    cursor: "pointer", fontSize: 10, fontWeight: 700, letterSpacing: "0.06em",
    textTransform: "uppercase" as const, fontFamily: "inherit",
    color: tab === t ? accent : "var(--color-text-dim)",
    borderBottom: `2px solid ${tab === t ? accent : "transparent"}`,
    transition: "color 0.15s",
  });

  return (
    <div
      style={{
        position: "fixed",
        left: panelPos.x, top: panelPos.y,
        width: panelSize.w, height: panelSize.h,
        zIndex: 9998,
        display: "flex", flexDirection: "column",
        borderRadius: 10, overflow: "hidden",
        background: "rgba(8,8,20,0.96)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        border: `1px solid color-mix(in srgb, ${accent} 28%, rgba(255,255,255,0.06))`,
        boxShadow: `0 24px 64px rgba(0,0,0,0.82), 0 0 32px color-mix(in srgb, ${accent} 8%, transparent)`,
        userSelect: dragging.current ? "none" : "auto",
      }}
    >
      {/* ── Drag handle / header ─────────────────────────────────── */}
      <div
        onMouseDown={e => {
          if ((e.target as HTMLElement).closest("button")) return;
          dragging.current = true;
          dragOffset.current = { mx: e.clientX, my: e.clientY, px: panelPos.x, py: panelPos.y };
          e.preventDefault();
        }}
        style={{
          padding: "10px 14px",
          background: `color-mix(in srgb, ${accent} 10%, rgba(8,8,20,0.9))`,
          borderBottom: `1px solid color-mix(in srgb, ${accent} 18%, transparent)`,
          display: "flex", alignItems: "center", gap: 10,
          cursor: "move", flexShrink: 0,
        }}
      >
        {/* Avatar */}
        <div style={{
          width: 36, height: 36, borderRadius: "50%", overflow: "hidden", flexShrink: 0,
          border: `2px solid ${accent}`,
          boxShadow: `0 0 12px color-mix(in srgb, ${accent} 40%, transparent)`,
        }}>
          <img src={agentAvatarUrl(agent)} alt={agent.codename}
            style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 13, color: accent, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {agent.name}
          </div>
          <div style={{ fontSize: 10, color: "var(--color-text-dim)", display: "flex", alignItems: "center", gap: 5 }}>
            <Icon size={9} color={accent} />
            <span>@{agent.codename} · L{agent.level} · {meta.display}</span>
          </div>
        </div>
        {/* Runtime status pill */}
        <span style={{
          fontSize: 9, fontWeight: 800, padding: "2px 8px", borderRadius: 20, flexShrink: 0,
          background: `color-mix(in srgb, ${runtimeColor[agent.runtime_status] ?? "#64748b"} 16%, transparent)`,
          color: runtimeColor[agent.runtime_status] ?? "#64748b",
          textTransform: "uppercase", letterSpacing: "0.06em",
        }}>
          {runtimeIcon[agent.runtime_status]} {agent.runtime_status}
        </span>
        <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-text-dim)", display: "flex", padding: 2, flexShrink: 0 }}>
          <X size={14} />
        </button>
      </div>

      {/* ── Tabs ─────────────────────────────────────────────────── */}
      <div style={{ display: "flex", borderBottom: "1px solid var(--color-border)", flexShrink: 0 }}>
        <button style={tabStyle("overview")}  onClick={() => setTab("overview")}>Overview</button>
        <button style={tabStyle("chat")}      onClick={() => setTab("chat")}>Chat</button>
        <button style={tabStyle("activity")}  onClick={() => setTab("activity")}>Activity</button>
        <button style={tabStyle("settings")}  onClick={() => setTab("settings")}>Settings</button>
      </div>

      {/* ── Tab content ──────────────────────────────────────────── */}
      <div style={{
        flex: 1, minHeight: 0,
        overflowY: tab === "chat" ? "hidden" : "auto",
        padding: 14, display: "flex", flexDirection: "column",
        gap: tab === "chat" ? 0 : 12,
      }}>

        {/* OVERVIEW TAB */}
        {tab === "overview" && (
          <>
            {/* Health bar */}
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 5, fontSize: 10, color: "var(--color-text-dim)", textTransform: "uppercase", letterSpacing: "0.07em" }}>
                <span>Health Score</span>
                <span style={{ color: healthColor, fontWeight: 700 }}>{health}%</span>
              </div>
              <div style={{ height: 5, borderRadius: 3, background: "var(--color-border)", overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${health}%`, background: healthColor, borderRadius: 3, transition: "width 0.4s", boxShadow: `0 0 8px ${healthColor}` }} />
              </div>
            </div>

            {/* Status + toggle */}
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <span style={{
                flex: 1, padding: "5px 10px", borderRadius: 20, fontSize: 10, fontWeight: 700, textAlign: "center",
                background: `color-mix(in srgb, ${agent.status === "active" ? accent : "#64748b"} 15%, transparent)`,
                color: agent.status === "active" ? accent : "#64748b",
                textTransform: "uppercase", letterSpacing: "0.07em",
              }}>
                {agent.status}
              </span>
              <button
                onClick={toggleStatus} disabled={busy}
                style={{
                  flex: 1, padding: "5px 10px", borderRadius: 20, border: "none", cursor: busy ? "wait" : "pointer",
                  fontSize: 10, fontWeight: 800, letterSpacing: "0.06em", fontFamily: "inherit",
                  background: agent.status === "active" ? "#2d1a1a" : accent,
                  color: agent.status === "active" ? "#ef4444" : "#000",
                  opacity: busy ? 0.5 : 1,
                }}
              >
                {agent.status === "active" ? "⏸ Pause" : "▶ Activate"}
              </button>
            </div>

            {/* Stats grid */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
              {([
                ["Level", `L${agent.level}`, accent],
                ["Dept",  meta.display,       meta.color],
                ["Status",    agent.status,           agent.status === "active" ? "#10b981" : "#94a3b8"],
                ["Last sync", timeAgo(new Date(agent.updated_at).getTime()), "var(--color-text-dim)"],
              ] as [string, string, string][]).map(([lbl, val, c]) => (
                <div key={lbl} style={{ background: "var(--color-card-inner)", borderRadius: 6, padding: "8px 10px" }}>
                  <div style={{ fontSize: 9, color: "var(--color-text-dim)", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 3 }}>{lbl}</div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: c, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{val}</div>
                </div>
              ))}
            </div>

            {/* Quick links — open in new tab, never navigate away */}
            <div style={{ display: "flex", gap: 6 }}>
              <button
                onClick={() => window.open(`${window.location.origin}/#agents`, "_blank")}
                title="Opens Agents panel in a new tab"
                style={{ flex: 1, background: "var(--color-card-inner)", border: "1px solid var(--color-border)", borderRadius: 6, padding: "8px", cursor: "pointer", color: "var(--color-text-dim)", fontSize: 11, fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}
              >
                <ExternalLink size={11} /> Full Profile
              </button>
              <button
                onClick={() => window.open(`${window.location.origin}/#pipeline`, "_blank")}
                title="Opens Pipeline panel in a new tab"
                style={{ flex: 1, background: "var(--color-card-inner)", border: "1px solid var(--color-border)", borderRadius: 6, padding: "8px", cursor: "pointer", color: "var(--color-text-dim)", fontSize: 11, fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: 5 }}
              >
                <ExternalLink size={11} /> Pipeline
              </button>
            </div>

            {/* Live pipeline activity for this agent */}
            <AgentPipelineActivity codename={agent.codename} accent={accent} />
          </>
        )}

        {/* CHAT TAB */}
        {tab === "chat" && (
          <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: 0 }}>

            {/* Chat controls bar */}
            <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
              <div style={{ fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--color-text-dim)", flex: 1 }}>
                @{agent.codename}
              </div>
              {/* Auto-speak toggle */}
              <button
                onClick={() => { setAutoSpeak(v => !v); if (speaking) stopSpeaking(); }}
                title={autoSpeak ? "Auto-speak on — click to mute" : "Auto-speak off"}
                style={{ background: autoSpeak ? `color-mix(in srgb, ${accent} 20%, transparent)` : "var(--color-card-inner)", border: `1px solid color-mix(in srgb, ${accent} 22%, transparent)`, borderRadius: 6, padding: "4px 6px", cursor: "pointer", color: autoSpeak ? accent : "var(--color-text-dim)", display: "flex", alignItems: "center" }}
              >
                {speaking ? <Volume2 size={11} /> : autoSpeak ? <Volume2 size={11} /> : <VolumeX size={11} />}
              </button>
              {/* Clear history */}
              <button
                onClick={deleteHistory}
                title="Clear chat history"
                style={{ background: "var(--color-card-inner)", border: "1px solid var(--color-border)", borderRadius: 6, padding: "4px 6px", cursor: "pointer", color: "var(--color-text-dim)", display: "flex", alignItems: "center" }}
              >
                <Trash2 size={11} />
              </button>
            </div>

            {/* Quick-ask chips */}
            <div style={{ flexShrink: 0, marginBottom: 8 }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                {["What are you working on?", "Summarise your last task", "What's your status?", "Any blockers?"].map(q => (
                  <button key={q}
                    onClick={() => { sendChatMessage(q); }}
                    disabled={chatStreaming}
                    style={{
                      background: "var(--color-card-inner)",
                      border: `1px solid color-mix(in srgb, ${accent} 22%, transparent)`,
                      borderRadius: 14, padding: "4px 10px", cursor: chatStreaming ? "not-allowed" : "pointer",
                      color: accent, fontSize: 10, fontFamily: "inherit", opacity: chatStreaming ? 0.5 : 1,
                    }}>
                    {q}
                  </button>
                ))}
              </div>
            </div>

            {/* Message thread */}
            <div style={{
              flex: 1, overflowY: "auto", display: "flex", flexDirection: "column",
              gap: 10, paddingRight: 2, minHeight: 0,
            }}>
              {!historyLoaded && (
                <div style={{ textAlign: "center", padding: "16px 0", color: "var(--color-text-dim)", fontSize: 11 }}>
                  Loading history…
                </div>
              )}
              {historyLoaded && chatMsgs.length === 0 && (
                <div style={{
                  textAlign: "center", padding: "20px 0",
                  color: "var(--color-text-dim)", fontSize: 11, lineHeight: 1.7,
                }}>
                  <div style={{ fontSize: 22, marginBottom: 6 }}>{agent.avatar_emoji || "🤖"}</div>
                  Start a conversation with <span style={{ color: accent, fontWeight: 700 }}>@{agent.codename}</span>
                </div>
              )}
              {chatMsgs.map(m => (
                <div key={m.id} style={{
                  display: "flex",
                  flexDirection: m.role === "user" ? "row-reverse" : "row",
                  gap: 8, alignItems: "flex-end",
                }}>
                  {m.role === "assistant" && (
                    <div style={{
                      width: 24, height: 24, borderRadius: "50%", overflow: "hidden",
                      border: `1.5px solid ${accent}`, flexShrink: 0, marginBottom: 2,
                    }}>
                      <img src={agentAvatarUrl(agent)} alt={agent.codename}
                        style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    </div>
                  )}
                  <div style={{ maxWidth: "80%", display: "flex", flexDirection: "column", gap: 3 }}>
                    <div style={{
                      background: m.role === "user"
                        ? `color-mix(in srgb, ${accent} 18%, rgba(20,20,40,0.9))`
                        : "var(--color-card-inner)",
                      borderRadius: m.role === "user" ? "12px 12px 4px 12px" : "12px 12px 12px 4px",
                      padding: "8px 11px",
                      fontSize: 11, lineHeight: 1.6,
                      color: "var(--color-text)",
                      border: m.role === "assistant"
                        ? `1px solid color-mix(in srgb, ${accent} 14%, transparent)`
                        : "none",
                      wordBreak: "break-word",
                      whiteSpace: "pre-wrap",
                    }}>
                      {m.role === "assistant" && (m.toolCalls?.length ?? 0) > 0 && (
                        <div style={{ marginBottom: m.content ? 8 : 0 }}>
                          {m.toolCalls!.map((tc) => {
                            const clr = _toolColor(tc.name, accent);
                            return (
                              <div key={tc.id || tc.name} style={{ marginBottom: 4 }}>
                                {/* Tool header pill */}
                                <div style={{
                                  display: "flex", alignItems: "center", gap: 5,
                                  fontSize: 9, color: clr,
                                  background: `color-mix(in srgb, ${clr} 12%, transparent)`,
                                  borderRadius: tc.result?.preview ? "5px 5px 0 0" : 5,
                                  padding: "3px 8px", fontFamily: "inherit",
                                  borderLeft: `2px solid ${clr}`,
                                }}>
                                  <span style={{ fontSize: 10, flexShrink: 0 }}>{_toolIcon(tc.name)}</span>
                                  <span style={{ flex: 1 }}>{tc.result?.summary ?? _toolLabel(tc.name, tc.args)}</span>
                                  {tc.approvalPending && !tc.done
                                    ? <span style={{ fontSize: 8, color: "#f59e0b", fontWeight: 800 }}>⏳ approval needed</span>
                                    : tc.done
                                    ? <span style={{ opacity: 0.6, fontSize: 8 }}>{tc.result?.ok === false ? "✗" : "✓"}</span>
                                    : <span style={{ color: clr, animation: "blinkCursor 1s step-end infinite", fontSize: 10 }}>…</span>
                                  }
                                </div>
                                {/* Tool output preview */}
                                {tc.done && tc.result?.preview && (
                                  <div style={{
                                    fontFamily: "monospace", fontSize: 9,
                                    padding: "5px 8px",
                                    background: "rgba(0,0,0,0.35)",
                                    borderRadius: "0 0 5px 5px",
                                    color: "var(--color-text-dim)",
                                    whiteSpace: "pre-wrap", lineHeight: 1.5,
                                    maxHeight: 90, overflowY: "auto",
                                    borderLeft: `2px solid ${clr}`,
                                    borderTop: "1px solid rgba(255,255,255,0.04)",
                                  }}>
                                    {tc.result.preview}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                      {m.content || (m.streaming && (m.toolCalls?.length ?? 0) > 0 ? "" : (m.streaming ? "" : "—"))}
                      {m.streaming && (
                        <span style={{ display: "inline-block", marginLeft: 2, color: accent, animation: "blinkCursor 1s step-end infinite" }}>▌</span>
                      )}
                    </div>
                    {m.role === "assistant" && m.content && !m.streaming && (
                      <button
                        onClick={() => speakAs(m.content, agent.codename)}
                        style={{ alignSelf: "flex-start", background: "none", border: "none", cursor: "pointer", color: "var(--color-text-dim)", padding: "1px 4px", display: "flex", alignItems: "center", gap: 3, fontSize: 9 }}
                        title="Speak this message"
                      >
                        <Volume2 size={9} /> speak
                      </button>
                    )}
                  </div>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>

            {/* Input area */}
            <div style={{ flexShrink: 0, display: "flex", flexDirection: "column", gap: 6, paddingTop: 10, borderTop: "1px solid var(--color-border)", marginTop: 8 }}>
              <div style={{ display: "flex", gap: 6, alignItems: "flex-end" }}>
                <textarea
                  rows={2}
                  value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                      sendChatMessage(chatInput); setChatInput("");
                    }
                  }}
                  placeholder={recording ? "🔴 Listening…" : `Message @${agent.codename}… (Ctrl+Enter)`}
                  disabled={chatStreaming}
                  style={{
                    flex: 1, background: "var(--color-card-inner)", borderRadius: 7, color: "var(--color-text)",
                    border: `1px solid ${recording ? "#ef4444" : `color-mix(in srgb, ${accent} 22%, transparent)`}`,
                    padding: "8px 10px", fontSize: 11, resize: "none",
                    fontFamily: "inherit", outline: "none", lineHeight: 1.5,
                    opacity: chatStreaming ? 0.6 : 1, transition: "border-color 0.15s",
                  }}
                />
                {/* Mic button */}
                <button
                  onMouseDown={startRecording}
                  onMouseUp={stopRecording}
                  onMouseLeave={() => { if (recording) stopRecording(); }}
                  title="Hold to record voice"
                  style={{
                    background: recording ? "#ef4444" : "var(--color-card-inner)",
                    border: `1px solid ${recording ? "#ef4444" : "var(--color-border)"}`,
                    borderRadius: 7, padding: "8px", cursor: "pointer", display: "flex", alignItems: "center", flexShrink: 0,
                    color: recording ? "#fff" : "var(--color-text-dim)", transition: "all 0.15s",
                    animation: recording ? "blinkCursor 1s step-end infinite" : "none",
                  }}
                >
                  {recording ? <MicOff size={14} /> : <Mic size={14} />}
                </button>
              </div>
              <button
                onClick={() => { sendChatMessage(chatInput); setChatInput(""); }}
                disabled={chatStreaming || !chatInput.trim()}
                style={{
                  background: chatStreaming ? "rgba(99,102,241,0.3)" : accent,
                  border: "none", borderRadius: 7, padding: "9px",
                  cursor: chatStreaming || !chatInput.trim() ? "not-allowed" : "pointer",
                  color: chatStreaming ? "var(--color-text-dim)" : "#000",
                  fontWeight: 800, fontSize: 11, fontFamily: "inherit",
                  opacity: !chatInput.trim() ? 0.45 : 1,
                  transition: "background 0.2s",
                }}
              >
                {chatStreaming ? "⟳ Receiving…" : `⚡ Send to @${agent.codename}`}
              </button>
            </div>
          </div>
        )}

        {/* ACTIVITY TAB */}
        {tab === "activity" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 2 }}>
              <div style={{ fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--color-text-dim)" }}>
                Recent Actions
              </div>
              <button
                onClick={() => setLogsLoaded(false)}
                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-text-dim)", display: "flex", padding: 2 }}
                title="Refresh activity"
              >
                <RefreshCw size={11} />
              </button>
            </div>
            {!logsLoaded && (
              <div style={{ textAlign: "center", padding: "16px 0", color: "var(--color-text-dim)", fontSize: 11 }}>Loading…</div>
            )}
            {logsLoaded && logs.length === 0 && (
              <div style={{ textAlign: "center", padding: "24px 0", color: "var(--color-text-dim)", fontSize: 12 }}>
                No activity recorded yet
              </div>
            )}
            {logs.map((log, i) => {
              const isOk = log.outcome === "success";
              const oColor = isOk ? "#10b981" : "#ef4444";
              const ts = log.created_at ? new Date(log.created_at) : null;
              return (
                <div key={log.created_at ? `${log.created_at}-${log.action_type}` : i} style={{
                  background: "var(--color-card-inner)", borderRadius: 7, padding: "8px 10px",
                  borderLeft: `3px solid ${oColor}`,
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3, gap: 6 }}>
                    <span style={{ fontSize: 10, fontWeight: 700, color: "var(--color-text)", textTransform: "capitalize" }}>
                      {(log.action_type || "action").replace(/_/g, " ")}
                    </span>
                    <span style={{ fontSize: 8, fontWeight: 800, color: oColor, textTransform: "uppercase", flexShrink: 0, letterSpacing: "0.05em" }}>
                      {log.outcome}
                    </span>
                  </div>
                  <div style={{ display: "flex", gap: 10, fontSize: 9, color: "var(--color-text-dim)" }}>
                    {log.duration_ms != null && <span>{log.duration_ms}ms</span>}
                    {(log.input_tokens || 0) > 0 && <span>↑{log.input_tokens}tok</span>}
                    {(log.output_tokens || 0) > 0 && <span>↓{log.output_tokens}tok</span>}
                    {ts && (
                      <span style={{ marginLeft: "auto" }}>
                        {ts.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* SETTINGS TAB */}
        {tab === "settings" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {!settingsForm ? (
              <div style={{ textAlign: "center", padding: "16px 0", color: "var(--color-text-dim)", fontSize: 11 }}>Loading…</div>
            ) : (
              <>
                {/* System prompt override */}
                <div>
                  <label style={{ fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--color-text-dim)", display: "block", marginBottom: 5 }}>
                    System Prompt Override
                  </label>
                  <textarea
                    rows={5}
                    value={settingsForm.system_prompt_override}
                    onChange={e => setSettingsForm(f => f ? { ...f, system_prompt_override: e.target.value } : f)}
                    placeholder="Leave blank to use default prompt…"
                    style={{ width: "100%", background: "var(--color-card-inner)", border: `1px solid color-mix(in srgb, ${accent} 20%, transparent)`, borderRadius: 7, color: "var(--color-text)", padding: "8px 10px", fontSize: 10, resize: "vertical", fontFamily: "inherit", outline: "none", lineHeight: 1.5, boxSizing: "border-box" }}
                  />
                </div>
                {/* Model */}
                <div>
                  <label style={{ fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--color-text-dim)", display: "block", marginBottom: 5 }}>Model</label>
                  <select
                    value={settingsForm.model}
                    onChange={e => setSettingsForm(f => f ? { ...f, model: e.target.value } : f)}
                    style={{ width: "100%", background: "var(--color-card-inner)", border: `1px solid color-mix(in srgb, ${accent} 20%, transparent)`, borderRadius: 7, color: "var(--color-text)", padding: "7px 10px", fontSize: 11, fontFamily: "inherit", outline: "none", boxSizing: "border-box" }}
                  >
                    <option value="llama-3.1-8b-instant">llama-3.1-8b-instant (fast)</option>
                    <option value="llama-3.3-70b-versatile">llama-3.3-70b-versatile (smart)</option>
                    <option value="llama-3.1-70b-versatile">llama-3.1-70b-versatile</option>
                    <option value="mixtral-8x7b-32768">mixtral-8x7b-32768</option>
                  </select>
                </div>
                {/* Temperature + Max Tokens */}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                  <div>
                    <label style={{ fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--color-text-dim)", display: "block", marginBottom: 5 }}>
                      Temperature <span style={{ color: accent }}>{settingsForm.temperature.toFixed(1)}</span>
                    </label>
                    <input type="range" min="0" max="2" step="0.1"
                      value={settingsForm.temperature}
                      onChange={e => setSettingsForm(f => f ? { ...f, temperature: parseFloat(e.target.value) } : f)}
                      style={{ width: "100%", accentColor: accent }}
                    />
                  </div>
                  <div>
                    <label style={{ fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--color-text-dim)", display: "block", marginBottom: 5 }}>Max Tokens</label>
                    <input type="number" min="128" max="8192" step="128"
                      value={settingsForm.max_tokens}
                      onChange={e => setSettingsForm(f => f ? { ...f, max_tokens: parseInt(e.target.value) || 1024 } : f)}
                      style={{ width: "100%", background: "var(--color-card-inner)", border: `1px solid color-mix(in srgb, ${accent} 20%, transparent)`, borderRadius: 7, color: "var(--color-text)", padding: "6px 8px", fontSize: 11, fontFamily: "inherit", outline: "none", boxSizing: "border-box" }}
                    />
                  </div>
                </div>
                {/* Voice */}
                <div>
                  <label style={{ fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.07em", color: "var(--color-text-dim)", display: "block", marginBottom: 8 }}>Voice Profile</label>
                  {/* Voice selector */}
                  <select
                    value={settingsForm.voice_name}
                    onChange={e => setSettingsForm(f => f ? { ...f, voice_name: e.target.value } : f)}
                    style={{ width: "100%", background: "var(--color-card-inner)", border: `1px solid color-mix(in srgb, ${accent} 20%, transparent)`, borderRadius: 7, color: "var(--color-text)", padding: "7px 10px", fontSize: 11, fontFamily: "inherit", outline: "none", boxSizing: "border-box", marginBottom: 10 }}
                  >
                    <option value="">— Auto (gender-matched) —</option>
                    {ttsVoices.map(v => (
                      <option key={v.name} value={v.name}>{v.name} ({v.lang})</option>
                    ))}
                  </select>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                    <div>
                      <div style={{ fontSize: 9, color: "var(--color-text-dim)", marginBottom: 4 }}>
                        Pitch <span style={{ color: accent }}>{settingsForm.voice_pitch.toFixed(1)}×</span>
                      </div>
                      <input type="range" min="0.5" max="2" step="0.05"
                        value={settingsForm.voice_pitch}
                        onChange={e => setSettingsForm(f => f ? { ...f, voice_pitch: parseFloat(e.target.value) } : f)}
                        style={{ width: "100%", accentColor: accent }}
                      />
                    </div>
                    <div>
                      <div style={{ fontSize: 9, color: "var(--color-text-dim)", marginBottom: 4 }}>
                        Rate <span style={{ color: accent }}>{settingsForm.voice_rate.toFixed(1)}×</span>
                      </div>
                      <input type="range" min="0.5" max="2" step="0.05"
                        value={settingsForm.voice_rate}
                        onChange={e => setSettingsForm(f => f ? { ...f, voice_rate: parseFloat(e.target.value) } : f)}
                        style={{ width: "100%", accentColor: accent }}
                      />
                    </div>
                  </div>
                  <button
                    onClick={() => speakAs(agentIntro(agent.codename, agent.name), agent.codename, { pitch: settingsForm.voice_pitch, rate: settingsForm.voice_rate, voiceName: settingsForm.voice_name || undefined })}
                    style={{ marginTop: 8, background: "var(--color-card-inner)", border: `1px solid color-mix(in srgb, ${accent} 20%, transparent)`, borderRadius: 6, padding: "5px 10px", cursor: "pointer", color: accent, fontSize: 10, fontFamily: "inherit", display: "flex", alignItems: "center", gap: 5 }}
                  >
                    <Volume2 size={10} /> Preview voice
                  </button>
                </div>
                {/* Save */}
                <button
                  onClick={saveSettings}
                  disabled={settingsSaving}
                  style={{ background: accent, border: "none", borderRadius: 7, padding: "10px", cursor: settingsSaving ? "wait" : "pointer", color: "#000", fontWeight: 800, fontSize: 11, fontFamily: "inherit", display: "flex", alignItems: "center", justifyContent: "center", gap: 6, opacity: settingsSaving ? 0.7 : 1 }}
                >
                  <Save size={12} /> {settingsSaving ? "Saving…" : "Save Settings"}
                </button>
              </>
            )}
          </div>
        )}

      </div>

      {/* ── Resize handle ────────────────────────────────────────── */}
      <div
        onMouseDown={e => {
          e.stopPropagation();
          resizing.current = true;
          resizeOrigin.current = { mx: e.clientX, my: e.clientY, w: panelSize.w, h: panelSize.h };
          e.preventDefault();
        }}
        style={{
          position: "absolute", bottom: 0, right: 0,
          width: 18, height: 18, cursor: "nwse-resize",
          background: `color-mix(in srgb, ${accent} 15%, transparent)`,
          borderTopLeftRadius: 6,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}
      >
        <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
          <path d="M7 1L1 7M7 4L4 7" stroke={accent} strokeWidth="1.2" strokeLinecap="round"/>
        </svg>
      </div>

      <style>{`@keyframes blinkCursor { 0%,100% { opacity: 1; } 50% { opacity: 0; } }`}</style>
    </div>
  );
}

// ── Department detail panel — floating, draggable, resizable ─────────────────

function DeptDetailPanel({ deptId, agents, departments, onClose }: {
  deptId: string; agents: AgentLive[]; departments: DeptLive[]; onClose: () => void;
}) {
  const dept = departments.find(d => d.id === deptId);

  const [panelPos,  setPanelPos]  = useState(() => ({
    x: Math.max(20, (typeof window !== "undefined" ? window.innerWidth : 1200) - 340),
    y: 80,
  }));
  const [panelSize, setPanelSize] = useState({ w: 320, h: 580 });
  const [tab, setTab]             = useState<"overview" | "agents" | "chat">("overview");
  const [chatInput,     setChatInput]     = useState("");
  const [chatMsgs,      setChatMsgs]      = useState<DeptChatMsg[]>([]);
  const [chatStreaming,  setChatStreaming]  = useState(false);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [autoSpeak,     setAutoSpeak]     = useState(false);
  const [recording,     setRecording]     = useState(false);
  const mediaRecRef  = useRef<MediaRecorder | null>(null);
  const audioChunks  = useRef<Blob[]>([]);
  const deptChatEnd  = useRef<HTMLDivElement>(null);
  const deptAbortRef = useRef<AbortController | null>(null);
  const [busy,       setBusy]       = useState(false);

  const dragging     = useRef(false);
  const resizing     = useRef(false);
  const dragOffset   = useRef({ mx: 0, my: 0, px: 0, py: 0 });
  const resizeOrigin = useRef({ mx: 0, my: 0, w: 0, h: 0 });

  const { toggleDept, setSelectedAgent } = useAgentStore();

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (dragging.current) {
        setPanelPos({
          x: Math.max(0, Math.min((typeof window !== "undefined" ? window.innerWidth  : 1200) - panelSize.w,  e.clientX - dragOffset.current.mx + dragOffset.current.px)),
          y: Math.max(0, Math.min((typeof window !== "undefined" ? window.innerHeight : 800)  - 60,            e.clientY - dragOffset.current.my + dragOffset.current.py)),
        });
      }
      if (resizing.current) {
        setPanelSize({
          w: Math.max(280, Math.min(560, resizeOrigin.current.w + (e.clientX - resizeOrigin.current.mx))),
          h: Math.max(400, Math.min(800, resizeOrigin.current.h + (e.clientY - resizeOrigin.current.my))),
        });
      }
    };
    const onUp = () => { dragging.current = false; resizing.current = false; };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup",   onUp);
    return () => { document.removeEventListener("mousemove", onMove); document.removeEventListener("mouseup", onUp); };
  }, [panelSize.w]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Cleanup on unmount
  useEffect(() => () => { deptAbortRef.current?.abort(); stopSpeaking(); }, []);

  // Load history when Chat tab opens
  useEffect(() => {
    if (tab !== "chat" || !dept || historyLoaded) return;
    fetch(`${API}/api/direct/dept/${dept.id}/history?limit=80`)
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d?.messages) {
          setChatMsgs(d.messages.map((m: { id: string; role: string; agent_codename?: string; content: string }) => ({
            id: m.id, role: m.role as "user" | "agent",
            codename: m.agent_codename ?? undefined, content: m.content,
          })));
        }
        setHistoryLoaded(true);
      })
      .catch(() => setHistoryLoaded(true));
  }, [tab, dept?.id, historyLoaded]);

  // Auto-scroll
  useEffect(() => {
    if (tab === "chat") deptChatEnd.current?.scrollIntoView({ behavior: "smooth" });
  }, [chatMsgs, tab]);

  if (!dept) return null;

  const meta        = deptMeta(dept.id, dept.badge_color);
  const Icon        = meta.icon;
  const accent      = dept.badge_color || meta.color;
  const deptAgents  = agents.filter(a => a.department === dept.id);
  const activeAgents  = deptAgents.filter(a => a.status === "active");
  const workingAgents = deptAgents.filter(a => a.runtime_status === "working" || a.runtime_status === "thinking");
  const headAgent     = deptAgents.find(a => a.codename === dept.head_agent);

  const runtimeColor: Record<string, string> = {
    idle: "#64748b", thinking: "#f59e0b", working: "#10b981", error: "#ef4444",
  };

  async function deleteDeptHistory() {
    if (!dept) return;
    await fetch(`${API}/api/direct/dept/${dept.id}/history`, { method: "DELETE" });
    setChatMsgs([]);
    setHistoryLoaded(false);
    setTimeout(() => setHistoryLoaded(true), 0);
  }

  async function startDeptRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mr = new MediaRecorder(stream);
      audioChunks.current = [];
      mr.ondataavailable = e => { if (e.data.size > 0) audioChunks.current.push(e.data); };
      mr.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(audioChunks.current, { type: "audio/webm" });
        const fd = new FormData();
        fd.append("audio", blob, "recording.webm");
        try {
          const res  = await fetch(`${API}/api/voice/transcribe`, { method: "POST", body: fd });
          const data = await res.json();
          if (data.text) setChatInput(data.text);
        } catch { /**/ }
        setRecording(false);
      };
      mr.start();
      mediaRecRef.current = mr;
      setRecording(true);
    } catch { setRecording(false); }
  }

  function stopDeptRecording() {
    mediaRecRef.current?.stop();
    mediaRecRef.current = null;
  }

  async function sendDeptChat(msg: string) {
    if (!msg.trim() || chatStreaming || !dept) return;
    const userMsg = msg.trim();
    const uid     = `u-${Date.now()}`;

    setChatMsgs(prev => [...prev, { id: uid, role: "user", content: userMsg }]);
    setChatStreaming(true);

    const abort = new AbortController();
    deptAbortRef.current = abort;

    // Current agent being streamed
    let curId:       string | null = null;
    let curCodename: string        = "";

    try {
      const res = await fetch(`${API}/api/direct/dept/${dept.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userMsg }),
        signal: abort.signal,
      });

      const reader = res.body?.getReader();
      const dec    = new TextDecoder();
      let   buf    = "";

      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const frames = buf.split("\n\n");
        buf = frames.pop() ?? "";
        for (const frame of frames) {
          for (const line of frame.split("\n")) {
            if (!line.startsWith("data: ")) continue;
            const payload = line.slice(6);

            if (payload.startsWith("[META]")) {
              try {
                const meta = JSON.parse(payload.slice(6));
                if (meta.type === "agent_start") {
                  curCodename = meta.codename;
                  curId = `a-${meta.codename}-${Date.now()}`;
                  setChatMsgs(prev => [...prev, {
                    id: curId!, role: "agent",
                    codename: meta.codename, name: meta.name,
                    emoji: meta.emoji, color: meta.color,
                    content: "", streaming: true,
                  }]);
                } else if (meta.type === "agent_end") {
                  setChatMsgs(prev => prev.map(m => m.id === curId ? { ...m, streaming: false } : m));
                  if (autoSpeak) {
                    const done_msg = (await new Promise<DeptChatMsg | undefined>(res =>
                      setChatMsgs(prev => { res(prev.find(m => m.id === curId)); return prev; })
                    ));
                    if (done_msg?.content) speakAs(done_msg.content, curCodename);
                  }
                  curId = null;
                }
              } catch { /**/ }
              continue;
            }
            if (payload.startsWith("[ERROR]")) {
              let errMsg = "Agent error";
              try { errMsg = JSON.parse(payload.slice(7)).error ?? errMsg; } catch { /**/ }
              if (curId) setChatMsgs(prev => prev.map(m => m.id === curId ? { ...m, content: `⚠ ${errMsg}`, streaming: false } : m));
              continue;
            }
            if (payload.startsWith("[")) continue;

            if (curId) {
              const tok = payload.replace(/\\n/g, "\n");
              setChatMsgs(prev => prev.map(m =>
                m.id === curId ? { ...m, content: m.content + tok } : m
              ));
            }
          }
        }
      }
    } catch (err: unknown) {
      const aborted = err instanceof Error && err.name === "AbortError";
      if (!aborted && curId) {
        setChatMsgs(prev => prev.map(m =>
          m.id === curId ? { ...m, content: "⚠ Connection lost.", streaming: false } : m
        ));
      }
    }
    setChatStreaming(false);
  }

  const tabStyle = (t: string) => ({
    flex: 1, padding: "6px 4px", background: "none", border: "none",
    cursor: "pointer", fontSize: 10, fontWeight: 700, letterSpacing: "0.06em",
    textTransform: "uppercase" as const, fontFamily: "inherit",
    color: tab === t ? accent : "var(--color-text-dim)",
    borderBottom: `2px solid ${tab === t ? accent : "transparent"}`,
  });

  const budgetPct = dept.budget_daily_usd > 0
    ? Math.min(100, Math.round((dept.budget_used_today / dept.budget_daily_usd) * 100))
    : 0;
  const budgetColor = budgetPct >= 90 ? "#ef4444" : budgetPct >= 70 ? "#f59e0b" : "#10b981";

  return (
    <div style={{
      position: "fixed",
      left: panelPos.x, top: panelPos.y,
      width: panelSize.w, height: panelSize.h,
      zIndex: 9997,
      display: "flex", flexDirection: "column",
      borderRadius: 10, overflow: "hidden",
      background: "rgba(8,8,20,0.96)",
      backdropFilter: "blur(20px)",
      WebkitBackdropFilter: "blur(20px)",
      border: `1px solid color-mix(in srgb, ${accent} 26%, rgba(255,255,255,0.06))`,
      boxShadow: `0 24px 64px rgba(0,0,0,0.82), 0 0 32px color-mix(in srgb, ${accent} 6%, transparent)`,
    }}>
      {/* Header / drag handle */}
      <div
        onMouseDown={e => {
          if ((e.target as HTMLElement).closest("button")) return;
          dragging.current = true;
          dragOffset.current = { mx: e.clientX, my: e.clientY, px: panelPos.x, py: panelPos.y };
          e.preventDefault();
        }}
        style={{
          padding: "10px 14px", cursor: "move", flexShrink: 0,
          background: `color-mix(in srgb, ${accent} 10%, rgba(8,8,20,0.9))`,
          borderBottom: `1px solid color-mix(in srgb, ${accent} 18%, transparent)`,
          display: "flex", alignItems: "center", gap: 10,
        }}
      >
        <div style={{
          width: 36, height: 36, borderRadius: 8, flexShrink: 0,
          background: `color-mix(in srgb, ${accent} 18%, rgba(0,0,0,0.5))`,
          border: `1.5px solid ${accent}`,
          display: "flex", alignItems: "center", justifyContent: "center",
          boxShadow: `0 0 12px color-mix(in srgb, ${accent} 35%, transparent)`,
        }}>
          <Icon size={16} color={accent} />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 13, color: accent, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {dept.name}
          </div>
          <div style={{ fontSize: 10, color: "var(--color-text-dim)" }}>
            {activeAgents.length} active · {deptAgents.length} total
            {workingAgents.length > 0 && <span style={{ color: "#10b981", marginLeft: 6 }}>● {workingAgents.length} working</span>}
          </div>
        </div>
        <span style={{
          fontSize: 9, fontWeight: 800, padding: "2px 8px", borderRadius: 20, flexShrink: 0,
          background: dept.enabled ? `color-mix(in srgb, ${accent} 16%, transparent)` : "rgba(100,116,139,0.15)",
          color: dept.enabled ? accent : "#64748b",
          textTransform: "uppercase", letterSpacing: "0.06em",
        }}>
          {dept.enabled ? "online" : "offline"}
        </span>
        <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--color-text-dim)", display: "flex", padding: 2, flexShrink: 0 }}>
          <X size={14} />
        </button>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", borderBottom: "1px solid var(--color-border)", flexShrink: 0 }}>
        <button style={tabStyle("overview")} onClick={() => setTab("overview")}>Overview</button>
        <button style={tabStyle("agents")}   onClick={() => setTab("agents")}>Agents</button>
        <button style={tabStyle("chat")}     onClick={() => setTab("chat")}>Chat</button>
      </div>

      {/* Content */}
      <div style={{ flex: 1, minHeight: 0, overflowY: tab === "chat" ? "hidden" : "auto", padding: 14, display: "flex", flexDirection: "column", gap: tab === "chat" ? 0 : 12 }}>

        {/* ── OVERVIEW ── */}
        {tab === "overview" && (
          <>
            {dept.description && (
              <p style={{ fontSize: 11, color: "var(--color-text-dim)", margin: 0, lineHeight: 1.6 }}>
                {dept.description}
              </p>
            )}

            {/* Stats grid */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
              {([
                ["Active",   `${activeAgents.length}`,  accent],
                ["Total",    `${deptAgents.length}`,     "var(--color-text)"],
                ["Working",  `${workingAgents.length}`,  "#10b981"],
              ] as [string, string, string][]).map(([lbl, val, c]) => (
                <div key={lbl} style={{ background: "var(--color-card-inner)", borderRadius: 6, padding: "8px 10px", textAlign: "center" }}>
                  <div style={{ fontSize: 20, fontWeight: 900, color: c, lineHeight: 1 }}>{val}</div>
                  <div style={{ fontSize: 9, color: "var(--color-text-dim)", textTransform: "uppercase", letterSpacing: "0.06em", marginTop: 3 }}>{lbl}</div>
                </div>
              ))}
            </div>

            {/* Budget bar */}
            {dept.budget_daily_usd > 0 && (
              <div>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--color-text-dim)", marginBottom: 5 }}>
                  <span style={{ textTransform: "uppercase", letterSpacing: "0.06em", fontSize: 9 }}>Daily Budget</span>
                  <span style={{ color: budgetColor, fontWeight: 700 }}>
                    ${dept.budget_used_today.toFixed(4)} / ${dept.budget_daily_usd.toFixed(2)} ({budgetPct}%)
                  </span>
                </div>
                <div style={{ height: 5, borderRadius: 3, background: "var(--color-border)", overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${budgetPct}%`, background: budgetColor, borderRadius: 3, boxShadow: `0 0 8px ${budgetColor}`, transition: "width 0.4s" }} />
                </div>
              </div>
            )}

            {/* Head agent */}
            {headAgent && (
              <div
                onClick={() => { setSelectedAgent(headAgent.agent_id); onClose(); }}
                style={{
                  background: `color-mix(in srgb, ${accent} 8%, var(--color-bg))`,
                  borderRadius: 8, padding: "10px 12px", cursor: "pointer",
                  border: `1px solid color-mix(in srgb, ${accent} 20%, transparent)`,
                  display: "flex", alignItems: "center", gap: 10,
                }}
              >
                <div style={{ width: 32, height: 32, borderRadius: "50%", overflow: "hidden", border: `2px solid ${accent}`, flexShrink: 0 }}>
                  <img src={agentAvatarUrl(headAgent)} alt={headAgent.codename} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.07em", color: accent, marginBottom: 2 }}>★ Head</div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "var(--color-text)" }}>{headAgent.name}</div>
                  <div style={{ fontSize: 9, color: "var(--color-text-dim)" }}>@{headAgent.codename} · L{headAgent.level}</div>
                </div>
                <ChevronRight size={12} color="var(--color-text-dim)" />
              </div>
            )}

            {/* Enable/disable toggle */}
            <div style={{ display: "flex", gap: 6 }}>
              <button
                onClick={() => { setBusy(true); toggleDept(deptId, !dept.enabled).finally(() => setBusy(false)); }}
                disabled={busy}
                style={{
                  flex: 1, padding: "8px", borderRadius: 7, border: "none", cursor: busy ? "wait" : "pointer",
                  fontWeight: 800, fontSize: 11, fontFamily: "inherit",
                  background: dept.enabled ? "#2d1a1a" : accent,
                  color: dept.enabled ? "#ef4444" : "#000",
                  opacity: busy ? 0.5 : 1,
                }}
              >
                {dept.enabled ? "⏸ Disable Dept" : "▶ Enable Dept"}
              </button>
              <button
                onClick={() => window.open(`${window.location.origin}/#company`, "_blank")}
                style={{ padding: "8px 12px", borderRadius: 7, border: "1px solid var(--color-border)", background: "var(--color-card-inner)", cursor: "pointer", color: "var(--color-text-dim)", fontSize: 11, fontFamily: "inherit", display: "flex", alignItems: "center", gap: 5 }}
              >
                <ExternalLink size={11} />
              </button>
            </div>

            {/* Pipeline activity */}
            <DeptPipelineActivity deptAgents={deptAgents} accent={accent} />
          </>
        )}

        {/* ── AGENTS LIST ── */}
        {tab === "agents" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {deptAgents.length === 0 && (
              <div style={{ textAlign: "center", padding: "24px 0", color: "var(--color-text-dim)", fontSize: 12 }}>
                No agents assigned
              </div>
            )}
            {deptAgents.map(agent => {
              const isHead    = agent.codename === dept.head_agent;
              const rtColor   = runtimeColor[agent.runtime_status] ?? "#64748b";
              const agentAccent = agent.badge_color || accent;
              return (
                <div
                  key={agent.agent_id}
                  onClick={() => { setSelectedAgent(agent.agent_id); onClose(); }}
                  style={{
                    display: "flex", alignItems: "center", gap: 10,
                    padding: "8px 10px", borderRadius: 7, cursor: "pointer",
                    background: "var(--color-card-inner)",
                    border: `1px solid color-mix(in srgb, ${agentAccent} 14%, transparent)`,
                    opacity: agent.status === "active" ? 1 : 0.55,
                    transition: "background 0.12s",
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = `color-mix(in srgb, ${agentAccent} 8%, var(--color-bg))`)}
                  onMouseLeave={e => (e.currentTarget.style.background = "var(--color-bg)")}
                >
                  <div style={{ position: "relative", flexShrink: 0 }}>
                    <div style={{ width: 30, height: 30, borderRadius: "50%", overflow: "hidden", border: `2px solid ${agentAccent}` }}>
                      <img src={agentAvatarUrl(agent)} alt={agent.codename} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    </div>
                    <div style={{
                      position: "absolute", bottom: -1, right: -1,
                      width: 8, height: 8, borderRadius: "50%", background: rtColor,
                      border: "1.5px solid rgba(8,8,20,0.9)",
                    }} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 11, fontWeight: 700, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--color-text)" }}>
                      {isHead && <span style={{ color: "#f59e0b", marginRight: 4 }}>★</span>}
                      {agent.name}
                    </div>
                    <div style={{ fontSize: 9, color: "var(--color-text-dim)" }}>@{agent.codename} · L{agent.level}</div>
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2, flexShrink: 0 }}>
                    <span style={{ fontSize: 8, fontWeight: 800, color: rtColor, textTransform: "uppercase", letterSpacing: "0.05em" }}>
                      {agent.runtime_status}
                    </span>
                    <span style={{ fontSize: 8, color: "var(--color-text-dim)", textTransform: "uppercase" }}>
                      {agent.status}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── CHAT ── */}
        {tab === "chat" && (
          <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: 0 }}>

            {/* Header row */}
            <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
              <div style={{ fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--color-text-dim)", flex: 1 }}>
                {dept.name} — Team Chat
              </div>
              <button onClick={() => setAutoSpeak(v => !v)} title={autoSpeak ? "Mute" : "Auto-speak"}
                style={{ background: autoSpeak ? `color-mix(in srgb, ${accent} 20%, transparent)` : "var(--color-card-inner)", border: `1px solid color-mix(in srgb, ${accent} 22%, transparent)`, borderRadius: 6, padding: "4px 6px", cursor: "pointer", color: autoSpeak ? accent : "var(--color-text-dim)", display: "flex" }}>
                {autoSpeak ? <Volume2 size={11} /> : <VolumeX size={11} />}
              </button>
              <button onClick={deleteDeptHistory} title="Clear history"
                style={{ background: "var(--color-card-inner)", border: "1px solid var(--color-border)", borderRadius: 6, padding: "4px 6px", cursor: "pointer", color: "var(--color-text-dim)", display: "flex" }}>
                <Trash2 size={11} />
              </button>
            </div>

            {/* Quick-ask chips */}
            <div style={{ flexShrink: 0, marginBottom: 8 }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                {[`What is ${dept.name} working on?`, "Any blockers?", "Status of all agents?", "Recent activity?"].map(q => (
                  <button key={q} onClick={() => { sendDeptChat(q); }} disabled={chatStreaming}
                    style={{ background: "var(--color-card-inner)", border: `1px solid color-mix(in srgb, ${accent} 22%, transparent)`, borderRadius: 14, padding: "4px 10px", cursor: chatStreaming ? "not-allowed" : "pointer", color: accent, fontSize: 10, fontFamily: "inherit", opacity: chatStreaming ? 0.5 : 1 }}>
                    {q}
                  </button>
                ))}
              </div>
            </div>

            {/* Message thread */}
            <div style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 10, paddingRight: 2, minHeight: 0 }}>
              {!historyLoaded && (
                <div style={{ textAlign: "center", padding: "16px 0", color: "var(--color-text-dim)", fontSize: 11 }}>Loading history…</div>
              )}
              {historyLoaded && chatMsgs.length === 0 && (
                <div style={{ textAlign: "center", padding: "20px 0", color: "var(--color-text-dim)", fontSize: 11, lineHeight: 1.7 }}>
                  <div style={{ fontSize: 22, marginBottom: 6, color: accent }}><Icon size={22} /></div>
                  Message the <span style={{ color: accent, fontWeight: 700 }}>{dept.name}</span> team
                </div>
              )}
              {chatMsgs.map(m => {
                if (m.role === "user") {
                  return (
                    <div key={m.id} style={{ display: "flex", justifyContent: "flex-end" }}>
                      <div style={{ maxWidth: "80%", background: `color-mix(in srgb, ${accent} 18%, rgba(20,20,40,0.9))`, borderRadius: "12px 12px 4px 12px", padding: "8px 11px", fontSize: 11, lineHeight: 1.6, color: "var(--color-text)", wordBreak: "break-word", whiteSpace: "pre-wrap" }}>
                        {m.content}
                      </div>
                    </div>
                  );
                }
                // Agent message
                const agentColor = m.color || accent;
                return (
                  <div key={m.id} style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
                    <div style={{ width: 26, height: 26, borderRadius: "50%", flexShrink: 0, background: `color-mix(in srgb, ${agentColor} 20%, rgba(0,0,0,0.6))`, border: `1.5px solid ${agentColor}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, marginBottom: 2 }}>
                      {m.emoji || "🤖"}
                    </div>
                    <div style={{ maxWidth: "78%", display: "flex", flexDirection: "column", gap: 2 }}>
                      <div style={{ fontSize: 9, fontWeight: 800, color: agentColor, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                        {m.name || m.codename}
                      </div>
                      <div style={{ background: "var(--color-card-inner)", borderRadius: "12px 12px 12px 4px", padding: "8px 11px", fontSize: 11, lineHeight: 1.6, color: "var(--color-text)", border: `1px solid color-mix(in srgb, ${agentColor} 14%, transparent)`, wordBreak: "break-word", whiteSpace: "pre-wrap" }}>
                        {m.content || (m.streaming ? "" : "—")}
                        {m.streaming && <span style={{ display: "inline-block", marginLeft: 2, color: agentColor, animation: "blinkCursor 1s step-end infinite" }}>▌</span>}
                      </div>
                      {m.content && !m.streaming && m.codename && (
                        <button onClick={() => speakAs(m.content, m.codename!)}
                          style={{ alignSelf: "flex-start", background: "none", border: "none", cursor: "pointer", color: "var(--color-text-dim)", padding: "1px 4px", display: "flex", alignItems: "center", gap: 3, fontSize: 9 }}>
                          <Volume2 size={9} /> speak
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
              <div ref={deptChatEnd} />
            </div>

            {/* Input */}
            <div style={{ flexShrink: 0, paddingTop: 10, borderTop: "1px solid var(--color-border)", marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "flex", gap: 6, alignItems: "flex-end" }}>
                <textarea rows={2} value={chatInput}
                  onChange={e => setChatInput(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { sendDeptChat(chatInput); setChatInput(""); } }}
                  placeholder={recording ? "🔴 Listening…" : `Ask ${dept.name} team… (Ctrl+Enter)`}
                  disabled={chatStreaming}
                  style={{ flex: 1, background: "var(--color-card-inner)", borderRadius: 7, color: "var(--color-text)", border: `1px solid ${recording ? "#ef4444" : `color-mix(in srgb, ${accent} 22%, transparent)`}`, padding: "8px 10px", fontSize: 11, resize: "none", fontFamily: "inherit", outline: "none", lineHeight: 1.5, opacity: chatStreaming ? 0.6 : 1 }}
                />
                <button
                  onMouseDown={startDeptRecording}
                  onMouseUp={stopDeptRecording}
                  onMouseLeave={() => { if (recording) stopDeptRecording(); }}
                  style={{ background: recording ? "#ef4444" : "var(--color-card-inner)", border: `1px solid ${recording ? "#ef4444" : "var(--color-border)"}`, borderRadius: 7, padding: "8px", cursor: "pointer", display: "flex", alignItems: "center", flexShrink: 0, color: recording ? "#fff" : "var(--color-text-dim)" }}>
                  {recording ? <MicOff size={14} /> : <Mic size={14} />}
                </button>
              </div>
              <button
                onClick={() => { sendDeptChat(chatInput); setChatInput(""); }}
                disabled={chatStreaming || !chatInput.trim()}
                style={{ background: chatStreaming ? "rgba(99,102,241,0.3)" : accent, border: "none", borderRadius: 7, padding: "9px", cursor: chatStreaming || !chatInput.trim() ? "not-allowed" : "pointer", color: chatStreaming ? "var(--color-text-dim)" : "#000", fontWeight: 800, fontSize: 11, fontFamily: "inherit", opacity: !chatInput.trim() ? 0.45 : 1 }}>
                {chatStreaming ? "⟳ Team responding…" : `⚡ Ask ${dept.name} Team`}
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Resize handle */}
      <div
        onMouseDown={e => {
          e.stopPropagation();
          resizing.current = true;
          resizeOrigin.current = { mx: e.clientX, my: e.clientY, w: panelSize.w, h: panelSize.h };
          e.preventDefault();
        }}
        style={{
          position: "absolute", bottom: 0, right: 0,
          width: 18, height: 18, cursor: "nwse-resize",
          background: `color-mix(in srgb, ${accent} 15%, transparent)`,
          borderTopLeftRadius: 6,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}
      >
        <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
          <path d="M7 1L1 7M7 4L4 7" stroke={accent} strokeWidth="1.2" strokeLinecap="round"/>
        </svg>
      </div>
    </div>
  );
}

function DeptPipelineActivity({ deptAgents, accent }: { deptAgents: AgentLive[]; accent: string }) {
  const runs = usePipelineStore(s => s.runs);
  const codenames = new Set(deptAgents.map(a => a.codename));
  const recentRuns = runs
    .filter(r => r.nodes.some(n => codenames.has(n.id.replace("agent-", ""))))
    .slice(0, 3);

  if (recentRuns.length === 0) return null;

  return (
    <div style={{ background: "var(--color-card-inner)", borderRadius: 7, padding: "10px 12px" }}>
      <div style={{ fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--color-text-dim)", marginBottom: 7, display: "flex", gap: 5, alignItems: "center" }}>
        <GitBranch size={9} color={accent} /> Recent Runs
      </div>
      {recentRuns.map(run => {
        const involved = run.nodes.filter(n => codenames.has(n.id.replace("agent-", ""))).map(n => n.id.replace("agent-", ""));
        return (
          <div key={run.id} style={{ marginBottom: 6, padding: "5px 7px", borderRadius: 5, background: `rgba(0,0,0,0.2)`, borderLeft: `2px solid ${run.finishedAt ? "#10b981" : "#f59e0b"}` }}>
            <div style={{ fontSize: 10, color: "var(--color-text)", marginBottom: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {run.query.slice(0, 40)}{run.query.length > 40 ? "…" : ""}
            </div>
            <div style={{ fontSize: 8, color: "var(--color-text-dim)" }}>
              {involved.join(", ")} · {run.finishedAt ? `${((run.finishedAt - run.startedAt) / 1000).toFixed(1)}s` : "live"}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Agent right-click context menu (DOM overlay) ──────────────────────────────

function AgentContextMenu() {
  const { contextMenu, setContextMenu, agents, fetchLive } = useAgentStore();
  const [taskMode, setTaskMode]   = useState(false);
  const [taskInput, setTaskInput] = useState("");
  const [dispatched, setDispatched] = useState(false);
  const [busy, setBusy]           = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!contextMenu) return;
    function onPointerDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setContextMenu(null);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [contextMenu, setContextMenu]);

  if (!contextMenu) return null;
  const agent = agents.find(a => a.agent_id === contextMenu.agentId);
  if (!agent) return null;

  const accent = agent.badge_color || "#6366f1";
  const menuW  = 224;
  const safeX  = Math.min(contextMenu.x, window.innerWidth  - menuW - 12);
  const safeY  = Math.min(contextMenu.y, window.innerHeight - 280  - 12);

  async function dispatchTask() {
    if (!taskInput.trim() || busy) return;
    setBusy(true);
    try {
      await fetch(`${API}/api/chat/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: `@${agent!.codename}: ${taskInput.trim()}` }),
      });
      setDispatched(true);
      setTimeout(() => setContextMenu(null), 1800);
    } catch { setBusy(false); }
  }

  async function toggleAgentStatus() {
    setBusy(true);
    const newStatus = agent!.status === "active" ? "standby" : "active";
    try {
      await fetch(`${API}/api/agents/${agent!.agent_id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      await fetchLive();
    } catch { }
    setBusy(false);
    setContextMenu(null);
  }

  const rowBase = {
    width: "100%", display: "flex", alignItems: "center", gap: 10,
    padding: "9px 14px", cursor: "pointer", background: "none", border: "none",
    color: "#b0b8cc", textAlign: "left" as const, fontSize: 12, fontFamily: "inherit",
    transition: "background 0.1s",
  };

  return (
    <div
      ref={ref}
      key={contextMenu.agentId}
      style={{
        position: "fixed", left: safeX, top: safeY, width: menuW, zIndex: 9999,
        background: "#07070f",
        border: `1px solid color-mix(in srgb, ${accent} 38%, transparent)`,
        borderRadius: 8, overflow: "hidden",
        boxShadow: `0 14px 44px rgba(0,0,0,0.82), 0 0 22px color-mix(in srgb, ${accent} 10%, transparent)`,
        fontFamily: "var(--font-mono, monospace)",
      }}
    >
      {/* Agent header */}
      <div style={{
        padding: "9px 12px", borderBottom: `1px solid color-mix(in srgb, ${accent} 22%, transparent)`,
        background: `color-mix(in srgb, ${accent} 9%, #07070f)`,
        display: "flex", alignItems: "center", gap: 9,
      }}>
        <span style={{ fontSize: 20, lineHeight: 1, flexShrink: 0 }}>{agent.avatar_emoji || "🤖"}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 800, fontSize: 12, color: accent, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {agent.name}
          </div>
          <div style={{ fontSize: 9, color: "#3a4460" }}>
            @{agent.codename} · L{agent.level} · {agent.department}
          </div>
        </div>
        <button
          onClick={() => setContextMenu(null)}
          style={{ background: "none", border: "none", cursor: "pointer", color: "#3a4460", display: "flex", padding: 2, flexShrink: 0 }}
        >
          <X size={12} />
        </button>
      </div>

      {/* Action list */}
      {!taskMode && !dispatched && (
        <div style={{ padding: "5px 0" }}>
          <button
            style={rowBase}
            onMouseEnter={e => (e.currentTarget.style.background = `color-mix(in srgb, ${accent} 11%, transparent)`)}
            onMouseLeave={e => (e.currentTarget.style.background = "none")}
            onClick={() => setTaskMode(true)}
          >
            <span>⚡</span><span>Assign Task…</span>
          </button>
          <button
            style={rowBase}
            onMouseEnter={e => (e.currentTarget.style.background = `color-mix(in srgb, ${accent} 11%, transparent)`)}
            onMouseLeave={e => (e.currentTarget.style.background = "none")}
            onClick={() => { window.open(`${window.location.origin}/#agents`, "_blank"); setContextMenu(null); }}
          >
            <span>👤</span><span>Open Profile ↗</span>
          </button>
          <button
            style={{ ...rowBase, opacity: busy ? 0.5 : 1 }}
            onMouseEnter={e => (e.currentTarget.style.background = `color-mix(in srgb, ${accent} 11%, transparent)`)}
            onMouseLeave={e => (e.currentTarget.style.background = "none")}
            onClick={toggleAgentStatus}
            disabled={busy}
          >
            <span>{agent.status === "active" ? "⏸" : "▶"}</span>
            <span>{agent.status === "active" ? "Set Standby" : "Activate"}</span>
          </button>
          <button
            style={rowBase}
            onMouseEnter={e => (e.currentTarget.style.background = `color-mix(in srgb, ${accent} 11%, transparent)`)}
            onMouseLeave={e => (e.currentTarget.style.background = "none")}
            onClick={() => { window.open(`${window.location.origin}/#pipeline`, "_blank"); setContextMenu(null); }}
          >
            <span>📋</span><span>View Pipeline ↗</span>
          </button>
        </div>
      )}

      {/* Task input mode */}
      {taskMode && !dispatched && (
        <div style={{ padding: "11px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
          <span style={{ fontSize: 9, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.1em", color: accent }}>
            Task for {agent.codename}
          </span>
          <textarea
            autoFocus
            rows={3}
            placeholder={`What should ${agent.codename} do? (Ctrl+Enter to send)`}
            value={taskInput}
            onChange={e => setTaskInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) dispatchTask(); }}
            style={{
              background: "#04040c", borderRadius: 5, color: "#c0c8e0",
              border: `1px solid color-mix(in srgb, ${accent} 28%, transparent)`,
              padding: "7px 9px", fontSize: 11, resize: "none",
              fontFamily: "inherit", outline: "none", lineHeight: 1.5,
            }}
          />
          <div style={{ display: "flex", gap: 6 }}>
            <button
              onClick={() => { setTaskMode(false); setTaskInput(""); }}
              style={{
                flex: 1, background: "none", border: "1px solid #1e2035",
                borderRadius: 5, cursor: "pointer", color: "#3a4460",
                padding: "7px", fontSize: 11, fontFamily: "inherit",
              }}
            >
              Cancel
            </button>
            <button
              onClick={dispatchTask}
              disabled={busy || !taskInput.trim()}
              style={{
                flex: 2, background: accent, border: "none", borderRadius: 5,
                cursor: busy || !taskInput.trim() ? "not-allowed" : "pointer",
                color: "#000", padding: "7px", fontSize: 11, fontWeight: 800,
                fontFamily: "inherit", opacity: busy || !taskInput.trim() ? 0.55 : 1,
              }}
            >
              {busy ? "Dispatching…" : "Dispatch ⚡"}
            </button>
          </div>
        </div>
      )}

      {/* Confirmation */}
      {dispatched && (
        <div style={{ padding: "20px 12px", textAlign: "center" }}>
          <div style={{ fontSize: 22, marginBottom: 6 }}>⚡</div>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#22c55e" }}>Task dispatched!</div>
          <div style={{ fontSize: 10, color: "#3a4460", marginTop: 3 }}>
            Sent to @{agent.codename}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export function CommandCenterPanel() {
  const {
    agents, departments, selectedAgentId, selectedDeptId,
    isLoading, lastFetched, wsConnected,
    fetchLive, setSelectedAgent, setSelectedDept,
  } = useAgentStore();
  const [tab, setTab] = useState<"floor" | "3d" | "activity" | "messages" | "tasks" | "terminals">("floor");

  useEffect(() => {
    fetchLive();
    connectCommandCenterWS();
    const iv = setInterval(fetchLive, 30_000);
    return () => clearInterval(iv);
  }, [fetchLive]);

  const activeCount  = agents.filter(a => a.status === "active").length;
  const onlineDepts  = departments.filter(d => d.enabled && agents.some(a => a.department === d.id && a.status === "active")).length;
  const jazper       = agents.find(a => a.codename === "jazper");

  const TABS: Array<{ id: typeof tab; label: string; icon: LucideIcon }> = [
    { id: "floor", label: "Floor", icon: MapIcon },
    { id: "3d", label: "3D", icon: Box },
    { id: "activity", label: "Activity", icon: ActivityIcon },
    { id: "messages", label: "Messages", icon: Mail },
    { id: "tasks", label: "Tasks", icon: ListTodo },
    { id: "terminals", label: "Terminals", icon: TerminalSquare },
  ];

  return (
    <div className="sj-panel" style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden", padding: 0 }}>

      {/* ── Header ── */}
      <div style={{
        padding: "9px 16px", borderBottom: "1px solid var(--color-border)",
        background: "var(--color-surface)", display: "flex", alignItems: "center",
        gap: 22, flexShrink: 0, flexWrap: "wrap", rowGap: 6,
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Building2 size={14} color="var(--color-accent)" />
          <span style={{ fontSize: 11, fontWeight: 900, letterSpacing: "0.12em", textTransform: "uppercase" }}>
            CO OS — Command Center
          </span>
        </div>

        <div style={{ display: "flex", gap: 18, marginLeft: "auto", alignItems: "center", flexWrap: "wrap" }}>
          <Stat label="Active Agents" value={`${activeCount} / ${agents.length}`} color="#10b981" />
          <Stat label="Depts Online"  value={`${onlineDepts} / ${departments.length}`} color="#3b82f6" />
          <Stat
            label="Jazper"
            value={jazper ? (jazper.status === "active" ? "ONLINE" : "STANDBY") : "—"}
            color={jazper?.status === "active" ? "#10b981" : "#94a3b8"}
          />

          <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10, color: "var(--color-text-dim)" }}>
            {wsConnected ? <Wifi size={11} color="#10b981" /> : <WifiOff size={11} color="#ef4444" />}
            <span>{lastFetched ? timeAgo(lastFetched) : "—"}</span>
          </div>

          <button
            onClick={() => fetchLive()}
            disabled={isLoading}
            style={{
              background: "none", border: "1px solid var(--color-border)", borderRadius: 6,
              padding: "4px 10px", cursor: isLoading ? "wait" : "pointer",
              color: "var(--color-text-dim)", display: "flex", alignItems: "center", gap: 5,
              fontSize: 11, opacity: isLoading ? 0.5 : 1,
            }}
          >
            <motion.span
              animate={isLoading ? { rotate: 360 } : { rotate: 0 }}
              transition={{ duration: 1, repeat: isLoading ? Infinity : 0, ease: "linear" }}
              style={{ display: "flex" }}
            >
              <RefreshCw size={11} />
            </motion.span>
            Sync
          </button>
        </div>
      </div>

      {/* ── Tab bar ── */}
      <div style={{
        display: "flex", gap: 2, padding: "4px 16px", borderBottom: "1px solid var(--color-border)",
        background: "var(--color-surface)", flexShrink: 0,
      }}>
        {TABS.map(t => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              style={{
                display: "flex", alignItems: "center", gap: 6, padding: "5px 12px",
                borderRadius: "6px 6px 0 0", cursor: "pointer", fontSize: 11, fontWeight: 700,
                border: "none", borderBottom: active ? "2px solid var(--color-text-primary)" : "2px solid transparent",
                background: active ? "var(--color-card-inner)" : "none",
                color: active ? "var(--color-text-primary)" : "var(--color-text-dim)",
                letterSpacing: "0.04em",
              }}
            >
              <Icon size={12} />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* ── Scene / view area ── */}
      <div
        style={{ flex: 1, position: "relative", overflow: "hidden" }}
        onContextMenu={(e) => e.preventDefault()}
      >
        {tab === "floor" && <FloorView />}
        {tab === "3d" && <CommandCenter3DScene />}
        {tab === "activity" && <ActivityView />}
        {tab === "messages" && <MessagesView />}
        {tab === "tasks" && <TasksView />}
        {tab === "terminals" && <TerminalsView />}
      </div>

      {/* Context menu — position: fixed, no clipping */}
      <AgentContextMenu />

      {/* Dept detail — floating window, position: fixed */}
      {(tab === "floor" || tab === "3d") && !selectedAgentId && selectedDeptId && (
        <DeptDetailPanel
          key={`d-${selectedDeptId}`}
          deptId={selectedDeptId}
          agents={agents}
          departments={departments}
          onClose={() => setSelectedDept(null)}
        />
      )}

      {/* Agent detail — floating window, position: fixed */}
      {(tab === "floor" || tab === "3d") && selectedAgentId && (
        <AgentDetailPanel
          key={`a-${selectedAgentId}`}
          agentId={selectedAgentId}
          onClose={() => setSelectedAgent(null)}
        />
      )}
    </div>
  );
}
