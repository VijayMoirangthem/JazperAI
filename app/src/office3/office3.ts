import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { LiveAgent } from "@/stores/liveAgentsStore";
import { assignSpot, isAttention, placeFor, ringColor } from "../office2/behavior";
import { hashParams } from "../office2/constants";
import { hash } from "../office2/hash";
import { parseMap } from "../office2/mapModel";
import { findPath, nearestFree } from "../office2/pathfind";
import { planSeats } from "../office2/people";
import type { MapModel, Person, Place, Pt, Spot } from "../office2/types";

/** Office 3 (spike): the same map, people, seats, paths and live states as Office 2, rendered in 3D with DeskRPG's animated CC0 characters. */
export interface Office3Stats { fps: number; calls: number; triangles: number; people: number; loadedMs: number }
export interface Office3Handle {
  ready: Promise<void>;
  setActive(active: boolean): void;
  sync(people: Person[]): void;
  applyLive(live: Record<string, LiveAgent>): void;
  stats(): Office3Stats;
  destroy(): void;
}
declare global { interface Window { __office3Stats?: Office3Stats; __officeFps?: number; __officePeople?: number } }

const FLOOR: Record<number, string> = { 1: "#8a5a33", 2: "#b58455", 3: "#1e3a8a", 4: "#5b2a7a", 5: "#1f6b4a", 6: "#cbd5e1", 7: "#334155", 8: "#6b7280" };
const CHAR_H = 2.1, SPEED = 3.2;
type Anim = "idle" | "walk" | "sit";
interface Actor {
  person: Person; root: THREE.Group; mixer: THREE.AnimationMixer; actions: Partial<Record<Anim, THREE.AnimationAction>>; cur: Anim | null;
  ring: THREE.Mesh; label: THREE.Sprite; labelText: string; home: Spot; spot: Spot | null; path: Pt[]; tile: Pt; place: Place; state: string; bubble: string;
}

export async function startOffice3(host: HTMLElement): Promise<Office3Handle> {
  const t0 = performance.now();
  const loader = new GLTFLoader();
  const cache = new Map<string, Promise<GLTF>>();
  const load = (url: string) => { let p = cache.get(url); if (!p) { p = loader.loadAsync(url); cache.set(url, p); } return p; };

  const raw = await fetch("/office2/map.json").then((r) => r.json());
  const model: MapModel = parseMap(raw);
  const W = model.width, H = model.height;
  const layer = (n: string) => (raw.layers.find((l: { name: string }) => l.name === n).data as number[]);

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setSize(host.clientWidth || 800, host.clientHeight || 600);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  host.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#0b0f14");
  const camera = new THREE.PerspectiveCamera(35, (host.clientWidth || 800) / (host.clientHeight || 600), 0.5, 400);
  camera.position.set(W / 2, 42, H + 16);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(W / 2, 0, H / 2 + 2);
  controls.enableDamping = true; controls.maxPolarAngle = 1.25; controls.minDistance = 6; controls.maxDistance = 110;
  controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };
  scene.add(new THREE.HemisphereLight("#ffffff", "#8899aa", 1.35));
  const sun = new THREE.DirectionalLight("#fff4e0", 1.6); sun.position.set(W * 0.3, 60, H * 0.2); scene.add(sun);

  // floor: one canvas texture painted from the floor layer
  const fl = layer("floor"), PX = 16;
  const cv = document.createElement("canvas"); cv.width = W * PX; cv.height = H * PX;
  const g = cv.getContext("2d")!;
  g.fillStyle = "#0b0f14"; g.fillRect(0, 0, cv.width, cv.height);
  fl.forEach((gid, i) => { if (!gid) return; const x = (i % W) * PX, y = Math.floor(i / W) * PX; g.fillStyle = FLOOR[gid] ?? "#444"; g.fillRect(x, y, PX, PX); g.fillStyle = "rgba(0,0,0,0.10)"; g.fillRect(x, y, PX, 1); g.fillRect(x, y, 1, PX); });
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }));
  floor.rotation.x = -Math.PI / 2; floor.position.set(W / 2, 0, H / 2); scene.add(floor);

  // walls: instanced boxes
  const wl = layer("walls"), wallTiles = wl.map((v, i) => (v ? i : -1)).filter((i) => i >= 0);
  const walls = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 2.4, 1), new THREE.MeshStandardMaterial({ color: "#dfe6ee", roughness: 0.8 }), wallTiles.length);
  const m4 = new THREE.Matrix4();
  wallTiles.forEach((i, n) => { m4.makeTranslation((i % W) + 0.5, 1.2, Math.floor(i / W) + 0.5); walls.setMatrixAt(n, m4); });
  scene.add(walls);

  // furniture: connected components of the furniture layer -> GLB fitted to the block (or a simple box)
  const fur = layer("furniture"), seen = new Set<number>();
  const MODELS: Record<number, { url: string; w: number; rot?: number }> = {
    32: { url: "workstation-v1", w: 1.5 }, 33: { url: "workstation-v1", w: 1.5 }, 35: { url: "conference-table-v1", w: 0 }, 39: { url: "sofa-v1", w: 0 },
    38: { url: "counter-v1", w: 0 }, 34: { url: "low-shelf-v1", w: 0 }, 37: { url: "tech-server-rack-v1", w: 1 }, 36: { url: "tech-hardware-bench-v1", w: 1 }, 41: { url: "ficus-v1", w: 1 },
  };
  const fit = async (url: string, cx: number, cz: number, rw: number, rh: number, rot = 0) => {
    const o = cloneSkinned((await load(`/office3/models/${url}.glb`)).scene);
    const b = new THREE.Box3().setFromObject(o), s = b.getSize(new THREE.Vector3());
    const k = (rw >= rh ? rw : rh) / Math.max(s.x, s.z) * (rw >= rh ? 1 : 1);
    o.scale.setScalar(k); o.rotation.y = rot;
    const b2 = new THREE.Box3().setFromObject(o);
    o.position.set(cx - (b2.min.x + b2.max.x) / 2, -b2.min.y, cz - (b2.min.z + b2.max.z) / 2);
    scene.add(o);
  };
  const jobs: Promise<void>[] = [];
  fur.forEach((gid, i) => {
    if (!gid || seen.has(i)) return;
    let x0 = i % W, y0 = Math.floor(i / W), x1 = x0, y1 = y0; const st = [i]; seen.add(i);
    while (st.length) { const c = st.pop()!, cx = c % W, cy = Math.floor(c / W); x0 = Math.min(x0, cx); x1 = Math.max(x1, cx); y0 = Math.min(y0, cy); y1 = Math.max(y1, cy);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = cx + dx, ny = cy + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue; const n = ny * W + nx; if (fur[n] === gid && !seen.has(n)) { seen.add(n); st.push(n); } } }
    const cx = (x0 + x1 + 1) / 2, cz = (y0 + y1 + 1) / 2, rw = x1 - x0 + 1, rh = y1 - y0 + 1, spec = MODELS[gid];
    if (gid === 32 || gid === 33) jobs.push(fit("office-chair-v1", cx, cz + 1, 0.8, 0.8, Math.PI));
    if (spec) jobs.push(fit(spec.url, cx, cz, spec.w || rw, spec.w ? spec.w : rh));
    else { const b = new THREE.Mesh(new THREE.BoxGeometry(rw * 0.9, 1.9, rh * 0.9), new THREE.MeshStandardMaterial({ color: "#c0392b" })); b.position.set(cx, 0.95, cz); scene.add(b); }
  });
  jobs.push(fit("round-rug-v1", 49, 28, 7, 7));

  // characters
  const names: string[] = await fetch("/office3/characters/index.json").then((r) => r.json());
  const actors = new Map<string, Actor>();
  const mkLabel = (a: Actor) => {
    const c = document.createElement("canvas"); c.width = 256; c.height = 80; const x = c.getContext("2d")!;
    x.font = "bold 26px system-ui, sans-serif"; x.textAlign = "center";
    const name = a.person.name.split(" ")[0];
    x.fillStyle = "rgba(15,23,42,0.85)"; x.fillRect(128 - Math.max(40, x.measureText(name).width / 2 + 10), 44, Math.max(80, x.measureText(name).width + 20), 32);
    x.fillStyle = "#f8fafc"; x.fillText(name, 128, 70);
    if (a.bubble) { x.font = "20px system-ui, sans-serif"; const t = a.bubble.length > 22 ? a.bubble.slice(0, 22) + "…" : a.bubble; x.fillStyle = "#e2e8f0"; x.fillRect(128 - x.measureText(t).width / 2 - 8, 6, x.measureText(t).width + 16, 28); x.fillStyle = "#0f172a"; x.fillText(t, 128, 28); }
    const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace;
    (a.label.material as THREE.SpriteMaterial).map?.dispose(); (a.label.material as THREE.SpriteMaterial).map = tx; a.label.material.needsUpdate = true;
  };
  const play = (a: Actor, n: Anim) => {
    if (a.cur === n) return;
    const next = a.actions[n]; if (!next) return;
    next.reset().fadeIn(0.2).play(); if (a.cur) a.actions[a.cur]?.fadeOut(0.2); a.cur = n;
  };
  const tileCentre = (t: Pt): [number, number] => [t[0] + 0.5, t[1] + 0.5];
  const placeActor = (a: Actor, t: Pt) => { const [x, z] = tileCentre(t); a.root.position.set(x, 0, z); a.tile = t; a.ring.position.set(x, 0.03, z); a.label.position.set(x, CHAR_H + 0.35, z); };
  const settle = (a: Actor) => {
    if (a.spot?.type === "seat") { play(a, "sit"); a.root.rotation.y = Math.PI; a.root.position.y = 0.0; } else play(a, "idle");
  };
  const walkTo = (a: Actor, to: Spot | Pt) => {
    const goal: Pt = Array.isArray(to) ? (to as Pt) : [(to as Spot).x, (to as Spot).y];
    const here: Pt = [Math.floor(a.root.position.x), Math.floor(a.root.position.z)];
    a.spot = Array.isArray(to) ? null : (to as Spot);
    const free = model.blocked[goal[1]]?.[goal[0]] === false ? goal : nearestFree(model.blocked, goal, new Set());
    if (!free) return;
    a.path = findPath(model.blocked, here, free);
    if (a.path.length) play(a, "walk"); else settle(a);
  };

  /** Characters ship as ~10 skinned meshes with flat-colour materials: bake the colours into vertex colours and merge them into ONE skinned mesh (1 draw call per person instead of ~16). */
  const prepared = new WeakSet<GLTF>();
  const prepare = (gltf: GLTF) => {
    if (prepared.has(gltf)) return;
    prepared.add(gltf);
    const meshes: THREE.SkinnedMesh[] = [];
    gltf.scene.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(o as THREE.SkinnedMesh); });
    if (meshes.length < 2) return;
    const keep = new Set(["position", "normal", "skinIndex", "skinWeight", "color"]);
    const geos = meshes.map((m) => {
      const g = m.geometry.clone();
      const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshStandardMaterial;
      const n = g.attributes.position.count, col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { col[i * 3] = mat.color.r; col[i * 3 + 1] = mat.color.g; col[i * 3 + 2] = mat.color.b; }
      g.setAttribute("color", new THREE.BufferAttribute(col, 3));
      for (const k of Object.keys(g.attributes)) if (!keep.has(k)) g.deleteAttribute(k);
      return g;
    });
    const merged = mergeGeometries(geos, false);
    if (!merged) return;
    const first = meshes[0];
    const sm = new THREE.SkinnedMesh(merged, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 }));
    sm.position.copy(first.position); sm.quaternion.copy(first.quaternion); sm.scale.copy(first.scale); // same local transform as the mesh it replaces
    sm.bind(first.skeleton, first.bindMatrix);
    sm.frustumCulled = false;
    first.parent!.add(sm);
    for (const m of meshes) m.removeFromParent();
  };

  const addActor = async (p: Person, home: Spot) => {
    const file = names[hash(p.slug) % names.length];
    const gltf = await load(`/office3/characters/${file}`);
    if (actors.has(p.slug)) return;
    prepare(gltf);
    const obj = cloneSkinned(gltf.scene) as THREE.Group;
    const mixer = new THREE.AnimationMixer(obj), actions: Actor["actions"] = {};
    for (const c of gltf.animations) if (c.name === "idle" || c.name === "walk" || c.name === "sit") actions[c.name] = mixer.clipAction(c);
    obj.updateMatrixWorld(true);
    const h = new THREE.Box3().setFromObject(obj).getSize(new THREE.Vector3()).y; // one merged mesh now, so the box is reliable
    obj.scale.setScalar(h > 1e-3 ? CHAR_H / h : 1);
    const root = new THREE.Group(); root.add(obj); scene.add(root);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.34, 0.46, 24), new THREE.MeshBasicMaterial({ color: ringColor("idle"), side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; scene.add(ring);
    const label = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthTest: false }));
    label.scale.set(3.2, 1.0, 1); label.renderOrder = 10; scene.add(label);
    const a: Actor = { person: p, root, mixer, actions, cur: null, ring, label, labelText: "", home, spot: home, path: [], tile: [home.x, home.y], place: "desk", state: "idle", bubble: "" };
    actors.set(p.slug, a);
    placeActor(a, [home.x, home.y]); mkLabel(a); settle(a);
    mixer.update(Math.random() * 2);
  };

  let pending: Person[] = [];
  const sync = (people: Person[]) => {
    pending = people;
    const want = new Set(people.map((p) => p.slug));
    for (const [slug, a] of actors) if (!want.has(slug)) { scene.remove(a.root, a.ring, a.label); actors.delete(slug); }
    const plan = planSeats(people, model.spots);
    for (const p of people) if (!actors.has(p.slug)) void addActor(p, plan.get(p.slug)!);
  };

  let lastLive: Record<string, LiveAgent> = {};
  const applyLive = (live: Record<string, LiveAgent>) => {
    lastLive = live;
    for (const [slug, l] of Object.entries(live)) {
      const a = actors.get(slug); if (!a) continue;
      if (a.state !== l.state) { a.state = l.state; (a.ring.material as THREE.MeshBasicMaterial).color.setHex(ringColor(l.state)); }
      const b = l.state !== "idle" ? (l.bubble ?? l.reason ?? "") : "";
      if (b !== a.bubble) { a.bubble = b; mkLabel(a); }
      if (a.person.kind === "human") continue;
      const place = placeFor(l.state, new Date().getHours());
      if (place === a.place) continue;
      a.place = place;
      if (place === "desk") { walkTo(a, a.home); continue; }
      const taken = new Set([...actors.values()].filter((o) => o !== a).map((o) => o.tile.join(",")));
      const spots = (r: string) => model.spots.filter((s) => s.room === r && s.type === "spot");
      const dest = assignSpot(spots(place), taken, slug) ?? assignSpot(spots("corridor"), taken, slug);
      if (dest) walkTo(a, dest);
    }
  };

  const wander = hashParams().get("wander") === "1";
  let wanderAt = 0;
  const clock = new THREE.Clock();
  let raf = 0, running = true, frames = 0, acc = 0, fps = 0;
  const stats: Office3Stats = { fps: 0, calls: 0, triangles: 0, people: 0, loadedMs: Math.round(performance.now() - t0) };
  const loop = () => {
    raf = requestAnimationFrame(loop);
    if (!running) return;
    const dt = Math.min(clock.getDelta(), 0.1);
    for (const a of actors.values()) {
      a.mixer.update(dt);
      if (a.path.length) {
        const [tx, tz] = tileCentre(a.path[0]), p = a.root.position, dx = tx - p.x, dz = tz - p.z, d = Math.hypot(dx, dz), step = SPEED * dt;
        a.root.rotation.y = Math.atan2(dx, dz);
        if (d <= step) { p.x = tx; p.z = tz; a.tile = a.path.shift()!; if (!a.path.length) settle(a); } else { p.x += (dx / d) * step; p.z += (dz / d) * step; }
        a.ring.position.set(p.x, 0.03, p.z); a.label.position.set(p.x, CHAR_H + 0.35, p.z);
      }
    }
    if (wander) { wanderAt += dt; if (wanderAt > 1) { wanderAt = 0; for (const a of actors.values()) if (a.person.slug.startsWith("sim-") && !a.path.length && Math.random() < 0.25) walkTo(a, model.spots[Math.floor(Math.random() * model.spots.length)]); } }
    controls.update();
    renderer.render(scene, camera);
    frames++; acc += dt;
    if (acc >= 1) {
      fps = Math.round(frames / acc); frames = 0; acc = 0;
      Object.assign(stats, { fps, calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, people: actors.size });
      window.__officeFps = fps; window.__officePeople = actors.size; window.__office3Stats = { ...stats };
    }
  };
  loop();
  const ro = new ResizeObserver(() => { const w = host.clientWidth, h = host.clientHeight; if (!w || !h) return; renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); });
  ro.observe(host);
  const ready = Promise.all(jobs).then(() => { stats.loadedMs = Math.round(performance.now() - t0); });

  return {
    ready,
    setActive: (a) => { running = a; if (a) clock.getDelta(); },
    sync, applyLive: (l) => applyLive(l),
    stats: () => ({ ...stats }),
    destroy: () => {
      cancelAnimationFrame(raf); ro.disconnect(); controls.dispose(); renderer.dispose(); renderer.domElement.remove();
      window.__officeFps = undefined; window.__officePeople = undefined; window.__office3Stats = undefined; void pending; void lastLive;
    },
  };
}
