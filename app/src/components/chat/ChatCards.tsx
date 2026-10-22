"use client";

// Cards shown inside the chat when a bot needs the founder: credentials (goes straight to the OS vault, never into chat history)
// and Google sign-in (opens in the system browser; Electron's window-open handler does the hand-off, the backend receives the loopback callback).
// Pattern: Project_References/OpenMausBot connected-apps cards.
import { useEffect, useRef, useState } from "react";
import { Check, ExternalLink, FileText, KeyRound, Loader2, Trash2, Undo2 } from "lucide-react";
import { useChat, type ChatMessage } from "@/chat/chatStore";
import { useFileViewer } from "@/stores/fileViewerStore";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
export interface Suggestion { id: string; name: string; why: string; status: string; connectable: boolean; untested?: boolean }
export interface UiRequest { kind: "credentials" | "oauth" | "suggestions" | "confirm" | "file"; file_id?: string; name?: string; mime?: string; open?: boolean; action?: string; scope?: string; label?: string; items?: Suggestion[]; connector: string; secrets?: { name: string; label: string }[]; url?: string; provider?: string; done?: boolean; capability?: string; reason?: string }

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
        // a permission upgrade (capability set) is only done when Google reports that capability as granted; a first sign-in when any account exists
        const s = req.capability
          ? await fetch(`${API}/api/google/capabilities`).then((r) => r.json())
          : await fetch(`${API}/api/google/oauth/status`).then((r) => r.json());
        const ok = req.capability ? !!s.capabilities?.[req.capability] : (s.connected ?? []).length > 0;
        if (ok) {
          if (timer.current) clearInterval(timer.current);
          const t = await fetch(`${API}/api/v1/connections/${req.capability ?? req.connector}/connect`, { method: "POST" }).then((r) => r.json());
          setState("done");
          onDone(`I approved Google${req.capability ? ` (${req.capability})` : ""}. Status: ${t.verified ? "verified" : t.connected ? "connected" : t.detail || "unverified"}. Continue with my original request now.`);
        }
      } catch { /* backend busy: keep polling */ }
      if (tries > 90 && timer.current) { clearInterval(timer.current); setState("idle"); }
    }, 2000);
  };
  return (
    <div role="group" aria-label="Sign-in request" data-testid="oauth-card" className="w-full max-w-[520px] space-y-2 rounded-3xl bg-white/5 px-4 py-3 ring-1 ring-amber-400/40">
      <div className="flex items-center gap-2 text-sm font-semibold"><ExternalLink size={15} className="text-amber-400" />Sign in with Google</div>
      <div className="text-xs opacity-60">{req.reason ?? "Opens Google in your browser."} One click to approve; the token is stored by the backend, not in chat.</div>
      {state === "done" ? <div className="flex items-center gap-1 text-sm text-green-400"><Check size={14} />Signed in</div> : (
        <button onClick={start} disabled={state === "waiting"} className="rounded-full bg-blue-600 px-4 py-1.5 text-sm disabled:opacity-60">
          {state === "waiting" ? <span className="inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" />Waiting for sign-in…</span> : (req.capability ? "Approve in Google" : "Sign in with Google")}
        </button>
      )}
    </div>
  );
}

const STATUS_COLOR: Record<string, string> = { connected: "#22c55e", "ready to connect": "#60a5fa", "needs credentials": "#f59e0b", "needs sign-in": "#f59e0b", planned: "#94a3b8" };

/** One-click connector suggestions: each connectable item has a Connect button that runs the same flow Jasper would
 *  (vault/.env check, then an inline credentials or Google sign-in card if something is needed). */
export function SuggestionCard({ items, onDone }: { items: Suggestion[]; onDone: (summary: string) => void }) {
  const [state, setState] = useState<Record<string, { status?: string; busy?: boolean; req?: UiRequest; detail?: string }>>({});
  const connect = async (id: string) => {
    setState((s) => ({ ...s, [id]: { ...s[id], busy: true } }));
    try {
      const t = await fetch(`${API}/api/v1/connections/${id}/connect`, { method: "POST" }).then((r) => r.json());
      if (t.request) setState((s) => ({ ...s, [id]: { req: t.request as UiRequest } }));
      else {
        setState((s) => ({ ...s, [id]: { status: t.connected ? "connected" : "ready to connect", detail: t.detail } }));
        if (t.connected) onDone(`${id} is now connected (${t.detail}).`);
      }
    } catch { setState((s) => ({ ...s, [id]: { detail: "could not reach the backend" } })); }
  };
  return (
    <div role="group" aria-label="Connector suggestions" data-testid="suggestion-card" className="w-full max-w-[640px] space-y-2 rounded-3xl bg-white/5 px-4 py-3 ring-1 ring-blue-400/30">
      <div className="text-sm font-semibold">Connect more tools</div>
      {items.map((it) => {
        const st = state[it.id]; const status = st?.status ?? it.status;
        return (
          <div key={it.id} className="space-y-1.5 rounded-2xl bg-white/5 p-2.5" data-testid={"sug-" + it.id}>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium">{it.name}</span>
              {it.untested && <span className="rounded-full border border-white/15 px-1.5 text-[10px] opacity-60">untested</span>}
              <span className="ml-auto rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: (STATUS_COLOR[status] ?? "#94a3b8") + "22", color: STATUS_COLOR[status] ?? "#94a3b8" }}>{status}</span>
              {it.connectable && status !== "connected" && <button onClick={() => void connect(it.id)} disabled={st?.busy} className="rounded-full bg-blue-600 px-3 py-1 text-xs disabled:opacity-50">{st?.busy ? "Connecting…" : "Connect"}</button>}
            </div>
            <div className="text-xs opacity-65">{it.why}</div>
            {st?.detail && <div className="text-xs opacity-70">{st.detail}</div>}
            {st?.req?.kind === "credentials" && <CredentialCard req={st.req} onDone={(t) => { setState((s) => ({ ...s, [it.id]: { status: "connected" } })); onDone(t); }} />}
            {st?.req?.kind === "oauth" && <OAuthCard req={st.req} onDone={(t) => { setState((s) => ({ ...s, [it.id]: { status: "connected" } })); onDone(t); }} />}
          </div>
        );
      })}
    </div>
  );
}

/** One-tap confirm for destructive actions Jazper proposes (clear chat). Runs locally, shows what was removed and offers Undo. */
export function ConfirmActionCard({ req, messageId }: { req: UiRequest; messageId: string }) {
  const [state, setState] = useState<"ask" | "done" | "undone" | "cancelled">("ask");
  const removed = useRef<{ ch: string; msgs: ChatMessage[] } | null>(null);
  const run = () => {
    const st = useChat.getState();
    const ch = Object.keys(st.threads).find((c) => st.threads[c].some((m) => m.id === messageId));
    if (!ch) return;
    const list = st.threads[ch], at = list.findIndex((m) => m.id === messageId);
    const days = req.scope?.startsWith("older_than_days:") ? Number(req.scope.split(":")[1]) : 0;
    const cut = days > 0 ? Date.now() - days * 86_400_000 : 0;
    const drop = (m: ChatMessage, i: number) => (req.scope === "all" ? m.id !== messageId : days > 0 ? m.ts < cut && m.id !== messageId : i < at);
    const msgs = list.filter(drop);
    removed.current = { ch, msgs };
    useChat.setState((s) => ({ threads: { ...s.threads, [ch]: list.filter((m, i) => !drop(m, i)) } }));
    setState("done");
  };
  const undo = () => {
    const r = removed.current;
    if (!r) return;
    useChat.setState((s) => ({ threads: { ...s.threads, [r.ch]: [...r.msgs, ...(s.threads[r.ch] ?? [])].sort((a, b) => a.ts - b.ts) } }));
    setState("undone");
  };
  return (
    <div role="group" aria-label="Confirm" data-testid="confirm-card" className="flex max-w-[520px] items-center gap-3 rounded-3xl bg-white/5 px-4 py-3 ring-1 ring-red-400/40">
      {state === "ask" && <>
        <Trash2 size={16} className="text-red-400" /><span className="text-sm">{req.label ?? "Are you sure?"}</span>
        <button onClick={run} className="rounded-full bg-red-600 px-4 py-1.5 text-sm" data-testid="confirm-yes">Delete</button>
        <button onClick={() => setState("cancelled")} className="rounded-full border border-white/20 px-3 py-1.5 text-sm">Keep</button>
      </>}
      {state === "done" && <><Check size={14} className="text-green-400" /><span className="text-sm">Deleted {removed.current?.msgs.length ?? 0} messages.</span>
        <button onClick={undo} className="flex items-center gap-1 rounded-full border border-white/20 px-3 py-1 text-sm"><Undo2 size={13} />Undo</button></>}
      {state === "undone" && <span className="text-sm opacity-70">Restored.</span>}
      {state === "cancelled" && <span className="text-sm opacity-70">Kept.</span>}
    </div>
  );
}

/** A Drive file Jazper opened: shows a button and (for a fresh message) opens the in-app viewer tab by itself. */
export function FileCard({ req, fresh }: { req: UiRequest; fresh: boolean }) {
  const opened = useRef(false);
  const open = () => { useFileViewer.getState().open({ id: req.file_id ?? "", name: req.name ?? "file", mime: req.mime ?? "" }); window.location.hash = "files"; };
  useEffect(() => { if (req.open && fresh && !opened.current) { opened.current = true; open(); } }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <button onClick={open} data-testid="file-card" className="flex max-w-[520px] items-center gap-3 rounded-3xl bg-white/5 px-4 py-3 text-left ring-1 ring-white/15 hover:bg-white/10">
      <FileText size={18} className="shrink-0 opacity-70" /><span className="min-w-0 flex-1 truncate text-sm">{req.name}</span><span className="rounded-full bg-blue-600 px-3 py-1 text-xs">Open</span>
    </button>
  );
}
