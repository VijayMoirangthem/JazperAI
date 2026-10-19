"use client";

import { useEffect, useRef } from "react";
import { useLiveAgents } from "@/stores/liveAgentsStore";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const WS_URL = API.replace(/^http/, "ws") + "/ws/rpc";
const T = 32;

interface Person {
  slug: string;
  name: string;
  kind: "human" | "bot";
}

const STATE_COLOR: Record<string, number> = {
  idle: 0x64748b, working: 0x22c55e, planning: 0x38bdf8, waiting_human: 0xf59e0b, error: 0xef4444, testing: 0xa855f7,
};

/** 2D virtual office on Phaser + a Tiled-format map (public/office/map.json). Original generated art, no licensed assets. */
export function OfficePanel() {
  const host = useRef<HTMLDivElement>(null);
  const connect = useLiveAgents((s) => s.connect);
  useEffect(() => connect(WS_URL), [connect]);

  useEffect(() => {
    let game: import("phaser").Game | null = null;
    let unsub: (() => void) | null = null;
    let cancelled = false;

    (async () => {
      const Phaser = (await import("phaser")).default;
      const [desks, dir] = await Promise.all([
        fetch("/office/desks.json").then((r) => r.json() as Promise<number[][]>),
        fetch(`${API}/api/v1/directory/`).then((r) => r.json()).catch(() => ({ humans: [], bots: [] })),
      ]);
      if (cancelled || !host.current) return;
      const people: Person[] = [
        ...(dir.humans ?? []).map((h: { id: string; display_name: string }) => ({ slug: h.id, name: h.display_name, kind: "human" as const })),
        ...(dir.bots ?? []).filter((b: { lifecycle: string }) => b.lifecycle === "active")
          .map((b: { id: string; display_name: string }) => ({ slug: b.id, name: b.display_name, kind: "bot" as const })),
      ].slice(0, desks.length);

      class OfficeScene extends Phaser.Scene {
        sprites = new Map<string, { body: Phaser.GameObjects.Arc; bubble: Phaser.GameObjects.Text; label: Phaser.GameObjects.Text }>();
        blocked: boolean[][] = [];
        constructor() { super("office"); }
        preload() { this.load.tilemapTiledJSON("office", "/office/map.json"); }
        create() {
          // generated tileset: floor, wall, desk, carpet
          const g = this.make.graphics({ x: 0, y: 0 }, false);
          const cols = [0x1e293b, 0x475569, 0x92400e, 0x172554];
          cols.forEach((c, i) => { g.fillStyle(c); g.fillRect(i * T, 0, T, T); g.lineStyle(1, 0x0f172a, 0.6); g.strokeRect(i * T, 0, T, T); });
          g.generateTexture("tiles", T * 4, T);
          const map = this.make.tilemap({ key: "office" });
          const ts = map.addTilesetImage("tiles", "tiles", T, T)!;
          const layer = map.createLayer("office", ts, 0, 0)!;
          this.blocked = Array.from({ length: map.height }, (_, y) =>
            Array.from({ length: map.width }, (_, x) => { const i = layer.getTileAt(x, y)?.index; return i === 2 || i === 3; }));
          people.forEach((p, i) => {
            const [dx, dy] = desks[i];
            const x = dx * T + T / 2, y = (dy + 1) * T + T / 2; // sit just below the desk
            const body = this.add.circle(x, y, 11, p.kind === "human" ? 0xfbbf24 : STATE_COLOR.idle).setStrokeStyle(2, 0xffffff, 0.8);
            const label = this.add.text(x, y + 16, p.name.split(" ")[0], { fontSize: "10px", color: "#cbd5e1" }).setOrigin(0.5, 0);
            const bubble = this.add.text(x, y - 18, "", { fontSize: "10px", color: "#0f172a", backgroundColor: "#e2e8f0", padding: { x: 4, y: 2 } })
              .setOrigin(0.5, 1).setVisible(false);
            this.sprites.set(p.slug, { body, bubble, label });
          });
          // click-to-move: first person follows clicks via BFS path on the tile grid
          const me = this.sprites.get(people[0]?.slug ?? "");
          this.input.on("pointerdown", (ptr: Phaser.Input.Pointer) => {
            if (!me) return;
            const from = [Math.floor(me.body.x / T), Math.floor(me.body.y / T)];
            const to = [Math.floor(ptr.worldX / T), Math.floor(ptr.worldY / T)];
            const path = this.bfs(from, to);
            if (path.length) this.walk(me.body, [me.label, me.bubble], path);
          });
          // bind to live agent-state-change events
          const apply = (agents: ReturnType<typeof useLiveAgents.getState>["agents"]) => {
            for (const a of Object.values(agents)) {
              const s = this.sprites.get(a.slug);
              if (!s) continue;
              s.body.setFillStyle(STATE_COLOR[a.state] ?? STATE_COLOR.idle);
              const text = a.bubble ?? a.reason ?? "";
              s.bubble.setText(text.slice(0, 40)).setVisible(a.state !== "idle" && !!text);
            }
          };
          apply(useLiveAgents.getState().agents);
          unsub = useLiveAgents.subscribe((st) => apply(st.agents));
        }
        bfs(from: number[], to: number[]): number[][] {
          const H = this.blocked.length, W = this.blocked[0].length, key = (x: number, y: number) => y * W + x;
          if (to[0] < 0 || to[1] < 0 || to[0] >= W || to[1] >= H || this.blocked[to[1]][to[0]]) return [];
          const prev = new Map<number, number>([[key(from[0], from[1]), -1]]);
          const q = [from];
          while (q.length) {
            const [x, y] = q.shift()!;
            if (x === to[0] && y === to[1]) break;
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
              const nx = x + dx, ny = y + dy;
              if (nx < 0 || ny < 0 || nx >= W || ny >= H || this.blocked[ny][nx] || prev.has(key(nx, ny))) continue;
              prev.set(key(nx, ny), key(x, y));
              q.push([nx, ny]);
            }
          }
          if (!prev.has(key(to[0], to[1]))) return [];
          const out: number[][] = [];
          for (let k = key(to[0], to[1]); k !== -1; k = prev.get(k)!) out.unshift([k % W, Math.floor(k / W)]);
          return out.slice(1);
        }
        walk(body: Phaser.GameObjects.Arc, followers: Phaser.GameObjects.Text[], path: number[][]) {
          this.tweens.chain({
            targets: body,
            tweens: path.map(([x, y]) => ({
              x: x * T + T / 2, y: y * T + T / 2, duration: 120,
              onUpdate: () => { followers[0].setPosition(body.x, body.y + 16); followers[1].setPosition(body.x, body.y - 18); },
            })),
          });
        }
      }

      game = new Phaser.Game({
        type: Phaser.AUTO, parent: host.current, width: 30 * T, height: 18 * T, backgroundColor: "#0b0f14",
        scene: OfficeScene, pixelArt: true,
      });
    })();

    return () => { cancelled = true; unsub?.(); game?.destroy(true); };
  }, []);

  return (
    <div className="p-4 space-y-2">
      <h2 className="text-lg font-semibold">Virtual Office</h2>
      <p className="text-xs opacity-60">Left wing: engineering desks. Right wing: operations. Click the floor to walk the first person; bubbles follow live agent events.</p>
      <div ref={host} style={{ width: 30 * T, height: 18 * T }} />
    </div>
  );
}
