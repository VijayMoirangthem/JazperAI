"use client";

import { useEffect, useMemo, useState } from "react";
import { useApi } from "@/lib/swr";
import { Background, Controls, ReactFlow, type Edge, type Node } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { Building2, Send } from "lucide-react";
import { useLiveAgents } from "@/stores/liveAgentsStore";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const WS_URL = API.replace(/^http/, "ws") + "/ws/rpc";
const COLOR: Record<string, string> = { idle: "#475569", working: "#16a34a", planning: "#0284c7", testing: "#9333ea", error: "#dc2626", waiting_human: "#d97706" };

interface Structure {
  executives: { slug: string; title: string; crews: string[] }[];
  crews: Record<string, { name: string; reports_to: string; members: { slug: string; title: string }[] }>;
}
interface Report { executive: string; title: string; status: string; summary: string; crew: Record<string, string>; trace: { trace_id: string; exec_span: string; member_spans: { agent: string; span_id: string; status: string }[] } }

/** Live org chart (Jasper → executives → crews → bots) coloured by agent state, plus a directive box that returns the executive's report. */
export function CompanyPanel() {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [err, setErr] = useState("");
  const live = useLiveAgents((x) => x.agents);
  const connect = useLiveAgents((x) => x.connect);
  useEffect(() => connect(WS_URL), [connect]);

  const { data: structure, loading } = useApi<Structure>(`${API}/api/v1/company/structure`, { ttl: 30000, poll: 30000 });
  const s = structure;

  const { nodes, edges } = useMemo(() => {
    const nodes: Node[] = [], edges: Edge[] = [];
    if (!s) return { nodes, edges };
    const st = (slug: string) => live[slug]?.state ?? "idle";
    const rank = ["error", "working", "testing", "planning", "waiting_human", "idle"];
    const agg = (slugs: string[]) => rank.find((r) => slugs.some((x) => st(x) === r)) ?? "idle";
    const style = (state: string, w: number) => ({ background: COLOR[state] ?? COLOR.idle, color: "#fff", border: "1px solid rgba(255,255,255,.25)", borderRadius: 10, fontSize: 11, width: w, padding: 8, textAlign: "left" as const });
    const W = 230, mainExecs = s.executives.slice(0, 4), stubs = s.executives.slice(4);
    nodes.push({ id: "jasper", position: { x: (mainExecs.length * W) / 2 - 95, y: 0 }, draggable: false, data: { label: "Sir Jasper · L1 orchestrator" }, style: { ...style(st("jasper"), 190), textAlign: "center" } });
    mainExecs.forEach((e, i) => {
      nodes.push({ id: e.slug, position: { x: i * W, y: 110 }, draggable: false, data: { label: e.title }, style: style(st(e.slug), 200) });
      edges.push({ id: "j-" + e.slug, source: "jasper", target: e.slug });
    });
    const placed: Record<string, number> = {};
    Object.entries(s.crews).forEach(([k, c]) => {
      const boss = c.reports_to === "jasper" ? "jasper" : c.reports_to;
      const col = c.reports_to === "jasper" ? mainExecs.length : Math.max(0, mainExecs.findIndex((e) => e.slug === boss));
      const row = (placed[boss] = (placed[boss] ?? 0) + 1);
      const y = c.reports_to === "jasper" ? 110 : 110 + 100 + (row - 1) * 140;
      nodes.push({
        id: "crew-" + k, position: { x: col * W, y }, draggable: false,
        data: { label: (<div><div style={{ fontWeight: 600, marginBottom: 3 }}>{c.name}</div>{c.members.map((m) => <div key={m.slug} style={{ opacity: 0.9 }}>• {m.title}</div>)}</div>) },
        style: style(agg(c.members.map((m) => m.slug)), 200),
      });
      edges.push({ id: "e-" + k, source: boss === "jasper" ? "jasper" : boss, target: "crew-" + k });
    });
    stubs.forEach((e, i) => {
      nodes.push({ id: e.slug, position: { x: i * W, y: 640 }, draggable: false, data: { label: e.title + " (stub)" }, style: { ...style(st(e.slug), 200), opacity: 0.6 } });
      edges.push({ id: "c-" + e.slug, source: "ceo-create-origins", target: e.slug, style: { strokeDasharray: "4 3" } });
    });
    return { nodes, edges };
  }, [s, live]);

  const send = async () => {
    if (!text.trim()) return;
    setBusy(true); setErr(""); setReport(null);
    try {
      const r = await fetch(`${API}/api/v1/company/directive`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail ?? r.statusText);
      setReport(await r.json());
    } catch (e) { setErr(String(e)); } finally { setBusy(false); }
  };

  return (
    <div className="flex h-full min-h-[640px] flex-col">
      <div className="flex items-center gap-2 border-b p-3">
        <Building2 size={18} />
        <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} placeholder="Give Sir Jasper a directive, e.g. “Plan merchant onboarding for Baeit”" className="flex-1 rounded border bg-transparent px-3 py-1.5 text-sm" />
        <button disabled={busy} onClick={send} className="rounded border p-2 disabled:opacity-40"><Send size={16} /></button>
        {err && <span className="text-xs text-red-400">{err}</span>}
      </div>
      {loading && !s && <div className="text-xs opacity-50 px-3 py-2">Loading org structure…</div>}
      <div className="flex min-h-0 flex-1">
        <div className="flex-1"><ReactFlow nodes={nodes} edges={edges} fitView nodesDraggable={false} proOptions={{ hideAttribution: true }}><Background /><Controls showInteractive={false} /></ReactFlow></div>
        {(report || busy) && (
          <aside className="w-96 space-y-2 overflow-y-auto border-l p-3 text-sm">
            {busy && <div className="opacity-70">The executive is working with the crew…</div>}
            {report && (<>
              <div className="font-semibold">{report.title} <span className="text-xs opacity-60">· {report.status}</span></div>
              <div className="whitespace-pre-wrap">{report.summary}</div>
              <div className="pt-2 text-xs uppercase opacity-50">Crew input</div>
              {Object.entries(report.crew).map(([k, v]) => <div key={k} className="rounded bg-white/5 p-2"><div className="font-mono text-[10px] opacity-60">{k}</div><div className="whitespace-pre-wrap text-xs">{v}</div></div>)}
              <div className="pt-2 font-mono text-[10px] opacity-50">trace {report.trace.trace_id.slice(0, 12)} · {report.trace.member_spans.length} spans</div>
            </>)}
          </aside>
        )}
      </div>
    </div>
  );
}