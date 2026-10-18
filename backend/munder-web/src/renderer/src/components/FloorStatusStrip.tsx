import { useStore } from '@/store/store';
import { agentsOnFloor } from '@/scene/office/officeLayout';
import type { Agent } from '@/store/store';

function countByStatus(agents: Agent[]) {
  let working = 0;
  let blocked = 0;
  let idle = 0;
  for (const a of agents) {
    if (a.status === 'working' || a.status === 'thinking' || a.status === 'compacting') working += 1;
    else if (a.status === 'blocked') blocked += 1;
    else idle += 1;
  }
  return { working, blocked, idle };
}

/** Live ops status strip (Phase 6). */
export function FloorStatusStrip() {
  const agents = useStore((s) => s.agents);
  const floorId = useStore((s) => s.currentFloorId);
  const rosterFilter = useStore((s) => s.agentRosterFilter);
  const onFloor = agentsOnFloor(agents, floorId, rosterFilter);
  const { working, blocked, idle } = countByStatus(onFloor);

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 8,
        left: 8,
        zIndex: 20,
        pointerEvents: 'none',
        padding: '4px 10px',
        background: 'rgba(255,255,255,0.9)',
        borderRadius: 6,
        fontSize: 11,
        fontFamily: 'var(--cth-font-mono)',
        color: 'var(--cth-ink-700)',
        boxShadow: '0 1px 4px rgba(0,0,0,0.08)',
      }}
    >
      <span style={{ color: 'var(--cth-mint-600)' }}>{working} working</span>
      <span style={{ opacity: 0.4, margin: '0 6px' }}>·</span>
      <span style={{ color: 'var(--cth-coral-500)' }}>{blocked} blocked</span>
      <span style={{ opacity: 0.4, margin: '0 6px' }}>·</span>
      <span>{idle} idle</span>
      <span style={{ opacity: 0.4, margin: '0 6px' }}>·</span>
      <span>{onFloor.length} on floor</span>
    </div>
  );
}
