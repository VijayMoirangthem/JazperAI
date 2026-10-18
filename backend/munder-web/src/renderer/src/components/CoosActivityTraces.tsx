import { useEffect, useState } from 'react';

interface ActivityEntry {
  ts?: string;
  kind?: string;
  text?: string;
  message?: string;
}

/** Live activity feed for COOS registry agents (no PTY telemetry). */
export function CoosActivityTraces({ agentId }: { agentId: string }) {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch(
          `/api/hive/agents/${encodeURIComponent(agentId)}/activity?limit=80`,
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json() as { activities?: ActivityEntry[] };
        if (alive) {
          setEntries(data.activities ?? []);
          setError('');
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
    };
    load();
    const t = window.setInterval(load, 4000);
    return () => { alive = false; window.clearInterval(t); };
  }, [agentId]);

  return (
    <div
      data-scroll-panel
      style={{
        flex: 1,
        minHeight: 0,
        overflow: 'auto',
        padding: 10,
        background: 'var(--cth-paper-200)',
        fontFamily: 'var(--cth-font-mono)',
        fontSize: 11,
        lineHeight: '18px',
      }}
    >
      {error && (
        <div style={{ color: 'var(--cth-coral)', marginBottom: 8 }}>{error}</div>
      )}
      {entries.length === 0 && !error && (
        <div style={{ color: 'var(--cth-ink-500)', fontSize: 12 }}>
          No activity yet. Commands, dispatches, and hive messages appear here.
        </div>
      )}
      {entries.map((e, i) => (
        <div
          key={i}
          style={{
            padding: '4px 0',
            borderBottom: '1px solid var(--cth-ink-200)',
            color: 'var(--cth-ink-800)',
          }}
        >
          <span style={{ color: 'var(--cth-ink-500)', marginRight: 8 }}>
            {e.kind ?? 'log'}
          </span>
          {e.text ?? e.message ?? JSON.stringify(e)}
        </div>
      ))}
    </div>
  );
}
