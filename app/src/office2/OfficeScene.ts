import Phaser from "phaser";
import type { LiveAgent } from "@/stores/liveAgentsStore";
import { AvatarLayer, type Avatar } from "./avatars.ts";
import { BubbleLayer } from "./bubbles.ts";
import { CameraRig } from "./cameraRig.ts";
import { Halos } from "./halos.ts";
import { Walker } from "./walker.ts";
import { assignSpot, isAttention, placeFor } from "./behavior.ts";
import { queueWoka, type WokaManifest } from "./avatarSheet.ts";
import { DEPTH, T, hashParams } from "./constants.ts";
import { parseMap } from "./mapModel.ts";
import { TagLayer } from "./tagLayer.ts";
import type { Look, MapModel, Person } from "./types.ts";

export { DEPTH, T };

export interface OfficeDebug {
  people(): { slug: string; x: number; y: number; state: string; place: string }[];
  tags(): { slug: string; x: number; y: number; w: number; h: number; visible: boolean }[];
  camera(): { x: number; y: number; zoom: number };
  groups(): string[][];
  bubbleOf(slug: string): { x: number; y: number; text: string } | null;
  screenOf(slug: string): { x: number; y: number } | null;
  walkTo(slug: string, tx: number, ty: number): void;
}

declare global {
  interface Window { __officeFps?: number; __officeFrameMs?: number; __officePeople?: number; __officeDebug?: OfficeDebug }
}

export class OfficeScene extends Phaser.Scene {
  model!: MapModel;
  avatars!: AvatarLayer;
  tags!: TagLayer;
  bubbles!: BubbleLayer;
  rig!: CameraRig;
  walker!: Walker;
  halos!: Halos;
  private lastLive: Record<string, LiveAgent> = {};
  private frames: number[] = [];
  private held = new Set<string>();
  private pending: { people: Person[]; overrides: Record<string, Partial<Look>> } | null = null;

  constructor() { super("office2"); }

  preload() {
    this.load.tilemapTiledJSON("office2-map", "/office2/map.json");
    this.load.image("office2-tiles", "/office2/tiles.png");
    this.load.json("woka-manifest", "/office2/woka/manifest.json");
    this.load.once("filecomplete-json-woka-manifest", (_key: string, _type: string, data: WokaManifest) => queueWoka(this, data));
  }

  create() {
    this.model = parseMap(this.cache.tilemap.get("office2-map").data);
    const map = this.make.tilemap({ key: "office2-map" });
    const tileset = map.addTilesetImage("tiles", "office2-tiles", T, T, 0, 0)!;
    for (const name of ["floor", "walls", "furniture", "decor"]) map.createLayer(name, tileset, 0, 0)?.setDepth(DEPTH.tiles);
    map.createLayer("overlay", tileset, 0, 0)?.setDepth(DEPTH.overlay);
    for (const a of this.model.areas) {
      if (a.kind === "transit") continue;
      this.add.text(a.x * T + 8, a.y * T + 6, a.label, { fontSize: "11px", color: "#e2e8f0", fontFamily: "system-ui, sans-serif" })
        .setAlpha(0.75).setDepth(DEPTH.tags).setResolution(2);
    }
    const host = this.game.canvas.parentElement as HTMLElement;
    this.avatars = new AvatarLayer(this, this.model);
    this.tags = new TagLayer(this, this.avatars);
    this.bubbles = new BubbleLayer(this, this.avatars);
    this.walker = new Walker(this, this.model, this.avatars);
    this.rig = new CameraRig(this, this.model, host, () => this.founder());
    this.halos = new Halos(this, this.avatars, this.model, (others) => this.events.emit("proximity", others));
    this.events.on("avatar-select", (slug: string) => this.avatars.select(slug));
    this.setupInput(host);
    if (hashParams().get("wander") === "1") this.time.addEvent({ delay: 1000, loop: true, callback: () => this.wanderTick() });
    this.time.addEvent({ delay: 60_000, loop: true, callback: () => this.applyLive(this.lastLive) });
    this.installDebug();
    window.__officeFps = 0;
    window.__officePeople = 0;
    this.time.addEvent({ delay: 1000, loop: true, callback: () => {
      window.__officeFps = Math.round(this.game.loop.actualFps);
      window.__officeFrameMs = [...this.frames].sort((x, y) => x - y)[Math.floor(this.frames.length * 0.95)] ?? 0;
    } });
    if (this.pending) { this.syncPeople(this.pending.people, this.pending.overrides); this.pending = null; }
  }

  update(_time: number, delta: number) {
    if (!this.walker) return;
    this.stepKeys();
    this.walker.update(delta);
    this.rig.update();
    this.tags.update();
    this.bubbles.update();
    this.frames.push(delta);
    if (this.frames.length > 120) this.frames.shift();
  }

  founder(): Avatar | undefined {
    for (const a of this.avatars.avatars.values()) if (a.person.kind === "human") return a;
    return undefined;
  }

  private setupInput(host: HTMLElement) {
    let downAt: { x: number; y: number } | null = null;
    let overAvatar = false;
    this.input.on("pointerdown", (p: Phaser.Input.Pointer, over: unknown[]) => { downAt = { x: p.x, y: p.y }; overAvatar = over.length > 0; });
    this.input.on("pointerup", (p: Phaser.Input.Pointer) => {
      const d = downAt; downAt = null;
      if (!d || overAvatar || p.button !== 0 || this.rig.space || Math.hypot(p.x - d.x, p.y - d.y) > 5) return;
      const f = this.founder();
      if (f && !this.walker.walkTo(f.person.slug, Math.floor(p.worldX / T), Math.floor(p.worldY / T))) this.events.emit("toast", "Can't go there");
    });
    const dirKey = (k: string) => ({ w: "up", arrowup: "up", s: "down", arrowdown: "down", a: "left", arrowleft: "left", d: "right", arrowright: "right" } as Record<string, string>)[k.toLowerCase()];
    host.addEventListener("keydown", (e) => { const k = dirKey(e.key); if (k) { this.held.add(k); e.preventDefault(); } });
    host.addEventListener("keyup", (e) => { const k = dirKey(e.key); if (k) this.held.delete(k); });
    host.addEventListener("blur", () => this.held.clear());
  }

  /** Held arrow/WASD keys move the founder one tile at a time. */
  private stepKeys() {
    const f = this.founder();
    if (!f || f.walking || !this.held.size) return;
    const d = [...this.held][0];
    const tx = Math.floor(f.sprite.x / T) + (d === "left" ? -1 : d === "right" ? 1 : 0);
    const ty = Math.floor(f.sprite.y / T) + (d === "up" ? -1 : d === "down" ? 1 : 0);
    if (this.model.blocked[ty]?.[tx] === false) this.walker.walkTo(f.person.slug, tx, ty);
  }

  private wanderAt = new Map<string, number>();
  private wanderTick() {
    const now = this.time.now;
    for (const [slug, a] of this.avatars.avatars) {
      if (!slug.startsWith("sim-") || a.walking || (this.wanderAt.get(slug) ?? 0) > now) continue;
      this.wanderAt.set(slug, now + 4000 + Math.random() * 4000);
      const s = this.model.spots[Math.floor(Math.random() * this.model.spots.length)];
      this.walker.walkTo(slug, s.x, s.y);
    }
  }

  /** Live agent states: ring colour, bubble, and walking to the room that matches the state. */
  applyLive(live: Record<string, LiveAgent>) {
    this.lastLive = live;
    if (!this.avatars) return;
    for (const [slug, l] of Object.entries(live)) {
      const a = this.avatars.avatars.get(slug);
      if (!a) continue;
      this.avatars.setState(slug, l.state);
      const text = l.bubble ?? l.reason ?? "";
      if (l.state !== "idle" && text) this.bubbles.show(slug, text, isAttention(l.state) ? null : 8000); else this.bubbles.hide(slug);
      this.route(a, placeFor(l.state, new Date().getHours()));
    }
  }

  private route(a: Avatar, place: Avatar["place"]) {
    if (a.person.kind === "human" || a.place === place) return;
    a.place = place;
    let dest: { x: number; y: number } | null = a.home;
    if (place !== "desk") {
      const taken = new Set([...this.avatars.avatars.values()].filter((o) => o !== a).map((o) => o.tile.join(",")));
      const room = (r: string) => this.model.spots.filter((s) => s.room === r && s.type === "spot");
      dest = assignSpot(room(place), taken, a.person.slug) ?? assignSpot(room("corridor"), taken, a.person.slug);
    }
    if (dest) this.walker.walkTo(a.person.slug, dest.x, dest.y);
  }

  /** Called by the panel whenever the roster changes. Safe to call before the scene has finished loading. */
  syncPeople(people: Person[], overrides: Record<string, Partial<Look>> = {}) {
    if (!this.avatars) { this.pending = { people, overrides }; return; }
    this.avatars.sync(people, overrides, hashParams().get("gather") ?? undefined);
    window.__officePeople = this.avatars.avatars.size;
    this.applyLive(this.lastLive);
  }

  private installDebug() {
    const cam = this.cameras.main;
    window.__officeDebug = {
      people: () => [...this.avatars.avatars.values()].map((a) => ({ slug: a.person.slug, x: a.sprite.x, y: a.sprite.y, state: a.state, place: a.place })),
      tags: () => this.tags.snapshot(),
      camera: () => ({ x: cam.midPoint.x, y: cam.midPoint.y, zoom: cam.zoom }),
      groups: () => this.halos.groups(),
      bubbleOf: (slug) => this.bubbles.of(slug),
      screenOf: (slug) => {
        const a = this.avatars.avatars.get(slug);
        if (!a) return null;
        const r = this.game.canvas.getBoundingClientRect();
        return { x: r.left + (a.sprite.x - cam.worldView.x) * cam.zoom, y: r.top + (a.sprite.y - cam.worldView.y) * cam.zoom };
      },
      walkTo: (slug, tx, ty) => { this.walker.walkTo(slug, tx, ty); },
    };
  }
}

export interface OfficeHandle {
  scene: OfficeScene;
  /** false pauses the render loop while the panel tab is hidden */
  setActive(active: boolean): void;
  syncPeople(people: Person[], overrides?: Record<string, Partial<Look>>): void;
  applyLive(live: Record<string, LiveAgent>): void;
  destroy(): void;
}

export async function startOffice(host: HTMLElement): Promise<OfficeHandle> {
  const scene = new OfficeScene();
  const game = new Phaser.Game({
    type: Phaser.AUTO, parent: host, backgroundColor: "#0b0f14", pixelArt: true, roundPixels: true, antialias: false,
    scale: { mode: Phaser.Scale.RESIZE, width: host.clientWidth || 800, height: host.clientHeight || 600 },
    scene,
  });
  return {
    scene,
    setActive: (active) => { if (active) game.loop.wake(); else game.loop.sleep(); },
    syncPeople: (people, overrides) => scene.syncPeople(people, overrides),
    applyLive: (live) => scene.applyLive(live),
    destroy: () => {
      game.destroy(true);
      window.__officeFps = undefined; window.__officeFrameMs = undefined; window.__officePeople = undefined; window.__officeDebug = undefined;
    },
  };
}
