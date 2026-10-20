import Phaser from "phaser";
import { AvatarLayer } from "./avatars.ts";
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
    this.cameras.main.setBounds(0, 0, this.model.width * T, this.model.height * T);
    this.fitWorld();
    this.scale.on("resize", () => this.fitWorld());

    this.avatars = new AvatarLayer(this, this.model);
    this.tags = new TagLayer(this, this.avatars);
    this.events.on("avatar-select", (slug: string) => this.avatars.select(slug));
    this.installDebug();
    window.__officeFps = 0;
    window.__officePeople = 0;
    this.time.addEvent({ delay: 1000, loop: true, callback: () => { window.__officeFps = Math.round(this.game.loop.actualFps); } });
    if (this.pending) { this.syncPeople(this.pending.people, this.pending.overrides); this.pending = null; }
  }

  update() { this.tags?.update(); }

  /** Zoom so the whole world is visible and centre on it. */
  fitWorld() {
    const cam = this.cameras.main;
    const w = this.model.width * T, h = this.model.height * T;
    cam.setZoom(Math.min(cam.width / w, cam.height / h)).centerOn(w / 2, h / 2);
  }

  /** Called by the panel whenever the roster changes. Safe to call before the scene has finished loading. */
  syncPeople(people: Person[], overrides: Record<string, Partial<Look>> = {}) {
    if (!this.avatars) { this.pending = { people, overrides }; return; }
    this.avatars.sync(people, overrides, hashParams().get("gather") ?? undefined);
    window.__officePeople = this.avatars.avatars.size;
  }

  private installDebug() {
    const cam = this.cameras.main;
    window.__officeDebug = {
      people: () => [...this.avatars.avatars.values()].map((a) => ({ slug: a.person.slug, x: a.sprite.x, y: a.sprite.y, state: a.state, place: a.place })),
      tags: () => this.tags.snapshot(),
      camera: () => ({ x: cam.midPoint.x, y: cam.midPoint.y, zoom: cam.zoom }),
      groups: () => [],
      bubbleOf: () => null,
      screenOf: (slug) => {
        const a = this.avatars.avatars.get(slug);
        if (!a) return null;
        const r = this.game.canvas.getBoundingClientRect();
        return { x: r.left + (a.sprite.x - cam.worldView.x) * cam.zoom, y: r.top + (a.sprite.y - cam.worldView.y) * cam.zoom };
      },
      walkTo: () => undefined,
    };
  }
}

export interface OfficeHandle {
  scene: OfficeScene;
  /** false pauses the render loop while the panel tab is hidden */
  setActive(active: boolean): void;
  syncPeople(people: Person[], overrides?: Record<string, Partial<Look>>): void;
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
    destroy: () => {
      game.destroy(true);
      window.__officeFps = undefined; window.__officeFrameMs = undefined; window.__officePeople = undefined; window.__officeDebug = undefined;
    },
  };
}
