"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  Users, RefreshCw, Search, Building2, Brain,
  Volume2, Upload, X, Save, Pencil, Loader2, Plus, Trash2,
  Mail, CalendarClock, Clock, CheckCheck, Target,
} from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Agent {
  agent_id: string; codename: string; name: string; version: string;
  status: string; department: string; title: string; level: number;
  reports_to: string | null; model: string; temperature: number; max_tokens: number;
  tools_enabled: string[]; capabilities: string[]; system_prompt: string;
  system_prompt_override: string | null; auto_approve_types: string[];
  requires_approval_for: string[]; trust_tier: string;
  voice_id: string; voice_prosody: Record<string, string>;
  avatar_source: string; avatar_style: string; avatar_seed: string;
  avatar_custom_path: string | null; avatar_emoji: string; badge_color: string;
  description: string; health_score: number; tasks_completed: number; tasks_failed: number;
  last_active: string | null; created_at: string; updated_at: string;
  reports_to_name?: string; reports_to_title?: string;
  direct_reports?: { agent_id: string; name: string; title: string; status: string }[];
}

interface Department {
  id: string; name: string; description: string; head_agent: string | null;
  enabled: boolean; budget_daily_usd: number; budget_used_today: number;
  badge_color: string; floor_position: Record<string, number>;
}

interface AutonomyCategory {
  category_id: string; category: string; description: string;
  enabled: boolean; risk_level: string; enabled_at: string | null;
  last_used: string | null; use_count: number;
}

// ── Groq model catalogue ──────────────────────────────────────────────────────

const GROQ_MODELS = [
  {
    id: "llama-3.3-70b-versatile",
    label: "Llama 3.3 70B Versatile",
    tier: "L1–L2", ctx: "131K", speed: "Medium",
    note: "Best overall quality. Use for L1–L2 leadership agents and complex reasoning.",
  },
  {
    id: "llama-4-scout-17b-16e-instruct",
    label: "Llama 4 Scout 17B",
    tier: "L2–L3", ctx: "131K", speed: "Fast",
    note: "Fast and capable. Good for mid-tier agents handling research and coordination.",
  },
  {
    id: "qwen3-32b",
    label: "Qwen 3 32B",
    tier: "L2–L3", ctx: "131K", speed: "Medium",
    note: "Strong reasoning and instruction following. Solid L2–L3 choice.",
  },
  {
    id: "gemini-2.0-flash",
    label: "Gemini 2.0 Flash",
    tier: "L2–L3", ctx: "1M", speed: "Fast",
    note: "Huge 1M context window. Ideal for long-document agents like Archivist or Compass.",
  },
  {
    id: "llama-3.1-8b-instant",
    label: "Llama 3.1 8B Instant",
    tier: "L4–L5", ctx: "131K", speed: "Fastest",
    note: "Fastest model. Perfect for L4–L5 agents on structured, repetitive tasks.",
  },
  {
    id: "gemma2-9b-it",
    label: "Gemma 2 9B IT",
    tier: "L3–L4", ctx: "8K", speed: "Fast",
    note: "Efficient mid-tier. Note the small 8K context — avoid for long-document tasks.",
  },
  {
    id: "deepseek-r1-distill-llama-70b",
    label: "DeepSeek R1 70B",
    tier: "L2–L3", ctx: "131K", speed: "Slow",
    note: "Chain-of-thought reasoning specialist. Slower but excellent for complex analysis.",
  },
];

// ── Edge-TTS voice catalogue ──────────────────────────────────────────────────

const VOICES = [
  { id: "en-US-GuyNeural",         label: "Guy — US Male (Warm, professional)",    group: "US English" },
  { id: "en-US-ChristopherNeural", label: "Christopher — US Male (Confident)",     group: "US English" },
  { id: "en-US-EricNeural",        label: "Eric — US Male (Energetic)",             group: "US English" },
  { id: "en-US-RogerNeural",       label: "Roger — US Male (Deep, authoritative)",  group: "US English" },
  { id: "en-US-SteffanNeural",     label: "Steffan — US Male (Technical)",          group: "US English" },
  { id: "en-US-DavisNeural",       label: "Davis — US Male (Low, deliberate)",      group: "US English" },
  { id: "en-US-AndrewNeural",      label: "Andrew — US Male (Problem-solver)",      group: "US English" },
  { id: "en-US-TonyNeural",        label: "Tony — US Male (Direct, grounded)",      group: "US English" },
  { id: "en-US-JasonNeural",       label: "Jason — US Male (Clear, organized)",     group: "US English" },
  { id: "en-US-JennyNeural",       label: "Jenny — US Female (Professional)",       group: "US English" },
  { id: "en-US-AriaNeural",        label: "Aria — US Female (Warm)",                group: "US English" },
  { id: "en-US-MonicaNeural",      label: "Monica — US Female (Confident)",         group: "US English" },
  { id: "en-US-MichelleNeural",    label: "Michelle — US Female (Articulate)",      group: "US English" },
  { id: "en-GB-RyanNeural",        label: "Ryan — UK Male (Refined, methodical)",   group: "UK English" },
  { id: "en-GB-SoniaNeural",       label: "Sonia — UK Female (Assured)",            group: "UK English" },
  { id: "en-GB-LibbyNeural",       label: "Libby — UK Female (Clear)",              group: "UK English" },
  { id: "en-AU-NatashaNeural",     label: "Natasha — AU Female (Analytical)",       group: "Australian" },
  { id: "en-AU-WilliamNeural",     label: "William — AU Male (Steady)",             group: "Australian" },
  { id: "en-IN-NeerjaNeural",      label: "Neerja — IN Female (Expressive)",        group: "Indian English" },
  { id: "en-IN-PrabhatNeural",     label: "Prabhat — IN Male (Conversational)",     group: "Indian English" },
];

const DICEBEAR_STYLES = [
  "bottts", "bottts-neutral", "pixel-art", "avataaars", "lorelei",
  "adventurer", "identicon", "rings", "shapes", "initials",
];

// ── Shared helpers ────────────────────────────────────────────────────────────

function avatarUrl(agent: Pick<Agent,"avatar_source"|"avatar_style"|"avatar_seed"|"codename"|"avatar_custom_path">): string {
  if (agent.avatar_source === "custom") return `${API}/api/agents/avatars/${agent.codename}`;
  return `https://api.dicebear.com/7.x/${agent.avatar_style || "bottts"}/svg?seed=${encodeURIComponent(agent.avatar_seed || agent.codename)}`;
}

function dicebearUrl(style: string, seed: string): string {
  return `https://api.dicebear.com/7.x/${style}/svg?seed=${encodeURIComponent(seed || "preview")}`;
}

function statusColor(s: string): string {
  const m: Record<string,string> = { active:"#22c55e", standby:"#60a5fa", thinking:"#f59e0b", working:"#22c55e", suspended:"#ef4444", deprecated:"#6b7280", retired:"#6b7280" };
  return m[s] ?? "#94a3b8";
}

function riskColor(r: string): string {
  return r === "high" ? "#ef4444" : r === "medium" ? "#f59e0b" : "#22c55e";
}

function modelInfo(id: string) {
  return GROQ_MODELS.find(m => m.id === id) ?? { id, label: id, tier: "—", ctx: "—", speed: "—", note: "" };
}

async function playAgentVoice(agentId: string, text?: string) {
  try {
    const res = await fetch(`${API}/api/agents/${agentId}/speak`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }),
    });
    if (!res.ok) return;
    const url = URL.createObjectURL(await res.blob());
    const audio = new Audio(url);
    audio.onended = () => URL.revokeObjectURL(url);
    await audio.play();
  } catch { /* offline */ }
}

// ── Toggle ────────────────────────────────────────────────────────────────────

function Toggle({ on, onToggle, size="sm" }: { on: boolean; onToggle: () => void; size?: "sm"|"md" }) {
  const w = size==="md"?40:30, h = size==="md"?22:17, d = size==="md"?16:13;
  return (
    <button onClick={e => { e.stopPropagation(); onToggle(); }} style={{
      width:w, height:h, borderRadius:99, border:"none", cursor:"pointer",
      background: on ? "var(--color-accent)" : "var(--color-surface-float)",
      position:"relative", flexShrink:0, transition:"var(--ease-soft)",
    }}>
      <span style={{ position:"absolute", top:(h-d)/2, left: on ? w-d-2 : 2, width:d, height:d,
        borderRadius:"50%", background: on?"#fff":"var(--color-text-muted)", transition:"var(--ease-soft)" }} />
    </button>
  );
}

// ── Agent avatar ──────────────────────────────────────────────────────────────

function AgentAvatar({ agent, size=40 }: { agent: Partial<Agent> & { codename:string; avatar_emoji:string }; size?: number }) {
  const [failed, setFailed] = useState(false);
  return failed
    ? <div style={{ width:size, height:size, borderRadius:"50%", flexShrink:0, background:"var(--color-surface-raised)", border:"var(--border)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:size*0.45 }}>{agent.avatar_emoji||"🤖"}</div>
    : <img src={avatarUrl(agent as Agent)} alt={agent.codename} onError={() => setFailed(true)} style={{ width:size, height:size, borderRadius:"50%", flexShrink:0, objectFit:"cover" }} />;
}

// ── DiceBear style grid (shows actual images instead of text) ─────────────────

function StyleGrid({ selected, seed, onSelect }: { selected:string; seed:string; onSelect:(s:string)=>void }) {
  return (
    <div>
      <p className="sj-micro" style={{ color:"var(--color-text-muted)", marginBottom:6 }}>Style — click to change</p>
      <div style={{ display:"grid", gridTemplateColumns:"repeat(5,1fr)", gap:6 }}>
        {DICEBEAR_STYLES.map(style => (
          <button key={style} onClick={() => onSelect(style)} title={style} style={{
            background: selected===style ? "color-mix(in srgb, var(--color-accent) 15%, transparent)" : "var(--color-surface-raised)",
            border: selected===style ? "2px solid var(--color-accent)" : "var(--border)",
            borderRadius:"var(--r-md)", padding:4, cursor:"pointer",
            display:"flex", flexDirection:"column", alignItems:"center", gap:3,
            transition:"var(--ease-soft)",
          }}>
            <img src={dicebearUrl(style, seed)} alt={style} style={{ width:44, height:44, borderRadius:"50%", display:"block" }} />
            <span style={{ fontSize:8, color:"var(--color-text-muted)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap", maxWidth:52 }}>{style}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Model picker with info card ───────────────────────────────────────────────

function ModelPicker({ value, onChange }: { value:string; onChange:(id:string)=>void }) {
  const info = modelInfo(value);
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"var(--sp-2)" }}>
      <label className="sj-micro" style={{ color:"var(--color-text-muted)" }}>Model</label>
      <select className="sj-input" value={value} onChange={e => onChange(e.target.value)} style={{ fontSize:11 }}>
        {GROQ_MODELS.map(m => <option key={m.id} value={m.id}>{m.label} · {m.tier}</option>)}
        {!GROQ_MODELS.find(m => m.id === value) && <option value={value}>{value} (custom)</option>}
      </select>
      <div style={{ background:"var(--color-surface-raised)", border:"var(--border)", borderRadius:"var(--r-sm)", padding:"var(--sp-2) var(--sp-3)", display:"flex", gap:"var(--sp-3)", flexWrap:"wrap" }}>
        {[["Tier", info.tier, "var(--color-accent)"], ["Context", info.ctx, "var(--color-text-secondary)"], ["Speed", info.speed, "var(--color-text-secondary)"]].map(([k,v,c]) => (
          <span key={k} className="sj-micro" style={{ color:"var(--color-text-muted)" }}>{k}: <span style={{ color: c as string }}>{v}</span></span>
        ))}
        {info.note && <span className="sj-micro" style={{ color:"var(--color-text-muted)", width:"100%" }}>{info.note}</span>}
      </div>
    </div>
  );
}

// ── Avatar Editor Modal ───────────────────────────────────────────────────────

function AvatarEditor({ agent, onSave, onClose }: { agent:Agent; onSave:(p:Partial<Agent>)=>void; onClose:()=>void }) {
  const [tab, setTab]     = useState<"dicebear"|"upload">("dicebear");
  const [style, setStyle] = useState(agent.avatar_style || "bottts");
  const [seed, setSeed]   = useState(agent.avatar_seed  || agent.codename);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function saveDicebear() {
    setSaving(true);
    const res = await fetch(`${API}/api/agents/${agent.agent_id}`, {
      method:"PATCH", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({ avatar_source:"dicebear", avatar_style:style, avatar_seed:seed }),
    });
    setSaving(false);
    if (res.ok) { onSave({ avatar_source:"dicebear", avatar_style:style, avatar_seed:seed }); onClose(); }
  }

  async function handleFile(file: File) {
    setUploading(true);
    const form = new FormData(); form.append("file", file);
    const res = await fetch(`${API}/api/agents/avatars/${agent.codename}`, { method:"POST", body:form });
    setUploading(false);
    if (res.ok) { onSave({ avatar_source:"custom" }); onClose(); }
  }

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.7)", zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center" }} onClick={onClose}>
      <div style={{ background:"var(--color-surface)", border:"var(--border-hi)", borderRadius:"var(--r-lg)", padding:"var(--sp-5)", width:530, maxHeight:"85vh", overflowY:"auto" }} onClick={e => e.stopPropagation()}>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:"var(--sp-4)" }}>
          <span className="sj-label">Edit Avatar — {agent.name}</span>
          <button onClick={onClose} style={{ background:"none", border:"none", cursor:"pointer", color:"var(--color-text-muted)" }}><X size={14}/></button>
        </div>

        <div style={{ display:"flex", gap:"var(--sp-1)", marginBottom:"var(--sp-4)", borderBottom:"var(--border)", paddingBottom:"var(--sp-2)" }}>
          {(["dicebear","upload"] as const).map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              background: tab===t ? "var(--color-surface-raised)" : "none",
              border: tab===t ? "var(--border)" : "none",
              borderRadius:"var(--r-xs)", padding:"3px 10px", cursor:"pointer", fontSize:11,
              color: tab===t ? "var(--color-text-primary)" : "var(--color-text-muted)",
            }}>{t==="dicebear" ? "DiceBear Generator" : "Custom Upload"}</button>
          ))}
        </div>

        {tab==="dicebear" && (
          <div style={{ display:"flex", flexDirection:"column", gap:"var(--sp-4)" }}>
            <div style={{ display:"flex", justifyContent:"center" }}>
              <img src={dicebearUrl(style,seed)} alt="preview" style={{ width:90, height:90, borderRadius:"50%", border:"var(--border-hi)" }} />
            </div>
            <StyleGrid selected={style} seed={seed} onSelect={setStyle} />
            <div>
              <label className="sj-micro" style={{ color:"var(--color-text-muted)", display:"block", marginBottom:4 }}>Seed — any text generates a unique avatar</label>
              <input className="sj-input" value={seed} onChange={e => setSeed(e.target.value)} placeholder={`e.g. ${agent.codename}`} style={{ fontSize:11 }} />
            </div>
            <div style={{ display:"flex", gap:"var(--sp-2)" }}>
              <button className="sj-input" onClick={() => setSeed(Math.random().toString(36).slice(2))} style={{ fontSize:11, cursor:"pointer", flex:1 }}>Randomize seed</button>
              <button className="sj-input" onClick={() => setSeed(agent.codename)} style={{ fontSize:11, cursor:"pointer", flex:1 }}>Reset to default</button>
            </div>
            <button onClick={saveDicebear} disabled={saving} style={{ background:"var(--color-accent)", color:"#fff", border:"none", borderRadius:"var(--r-xs)", padding:"8px 16px", cursor:"pointer", fontSize:12, display:"flex", alignItems:"center", justifyContent:"center", gap:"var(--sp-2)" }}>
              {saving ? <Loader2 size={12} className="spin"/> : <Save size={12}/>}
              {saving ? "Saving…" : "Apply Avatar"}
            </button>
          </div>
        )}

        {tab==="upload" && (
          <div style={{ display:"flex", flexDirection:"column", gap:"var(--sp-3)" }}>
            <p className="sj-micro" style={{ color:"var(--color-text-muted)", lineHeight:1.6 }}>Upload PNG, JPG, GIF, WebP, or SVG. Square images work best (64–512 px).</p>
            <div onClick={() => fileRef.current?.click()} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
              style={{ border:"2px dashed var(--color-border)", borderRadius:"var(--r-md)", padding:"var(--sp-6)", textAlign:"center", cursor:"pointer", background:"var(--color-surface-raised)", display:"flex", flexDirection:"column", alignItems:"center", gap:"var(--sp-2)" }}>
              {uploading
                ? <Loader2 size={24} className="spin" style={{ color:"var(--color-accent)" }}/>
                : (<><Upload size={24} style={{ color:"var(--color-text-muted)" }}/><span className="sj-micro" style={{ color:"var(--color-text-muted)" }}>Drag & drop or click to upload</span></>)
              }
            </div>
            <input ref={fileRef} type="file" accept="image/*" style={{ display:"none" }} onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f); }}/>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Retire button (inside lifecycle tab) ─────────────────────────────────────

function RetireButton({ agentId, agentName, onRetired }: { agentId:string; agentName:string; onRetired:()=>void }) {
  const [confirming, setConfirming] = useState(false);
  const [retiring,   setRetiring]   = useState(false);

  async function retire() {
    setRetiring(true);
    try {
      await fetch(`${API}/api/agents/${agentId}`, { method: "DELETE" });
      onRetired();
    } catch { /* silent */ }
    setRetiring(false);
  }

  if (confirming) return (
    <div style={{ padding:"var(--sp-3)", borderRadius:"var(--r-md)", background:"var(--color-surface-raised)", border:"var(--border)", display:"flex", flexDirection:"column", gap:"var(--sp-2)" }}>
      <p className="sj-micro" style={{ color:"var(--color-text-secondary)", lineHeight:1.6 }}>
        Retire <strong>{agentName}</strong>? The agent will be marked as retired and removed from active rotation. This can be undone by setting status back to active.
      </p>
      <div style={{ display:"flex", gap:"var(--sp-2)" }}>
        <button onClick={() => setConfirming(false)} className="sj-btn sj-btn-ghost" style={{ flex:1 }}>Cancel</button>
        <button onClick={retire} disabled={retiring} className="sj-btn sj-btn-outline" style={{ flex:1 }}>
          {retiring ? <Loader2 size={11} className="spin"/> : <Trash2 size={11}/>}
          {retiring ? "Retiring…" : "Confirm Retire"}
        </button>
      </div>
    </div>
  );

  return (
    <button onClick={() => setConfirming(true)} className="sj-btn sj-btn-ghost" style={{ alignSelf:"flex-start", gap:"var(--sp-1)" }}>
      <Trash2 size={11}/> Retire Agent
    </button>
  );
}

// ── Create Agent Modal ────────────────────────────────────────────────────────

function CreateAgentModal({ departments, onClose, onCreated }: { departments:Department[]; onClose:()=>void; onCreated:()=>void }) {
  const [codename,    setCodename]    = useState("");
  const [name,        setName]        = useState("");
  const [title,       setTitle]       = useState("");
  const [dept,        setDept]        = useState(departments[0]?.id ?? "");
  const [level,       setLevel]       = useState(3);
  const [model,       setModel]       = useState("llama-3.3-70b-versatile");
  const [temp,        setTemp]        = useState(0.5);
  const [description, setDescription] = useState("");
  const [emoji,       setEmoji]       = useState("🤖");
  const [badgeColor,  setBadgeColor]  = useState("#94a3b8");
  const [saving,      setSaving]      = useState(false);
  const [error,       setError]       = useState("");

  const agentId = codename ? `AGT-${codename.toUpperCase().slice(0,6)}` : "";

  async function create() {
    if (!codename.trim() || !name.trim() || !title.trim() || !dept) {
      setError("Codename, name, title and department are required."); return;
    }
    setSaving(true); setError("");
    try {
      const res = await fetch(`${API}/api/agents/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agent_id: agentId,
          codename: codename.toLowerCase().trim(),
          name: name.trim(),
          title: title.trim(),
          department: dept,
          level,
          model,
          temperature: temp,
          description: description.trim(),
          avatar_emoji: emoji,
          badge_color: badgeColor,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.detail ?? "Create failed"); setSaving(false); return; }
      onCreated(); onClose();
    } catch { setError("Network error"); }
    setSaving(false);
  }

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.7)", zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center" }} onClick={onClose}>
      <div style={{ background:"var(--color-surface)", border:"var(--border-hi)", borderRadius:"var(--r-lg)", padding:"var(--sp-5)", width:520, maxHeight:"88vh", overflowY:"auto" }} onClick={e => e.stopPropagation()}>

        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:"var(--sp-4)" }}>
          <span className="sj-label">New Agent</span>
          <button onClick={onClose} style={{ background:"none", border:"none", cursor:"pointer", color:"var(--color-text-muted)" }}><X size={14}/></button>
        </div>

        <div style={{ display:"flex", flexDirection:"column", gap:"var(--sp-3)" }}>

          {/* Identity row */}
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"var(--sp-2)" }}>
            <div>
              <label className="sj-micro" style={{ display:"block", marginBottom:4 }}>Codename <span style={{ color:"var(--color-text-muted)" }}>(lowercase, no spaces)</span></label>
              <input className="sj-input" value={codename} onChange={e => setCodename(e.target.value.toLowerCase().replace(/\s/g,""))} placeholder="e.g. nexus" style={{ fontSize:11 }}/>
              {agentId && <p className="sj-micro" style={{ marginTop:3 }}>ID: <span style={{ fontFamily:"monospace" }}>{agentId}</span></p>}
            </div>
            <div>
              <label className="sj-micro" style={{ display:"block", marginBottom:4 }}>Display Name</label>
              <input className="sj-input" value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Nexus" style={{ fontSize:11 }}/>
            </div>
          </div>

          <div>
            <label className="sj-micro" style={{ display:"block", marginBottom:4 }}>Title</label>
            <input className="sj-input" value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Intelligence Coordinator — Ops" style={{ fontSize:11 }}/>
          </div>

          <div style={{ display:"grid", gridTemplateColumns:"1fr auto", gap:"var(--sp-2)" }}>
            <div>
              <label className="sj-micro" style={{ display:"block", marginBottom:4 }}>Department</label>
              <select className="sj-input" value={dept} onChange={e => setDept(e.target.value)} style={{ fontSize:11 }}>
                {departments.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            <div>
              <label className="sj-micro" style={{ display:"block", marginBottom:4 }}>Level</label>
              <select className="sj-input" value={level} onChange={e => setLevel(Number(e.target.value))} style={{ fontSize:11, width:72 }}>
                {[1,2,3,4,5].map(l => <option key={l} value={l}>L{l}</option>)}
              </select>
            </div>
          </div>

          <ModelPicker value={model} onChange={setModel}/>

          <div>
            <label className="sj-micro" style={{ display:"block", marginBottom:4 }}>Temperature: <span style={{ color:"var(--color-text-primary)" }}>{temp.toFixed(2)}</span></label>
            <input type="range" min={0} max={1} step={0.05} value={temp} onChange={e => setTemp(parseFloat(e.target.value))} style={{ width:"100%" }}/>
          </div>

          <div>
            <label className="sj-micro" style={{ display:"block", marginBottom:4 }}>Description</label>
            <textarea className="sj-textarea" value={description} onChange={e => setDescription(e.target.value)} rows={3} placeholder="What does this agent do?" style={{ fontSize:11 }}/>
          </div>

          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"var(--sp-2)" }}>
            <div>
              <label className="sj-micro" style={{ display:"block", marginBottom:4 }}>Avatar Emoji</label>
              <input className="sj-input" value={emoji} onChange={e => setEmoji(e.target.value)} placeholder="🤖" style={{ fontSize:18, textAlign:"center" }}/>
            </div>
            <div>
              <label className="sj-micro" style={{ display:"block", marginBottom:4 }}>Badge Color</label>
              <div style={{ display:"flex", gap:"var(--sp-1)", alignItems:"center" }}>
                <input type="color" value={badgeColor} onChange={e => setBadgeColor(e.target.value)} style={{ width:36, height:36, border:"var(--border)", borderRadius:"var(--r-sm)", cursor:"pointer", padding:2, background:"var(--color-surface)" }}/>
                <input className="sj-input" value={badgeColor} onChange={e => setBadgeColor(e.target.value)} style={{ fontSize:11, fontFamily:"monospace" }}/>
              </div>
            </div>
          </div>

          {error && <p className="sj-micro" style={{ color:"var(--color-text-muted)", padding:"var(--sp-2) var(--sp-3)", background:"var(--color-surface-raised)", borderRadius:"var(--r-xs)", border:"var(--border)" }}>{error}</p>}

          <div style={{ display:"flex", gap:"var(--sp-2)", justifyContent:"flex-end", paddingTop:"var(--sp-2)", borderTop:"var(--border)" }}>
            <button onClick={onClose} className="sj-btn sj-btn-ghost">Cancel</button>
            <button onClick={create} disabled={saving} className="sj-btn sj-btn-primary">
              {saving ? <Loader2 size={12} className="spin"/> : <Plus size={12}/>}
              {saving ? "Creating…" : "Create Agent"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Create Department Modal ───────────────────────────────────────────────────

function CreateDepartmentModal({ onClose, onCreated }: { onClose:()=>void; onCreated:()=>void }) {
  const [id,          setId]          = useState("");
  const [name,        setName]        = useState("");
  const [description, setDescription] = useState("");
  const [badgeColor,  setBadgeColor]  = useState("#94a3b8");
  const [saving,      setSaving]      = useState(false);
  const [error,       setError]       = useState("");

  async function create() {
    if (!id.trim() || !name.trim()) { setError("ID and name are required."); return; }
    setSaving(true); setError("");
    try {
      const res = await fetch(`${API}/api/agents/departments/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: id.toLowerCase().replace(/\s/g,"_").trim(), name: name.trim(), description: description.trim(), badge_color: badgeColor }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.detail ?? "Create failed"); setSaving(false); return; }
      onCreated(); onClose();
    } catch { setError("Network error"); }
    setSaving(false);
  }

  return (
    <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.7)", zIndex:1000, display:"flex", alignItems:"center", justifyContent:"center" }} onClick={onClose}>
      <div style={{ background:"var(--color-surface)", border:"var(--border-hi)", borderRadius:"var(--r-lg)", padding:"var(--sp-5)", width:400 }} onClick={e => e.stopPropagation()}>

        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:"var(--sp-4)" }}>
          <span className="sj-label">New Department</span>
          <button onClick={onClose} style={{ background:"none", border:"none", cursor:"pointer", color:"var(--color-text-muted)" }}><X size={14}/></button>
        </div>

        <div style={{ display:"flex", flexDirection:"column", gap:"var(--sp-3)" }}>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:"var(--sp-2)" }}>
            <div>
              <label className="sj-micro" style={{ display:"block", marginBottom:4 }}>ID <span style={{ color:"var(--color-text-muted)" }}>(slug, e.g. ops)</span></label>
              <input className="sj-input" value={id} onChange={e => setId(e.target.value.toLowerCase().replace(/\s/g,"_"))} placeholder="ops" style={{ fontSize:11 }}/>
            </div>
            <div>
              <label className="sj-micro" style={{ display:"block", marginBottom:4 }}>Display Name</label>
              <input className="sj-input" value={name} onChange={e => setName(e.target.value)} placeholder="Operations" style={{ fontSize:11 }}/>
            </div>
          </div>

          <div>
            <label className="sj-micro" style={{ display:"block", marginBottom:4 }}>Description</label>
            <textarea className="sj-textarea" value={description} onChange={e => setDescription(e.target.value)} rows={2} placeholder="What does this department handle?" style={{ fontSize:11 }}/>
          </div>

          <div>
            <label className="sj-micro" style={{ display:"block", marginBottom:4 }}>Badge Color</label>
            <div style={{ display:"flex", gap:"var(--sp-1)", alignItems:"center" }}>
              <input type="color" value={badgeColor} onChange={e => setBadgeColor(e.target.value)} style={{ width:36, height:36, border:"var(--border)", borderRadius:"var(--r-sm)", cursor:"pointer", padding:2, background:"var(--color-surface)" }}/>
              <input className="sj-input" value={badgeColor} onChange={e => setBadgeColor(e.target.value)} style={{ fontSize:11, fontFamily:"monospace" }}/>
            </div>
          </div>

          {error && <p className="sj-micro" style={{ color:"var(--color-text-muted)", padding:"var(--sp-2) var(--sp-3)", background:"var(--color-surface-raised)", borderRadius:"var(--r-xs)", border:"var(--border)" }}>{error}</p>}

          <div style={{ display:"flex", gap:"var(--sp-2)", justifyContent:"flex-end", paddingTop:"var(--sp-2)", borderTop:"var(--border)" }}>
            <button onClick={onClose} className="sj-btn sj-btn-ghost">Cancel</button>
            <button onClick={create} disabled={saving} className="sj-btn sj-btn-primary">
              {saving ? <Loader2 size={12} className="spin"/> : <Plus size={12}/>}
              {saving ? "Creating…" : "Create Department"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Agent ID Card Modal ───────────────────────────────────────────────────────

// ── Inbox message type ────────────────────────────────────────────────────────
interface InboxMessage {
  id: string; from: string; subject: string; message: string;
  status: string; received_at: string | null;
}

// ── Cron schedule type ────────────────────────────────────────────────────────
interface AgentSchedule {
  id: string; name: string; worker_type: string; schedule: string;
  enabled: boolean; description: string; created_at: string | null;
}

function AgentModal({ agent: init, onClose, onRefresh }: { agent:Agent; onClose:()=>void; onRefresh:()=>void }) {
  const [agent, setAgent]   = useState<Agent>(init);
  const [tab, setTab]       = useState<"overview"|"config"|"voice"|"lifecycle"|"inbox"|"schedule"|"goals">("overview");
  const [editing, setEditing] = useState(false);
  const [patch, setPatch]   = useState<Partial<Agent>>({});
  const [saving, setSaving] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [showAvatar, setShowAvatar] = useState(false);
  const [previewText, setPreviewText] = useState("");

  // Phase 8A — Inbox
  const [inbox, setInbox]           = useState<InboxMessage[]>([]);
  const [inboxLoading, setInboxLoading] = useState(false);
  const [inboxUnread, setInboxUnread]   = useState(0);

  // Phase 8C — Schedules
  const [schedules, setSchedules]     = useState<AgentSchedule[]>([]);
  const [schedLoading, setSchedLoading] = useState(false);

  // Phase 9D — Goals
  const [goals, setGoals]             = useState<{id:string;goal:string;condition:string;status:string;trigger_count:number;created_at:string}[]>([]);
  const [goalsLoading, setGoalsLoading] = useState(false);

  useEffect(() => {
    if (tab === "inbox" && inbox.length === 0) {
      setInboxLoading(true);
      fetch(`${API}/api/agents/${agent.codename}/inbox`)
        .then(r => r.ok ? r.json() : { messages: [] })
        .then(d => {
          setInbox(d.messages ?? []);
          setInboxUnread((d.messages ?? []).filter((m: InboxMessage) => m.status === "sent").length);
        })
        .catch(() => {})
        .finally(() => setInboxLoading(false));
    }
    if (tab === "schedule" && schedules.length === 0) {
      setSchedLoading(true);
      fetch(`${API}/api/agents/${agent.codename}/schedules`)
        .then(r => r.ok ? r.json() : { schedules: [] })
        .then(d => setSchedules(d.schedules ?? []))
        .catch(() => {})
        .finally(() => setSchedLoading(false));
    }
    if (tab === "goals") {
      setGoalsLoading(true);
      fetch(`${API}/api/agents/${agent.codename}/goals?status=all`)
        .then(r => r.ok ? r.json() : { goals: [] })
        .then(d => setGoals(d.goals ?? []))
        .catch(() => {})
        .finally(() => setGoalsLoading(false));
    }
  }, [tab, agent.codename]); // eslint-disable-line react-hooks/exhaustive-deps

  async function markRead(msgId: string) {
    await fetch(`${API}/api/agents/${agent.codename}/inbox/${msgId}/read`, { method: "POST" });
    setInbox(msgs => msgs.map(m => m.id === msgId ? { ...m, status: "read" } : m));
    setInboxUnread(n => Math.max(0, n - 1));
  }

  async function deleteSchedule(jobId: string) {
    const res = await fetch(`${API}/api/agents/${agent.codename}/schedules/${jobId}`, { method: "DELETE" });
    if (res.ok) setSchedules(s => s.filter(j => j.id !== jobId));
  }

  function field<K extends keyof Agent>(key: K): Agent[K] {
    return ((patch as Partial<Agent>)[key] !== undefined ? (patch as Partial<Agent>)[key] : agent[key]) as Agent[K];
  }
  function set<K extends keyof Agent>(key: K, val: Agent[K]) { setPatch(p => ({ ...p, [key]:val })); setEditing(true); }

  async function save() {
    if (!Object.keys(patch).length) return;
    setSaving(true);
    const res = await fetch(`${API}/api/agents/${agent.agent_id}`, {
      method:"PATCH", headers:{"Content-Type":"application/json"}, body:JSON.stringify(patch),
    });
    setSaving(false);
    if (res.ok) { setAgent(a => ({ ...a, ...patch })); setPatch({}); setEditing(false); onRefresh(); }
  }

  async function speak() { setSpeaking(true); await playAgentVoice(agent.agent_id, previewText||undefined); setSpeaking(false); }

  const successRate = agent.tasks_completed
    ? Math.round((agent.tasks_completed / (agent.tasks_completed + agent.tasks_failed)) * 100) : 100;
  const healthColor = agent.health_score>=90?"#22c55e":agent.health_score>=75?"#84cc16":agent.health_score>=60?"#f59e0b":"#ef4444";
  const prosody = field("voice_prosody") as Record<string,string>;
  const pitchVal = parseInt((prosody?.pitch||"0").replace(/[^-\d]/g,"")||"0");
  const rateVal  = parseInt((prosody?.rate ||"0").replace(/[^-\d]/g,"")||"0");

  return (
    <>
      <div style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.7)", zIndex:900, display:"flex", alignItems:"center", justifyContent:"center" }} onClick={onClose}>
        <div style={{ background:"var(--color-surface)", border:"var(--border-hi)", borderRadius:"var(--r-lg)", width:580, maxHeight:"88vh", display:"flex", flexDirection:"column", overflow:"hidden" }} onClick={e => e.stopPropagation()}>

          {/* Header */}
          <div style={{ padding:"var(--sp-4)", borderBottom:"var(--border)", display:"flex", gap:"var(--sp-4)", alignItems:"flex-start" }}>
            <div style={{ position:"relative", flexShrink:0 }}>
              <AgentAvatar agent={agent} size={64}/>
              <button onClick={() => setShowAvatar(true)} style={{ position:"absolute", bottom:-2, right:-2, width:20, height:20, borderRadius:"50%", background:"var(--color-accent)", border:"2px solid var(--color-surface)", cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center", color:"#fff" }}><Pencil size={9}/></button>
            </div>
            <div style={{ flex:1, minWidth:0 }}>
              <div style={{ display:"flex", alignItems:"center", gap:"var(--sp-2)", marginBottom:4, flexWrap:"wrap" }}>
                <span className="sj-label" style={{ fontSize:15 }}>{agent.name}</span>
                <span style={{ fontSize:9, padding:"1px 5px", borderRadius:3, background:"var(--color-surface-raised)", border:"var(--border)", color:"var(--color-text-muted)", fontFamily:"monospace" }}>{agent.agent_id}</span>
                <span style={{ fontSize:9, padding:"1px 5px", borderRadius:3, background:`color-mix(in srgb, ${agent.badge_color} 15%, transparent)`, color:agent.badge_color }}>L{agent.level}</span>
                <span style={{ fontSize:9, padding:"1px 6px", borderRadius:3, display:"flex", alignItems:"center", gap:3, background:`color-mix(in srgb, ${statusColor(agent.status)} 12%, transparent)`, color:statusColor(agent.status) }}>
                  <span style={{ width:5, height:5, borderRadius:"50%", background:statusColor(agent.status) }}/>{agent.status}
                </span>
              </div>
              <p style={{ fontSize:11, color:"var(--color-text-secondary)", margin:"0 0 4px" }}>{agent.title}</p>
              <div style={{ display:"flex", gap:"var(--sp-2)", alignItems:"center", flexWrap:"wrap" }}>
                <span className="sj-badge" style={{ fontSize:9, background:`color-mix(in srgb, ${agent.badge_color} 12%, transparent)`, color:agent.badge_color }}>{agent.department}</span>
                <span className="sj-micro" style={{ color:"var(--color-text-muted)" }}>{modelInfo(agent.model).label}</span>
              </div>
            </div>
            <button onClick={onClose} style={{ background:"none", border:"none", cursor:"pointer", color:"var(--color-text-muted)", flexShrink:0 }}><X size={14}/></button>
          </div>

          {/* Tabs */}
          <div style={{ display:"flex", borderBottom:"var(--border)", flexShrink:0, overflowX:"auto" }}>
            {(["overview","config","voice","lifecycle","inbox","schedule","goals"] as const).map(t => (
              <button key={t} onClick={() => setTab(t)} style={{
                background:"none", border:"none", flexShrink:0,
                borderBottom: tab===t ? "2px solid var(--color-accent)" : "2px solid transparent",
                padding:"var(--sp-2) var(--sp-3)", cursor:"pointer", fontSize:11, textTransform:"capitalize",
                color: tab===t ? "var(--color-text-primary)" : "var(--color-text-muted)",
                display:"flex", alignItems:"center", gap:4,
              }}>
                {t === "inbox" && <Mail size={10}/>}
                {t === "schedule" && <CalendarClock size={10}/>}
                {t === "goals" && <Target size={10}/>}
                {t}
                {t === "inbox" && inboxUnread > 0 && (
                  <span style={{ fontSize:9, padding:"0 4px", borderRadius:99, background:"#ef4444", color:"#fff", lineHeight:"14px" }}>{inboxUnread}</span>
                )}
                {t === "schedule" && schedules.length > 0 && (
                  <span style={{ fontSize:9, padding:"0 4px", borderRadius:99, background:"var(--color-accent)", color:"#fff", lineHeight:"14px" }}>{schedules.length}</span>
                )}
              </button>
            ))}
          </div>

          {/* Content */}
          <div style={{ flex:1, overflowY:"auto", padding:"var(--sp-4)" }}>

            {tab==="overview" && (
              <div style={{ display:"flex", flexDirection:"column", gap:"var(--sp-4)" }}>
                <p style={{ fontSize:12, color:"var(--color-text-secondary)", lineHeight:1.7, margin:0 }}>{agent.description}</p>

                {agent.status==="standby" && (
                  <div style={{ padding:"var(--sp-3)", borderRadius:"var(--r-md)", background:"color-mix(in srgb, #60a5fa 8%, transparent)", border:"1px solid color-mix(in srgb, #60a5fa 20%, transparent)" }}>
                    <p className="sj-micro" style={{ color:"#60a5fa", margin:0, lineHeight:1.6 }}>
                      Planned agent — not yet implemented. System prompt and configuration are ready. Will be activated in a future phase.
                    </p>
                  </div>
                )}

                <div style={{ background:"var(--color-surface-raised)", borderRadius:"var(--r-md)", padding:"var(--sp-3)", border:"var(--border)" }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"var(--sp-2)" }}>
                    <span className="sj-label" style={{ fontSize:11 }}>Health Score</span>
                    <span style={{ fontSize:16, fontWeight:700, color:healthColor }}>{agent.health_score.toFixed(0)}</span>
                  </div>
                  <div style={{ height:4, background:"var(--color-border)", borderRadius:99, overflow:"hidden", marginBottom:"var(--sp-3)" }}>
                    <div style={{ width:`${agent.health_score}%`, height:"100%", background:healthColor, borderRadius:99, transition:"width 0.4s ease" }}/>
                  </div>
                  <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:"var(--sp-2)" }}>
                    {[{l:"Completed",v:agent.tasks_completed},{l:"Failed",v:agent.tasks_failed},{l:"Success %",v:`${successRate}%`}].map(({l,v}) => (
                      <div key={l}><div style={{ fontSize:14, fontWeight:600, color:"var(--color-text-primary)" }}>{v}</div><div className="sj-micro" style={{ color:"var(--color-text-muted)" }}>{l}</div></div>
                    ))}
                  </div>
                </div>

                {agent.capabilities?.length>0 && (
                  <div>
                    <p className="sj-micro" style={{ color:"var(--color-text-muted)", marginBottom:"var(--sp-2)" }}>CAPABILITIES</p>
                    <div style={{ display:"flex", flexWrap:"wrap", gap:"var(--sp-1)" }}>
                      {agent.capabilities.map(c => <span key={c} style={{ fontSize:9, padding:"2px 7px", borderRadius:99, background:"color-mix(in srgb, var(--color-accent) 8%, transparent)", border:"1px solid color-mix(in srgb, var(--color-accent) 20%, transparent)", color:"var(--color-text-secondary)" }}>{c.replace(/_/g," ")}</span>)}
                    </div>
                  </div>
                )}

                {agent.tools_enabled?.length>0 && (
                  <div>
                    <p className="sj-micro" style={{ color:"var(--color-text-muted)", marginBottom:"var(--sp-2)" }}>TOOLS</p>
                    <div style={{ display:"flex", flexWrap:"wrap", gap:"var(--sp-1)" }}>
                      {agent.tools_enabled.map(t => <span key={t} style={{ fontSize:9, padding:"2px 7px", borderRadius:99, background:"var(--color-surface-raised)", border:"var(--border)", color:"var(--color-text-muted)" }}>{t}</span>)}
                    </div>
                  </div>
                )}

                {agent.direct_reports && agent.direct_reports.length>0 && (
                  <div>
                    <p className="sj-micro" style={{ color:"var(--color-text-muted)", marginBottom:"var(--sp-2)" }}>DIRECT REPORTS ({agent.direct_reports.length})</p>
                    <div style={{ display:"flex", flexDirection:"column", gap:"var(--sp-1)" }}>
                      {agent.direct_reports.map(r => (
                        <div key={r.agent_id} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"4px 8px", borderRadius:"var(--r-xs)", background:"var(--color-surface-raised)", border:"var(--border)" }}>
                          <span style={{ fontSize:11 }}>{r.name}</span>
                          <div style={{ display:"flex", alignItems:"center", gap:"var(--sp-2)" }}>
                            <span className="sj-micro" style={{ color:"var(--color-text-muted)" }}>{r.title.split("—")[0].trim()}</span>
                            <span style={{ width:6, height:6, borderRadius:"50%", background:statusColor(r.status), flexShrink:0 }}/>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {tab==="config" && (
              <div style={{ display:"flex", flexDirection:"column", gap:"var(--sp-3)" }}>
                <div>
                  <label className="sj-micro" style={{ color:"var(--color-text-muted)", display:"block", marginBottom:4 }}>Status</label>
                  <select className="sj-input" value={field("status") as string} onChange={e => set("status",e.target.value)} style={{ fontSize:11 }}>
                    {["active","standby","suspended","deprecated","retired"].map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>

                <ModelPicker value={field("model") as string} onChange={v => set("model",v)}/>

                <div>
                  <label className="sj-micro" style={{ color:"var(--color-text-muted)", display:"block", marginBottom:4 }}>
                    Temperature: <span style={{ color:"var(--color-text-primary)" }}>{(field("temperature") as number).toFixed(2)}</span>
                  </label>
                  <input type="range" min={0} max={1} step={0.05} value={field("temperature") as number}
                    onChange={e => set("temperature",parseFloat(e.target.value))} style={{ width:"100%" }}/>
                </div>

                <div>
                  <label className="sj-micro" style={{ color:"var(--color-text-muted)", display:"block", marginBottom:4 }}>Max Tokens</label>
                  <input type="number" className="sj-input" value={field("max_tokens") as number}
                    onChange={e => set("max_tokens",parseInt(e.target.value))} style={{ fontSize:11 }}/>
                </div>

                <div>
                  <label className="sj-micro" style={{ color:"var(--color-text-muted)", display:"block", marginBottom:4 }}>Trust Tier</label>
                  <select className="sj-input" value={field("trust_tier") as string} onChange={e => set("trust_tier",e.target.value)} style={{ fontSize:11 }}>
                    {["citizen","resident","trusted","executive"].map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>

                <div>
                  <label className="sj-micro" style={{ color:"var(--color-text-muted)", display:"block", marginBottom:4 }}>Built-in System Prompt</label>
                  <textarea className="sj-input" value={(field("system_prompt") as string)??""} onChange={e => set("system_prompt",e.target.value)}
                    rows={6} style={{ fontSize:10, resize:"vertical", fontFamily:"monospace", lineHeight:1.6 }}/>
                  <p className="sj-micro" style={{ color:"var(--color-text-muted)", marginTop:3 }}>Default prompt. Set Override below to take precedence without losing the original.</p>
                </div>

                <div>
                  <label className="sj-micro" style={{ color:"var(--color-text-muted)", display:"block", marginBottom:4 }}>System Prompt Override (optional — takes precedence)</label>
                  <textarea className="sj-input" value={(field("system_prompt_override") as string|null)??""} onChange={e => set("system_prompt_override",(e.target.value||null) as unknown as string)}
                    rows={5} style={{ fontSize:10, resize:"vertical", fontFamily:"monospace", lineHeight:1.6 }} placeholder="Leave empty to use the built-in prompt above"/>
                </div>
              </div>
            )}

            {tab==="voice" && (
              <div style={{ display:"flex", flexDirection:"column", gap:"var(--sp-3)" }}>
                <div>
                  <label className="sj-micro" style={{ color:"var(--color-text-muted)", display:"block", marginBottom:4 }}>Voice</label>
                  <select className="sj-input" value={field("voice_id") as string} onChange={e => set("voice_id",e.target.value)} style={{ fontSize:11 }}>
                    {VOICES.reduce<string[]>((g,v) => g.includes(v.group)?g:[...g,v.group],[]).map(group => (
                      <optgroup key={group} label={group}>
                        {VOICES.filter(v => v.group===group).map(v => <option key={v.id} value={v.id}>{v.label}</option>)}
                      </optgroup>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="sj-micro" style={{ color:"var(--color-text-muted)", display:"block", marginBottom:4 }}>
                    Pitch: <span style={{ color:"var(--color-text-primary)" }}>{pitchVal>=0?"+":""}{pitchVal}%</span>
                  </label>
                  <input type="range" min={-30} max={30} step={5} value={pitchVal}
                    onChange={e => { const v=parseInt(e.target.value); set("voice_prosody",{...prosody,pitch:`${v>=0?"+":""}${v}%`} as Agent["voice_prosody"]); }} style={{ width:"100%" }}/>
                </div>

                <div>
                  <label className="sj-micro" style={{ color:"var(--color-text-muted)", display:"block", marginBottom:4 }}>
                    Rate: <span style={{ color:"var(--color-text-primary)" }}>{rateVal>=0?"+":""}{rateVal}%</span>
                  </label>
                  <input type="range" min={-30} max={50} step={5} value={rateVal}
                    onChange={e => { const v=parseInt(e.target.value); set("voice_prosody",{...prosody,rate:`${v>=0?"+":""}${v}%`} as Agent["voice_prosody"]); }} style={{ width:"100%" }}/>
                </div>

                <div>
                  <label className="sj-micro" style={{ color:"var(--color-text-muted)", display:"block", marginBottom:4 }}>Preview text (blank = default greeting)</label>
                  <input className="sj-input" value={previewText} onChange={e => setPreviewText(e.target.value)} placeholder={`Leave blank for ${agent.name}'s greeting`} style={{ fontSize:11 }}/>
                </div>

                <button onClick={speak} disabled={speaking} style={{ display:"flex", alignItems:"center", justifyContent:"center", gap:"var(--sp-2)", background:"var(--color-surface-raised)", border:"var(--border)", borderRadius:"var(--r-xs)", padding:"8px 16px", cursor:"pointer", fontSize:12, color:"var(--color-text-primary)" }}>
                  {speaking ? <Loader2 size={12} className="spin"/> : <Volume2 size={12}/>}
                  {speaking ? "Speaking…" : `Ask ${agent.name} to speak`}
                </button>
              </div>
            )}

            {tab==="lifecycle" && (
              <div style={{ display:"flex", flexDirection:"column", gap:"var(--sp-3)" }}>
                {[
                  ["Agent ID", agent.agent_id], ["Codename", agent.codename], ["Version", agent.version],
                  ["Level", `L${agent.level}`], ["Department", agent.department], ["Trust Tier", agent.trust_tier],
                  ["Created", new Date(agent.created_at).toLocaleDateString()],
                  ["Last Updated", new Date(agent.updated_at).toLocaleDateString()],
                ].map(([label,value]) => (
                  <div key={label} style={{ display:"flex", justifyContent:"space-between", padding:"4px 0", borderBottom:"var(--border-lo)" }}>
                    <span className="sj-micro" style={{ color:"var(--color-text-muted)" }}>{label}</span>
                    <span className="sj-mono" style={{ fontSize:11, color:"var(--color-text-secondary)" }}>{value}</span>
                  </div>
                ))}

                {agent.status !== "retired" && (
                  <RetireButton agentId={agent.agent_id} agentName={agent.name} onRetired={() => { onClose(); onRefresh(); }}/>
                )}
              </div>
            )}

            {/* ── Phase 8A: Inbox tab ───────────────────────────────────────── */}
            {tab==="inbox" && (
              <div style={{ display:"flex", flexDirection:"column", gap:"var(--sp-2)" }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"var(--sp-1)" }}>
                  <span className="sj-micro" style={{ color:"var(--color-text-muted)" }}>MESSAGES FROM OTHER AGENTS</span>
                  {inboxUnread > 0 && (
                    <span style={{ fontSize:10, color:"var(--color-text-muted)" }}>{inboxUnread} unread</span>
                  )}
                </div>

                {inboxLoading && (
                  <div style={{ display:"flex", justifyContent:"center", padding:"var(--sp-6)" }}>
                    <Loader2 size={18} className="spin" style={{ color:"var(--color-text-muted)" }}/>
                  </div>
                )}

                {!inboxLoading && inbox.length === 0 && (
                  <div style={{ textAlign:"center", padding:"var(--sp-6)", color:"var(--color-text-muted)", fontSize:12 }}>
                    <Mail size={28} style={{ margin:"0 auto var(--sp-2)", opacity:0.3 }}/>
                    <div>No messages yet</div>
                    <div style={{ fontSize:10, marginTop:4 }}>Other agents can send messages via send_agent_message tool</div>
                  </div>
                )}

                {!inboxLoading && inbox.map(msg => (
                  <div key={msg.id} style={{
                    padding:"var(--sp-3)", borderRadius:"var(--r-md)",
                    border:`1px solid ${msg.status === "sent" ? "color-mix(in srgb, var(--color-accent) 30%, transparent)" : "var(--color-border)"}`,
                    background: msg.status === "sent" ? "color-mix(in srgb, var(--color-accent) 5%, transparent)" : "var(--color-surface-raised)",
                  }}>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:"var(--sp-2)", marginBottom:6 }}>
                      <div>
                        <span style={{ fontSize:12, fontWeight:600, color:"var(--color-text-primary)" }}>{msg.subject}</span>
                        <div style={{ fontSize:10, color:"var(--color-text-muted)", marginTop:1 }}>
                          From: <span style={{ color:"var(--color-accent)" }}>{msg.from}</span>
                          {msg.received_at && ` · ${new Date(msg.received_at).toLocaleString()}`}
                        </div>
                      </div>
                      {msg.status === "sent" && (
                        <button onClick={() => markRead(msg.id)} title="Mark as read"
                          style={{ background:"none", border:"none", cursor:"pointer", color:"var(--color-text-muted)", padding:2, flexShrink:0 }}>
                          <CheckCheck size={13}/>
                        </button>
                      )}
                    </div>
                    <p style={{ fontSize:11, color:"var(--color-text-secondary)", margin:0, lineHeight:1.6, whiteSpace:"pre-wrap" }}>
                      {msg.message}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {/* ── Phase 8C: Schedule tab ────────────────────────────────────── */}
            {tab==="goals" && (
              <div style={{ display:"flex", flexDirection:"column", gap:"var(--sp-2)" }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"var(--sp-1)" }}>
                  <span className="sj-micro" style={{ color:"var(--color-text-muted)" }}>PERSISTENT GOALS</span>
                  <span style={{ fontSize:10, color:"var(--color-text-muted)" }}>Checked daily · set via set_goal tool</span>
                </div>

                {goalsLoading && (
                  <div style={{ display:"flex", justifyContent:"center", padding:"var(--sp-6)" }}>
                    <Loader2 size={18} className="spin" style={{ color:"var(--color-text-muted)" }}/>
                  </div>
                )}

                {!goalsLoading && goals.length === 0 && (
                  <div style={{ textAlign:"center", padding:"var(--sp-6)", color:"var(--color-text-muted)", fontSize:12 }}>
                    <Target size={28} style={{ margin:"0 auto var(--sp-2)", opacity:0.3 }}/>
                    <div>No goals set</div>
                    <div style={{ fontSize:10, marginTop:4 }}>This agent can register long-horizon goals using the set_goal tool</div>
                  </div>
                )}

                {!goalsLoading && goals.map(g => (
                  <div key={g.id} style={{
                    padding:"var(--sp-3)", borderRadius:"var(--r-md)",
                    border:`1px solid ${g.status==="completed"?"#166534":g.status==="cancelled"?"#374151":"var(--color-border)"}`,
                    background:`color-mix(in srgb, ${g.status==="completed"?"#22c55e":g.status==="cancelled"?"#6b7280":"var(--color-accent)"} 5%, var(--color-surface-raised))`,
                    display:"flex", flexDirection:"column", gap:6,
                  }}>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
                      <span style={{ fontSize:12, fontWeight:600, color:"var(--color-text-primary)", flex:1 }}>{g.goal}</span>
                      <span style={{ fontSize:9, padding:"1px 6px", borderRadius:99, marginLeft:8, flexShrink:0,
                        background: g.status==="active"?"color-mix(in srgb,#60a5fa 15%,transparent)":g.status==="completed"?"color-mix(in srgb,#22c55e 15%,transparent)":"color-mix(in srgb,#6b7280 15%,transparent)",
                        color: g.status==="active"?"#60a5fa":g.status==="completed"?"#22c55e":"#6b7280",
                      }}>{g.status}</span>
                    </div>
                    <p style={{ fontSize:11, color:"var(--color-text-secondary)", margin:0, fontStyle:"italic" }}>
                      Condition: {g.condition}
                    </p>
                    <span style={{ fontSize:9, color:"var(--color-text-muted)" }}>
                      Checked {g.trigger_count}× · Created {new Date(g.created_at).toLocaleDateString()}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {tab==="schedule" && (
              <div style={{ display:"flex", flexDirection:"column", gap:"var(--sp-2)" }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"var(--sp-1)" }}>
                  <span className="sj-micro" style={{ color:"var(--color-text-muted)" }}>AUTONOMOUS CRON SCHEDULES</span>
                  <span style={{ fontSize:10, color:"var(--color-text-muted)" }}>Created via schedule_task tool</span>
                </div>

                {schedLoading && (
                  <div style={{ display:"flex", justifyContent:"center", padding:"var(--sp-6)" }}>
                    <Loader2 size={18} className="spin" style={{ color:"var(--color-text-muted)" }}/>
                  </div>
                )}

                {!schedLoading && schedules.length === 0 && (
                  <div style={{ textAlign:"center", padding:"var(--sp-6)", color:"var(--color-text-muted)", fontSize:12 }}>
                    <CalendarClock size={28} style={{ margin:"0 auto var(--sp-2)", opacity:0.3 }}/>
                    <div>No scheduled tasks</div>
                    <div style={{ fontSize:10, marginTop:4 }}>This agent can register tasks using the schedule_task tool</div>
                  </div>
                )}

                {!schedLoading && schedules.map(job => (
                  <div key={job.id} style={{
                    padding:"var(--sp-3)", borderRadius:"var(--r-md)",
                    border:"var(--border)", background:"var(--color-surface-raised)",
                    display:"flex", flexDirection:"column", gap:6,
                  }}>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
                      <div>
                        <span style={{ fontSize:12, fontWeight:600, color:"var(--color-text-primary)" }}>{job.name}</span>
                        <div style={{ fontSize:10, color:"var(--color-text-muted)", marginTop:2, display:"flex", gap:8, flexWrap:"wrap" }}>
                          <span style={{ display:"flex", alignItems:"center", gap:3 }}>
                            <Clock size={9}/>{job.schedule}
                          </span>
                          <span style={{ color:"var(--color-text-secondary)" }}>{job.worker_type}</span>
                          <span style={{
                            padding:"0 5px", borderRadius:99, fontSize:9, lineHeight:"14px",
                            background: job.enabled ? "color-mix(in srgb, #22c55e 12%, transparent)" : "color-mix(in srgb, #9ca3af 12%, transparent)",
                            color: job.enabled ? "#22c55e" : "#9ca3af",
                          }}>{job.enabled ? "enabled" : "disabled"}</span>
                        </div>
                      </div>
                      <button onClick={() => deleteSchedule(job.id)} title="Delete schedule"
                        style={{ background:"none", border:"none", cursor:"pointer", color:"var(--color-text-muted)", padding:2, flexShrink:0 }}>
                        <Trash2 size={13}/>
                      </button>
                    </div>
                    {job.description && (
                      <p style={{ fontSize:11, color:"var(--color-text-muted)", margin:0, fontStyle:"italic" }}>{job.description}</p>
                    )}
                    {job.created_at && (
                      <span style={{ fontSize:9, color:"var(--color-text-muted)" }}>
                        Created {new Date(job.created_at).toLocaleDateString()}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {editing && (
            <div style={{ borderTop:"var(--border)", padding:"var(--sp-3) var(--sp-4)", display:"flex", gap:"var(--sp-2)", justifyContent:"flex-end", flexShrink:0 }}>
              <button onClick={() => { setPatch({}); setEditing(false); }} style={{ background:"none", border:"var(--border)", borderRadius:"var(--r-xs)", padding:"6px 14px", cursor:"pointer", fontSize:11, color:"var(--color-text-muted)" }}>Discard</button>
              <button onClick={save} disabled={saving} style={{ background:"var(--color-accent)", border:"none", borderRadius:"var(--r-xs)", padding:"6px 14px", cursor:"pointer", fontSize:11, color:"#fff", display:"flex", alignItems:"center", gap:"var(--sp-1)" }}>
                {saving ? <Loader2 size={11} className="spin"/> : <Save size={11}/>} {saving ? "Saving…" : "Save changes"}
              </button>
            </div>
          )}
        </div>
      </div>

      {showAvatar && <AvatarEditor agent={agent} onSave={p => setAgent(a => ({...a,...p}))} onClose={() => setShowAvatar(false)}/>}
    </>
  );
}

// ── Model distribution bar ────────────────────────────────────────────────────

function ModelDistribution({ agents }: { agents: Agent[] }) {
  const dist = agents.reduce<Record<string,number>>((m,a) => {
    const label = modelInfo(a.model).label.split(" ").slice(0,3).join(" ");
    m[label] = (m[label]||0)+1;
    return m;
  }, {});
  const total = agents.length || 1;
  const entries = Object.entries(dist).sort((a,b) => b[1]-a[1]);

  if (!entries.length) return null;
  return (
    <div style={{ background:"var(--color-surface-raised)", border:"var(--border)", borderRadius:"var(--r-md)", padding:"var(--sp-3)", display:"flex", flexDirection:"column", gap:"var(--sp-2)" }}>
      <span className="sj-micro" style={{ color:"var(--color-text-muted)" }}>MODEL DISTRIBUTION (active agents)</span>
      {entries.map(([label, count]) => (
        <div key={label} style={{ display:"grid", gridTemplateColumns:"130px 1fr 26px", gap:"var(--sp-2)", alignItems:"center" }}>
          <span className="sj-micro" style={{ color:"var(--color-text-secondary)", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{label}</span>
          <div style={{ height:4, background:"var(--color-border)", borderRadius:99, overflow:"hidden" }}>
            <div style={{ width:`${(count/total)*100}%`, height:"100%", background:"var(--color-accent)", borderRadius:99 }}/>
          </div>
          <span className="sj-mono" style={{ fontSize:9, color:"var(--color-text-muted)", textAlign:"right" }}>{count}</span>
        </div>
      ))}
    </div>
  );
}

// ── Agent card ────────────────────────────────────────────────────────────────

function AgentCard({ agent, deptColor, onClick, planned }: { agent:Agent; deptColor?:string; onClick:()=>void; planned?:boolean }) {
  const color = deptColor||"#94a3b8";
  return (
    <div onClick={onClick} style={{
      background:"var(--color-surface-raised)", border:"var(--border)",
      borderLeft:`3px solid ${planned ? "color-mix(in srgb, #60a5fa 40%, transparent)" : agent.badge_color}`,
      borderRadius:"var(--r-md)", padding:"var(--sp-3)", cursor:"pointer",
      opacity: planned ? 0.72 : 1, transition:"var(--ease-soft)",
      display:"flex", flexDirection:"column", gap:"var(--sp-2)",
    }}>
      <div style={{ display:"flex", alignItems:"center", gap:"var(--sp-2)" }}>
        <AgentAvatar agent={agent} size={38}/>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ display:"flex", alignItems:"center", gap:"var(--sp-1)", flexWrap:"wrap" }}>
            <span className="sj-label" style={{ fontSize:12, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{agent.name}</span>
            <span style={{ fontSize:8, padding:"0 4px", borderRadius:2, flexShrink:0, fontFamily:"monospace", letterSpacing:"0.02em", background:`color-mix(in srgb, ${agent.badge_color} 12%, transparent)`, color:agent.badge_color, border:`1px solid color-mix(in srgb, ${agent.badge_color} 25%, transparent)` }}>[{agent.title.split("—")[0].trim()}]</span>
          </div>
          <span className="sj-micro" style={{ color:"var(--color-text-muted)", display:"block", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>L{agent.level} · {agent.department.replace(/_/g, " ")}</span>
        </div>
        {planned
          ? <span style={{ fontSize:7, padding:"1px 5px", borderRadius:3, background:"color-mix(in srgb, #60a5fa 12%, transparent)", color:"#60a5fa", flexShrink:0 }}>PLANNED</span>
          : <span style={{ width:8, height:8, borderRadius:"50%", flexShrink:0, background:statusColor(agent.status), boxShadow:agent.status==="active"?`0 0 6px ${statusColor(agent.status)}`:"none" }}/>
        }
      </div>
      <span style={{ fontSize:9, padding:"1px 6px", borderRadius:99, width:"fit-content", background:`color-mix(in srgb, ${color} 12%, transparent)`, color }}>{agent.department}</span>
      {!planned && (
        <div>
          <div style={{ display:"flex", justifyContent:"space-between", marginBottom:2 }}>
            <span className="sj-micro" style={{ color:"var(--color-text-muted)" }}>Health</span>
            <span className="sj-mono" style={{ fontSize:9, color:agent.health_score>=75?"#22c55e":"#f59e0b" }}>{agent.health_score.toFixed(0)}</span>
          </div>
          <div style={{ height:3, background:"var(--color-border)", borderRadius:99, overflow:"hidden" }}>
            <div style={{ width:`${agent.health_score}%`, height:"100%", borderRadius:99, background:agent.health_score>=90?"#22c55e":agent.health_score>=75?"#84cc16":agent.health_score>=60?"#f59e0b":"#ef4444" }}/>
          </div>
          <div style={{ display:"flex", justifyContent:"space-between", marginTop:4 }}>
            <span className="sj-micro" style={{ color:"var(--color-text-muted)" }}>
              {agent.tasks_completed > 0
                ? `${agent.tasks_completed} task${agent.tasks_completed !== 1 ? "s" : ""} · ${Math.round(agent.tasks_completed / Math.max(1, agent.tasks_completed + agent.tasks_failed) * 100)}% ok`
                : "No tasks yet"}
            </span>
            {agent.last_active && (
              <span className="sj-mono" style={{ fontSize:8, color:"var(--color-text-muted)" }}>
                {(() => { const s = Math.floor((Date.now() - new Date(agent.last_active).getTime()) / 1000); return s < 3600 ? `${Math.floor(s/60)}m ago` : s < 86400 ? `${Math.floor(s/3600)}h ago` : `${Math.floor(s/86400)}d ago`; })()}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Agents Tab ────────────────────────────────────────────────────────────────

function AgentsTab({ agents, departments, onSelectAgent }: { agents:Agent[]; departments:Department[]; onSelectAgent:(a:Agent)=>void }) {
  const [search, setSearch]         = useState("");
  const [filterDept, setFilterDept] = useState("All");
  const [filterStatus, setFilterStatus] = useState("All");
  const [showPlanned, setShowPlanned] = useState(true);

  const filtered = agents.filter(a => {
    const q = search.toLowerCase();
    const matchQ = !q || a.name.toLowerCase().includes(q) || a.codename.includes(q) || a.title.toLowerCase().includes(q) || a.description.toLowerCase().includes(q);
    return matchQ
      && (filterDept==="All"   || a.department===filterDept)
      && (filterStatus==="All" || a.status===filterStatus)
      && (showPlanned || a.status!=="standby");
  });

  const deptNames  = [...new Set(agents.map(a => a.department))].sort();
  const deptColors = Object.fromEntries(departments.map(d => [d.id, d.badge_color]));
  const activeCount  = agents.filter(a => a.status==="active").length;
  const standbyCount = agents.filter(a => a.status==="standby").length;
  const deployed = filtered.filter(a => a.status!=="standby");
  const planned  = filtered.filter(a => a.status==="standby");

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"var(--sp-3)", height:"100%" }}>
      <ModelDistribution agents={agents.filter(a => a.status==="active")}/>

      <div style={{ display:"flex", gap:"var(--sp-2)", flexWrap:"wrap", flexShrink:0 }}>
        <div style={{ flex:1, minWidth:160, position:"relative" }}>
          <Search size={11} style={{ position:"absolute", left:8, top:"50%", transform:"translateY(-50%)", color:"var(--color-text-muted)", pointerEvents:"none" }}/>
          <input className="sj-input" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search agents…" style={{ paddingLeft:26, fontSize:11 }}/>
        </div>
        <select className="sj-input" value={filterDept} onChange={e => setFilterDept(e.target.value)} style={{ fontSize:11, width:140 }}>
          <option value="All">All depts</option>
          {deptNames.map(d => <option key={d} value={d}>{d}</option>)}
        </select>
        <select className="sj-input" value={filterStatus} onChange={e => setFilterStatus(e.target.value)} style={{ fontSize:11, width:110 }}>
          <option value="All">All statuses</option>
          {["active","standby","suspended","retired"].map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <button onClick={() => setShowPlanned(p => !p)} style={{
          background: showPlanned ? "color-mix(in srgb, #60a5fa 12%, transparent)" : "none",
          border: showPlanned ? "1px solid color-mix(in srgb, #60a5fa 30%, transparent)" : "var(--border)",
          borderRadius:"var(--r-xs)", padding:"4px 10px", cursor:"pointer", fontSize:11,
          color: showPlanned ? "#60a5fa" : "var(--color-text-muted)",
        }}>Planned ({standbyCount})</button>
      </div>

      <div style={{ flex:1, overflowY:"auto" }}>
        {deployed.length>0 && (
          <>
            <p className="sj-micro" style={{ color:"var(--color-text-muted)", marginBottom:"var(--sp-2)" }}>DEPLOYED — {activeCount} active</p>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(225px,1fr))", gap:"var(--sp-2)", marginBottom:"var(--sp-4)" }}>
              {deployed.map(a => <AgentCard key={a.agent_id} agent={a} deptColor={deptColors[a.department]} onClick={() => onSelectAgent(a)}/>)}
            </div>
          </>
        )}
        {showPlanned && planned.length>0 && (
          <>
            <p className="sj-micro" style={{ color:"var(--color-text-muted)", marginBottom:"var(--sp-2)" }}>PLANNED — {standbyCount} agents ready to activate</p>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(225px,1fr))", gap:"var(--sp-2)" }}>
              {planned.map(a => <AgentCard key={a.agent_id} agent={a} deptColor={deptColors[a.department]} onClick={() => onSelectAgent(a)} planned/>)}
            </div>
          </>
        )}
        {filtered.length===0 && <p className="sj-micro" style={{ color:"var(--color-text-muted)", textAlign:"center", marginTop:"var(--sp-6)" }}>No agents match your filters.</p>}
      </div>
    </div>
  );
}

// ── Departments Tab ───────────────────────────────────────────────────────────

function DepartmentsTab({ departments, agents, onToggleDept, onCreateDept }: { departments:Department[]; agents:Agent[]; onToggleDept:(id:string,enabled:boolean)=>void; onCreateDept:()=>void }) {
  const agentMap = agents.reduce<Record<string,Agent>>((m,a) => ({...m,[a.agent_id]:a}), {});
  const byDept   = agents.reduce<Record<string,Agent[]>>((m,a) => { (m[a.department]=m[a.department]||[]).push(a); return m; }, {});

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"var(--sp-3)", overflowY:"auto" }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"flex-end" }}>
        <button className="sj-btn sj-btn-primary" style={{ padding:"4px var(--sp-2)", fontSize:11 }} onClick={onCreateDept}>
          <Plus size={11}/> New Department
        </button>
      </div>
      <div style={{ padding:"var(--sp-3)", borderRadius:"var(--r-md)", background:"color-mix(in srgb, #22c55e 6%, transparent)", border:"1px solid color-mix(in srgb, #22c55e 18%, transparent)" }}>
        <p className="sj-micro" style={{ color:"#22c55e", margin:0, lineHeight:1.6 }}>
          <strong>Groq Free Tier</strong> — no dollar cost. Limits are RPM/TPM per model per API key. With 3 keys you get 3× the rate limits via automatic round-robin rotation. The Audit agent (AGT-0025) will monitor usage when activated.
        </p>
      </div>

      {departments.map(dept => {
        const head = dept.head_agent ? agentMap[dept.head_agent] : null;
        const deptAgents = byDept[dept.id] || [];
        const activeCount  = deptAgents.filter(a => a.status==="active").length;
        const standbyCount = deptAgents.filter(a => a.status==="standby").length;
        return (
          <div key={dept.id} style={{
            background:"var(--color-surface-raised)", border:"var(--border)",
            borderLeft:`3px solid ${dept.enabled ? dept.badge_color : "#6b7280"}`,
            borderRadius:"var(--r-md)", padding:"var(--sp-4)",
            opacity: dept.enabled ? 1 : 0.65, transition:"var(--ease-soft)",
          }}>
            <div style={{ display:"flex", alignItems:"flex-start", gap:"var(--sp-3)" }}>
              {head
                ? <AgentAvatar agent={head} size={44}/>
                : <div style={{ width:44, height:44, borderRadius:"50%", background:"var(--color-surface)", border:"var(--border)", display:"flex", alignItems:"center", justifyContent:"center", flexShrink:0 }}><Building2 size={18} style={{ color:dept.badge_color }}/></div>
              }
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ display:"flex", alignItems:"center", gap:"var(--sp-2)", marginBottom:4 }}>
                  <span className="sj-label" style={{ fontSize:13 }}>{dept.name}</span>
                  <span style={{ fontSize:9, padding:"1px 5px", borderRadius:3, background:dept.enabled?"color-mix(in srgb, #22c55e 12%, transparent)":"color-mix(in srgb, #6b7280 12%, transparent)", color:dept.enabled?"#22c55e":"#9ca3af" }}>
                    {dept.enabled ? "Online" : "Offline"}
                  </span>
                </div>
                <p className="sj-micro" style={{ color:"var(--color-text-muted)", margin:"0 0 var(--sp-1)", lineHeight:1.5 }}>{dept.description}</p>
                <div style={{ display:"flex", gap:"var(--sp-3)", flexWrap:"wrap" }}>
                  <span className="sj-micro" style={{ color:"var(--color-text-muted)" }}>{activeCount} active · {standbyCount} planned</span>
                  {head && <span className="sj-micro" style={{ color:"var(--color-text-muted)" }}>Head: {head.name}</span>}
                </div>
              </div>
              <div style={{ display:"flex", flexDirection:"column", alignItems:"flex-end", gap:"var(--sp-2)", flexShrink:0 }}>
                <Toggle on={dept.enabled} onToggle={() => onToggleDept(dept.id,!dept.enabled)} size="md"/>
                <span className="sj-micro" style={{ color:"var(--color-text-muted)" }}>Free Tier</span>
              </div>
            </div>

            {deptAgents.length>0 && (
              <div style={{ marginTop:"var(--sp-3)", display:"flex", gap:"var(--sp-1)", flexWrap:"wrap" }}>
                {deptAgents.map(a => (
                  <div key={a.agent_id} style={{ display:"flex", alignItems:"center", gap:4, fontSize:9, padding:"2px 6px", borderRadius:99, background:"var(--color-surface)", border:"var(--border)", color:"var(--color-text-secondary)", opacity:a.status==="standby"?0.6:1 }}>
                    <span style={{ width:5, height:5, borderRadius:"50%", background:statusColor(a.status), flexShrink:0 }}/>{a.name}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Autonomy Tab ──────────────────────────────────────────────────────────────

function AutonomyTab({ categories, onToggle }: { categories:AutonomyCategory[]; onToggle:(id:string,enabled:boolean)=>void }) {
  const groups: Record<string,AutonomyCategory[]> = { low:[], medium:[], high:[] };
  for (const c of categories) groups[c.risk_level]?.push(c);

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:"var(--sp-4)", overflowY:"auto" }}>
      <div style={{ padding:"var(--sp-3)", borderRadius:"var(--r-md)", background:"color-mix(in srgb, var(--color-accent) 6%, transparent)", border:"1px solid color-mix(in srgb, var(--color-accent) 18%, transparent)" }}>
        <div style={{ display:"flex", alignItems:"center", gap:"var(--sp-2)", marginBottom:"var(--sp-1)" }}>
          <Brain size={12} style={{ color:"var(--color-accent)" }}/>
          <span className="sj-label" style={{ fontSize:11 }}>Jazper Autonomy Mode</span>
        </div>
        <p className="sj-micro" style={{ color:"var(--color-text-muted)", lineHeight:1.6, margin:0 }}>
          Grant Jazper independent authority over specific decision categories. Start with Low risk. Every autonomous action is logged and reviewable. Each toggle is independent.
        </p>
      </div>

      {(["low","medium","high"] as const).map(risk => (
        <div key={risk}>
          <div style={{ display:"flex", alignItems:"center", gap:"var(--sp-2)", marginBottom:"var(--sp-2)" }}>
            <div style={{ width:8, height:8, borderRadius:"50%", background:riskColor(risk) }}/>
            <span className="sj-label" style={{ fontSize:11, textTransform:"capitalize" }}>{risk} risk</span>
            <span className="sj-badge" style={{ fontSize:9 }}>{groups[risk]?.length??0}</span>
          </div>
          <div style={{ display:"flex", flexDirection:"column", gap:"var(--sp-2)", marginBottom:"var(--sp-2)" }}>
            {groups[risk]?.map(cat => (
              <div key={cat.category_id} style={{ background:"var(--color-surface-raised)", border:"var(--border)", borderRadius:"var(--r-md)", padding:"var(--sp-3)", borderLeft:`3px solid ${cat.enabled ? riskColor(risk) : "var(--color-border)"}`, transition:"var(--ease-soft)" }}>
                <div style={{ display:"flex", alignItems:"flex-start", gap:"var(--sp-3)" }}>
                  <div style={{ flex:1 }}>
                    <div style={{ display:"flex", alignItems:"center", gap:"var(--sp-2)", marginBottom:4 }}>
                      <span className="sj-label" style={{ fontSize:12 }}>{cat.category}</span>
                      {cat.enabled && <span style={{ fontSize:8, padding:"1px 5px", borderRadius:3, background:"color-mix(in srgb, #22c55e 12%, transparent)", color:"#22c55e" }}>Active</span>}
                    </div>
                    <p className="sj-micro" style={{ color:"var(--color-text-muted)", lineHeight:1.5, margin:0 }}>{cat.description}</p>
                    {cat.use_count>0 && <span className="sj-micro" style={{ color:"var(--color-text-muted)", marginTop:"var(--sp-1)", display:"block" }}>Used {cat.use_count}×{cat.last_used?` · Last: ${new Date(cat.last_used).toLocaleDateString()}`:""}</span>}
                  </div>
                  <Toggle on={cat.enabled} onToggle={() => onToggle(cat.category_id,!cat.enabled)} size="md"/>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Main Panel ────────────────────────────────────────────────────────────────

export function AgentsPanel() {
  const [agents,      setAgents]      = useState<Agent[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [autonomy,    setAutonomy]    = useState<AutonomyCategory[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [activeTab,   setActiveTab]   = useState<"agents"|"departments"|"autonomy">("agents");
  const [selected,    setSelected]    = useState<Agent|null>(null);
  const [showCreate,     setShowCreate]     = useState(false);
  const [showCreateDept, setShowCreateDept] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [ar,dr,aut] = await Promise.all([
        fetch(`${API}/api/agents/`),
        fetch(`${API}/api/agents/departments/`),
        fetch(`${API}/api/agents/autonomy/`),
      ]);
      if (ar.ok)  setAgents((await ar.json()).agents ?? []);
      if (dr.ok)  setDepartments((await dr.json()).departments ?? []);
      if (aut.ok) setAutonomy((await aut.json()).autonomy ?? []);
    } catch { /* offline */ }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function openAgent(a: Agent) {
    try {
      const res = await fetch(`${API}/api/agents/${a.agent_id}`);
      setSelected(res.ok ? await res.json() : a);
    } catch { setSelected(a); }
  }

  async function toggleDept(id: string, enabled: boolean) {
    setDepartments(ds => ds.map(d => d.id===id ? {...d,enabled} : d));
    await fetch(`${API}/api/agents/departments/${id}`, { method:"PATCH", headers:{"Content-Type":"application/json"}, body:JSON.stringify({enabled}) });
  }

  async function toggleAutonomy(id: string, enabled: boolean) {
    setAutonomy(cats => cats.map(c => c.category_id===id ? {...c,enabled} : c));
    await fetch(`${API}/api/agents/autonomy/${id}`, { method:"PATCH", headers:{"Content-Type":"application/json"}, body:JSON.stringify({enabled}) });
  }

  const activeAgents   = agents.filter(a => a.status==="active").length;
  const totalAgents    = agents.length;
  const onlineDepts    = departments.filter(d => d.enabled).length;
  const activeAutonomy = autonomy.filter(c => c.enabled).length;
  const avgHealth      = activeAgents>0
    ? Math.round(agents.filter(a => a.status==="active").reduce((s,a) => s+a.health_score,0)/activeAgents) : 100;

  const TABS = [
    {id:"agents",      label:"Agents",     Icon:Users,     badge:`${activeAgents}/${totalAgents}`},
    {id:"departments", label:"Departments", Icon:Building2, badge:`${onlineDepts}/${departments.length}`},
    {id:"autonomy",    label:"Autonomy",    Icon:Brain,     badge:`${activeAutonomy}/12`},
  ] as const;

  return (
    <div className="sj-panel" style={{ height:"100%", display:"flex", flexDirection:"column", overflow:"hidden" }}>
      <div className="sj-panel-header" style={{ flexShrink:0 }}>
        <Users size={13} style={{ color:"var(--color-icon)" }}/>
        <span className="sj-label">Agent Registry</span>
        <span className="sj-badge">Create Origins OS · {totalAgents} agents</span>
        <div className="sj-ml-auto sj-flex sj-items-center sj-gap-2">
          <button onClick={load} style={{ background:"none", border:"none", cursor:"pointer", color:"var(--color-text-muted)", display:"flex" }}><RefreshCw size={11}/></button>
          <button className="sj-btn sj-btn-primary" style={{ padding:"4px var(--sp-2)", fontSize:11 }} onClick={() => setShowCreate(true)}>
            <Plus size={11}/> New Agent
          </button>
        </div>
      </div>

      <div style={{ padding:"var(--sp-2) var(--sp-4)", borderBottom:"var(--border)", display:"flex", gap:"var(--sp-5)", background:"var(--color-surface-raised)", flexShrink:0 }}>
        {[
          {l:"Active agents",  v:activeAgents,   s:`/${totalAgents}`},
          {l:"Depts online",   v:onlineDepts,    s:`/${departments.length}`},
          {l:"Avg health",     v:avgHealth,      s:""},
          {l:"Autonomy on",    v:activeAutonomy, s:"/12"},
        ].map(({l,v,s}) => (
          <div key={l} style={{ display:"flex", flexDirection:"column", gap:1 }}>
            <div>
              <span style={{ fontSize:15, fontWeight:700, color:"var(--color-text-primary)" }}>{v}</span>
              {s && <span className="sj-micro" style={{ color:"var(--color-text-muted)" }}>{s}</span>}
            </div>
            <span className="sj-micro" style={{ color:"var(--color-text-muted)" }}>{l}</span>
          </div>
        ))}
      </div>

      <div style={{ display:"flex", borderBottom:"var(--border)", flexShrink:0 }}>
        {TABS.map(({id,label,Icon,badge}) => (
          <button key={id} onClick={() => setActiveTab(id)} style={{
            flex:1, background:"none", border:"none",
            borderBottom: activeTab===id ? "2px solid var(--color-accent)" : "2px solid transparent",
            padding:"var(--sp-2) var(--sp-3)", cursor:"pointer",
            display:"flex", alignItems:"center", justifyContent:"center", gap:"var(--sp-1)",
            color: activeTab===id ? "var(--color-text-primary)" : "var(--color-text-muted)", fontSize:11,
          }}>
            <Icon size={12}/>{label}<span className="sj-badge" style={{ fontSize:9 }}>{badge}</span>
          </button>
        ))}
      </div>

      <div style={{ flex:1, overflow:"hidden", display:"flex", flexDirection:"column" }}>
        {loading
          ? <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center" }}><Loader2 size={20} className="spin" style={{ color:"var(--color-text-muted)" }}/></div>
          : <div style={{ flex:1, overflow:"hidden", padding:"var(--sp-4)", display:"flex", flexDirection:"column" }}>
              {activeTab==="agents"      && <AgentsTab agents={agents} departments={departments} onSelectAgent={openAgent}/>}
              {activeTab==="departments" && <DepartmentsTab departments={departments} agents={agents} onToggleDept={toggleDept} onCreateDept={() => setShowCreateDept(true)}/>}
              {activeTab==="autonomy"    && <AutonomyTab categories={autonomy} onToggle={toggleAutonomy}/>}
            </div>
        }
      </div>

      {selected && <AgentModal agent={selected} onClose={() => setSelected(null)} onRefresh={load}/>}
      {showCreate && (
        <CreateAgentModal
          departments={departments}
          onClose={() => setShowCreate(false)}
          onCreated={() => { setShowCreate(false); load(); }}
        />
      )}
      {showCreateDept && (
        <CreateDepartmentModal
          onClose={() => setShowCreateDept(false)}
          onCreated={() => { setShowCreateDept(false); load(); }}
        />
      )}
    </div>
  );
}
