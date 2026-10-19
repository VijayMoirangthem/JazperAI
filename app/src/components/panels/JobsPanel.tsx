"use client";

import { useState, useEffect, useCallback } from "react";
import {
  BriefcaseBusiness, Play, Trash2, ToggleLeft, ToggleRight,
  CheckCircle, XCircle, Clock, Loader2, RefreshCw, Plus,
  ChevronDown, ChevronRight, User, KeyRound, Bell, BellDot,
} from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

// ── Types ─────────────────────────────────────────────────────────────────────

type JobStatus = "pending" | "running" | "success" | "failed";

interface CronJob {
  id: string;
  name: string;
  worker_type: string;
  schedule: string;
  enabled: boolean;
  config: Record<string, unknown>;
  last_status: JobStatus | null;
  last_run_at: string | null;
}

interface JobRun {
  id: string;
  cron_job_id?: string;
  job_name?: string;
  status: JobStatus;
  started_at: string | null;
  finished_at: string | null;
  result: Record<string, unknown>;
  log: string;
}

interface UserProfile {
  full_name: string;
  email: string;
  phone: string;
  resume_text: string;
  skills: string[];
  preferences: {
    title?: string;
    location?: string;
    remote?: boolean;
    salary_min?: number;
    blacklist?: string[];
    mode?: "AUTO" | "PROPOSE";
    limit?: number;
  };
}

interface Portal {
  portal: string;
  updated_at: string | null;
}

interface Notification {
  id: string;
  title: string;
  body: string;
  type: "success" | "error" | "warning" | "info";
  read: boolean;
  created_at: string | null;
  job_run_id: string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function statusIcon(status: JobStatus | null) {
  if (!status) return <Clock size={12} style={{ color: "var(--color-text-dim)" }} />;
  if (status === "success") return <CheckCircle size={12} style={{ color: "#4ade80" }} />;
  if (status === "failed")  return <XCircle size={12} style={{ color: "#f87171" }} />;
  if (status === "running") return <Loader2 size={12} className="spin" style={{ color: "#facc15" }} />;
  return <Clock size={12} style={{ color: "var(--color-text-dim)" }} />;
}

function statusBadge(status: JobStatus) {
  const map: Record<JobStatus, { label: string; color: string }> = {
    pending: { label: "pending", color: "#94a3b8" },
    running: { label: "running", color: "#facc15" },
    success: { label: "success", color: "#4ade80" },
    failed:  { label: "failed",  color: "#f87171" },
  };
  const { label, color } = map[status] ?? { label: status, color: "#94a3b8" };
  return (
    <span style={{
      fontSize: 10, fontWeight: 600, letterSpacing: "0.05em",
      color, border: `1px solid ${color}`, borderRadius: 3,
      padding: "1px 5px", textTransform: "uppercase",
    }}>
      {label}
    </span>
  );
}

function fmt(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

function notifColor(type: Notification["type"]) {
  return { success: "#4ade80", error: "#f87171", warning: "#facc15", info: "#60a5fa" }[type] ?? "#94a3b8";
}

// ── Sub-components ────────────────────────────────────────────────────────────

function RunRow({ run }: { run: JobRun }) {
  const [open, setOpen] = useState(false);
  const matches: unknown[] = (run.result?.matches as unknown[]) ?? [];

  return (
    <div style={{ borderBottom: "1px solid var(--color-border)", padding: "8px 0" }}>
      <div
        style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}
        onClick={() => setOpen((p) => !p)}
      >
        {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {statusBadge(run.status)}
        <span style={{ fontSize: 12, fontWeight: 600 }}>{run.job_name ?? "—"}</span>
        <span style={{ fontSize: 11, color: "var(--color-text-dim)", marginLeft: "auto" }}>
          {fmt(run.started_at)}
        </span>
      </div>
      {open && (
        <div style={{ marginTop: 8, paddingLeft: 20 }}>
          {run.log && (
            <pre style={{
              fontSize: 10, color: "var(--color-text-dim)", background: "var(--color-surface)",
              padding: 8, borderRadius: 4, whiteSpace: "pre-wrap", wordBreak: "break-all",
              maxHeight: 120, overflow: "auto",
            }}>
              {run.log}
            </pre>
          )}
          {Object.keys(run.result).length > 0 && (
            <pre style={{
              fontSize: 10, color: "var(--color-text-dim)", background: "var(--color-surface)",
              padding: 8, borderRadius: 4, whiteSpace: "pre-wrap", wordBreak: "break-all",
              maxHeight: 200, overflow: "auto", marginTop: 4,
            }}>
              {JSON.stringify(run.result, null, 2)}
            </pre>
          )}
          {matches.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <p style={{ fontSize: 11, fontWeight: 600, marginBottom: 4 }}>
                Proposed Matches ({matches.length})
              </p>
              {(matches as Array<{ title: string; company: string; location: string; url: string }>).map((m, i) => (
                <div key={i} style={{
                  fontSize: 11, padding: "4px 8px", background: "var(--color-surface)",
                  borderRadius: 4, marginBottom: 4,
                }}>
                  <strong>{m.title}</strong> @ {m.company} — {m.location}
                  {m.url && (
                    <a href={m.url} target="_blank" rel="noreferrer"
                      style={{ marginLeft: 8, color: "#60a5fa", fontSize: 10 }}>
                      View
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Jobs Tab ──────────────────────────────────────────────────────────────────

function JobsTab() {
  const [jobs, setJobs] = useState<CronJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({
    name: "", worker_type: "job_apply", schedule: "0 9 * * 1-5",
    mode: "PROPOSE" as "AUTO" | "PROPOSE",
    title: "Software Engineer", location: "", remote: true,
    salary_min: 0, limit: 5, blacklist: "",
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API}/api/jobs/`);
      if (!r.ok) throw new Error(`${r.status}`);
      const d = await r.json();
      setJobs(d.jobs ?? []);
    } catch {
      // Backend offline — show empty state, don't crash
      setJobs([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function createJob() {
    setCreating(true);
    try {
      await fetch(`${API}/api/jobs/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          worker_type: form.worker_type,
          schedule: form.schedule,
          enabled: true,
          config: {
            mode: form.mode,
            title: form.title,
            location: form.location,
            remote: form.remote,
            salary_min: form.salary_min,
            limit: form.limit,
            blacklist: form.blacklist.split(",").map((s) => s.trim()).filter(Boolean),
          },
        }),
      });
      setForm((p) => ({ ...p, name: "" }));
      load();
    } finally {
      setCreating(false);
    }
  }

  async function toggleEnabled(job: CronJob) {
    await fetch(`${API}/api/jobs/${job.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: !job.enabled }),
    });
    load();
  }

  async function deleteJob(id: string) {
    if (!confirm("Delete this job?")) return;
    await fetch(`${API}/api/jobs/${id}`, { method: "DELETE" });
    load();
  }

  async function runNow(id: string) {
    const r = await fetch(`${API}/api/jobs/${id}/run`, { method: "POST" });
    const d = await r.json();
    alert(`Run started — run ID: ${d.run_id}`);
    load();
  }

  return (
    <div style={{ padding: 16, overflowY: "auto", height: "100%" }}>
      {/* Create form */}
      <div style={{
        background: "var(--color-surface)", borderRadius: 6,
        padding: 12, marginBottom: 16, border: "1px solid var(--color-border)",
      }}>
        <p style={{ fontSize: 11, fontWeight: 700, marginBottom: 8, letterSpacing: "0.05em" }}>
          NEW CRON JOB
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <input className="sj-input" placeholder="Job name" value={form.name}
            onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} />
          <input className="sj-input" placeholder="Cron schedule (e.g. 0 9 * * 1-5)"
            value={form.schedule}
            onChange={(e) => setForm((p) => ({ ...p, schedule: e.target.value }))} />
          <input className="sj-input" placeholder="Job title to search"
            value={form.title}
            onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))} />
          <input className="sj-input" placeholder="Location (blank = anywhere)"
            value={form.location}
            onChange={(e) => setForm((p) => ({ ...p, location: e.target.value }))} />
          <input className="sj-input" placeholder="Blacklisted companies (comma-separated)"
            value={form.blacklist}
            onChange={(e) => setForm((p) => ({ ...p, blacklist: e.target.value }))} />
          <select className="sj-input" value={form.mode}
            onChange={(e) => setForm((p) => ({ ...p, mode: e.target.value as "AUTO" | "PROPOSE" }))}>
            <option value="PROPOSE">PROPOSE — show matches for approval</option>
            <option value="AUTO">AUTO — apply immediately</option>
          </select>
          <label style={{ fontSize: 11, display: "flex", alignItems: "center", gap: 6 }}>
            <input type="checkbox" checked={form.remote}
              onChange={(e) => setForm((p) => ({ ...p, remote: e.target.checked }))} />
            Remote only
          </label>
          <input className="sj-input" placeholder="Max applications per run"
            type="number" value={form.limit}
            onChange={(e) => setForm((p) => ({ ...p, limit: Number(e.target.value) }))} />
        </div>
        <button className="sj-btn" style={{ marginTop: 10 }} onClick={createJob} disabled={!form.name || creating}>
          <Plus size={12} /> {creating ? "Creating…" : "Create Job"}
        </button>
      </div>

      {/* Job list */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.05em" }}>
          SCHEDULED JOBS ({jobs.length})
        </p>
        <button className="sj-btn-ghost" onClick={load}>
          <RefreshCw size={12} />
        </button>
      </div>

      {loading ? (
        <p style={{ fontSize: 12, color: "var(--color-text-dim)" }}>Loading…</p>
      ) : jobs.length === 0 ? (
        <p style={{ fontSize: 12, color: "var(--color-text-dim)" }}>No jobs yet — create one above.</p>
      ) : (
        jobs.map((job) => (
          <div key={job.id} style={{
            background: "var(--color-surface)", borderRadius: 6, padding: 10,
            marginBottom: 8, border: "1px solid var(--color-border)",
            display: "flex", flexDirection: "column", gap: 4,
          }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {statusIcon(job.last_status)}
              <span style={{ fontSize: 13, fontWeight: 600, flex: 1 }}>{job.name}</span>
              <span style={{ fontSize: 10, color: "var(--color-text-dim)" }}>{job.schedule}</span>
              <button className="sj-btn-ghost" title={job.enabled ? "Disable" : "Enable"}
                onClick={() => toggleEnabled(job)}>
                {job.enabled
                  ? <ToggleRight size={14} style={{ color: "#4ade80" }} />
                  : <ToggleLeft size={14} style={{ color: "var(--color-text-dim)" }} />}
              </button>
              <button className="sj-btn-ghost" title="Run now" onClick={() => runNow(job.id)}>
                <Play size={12} />
              </button>
              <button className="sj-btn-ghost" title="Delete" onClick={() => deleteJob(job.id)}>
                <Trash2 size={12} style={{ color: "#f87171" }} />
              </button>
            </div>
            <div style={{ fontSize: 10, color: "var(--color-text-dim)", paddingLeft: 20 }}>
              {job.worker_type} · last run: {fmt(job.last_run_at)}
              {job.last_status && <> · {statusBadge(job.last_status)}</>}
            </div>
          </div>
        ))
      )}
    </div>
  );
}

// ── Runs Tab ──────────────────────────────────────────────────────────────────

function RunsTab() {
  const [runs, setRuns] = useState<JobRun[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API}/api/jobs/runs/all`);
      const d = await r.json();
      setRuns(d.runs ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <div style={{ padding: 16, overflowY: "auto", height: "100%" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.05em" }}>
          ALL RUNS ({runs.length})
        </p>
        <button className="sj-btn-ghost" onClick={load}><RefreshCw size={12} /></button>
      </div>
      {loading ? (
        <p style={{ fontSize: 12, color: "var(--color-text-dim)" }}>Loading…</p>
      ) : runs.length === 0 ? (
        <p style={{ fontSize: 12, color: "var(--color-text-dim)" }}>No runs yet.</p>
      ) : (
        runs.map((run) => <RunRow key={run.id} run={run} />)
      )}
    </div>
  );
}

// ── Profile Tab ───────────────────────────────────────────────────────────────

function ProfileTab() {
  const [profile, setProfile] = useState<UserProfile>({
    full_name: "", email: "", phone: "", resume_text: "",
    skills: [], preferences: { title: "", location: "", remote: true, salary_min: 0, mode: "PROPOSE", limit: 5 },
  });
  const [skillInput, setSkillInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch(`${API}/api/jobs/profile/`)
      .then((r) => r.json())
      .then((d) => {
        if (d.profile) setProfile(d.profile);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, []);

  function addSkill() {
    const s = skillInput.trim();
    if (!s) return;
    setProfile((p) => ({ ...p, skills: [...p.skills, s] }));
    setSkillInput("");
  }

  function removeSkill(i: number) {
    setProfile((p) => ({ ...p, skills: p.skills.filter((_, idx) => idx !== i) }));
  }

  async function save() {
    setSaving(true);
    try {
      await fetch(`${API}/api/jobs/profile/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(profile),
      });
    } finally {
      setSaving(false);
    }
  }

  if (!loaded) return <p style={{ padding: 16, fontSize: 12, color: "var(--color-text-dim)" }}>Loading…</p>;

  return (
    <div style={{ padding: 16, overflowY: "auto", height: "100%" }}>
      <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.05em", marginBottom: 12 }}>USER PROFILE</p>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
        <input className="sj-input" placeholder="Full name" value={profile.full_name}
          onChange={(e) => setProfile((p) => ({ ...p, full_name: e.target.value }))} />
        <input className="sj-input" placeholder="Email" value={profile.email}
          onChange={(e) => setProfile((p) => ({ ...p, email: e.target.value }))} />
        <input className="sj-input" placeholder="Phone" value={profile.phone}
          onChange={(e) => setProfile((p) => ({ ...p, phone: e.target.value }))} />
      </div>

      <textarea className="sj-input" placeholder="Paste your resume text here…"
        value={profile.resume_text} rows={6} style={{ width: "100%", marginBottom: 8, resize: "vertical" }}
        onChange={(e) => setProfile((p) => ({ ...p, resume_text: e.target.value }))} />

      <p style={{ fontSize: 11, fontWeight: 600, marginBottom: 4 }}>Skills</p>
      <div style={{ display: "flex", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
        {profile.skills.map((s, i) => (
          <span key={i} style={{
            fontSize: 11, background: "var(--color-surface)", border: "1px solid var(--color-border)",
            borderRadius: 3, padding: "2px 6px", cursor: "pointer",
          }} onClick={() => removeSkill(i)}>
            {s} ×
          </span>
        ))}
      </div>
      <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
        <input className="sj-input" placeholder="Add skill…" value={skillInput}
          onChange={(e) => setSkillInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && addSkill()} style={{ flex: 1 }} />
        <button className="sj-btn" onClick={addSkill}><Plus size={12} /></button>
      </div>

      <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.05em", marginBottom: 8 }}>JOB PREFERENCES</p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
        <input className="sj-input" placeholder="Target job title"
          value={profile.preferences.title ?? ""}
          onChange={(e) => setProfile((p) => ({ ...p, preferences: { ...p.preferences, title: e.target.value } }))} />
        <input className="sj-input" placeholder="Preferred location"
          value={profile.preferences.location ?? ""}
          onChange={(e) => setProfile((p) => ({ ...p, preferences: { ...p.preferences, location: e.target.value } }))} />
        <input className="sj-input" type="number" placeholder="Min salary"
          value={profile.preferences.salary_min ?? 0}
          onChange={(e) => setProfile((p) => ({ ...p, preferences: { ...p.preferences, salary_min: Number(e.target.value) } }))} />
        <input className="sj-input" type="number" placeholder="Max applications / run"
          value={profile.preferences.limit ?? 5}
          onChange={(e) => setProfile((p) => ({ ...p, preferences: { ...p.preferences, limit: Number(e.target.value) } }))} />
        <label style={{ fontSize: 11, display: "flex", alignItems: "center", gap: 6 }}>
          <input type="checkbox" checked={profile.preferences.remote ?? true}
            onChange={(e) => setProfile((p) => ({ ...p, preferences: { ...p.preferences, remote: e.target.checked } }))} />
          Remote only
        </label>
        <select className="sj-input" value={profile.preferences.mode ?? "PROPOSE"}
          onChange={(e) => setProfile((p) => ({ ...p, preferences: { ...p.preferences, mode: e.target.value as "AUTO" | "PROPOSE" } }))}>
          <option value="PROPOSE">PROPOSE — review before applying</option>
          <option value="AUTO">AUTO — apply automatically</option>
        </select>
      </div>

      <button className="sj-btn" onClick={save} disabled={saving}>
        {saving ? "Saving…" : "Save Profile"}
      </button>
    </div>
  );
}

// ── Credentials Tab ───────────────────────────────────────────────────────────

function CredentialsTab() {
  const [portals, setPortals] = useState<Portal[]>([]);
  const [cookieJson, setCookieJson] = useState("");
  const [userAgent, setUserAgent] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; name?: string; error?: string } | null>(null);

  const loadPortals = useCallback(async () => {
    const r = await fetch(`${API}/api/jobs/credentials/`);
    const d = await r.json();
    setPortals(d.portals ?? []);
  }, []);

  useEffect(() => { loadPortals(); }, [loadPortals]);

  async function saveCookies() {
    setSaving(true);
    try {
      const cookies = JSON.parse(cookieJson);
      await fetch(`${API}/api/jobs/credentials/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          portal: "linkedin",
          token_data: { cookies, user_agent: userAgent || undefined },
        }),
      });
      loadPortals();
      setTestResult(null);
    } catch {
      alert("Invalid JSON — paste a valid cookie array.");
    } finally {
      setSaving(false);
    }
  }

  async function testConnection() {
    setTesting(true);
    setTestResult(null);
    try {
      const r = await fetch(`${API}/api/jobs/credentials/test/linkedin`, { method: "POST" });
      const d = await r.json();
      setTestResult(d);
    } catch {
      setTestResult({ ok: false, error: "Request failed" });
    } finally {
      setTesting(false);
    }
  }

  async function removePortal(portal: string) {
    if (!confirm(`Remove ${portal} credentials?`)) return;
    await fetch(`${API}/api/jobs/credentials/${portal}`, { method: "DELETE" });
    loadPortals();
  }

  const linkedinConnected = portals.some((p) => p.portal === "linkedin");

  return (
    <div style={{ padding: 16, overflowY: "auto", height: "100%" }}>
      <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.05em", marginBottom: 12 }}>CREDENTIALS</p>

      {/* Connected portals */}
      {portals.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <p style={{ fontSize: 11, fontWeight: 600, marginBottom: 6 }}>Connected Portals</p>
          {portals.map((p) => (
            <div key={p.portal} style={{
              display: "flex", alignItems: "center", gap: 8,
              background: "var(--color-surface)", borderRadius: 4, padding: "6px 10px",
              border: "1px solid var(--color-border)", marginBottom: 4,
            }}>
              <CheckCircle size={12} style={{ color: "#4ade80" }} />
              <span style={{ fontSize: 12, flex: 1, textTransform: "capitalize" }}>{p.portal}</span>
              <span style={{ fontSize: 10, color: "var(--color-text-dim)" }}>
                updated {fmt(p.updated_at)}
              </span>
              <button className="sj-btn-ghost" onClick={() => removePortal(p.portal)}>
                <Trash2 size={12} style={{ color: "#f87171" }} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* LinkedIn cookie setup */}
      <div style={{
        background: "var(--color-surface)", borderRadius: 6, padding: 12,
        border: "1px solid var(--color-border)",
      }}>
        <p style={{ fontSize: 12, fontWeight: 600, marginBottom: 4 }}>LinkedIn Session Cookies</p>
        <p style={{ fontSize: 11, color: "var(--color-text-dim)", marginBottom: 8, lineHeight: 1.5 }}>
          1. Log into LinkedIn in your browser.<br />
          2. Export cookies using &quot;Cookie-Editor&quot; or &quot;EditThisCookie&quot; extension → Export as JSON.<br />
          3. Paste the JSON array below and click Save.
        </p>
        <textarea className="sj-input" placeholder='[{"name":"li_at","value":"...","domain":".linkedin.com",...}]'
          value={cookieJson} rows={5} style={{ width: "100%", marginBottom: 8, resize: "vertical", fontFamily: "monospace", fontSize: 11 }}
          onChange={(e) => setCookieJson(e.target.value)} />
        <input className="sj-input" placeholder="User-Agent from your browser (optional but recommended)"
          value={userAgent} style={{ marginBottom: 8 }}
          onChange={(e) => setUserAgent(e.target.value)} />
        <div style={{ display: "flex", gap: 8 }}>
          <button className="sj-btn" onClick={saveCookies} disabled={!cookieJson || saving}>
            {saving ? "Saving…" : "Save Cookies"}
          </button>
          {linkedinConnected && (
            <button className="sj-btn-ghost" onClick={testConnection} disabled={testing}>
              {testing ? <Loader2 size={12} className="spin" /> : <RefreshCw size={12} />}
              {testing ? " Testing…" : " Test Connection"}
            </button>
          )}
        </div>
        {testResult && (
          <div style={{
            marginTop: 8, padding: "6px 10px", borderRadius: 4, fontSize: 12,
            background: testResult.ok ? "#14532d33" : "#7f1d1d33",
            border: `1px solid ${testResult.ok ? "#4ade80" : "#f87171"}`,
            color: testResult.ok ? "#4ade80" : "#f87171",
          }}>
            {testResult.ok
              ? `Connected as ${testResult.name}`
              : `${testResult.error ?? "Connection failed"}`}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Notifications Tab ─────────────────────────────────────────────────────────

function NotificationsTab({ onRead }: { onRead: () => void }) {
  const [notifs, setNotifs] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${API}/api/jobs/notifications/`);
      const d = await r.json();
      setNotifs(d.notifications ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function markRead(id: string) {
    await fetch(`${API}/api/jobs/notifications/${id}/read`, { method: "POST" });
    load();
    onRead();
  }

  async function markAllRead() {
    await fetch(`${API}/api/jobs/notifications/read-all`, { method: "POST" });
    load();
    onRead();
  }

  return (
    <div style={{ padding: 16, overflowY: "auto", height: "100%" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.05em" }}>NOTIFICATIONS</p>
        <div style={{ display: "flex", gap: 6 }}>
          <button className="sj-btn-ghost" onClick={markAllRead}>Mark all read</button>
          <button className="sj-btn-ghost" onClick={load}><RefreshCw size={12} /></button>
        </div>
      </div>
      {loading ? (
        <p style={{ fontSize: 12, color: "var(--color-text-dim)" }}>Loading…</p>
      ) : notifs.length === 0 ? (
        <p style={{ fontSize: 12, color: "var(--color-text-dim)" }}>No notifications yet.</p>
      ) : (
        notifs.map((n) => (
          <div key={n.id} style={{
            background: "var(--color-surface)", borderRadius: 6, padding: 10,
            marginBottom: 6, border: `1px solid ${n.read ? "var(--color-border)" : notifColor(n.type)}`,
            opacity: n.read ? 0.6 : 1, cursor: n.read ? "default" : "pointer",
          }} onClick={() => !n.read && markRead(n.id)}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 6, height: 6, borderRadius: "50%", background: notifColor(n.type), flexShrink: 0 }} />
              <span style={{ fontSize: 12, fontWeight: 600, flex: 1 }}>{n.title}</span>
              <span style={{ fontSize: 10, color: "var(--color-text-dim)" }}>{fmt(n.created_at)}</span>
            </div>
            {n.body && <p style={{ fontSize: 11, color: "var(--color-text-dim)", marginTop: 3, paddingLeft: 12 }}>{n.body}</p>}
          </div>
        ))
      )}
    </div>
  );
}

// ── Main Panel ────────────────────────────────────────────────────────────────

type Tab = "jobs" | "runs" | "profile" | "credentials" | "notifications";

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: "jobs",         label: "Jobs",         icon: <BriefcaseBusiness size={12} /> },
  { id: "runs",         label: "Runs",         icon: <Clock size={12} /> },
  { id: "profile",      label: "Profile",      icon: <User size={12} /> },
  { id: "credentials",  label: "Credentials",  icon: <KeyRound size={12} /> },
  { id: "notifications",label: "Alerts",       icon: <Bell size={12} /> },
];

export function JobsPanel() {
  const [tab, setTab] = useState<Tab>("jobs");
  const [unread, setUnread] = useState(0);

  const fetchUnread = useCallback(async () => {
    try {
      const r = await fetch(`${API}/api/jobs/notifications/unread-count`);
      const d = await r.json();
      setUnread(d.count ?? 0);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    fetchUnread();
    const interval = setInterval(fetchUnread, 30_000);
    return () => clearInterval(interval);
  }, [fetchUnread]);

  return (
    <div className="sj-panel" style={{ height: "100%", display: "flex", flexDirection: "column", padding: 0 }}>
      {/* Tab bar */}
      <div style={{
        display: "flex", borderBottom: "1px solid var(--color-border)",
        padding: "0 12px", background: "var(--color-surface)",
      }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              display: "flex", alignItems: "center", gap: 5,
              padding: "10px 12px", fontSize: 11, fontWeight: tab === t.id ? 700 : 400,
              color: tab === t.id ? "var(--color-text)" : "var(--color-text-dim)",
              background: "none", borderBottom: tab === t.id ? "2px solid var(--color-accent)" : "2px solid transparent",
              cursor: "pointer", position: "relative",
            }}
          >
            {t.icon}
            {t.label}
            {t.id === "notifications" && unread > 0 && (
              <span style={{
                position: "absolute", top: 6, right: 4,
                background: "#f87171", color: "#fff",
                fontSize: 9, fontWeight: 700, borderRadius: "50%",
                width: 14, height: 14, display: "flex", alignItems: "center", justifyContent: "center",
              }}>
                {unread > 9 ? "9+" : unread}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div style={{ flex: 1, overflow: "hidden" }}>
        {tab === "jobs"         && <JobsTab />}
        {tab === "runs"         && <RunsTab />}
        {tab === "profile"      && <ProfileTab />}
        {tab === "credentials"  && <CredentialsTab />}
        {tab === "notifications" && <NotificationsTab onRead={fetchUnread} />}
      </div>
    </div>
  );
}
