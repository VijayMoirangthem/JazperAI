"use client";

import { useState } from "react";
import { useApi } from "@/lib/swr";
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

interface Workspace { id: number; org_group: string; path: string; label: string; mode: string }
const GROUPS = [["baeit", "Baeit"], ["boardmint", "Boardmint"], ["create_origins", "Create Origins"], ["jazper_team", "Jazper Team"]];

function Workspaces() {
  const [group, setGroup] = useState("baeit");
  const [mode, setMode] = useState("read-write");
  const [path, setPath] = useState("");
  const [browse, setBrowse] = useState<{ path: string; parent: string | null; dirs: string[] } | null>(null);
  const [err, setErr] = useState("");

  const { data, refresh, loading } = useApi<{ workspaces: Workspace[] }>(`${API}/api/v1/workspaces/`, { ttl: 10000, poll: 10000 });
  const list = data?.workspaces ?? [];

  const open = (p: string) => fetch(`${API}/api/v1/workspaces/browse?path=${encodeURIComponent(p)}`).then((r) => r.json()).then((d) => { if (d.dirs) setBrowse(d); });

  const add = async () => {
    setErr("");
    const r = await fetch(`${API}/api/v1/workspaces/`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ org_group: group, path, mode }) });
    if (!r.ok) { setErr((await r.json()).detail ?? "could not add"); return; }
    setPath(""); setBrowse(null); await refresh();
  };

  const remove = async (id: number) => {
    await fetch(`${API}/api/v1/workspaces/${id}`, { method: "DELETE" });
    await refresh();
  };

  return (
    <div className="mt-8" data-testid="workspaces">
      <h2 className="text-lg font-semibold">Workspaces</h2>
      <p className="mb-3 mt-1 text-sm opacity-60">Folders on this PC that a group&apos;s bots can read and (with approval) write. Jasper can read anywhere; secret files (.env, keys) are always blocked.</p>
      <div className="space-y-1.5">
        {list.map((w) => (
          <div key={w.id} className="flex items-center gap-3 rounded-xl bg-white/5 px-3 py-2 text-sm">
            <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs">{GROUPS.find((g) => g[0] === w.org_group)?.[1] ?? w.org_group}</span>
            <span className="min-w-0 flex-1 truncate font-mono text-xs">{w.path}</span>
            <span className="text-xs opacity-60">{w.mode}</span>
            <button aria-label={`Remove ${w.path}`} onClick={() => void remove(w.id)} className="text-xs opacity-60 hover:opacity-100">Remove</button>
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
        <select value={group} onChange={(e) => setGroup(e.target.value)} aria-label="Group" className="rounded-lg bg-white/10 px-2 py-1.5">{GROUPS.map(([id, l]) => <option key={id} value={id} className="bg-[#1b1b1b]">{l}</option>)}</select>
        <input value={path} onChange={(e) => setPath(e.target.value)} placeholder="D:\\Projects\\my-folder" aria-label="Folder path" className="min-w-[260px] flex-1 rounded-lg bg-white/10 px-2 py-1.5 font-mono text-xs outline-none" />
        <button onClick={() => void open(path || "")} className="rounded-full bg-white/10 px-3 py-1.5 text-xs">Browse…</button>
        <select value={mode} onChange={(e) => setMode(e.target.value)} aria-label="Mode" className="rounded-lg bg-white/10 px-2 py-1.5 text-xs"><option value="read-write" className="bg-[#1b1b1b]">read + write (approval)</option><option value="read" className="bg-[#1b1b1b]">read only</option></select>
        <button onClick={() => void add()} disabled={!path} className="rounded-full bg-blue-600 px-4 py-1.5 text-xs disabled:opacity-40">Add folder</button>
      </div>
      {err && <div className="mt-1 text-xs text-red-400">{err}</div>}
      {browse && (
        <div className="mt-2 max-h-56 overflow-y-auto rounded-xl border border-white/10 bg-black/30 p-2 text-xs" data-testid="folder-browser">
          <div className="mb-1 flex items-center gap-2 opacity-70"><span className="font-mono">{browse.path || "This PC"}</span>{browse.parent !== null && <button onClick={() => void open(browse.parent ?? "")} className="underline">up</button>}<button onClick={() => { if (browse.path) setPath(browse.path); }} className="ml-auto rounded-full bg-white/10 px-2 py-0.5">Use this folder</button></div>
          {browse.dirs.map((d) => <button key={d} onClick={() => void open(d)} className="block w-full truncate rounded px-2 py-0.5 text-left hover:bg-white/10">{d}</button>)}
        </div>
      )}
    </div>
  );
}

interface Device { id: string; name: string; platform: string; revoked: boolean; created_at: string; last_seen?: string | null }

function Phones() {
  const { data, refresh } = useApi<{ devices: Device[] }>(`${API}/api/v1/remote/devices`, { ttl: 10000, poll: 15000 });
  const [pair, setPair] = useState<{ code: string; expires_s: number; url: string } | null>(null);
  const [left, setLeft] = useState(0);
  const start = async () => {
    const d = await fetch(`${API}/api/v1/remote/pair/start`, { method: "POST" }).then((r) => r.json());
    setPair(d); setLeft(d.expires_s);
    const t = setInterval(() => setLeft((s) => { if (s <= 1) { clearInterval(t); setPair(null); return 0; } return s - 1; }), 1000);
  };
  const revoke = async (id: string) => { await fetch(`${API}/api/v1/remote/devices/${id}`, { method: "DELETE" }); await refresh(); };
  return (
    <div className="mt-8" data-testid="phones">
      <h2 className="text-lg font-semibold">Phones</h2>
      <p className="mb-3 mt-1 text-sm opacity-60">Pair the Jasper phone app. A paired phone can chat, approve and see activity, but never reaches files, secrets or connectors. Setup: docs/ops/remote_access.md.</p>
      <div className="space-y-1.5">
        {(data?.devices ?? []).map((d) => (
          <div key={d.id} className="flex items-center gap-3 rounded-xl bg-white/5 px-3 py-2 text-sm" style={{ opacity: d.revoked ? 0.5 : 1 }}>
            <span className="font-medium">{d.name}</span><span className="text-xs opacity-60">{d.platform}</span>
            <span className="ml-auto text-xs opacity-60">{d.revoked ? "revoked" : d.last_seen ? `last seen ${new Date(d.last_seen).toLocaleString()}` : "never connected"}</span>
            {!d.revoked && <button onClick={() => void revoke(d.id)} aria-label={`Revoke ${d.name}`} className="rounded-full bg-white/10 px-3 py-0.5 text-xs">Revoke</button>}
          </div>
        ))}
        {(data?.devices ?? []).length === 0 && <div className="text-sm opacity-50">No phones paired yet.</div>}
      </div>
      <div className="mt-3 flex items-center gap-3">
        <button onClick={() => void start()} data-testid="pair-start" className="rounded-full bg-blue-600 px-4 py-1.5 text-sm">Pair a new phone</button>
        {pair && <div data-testid="pair-code" className="rounded-xl bg-white/10 px-4 py-2 text-sm"><span className="font-mono text-lg tracking-widest">{pair.code}</span><span className="ml-3 opacity-60">expires in {left}s{pair.url ? ` · server ${pair.url}` : " · set the tunnel URL first"}</span></div>}
      </div>
    </div>
  );
}

export function ConnectionsPanel() {
  const [busy, setBusy] = useState("");
  const [open, setOpen] = useState("");

  const { data, refresh, loading } = useApi<{ connections: Conn[] }>(`${API}/api/v1/connections/`, { ttl: 5000, poll: 5000 });
  const conns = data?.connections ?? [];

  const act = async (id: string, verb: "connect" | "test" | "disconnect") => {
    setBusy(id + verb);
    try { await fetch(`${API}/api/v1/connections/${id}${verb === "disconnect" ? "" : "/" + verb}`, { method: verb === "disconnect" ? "DELETE" : "POST" }); } finally { setBusy(""); await refresh(); }
  };

  return (
    <div className="h-full overflow-y-auto p-6" data-testid="connections-panel">
      <h1 className="text-xl font-semibold">Connections</h1>
      <p className="mb-4 mt-1 text-sm opacity-60">Say “connect Gmail” in Chat and Jasper will do this for you. Reads are Tier 1 (automatic), writes Tier 2 (notify, 5 s veto), destructive actions Tier 3 (you approve).</p>
      {loading && <div className="text-xs opacity-50 mb-4">Loading…</div>}
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
              {open === c.id && c.missing.length > 0 && <CredentialCard req={{ kind: "credentials", connector: c.id, secrets: c.secrets.filter((s) => c.missing.includes(s.name)) }} onDone={() => { setOpen(""); void refresh(); }} />}
              {open === c.id && c.oauth && !c.oauth.connected && c.missing.length === 0 && <OAuthCard req={{ kind: "oauth", connector: c.id, url: c.oauth.authorize_url }} onDone={() => { setOpen(""); void refresh(); }} />}
            </div>
          );
        })}
      </div>
      <Workspaces />
      <Phones />
    </div>
  );
}