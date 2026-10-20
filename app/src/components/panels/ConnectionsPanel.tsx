"use client";

// Connections: one card per connector with status, what it needs, scopes -> approval tiers, Connect / Test / Disconnect.
// Secrets are entered in a password field and go to the OS vault only. Pattern: Project_References/OpenMausBot connected-apps cards.
import { useEffect, useState } from "react";
import { CredentialCard, OAuthCard } from "@/components/chat/ChatCards";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
interface Conn {
  id: string; name: string; needs: string; secrets: { name: string; label: string }[]; missing: string[]; ready: boolean; connected: boolean; detail: string; tools: number;
  untested: boolean; last_test?: number; oauth?: { connected: boolean; accounts: string[]; authorize_url: string } | null; tiers: Record<string, number>;
}

function badge(c: Conn) {
  if (c.connected) return { t: "Connected", color: "#22c55e" };
  if (c.missing.length) return { t: "Needs credentials", color: "#f59e0b" };
  if (c.oauth && !c.oauth.connected) return { t: "Needs sign-in", color: "#f59e0b" };
  return { t: c.detail.startsWith("test failed") ? "Failed" : "Not tested", color: c.detail.startsWith("test failed") ? "#ef4444" : "#94a3b8" };
}

export function ConnectionsPanel() {
  const [conns, setConns] = useState<Conn[]>([]);
  const [busy, setBusy] = useState("");
  const [open, setOpen] = useState("");
  const load = () => fetch(`${API}/api/v1/connections/`).then((r) => r.json()).then((d) => setConns(d.connections ?? [])).catch(() => undefined);
  useEffect(() => { void load(); }, []);
  const act = async (id: string, verb: "connect" | "test" | "disconnect") => {
    setBusy(id + verb);
    try { await fetch(`${API}/api/v1/connections/${id}${verb === "disconnect" ? "" : "/" + verb}`, { method: verb === "disconnect" ? "DELETE" : "POST" }); } finally { setBusy(""); await load(); }
  };
  return (
    <div className="h-full overflow-y-auto p-6" data-testid="connections-panel">
      <h1 className="text-xl font-semibold">Connections</h1>
      <p className="mb-4 mt-1 text-sm opacity-60">Say “connect Gmail” in Chat and Jasper will do this for you. Reads are Tier 1 (automatic), writes Tier 2 (notify, 5 s veto), destructive actions Tier 3 (you approve).</p>
      <div className="grid gap-3 md:grid-cols-2">
        {conns.map((c) => {
          const b = badge(c);
          return (
            <div key={c.id} data-testid={"conn-" + c.id} className="space-y-2 rounded-2xl border border-white/10 bg-white/5 p-4">
              <div className="flex items-center gap-2">
                <span className="font-semibold">{c.name}</span>
                {c.untested && <span className="rounded-full border border-white/15 px-1.5 text-[10px] opacity-60">untested</span>}
                <span className="ml-auto rounded-full px-2 py-0.5 text-xs font-semibold" style={{ background: b.color + "22", color: b.color }}>{b.t}</span>
              </div>
              <div className="text-xs opacity-60">{c.needs || "No credentials needed."}{c.oauth?.accounts?.length ? ` Signed in as ${c.oauth.accounts.join(", ")}.` : ""}</div>
              {c.detail && <div className="text-xs opacity-80">{c.detail}</div>}
              <div className="flex flex-wrap gap-2 text-xs">
                <span className="rounded-full bg-white/10 px-2 py-0.5">read → Tier {c.tiers.read}</span>
                <span className="rounded-full bg-white/10 px-2 py-0.5">write → Tier {c.tiers.write}</span>
                <span className="rounded-full bg-white/10 px-2 py-0.5">admin → Tier {c.tiers.admin}</span>
                {c.tools > 0 && <span className="rounded-full bg-white/10 px-2 py-0.5">{c.tools} tools</span>}
              </div>
              <div className="flex gap-2">
                <button onClick={() => (c.missing.length || (c.oauth && !c.oauth.connected) ? setOpen(open === c.id ? "" : c.id) : void act(c.id, "connect"))} disabled={!!busy} className="rounded-full bg-blue-600 px-3 py-1 text-xs disabled:opacity-50">{busy === c.id + "connect" ? "Connecting…" : c.connected ? "Reconnect" : "Connect"}</button>
                <button onClick={() => void act(c.id, "test")} disabled={!!busy || !c.ready} className="rounded-full bg-white/10 px-3 py-1 text-xs disabled:opacity-40">{busy === c.id + "test" ? "Testing…" : "Test"}</button>
                <button onClick={() => void act(c.id, "disconnect")} disabled={!!busy} className="rounded-full bg-white/10 px-3 py-1 text-xs">Disconnect</button>
              </div>
              {open === c.id && c.missing.length > 0 && <CredentialCard req={{ kind: "credentials", connector: c.id, secrets: c.secrets.filter((s) => c.missing.includes(s.name)) }} onDone={() => { setOpen(""); void load(); }} />}
              {open === c.id && c.oauth && !c.oauth.connected && c.missing.length === 0 && <OAuthCard req={{ kind: "oauth", connector: c.id, url: c.oauth.authorize_url }} onDone={() => { setOpen(""); void load(); }} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}
