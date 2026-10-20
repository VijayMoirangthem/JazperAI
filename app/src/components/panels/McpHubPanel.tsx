"use client";

import { useCallback, useEffect, useState } from "react";
import { Plug } from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const base = `${API}/api/v1/mcp-hub`;

interface Connector { id: string; name: string; command: string[]; running: boolean }
interface Tool { name: string; connector: string; description: string; schema: { properties?: Record<string, { type?: string }>; required?: string[] }; action: string }
const tierOf = (a: string) => (a === "mcp.read" ? 1 : a === "mcp.write" ? 2 : 3);
const TIER_COLOR: Record<number, string> = { 1: "#16a34a", 2: "#d97706", 3: "#dc2626" };

/** Connected MCP servers and the tools they expose (agents reach them through find_tool/use_tool). Try a tool with JSON arguments. */
export function McpHubPanel() {
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [tools, setTools] = useState<Tool[]>([]);
  const [msg, setMsg] = useState("");
  const [sel, setSel] = useState<Tool | null>(null);
  const [args, setArgs] = useState("{}");
  const [out, setOut] = useState("");
  const [presets, setPresets] = useState<{ id: string; name: string; needs: string }[]>([]);
  useEffect(() => { fetch(base + "/presets").then((r) => r.json()).then((d) => setPresets(d.presets ?? [])).catch(() => undefined); }, []);
  const [draft, setDraft] = useState({ id: "", name: "", command: "" });

  const load = useCallback(async () => {
    try {
      setConnectors((await fetch(`${base}/connectors`).then((r) => r.json())).connectors ?? []);
      setTools((await fetch(`${base}/tools`).then((r) => r.json())).tools ?? []);
    } catch { setMsg("Backend unreachable"); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const call = async () => {
    if (!sel) return;
    setOut("running… (Tier 2/3 tools wait for approval in Chat)");
    try {
      const r = await fetch(`${base}/call`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: sel.name, arguments: JSON.parse(args), agent: "founder" }) });
      setOut(JSON.stringify(await r.json(), null, 2));
    } catch (e) { setOut(String(e)); }
  };
  const addConnector = async () => {
    const r = await fetch(`${base}/connectors`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: draft.id, name: draft.name || draft.id, command: draft.command.split(" ").filter(Boolean) }) });
    setMsg(r.ok ? "Connector saved" : (await r.json().catch(() => ({}))).detail ?? "failed");
    setDraft({ id: "", name: "", command: "" }); load();
  };

  return (
    <div className="flex h-full min-h-[560px]">
      <div className="w-96 space-y-3 overflow-y-auto border-r p-4">
        <div className="flex items-center gap-2"><Plug size={18} /><h2 className="font-semibold">Tool Hub</h2><span className="text-xs opacity-60">{msg}</span></div>
        {connectors.map((c) => (
          <div key={c.id} className="rounded border p-2 text-sm">
            <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full" style={{ background: c.running ? "#22c55e" : "#64748b" }} />{c.name}
              <button className="ml-auto text-xs underline" onClick={() => fetch(`${base}/connectors/${c.id}`, { method: "DELETE" }).then(load)}>remove</button></div>
            <div className="truncate font-mono text-[10px] opacity-50">{c.command.join(" ")}</div>
          </div>
        ))}
        <div className="space-y-1">
          <div className="text-xs uppercase opacity-60">One-click connectors</div>
          {presets.map((p) => (
            <button key={p.id} title={p.needs} className="block w-full rounded border p-2 text-left text-xs" onClick={() => fetch(`${base}/presets/${p.id}`, { method: "POST" }).then((r) => r.json()).then((d) => { setMsg(d.needs ? "Added. " + d.needs : "Added"); load(); })}>
              + {p.name}{p.needs ? <span className="block opacity-50">{p.needs}</span> : null}
            </button>
          ))}
          <button className="text-xs underline" onClick={() => fetch(`${base}/connectors/demo`, { method: "POST" }).then(load)}>+ built-in demo connector (for trying the hub)</button>
        </div>
        <div className="space-y-1 rounded border p-2">
          <div className="text-xs opacity-60">Add an MCP server (stdio command). Credentials go in System → Secrets, never here.</div>
          <input value={draft.id} onChange={(e) => setDraft({ ...draft, id: e.target.value })} placeholder="id (a-z, 0-9, -)" className="w-full rounded border bg-transparent px-2 py-1 text-xs" />
          <input value={draft.command} onChange={(e) => setDraft({ ...draft, command: e.target.value })} placeholder="command, e.g. npx -y @modelcontextprotocol/server-filesystem ." className="w-full rounded border bg-transparent px-2 py-1 font-mono text-xs" />
          <button disabled={!draft.id || !draft.command} onClick={addConnector} className="rounded border px-3 py-1 text-xs disabled:opacity-40">Add</button>
        </div>
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto p-4">
        {tools.length === 0 && <p className="text-sm opacity-60">No tools yet. Add the demo connector to try the hub.</p>}
        {tools.map((t) => (
          <button key={t.name} onClick={() => { setSel(t); setArgs(JSON.stringify(Object.fromEntries((t.schema.required ?? []).map((k) => [k, ""])), null, 2)); setOut(""); }}
            className="block w-full rounded border p-2 text-left text-sm" style={{ background: sel?.name === t.name ? "rgba(255,255,255,0.08)" : "transparent" }}>
            <div className="flex items-center gap-2"><span className="font-mono text-xs">{t.name}</span>
              <span className="rounded px-1.5 text-[10px]" style={{ background: TIER_COLOR[tierOf(t.action)], color: "#fff" }}>Tier {tierOf(t.action)}</span></div>
            <div className="text-xs opacity-70">{t.description}</div>
          </button>
        ))}
        {sel && (
          <div className="space-y-2 rounded border p-3">
            <div className="font-mono text-xs">{sel.name}</div>
            <textarea value={args} onChange={(e) => setArgs(e.target.value)} rows={5} className="w-full rounded border bg-transparent p-2 font-mono text-xs" />
            <button onClick={call} className="rounded border px-3 py-1 text-sm">Run</button>
            {out && <pre className="max-h-48 overflow-auto rounded bg-black/40 p-2 text-xs">{out}</pre>}
          </div>
        )}
      </div>
    </div>
  );
}
