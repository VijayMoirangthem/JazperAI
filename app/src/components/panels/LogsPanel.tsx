"use client";

import { useEffect, useRef, useState } from "react";
import { ScrollText, Trash2, Pause, Play } from "lucide-react";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface LogEntry {
  level: string;
  message: string;
  timestamp: string;
  extra?: Record<string, unknown>;
}

const LEVEL_STYLE: Record<string, { color: string; bg: string }> = {
  info:     { color: "var(--color-text-muted)",      bg: "transparent" },
  warning:  { color: "#f59e0b",                       bg: "transparent" },
  warn:     { color: "#f59e0b",                       bg: "transparent" },
  error:    { color: "#f87171",                       bg: "rgba(248,113,113,0.06)" },
  critical: { color: "#f87171",                       bg: "rgba(248,113,113,0.1)" },
  debug:    { color: "var(--color-text-muted)",      bg: "transparent" },
};

function fmt(iso: string) {
  try {
    return new Date(iso).toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch { return iso; }
}

function LevelBadge({ level }: { level: string }) {
  const style = LEVEL_STYLE[level] ?? LEVEL_STYLE.info;
  return (
    <span style={{
      fontSize: 9, fontWeight: 700, letterSpacing: "0.08em",
      textTransform: "uppercase", color: style.color, width: 36,
      flexShrink: 0, fontFamily: "var(--font-mono)",
    }}>
      {level.slice(0, 4)}
    </span>
  );
}

export function LogsPanel() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [paused, setPaused] = useState(false);
  const [connected, setConnected] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const pausedRef = useRef(false);
  const pendingRef = useRef<LogEntry[]>([]);
  const esRef = useRef<EventSource | null>(null);

  pausedRef.current = paused;

  useEffect(() => {
    const es = new EventSource(`${API}/api/logs/stream`);
    esRef.current = es;

    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);

    es.onmessage = (e) => {
      try {
        const entry: LogEntry & { ping?: boolean } = JSON.parse(e.data);
        if (entry.ping) return;
        if (pausedRef.current) {
          pendingRef.current.push(entry);
        } else {
          setLogs(prev => [...prev, entry].slice(-500));
        }
      } catch { /* malformed */ }
    };

    return () => { es.close(); esRef.current = null; setConnected(false); };
  }, []);

  // Auto-scroll to bottom when new logs arrive (unless paused)
  useEffect(() => {
    if (!paused) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs, paused]);

  function resume() {
    setPaused(false);
    if (pendingRef.current.length > 0) {
      setLogs(prev => [...prev, ...pendingRef.current].slice(-500));
      pendingRef.current = [];
    }
  }

  function clear() {
    setLogs([]);
    pendingRef.current = [];
  }

  return (
    <div className="sj-panel" style={{ height: "100%", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div className="sj-panel-header" style={{ flexShrink: 0 }}>
        <ScrollText size={13} style={{ color: "var(--color-icon)" }} />
        <span className="sj-label">Execution Logs</span>
        <span className="sj-ml-auto sj-flex sj-items-center sj-gap-2">
          <span className="sj-dot" style={{ background: connected ? "var(--color-accent)" : "var(--color-text-muted)" }} />
          <span className="sj-micro">{connected ? "live" : "offline"}</span>
          {logs.length > 0 && <span className="sj-micro">{logs.length} entries</span>}
        </span>
        <button
          className="sj-btn-icon"
          onClick={() => paused ? resume() : setPaused(true)}
          title={paused ? "Resume" : "Pause"}
          style={{ color: paused ? "var(--color-accent)" : "var(--color-text-muted)" }}
        >
          {paused ? <Play size={11} /> : <Pause size={11} />}
        </button>
        <button className="sj-btn-icon" onClick={clear} title="Clear">
          <Trash2 size={11} />
        </button>
      </div>

      <div style={{
        flex: 1, minHeight: 0, overflowY: "auto",
        padding: "var(--sp-2) var(--sp-3)",
        fontFamily: "var(--font-mono)",
        display: "flex", flexDirection: "column", gap: 1,
      }}>
        {logs.length === 0 && (
          <p className="sj-micro" style={{ color: "var(--color-text-muted)", padding: "var(--sp-2) 0" }}>
            {connected ? "Waiting for log events..." : "Connecting to backend..."}
          </p>
        )}

        {logs.map((log, i) => {
          const style = LEVEL_STYLE[log.level] ?? LEVEL_STYLE.info;
          const extras = Object.entries(log.extra ?? {}).filter(([k]) => k !== "_record");
          return (
            <div key={i} style={{
              display: "flex", gap: "var(--sp-2)", alignItems: "baseline",
              padding: "2px var(--sp-2)", borderRadius: "var(--r-xs)",
              background: style.bg,
            }}>
              <span className="sj-micro" style={{ flexShrink: 0, fontSize: 10, color: "var(--color-text-muted)", width: 60 }}>
                {fmt(log.timestamp)}
              </span>
              <LevelBadge level={log.level} />
              <span style={{ fontSize: 11, color: style.color === "var(--color-text-muted)" ? "var(--color-text-secondary)" : style.color, flex: 1 }}>
                {log.message}
                {extras.length > 0 && (
                  <span style={{ color: "var(--color-text-muted)", marginLeft: 6 }}>
                    {extras.map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(" ")}
                  </span>
                )}
              </span>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {paused && pendingRef.current.length > 0 && (
        <div style={{
          padding: "var(--sp-2) var(--sp-3)", borderTop: "var(--border)",
          display: "flex", alignItems: "center", gap: "var(--sp-2)",
          background: "var(--color-surface-raised)", flexShrink: 0,
        }}>
          <span className="sj-micro" style={{ color: "var(--color-accent)" }}>
            {pendingRef.current.length} new entries paused
          </span>
          <button className="sj-btn-icon" onClick={resume} style={{ color: "var(--color-accent)" }}>
            <Play size={11} /> Resume
          </button>
        </div>
      )}
    </div>
  );
}
