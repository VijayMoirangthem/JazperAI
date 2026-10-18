import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '@/store/store';
import {
  focusAgent,
  focusDepartmentZone,
  focusFloor,
  focusTeam,
} from '@/scene/office/floorNavigation';

type GoToKind = 'floor' | 'department' | 'team' | 'agent';

interface GoToItem {
  kind: GoToKind;
  id: string;
  label: string;
  subtitle: string;
  score: number;
}

function isActiveStatus(status: string): boolean {
  return ['working', 'thinking', 'compacting', 'blocked', 'waiting'].includes(status);
}

function matchScore(text: string, query: string): number {
  const t = text.toLowerCase();
  const q = query.toLowerCase().trim();
  if (!q) return 1;
  if (t === q) return 100;
  if (t.startsWith(q)) return 80;
  if (t.includes(q)) return 50;
  return 0;
}

export function GoToPalette() {
  const open = useStore((s) => s.goToOpen);
  const setGoToOpen = useStore((s) => s.setGoToOpen);
  const agents = useStore((s) => s.agents);
  const zones = useStore((s) => s.departmentZones);
  const teams = useStore((s) => s.orgTeams);
  const floors = useStore((s) => s.orgFloors);
  const camera = useStore((s) => s.floorCamera);
  const floorMapSize = useStore((s) => s.floorMapSize);

  const [query, setQuery] = useState('');
  const [highlight, setHighlight] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const items = useMemo(() => {
    const q = query.trim();
    const all: GoToItem[] = [];

    for (const f of floors) {
      const score = matchScore(f.label, q) + matchScore(f.id, q);
      if (score > 0 || !q) {
        all.push({
          kind: 'floor',
          id: f.id,
          label: f.label,
          subtitle: 'Floor / Division',
          score: score + (q ? 0 : 10),
        });
      }
    }

    for (const z of zones) {
      const deptAgents = agents.filter((a) => z.departments.includes(a.departmentId ?? ''));
      const active = deptAgents.filter((a) => isActiveStatus(a.status)).length;
      const score = matchScore(z.label, q) + matchScore(z.id, q);
      if (score > 0 || !q) {
        all.push({
          kind: 'department',
          id: z.id,
          label: z.label,
          subtitle: `${deptAgents.length} agents · ${active} active`,
          score: score + (q ? 0 : 8),
        });
      }
    }

    for (const t of teams) {
      const members = agents.filter((a) => a.teamId === t.id);
      const active = members.filter((a) => isActiveStatus(a.status)).length;
      const dept = zones.find((z) => z.departments.includes(t.departmentId));
      const score = matchScore(t.name, q) + matchScore(t.id, q);
      if (score > 0 || !q) {
        all.push({
          kind: 'team',
          id: t.id,
          label: t.name.replace(/ Team$/, ''),
          subtitle: `${dept?.label ?? t.departmentId} · ${members.length} · ${active} active`,
          score: score + (q ? 0 : 6),
        });
      }
    }

    for (const a of agents) {
      const score =
        matchScore(a.name, q) +
        matchScore(a.id, q) +
        matchScore(a.title ?? '', q) +
        matchScore(a.departmentId ?? '', q);
      if (score > 0 || !q) {
        all.push({
          kind: 'agent',
          id: a.id,
          label: a.name,
          subtitle: a.description || a.title || a.id,
          score: score + (q ? 0 : 4),
        });
      }
    }

    all.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
    return q ? all.filter((i) => i.score > 0) : all;
  }, [agents, zones, teams, floors, query]);

  const pick = useCallback((item: GoToItem) => {
    const mapW = floorMapSize.width;
    const mapH = floorMapSize.height;
    switch (item.kind) {
      case 'floor':
        focusFloor(item.id, camera);
        break;
      case 'department':
        focusDepartmentZone(item.id, camera, zones, mapW, mapH);
        break;
      case 'team':
        focusTeam(item.id, camera, mapW, mapH);
        break;
      case 'agent':
        focusAgent(item.id, camera);
        break;
    }
    setGoToOpen(false);
    setQuery('');
    setHighlight(0);
  }, [camera, zones, floorMapSize, setGoToOpen]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setHighlight(0);
      window.setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  useEffect(() => {
    setHighlight(0);
  }, [query]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setGoToOpen(false);
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlight((h) => Math.min(h + 1, items.length - 1));
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlight((h) => Math.max(h - 1, 0));
      }
      if (e.key === 'Enter' && items[highlight]) {
        e.preventDefault();
        pick(items[highlight]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, items, highlight, pick, setGoToOpen]);

  if (!open) return null;

  const kindLabel: Record<GoToKind, string> = {
    floor: 'Floor',
    department: 'Dept',
    team: 'Team',
    agent: 'Agent',
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2000,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: 72,
        background: 'rgba(0,0,0,0.35)',
        pointerEvents: 'auto',
      }}
      onClick={() => setGoToOpen(false)}
    >
      <div
        style={{
          width: 420,
          maxHeight: '60vh',
          background: 'var(--cth-cream-50)',
          border: '2px solid var(--cth-ink-400)',
          borderRadius: 8,
          boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--cth-ink-300)' }}>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Go to floor, department, team, or agent…"
            style={{
              width: '100%',
              border: 'none',
              outline: 'none',
              fontSize: 14,
              fontFamily: 'var(--cth-font-ui)',
              background: 'transparent',
              color: 'var(--cth-ink-900)',
            }}
          />
        </div>
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {items.length === 0 && (
            <div style={{ padding: 16, fontSize: 12, color: 'var(--cth-ink-500)' }}>
              No matches
            </div>
          )}
          {items.slice(0, 40).map((item, idx) => (
            <button
              key={`${item.kind}-${item.id}`}
              type="button"
              onClick={() => pick(item)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                width: '100%',
                padding: '8px 12px',
                border: 'none',
                background: idx === highlight ? 'var(--cth-paper-200)' : 'transparent',
                cursor: 'pointer',
                textAlign: 'left',
                fontFamily: 'var(--cth-font-ui)',
              }}
            >
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  fontFamily: 'var(--cth-font-mono)',
                  color: 'var(--cth-ink-500)',
                  width: 44,
                  flexShrink: 0,
                }}
              >
                {kindLabel[item.kind]}
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--cth-ink-900)' }}>
                  {item.label}
                </span>
                <span style={{ fontSize: 11, color: 'var(--cth-ink-500)', display: 'block' }}>
                  {item.subtitle}
                </span>
              </span>
            </button>
          ))}
        </div>
        <div
          style={{
            padding: '6px 12px',
            fontSize: 10,
            color: 'var(--cth-ink-500)',
            fontFamily: 'var(--cth-font-mono)',
            borderTop: '1px solid var(--cth-ink-300)',
          }}
        >
          ↑↓ navigate · Enter select · Esc close
        </div>
      </div>
    </div>
  );
}
