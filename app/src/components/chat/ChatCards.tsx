"use client";

// Cards shown inside the chat when a bot needs the founder: credentials (goes straight to the OS vault, never into chat history)
// and Google sign-in (opens in the system browser; Electron's window-open handler does the hand-off, the backend receives the loopback callback).
// Pattern: Project_References/OpenMausBot connected-apps cards.
import { useEffect, useRef, useState } from "react";
import { Check, ExternalLink, KeyRound, Loader2 } from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
export interface UiRequest { kind: "credentials" | "oauth"; connector: string; secrets?: { name: string; label: string }[]; url?: string; provider?: string; done?: boolean }

export function CredentialCard({ req, onDone }: { req: UiRequest; onDone: (summary: string) => void }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [state, setState] = useState<"idle" | "saving" | "done" | "error">(req.done ? "done" : "idle");
  const [msg, setMsg] = useState("");
  const save = async () => {
    setState("saving");
    try {
      for (const s of req.secrets ?? []) {
        if (!values[s.name]) continue;
        const r = await fetch(`${API}/api/v1/connections/${req.connector}/secrets`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: s.name, value: values[s.name] }) });
        if (!r.ok) throw new Error("could not store " + s.name);
      }
      setValues({}); // drop the secret from component state immediately
      const t = await fetch(`${API}/api/v1/connections/${req.connector}/connect`, { method: "POST" }).then((r) => r.json());
      setState("done"); setMsg(t.connected ? `Connected — ${t.detail}` : t.detail || "Saved. Not verified yet.");
      onDone(`I saved the credentials for ${req.connector}. Status: ${t.connected ? "connected" : t.detail || "unverified"}. Please continue.`);
    } catch (e) { setState("error"); setMsg(String((e as Error).message)); }
  };
  return (
    <div role="group" aria-label="Credentials request" data-testid="credential-card" className="w-full max-w-[520px] space-y-2 rounded-3xl bg-white/5 px-4 py-3 ring-1 ring-amber-400/40">
      <div className="flex items-center gap-2 text-sm font-semibold"><KeyRound size={15} className="text-amber-400" />Connect {req.connector}</div>
      <div className="text-xs opacity-60">Stored in your Windows credential vault. It is never sent through the chat or written to logs.</div>
      {state !== "done" && (req.secrets ?? []).map((s) => (
        <label key={s.name} className="block text-xs">
          <span className="opacity-70">{s.label}</span>
          <input type="password" autoComplete="off" aria-label={s.label} value={values[s.name] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [s.name]: e.target.value }))}
            className="mt-0.5 w-full rounded-lg bg-white/10 px-2 py-1.5 text-sm outline-none" />
        </label>
      ))}
      {state === "done" ? <div className="flex items-center gap-1 text-sm text-green-400"><Check size={14} />{msg || "Saved"}</div> : (
        <button onClick={() => void save()} disabled={state === "saving" || !(req.secrets ?? []).some((s) => values[s.name])} className="rounded-full bg-blue-600 px-4 py-1.5 text-sm disabled:opacity-40">
          {state === "saving" ? <Loader2 size={14} className="animate-spin" /> : "Save & connect"}
        </button>
      )}
      {state === "error" && <div className="text-xs text-red-400">{msg}</div>}
    </div>
  );
}

export function OAuthCard({ req, onDone }: { req: UiRequest; onDone: (summary: string) => void }) {
  const [state, setState] = useState<"idle" | "waiting" | "done">(req.done ? "done" : "idle");
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => () => { if (timer.current) clearInterval(timer.current); }, []);
  const start = () => {
    window.open(req.url, "_blank"); // system browser (Electron setWindowOpenHandler -> shell.openExternal)
    setState("waiting");
    let tries = 0;
    timer.current = setInterval(async () => {
      tries += 1;
      try {
        const s = await fetch(`${API}/api/google/oauth/status`).then((r) => r.json());
        if ((s.connected ?? []).length > 0) {
          if (timer.current) clearInterval(timer.current);
          const t = await fetch(`${API}/api/v1/connections/${req.connector}/connect`, { method: "POST" }).then((r) => r.json());
          setState("done");
          onDone(`I signed in to Google. Connection status: ${t.connected ? "connected" : t.detail || "unverified"}. Please continue.`);
        }
      } catch { /* backend busy: keep polling */ }
      if (tries > 90 && timer.current) { clearInterval(timer.current); setState("idle"); }
    }, 2000);
  };
  return (
    <div role="group" aria-label="Sign-in request" data-testid="oauth-card" className="w-full max-w-[520px] space-y-2 rounded-3xl bg-white/5 px-4 py-3 ring-1 ring-amber-400/40">
      <div className="flex items-center gap-2 text-sm font-semibold"><ExternalLink size={15} className="text-amber-400" />Sign in with Google</div>
      <div className="text-xs opacity-60">Opens Google in your browser. You approve read access to Gmail and Calendar; the token is stored by the backend, not in chat.</div>
      {state === "done" ? <div className="flex items-center gap-1 text-sm text-green-400"><Check size={14} />Signed in</div> : (
        <button onClick={start} disabled={state === "waiting"} className="rounded-full bg-blue-600 px-4 py-1.5 text-sm disabled:opacity-60">
          {state === "waiting" ? <span className="inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" />Waiting for sign-in…</span> : "Sign in with Google"}
        </button>
      )}
    </div>
  );
}
