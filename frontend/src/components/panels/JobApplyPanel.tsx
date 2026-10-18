"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Briefcase, Settings, FileText, MessageSquare, Play, Plus, Trash2,
  Save, CheckCircle, Loader2, Star, X, ChevronDown, ChevronUp,
  RefreshCw, Circle, AlertCircle, Clock, Award,
} from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

// ── Types ─────────────────────────────────────────────────────────────────────

interface JobProfile {
  target_roles: string[];
  work_modes: string[];
  locations: string[];
  salary_min: number;
  salary_max: number;
  experience_years: number;
  skills: string[];
  blacklist_companies: string[];
  resume_path: string;
  daily_limit: number;
  auto_apply_enabled: boolean;
  auto_apply_hour: number;
  linkedin_email: string;
  chrome_profile_path: string;
}

interface ScreeningAnswer {
  id: number;
  question: string;
  answer: string;
  category: string;
}

interface CoverLetter {
  id: number;
  name: string;
  content: string;
  is_default: boolean;
  created_at: string;
}

interface JobApplication {
  id: string;
  company: string;
  title: string;
  url: string;
  location: string;
  work_mode: string;
  status: string;
  applied_at: string;
  cover_letter_name: string;
  notes: string;
  cover_letter?: string;
}

interface ApplyRun {
  id: number;
  started_at: string;
  completed_at: string | null;
  jobs_found: number;
  jobs_applied: number;
  jobs_skipped: number;
  status: string;
  error_msg: string;
  run_log: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function Tag({ label, onRemove }: { label: string; onRemove?: () => void }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      fontSize: 11, background: "var(--color-surface)",
      border: "1px solid var(--color-border)", borderRadius: 12,
      padding: "2px 8px", marginRight: 4, marginBottom: 4,
    }}>
      {label}
      {onRemove && (
        <button onClick={onRemove} style={{ background: "none", border: "none", cursor: "pointer", padding: 0, color: "var(--color-text-dim)", lineHeight: 1 }}>
          <X size={10} />
        </button>
      )}
    </span>
  );
}

function TagInput({ value, onChange, placeholder }: { value: string[]; onChange: (v: string[]) => void; placeholder?: string }) {
  const [input, setInput] = useState("");
  function add() {
    const t = input.trim();
    if (t && !value.includes(t)) { onChange([...value, t]); }
    setInput("");
  }
  return (
    <div>
      <div style={{ display: "flex", flexWrap: "wrap", marginBottom: 4 }}>
        {value.map((v) => <Tag key={v} label={v} onRemove={() => onChange(value.filter((x) => x !== v))} />)}
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <input className="sj-input" placeholder={placeholder} value={input}
          style={{ flex: 1 }}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); add(); } }} />
        <button className="sj-btn-ghost" onClick={add}><Plus size={12} /></button>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, [string, string]> = {
    applied:   ["#60a5fa", "Applied"],
    viewed:    ["#a78bfa", "Viewed"],
    response:  ["#34d399", "Response"],
    interview: ["#facc15", "Interview"],
    rejected:  ["#f87171", "Rejected"],
    offer:     ["#4ade80", "Offer 🎉"],
    running:   ["#60a5fa", "Running"],
    completed: ["#34d399", "Completed"],
    failed:    ["#f87171", "Failed"],
  };
  const [color, label] = map[status] ?? ["#94a3b8", status];
  return (
    <span style={{ fontSize: 10, fontWeight: 700, color, background: color + "22",
      border: `1px solid ${color}44`, borderRadius: 8, padding: "2px 7px" }}>
      {label}
    </span>
  );
}

function fmt(d: string) {
  if (!d) return "";
  return new Date(d).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" });
}

// ── Tab: Preferences ─────────────────────────────────────────────────────────

function PreferencesTab() {
  const [profile, setProfile] = useState<Partial<JobProfile>>({
    target_roles: [
      "AI Engineer", "ML Engineer", "Machine Learning Engineer",
      "LLM Engineer", "Generative AI Engineer", "AI Backend Engineer",
      "AI/ML Engineer", "Data Engineer", "AI Product Engineer",
    ],
    work_modes: ["remote", "hybrid"],
    locations: ["India", "Remote"],
    skills: [
      "Python", "FastAPI", "LLM", "OpenAI API", "Anthropic API",
      "LangChain", "RAG", "Node.js", "JavaScript", "TypeScript",
      "PostgreSQL", "MongoDB", "Redis", "Docker", "GCP",
      "REST API", "Kafka", "React", "Machine Learning", "Vector Databases",
    ],
    blacklist_companies: ["TCS", "Infosys", "Wipro", "HCL", "Cognizant", "Tech Mahindra", "Accenture"],
    daily_limit: 5,
    salary_min: 1500000,
    salary_max: 4000000,
    experience_years: 5,
    resume_path: "storage/user/vijay/VijayMoirangthemResume.pdf",
    linkedin_email: "vijaymoirangthem9@gmail.com",
    chrome_profile_path: "C:\\Users\\vijay\\AppData\\Local\\Google\\Chrome\\User Data",
    auto_apply_enabled: false,
    auto_apply_hour: 9,
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch(`${API}/api/apply/profile`).then((r) => r.json()).then((d) => {
      if (d && Object.keys(d).length) setProfile(d);
    }).catch(() => {});
  }, []);

  async function save() {
    setSaving(true);
    try {
      const r = await fetch(`${API}/api/apply/profile`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profile),
      });
      if (r.ok) { setSaved(true); setTimeout(() => setSaved(false), 2000); }
    } finally { setSaving(false); }
  }

  const work_mode_opts = ["remote", "hybrid", "onsite"];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20, padding: "16px 20px", overflowY: "auto", flex: 1 }}>
      <div>
        <p style={{ fontSize: 11, fontWeight: 700, color: "var(--color-text-dim)", marginBottom: 8, letterSpacing: "0.06em" }}>TARGET ROLES</p>
        <TagInput value={profile.target_roles ?? []} onChange={(v) => setProfile((p) => ({ ...p, target_roles: v }))}
          placeholder="e.g. MERN Stack Developer (press Enter)" />
      </div>

      <div>
        <p style={{ fontSize: 11, fontWeight: 700, color: "var(--color-text-dim)", marginBottom: 8, letterSpacing: "0.06em" }}>WORK MODE</p>
        <div style={{ display: "flex", gap: 8 }}>
          {work_mode_opts.map((m) => (
            <button key={m} onClick={() => {
              const cur = profile.work_modes ?? [];
              const next = cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m];
              setProfile((p) => ({ ...p, work_modes: next }));
            }}
              className={profile.work_modes?.includes(m) ? "sj-btn" : "sj-btn-ghost"}
              style={{ fontSize: 12, textTransform: "capitalize" }}>
              {m}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p style={{ fontSize: 11, fontWeight: 700, color: "var(--color-text-dim)", marginBottom: 8, letterSpacing: "0.06em" }}>SKILLS</p>
        <TagInput value={profile.skills ?? []} onChange={(v) => setProfile((p) => ({ ...p, skills: v }))}
          placeholder="e.g. React, Node.js, MongoDB" />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
        <div>
          <p style={{ fontSize: 11, fontWeight: 700, color: "var(--color-text-dim)", marginBottom: 6 }}>DAILY LIMIT</p>
          <input className="sj-input" type="number" min={1} max={50} value={profile.daily_limit ?? 5}
            onChange={(e) => setProfile((p) => ({ ...p, daily_limit: +e.target.value }))} />
        </div>
        <div>
          <p style={{ fontSize: 11, fontWeight: 700, color: "var(--color-text-dim)", marginBottom: 6 }}>SALARY MIN (₹/yr)</p>
          <input className="sj-input" type="number" value={profile.salary_min ?? 0}
            onChange={(e) => setProfile((p) => ({ ...p, salary_min: +e.target.value }))} />
        </div>
        <div>
          <p style={{ fontSize: 11, fontWeight: 700, color: "var(--color-text-dim)", marginBottom: 6 }}>SALARY MAX (₹/yr)</p>
          <input className="sj-input" type="number" value={profile.salary_max ?? 0}
            onChange={(e) => setProfile((p) => ({ ...p, salary_max: +e.target.value }))} />
        </div>
      </div>

      <div>
        <p style={{ fontSize: 11, fontWeight: 700, color: "var(--color-text-dim)", marginBottom: 8, letterSpacing: "0.06em" }}>BLACKLISTED COMPANIES</p>
        <TagInput value={profile.blacklist_companies ?? []} onChange={(v) => setProfile((p) => ({ ...p, blacklist_companies: v }))}
          placeholder="Companies to skip" />
      </div>

      <div>
        <p style={{ fontSize: 11, fontWeight: 700, color: "var(--color-text-dim)", marginBottom: 6 }}>RESUME PATH</p>
        <input className="sj-input" value={profile.resume_path ?? ""}
          onChange={(e) => setProfile((p) => ({ ...p, resume_path: e.target.value }))} />
      </div>

      <div>
        <p style={{ fontSize: 11, fontWeight: 700, color: "var(--color-text-dim)", marginBottom: 6 }}>LINKEDIN EMAIL</p>
        <input className="sj-input" value={profile.linkedin_email ?? ""}
          onChange={(e) => setProfile((p) => ({ ...p, linkedin_email: e.target.value }))} />
      </div>

      <div>
        <p style={{ fontSize: 11, fontWeight: 700, color: "var(--color-text-dim)", marginBottom: 6 }}>CHROME PROFILE PATH</p>
        <input className="sj-input" value={profile.chrome_profile_path ?? ""}
          onChange={(e) => setProfile((p) => ({ ...p, chrome_profile_path: e.target.value }))} />
        <p style={{ fontSize: 10, color: "var(--color-text-dim)", marginTop: 4 }}>
          Default: C:\Users\vijay\AppData\Local\Google\Chrome\User Data
        </p>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
        <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
          <input type="checkbox" checked={profile.auto_apply_enabled ?? false}
            onChange={(e) => setProfile((p) => ({ ...p, auto_apply_enabled: e.target.checked }))} />
          Enable daily auto-apply
        </label>
        {profile.auto_apply_enabled && (
          <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 6 }}>
            Run at
            <select className="sj-input" style={{ width: 90, padding: "2px 6px" }}
              value={profile.auto_apply_hour ?? 9}
              onChange={(e) => setProfile((p) => ({ ...p, auto_apply_hour: Number(e.target.value) }))}>
              {Array.from({ length: 24 }, (_, h) => (
                <option key={h} value={h}>
                  {String(h).padStart(2, "0")}:00 UTC
                </option>
              ))}
            </select>
            <span style={{ color: "var(--color-text-dim)", fontSize: 10 }}>
              ({((((profile.auto_apply_hour ?? 9) + 5) % 24) + ":" + "30").padStart(5, "0")} IST)
            </span>
          </label>
        )}
      </div>

      <button className="sj-btn" style={{ alignSelf: "flex-start" }} onClick={save} disabled={saving}>
        {saved ? <><CheckCircle size={13} /> Saved!</> : saving ? <><Loader2 size={13} className="spin" /> Saving…</> : <><Save size={13} /> Save Preferences</>}
      </button>
    </div>
  );
}

// ── Tab: Screening Answers ────────────────────────────────────────────────────

const CATEGORIES = ["general", "authorization", "experience", "skills", "salary", "location", "work_mode", "education", "availability", "portfolio"];

function ScreeningTab() {
  const [answers, setAnswers] = useState<ScreeningAnswer[]>([]);
  const [editing, setEditing] = useState<Partial<ScreeningAnswer> | null>(null);
  const [loading, setLoading] = useState(true);
  const [seeding, setSeeding] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/apply/screening`);
      if (r.ok) setAnswers(await r.json());
    } catch { /* backend may not be ready */ } finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function save() {
    if (!editing?.question || !editing?.answer) return;
    await fetch(`${API}/api/apply/screening`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editing),
    });
    setEditing(null);
    load();
  }

  async function del(id: number) {
    await fetch(`${API}/api/apply/screening/${id}`, { method: "DELETE" });
    load();
  }

  async function seed() {
    setSeeding(true);
    await fetch(`${API}/api/apply/screening/seed`, { method: "POST" });
    await load();
    setSeeding(false);
  }

  const grouped = CATEGORIES.reduce((acc, cat) => {
    acc[cat] = answers.filter((a) => a.category === cat);
    return acc;
  }, {} as Record<string, ScreeningAnswer[]>);

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--color-border)", display: "flex", gap: 8, flexShrink: 0 }}>
        <button className="sj-btn" onClick={() => setEditing({ category: "general" })}><Plus size={12} /> Add Answer</button>
        <button className="sj-btn-ghost" onClick={seed} disabled={seeding}>
          {seeding ? <><Loader2 size={12} className="spin" /> Seeding…</> : "Seed Defaults"}
        </button>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "12px 16px" }}>
        {loading ? <Loader2 size={18} className="spin" /> : (
          Object.entries(grouped).map(([cat, items]) => items.length === 0 ? null : (
            <div key={cat} style={{ marginBottom: 20 }}>
              <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.07em", color: "var(--color-text-dim)", marginBottom: 8, textTransform: "uppercase" }}>{cat}</p>
              {items.map((a) => (
                <div key={a.id} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "8px 10px", background: "var(--color-surface)", borderRadius: 6, marginBottom: 6, border: "1px solid var(--color-border)" }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 12, fontWeight: 600, marginBottom: 2 }}>{a.question}</p>
                    <p style={{ fontSize: 11, color: "var(--color-text-dim)" }}>{a.answer}</p>
                  </div>
                  <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                    <button className="sj-btn-ghost" style={{ padding: "3px 6px" }} onClick={() => setEditing(a)}><Settings size={11} /></button>
                    <button className="sj-btn-ghost" style={{ padding: "3px 6px", color: "#f87171" }} onClick={() => del(a.id)}><Trash2 size={11} /></button>
                  </div>
                </div>
              ))}
            </div>
          ))
        )}
      </div>

      {editing && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100 }}>
          <div style={{ width: 480, background: "var(--color-bg)", border: "1px solid var(--color-border)", borderRadius: 8, padding: 20 }}>
            <p style={{ fontWeight: 700, marginBottom: 14 }}>Screening Answer</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <input className="sj-input" placeholder="Question" value={editing.question ?? ""}
                onChange={(e) => setEditing((p) => ({ ...p, question: e.target.value }))} />
              <textarea className="sj-input" rows={3} placeholder="Answer" value={editing.answer ?? ""}
                onChange={(e) => setEditing((p) => ({ ...p, answer: e.target.value }))} />
              <select className="sj-input" value={editing.category ?? "general"}
                onChange={(e) => setEditing((p) => ({ ...p, category: e.target.value }))}>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              <button className="sj-btn" onClick={save}><Save size={12} /> Save</button>
              <button className="sj-btn-ghost" onClick={() => setEditing(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Tab: Cover Letters ────────────────────────────────────────────────────────

function CoverLettersTab() {
  const [letters, setLetters] = useState<CoverLetter[]>([]);
  const [selected, setSelected] = useState<Partial<CoverLetter> | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/apply/cover-letters`);
      if (r.ok) setLetters(await r.json());
    } catch { /* backend may not be ready */ }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function save() {
    if (!selected?.name || !selected?.content) return;
    setSaving(true);
    try {
      await fetch(`${API}/api/apply/cover-letters`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(selected),
      });
      await load();
      setSelected(null);
    } finally { setSaving(false); }
  }

  async function del(id: number) {
    await fetch(`${API}/api/apply/cover-letters/${id}`, { method: "DELETE" });
    load();
  }

  return (
    <div style={{ display: "flex", height: "100%", overflow: "hidden" }}>
      {/* List */}
      <div style={{ width: 200, borderRight: "1px solid var(--color-border)", display: "flex", flexDirection: "column", overflowY: "auto" }}>
        <div style={{ padding: "10px 10px 6px" }}>
          <button className="sj-btn" style={{ width: "100%", justifyContent: "center", fontSize: 12 }}
            onClick={() => setSelected({ name: "", content: "", is_default: false })}>
            <Plus size={12} /> New Letter
          </button>
        </div>
        {letters.map((l) => (
          <button key={l.id} onClick={() => setSelected(l)} style={{
            display: "flex", alignItems: "center", gap: 6, padding: "8px 12px",
            background: selected?.id === l.id ? "var(--color-surface)" : "none",
            border: "none", cursor: "pointer", textAlign: "left", width: "100%",
            borderLeft: selected?.id === l.id ? "2px solid #60a5fa" : "2px solid transparent",
          }}>
            {l.is_default && <Star size={10} style={{ color: "#facc15", flexShrink: 0 }} fill="#facc15" />}
            <span style={{ fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.name}</span>
          </button>
        ))}
      </div>

      {/* Editor */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", padding: 16, gap: 10 }}>
        {selected ? (
          <>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input className="sj-input" placeholder="Cover letter name" value={selected.name ?? ""}
                style={{ flex: 1 }} onChange={(e) => setSelected((p) => ({ ...p, name: e.target.value }))} />
              <label style={{ fontSize: 12, display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap", cursor: "pointer" }}>
                <input type="checkbox" checked={selected.is_default ?? false}
                  onChange={(e) => setSelected((p) => ({ ...p, is_default: e.target.checked }))} />
                Set as default
              </label>
            </div>
            <textarea
              className="sj-input"
              placeholder="Write your cover letter here. Use {company} and {role} as placeholders — Jazper will fill them in automatically when applying."
              value={selected.content ?? ""}
              style={{ flex: 1, resize: "none", fontFamily: "inherit", lineHeight: 1.7 }}
              onChange={(e) => setSelected((p) => ({ ...p, content: e.target.value }))}
            />
            <div style={{ display: "flex", gap: 8 }}>
              <button className="sj-btn" onClick={save} disabled={saving}>
                {saving ? <><Loader2 size={12} className="spin" /> Saving…</> : <><Save size={12} /> Save</>}
              </button>
              {selected.id && (
                <button className="sj-btn-ghost" style={{ color: "#f87171" }} onClick={() => { del(selected.id!); setSelected(null); }}>
                  <Trash2 size={12} /> Delete
                </button>
              )}
              <button className="sj-btn-ghost" onClick={() => setSelected(null)}>Cancel</button>
            </div>
          </>
        ) : (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--color-text-dim)", fontSize: 13 }}>
            Select or create a cover letter
          </div>
        )}
      </div>
    </div>
  );
}

// ── Tab: Run / Applications ───────────────────────────────────────────────────

function RunTab() {
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [lastResult, setLastResult] = useState<any>(null);
  const [applications, setApplications] = useState<JobApplication[]>([]);
  const [runs, setRuns] = useState<ApplyRun[]>([]);
  const [expandedRun, setExpandedRun] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState("all");
  const [clModal, setClModal] = useState<{jobId: string; company: string; title?: string} | null>(null);
  const [clNotes, setClNotes] = useState("");
  const [clLoading, setClLoading] = useState(false);
  const [clResult, setClResult] = useState<string | null>(null);
  const [clCopied, setClCopied] = useState(false);
  const [clCoachLoading, setClCoachLoading] = useState(false);
  const [clSuggestions, setClSuggestions] = useState<string[]>([]);
  const logRef = useRef<HTMLDivElement>(null);

  const loadApplications = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/apply/applications?limit=100`);
      if (r.ok) setApplications(await r.json());
    } catch { /* backend may not be ready */ }
  }, []);

  const loadRuns = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/apply/runs?limit=10`);
      if (r.ok) setRuns(await r.json());
    } catch { /* backend may not be ready */ }
  }, []);

  useEffect(() => {
    loadApplications();
    loadRuns();
  }, [loadApplications, loadRuns]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  async function startRun(limit?: number) {
    setRunning(true);
    setLogs([limit ? `Starting TEST run — 1 job only…` : "Starting full job-apply run…"]);
    setLastResult(null);
    try {
      const url = limit ? `${API}/api/apply/run?limit=${limit}` : `${API}/api/apply/run`;
      const res = await fetch(url, { method: "POST" });
      const reader = res.body?.getReader();
      if (!reader) return;
      const dec = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6);
          if (payload.startsWith("[DONE]")) {
            try { setLastResult(JSON.parse(payload.slice(6))); } catch { }
          } else {
            setLogs((p) => [...p, payload]);
          }
        }
      }
    } catch (e) {
      setLogs((p) => [...p, `Error: ${e}`]);
    } finally {
      setRunning(false);
      loadApplications();
      loadRuns();
    }
  }

  const statusOptions = ["all", "applied", "viewed", "response", "interview", "rejected", "offer"];
  const filtered = statusFilter === "all" ? applications : applications.filter((a) => a.status === statusFilter);

  return (
    <div style={{ display: "flex", height: "100%", overflow: "hidden", gap: 0 }}>
      {/* Left: run control + log */}
      <div style={{ width: 320, borderRight: "1px solid var(--color-border)", display: "flex", flexDirection: "column", flexShrink: 0 }}>
        {/* Run button */}
        <div style={{ padding: 14, borderBottom: "1px solid var(--color-border)", flexShrink: 0 }}>
          <button className="sj-btn" style={{ width: "100%", justifyContent: "center" }}
            onClick={() => startRun()} disabled={running}>
            {running
              ? <><Loader2 size={13} className="spin" /> Running… (do not close)</>
              : <><Play size={13} /> Apply Jobs on LinkedIn Now</>}
          </button>
          <button
            className="sj-btn-ghost"
            style={{ width: "100%", justifyContent: "center", marginTop: 6, fontSize: 12, border: "1px dashed #facc1566", color: "#facc15" }}
            onClick={() => startRun(1)} disabled={running}>
            <Award size={12} style={{ marginRight: 4 }} /> Test Run — Apply 1 Job Only
          </button>
          {lastResult && (
            <div style={{ marginTop: 10, padding: "8px 10px", background: "var(--color-surface)", borderRadius: 6, fontSize: 11, display: "flex", gap: 12 }}>
              <span style={{ color: "#34d399" }}>✓ {lastResult.jobs_applied} applied</span>
              <span style={{ color: "var(--color-text-dim)" }}>{lastResult.jobs_found} found</span>
              <span style={{ color: "var(--color-text-dim)" }}>{lastResult.jobs_skipped} skipped</span>
            </div>
          )}
        </div>

        {/* Live log */}
        <div style={{ padding: "8px 12px", borderBottom: "1px solid var(--color-border)", flexShrink: 0 }}>
          <p style={{ fontSize: 10, fontWeight: 700, color: "var(--color-text-dim)", letterSpacing: "0.06em" }}>LIVE LOG</p>
        </div>
        <div ref={logRef} style={{ flex: 1, overflowY: "auto", padding: "8px 12px", fontFamily: "monospace", fontSize: 11, lineHeight: 1.7, color: "var(--color-text-dim)" }}>
          {logs.length === 0 ? <p style={{ color: "var(--color-text-dim)" }}>No run started yet.</p> : logs.map((l, i) => <p key={i}>{l}</p>)}
        </div>

        {/* Past runs */}
        <div style={{ borderTop: "1px solid var(--color-border)", flexShrink: 0, maxHeight: 180, overflowY: "auto" }}>
          <p style={{ fontSize: 10, fontWeight: 700, color: "var(--color-text-dim)", letterSpacing: "0.06em", padding: "8px 12px 4px" }}>PAST RUNS</p>
          {runs.map((run) => (
            <div key={run.id}>
              <button onClick={() => setExpandedRun(expandedRun === run.id ? null : run.id)}
                style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "6px 12px", background: "none", border: "none", cursor: "pointer", textAlign: "left" }}>
                <StatusBadge status={run.status} />
                <span style={{ fontSize: 11, flex: 1 }}>{fmt(run.started_at)} — {run.jobs_applied} applied</span>
                {expandedRun === run.id ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
              </button>
              {expandedRun === run.id && (
                <div style={{ padding: "4px 12px 8px", fontSize: 10, color: "var(--color-text-dim)", fontFamily: "monospace", whiteSpace: "pre-wrap", background: "var(--color-bg)" }}>
                  {run.run_log || "(no log)"}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Right: applications table */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ padding: "10px 14px", borderBottom: "1px solid var(--color-border)", display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
          <span style={{ fontSize: 12, fontWeight: 700, flex: 1 }}>Applications ({filtered.length})</span>
          <button className="sj-btn-ghost" onClick={() => { loadApplications(); loadRuns(); }}><RefreshCw size={12} /></button>
          <select className="sj-input" value={statusFilter} style={{ fontSize: 11, padding: "3px 8px", width: "auto" }}
            onChange={(e) => setStatusFilter(e.target.value)}>
            {statusOptions.map((s) => <option key={s} value={s}>{s === "all" ? "All statuses" : s}</option>)}
          </select>
        </div>

        <div style={{ flex: 1, overflowY: "auto" }}>
          {filtered.length === 0 ? (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "var(--color-text-dim)", fontSize: 13 }}>
              No applications yet. Run a job-apply session to start!
            </div>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: "var(--color-surface)", borderBottom: "1px solid var(--color-border)" }}>
                  {["Company", "Role", "Location", "Applied", "Status", "Cover Letter"].map((h) => (
                    <th key={h} style={{ padding: "8px 12px", textAlign: "left", fontSize: 10, fontWeight: 700, color: "var(--color-text-dim)", letterSpacing: "0.06em" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((a) => (
                  <tr key={a.id} style={{ borderBottom: "1px solid var(--color-border)" }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = "var(--color-surface)")}
                    onMouseLeave={(e) => (e.currentTarget.style.background = "")}>
                    <td style={{ padding: "8px 12px", fontWeight: 600 }}>{a.company}</td>
                    <td style={{ padding: "8px 12px" }}>
                      {a.url ? <a href={a.url} target="_blank" rel="noreferrer" style={{ color: "#60a5fa", textDecoration: "none" }}>{a.title}</a> : a.title}
                    </td>
                    <td style={{ padding: "8px 12px", color: "var(--color-text-dim)" }}>{a.location || "—"}</td>
                    <td style={{ padding: "8px 12px", color: "var(--color-text-dim)", whiteSpace: "nowrap" }}>{fmt(a.applied_at)}</td>
                    <td style={{ padding: "8px 12px" }}><StatusBadge status={a.status} /></td>
                    <td style={{ padding: "8px 12px" }}>
                      {a.cover_letter ? (
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                          <span style={{ fontSize: 10, fontWeight: 700, color: "#34d399", background: "#34d39922", border: "1px solid #34d39944", borderRadius: 8, padding: "2px 7px" }}>
                            ✓ Generated
                          </span>
                          <button
                            className="sj-btn-ghost"
                            style={{ fontSize: 10, padding: "2px 6px" }}
                            onClick={() => {
                              setClResult(a.cover_letter || "");
                              setClNotes("");
                              setClCopied(false);
                              setClModal({ jobId: a.id, company: a.company });
                            }}>
                            View
                          </button>
                        </span>
                      ) : (
                        <button
                          className="sj-btn"
                          style={{ fontSize: 10, padding: "2px 8px" }}
                          onClick={() => { setClModal({ jobId: a.id, company: a.company }); setClResult(null); setClNotes(""); setClCopied(false); }}>
                          Generate
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Cover Letter Modal */}
      {clModal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "var(--color-bg)", border: "var(--border)", borderRadius: 12, padding: 24, width: "min(560px, 90vw)", maxHeight: "80vh", overflowY: "auto", position: "relative" }}>
            <button
              onClick={() => { setClModal(null); setClResult(null); setClNotes(""); setClCopied(false); setClSuggestions([]); }}
              style={{ position: "absolute", top: 12, right: 12, background: "none", border: "none", cursor: "pointer", color: "var(--color-text-dim)" }}>
              <X size={16} />
            </button>
            <p style={{ fontWeight: 700, fontSize: 15, marginBottom: 14 }}>Cover Letter — {clModal.company}</p>

            {!clResult ? (
              <>
                <textarea
                  placeholder="Any specific points to highlight?"
                  value={clNotes}
                  onChange={(e) => setClNotes(e.target.value)}
                  rows={3}
                  className="sj-input"
                  style={{ width: "100%", resize: "none", marginBottom: 12, boxSizing: "border-box" }}
                />
                <button
                  className="sj-btn"
                  disabled={clLoading}
                  onClick={async () => {
                    setClLoading(true);
                    try {
                      const r = await fetch(`${API}/api/cover-letter/generate`, {
                        method: "POST", headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ job_id: clModal.jobId, notes: clNotes }),
                      });
                      if (!r.ok) throw new Error(await r.text());
                      const data = await r.json();
                      setClResult(data.cover_letter ?? data.text ?? JSON.stringify(data));
                    } catch (e) {
                      setClResult(`Error: ${e instanceof Error ? e.message : "Unknown error"}`);
                    } finally {
                      setClLoading(false);
                    }
                  }}>
                  {clLoading ? <><Loader2 size={13} className="spin" /> Generating…</> : "Generate"}
                </button>
              </>
            ) : (
              <>
                <pre style={{
                  fontSize: 12, fontFamily: "monospace", maxHeight: 320, overflowY: "auto",
                  border: "1px solid var(--color-border)", borderRadius: 6, padding: 12,
                  marginBottom: 12, whiteSpace: "pre-wrap", background: "var(--color-surface)",
                  color: "var(--color-text)",
                }}>
                  {clResult}
                </pre>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <button
                    className="sj-btn-ghost"
                    onClick={() => { navigator.clipboard.writeText(clResult!); setClCopied(true); setTimeout(() => setClCopied(false), 2000); }}>
                    {clCopied ? "Copied!" : "Copy"}
                  </button>
                  <button
                    className="sj-btn"
                    onClick={async () => {
                      try {
                        await fetch(`${API}/api/cover-letter/save`, {
                          method: "POST", headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ job_id: clModal.jobId, cover_letter: clResult }),
                        });
                        setClModal(null); setClResult(null); setClNotes(""); setClCopied(false); setClSuggestions([]);
                        loadApplications();
                      } catch { /* silent */ }
                    }}>
                    Save to Application
                  </button>
                  <button
                    className="sj-btn-ghost"
                    disabled={clCoachLoading}
                    style={{ color: "#a78bfa", borderColor: "#a78bfa44" }}
                    onClick={async () => {
                      setClCoachLoading(true);
                      setClSuggestions([]);
                      try {
                        const r = await fetch(`${API}/api/cover-letter/review`, {
                          method: "POST", headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ cover_letter: clResult, job_title: clModal.title || "", company: clModal.company }),
                        });
                        const data = await r.json();
                        setClSuggestions(data.suggestions ?? []);
                      } catch { /* silent */ }
                      finally { setClCoachLoading(false); }
                    }}>
                    {clCoachLoading ? "Reviewing…" : "🎯 Coach Review"}
                  </button>
                  <button className="sj-btn-ghost" onClick={() => { setClResult(null); setClSuggestions([]); }}>
                    Back
                  </button>
                </div>

                {/* Coach suggestions */}
                {clSuggestions.length > 0 && (
                  <div style={{ marginTop: 14, padding: "12px 14px", borderRadius: 8, background: "color-mix(in srgb, #a78bfa 8%, transparent)", border: "1px solid #a78bfa33" }}>
                    <p style={{ fontSize: 12, fontWeight: 600, color: "#a78bfa", marginBottom: 8 }}>🎯 Coach Feedback</p>
                    <ol style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 6 }}>
                      {clSuggestions.map((s, i) => (
                        <li key={i} style={{ fontSize: 12, color: "var(--color-text)", lineHeight: 1.5 }}>{s}</li>
                      ))}
                    </ol>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main Panel ────────────────────────────────────────────────────────────────

type Tab = "preferences" | "screening" | "coverletters" | "run";

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: "preferences",  label: "Preferences",     icon: <Settings size={13} /> },
  { id: "screening",    label: "Screening Q&A",   icon: <MessageSquare size={13} /> },
  { id: "coverletters", label: "Cover Letters",   icon: <FileText size={13} /> },
  { id: "run",          label: "Run & Track",     icon: <Play size={13} /> },
];

export function JobApplyPanel() {
  const [tab, setTab] = useState<Tab>("preferences");

  return (
    <div className="sj-panel" style={{ height: "100%", padding: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 16px", borderBottom: "1px solid var(--color-border)", background: "var(--color-surface)", flexShrink: 0 }}>
        <Briefcase size={16} style={{ color: "#60a5fa" }} />
        <span style={{ fontSize: 14, fontWeight: 700 }}>Job Apply — Sir Jazper</span>
        <span style={{ fontSize: 11, color: "var(--color-text-dim)", marginLeft: 4 }}>LinkedIn Automation</span>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", borderBottom: "1px solid var(--color-border)", flexShrink: 0, background: "var(--color-surface)" }}>
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{
              display: "flex", alignItems: "center", gap: 6, padding: "9px 16px",
              fontSize: 12, background: "none", cursor: "pointer",
              borderTop: "none", borderLeft: "none", borderRight: "none",
              borderBottom: tab === t.id ? "2px solid #60a5fa" : "2px solid transparent",
              color: tab === t.id ? "var(--color-text)" : "var(--color-text-dim)",
              fontWeight: tab === t.id ? 700 : 400,
            }}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
        {tab === "preferences"  && <PreferencesTab />}
        {tab === "screening"    && <ScreeningTab />}
        {tab === "coverletters" && <CoverLettersTab />}
        {tab === "run"          && <RunTab />}
      </div>
    </div>
  );
}
