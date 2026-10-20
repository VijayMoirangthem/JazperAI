"use client";

// The shared skill library: procedures bots learned (or you wrote), with usage, win/loss and version history.
// Bots create and patch skills themselves after tool-using turns (Hermes-style background review); you can edit or disable any of them.
import { useEffect, useState } from "react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
interface Skill { name: string; description: string; version: number; uses: number; wins: number; losses: number; created_by: string; enabled: boolean; updated_at: string }
interface Detail extends Skill { body: string; history: { version: number; changed_by: string; reason: string; ts: string }[] }

export function SkillsPanel() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [sel, setSel] = useState<Detail | null>(null);
  const [body, setBody] = useState("");
  const load = () => fetch(`${API}/api/v1/skills/`).then((r) => r.json()).then((d) => setSkills(d.skills ?? [])).catch(() => undefined);
  useEffect(() => { void load(); const t = setInterval(load, 10000); return () => clearInterval(t); }, []);
  const open = async (n: string) => { const d: Detail = await fetch(`${API}/api/v1/skills/${n}`).then((r) => r.json()); setSel(d); setBody(d.body); };
  const save = async () => {
    if (!sel) return;
    await fetch(`${API}/api/v1/skills/`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: sel.name, description: sel.description, body }) });
    await open(sel.name); await load();
  };
  const toggle = async (s: Skill) => { await fetch(`${API}/api/v1/skills/${s.name}/enabled?enabled=${!s.enabled}`, { method: "POST" }); await load(); };
  return (
    <div className="flex h-full min-h-[500px]" data-testid="skills-panel">
      <div className="w-[360px] shrink-0 overflow-y-auto border-r border-white/10 p-3">
        <h1 className="mb-1 text-lg font-semibold">Skills</h1>
        <p className="mb-3 text-xs opacity-60">Procedures the team has learned. Bots load a skill only when they need it, so it costs almost no tokens.</p>
        {skills.length === 0 && <div className="text-sm opacity-50">No skills yet. They appear after bots finish multi-step work.</div>}
        {skills.map((s) => (
          <button key={s.name} onClick={() => void open(s.name)} className="mb-1.5 block w-full rounded-xl px-3 py-2 text-left" style={{ background: sel?.name === s.name ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.04)", opacity: s.enabled ? 1 : 0.5 }}>
            <div className="flex items-center gap-2"><span className="text-sm font-semibold">{s.name}</span><span className="ml-auto text-[10px] opacity-60">v{s.version}</span></div>
            <div className="truncate text-xs opacity-60">{s.description}</div>
            <div className="mt-0.5 text-[10px] opacity-50">used {s.uses}× · 👍 {s.wins} 👎 {s.losses} · by {s.created_by}</div>
          </button>
        ))}
      </div>
      <div className="min-w-0 flex-1 overflow-y-auto p-5">
        {!sel ? <div className="pt-10 text-center text-sm opacity-50">Select a skill to read or improve it.</div> : (
          <div className="space-y-3" data-testid="skill-detail">
            <div className="flex items-center gap-2"><h2 className="text-lg font-semibold">{sel.name}</h2><span className="text-xs opacity-60">v{sel.version}</span>
              <button onClick={() => void toggle(sel)} className="ml-auto rounded-full bg-white/10 px-3 py-1 text-xs">{sel.enabled ? "Disable" : "Enable"}</button></div>
            <div className="text-sm opacity-70">{sel.description}</div>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={14} className="w-full rounded-lg bg-white/10 p-2 font-mono text-xs outline-none" aria-label="Skill body" />
            <button onClick={() => void save()} className="rounded-full bg-blue-600 px-4 py-1.5 text-sm">Save new version</button>
            <div className="pt-2 text-xs font-semibold uppercase tracking-wider opacity-50">History</div>
            {sel.history.map((h) => <div key={h.version} className="text-xs opacity-70">v{h.version} · {h.changed_by} · {new Date(h.ts).toLocaleString()} {h.reason && `· ${h.reason}`}</div>)}
          </div>
        )}
      </div>
    </div>
  );
}
