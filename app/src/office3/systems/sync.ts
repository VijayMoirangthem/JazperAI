import { encodePosition, type PositionMessage } from "../core/netcodec";

export class OfficeSync {
  private socket: WebSocket | null = null;
  private sequence = 0;
  private url = "";
  private identity = "";
  private retryTimer: number | null = null;
  private retryMs = 500;
  private reconnectAttempt = 0;
  private stopped = true;
  private connectedOnce = false;
  private readonly snapshots = new Map<string, { from: PositionMessage; to: PositionMessage; receivedAt: number }>();
  constructor(private readonly onEvent: (event: Record<string, unknown>) => void) {}
  connect(url: string, id: string): void { this.disconnect(); this.url = url; this.identity = id; this.stopped = false; this.open(); }
  private open(): void {
    if (this.stopped || !this.url || !this.identity) return;
    const socket = this.socket = new WebSocket(this.url);
    socket.onopen = () => { if (this.socket !== socket) return; const rejoined = this.connectedOnce; this.connectedOnce = true; this.retryMs = 500; this.reconnectAttempt = 0; socket.send(JSON.stringify({ type: "hello", id: this.identity })); this.onEvent({ type: rejoined ? "rejoin" : "connect" }); };
    socket.onmessage = event => { try { const payload = JSON.parse(event.data) as Record<string, unknown>; if (payload.type === "pos") this.capture(payload); if (payload.type === "welcome" && Array.isArray(payload.roster)) for (const member of payload.roster) if (member && typeof member === "object") this.capture(member as Record<string, unknown>); this.onEvent(payload); } catch { /* ignore malformed peer event */ } };
    socket.onclose = () => { if (this.socket !== socket) return; this.socket = null; if (this.stopped) return; this.onEvent({ type: "drop" }); const baseDelay = this.retryMs; this.retryMs = Math.min(this.retryMs * 2, 8000); this.reconnectAttempt++; const delay = Math.round(baseDelay * (.85 + Math.random() * .3)); this.onEvent({ type: "reconnecting", attempt: this.reconnectAttempt, delay }); this.retryTimer = window.setTimeout(() => this.open(), delay); };
  }
  private capture(payload: Record<string, unknown>): void { if (typeof payload.id !== "string" || !Number.isFinite(payload.x) || !Number.isFinite(payload.z)) return; const next: PositionMessage = { type: "move", x: Number(payload.x), z: Number(payload.z), facing: Number(payload.facing ?? 0), anim: String(payload.anim ?? "walk"), seq: Number(payload.seq ?? 0) }; const prior = this.snapshots.get(payload.id)?.to ?? next; this.snapshots.set(payload.id, { from: prior, to: next, receivedAt: performance.now() }); }
  move(x: number, z: number, facing: number, anim: string): void { if (this.socket?.readyState !== WebSocket.OPEN) return; const payload: PositionMessage = { type: "move", x, z, facing, anim, seq: ++this.sequence }; this.socket.send(encodePosition(payload)); }
  cursor(x: number, z: number): void { if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ type: "cursor", x, z })); }
  send(type: "emote" | "status" | "say", value: string): void { if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ type, value })); }
  inviteConversation(to: string): void { if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ type: "conv.invite", to })); }
  respondToConversationInvite(to: string, response: "accept" | "decline"): void { if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify({ type: "conv.invite.response", to, value: response })); }
  interpolated(id: string, now = performance.now(), delayMs = 100): PositionMessage | null { const snapshot = this.snapshots.get(id); if (!snapshot) return null; const progress = Math.max(0, Math.min(1, (now - snapshot.receivedAt + delayMs) / Math.max(delayMs, 1))); return { ...snapshot.to, x: snapshot.from.x + (snapshot.to.x - snapshot.from.x) * progress, z: snapshot.from.z + (snapshot.to.z - snapshot.from.z) * progress, facing: snapshot.from.facing + (snapshot.to.facing - snapshot.from.facing) * progress }; }
  forget(id: string): void { this.snapshots.delete(id); }
  disconnect(): void { this.stopped = true; if (this.retryTimer !== null) window.clearTimeout(this.retryTimer); this.retryTimer = null; this.socket?.close(); this.socket = null; this.connectedOnce = false; this.reconnectAttempt = 0; }
}
