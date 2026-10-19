"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Circle } from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface Check { ok: boolean; detail: string }

/** First-run checklist: services healthy, a model key saved, a test answer received, backups ready. Opens automatically on first launch. */
export function SetupPanel({ onNavigate }: { onNavigate?: (v: string) => void }) {
  const [checks, setChecks] = useState<Record<string, Check>>({});
  const [reply, setReply] = useState<{ ok: boolean; text: string } | null>(null);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => fetch(`${API}/api/v1/system/health`).then((r) => r.json()).then((d) => setChecks(d.checks)).catch(() => undefined), []);
  useEffect(() => { load(); const t = setInterval(load, 5000); return () => clearInterval(t); }, [load]);

  const saveKey = async () => {
    await fetch(`${API}/api/v1/system/secrets`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "ANTHROPIC_API_KEY", value: key }) });
    setKey(""); load();
  };
  const testChat = async () => {
    setBusy(true);
    try {
      const r = await fetch(`${API}/api/v1/llm/complete`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: "Reply with one short friendly sentence confirming you are working.", tier: "light", max_tokens: 40 }) });
      const d = await r.json();
      setReply({ ok: r.ok && d.usage?.provider !== "stub", text: r.ok ? `${d.usage?.provider}/${d.usage?.model}: ${d.text}` : JSON.stringify(d) });
    } catch { setReply({ ok: false, text: "Backend unreachable" }); }
    setBusy(false);
  };
  const done = () => { try { localStorage.setItem("jasper.setupDone", "1"); } catch { /* ignore */ } onNavigate?.("dashboard"); };

  const steps: { title: string; ok: boolean; body: React.ReactNode }[] = [
    { title: "Database and Redis are running", ok: !!checks.database?.ok && !!checks.redis?.ok, body: <span className="text-xs opacity-70">{checks.database?.detail ?? "checking…"} · redis {checks.redis?.detail ?? "…"}. If red, start Docker Desktop (Jazper.exe does this for you).</span> },
    { title: "An AI model is configured", ok: !!checks.llm?.ok, body: (
      <div className="space-y-1"><span className="text-xs opacity-70">{checks.llm?.detail}. Your Groq key from .env is already used. To add Claude, paste an Anthropic key (stored in the Windows Credential Manager):</span>
        <div className="flex gap-2"><input type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="ANTHROPIC_API_KEY" className="flex-1 rounded border bg-transparent px-2 py-1 text-xs" />
          <button disabled={!key} onClick={saveKey} className="rounded border px-3 py-1 text-xs disabled:opacity-40">Save</button>
          <button onClick={() => onNavigate?.("ai_providers")} className="rounded border px-3 py-1 text-xs">Other providers…</button></div></div>) },
    { title: "The model answers", ok: !!reply?.ok, body: (
      <div className="space-y-1"><button disabled={busy} onClick={testChat} className="rounded border px-3 py-1 text-xs disabled:opacity-40">Send a test message</button>
        {reply && <div className="text-xs" style={{ color: reply.ok ? "#4ade80" : "#f87171" }}>{reply.text}</div>}</div>) },
    { title: "Backups are ready", ok: !!checks.backup?.ok, body: <span className="text-xs opacity-70">{checks.backup?.detail ?? "checking…"}. Use System → “Back up now”.</span> },
  ];

  return (
    <div className="max-w-2xl space-y-4 p-6">
      <h2 className="text-lg font-semibold">Welcome to Jazper</h2>
      <p className="text-sm opacity-70">A quick check that everything is ready. You can reopen this any time from the sidebar (Setup).</p>
      {steps.map((s, i) => (
        <div key={i} className="flex gap-3 rounded border p-3">
          {s.ok ? <CheckCircle2 className="mt-0.5 shrink-0 text-green-500" size={18} /> : <Circle className="mt-0.5 shrink-0 opacity-40" size={18} />}
          <div className="space-y-1"><div className="text-sm font-medium">{s.title}</div>{s.body}</div>
        </div>
      ))}
      <div className="flex gap-2"><button onClick={() => onNavigate?.("team_chat")} className="rounded border px-3 py-1.5 text-sm">Open Team Chat</button>
        <button onClick={done} className="rounded bg-indigo-600 px-3 py-1.5 text-sm">Finish setup</button></div>
    </div>
  );
}
