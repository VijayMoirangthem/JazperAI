"use client";

import { useEffect, useRef, useState } from "react";
import { UserPlus, X } from "lucide-react";
import { bfs, near, pickSpot, placeFor, type Place, type Pt } from "@/office/behavior";
import { CREW_COLOR, DIRS, FRAME_H, FRAME_W, drawStrip, portrait } from "@/office/sprites";
import { useLiveAgents } from "@/stores/liveAgentsStore";

const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";
const WS_URL = API.replace(/^http/, "ws") + "/ws/rpc";
const T = 32;
const SCALE = 2;
const OPS_CREWS = new Set(["personal", "boardmint", "people", "sre", "l1", "human"]);
const STATE_RING: Record<string, number> = { idle: 0x64748b, working: 0x22c55e, planning: 0x38bdf8, waiting_human: 0xf59e0b, error: 0xef4444, testing: 0xa855f7, waiting_tool: 0x14b8a6, repairing: 0xf97316 };

interface Person { slug: string; name: string; role: string; crew: string; kind: "human" | "bot"; lifecycle?: string }
interface Rooms { [k: string]: { name: string; rect: number[]; desks?: number[][]; spots?: number[][] } }

declare global { interface Window { __officeFps?: number; __officePeople?: number } }

export function OfficePanel() {
  const host = useRef<HTMLDivElement>(null);
  const connect = useLiveAgents((s) => s.connect);
  const [selected, setSelected] = useState<(Person & { state: string }) | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ slug: "", name: "", role: "", crew: "baeit" });
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => connect(WS_URL), [connect]);

  useEffect(() => {
    let game: import("phaser").Game | null = null;
    let unsub: (() => void) | null = null;
    let cancelled = false;

    (async () => {
      const Phaser = (await import("phaser")).default;
      const [rooms, dir, roster] = await Promise.all([
        fetch("/office/rooms.json").then((r) => r.json() as Promise<Rooms>),
        fetch(`${API}/api/v1/directory/`).then((r) => r.json()).catch(() => ({ humans: [] })),
        fetch(`${API}/api/v1/bots/`).then((r) => r.json()).catch(() => ({ bots: [] })),
      ]);
      if (cancelled || !host.current) return;
      const people: Person[] = [
        ...(dir.humans ?? []).map((h: { id: string; display_name: string }) => ({ slug: h.id, name: h.display_name, role: "Founder", crew: "human", kind: "human" as const })),
        ...(roster.bots ?? []).filter((b: { enabled: boolean }) => b.enabled)
          .map((b: { slug: string; display_name: string; role_title: string; crew: string; lifecycle?: string }) => ({ slug: b.slug, name: b.display_name, role: b.role_title, crew: b.crew, kind: "bot" as const, lifecycle: b.lifecycle })),
      ];
      const byCrew = (p: Person) => (OPS_CREWS.has(p.crew) ? rooms.operations : rooms.engineering);

      class OfficeScene extends Phaser.Scene {
        blocked: boolean[][] = [];
        agents = new Map<string, { person: Person; sprite: Phaser.GameObjects.Sprite; ring: Phaser.GameObjects.Arc; label: Phaser.GameObjects.Text; bubble: Phaser.GameObjects.Text; tile: Pt; desk: Pt; place: Place; walking: boolean; state: string }>();
        taken = new Set<string>();
        links!: Phaser.GameObjects.Graphics;
        constructor() { super("office"); }
        preload() { this.load.tilemapTiledJSON("office", "/office/map.json"); }

        tiles() {
          const c = document.createElement("canvas"); c.width = T * 9; c.height = T;
          const x = c.getContext("2d")!;
          const tile = (i: number, base: string, f: (ox: number) => void) => { x.fillStyle = base; x.fillRect(i * T, 0, T, T); f(i * T); };
          tile(0, "#1e293b", (o) => { x.fillStyle = "#223149"; x.fillRect(o, 0, 16, 16); x.fillRect(o + 16, 16, 16, 16); });
          tile(1, "#475569", (o) => { x.fillStyle = "#334155"; for (let r = 0; r < 4; r++) { x.fillRect(o, r * 8 + 7, T, 1); x.fillRect(o + (r % 2 ? 8 : 20), r * 8, 1, 8); } });
          tile(2, "#1e293b", (o) => { x.fillStyle = "#7c4a1d"; x.fillRect(o + 3, 6, 26, 18); x.fillStyle = "#5b3513"; x.fillRect(o + 3, 22, 26, 2); x.fillStyle = "#0f172a"; x.fillRect(o + 11, 2, 10, 8); x.fillStyle = "#38bdf8"; x.fillRect(o + 12, 3, 8, 6); });
          tile(3, "#172554", (o) => { x.fillStyle = "#1e3a8a"; x.fillRect(o + 2, 2, 28, 28); });
          tile(4, "#3f2a14", (o) => { x.fillStyle = "#6b4423"; x.fillRect(o, 4, T, 24); x.fillStyle = "#8a5a2b"; x.fillRect(o, 4, T, 3); });
          tile(5, "#1e293b", (o) => { x.fillStyle = "#7c4a1d"; x.fillRect(o + 10, 20, 12, 10); x.fillStyle = "#16a34a"; x.beginPath(); x.arc(o + 16, 14, 11, 0, 7); x.fill(); x.fillStyle = "#22c55e"; x.beginPath(); x.arc(o + 13, 11, 6, 0, 7); x.fill(); });
          tile(6, "#3b1d4a", (o) => { x.fillStyle = "#4c2a5e"; x.fillRect(o + 3, 3, 26, 26); x.strokeStyle = "#7e4a96"; x.strokeRect(o + 6, 6, 20, 20); });
          tile(7, "#1e293b", (o) => { x.fillStyle = "#334155"; x.fillRect(o + 3, 3, 26, 26); x.fillStyle = "#0b1220"; x.fillRect(o + 6, 6, 20, 12); x.fillStyle = "#22c55e"; x.fillRect(o + 8, 22, 4, 3); x.fillStyle = "#f59e0b"; x.fillRect(o + 15, 22, 4, 3); });
          tile(8, "#3b1d4a", (o) => { x.fillStyle = "#9f1239"; x.fillRect(o + 1, 8, 30, 18); x.fillStyle = "#be123c"; x.fillRect(o + 1, 5, 30, 6); });
          this.textures.addCanvas("tiles", c);
        }

        create() {
          this.tiles();
          const map = this.make.tilemap({ key: "office" });
          const ts = map.addTilesetImage("tiles", "tiles", T, T)!;
          const layer = map.createLayer("office", ts, 0, 0)!;
          const solid = new Set([2, 3, 5, 6, 8, 9]);
          this.blocked = Array.from({ length: map.height }, (_, y) => Array.from({ length: map.width }, (_, x) => solid.has(layer.getTileAt(x, y)?.index ?? 0)));
          for (const r of Object.values(rooms)) this.add.text(r.rect[0] * T + 6, r.rect[1] * T + 4, r.name, { fontSize: "10px", color: "#94a3b8" }).setAlpha(0.7);
          this.links = this.add.graphics();

          const seats = { engineering: [...(rooms.engineering.desks ?? [])], operations: [...(rooms.operations.desks ?? [])] };
          const lounge = rooms.lounge.spots ?? [];
          people.forEach((p, i) => {
            const room = byCrew(p) === rooms.operations ? seats.operations : seats.engineering;
            const seat = (p.kind === "human" ? seats.operations.shift() : room.shift()) ?? lounge[i % lounge.length];
            const key = `char_${p.slug}`;
            const strip = document.createElement("canvas");
            drawStrip(strip, p.slug, p.crew);
            const tex = this.textures.addCanvas(key, strip)!;
            for (let f = 0; f < 8; f++) tex.add(f, 0, f * FRAME_W, 0, FRAME_W, FRAME_H);
            const sprite = this.add.sprite(seat[0] * T + T / 2, seat[1] * T + T / 2 - 4, key, 0).setScale(SCALE).setInteractive({ useHandCursor: true });
            const ring = this.add.circle(sprite.x, sprite.y + 14, 6, STATE_RING.idle, 0.9).setDepth(0).setScale(1.4, 0.5);
            const label = this.add.text(sprite.x, sprite.y + 20, p.name.split(" ")[0], { fontSize: "9px", color: "#cbd5e1" }).setOrigin(0.5, 0);
            const bubble = this.add.text(sprite.x, sprite.y - 22, "", { fontSize: "9px", color: "#0f172a", backgroundColor: "#e2e8f0", padding: { x: 4, y: 2 } }).setOrigin(0.5, 1).setVisible(false).setDepth(10);
            sprite.setDepth(1);
            const tile: Pt = [seat[0], seat[1]];
            this.agents.set(p.slug, { person: p, sprite, ring, label, bubble, tile, desk: tile, place: "desk", walking: false, state: "idle" });
            sprite.on("pointerdown", () => setSelected({ ...p, state: this.agents.get(p.slug)!.state }));
          });

          // click the floor: the founder (first human) walks there
          const me = people.find((p) => p.kind === "human");
          this.input.on("pointerdown", (ptr: Phaser.Input.Pointer, over: unknown[]) => {
            if (!me || over.length) return;
            this.walkTo(me.slug, [Math.floor(ptr.worldX / T), Math.floor(ptr.worldY / T)]);
          });

          const apply = (live: ReturnType<typeof useLiveAgents.getState>["agents"]) => {
            for (const a of Object.values(live)) {
              const ag = this.agents.get(a.slug);
              if (!ag) continue;
              ag.state = a.state;
              ag.ring.setFillStyle(STATE_RING[a.state] ?? STATE_RING.idle);
              const text = a.bubble ?? a.reason ?? "";
              ag.bubble.setText(text.slice(0, 40)).setVisible(a.state !== "idle" && !!text);
              if (ag.person.kind === "bot") this.goPlace(a.slug, placeFor(a.state, new Date().getHours()));
            }
          };
          apply(useLiveAgents.getState().agents);
          unsub = useLiveAgents.subscribe((st) => apply(st.agents));
          this.time.addEvent({ delay: 60_000, loop: true, callback: () => apply(useLiveAgents.getState().agents) }); // lunch schedule tick
          this.time.addEvent({ delay: 400, loop: true, callback: () => this.proximity() });
          this.time.addEvent({ delay: 1000, loop: true, callback: () => { window.__officeFps = Math.round(this.game.loop.actualFps); window.__officePeople = this.agents.size; } });
        }

        goPlace(slug: string, place: Place) {
          const ag = this.agents.get(slug);
          if (!ag || ag.place === place) return;
          ag.place = place;
          if (place === "desk") return this.walkTo(slug, ag.desk);
          const spots = (rooms[place === "meeting" ? "meeting" : place === "tools" ? "tools" : "lounge"].spots ?? []) as number[][];
          const taken = new Set([...this.agents.values()].filter((o) => o !== ag).map((o) => o.tile.join(",")));
          const spot = pickSpot(spots, taken, (s) => s.join(","), [...this.agents.keys()].indexOf(slug));
          if (spot) this.walkTo(slug, [spot[0], spot[1]]);
        }

        walkTo(slug: string, to: Pt) {
          const ag = this.agents.get(slug);
          if (!ag) return;
          const path = bfs(this.blocked, ag.tile, to);
          if (!path.length) return;
          ag.tile = to;
          const seq = path.map(([x, y]) => ({ x: x * T + T / 2, y: y * T + T / 2 - 4, duration: 140 }));
          ag.walking = true;
          let step = 0;
          const run = (i: number) => {
            if (i >= seq.length) { ag.walking = false; ag.sprite.setFrame(0); return; }
            const dx = seq[i].x - ag.sprite.x, dy = seq[i].y - ag.sprite.y;
            const dirName = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? "left" : "right") : (dy < 0 ? "up" : "down");
            ag.sprite.setFrame(DIRS.indexOf(dirName) * 2 + (step++ % 2));
            this.tweens.add({
              targets: ag.sprite, x: seq[i].x, y: seq[i].y, duration: seq[i].duration,
              onUpdate: () => { ag.ring.setPosition(ag.sprite.x, ag.sprite.y + 18); ag.label.setPosition(ag.sprite.x, ag.sprite.y + 20); ag.bubble.setPosition(ag.sprite.x, ag.sprite.y - 22); ag.sprite.setDepth(ag.sprite.y); },
              onComplete: () => run(i + 1),
            });
          };
          run(0);
        }

        proximity() {
          this.links.clear().lineStyle(1, 0x60a5fa, 0.5);
          const list = [...this.agents.values()].filter((a) => !a.walking);
          for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
            if (near(list[i].tile, list[j].tile, 2)) this.links.lineBetween(list[i].sprite.x, list[i].sprite.y, list[j].sprite.x, list[j].sprite.y);
          }
        }
      }

      game = new Phaser.Game({
        type: Phaser.AUTO, parent: host.current, width: 40 * T, height: 24 * T, backgroundColor: "#0b0f14", scene: OfficeScene, pixelArt: true,
        scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
      });
    })();

    return () => { cancelled = true; unsub?.(); game?.destroy(true); };
  }, [reloadKey]);

  const addEmployee = async () => {
    if (!form.slug || !form.name) return;
    await fetch(`${API}/api/v1/bots/`, {
      method: "PUT", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug: form.slug, display_name: form.name, role_title: form.role || "Team member", crew: form.crew,
        prompt: `You are ${form.name}, ${form.role || "a team member"} in the ${form.crew} crew of Sir Jasper AI. Be concise and concrete.` }),
    });
    setAdding(false); setForm({ slug: "", name: "", role: "", crew: "baeit" }); setReloadKey((k) => k + 1);
  };

  return (
    <div className="relative flex h-full min-h-[560px] flex-col p-3">
      <div className="mb-2 flex items-center gap-3">
        <h2 className="text-lg font-semibold">Virtual Office</h2>
        <span className="text-xs opacity-60">Agents walk to rooms by what they are doing · click a person for their ID card · click the floor to walk the founder</span>
        <button onClick={() => setAdding(true)} className="ml-auto flex items-center gap-1 rounded border px-3 py-1 text-sm"><UserPlus size={14} />Add employee</button>
      </div>
      <div ref={host} className="min-h-0 flex-1" />
      {selected && (
        <div className="absolute right-6 top-14 w-64 rounded-2xl bg-black/80 p-4 ring-1 ring-white/20">
          <button className="absolute right-3 top-3" onClick={() => setSelected(null)}><X size={14} /></button>
          <img src={portrait(selected.slug, selected.crew)} alt="" className="mx-auto h-32" style={{ imageRendering: "pixelated" }} />
          <div className="mt-2 text-center font-semibold">{selected.name}</div>
          <div className="text-center text-xs opacity-70">{selected.role}</div>
          <div className="mt-3 flex flex-wrap justify-center gap-2 text-[11px]">
            <span className="rounded px-2 py-0.5" style={{ background: CREW_COLOR[selected.crew] ?? "#475569", color: "#0b0f14" }}>{selected.crew}</span>
            <span className="rounded bg-white/10 px-2 py-0.5">{selected.kind}</span>
            {selected.lifecycle && <span className="rounded bg-white/10 px-2 py-0.5">{selected.lifecycle}</span>}
            <span className="rounded bg-white/10 px-2 py-0.5">{selected.state}</span>
          </div>
          <div className="mt-2 text-center font-mono text-[10px] opacity-50">{selected.slug}</div>
        </div>
      )}
      {adding && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/60">
          <div className="w-80 space-y-2 rounded-2xl bg-neutral-900 p-4 ring-1 ring-white/20">
            <div className="font-semibold">Add employee</div>
            {(["slug", "name", "role"] as const).map((k) => (
              <input key={k} placeholder={k === "slug" ? "slug (a-z, 0-9, -)" : k} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} className="w-full rounded border bg-transparent px-2 py-1 text-sm" />
            ))}
            <select value={form.crew} onChange={(e) => setForm({ ...form, crew: e.target.value })} className="w-full rounded border bg-transparent px-2 py-1 text-sm">
              {Object.keys(CREW_COLOR).filter((c) => c !== "human").map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <div className="flex justify-end gap-2"><button onClick={() => setAdding(false)} className="rounded border px-3 py-1 text-sm">Cancel</button><button onClick={addEmployee} className="rounded bg-green-700 px-3 py-1 text-sm">Add</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
