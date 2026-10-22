import { encodePosition, type PositionMessage } from "../core/netcodec";

export class OfficeSync {
  private socket: WebSocket | null = null;
  private sequence = 0;
  private readonly snapshots = new Map<string, { from: PositionMessage; to: PositionMessage; receivedAt: number }>();
  constructor(private readonly onEvent: (event: Record<string, unknown>) => void) {}
  connect(url: string, id: string): void { this.disconnect(); this.socket = new WebSocket(url); this.socket.onopen = () => this.socket?.send(JSON.stringify({ type: "hello", id })); this.socket.onmessage = event => { try { const payload = JSON.parse(event.data) as Record<string, unknown>; if (payload.type === "pos") this.capture(payload); if (payload.type === "welcome" && Array.isArray(payload.roster)) for (const member of payload.roster) if (member && typeof member === "object") this.capture(member as Record<string, unknown>); this.onEvent(payload); } catch { /* ignore malformed peer event */ } }; this.socket.onclose = () => { this.socket = null; }; }
  private capture(payload: Record<string, unknown>): void { if (typeof payload.id !== "string" || !Number.isFinite(payload.x) || !Number.isFinite(payload.z)) return; const next: PositionMessage = { type: "move", x: Number(payload.x), z: Number(payload.z), facing: Number(payload.facing ?? 0), anim: String(payload.anim ?? "walk"), seq: Number(payload.seq ?? 0) }; const prior = this.snapshots.get(payload.id)?.to ?? next; this.snapshots.set(payload.id, { from: prior, to: next, receivedAt: performance.now() }); }
  move(x: number, z: number, facing: number, anim: string): void { if (this.socket?.readyState !== WebSocket.OPEN) return; const payload: PositionMessage = { type: "move", x, z, facing, anim, seq: ++this.sequence }; this.socket.send(encodePosition(payload)); }
  cursor(x: number, z: number): void { if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ type: "cursor", x, z })); }
  send(type: "emote" | "status" | "say", value: string): void { if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ type, value })); }
  interpolated(id: string, now = performance.now(), delayMs = 100): PositionMessage | null { const snapshot = this.snapshots.get(id); if (!snapshot) return null; const progress = Math.max(0, Math.min(1, (now - snapshot.receivedAt + delayMs) / Math.max(delayMs, 1))); return { ...snapshot.to, x: snapshot.from.x + (snapshot.to.x - snapshot.from.x) * progress, z: snapshot.from.z + (snapshot.to.z - snapshot.from.z) * progress, facing: snapshot.from.facing + (snapshot.to.facing - snapshot.from.facing) * progress }; }
  forget(id: string): void { this.snapshots.delete(id); }
  disconnect(): void { this.socket?.close(); this.socket = null; }
}
