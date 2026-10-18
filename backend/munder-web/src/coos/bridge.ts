// ─────────────────────────────────────────────────────────────────────────────
// COOS bridge — connects the Munder renderer to the COOS hive backend.
//
// Runs in "coos" mode (the default when the page is served from the COOS
// backend at /munder/index.html). It:
//   1. Seeds the floor with every COOS agent from GET /api/agents/live
//      (id = codename, status/action from the live registry, god = jazper).
//   2. Subscribes to the backend WebSocket (/ws/) and forwards
//      AGENT_STATUS / AGENT_ACTION into the store so avatars animate, and
//      AGENT_MESSAGE into the shim's onHiveMessage listeners so envelopes fly.
//   3. Drains the composer's queued messages into POST /api/hive/send so a
//      "give a command" actually reaches the agent's inbox (and the chain loop).
//
// The shim (index.html) keeps all 142 window.cth methods; this module only
// provides the live data plane. Demo mode (—?mode=demo) is untouched.
// ─────────────────────────────────────────────────────────────────────────────

import { useStore, type Agent, type DepartmentZone, type OrgFloor, type OrgTeam, type Room } from '../renderer/src/store/store';
import type { AccentColorName } from '../renderer/src/design/tokens';
import type { OfficeCharacterName } from '../renderer/src/scene/office/cast';
import type { StatusKind } from '../renderer/src/components/PixelBadge';

const MODE = new URLSearchParams(window.location.search).get('mode') ?? 'coos';
const API = '/api';

// ── mappings ─────────────────────────────────────────────────────────────────

const CHARACTERS: OfficeCharacterName[] = [
  'michael', 'jim', 'pam', 'dwight', 'kevin', 'angela', 'oscar', 'stanley',
  'phyllis', 'andy', 'kelly', 'ryan', 'toby', 'creed', 'meredith',
];

const ACCENT_HEX: Record<AccentColorName, [number, number, number]> = {
  coral: [0xd9, 0x6a, 0x62],
  mint: [0x5c, 0xa9, 0x7a],
  sky: [0x4f, 0x9f, 0xaf],
  lemon: [0xdc, 0xab, 0x3c],
  lilac: [0x94, 0x82, 0xd3],
  peach: [0xd9, 0x91, 0x68],
};

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

function characterFor(codename: string, departmentId?: string): OfficeCharacterName {
  if (codename === 'jazper') return 'michael';
  const seed = departmentId && departmentId !== '' ? departmentId : codename;
  return CHARACTERS[hashStr(seed) % CHARACTERS.length];
}

function accentFor(hex?: string): AccentColorName {
  if (!hex || !/^#?[0-9a-fA-F]{6}$/.test(hex)) return 'sky';
  const n = parseInt(hex.replace('#', ''), 16);
  const r = (n >> 16) & 0xff, g = (n >> 8) & 0xff, b = n & 0xff;
  let best: AccentColorName = 'sky';
  let bestD = Infinity;
  (Object.keys(ACCENT_HEX) as AccentColorName[]).forEach((name) => {
    const [ar, ag, ab] = ACCENT_HEX[name];
    const d = (r - ar) ** 2 + (g - ag) ** 2 + (b - ab) ** 2;
    if (d < bestD) { bestD = d; best = name; }
  });
  return best;
}

function deploymentFor(status?: string): Agent['deploymentStatus'] {
  const s = (status ?? '').toLowerCase();
  if (s === 'active' || s === 'working' || s === 'busy') return 'deployed';
  if (s === 'standby') return 'planned';
  return 'catalogue';
}

function statusFor(s?: string): StatusKind {
  switch ((s ?? '').toLowerCase()) {
    case 'active': case 'working': case 'busy': case 'thinking': case 'running': return 'working';
    case 'compacting': return 'compacting';
    case 'blocked': case 'error': case 'failed': case 'stuck': return 'blocked';
    case 'waiting': return 'waiting';
    default: return 'idle';
  }
}

// ── seeding ──────────────────────────────────────────────────────────────────

interface LiveAgent {
  codename: string;
  name: string;
  department: string;
  department_id?: string;
  team_id?: string;
  floor_id?: string;
  desk_slot?: number;
  title?: string;
  level?: number;
  health_score?: number;
  status: string;
  badge_color?: string;
  action?: string;
  avatar_emoji?: string;
}

interface LiveDept {
  id: string;
  name: string;
  badge_color?: string;
  division_id?: string;
  floor_id?: string;
}

interface LiveTeam {
  id: string;
  name: string;
  department_id: string;
  division_id?: string;
}

interface LiveDivision {
  id: string;
  name: string;
  label: string;
  map_theme?: string;
}

async function fetchLive(): Promise<{
  agents: LiveAgent[];
  departments: LiveDept[];
  teams: LiveTeam[];
  divisions: LiveDivision[];
}> {
  const res = await fetch(`${API}/agents/live`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return {
    agents: Array.isArray(data.agents) ? data.agents : [],
    departments: Array.isArray(data.departments) ? data.departments : [],
    teams: Array.isArray(data.teams) ? data.teams : [],
    divisions: Array.isArray(data.divisions) ? data.divisions : [],
  };
}

function deptName(deptId: string, departments: LiveDept[]): string {
  const d = departments.find((x) => x.id === deptId);
  return d?.name ?? deptId ?? '';
}

const ZONE_COLORS: string[] = [
  '#6366f1', '#8b5cf6', '#ec4899', '#f97316', '#f59e0b', '#84cc16',
  '#22c55e', '#06b6d4', '#3b82f6', '#a855f7', '#e879f9', '#fbbf24',
  '#34d399', '#60a5fa', '#f472b6', '#a78bfa',
];

function buildFloors(divisions: LiveDivision[]): OrgFloor[] {
  if (divisions.length === 0) {
    return [
      { id: 'floor-1', label: 'COOS HQ — Floor 1', divisionId: 'div-main' },
      { id: 'floor-2', label: 'COOS HQ — Floor 2', divisionId: 'div-ops' },
    ];
  }
  return divisions.map((d) => ({
    id: d.id === 'div-main' ? 'floor-1' : d.id === 'div-ops' ? 'floor-2' : d.id,
    label: d.label || d.name,
    divisionId: d.id,
    mapTheme: d.map_theme,
  }));
}

function buildTeams(teams: LiveTeam[]): OrgTeam[] {
  return teams.map((t) => ({
    id: t.id,
    name: t.name,
    departmentId: t.department_id,
    divisionId: t.division_id,
  }));
}

function teamRoom(team: LiveTeam): Room {
  return {
    id: team.id,
    zoneId: team.department_id,
    name: team.name.replace(/ Team$/, ''),
    type: 'huddle',
    capacity: 24,
    assignedAgents: [],
    amenities: [],
    bookable: false,
  };
}

function buildDepartmentZones(departments: LiveDept[], teams: LiveTeam[]): DepartmentZone[] {
  return departments
    .filter((d) => d.id && d.name)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((d, i) => ({
      id: d.id,
      label: d.name,
      departments: [d.id],
      color: d.badge_color && /^#[0-9a-fA-F]{6}$/.test(d.badge_color)
        ? d.badge_color
        : ZONE_COLORS[i % ZONE_COLORS.length],
      order: i,
      expanded: true,
      floorId: d.floor_id ?? 'floor-1',
      rooms: teams
        .filter((t) => t.department_id === d.id)
        .map(teamRoom),
    }));
}

async function seedOrg(): Promise<void> {
  try {
    const { departments, teams, divisions } = await fetchLive();
    const floors = buildFloors(divisions);
    const orgTeams = buildTeams(teams);
    const zones = buildDepartmentZones(departments, teams);
    const store = useStore.getState();
    store.setOrgFloors(floors);
    store.setOrgTeams(orgTeams);
    store.setDepartmentZones(zones);
    store.setVisibleZoneRange([0, Math.min(4, zones.length - 1)]);
    if (floors.length > 0) store.setCurrentFloorId(floors[0].id);
  } catch (e) {
    console.warn('[coos] org seeding failed', e);
  }
}

async function seedZones(): Promise<void> {
  await seedOrg();
}

function agentDescription(deptLabel: string, title?: string): string {
  if (!deptLabel && !title) return 'agent';
  if (!title) return deptLabel;
  if (!deptLabel) return title;
  return `${deptLabel} · ${title}`;
}

async function seedAgents(): Promise<void> {
  const { agents, departments } = await fetchLive();
  const store = useStore.getState();
  for (const a of agents) {
    const deptId = a.department_id || a.department;
    const dept = deptName(deptId, departments);
    const agent: Agent = {
      id: a.codename,
      name: a.name,
      character: characterFor(a.codename, deptId),
      accent: accentFor(a.badge_color),
      description: agentDescription(dept, a.title),
      departmentId: deptId,
      teamId: a.team_id ?? undefined,
      floorId: a.floor_id ?? undefined,
      deskSlot: typeof a.desk_slot === 'number' ? a.desk_slot : undefined,
      title: a.title ?? undefined,
      deploymentStatus: deploymentFor(a.status),
      healthScore: typeof a.health_score === 'number' ? a.health_score : undefined,
      project: 'coos',
      tmuxTarget: '',
      cwd: '',
      status: statusFor(a.status),
      action: a.action || (a.status === 'active' ? 'on task' : 'on the floor'),
      progress: 0,
      currentStation: 'desk',
      isGod: a.codename === 'jazper',
      provider: 'claude',
      model: 'coos',
      recentTextTs: Date.now(),
    };
    store.addAgent(agent);
  }
  const zones = useStore.getState().departmentZones;
  const allAgents = useStore.getState().agents;
  const patched = zones.map((z) => ({
    ...z,
    rooms: z.rooms.map((room) => ({
      ...room,
      assignedAgents: allAgents.filter((ag) => ag.teamId === room.id).map((ag) => ag.id),
    })),
  }));
  useStore.getState().setDepartmentZones(patched);

  const god = allAgents.find((x) => x.isGod);
  if (god) store.selectAgent(god.id);
}

// ── websocket plane ──────────────────────────────────────────────────────────

declare global {
  interface Window {
    __cthHiveMessageListeners?: Array<(e: { from: string; targets: string[]; act: string; needsHuman: boolean }) => void>;
  }
}

function connectWS(): void {
  let ws: WebSocket | null = null;
  let retry = 0;

  const open = () => {
    const url = window.location.origin.replace(/^http/, 'ws') + '/ws/';
    ws = new WebSocket(url);
    ws.onopen = () => { retry = 0; };
    ws.onclose = () => {
      if (retry < 6) { retry += 1; setTimeout(open, 1500 * retry); }
    };
    ws.onmessage = (ev) => {
      let msg: { event?: string; payload?: Record<string, unknown> };
      try { msg = JSON.parse(ev.data as string); } catch { return; }
      const p = (msg.payload ?? {}) as Record<string, unknown>;
      const store = useStore.getState();

      if (msg.event === 'AGENT_STATUS') {
        const id = String(p.agent_id ?? '');
        if (id) {
          const patch: Partial<Agent> = { status: statusFor(String(p.status ?? '')) };
          if (p.action) patch.action = String(p.action);
          store.updateAgent(id, patch);
        }
      } else if (msg.event === 'AGENT_ACTION') {
        const id = String(p.agent_id ?? '');
        const action = String(p.action ?? '');
        if (id && action) store.updateAgent(id, { action });
      } else if (msg.event === 'AGENT_MESSAGE') {
        const from = String(p.from ?? '');
        const to = String(p.to ?? '');
        const act = String(p.act ?? 'inform');
        const listeners = window.__cthHiveMessageListeners ?? [];
        if (from && to && listeners.length) {
          const e = { from, targets: [to], act, needsHuman: false };
          listeners.slice().forEach((cb) => {
            try { cb(e); } catch { /* listener bug — never take the plane down */ }
          });
        }
      }
    };
  };

  open();
  window.addEventListener('beforeunload', () => { try { ws?.close(); } catch { /* ignore */ } });
}

// ── composer drain: queued messages → /api/hive/send ─────────────────────────

async function drainQueues(): Promise<void> {
  const s = useStore.getState();
  for (const a of s.agents) {
    const q = s.messageQueues[a.id];
    if (!q || q.length === 0) continue;
    for (const m of q) {
      try {
        const body = m.instruction || m.text || '';
        const res = await fetch(`${API}/hive/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to: a.id,
            subject: (m.text || '').slice(0, 80) || 'message',
            body,
            act: 'request',
          }),
        });
        if (res.ok) {
          useStore.getState().removeQueuedMessage(a.id, m.id);
        } else {
          break;
        }
      } catch {
        break;
      }
    }
  }
}

function startDrainLoop(): void {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await drainQueues(); } catch { /* ignore */ } finally { running = false; }
  };
  window.setInterval(tick, 1500);
  useStore.subscribe((s, prev) => {
    if (s.messageQueues !== prev.messageQueues) void tick();
  });
}

// ── entry ────────────────────────────────────────────────────────────────────

export function initCoosBridge(): void {
  if (MODE !== 'coos') return;
  const store = useStore.getState();
  store.setCoosMode(true);
  store.setGodStatus('ready');
  store.setSidebarTab('profile');
  seedOrg()
    .catch((e) => console.warn('[coos] org seed failed', e));
  seedAgents()
    .catch((e) => console.warn('[coos] seeding failed', e))
    .finally(() => {
      useStore.getState().setGodStatus('ready');
    });
  connectWS();
  startDrainLoop();
}
