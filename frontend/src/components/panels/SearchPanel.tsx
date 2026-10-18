"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  Search, CheckSquare, Briefcase, Users, BookOpen, Bell,
  Loader2,
} from "lucide-react";

const API = "http://localhost:8000/api/search";

interface SearchResults {
  query: string;
  tasks: TaskResult[];
  applications: ApplicationResult[];
  contacts: ContactResult[];
  knowledge: KnowledgeResult[];
  notifications: NotifResult[];
}

interface TaskResult {
  id: string;
  title: string;
  status: string;
  priority: string;
  due_at: string | null;
}

interface ApplicationResult {
  id: string;
  company: string;
  title: string;
  status: string;
  applied_at: string | null;
}

interface ContactResult {
  id: string;
  name: string;
  company: string | null;
  title: string | null;
  email: string | null;
  relationship_type: string | null;
}

interface KnowledgeResult {
  id: string;
  title: string;
  source_type: string | null;
  tags: string[] | null;
}

interface NotifResult {
  id: string;
  title: string;
  body: string | null;
  type: string;
  read: boolean;
  created_at: string | null;
}

const STATUS_COLORS: Record<string, string> = {
  done:       "#22c55e",
  completed:  "#22c55e",
  active:     "var(--color-accent)",
  in_progress:"var(--color-accent)",
  pending:    "#f59e0b",
  applied:    "#3b82f6",
  rejected:   "#ef4444",
  closed:     "#ef4444",
  open:       "var(--color-accent)",
};

function StatusChip({ label }: { label: string }) {
  const color = STATUS_COLORS[label?.toLowerCase()] ?? "var(--color-icon)";
  return (
    <span style={{
      fontSize: 9, fontWeight: 600, padding: "2px 6px",
      borderRadius: 99, border: `1px solid ${color}`,
      color, lineHeight: 1.4, whiteSpace: "nowrap",
    }}>
      {label}
    </span>
  );
}

function Badge({ label, color = "var(--color-icon)" }: { label: string; color?: string }) {
  return (
    <span style={{
      fontSize: 9, fontWeight: 500, padding: "2px 6px",
      borderRadius: 99, background: "var(--color-surface-raised)",
      color, whiteSpace: "nowrap",
    }}>
      {label}
    </span>
  );
}

function SectionHeader({ icon, label, count }: { icon: React.ReactNode; label: string; count: number }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: "var(--sp-2)",
      paddingBottom: "var(--sp-2)",
      borderBottom: "1px solid var(--border)",
      marginTop: "var(--sp-2)",
    }}>
      <span style={{ color: "var(--color-icon)" }}>{icon}</span>
      <span style={{ fontSize: 11, fontWeight: 600, color: "var(--color-text-muted)" }}>{label}</span>
      <span style={{
        marginLeft: "auto", fontSize: 10,
        color: "var(--color-text-muted)",
      }}>{count}</span>
    </div>
  );
}

function ResultRow({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="sj-card"
      style={{
        padding: "var(--sp-2) var(--sp-3)",
        display: "flex", alignItems: "center",
        gap: "var(--sp-2)", flexWrap: "wrap",
      }}
    >
      {children}
    </div>
  );
}

export function SearchPanel() {
  const [query, setQuery]         = useState("");
  const [results, setResults]     = useState<SearchResults | null>(null);
  const [loading, setLoading]     = useState(false);
  const inputRef                  = useRef<HTMLInputElement>(null);
  const debounceRef               = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Autofocus on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const doSearch = useCallback(async (q: string) => {
    if (q.trim().length < 2) {
      setResults(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res  = await fetch(`${API}?q=${encodeURIComponent(q.trim())}`);
      const data = await res.json() as SearchResults;
      setResults(data);
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const q = e.target.value;
    setQuery(q);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (q.trim().length < 2) {
      setResults(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    debounceRef.current = setTimeout(() => doSearch(q), 300);
  }

  const totalCount = results
    ? results.tasks.length + results.applications.length +
      results.contacts.length + results.knowledge.length + results.notifications.length
    : 0;

  const hasResults = results !== null && totalCount > 0;
  const noResults  = results !== null && totalCount === 0 && query.trim().length >= 2;

  return (
    <div className="sj-panel" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      {/* Header + search input */}
      <div className="sj-panel-header" style={{ flexDirection: "column", alignItems: "stretch", gap: "var(--sp-3)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "var(--sp-2)" }}>
          <Search size={13} style={{ color: "var(--color-icon)" }} />
          <span className="sj-label">Search</span>
          {hasResults && (
            <span style={{ marginLeft: "auto", fontSize: 10, color: "var(--color-text-muted)" }}>
              {totalCount} result{totalCount !== 1 ? "s" : ""}
            </span>
          )}
          {loading && (
            <span style={{ marginLeft: "auto" }}>
              <Loader2 size={12} style={{ color: "var(--color-icon)", animation: "spin 1s linear infinite" }} />
            </span>
          )}
        </div>

        <div style={{ position: "relative" }}>
          <Search
            size={14}
            style={{
              position: "absolute", left: 10, top: "50%",
              transform: "translateY(-50%)", color: "var(--color-icon)", pointerEvents: "none",
            }}
          />
          <input
            ref={inputRef}
            className="sj-input"
            type="text"
            placeholder="Search tasks, jobs, contacts, knowledge…"
            value={query}
            onChange={handleChange}
            style={{ fontSize: 13, paddingLeft: 30, width: "100%", boxSizing: "border-box" }}
          />
        </div>
      </div>

      {/* Results */}
      <div
        className="sj-panel-body"
        style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: "var(--sp-3)" }}
      >
        {/* Idle state */}
        {!loading && !results && (
          <div style={{
            flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
            flexDirection: "column", gap: "var(--sp-3)", opacity: 0.45,
          }}>
            <Search size={32} style={{ color: "var(--color-icon)" }} />
            <span style={{ fontSize: 12, color: "var(--color-text-muted)", textAlign: "center" }}>
              Start typing to search across everything
            </span>
          </div>
        )}

        {/* No results */}
        {noResults && (
          <div style={{
            flex: 1, display: "flex", alignItems: "center", justifyContent: "center",
            flexDirection: "column", gap: "var(--sp-3)", opacity: 0.55,
          }}>
            <Search size={28} style={{ color: "var(--color-icon)" }} />
            <span style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
              No results for &ldquo;{results?.query}&rdquo;
            </span>
          </div>
        )}

        {/* Tasks */}
        {hasResults && results!.tasks.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
            <SectionHeader icon={<CheckSquare size={13} />} label="Tasks" count={results!.tasks.length} />
            {results!.tasks.map((t) => (
              <ResultRow key={t.id}>
                <span style={{ fontSize: 12, color: "var(--color-text)", flex: 1, minWidth: 0 }}>
                  {t.title}
                </span>
                {t.status   && <StatusChip label={t.status} />}
                {t.priority && <Badge label={t.priority} color="var(--color-text-muted)" />}
              </ResultRow>
            ))}
          </div>
        )}

        {/* Applications */}
        {hasResults && results!.applications.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
            <SectionHeader icon={<Briefcase size={13} />} label="Applications" count={results!.applications.length} />
            {results!.applications.map((a) => (
              <ResultRow key={a.id}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 12, color: "var(--color-text)" }}>{a.company}</span>
                  {a.title && (
                    <span style={{ fontSize: 11, color: "var(--color-text-muted)", marginLeft: "var(--sp-2)" }}>
                      {a.title}
                    </span>
                  )}
                </div>
                {a.status && <StatusChip label={a.status} />}
              </ResultRow>
            ))}
          </div>
        )}

        {/* Contacts */}
        {hasResults && results!.contacts.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
            <SectionHeader icon={<Users size={13} />} label="Contacts" count={results!.contacts.length} />
            {results!.contacts.map((c) => (
              <ResultRow key={c.id}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 12, color: "var(--color-text)" }}>{c.name}</span>
                  {c.company && (
                    <span style={{ fontSize: 11, color: "var(--color-text-muted)", marginLeft: "var(--sp-2)" }}>
                      {c.company}
                    </span>
                  )}
                </div>
                {c.relationship_type && <Badge label={c.relationship_type} color="var(--color-accent)" />}
              </ResultRow>
            ))}
          </div>
        )}

        {/* Knowledge */}
        {hasResults && results!.knowledge.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
            <SectionHeader icon={<BookOpen size={13} />} label="Knowledge" count={results!.knowledge.length} />
            {results!.knowledge.map((k) => (
              <ResultRow key={k.id}>
                <span style={{ fontSize: 12, color: "var(--color-text)", flex: 1, minWidth: 0 }}>
                  {k.title}
                </span>
                {k.source_type && <Badge label={k.source_type} />}
              </ResultRow>
            ))}
          </div>
        )}

        {/* Notifications */}
        {hasResults && results!.notifications.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--sp-2)" }}>
            <SectionHeader icon={<Bell size={13} />} label="Notifications" count={results!.notifications.length} />
            {results!.notifications.map((n) => (
              <ResultRow key={n.id}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 12, color: "var(--color-text)" }}>{n.title}</span>
                  {n.body && (
                    <div style={{ fontSize: 11, color: "var(--color-text-muted)", marginTop: 1 }}>
                      {n.body.length > 80 ? n.body.slice(0, 80) + "…" : n.body}
                    </div>
                  )}
                </div>
                {n.type && <Badge label={n.type} />}
              </ResultRow>
            ))}
          </div>
        )}
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}
