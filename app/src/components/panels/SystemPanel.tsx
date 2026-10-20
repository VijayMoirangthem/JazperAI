"use client";

import { useCallback, useEffect, useState } from "react";
import { useApi } from "@/lib/swr";
import { Activity, DatabaseBackup, KeyRound } from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const base = `${API}/api/v1/system`;

interface Check { ok: boolean; detail: string; ms: number }
interface Secret { name: string; set: boolean }
interface HealthResponse { checks: Record<string, Check> }
interface SecretsResponse { secrets: Secret[] }

/** Health of every dependency, the OS-vault secret manager (write-only), and one-click encrypted backup. */
export function SystemPanel() {
  const [secrets, setSecrets] = useState<Secret[]>([]);
  const [msg, setMsg] = useState("");
  const [draft, setDraft] = useState({ name: "", value: "" });
  const [busy, setBusy] = useState(false);
  const [logName, setLogName] = useState("backend");
  const [logLines, setLogLines] = useState<string[]>([]);

  const { data: health, refresh: refreshHealth, loading: healthLoading } = useApi<HealthResponse>(`${base}/health`, { ttl: 15000, poll: 15000 });
  const checks = health?.checks ?? {};

  useEffect(() => {
    const f = () => fetch(`${base}/logs?name=${logName}&lines=150`).then((r) => r.json()).then((d) => setLogLines(d.lines ?? [])).catch(() => undefined);
    f();
    const t = setInterval(f, 4000);
    return () => clearInterval(t);
  }, [logName]);

  useEffect(() => {
    fetch(`${base}/secrets`).then((r) => r.json()).then((d) => setSecrets(d.secrets ?? [])).catch(() => undefined);
  }, []);

  const save = async (name: string, value: string) => {
    const r = await fetch(`${base}/secrets`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, value }) });
    setMsg(r.ok ? `${name} saved to the OS vault` : (await r.json().catch(() => ({}))).detail ?? "failed");
    setDraft({ name: "", value: "" });
    fetch(`${base}/secrets`).then((r) => r.json()).then((d) => setSecrets(d.secrets ?? [])).catch(() => undefined);
  };

  const backup = async () => {
    setBusy(true); setMsg("Backing up…");
    const r = await fetch(`${base}/backup`, { method: "POST" });
    setMsg(r.ok ? "Backup written to storage/backups (encrypted)" : "Backup failed");
    setBusy(false);
  };

  return (
    <div className="max-w-3xl space-y-6 p-6">
      <div className="flex items-center gap-3"><Activity size={20} /><h2 className="text-lg font-semibold">System</h2>{msg && <span className="text-xs opacity-70">{msg}</span>}</div>

      <section className="grid grid-cols-2 gap-3">
        {Object.entries(checks).map(([name, c]) => (
          <div key={name} className="rounded border p-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: c.ok ? "#22c55e" : "#ef4444" }} />{name}
              <span className="ml-auto text-xs opacity-50">{c.ms} ms</span>
            </div>
            <div className="mt-1 text-xs opacity-70">{c.detail}</div>
          </div>
        ))}
        {healthLoading && Object.keys(checks).length === 0 && (
          <div className="col-span-2 text-center text-xs opacity-50 py-4">Loading…</div>
        )}
      </section>

      <section className="space-y-2 rounded border p-3">
        <div className="flex items-center gap-2 text-sm font-medium"><KeyRound size={16} />Secrets (stored in the Windows Credential Manager; values are never shown)</div>
        {secrets.map((s) => (
          <div key={s.name} className="flex items-center gap-3 text-sm">
            <span className="font-mono text-xs">{s.name}</span>
            <span className="text-xs" style={{ color: s.set ? "#22c55e" : "#f59e0b" }}>{s.set ? "set" : "not set"}</span>
            <button className="ml-auto text-xs underline" onClick={() => setDraft({ name: s.name, value: "" })}>{s.set ? "replace" : "set"}</button>
            {s.set && <button className="text-xs underline" onClick={() => fetch(`${base}/secrets/${s.name}`, { method: "DELETE" }).then(() => fetch(`${base}/secrets`).then((r) => r.json()).then((d) => setSecrets(d.secrets ?? [])).catch(() => undefined))}>remove</button>}
          </div>
        ))}
        <div className="flex gap-2 pt-2">
          <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="NAME" className="w-56 rounded border bg-transparent px-2 py-1 font-mono text-xs" />
          <input type="password" value={draft.value} onChange={(e) => setDraft({ ...draft, value: e.target.value })} placeholder="value" className="flex-1 rounded border bg-transparent px-2 py-1 text-xs" />
          <button disabled={!draft.name || !draft.value} onClick={() => save(draft.name, draft.value)} className="rounded border px-3 py-1 text-xs disabled:opacity-40">Save</button>
        </div>
      </section>

      <section className="flex items-center gap-3 rounded border p-3">
        <DatabaseBackup size={16} /><span className="text-sm">Encrypted backup of the database and Redis</span>
        <button disabled={busy} onClick={backup} className="ml-auto rounded border px-3 py-1 text-sm disabled:opacity-40">Back up now</button>
      </section>
      <section className="space-y-2 rounded border p-3">
        <div className="flex items-center gap-2 text-sm font-medium">Logs
          <select value={logName} onChange={(e) => setLogName(e.target.value)} className="ml-auto rounded border bg-transparent px-2 py-0.5 text-xs">
            {["backend", "backend-out", "renderer", "launcher", "watchdog"].map((n) => <option key={n} value={n}>{n}</option>)}
          </select></div>
        <pre className="max-h-72 overflow-auto rounded bg-black/40 p-2 text-[11px] leading-snug">{logLines.length ? logLines.join(String.fromCharCode(10)) : "(empty)"}</pre>
      </section>
    </div>
  );
}