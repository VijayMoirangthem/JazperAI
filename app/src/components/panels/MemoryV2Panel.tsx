"use client";

import { useCallback, useEffect, useState } from "react";
import { Brain, Trash2, RefreshCw, AlertTriangle, Plus, Search, X } from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const BASE = `${API}/api/v1/memory2`;

interface Fact {
  id: string;
  content: string;
  importance: number;
  hits: number;
  created_at: string;
  last_used_at: string | null;
  superseded_by: string | null;
  expires_at: string | null;
}

interface SweepResult {
  forgotten: number;
}

function timeAgo(iso: string | null) {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function MemoryV2Panel() {
  const [facts, setFacts] = useState<Fact[]>([]);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState("");
  const [newFact, setNewFact] = useState("");
  const [newImportance, setNewImportance] = useState(0.6);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Fact[] | null>(null);
  const [searching, setSearching] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${BASE}/facts?include_inactive=${includeInactive}`);
      const d = await r.json();
      setFacts(d.facts ?? []);
    } catch {
      setMsg("Backend unreachable");
    }
    setLoading(false);
  }, [includeInactive]);

  useEffect(() => { load(); }, [load]);

  async function remember() {
    if (!newFact.trim()) return;
    try {
      const r = await fetch(`${BASE}/facts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fact: newFact.trim(), importance: newImportance }),
      });
      const d = await r.json();
      setMsg(`Memory ${d.action.toLowerCase()}: ${d.fact?.slice(0, 60)}...`);
      setNewFact("");
      load();
    } catch {
      setMsg("Failed to store memory");
    }
  }

  async function forget(id: string) {
    if (!confirm("Forget this memory?")) return;
    try {
      const r = await fetch(`${BASE}/facts/${id}`, { method: "DELETE" });
      if (r.ok) {
        setMsg("Memory forgotten");
        load();
      } else {
        setMsg("Memory not found");
      }
    } catch {
      setMsg("Failed to forget memory");
    }
  }

  async function runSweep() {
    try {
      const r = await fetch(`${BASE}/sweep`, { method: "POST" });
      const d: SweepResult = await r.json();
      setMsg(`Sweep complete: ${d.forgotten} memories forgotten`);
      load();
    } catch {
      setMsg("Sweep failed");
    }
  }

  async function search() {
    if (!searchQuery.trim()) {
      setSearchResults(null);
      return;
    }
    setSearching(true);
    try {
      const r = await fetch(`${API}/api/memory/auto/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: searchQuery.trim(), top_k: 10 }),
      });
      const d = await r.json();
      setSearchResults((d.results ?? []).map((m: any) => ({
        id: m.id,
        content: m.content,
        importance: 0,
        hits: 0,
        created_at: m.created_at,
        last_used_at: null,
        superseded_by: null,
        expires_at: null,
      })));
    } catch {
      setSearchResults([]);
    }
    setSearching(false);
  }

  const displayed = searchResults !== null ? searchResults : facts;

  return (
    <div className="max-w-4xl space-y-6 p-6">
      <div className="flex items-center gap-3">
        <Brain size={20} />
        <h2 className="text-lg font-semibold">Memory v2</h2>
        {msg && <span className="text-xs opacity-70">{msg}</span>}
      </div>

      {/* Add new fact */}
      <section className="space-y-2 rounded border p-3">
        <div className="text-sm font-medium">Teach a new fact</div>
        <div className="flex gap-2">
          <input
            value={newFact}
            onChange={(e) => setNewFact(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && remember()}
            placeholder="e.g. The user prefers dark mode and works late at night"
            className="flex-1 rounded border bg-transparent px-2 py-1 font-mono text-xs"
          />
          <input
            type="number"
            step="0.1"
            min="0"
            max="1"
            value={newImportance}
            onChange={(e) => setNewImportance(Number(e.target.value))}
            placeholder="importance 0-1"
            className="w-28 rounded border bg-transparent px-2 py-1 text-xs"
          />
          <button onClick={remember} disabled={!newFact.trim()} className="rounded border px-3 py-1 text-xs disabled:opacity-40">
            Remember
          </button>
        </div>
      </section>

      {/* Search */}
      <section className="space-y-2 rounded border p-3">
        <div className="text-sm font-medium">Semantic search</div>
        <div className="flex gap-2">
          <input
            value={searchQuery}
            onChange={(e) => { setSearchQuery(e.target.value); if (!e.target.value) setSearchResults(null); }}
            onKeyDown={(e) => e.key === "Enter" && search()}
            placeholder="Search memories..."
            className="flex-1 rounded border bg-transparent px-2 py-1 font-mono text-xs"
          />
          <button onClick={search} disabled={searching} className="rounded border px-3 py-1 text-xs disabled:opacity-40">
            <Search size={12} />
          </button>
          {searchResults !== null && (
            <button onClick={() => { setSearchResults(null); setSearchQuery(""); }} className="rounded border px-3 py-1 text-xs">
              <X size={12} />
            </button>
          )}
        </div>
        {searchResults !== null && (
          <div className="text-xs opacity-60">{searchResults.length} result(s)</div>
        )}
      </section>

      {/* Facts list */}
      <section className="space-y-2 rounded border p-3">
        <div className="flex items-center justify-between">
          <div className="text-sm font-medium">Stored facts ({displayed.length})</div>
          <div className="flex gap-2">
            <label className="text-xs flex items-center gap-1">
              <input type="checkbox" checked={includeInactive} onChange={(e) => setIncludeInactive(e.target.checked)} />
              Show inactive
            </label>
            <button onClick={runSweep} className="rounded border px-3 py-1 text-xs">
              <RefreshCw size={12} className="inline" /> Sweep
            </button>
          </div>
        </div>

        {loading && <div className="text-xs opacity-50">Loading...</div>}
        {!loading && displayed.length === 0 && (
          <div className="text-xs opacity-50">
            {searchResults !== null ? "No matching memories found." : "No facts stored yet. Teach one above or chat with Jazper."}
          </div>
        )}

        <div className="space-y-1 max-h-96 overflow-y-auto">
          {displayed.map((f) => (
            <div key={f.id} className={`text-xs rounded border p-2 ${f.superseded_by || f.expires_at ? "opacity-40" : ""}`}>
              <div className="flex gap-2">
                <span className="flex-1 font-mono whitespace-pre-wrap break-words">{f.content}</span>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <span className="opacity-60 font-mono">imp {f.importance.toFixed(2)}</span>
                  <span className="opacity-60 font-mono">hits {f.hits}</span>
                  <span className="opacity-50 font-mono">{timeAgo(f.last_used_at)}</span>
                  {f.superseded_by && <span className="text-amber-400">superseded</span>}
                  {f.expires_at && <span className="text-red-400">expired</span>}
                  <button onClick={() => forget(f.id)} title="Forget" className="rounded px-1.5 py-0.5 hover:bg-red-500/20 text-red-400">
                    <Trash2 size={10} />
                  </button>
                </div>
              </div>
              <div className="flex gap-2 mt-1 opacity-50 font-mono">
                <span>created {timeAgo(f.created_at)}</span>
                {f.superseded_by && <span>→ superseded by {f.superseded_by.slice(0, 8)}</span>}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}