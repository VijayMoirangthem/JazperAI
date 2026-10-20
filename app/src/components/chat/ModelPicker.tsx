"use client";

// Header pill: shows which model the active bot uses and lets you pick any available model (or Automatic) in one click.
import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Cpu } from "lucide-react";
import { useApi } from "@/lib/swr";
import type { OrgBot } from "./OrgSidebar";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
interface Prov { slug: string; name: string; enabled: boolean; has_key: boolean; local?: boolean; kind?: string; models: { model_id: string; enabled: boolean }[] }

const NOTE: Record<string, string> = { "opencode-cli": "free, chat only, slower (~10-20 s)", opencode: "needs OpenCode account credit" };

export function ModelPicker({ bot, onChanged }: { bot: OrgBot; onChanged: () => void }) {
  const { data } = useApi<{ providers: Prov[] }>(`${API}/api/v1/llm/providers`, { ttl: 60_000, poll: false });
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const down = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", down);
    return () => document.removeEventListener("mousedown", down);
  }, []);
  const cur = bot.settings?.model ?? "";
  const choose = async (model: string) => {
    setBusy(true);
    const s = bot.settings ?? {};
    await fetch(`${API}/api/v1/bots/${bot.slug}/settings`, { method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: model || null, tier: s.tier ?? null, temperature: s.temperature ?? null, max_tokens: s.max_tokens ?? null, memory: s.memory ?? null }) });
    setBusy(false); setOpen(false); onChanged();
  };
  const provs = (data?.providers ?? []).filter((p) => p.enabled && (p.has_key || p.local || p.kind === "cli"));
  const label = cur ? cur.split(":").slice(1).join(":").split("/").pop() : "Auto";
  const hasTools = bot.tools && bot.tools.length > 0;
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((v) => !v)} data-testid="model-pill" title={cur ? `Pinned: ${cur}` : "Automatic: follows tier routing with failover"} disabled={busy}
        className="flex items-center gap-1.5 rounded-full border border-white/10 px-3 py-1 text-xs opacity-90 hover:bg-white/10">
        <Cpu size={12} />{label}<ChevronDown size={12} />
      </button>
      {open && (
        <div data-testid="model-menu" className="absolute right-0 top-9 z-30 max-h-[60vh] w-72 overflow-y-auto rounded-xl border border-white/10 bg-[#1b1b1b] p-1.5 text-sm shadow-xl">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search models" aria-label="Search models" className="mb-1 w-full rounded-lg bg-white/10 px-2 py-1 text-xs outline-none" />
          <button onClick={() => void choose("")} className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 hover:bg-white/10">Automatic (tier routing){!cur && <Check size={13} />}</button>
          {provs.map((p) => {
            const ms = p.models.filter((m) => m.enabled && (!q || m.model_id.toLowerCase().includes(q.toLowerCase())));
            if (!ms.length) return null;
            return (
              <div key={p.slug}>
                <div className="px-2 pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-wider opacity-50">{p.name}{NOTE[p.slug] ? ` — ${NOTE[p.slug]}` : ""}</div>
                {ms.map((m) => {
                  const v = `${p.slug}:${m.model_id}`;
                  const blocked = p.kind === "cli" && hasTools;
                  return (
                    <button key={v} onClick={() => !blocked && void choose(v)} disabled={blocked} title={blocked ? "This bot uses tools; CLI models are chat-only and are ignored for it" : v}
                      className="flex w-full items-center justify-between rounded-lg px-2 py-1 text-left text-xs hover:bg-white/10 disabled:opacity-40">
                      <span className="truncate">{m.model_id}</span>{cur === v && <Check size={13} />}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
