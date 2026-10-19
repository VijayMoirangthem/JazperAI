/** JSON-RPC 2.0 event client for /ws/rpc: jittered reconnect, resume by per-topic seq, duplicate suppression. */

export interface RpcEvent {
  method: string;
  seq: number;
  ts: string;
  params: Record<string, unknown>;
}

export type RpcHandler = (e: RpcEvent) => void;

interface SocketLike {
  onopen: (() => void) | null;
  onmessage: ((e: { data: string }) => void) | null;
  onclose: (() => void) | null;
  send(data: string): void;
  close(): void;
}

export interface RpcOptions {
  url: string;
  topics: string[];
  onEvent: RpcHandler;
  onStatus?: (connected: boolean) => void;
  /** injectable for tests */
  socketFactory?: (url: string) => SocketLike;
  random?: () => number;
}

export class RpcClient {
  private ws: SocketLike | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private closed = false;
  private attempts = 0;
  /** highest seq seen per topic: used for resume (`since`) and to drop duplicates after a reconnect */
  readonly lastSeq: Record<string, number> = {};

  private readonly o: RpcOptions;

  constructor(o: RpcOptions) {
    this.o = o;
    for (const t of o.topics) this.lastSeq[t] = 0;
  }

  start(): void {
    this.closed = false;
    const make = this.o.socketFactory ?? ((u: string) => new WebSocket(u) as unknown as SocketLike);
    const ws = make(this.o.url);
    this.ws = ws;
    ws.onopen = () => {
      this.attempts = 0;
      this.o.onStatus?.(true);
      ws.send(JSON.stringify({
        jsonrpc: "2.0", id: 1, method: "subscribe",
        params: { topics: this.o.topics, since: { ...this.lastSeq } },
      }));
    };
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data) as RpcEvent;
      if (typeof m.seq !== "number" || !(m.method in this.lastSeq)) return; // responses / heartbeats
      if (m.seq <= this.lastSeq[m.method]) return; // duplicate after resume
      this.lastSeq[m.method] = m.seq;
      this.o.onEvent(m);
    };
    ws.onclose = () => {
      this.o.onStatus?.(false);
      if (this.closed) return;
      const rnd = (this.o.random ?? Math.random)();
      const delay = Math.min(10_000, 500 * 2 ** this.attempts++) * (0.5 + rnd / 2);
      this.timer = setTimeout(() => this.start(), delay);
    };
  }

  stop(): void {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.ws?.close();
  }
}
