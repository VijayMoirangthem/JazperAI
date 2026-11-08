"use client";

import { useCallback, useMemo, useState } from "react";
import { Gauge, Lock } from "lucide-react";
import { useApi } from "@/lib/swr";
import { setPerf, type PerfSettings } from "@/lib/perfRuntime";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const base = `${API}/api/performance`;

interface Proc { pid: number; name: string; role: string; rss_mb: number; threads: number }
interface Status {
  cpu_pct_one_core: number; rss_mb: number; threads: number; preset: string; processes: Proc[]; warnings: string[];
  agents: { total: number; active: number; inactive: number; critical: number; active_counted: number };
  tasks: { agent: Lim; background: Lim; asyncio_tasks: number; scheduled: number; paused: number };
  host: { cpu_pct: number; logical_cores: number; ram_total_mb: number; ram_available_pct: number };
  limits: { memory_budget_mb: number; max_active_agents: number; max_concurrent_tasks: number };
}
interface Lim { limit: number; running: number; waiting: number; peak: number; completed: number }
interface Agent { slug: string; display_name: string; role_title: string; crew: string; source: string; active: boolean; critical: boolean; deactivated: boolean; enabled: boolean }
interface SettingsResp { settings: PerfSettings; presets: Record<string, PerfSettings> }

type Field = { key: keyof PerfSettings; label: string; hint: string; kind: "int" | "float" | "bool" | "select"; options?: string[]; min?: number; max?: number; step?: number };
const FIELDS: { title: string; fields: Field[] }[] = [
  { title: "Agents & concurrency", fields: [
    { key: "max_active_agents", label: "Max active agents", hint: "0 = unlimited. Critical agents never count.", kind: "int", min: 0, max: 500 },
    { key: "max_concurrent_tasks", label: "Max concurrent agent tasks", hint: "Extra agent calls wait in a queue.", kind: "int", min: 1, max: 64 },
    { key: "max_background_jobs", label: "Max concurrent background jobs", hint: "Scheduled jobs running at once.", kind: "int", min: 1, max: 32 },
    { key: "background_jobs_enabled", label: "Background jobs enabled", hint: "Off pauses all scheduled jobs except essential ones.", kind: "bool" },
  ] },
  { title: "Polling & realtime", fields: [
    { key: "poll_scale", label: "Polling slow-down (×)", hint: "1 = normal. 3 = every poll takes 3× longer.", kind: "float", min: 1, max: 10, step: 0.5 },
    { key: "ui_update_ms", label: "Realtime UI update gap (ms)", hint: "Bursts of live events render once per gap.", kind: "int", min: 50, max: 5000, step: 50 },
  ] },
  { title: "Visuals", fields: [
    { key: "animations", label: "Animations", hint: "off / reduced / full (loading spinners always stay).", kind: "select", options: ["off", "reduced", "full"] },
    { key: "max_fps", label: "Max frames per second", hint: "Caps the 2D/3D office render loops.", kind: "int", min: 10, max: 120, step: 5 },
    { key: "show_inactive_agents", label: "Show inactive agents in the app", hint: "Off hides deactivated agents everywhere.", kind: "bool" },
  ] },
  { title: "Logging", fields: [
    { key: "log_level", label: "Log verbosity", hint: "Applies immediately.", kind: "select", options: ["DEBUG", "INFO", "WARNING", "ERROR"] },
    { key: "log_retention_entries", label: "Live log retention (entries)", hint: "Entries kept in memory for the Logs view.", kind: "int", min: 50, max: 20000, step: 50 },
  ] },
  { title: "Optional background systems", fields: [
    { key: "mcp_autoconnect", label: "Auto-connect MCP connectors at start", hint: "Each connected server is a separate process.", kind: "bool" },
    { key: "file_watcher", label: "Project file watcher", hint: "Applies immediately.", kind: "bool" },
    { key: "auto_repair_loop", label: "Auto-repair log watcher", hint: "Watches errors and triggers the IT agents.", kind: "bool" },
    { key: "pii_engine", label: "PII engine", hint: "regex covers email/phone/IP/IBAN; presidio adds an NLP second opinion (uses more RAM).", kind: "select", options: ["presidio", "regex"] },
  ] },
  { title: "Monitoring", fields: [
    { key: "memory_budget_mb", label: "Memory budget (MB)", hint: "A warning shows when the app exceeds this.", kind: "int", min: 256, max: 262144, step: 128 },
  ] },
];

const PRESET_BLURB: Record<string, string> = {
  eco: "Minimal resources: few agents, slow polling, no animations, no optional background systems.",
  balanced: "Moderate: a capped agent count, reduced animation, everything useful still on.",
  performance: "Everything on, scaled to this machine's cores and RAM.",
};

const pct = (n: number) => `${n.toFixed(0)}%`;
const mb = (n: number) => (n >= 1024 ? `${(n / 1024).toFixed(1)} GB` : `${Math.round(n)} MB`);

function Stat({ label, value, sub, warn }: { label: string; value: string; sub?: string; warn?: boolean }) {
  return (
    <div className={`rounded border p-3 ${warn ? "border-amber-500/60 bg-amber-500/10" : "border-white/10 bg-white/5"}`}>
      <div className="text-[11px] uppercase opacity-60">{label}</div>
      <div className="text-xl font-semibold">{value}</div>
      {sub && <div className="text-xs opacity-60">{sub}</div>}
    </div>
  );
}

async function call(method: string, path: string, body?: unknown): Promise<{ ok: boolean; data: any }> {
  const r = await fetch(`${base}${path}`, { method, headers: { "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  let data: any = null;
  try { data = await r.json(); } catch { /* empty body */ }
  return { ok: r.ok, data };
}
const errText = (d: any) => (typeof d?.detail === "string" ? d.detail : d?.detail?.message ?? (Array.isArray(d?.detail) ? d.detail.map((x: any) => `${x.field}: ${x.message}`).join("; ") : "Request failed"));

/** Performance Settings: presets, individual limits, agent on/off, and a live view of what Jazper is really using. */
export function PerformancePanel() {
  const [tab, setTab] = useState<"overview" | "settings" | "agents">("overview");
  const [msg, setMsg] = useState("");
  const status = useApi<Status>(`${base}/status`, { ttl: 1000, poll: 3000 });
  const cfg = useApi<SettingsResp>(`${base}/settings`, { ttl: 1000, poll: false });
  const agents = useApi<{ agents: Agent[]; counts: Status["agents"]; critical: string[] }>(`${base}/agents`, { ttl: 1000, poll: tab === "agents" ? 5000 : false });
  const s = status.data, settings = cfg.data?.settings;
  const [draft, setDraft] = useState<Partial<PerfSettings>>({});
  const [preview, setPreview] = useState<{ name: string; drop: string[] } | null>(null);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "active" | "inactive">("all");
  const [crew, setCrew] = useState("");

  const refreshAll = useCallback(async () => { await Promise.all([status.refresh(), cfg.refresh(), agents.refresh()]); }, [status, cfg, agents]);
  const saved = (d: any) => { if (d?.settings) setPerf(d.settings); };

  const saveSettings = async () => {
    const r = await call("PUT", "/settings", draft);
    setMsg(r.ok ? "Settings saved and applied." : errText(r.data));
    if (r.ok) { saved(r.data); setDraft({}); await refreshAll(); }
  };
  const previewPreset = async (name: string) => {
    const r = await call("POST", `/preset/${name}?dry_run=true`);
    if (r.ok) setPreview({ name, drop: r.data.would_deactivate ?? [] }); else setMsg(errText(r.data));
  };
  const applyPreset = async () => {
    if (!preview) return;
    const r = await call("POST", `/preset/${preview.name}`);
    setMsg(r.ok ? `${preview.name} applied${r.data.deactivated?.length ? `; ${r.data.deactivated.length} agent(s) deactivated` : ""}.` : errText(r.data));
    if (r.ok) { saved(r.data); setDraft({}); setPreview(null); await refreshAll(); }
  };
  const toggle = async (a: Agent, active: boolean) => {
    const r = await call("PUT", `/agents/${a.slug}`, { active, force: false });
    setMsg(r.ok ? "" : errText(r.data));
    await refreshAll();
  };
  const bulk = async (body: object, label: string) => {
    const r = await call("POST", "/agents/bulk", body);
    setMsg(r.ok ? `${label}: ${r.data.changed.length} changed${r.data.skipped.length ? `, ${r.data.skipped.length} skipped (${[...new Set(r.data.skipped.map((x: any) => x.why))].join("; ")})` : ""}.` : errText(r.data));
    await refreshAll();
  };

  const list = agents.data?.agents ?? [];
  const crews = useMemo(() => [...new Set(list.map((a) => a.crew))].sort(), [list]);
  const shown = list.filter((a) => (filter === "all" || (filter === "active") === a.active) && (!q || `${a.slug} ${a.display_name} ${a.role_title}`.toLowerCase().includes(q.toLowerCase())));
  const val = <K extends keyof PerfSettings>(k: K) => (k in draft ? draft[k] : settings?.[k]) as PerfSettings[K];

  return (
    <div className="space-y-4 p-4 text-sm">
      <div className="flex items-center gap-2"><Gauge className="h-5 w-5" /><h2 className="text-lg font-semibold">Performance</h2>
        <span className="rounded bg-white/10 px-2 py-0.5 text-xs">preset: {settings?.preset ?? "…"}</span></div>
      {msg && <div className="rounded border border-white/10 bg-white/5 p-2 text-xs">{msg}</div>}
      <div className="flex gap-2 border-b border-white/10">
        {(["overview", "settings", "agents"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`px-3 py-1.5 capitalize ${tab === t ? "border-b-2 border-indigo-400" : "opacity-60"}`}>{t === "settings" ? "Presets & limits" : t}</button>
        ))}
      </div>

      {tab === "overview" && s && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="App CPU" value={pct(s.cpu_pct_one_core)} sub={`of one core · ${s.host.logical_cores} cores · host ${pct(s.host.cpu_pct)}`} warn={s.cpu_pct_one_core > 80} />
            <Stat label="App RAM" value={mb(s.rss_mb)} sub={`budget ${mb(s.limits.memory_budget_mb)} · ${s.threads} threads`} warn={s.rss_mb > s.limits.memory_budget_mb} />
            <Stat label="Active agents" value={`${s.agents.active} / ${s.agents.total}`} sub={`${s.agents.inactive} inactive · ${s.agents.critical} critical${s.limits.max_active_agents ? ` · limit ${s.limits.max_active_agents}` : ""}`} />
            <Stat label="Running tasks" value={`${s.tasks.agent.running} / ${s.tasks.agent.limit}`} sub={`${s.tasks.agent.waiting} queued · peak ${s.tasks.agent.peak}`} warn={s.tasks.agent.waiting > 0} />
            <Stat label="Background jobs" value={`${s.tasks.background.running} / ${s.tasks.background.limit}`} sub={`${s.tasks.scheduled} scheduled · ${s.tasks.paused} paused`} />
            <Stat label="Async tasks" value={String(s.tasks.asyncio_tasks)} sub="inside the backend" />
            <Stat label="Processes" value={String(s.processes.length)} sub="backend + helpers" />
            <Stat label="System RAM free" value={pct(s.host.ram_available_pct)} sub={`${mb(s.host.ram_total_mb)} total`} warn={s.host.ram_available_pct < 15} />
          </div>
          {s.warnings.length > 0
            ? <div className="space-y-1 rounded border border-amber-500/60 bg-amber-500/10 p-3 text-xs">{s.warnings.map((w) => <div key={w}>⚠ {w}</div>)}</div>
            : <div className="rounded border border-emerald-500/40 bg-emerald-500/10 p-2 text-xs">No performance warnings.</div>}
          <div>
            <div className="mb-1 text-xs uppercase opacity-60">Background processes (measured)</div>
            <table className="w-full text-xs"><thead className="text-left opacity-60"><tr><th>Role</th><th>Process</th><th>PID</th><th className="text-right">RAM</th><th className="text-right">Threads</th></tr></thead>
              <tbody>{s.processes.map((p) => <tr key={p.pid} className="border-t border-white/5"><td>{p.role}</td><td className="font-mono">{p.name}</td><td>{p.pid}</td><td className="text-right">{mb(p.rss_mb)}</td><td className="text-right">{p.threads}</td></tr>)}</tbody></table>
          </div>
        </div>
      )}

      {tab === "settings" && settings && cfg.data && (
        <div className="space-y-4">
          <div className="grid gap-3 lg:grid-cols-3">
            {(["eco", "balanced", "performance"] as const).map((n) => {
              const p = cfg.data!.presets[n];
              return (
                <div key={n} className={`rounded border p-3 ${settings.preset === n ? "border-indigo-400 bg-indigo-500/10" : "border-white/10 bg-white/5"}`}>
                  <div className="font-semibold capitalize">{n} mode</div>
                  <div className="my-1 text-xs opacity-70">{PRESET_BLURB[n]}</div>
                  <div className="text-[11px] opacity-60">agents ≤ {p.max_active_agents || "∞"} · tasks {p.max_concurrent_tasks} · polling ×{p.poll_scale} · {p.animations} animations · {p.max_fps} fps</div>
                  <button onClick={() => previewPreset(n)} className="mt-2 rounded bg-indigo-600 px-3 py-1 text-xs">Preview &amp; apply</button>
                </div>
              );
            })}
          </div>
          {preview && (
            <div className="rounded border border-indigo-400 bg-indigo-500/10 p-3 text-xs">
              <div className="font-semibold capitalize">Apply {preview.name} mode?</div>
              {preview.drop.length ? <div className="my-1">These {preview.drop.length} agent(s) will be <b>deactivated</b> (data kept, reversible): <span className="font-mono">{preview.drop.join(", ")}</span></div> : <div className="my-1">No agents need to be deactivated.</div>}
              <button onClick={applyPreset} className="mr-2 rounded bg-indigo-600 px-3 py-1">Apply</button>
              <button onClick={() => setPreview(null)} className="rounded bg-white/10 px-3 py-1">Cancel</button>
            </div>
          )}
          {FIELDS.map((g) => (
            <div key={g.title}>
              <div className="mb-1 text-xs uppercase opacity-60">{g.title}</div>
              <div className="grid gap-2 lg:grid-cols-2">
                {g.fields.map((f) => (
                  <label key={f.key} className="flex items-center justify-between gap-3 rounded border border-white/10 bg-white/5 p-2">
                    <span><span className="block">{f.label}</span><span className="block text-[11px] opacity-60">{f.hint}</span></span>
                    {f.kind === "bool" ? <input type="checkbox" checked={!!val(f.key)} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.checked })} />
                      : f.kind === "select" ? <select className="rounded bg-black/40 p-1" value={String(val(f.key))} onChange={(e) => setDraft({ ...draft, [f.key]: e.target.value })}>{f.options!.map((o) => <option key={o}>{o}</option>)}</select>
                        : <input type="number" className="w-24 rounded bg-black/40 p-1 text-right" min={f.min} max={f.max} step={f.step ?? 1} value={String(val(f.key))} onChange={(e) => setDraft({ ...draft, [f.key]: f.kind === "float" ? parseFloat(e.target.value) : parseInt(e.target.value || "0", 10) })} />}
                  </label>
                ))}
              </div>
            </div>
          ))}
          <div className="flex gap-2">
            <button disabled={!Object.keys(draft).length} onClick={saveSettings} className="rounded bg-indigo-600 px-4 py-1.5 disabled:opacity-40">Save changes</button>
            <button disabled={!Object.keys(draft).length} onClick={() => setDraft({})} className="rounded bg-white/10 px-4 py-1.5 disabled:opacity-40">Discard</button>
          </div>
        </div>
      )}

      {tab === "agents" && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search agents…" className="rounded bg-black/40 p-1.5" />
            <select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} className="rounded bg-black/40 p-1.5"><option value="all">All</option><option value="active">Active</option><option value="inactive">Inactive</option></select>
            <button onClick={() => bulk({ all: true, active: true }, "Activate all")} className="rounded bg-emerald-700 px-2 py-1">Activate all</button>
            <button onClick={() => bulk({ all: true, active: false }, "Deactivate all")} className="rounded bg-rose-700 px-2 py-1">Deactivate all (keeps critical)</button>
            <select value={crew} onChange={(e) => setCrew(e.target.value)} className="rounded bg-black/40 p-1.5"><option value="">Crew…</option>{crews.map((c) => <option key={c}>{c}</option>)}</select>
            <button disabled={!crew} onClick={() => bulk({ crew, active: true }, `Activate ${crew}`)} className="rounded bg-white/10 px-2 py-1 disabled:opacity-40">Activate crew</button>
            <button disabled={!crew} onClick={() => bulk({ crew, active: false }, `Deactivate ${crew}`)} className="rounded bg-white/10 px-2 py-1 disabled:opacity-40">Deactivate crew</button>
            <label className="ml-auto flex items-center gap-1"><input type="checkbox" checked={!!settings?.show_inactive_agents} onChange={async (e) => { const r = await call("PUT", "/settings", { show_inactive_agents: e.target.checked }); if (r.ok) { saved(r.data); await refreshAll(); } }} /> show inactive in the app</label>
          </div>
          <div className="text-xs opacity-60">{agents.data?.counts.active ?? 0} active · {agents.data?.counts.inactive ?? 0} inactive. Deactivating keeps an agent's settings and data; it only stops its work. Critical agents ({(agents.data?.critical ?? []).join(", ")}) are protected.</div>
          <div className="divide-y divide-white/5 rounded border border-white/10">
            {shown.map((a) => (
              <div key={a.slug} className={`flex items-center gap-3 p-2 ${a.active ? "" : "opacity-50"}`}>
                <input type="checkbox" checked={a.active} disabled={a.critical} title={a.critical ? "Critical system agent" : a.active ? "Deactivate" : "Activate"} onChange={(e) => toggle(a, e.target.checked)} />
                <div className="min-w-0 flex-1"><div className="truncate font-medium">{a.display_name} <span className="font-mono text-[11px] opacity-50">{a.slug}</span></div><div className="truncate text-[11px] opacity-60">{a.role_title}</div></div>
                <span className="rounded bg-white/10 px-1.5 text-[11px]">{a.crew}</span>
                {a.critical && <Lock className="h-3.5 w-3.5 text-amber-400" aria-label="critical" />}
              </div>
            ))}
            {shown.length === 0 && <div className="p-3 text-xs opacity-60">No agents match.</div>}
          </div>
        </div>
      )}
    </div>
  );
}
