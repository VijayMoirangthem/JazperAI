"use client";

import { useCallback, useEffect, useState } from "react";
import { Cpu } from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const TIERS = ["light", "standard", "frontier"] as const;

interface Model { model_id: string; label: string | null }
interface Provider {
  slug: string; name: string; kind: string; base_url: string | null;
  enabled: boolean; local: boolean; has_key: boolean; models: Model[];
}
type Routing = Record<string, { provider: string; model: string }[]>;

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${API}/api/v1/llm${path}`, { headers: { "Content-Type": "application/json" }, ...init });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail ?? r.statusText);
  return r.json();
}

/** Add any AI provider (OpenAI-compatible, Anthropic, local CLI), its models, and per-tier fallback routing. Keys are write-only. */
export function AiProvidersPanel() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [routing, setRouting] = useState<Routing>({});
  const [msg, setMsg] = useState("");
  const [form, setForm] = useState({ slug: "", name: "", kind: "openai_compat", base_url: "", api_key: "" });
  const [newModel, setNewModel] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      setProviders((await api<{ providers: Provider[] }>("/providers")).providers);
      setRouting(await api<Routing>("/routing"));
    } catch (e) { setMsg(String(e)); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); setMsg(ok); await load(); } catch (e) { setMsg(String(e)); }
  };
  const allModels = providers.flatMap((p) => p.models.map((m) => ({ provider: p.slug, model: m.model_id })));
  const label = (e: { provider: string; model: string }) => `${e.provider} / ${e.model}`;

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      <div className="flex items-center gap-3"><Cpu size={20} /><h2 className="text-lg font-semibold">AI Providers</h2>
        {msg && <span className="text-xs opacity-70">{msg}</span>}</div>

      <section className="space-y-3">
        {providers.map((p) => (
          <div key={p.slug} className="rounded border p-3 space-y-2">
            <div className="flex items-center gap-3">
              <span className="font-medium">{p.name}</span>
              <span className="text-xs opacity-60">{p.kind}{p.local ? " · local" : ""}</span>
              <span className="text-xs" style={{ color: p.has_key || p.kind === "cli" || p.local ? "#22c55e" : "#f59e0b" }}>
                {p.has_key ? "key saved" : p.kind === "cli" || p.local ? "no key needed" : "no key"}
              </span>
              <button className="ml-auto text-xs underline" onClick={() => run(() => api(`/providers/${p.slug}`, { method: "DELETE" }), "Deleted")}>delete</button>
            </div>
            <div className="text-xs opacity-60 break-all">{p.base_url}</div>
            <div className="flex flex-wrap gap-2">
              {p.models.map((m) => (
                <button key={m.model_id} className="text-xs rounded border px-2 py-1" title="Click to test"
                  onClick={() => run(async () => {
                    const r = await api<{ ok: boolean; latency_ms?: number; error?: string }>(`/providers/${p.slug}/test?model=${encodeURIComponent(m.model_id)}`, { method: "POST" });
                    setMsg(r.ok ? `${m.model_id}: ok (${r.latency_ms} ms)` : `${m.model_id}: ${r.error}`);
                  }, "")}>{m.model_id}</button>
              ))}
              <input className="text-xs rounded border bg-transparent px-2 py-1" placeholder="add model id"
                value={newModel[p.slug] ?? ""} onChange={(e) => setNewModel({ ...newModel, [p.slug]: e.target.value })}
                onKeyDown={(e) => e.key === "Enter" && newModel[p.slug] &&
                  run(() => api("/models", { method: "PUT", body: JSON.stringify({ provider: p.slug, model_id: newModel[p.slug] }) }), "Model added")} />
            </div>
          </div>
        ))}
      </section>

      <section className="rounded border p-3 space-y-2">
        <div className="font-medium text-sm">Add provider</div>
        <div className="grid grid-cols-2 gap-2">
          {(["slug", "name", "base_url", "api_key"] as const).map((k) => (
            <input key={k} type={k === "api_key" ? "password" : "text"} className="rounded border bg-transparent px-2 py-1 text-sm"
              placeholder={k === "base_url" ? "base URL (CLI: command line)" : k === "api_key" ? "API key (stored in OS vault)" : k}
              value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
          ))}
          <select className="rounded border bg-transparent px-2 py-1 text-sm" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
            <option value="openai_compat">OpenAI-compatible (Groq, OpenRouter, Ollama, LM Studio…)</option>
            <option value="anthropic">Anthropic</option>
            <option value="cli">Local CLI engine (claude -p, codex exec…)</option>
          </select>
          <button className="rounded border px-3 py-1 text-sm"
            onClick={() => run(() => api("/providers", { method: "PUT", body: JSON.stringify({ ...form, api_key: form.api_key || null, base_url: form.base_url || null, local: /localhost|127\.0\.0\.1/.test(form.base_url) }) }).then(() => setForm({ slug: "", name: "", kind: "openai_compat", base_url: "", api_key: "" })), "Provider saved")}>Save provider</button>
        </div>
      </section>

      <section className="rounded border p-3 space-y-3">
        <div className="font-medium text-sm">Routing (first entry is tried first, the rest are fallbacks)</div>
        {TIERS.map((t) => (
          <div key={t} className="space-y-1">
            <div className="text-xs uppercase opacity-60">{t}</div>
            {(routing[t] ?? []).map((e, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <span>{i + 1}. {label(e)}</span>
                <button className="text-xs underline" onClick={() => run(() => api(`/routing/${t}`, { method: "PUT", body: JSON.stringify({ chain: routing[t].filter((_, j) => j !== i) }) }), "Routing updated")}>remove</button>
              </div>
            ))}
            <select className="text-xs rounded border bg-transparent px-2 py-1" value="" onChange={(e) => {
              if (!e.target.value) return;
              const [provider, ...rest] = e.target.value.split("|");
              run(() => api(`/routing/${t}`, { method: "PUT", body: JSON.stringify({ chain: [...(routing[t] ?? []), { provider, model: rest.join("|") }] }) }), "Routing updated");
            }}>
              <option value="">+ add to chain…</option>
              {allModels.map((m) => <option key={label(m)} value={`${m.provider}|${m.model}`}>{label(m)}</option>)}
            </select>
          </div>
        ))}
      </section>
    </div>
  );
}
