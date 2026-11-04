import * as THREE from "three";
import type { OfficeTheme } from "../core/themes";
import type { World } from "../core/world";
import { PrefabLoader } from "./prefabs";

const C: Record<string, string> = { office: "#8a5a33", "carpet-blue": "#1e3a8a", "carpet-purple": "#5b2a7a", "carpet-green": "#1f6b4a", "tile-light": "#cbd5e1", "tile-dark": "#334155", stone: "#6b7280" };
const wallColors: Record<World["walls"][number]["style"], string> = { plaster: "#dfe6ee", brick: "#9b5c4b", glass: "#9dd8ee" };
type OfficeDoor = { pivot: THREE.Group; closedRotation: number; progress: number; open: boolean; locked: boolean; x: number; z: number };
type WorldInstanceRef = { mesh: THREE.InstancedMesh; index: number; source: THREE.Mesh };

const deskPlate = (owner: string) => {
  const canvas = document.createElement("canvas"); canvas.width = 256; canvas.height = 48;
  const context = canvas.getContext("2d"); if (!context) return null;
  context.fillStyle = "#0f172acc"; context.fillRect(0, 0, 256, 48); context.fillStyle = "#f8fafc"; context.font = "bold 24px system-ui"; context.textAlign = "center"; context.fillText(owner.slice(0, 24), 128, 31);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false })); sprite.scale.set(1.7, .32, 1); return sprite;
};

const addWallGeometry = (scene: THREE.Scene, world: World) => {
  const group = new THREE.Group(); const doors: OfficeDoor[] = [];
  for (const wall of world.walls) {
    const dx = wall.to[0] - wall.from[0], dz = wall.to[1] - wall.from[1];
    const count = Math.max(Math.abs(dx), Math.abs(dz), 1) + (dx || dz ? 1 : 0);
    const horizontal = Math.abs(dx) >= Math.abs(dz);
    const doorTiles = new Map<string, { door: typeof wall.doors[number]; anchor: boolean }>();
    for (const door of wall.doors) for (let offset = 0; offset < Math.max(1, door.width); offset++) {
      const x = door.at[0] + (horizontal ? offset : 0), z = door.at[1] + (horizontal ? 0 : offset);
      doorTiles.set(`${x},${z}`, { door, anchor: offset === 0 });
    }
    const windowTiles = new Set(wall.windows.map(window => `${window.at[0]},${window.at[1]}`));
    for (let index = 0; index < count; index++) {
      const x = Math.round(wall.from[0] + (count === 1 ? 0 : dx * index / (count - 1)));
      const z = Math.round(wall.from[1] + (count === 1 ? 0 : dz * index / (count - 1)));
      const doorEntry = doorTiles.get(`${x},${z}`), door = doorEntry?.door;
      if (doorEntry && !doorEntry.anchor) continue;
      if (door?.kind === "open") continue;
      if (door) {
        const pivot = new THREE.Group(); pivot.position.set(x + .5, 0, z + .5);
        const width = Math.max(.92, door.width - .08);
        const leaf = new THREE.Mesh(new THREE.BoxGeometry(horizontal ? width : .12, wall.height, horizontal ? .12 : width), new THREE.MeshStandardMaterial({ color: door.kind === "locked" ? "#7f1d1d" : door.kind === "glass" ? "#bceeff" : "#9a6b45", transparent: door.kind === "glass", opacity: door.kind === "glass" ? .6 : 1 }));
        leaf.position.set(horizontal ? width / 2 : 0, wall.height / 2, horizontal ? 0 : width / 2); pivot.add(leaf);
        const closedRotation = 0; pivot.rotation.y = closedRotation; group.add(pivot);
        doors.push({ pivot, closedRotation, progress: 0, open: false, locked: door.kind === "locked", x: x + .5, z: z + .5 }); continue;
      }
      const material = new THREE.MeshStandardMaterial({ color: wallColors[wall.style], roughness: .8, transparent: wall.style === "glass", opacity: wall.style === "glass" ? .5 : 1 });
      const segment = (height: number, center: number) => { const mesh = new THREE.Mesh(new THREE.BoxGeometry(horizontal ? 1 : .16, height, horizontal ? .16 : 1), material); mesh.position.set(x + .5, center, z + .5); group.add(mesh); };
      if (windowTiles.has(`${x},${z}`)) {
        const sill = Math.min(.85, Math.max(.45, wall.height * .34));
        const openingHeight = Math.min(.82, Math.max(.3, wall.height - sill - .28));
        const lintel = wall.height - sill - openingHeight;
        segment(sill, sill / 2);
        if (lintel > .01) segment(lintel, sill + openingHeight + lintel / 2);
        const pane = new THREE.Mesh(new THREE.BoxGeometry(horizontal ? .82 : .03, openingHeight, horizontal ? .03 : .82), new THREE.MeshBasicMaterial({ color: "#bdeeff", transparent: true, opacity: .62 })); pane.position.set(x + .5, sill + openingHeight / 2, z + .5); group.add(pane);
      } else segment(wall.height, wall.height / 2);
    }
  }
  scene.add(group); scene.userData.office3Walls = group; scene.userData.office3Doors = doors;
};

/** Batch repeated static prefab mesh layers while retaining invisible object roots for editing and metadata. */
const batchRepeatedWorldObjects = (scene: THREE.Scene, objects: ReadonlyArray<World["objects"][number]>, roots: Map<string, THREE.Object3D>) => {
  const byPrefab = new Map<string, World["objects"][number][]>();
  for (const object of objects) { const group = byPrefab.get(object.prefab) ?? []; group.push(object); byPrefab.set(object.prefab, group); }
  const instanceRoots: THREE.InstancedMesh[] = [];
  const references = new Map<string, WorldInstanceRef[]>();
  for (const group of byPrefab.values()) {
    if (group.length < 3) continue;
    const sourceRoots = group.map(object => roots.get(object.id)).filter((root): root is THREE.Object3D => Boolean(root));
    if (sourceRoots.length !== group.length) continue;
    const meshLayers = (root: THREE.Object3D) => { const layers: THREE.Mesh[] = []; root.traverse(node => { if ((node as THREE.Mesh).isMesh && !(node as THREE.SkinnedMesh).isSkinnedMesh && !Array.isArray((node as THREE.Mesh).material)) layers.push(node as THREE.Mesh); }); return layers; };
    const layers = sourceRoots.map(meshLayers), count = layers[0]?.length ?? 0;
    if (!count || layers.some(layer => layer.length !== count)) continue;
    const created: THREE.InstancedMesh[] = [];
    for (let layer = 0; layer < count; layer++) {
      const source = layers[0][layer], mesh = new THREE.InstancedMesh(source.geometry, source.material, group.length);
      mesh.frustumCulled = false;
      mesh.userData.office3WorldInstanceIds = group.map(object => object.id);
      for (let index = 0; index < group.length; index++) { sourceRoots[index].updateMatrixWorld(true); mesh.setMatrixAt(index, layers[index][layer].matrixWorld); const refs = references.get(group[index].id) ?? []; refs.push({ mesh, index, source: layers[index][layer] }); references.set(group[index].id, refs); }
      mesh.instanceMatrix.needsUpdate = true;
      scene.add(mesh); created.push(mesh);
    }
    if (created.length === count) for (const root of sourceRoots) root.visible = false;
    else for (const mesh of created) { mesh.removeFromParent(); mesh.geometry.dispose(); }
    instanceRoots.push(...created);
  }
  scene.userData.office3WorldInstanceRoots = instanceRoots;
  scene.userData.office3WorldInstanceRefs = references;
};

export function addWorld(scene: THREE.Scene, world: World, prefabs: PrefabLoader): Promise<void>[] {
  const { w, h } = world.size, canvas = document.createElement("canvas"), px = 16; canvas.width = w * px; canvas.height = h * px;
  const c = canvas.getContext("2d"); if (!c) throw Error("Office floor canvas is unavailable"); c.fillStyle = "#0b0f14"; c.fillRect(0, 0, canvas.width, canvas.height);
  for (const floorFill of world.floors) { c.fillStyle = C[floorFill.material] ?? "#444"; for (let y = floorFill.rect[1]; y <= floorFill.rect[3]; y++) for (let x = floorFill.rect[0]; x <= floorFill.rect[2]; x++) { c.fillRect(x * px, y * px, px, px); c.fillStyle = "rgba(0,0,0,.1)"; c.fillRect(x * px, y * px, px, 1); c.fillStyle = C[floorFill.material] ?? "#444"; } }
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: texture, roughness: .9 })); floor.rotation.x = -Math.PI / 2; floor.position.set(w / 2, 0, h / 2); scene.add(floor); scene.userData.office3Floor = floor;
  addWallGeometry(scene, world);
  for (const seat of world.seats) { if (!seat.owner) continue; const plate = deskPlate(seat.owner); if (!plate) continue; plate.position.set(seat.pos[0] + .5, .55, seat.pos[1] + .5); scene.add(plate); }
  const jobs: Promise<void>[] = [];
  const objectRoots = new Map<string, THREE.Object3D>(); scene.userData.office3WorldObjects = objectRoots;
  const objectJobs = world.objects.map(object => prefabs.fit(scene, object.prefab, object.pos[0] + .5, object.pos[1] + .5, 1, 1, object.rot, object.scale).then(model => { model.userData.office3WorldObjectId = object.id; model.userData.office3BaseScale = model.scale.x / object.scale; model.userData.office3Offset = [model.position.x - (object.pos[0] + .5), model.position.z - (object.pos[1] + .5)]; objectRoots.set(object.id, model); }));
  jobs.push(...objectJobs, Promise.all(objectJobs).then(() => batchRepeatedWorldObjects(scene, world.objects, objectRoots)));
  jobs.push(prefabs.fit(scene, "round-rug-v1", 49, 28, 7, 7).then(() => undefined)); return jobs;
}

export function updateDoors(scene: THREE.Scene, actorTiles: readonly [number, number][], seconds: number): boolean[] {
  const doors = scene.userData.office3Doors as OfficeDoor[] | undefined;
  const transitions: boolean[] = [];
  for (const door of doors ?? []) { const nearby = !door.locked && actorTiles.some(([x, z]) => Math.hypot(x + .5 - door.x, z + .5 - door.z) < 1.9); if (nearby !== door.open) { door.open = nearby; transitions.push(nearby); } door.progress += ((nearby ? 1 : 0) - door.progress) * Math.min(1, seconds * 7); door.pivot.rotation.y = door.closedRotation + door.progress * Math.PI / 2; }
  return transitions;
}

export function applyWorldObjectTransform(scene: THREE.Scene, id: string, object: Pick<World["objects"][number], "pos" | "rot" | "scale">): void {
  let model = (scene.userData.office3WorldObjects as Map<string, THREE.Object3D> | undefined)?.get(id);
  if (!model) scene.traverse(item => { if (item.userData.office3WorldObjectId === id) model = item; });
  if (!model) return;
  const offset = model.userData.office3Offset as [number, number] | undefined; model.position.set(object.pos[0] + .5 + (offset?.[0] ?? 0), model.position.y, object.pos[1] + .5 + (offset?.[1] ?? 0)); model.rotation.y = object.rot; model.scale.setScalar((model.userData.office3BaseScale as number) * object.scale);
  model.updateMatrixWorld(true);
  for (const reference of (scene.userData.office3WorldInstanceRefs as Map<string, WorldInstanceRef[]> | undefined)?.get(id) ?? []) { reference.mesh.setMatrixAt(reference.index, reference.source.matrixWorld); reference.mesh.instanceMatrix.needsUpdate = true; }
}

export function applyTheme(scene: THREE.Scene, theme: OfficeTheme): void {
  const floor = scene.userData.office3Floor as THREE.Mesh | undefined, walls = scene.userData.office3Walls as THREE.Object3D | undefined;
  if (floor) (floor.material as THREE.MeshStandardMaterial).color.set(theme.floor);
  walls?.traverse(item => { if (item instanceof THREE.Mesh && item.material instanceof THREE.MeshStandardMaterial && !item.material.transparent) item.material.color.set(theme.wall); }); scene.background = new THREE.Color(theme.sky);
}
