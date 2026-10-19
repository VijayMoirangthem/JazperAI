// Shared types for the 2D office floor (Munder Difflin style).

/** Live per-agent state the floor renderer needs. Mirrors the Munder
 *  renderer contract: id, status, action, carrying, lastPrompt, accent,
 *  character, isGod, archived. */
export interface FloorAgent {
  id: string;
  codename: string;
  name: string;
  status: "idle" | "thinking" | "working" | "blocked" | "compacting" | "looping" | "success" | "error" | "offline";
  action?: string;
  carrying?: string | null;
  lastPrompt?: string | null;
  accent: string;          // badge color
  deptId: string;
  level: number;
  isGod?: boolean;
  archived?: boolean;
}

export interface FloorDept {
  id: string;
  name: string;
  color: string;
  enabled: boolean;
  floor_position?: { x: number; y: number } | null;
}

export interface Room {
  id: string;
  label: string;
  color: string;
  x: number;
  y: number;
  w: number;
  h: number;
  door: { x: number; y: number }; // grid coords of the doorway
}

export interface Desk {
  id: string;      // agent id
  roomId: string;
  x: number;       // grid coords
  y: number;
}

export interface ActivityEntry {
  id: number;
  agent?: string;
  ts: number;
  kind: string;    // status | tool | cmd | message | dispatch | system
  text: string;
}

export interface HiveState {
  agents: FloorAgent[];
  departments: FloorDept[];
  board: string;
  tasks: any[];
  log: any[];
  routed: number;
  fetchedAt: number;
}