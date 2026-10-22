import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { hash } from "../../office2/hash";
import { ringColor } from "../../office2/behavior";
import type { Person, Place, Pt, Spot } from "../../office2/types";
import { createLabel, updateLabel } from "./labels";
import type { PrefabLoader } from "./prefabs";
import { facingYaw } from "../core/seats";
import { defaultAppearance, parseAppearance, type Appearance } from "../core/appearance";
import { applyAttachments } from "./attachments";

export type ActorAnimation = "idle" | "walk" | "sit";
export const CHARACTER_HEIGHT = 2.1;
export interface OfficeActor {
  person: Person; root: THREE.Group; mixer: THREE.AnimationMixer; actions: Partial<Record<ActorAnimation, THREE.AnimationAction>>; current: ActorAnimation | null;
  ring: THREE.Mesh; label: THREE.Sprite; home: Spot; spot: Spot | null; path: Pt[]; tile: Pt; place: Place; state: string; bubble: string; task: string; mood: string; rankColor: string; appearance: Appearance;
}

const prepared = new WeakSet<GLTF>();

function prepare(gltf: GLTF): void {
  if (prepared.has(gltf)) return;
  prepared.add(gltf);
  const meshes: THREE.SkinnedMesh[] = [];
  gltf.scene.traverse((object) => { if ((object as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(object as THREE.SkinnedMesh); });
  if (meshes.length < 2) return;
  const allowed = new Set(["position", "normal", "skinIndex", "skinWeight", "color", "region"]);
  const geometries = meshes.map((mesh, meshIndex) => {
    const geometry = mesh.geometry.clone();
    const material = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.MeshStandardMaterial;
    const colors = new Float32Array(geometry.attributes.position.count * 3);
    for (let index = 0; index < geometry.attributes.position.count; index++) {
      colors[index * 3] = material.color.r; colors[index * 3 + 1] = material.color.g; colors[index * 3 + 2] = material.color.b;
    }
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const name = material.name.toLowerCase();
    const region = name.includes("skin") || name.includes("face") ? 0 : name.includes("hair") ? 1 : name.includes("shoe") || name.includes("foot") ? 4 : name.includes("pant") || name.includes("bottom") ? 3 : name.includes("shirt") || name.includes("top") || name.includes("cloth") ? 2 : meshIndex % 5;
    geometry.setAttribute("region", new THREE.BufferAttribute(new Float32Array(geometry.attributes.position.count).fill(region), 1));
    for (const name of Object.keys(geometry.attributes)) if (!allowed.has(name)) geometry.deleteAttribute(name);
    return geometry;
  });
  const merged = mergeGeometries(geometries, false);
  if (!merged) return;
  const source = meshes[0];
  const skinned = new THREE.SkinnedMesh(merged, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 }));
  skinned.position.copy(source.position); skinned.quaternion.copy(source.quaternion); skinned.scale.copy(source.scale);
  skinned.bind(source.skeleton, source.bindMatrix); skinned.frustumCulled = false;
  source.parent?.add(skinned);
  for (const mesh of meshes) mesh.removeFromParent();
}

export function play(actor: OfficeActor, animation: ActorAnimation): void {
  if (actor.current === animation) return;
  const next = actor.actions[animation];
  if (!next) return;
  next.reset().fadeIn(0.2).play();
  if (actor.current) actor.actions[actor.current]?.fadeOut(0.2);
  actor.current = animation;
}

export function placeActor(actor: OfficeActor, tile: Pt): void {
  actor.root.position.set(tile[0] + 0.5, 0, tile[1] + 0.5); actor.tile = tile;
  actor.ring.position.set(tile[0] + 0.5, 0.03, tile[1] + 0.5);
  actor.label.position.set(tile[0] + 0.5, CHARACTER_HEIGHT + 0.35, tile[1] + 0.5);
}

export function settle(actor: OfficeActor): void {
  if (actor.spot?.type === "seat") { play(actor, "sit"); actor.root.rotation.y = facingYaw(actor.spot.facing ?? "up"); actor.root.position.y = 0; }
  else play(actor, "idle");
}

export async function addActor(scene: THREE.Scene, actors: Map<string, OfficeActor>, loader: PrefabLoader, names: string[], person: Person, home: Spot): Promise<void> {
  const file = names[hash(person.slug) % names.length];
  const gltf = await loader.load(`/office3/characters/${file}`);
  if (actors.has(person.slug)) return;
  prepare(gltf);
  const object = cloneSkinned(gltf.scene) as THREE.Group;
  const mixer = new THREE.AnimationMixer(object), actions: OfficeActor["actions"] = {};
  for (const clip of gltf.animations) if (clip.name === "idle" || clip.name === "walk" || clip.name === "sit") actions[clip.name] = mixer.clipAction(clip);
  object.updateMatrixWorld(true);
  const modelHeight = new THREE.Box3().setFromObject(object).getSize(new THREE.Vector3()).y;
  object.scale.setScalar(modelHeight > 0.001 ? CHARACTER_HEIGHT / modelHeight : 1);
  const root = new THREE.Group(); root.add(object); scene.add(root);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.34, 0.46, 24), new THREE.MeshBasicMaterial({ color: ringColor("idle"), side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2; scene.add(ring);
  const label = createLabel(); scene.add(label);
  const actor: OfficeActor = { person, root, mixer, actions, current: null, ring, label, home, spot: home, path: [], tile: [home.x, home.y], place: "desk", state: "idle", bubble: "", task: "", mood: "", rankColor: "", appearance: defaultAppearance(file.replace(/\.glb$/i, "")) };
  root.userData.officeActor = actor; actors.set(person.slug, actor); placeActor(actor, [home.x, home.y]); updateLabel(label, person, ""); applyAppearance(actor, actor.appearance); settle(actor); mixer.update(Math.random() * 2);
}

const installRegionTint = (mesh: THREE.Mesh, appearance: Appearance) => {
  const source = mesh.material as THREE.MeshStandardMaterial | undefined;
  if (!source?.isMeshStandardMaterial || !mesh.geometry.getAttribute("region")) return;
  const material = source.userData.office3RegionTint ? source : source.clone();
  material.userData.office3RegionTint = true;
  const palette = [appearance.tints.skin, appearance.tints.hair, appearance.tints.top, appearance.tints.bottom, appearance.tints.shoes].map(color => new THREE.Color(color));
  material.onBeforeCompile = shader => {
    shader.uniforms.uOfficeTints = { value: palette };
    shader.vertexShader = `attribute float region; varying float vOfficeRegion;\n${shader.vertexShader}`.replace("#include <begin_vertex>", "#include <begin_vertex>\nvOfficeRegion = region;");
    shader.fragmentShader = `varying float vOfficeRegion; uniform vec3 uOfficeTints[5];\n${shader.fragmentShader}`.replace("#include <color_fragment>", "#include <color_fragment>\nvec3 officeTint = vOfficeRegion < .5 ? uOfficeTints[0] : vOfficeRegion < 1.5 ? uOfficeTints[1] : vOfficeRegion < 2.5 ? uOfficeTints[2] : vOfficeRegion < 3.5 ? uOfficeTints[3] : uOfficeTints[4];\ndiffuseColor.rgb = officeTint;");
  };
  material.needsUpdate = true; mesh.material = material;
};

export function applyAppearance(actor: OfficeActor, raw: Appearance): void { const appearance = parseAppearance(raw); actor.appearance = appearance; actor.root.scale.setScalar(appearance.scale); actor.root.traverse(node => installRegionTint(node as THREE.Mesh, appearance)); applyAttachments(actor.root, appearance); }

export async function applyCustomModel(actor: OfficeActor, loader: PrefabLoader, url: string): Promise<void> { const gltf = await loader.load(url); const model = gltf.scene.clone(true); const height = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3()).y; model.scale.setScalar(height > .001 ? CHARACTER_HEIGHT / height : 1); actor.root.clear(); actor.root.add(model); actor.actions = {}; actor.current = null; applyAppearance(actor, actor.appearance); settle(actor); }

export function setActorState(actor: OfficeActor, state: string, bubble: string): void {
  actor.state = state;
  (actor.ring.material as THREE.MeshBasicMaterial).color.setHex(ringColor(state));
  if (bubble !== actor.bubble) { actor.bubble = bubble; updateLabel(actor.label, actor.person, bubble, actor.task, actor.mood, actor.rankColor); }
}

export function setActorTask(actor: OfficeActor, task: string): void { if (task !== actor.task) { actor.task = task; updateLabel(actor.label, actor.person, actor.bubble, task, actor.mood, actor.rankColor); } }
export function setActorMood(actor: OfficeActor, mood: string, rankColor: string): void { if (actor.mood !== mood || actor.rankColor !== rankColor) { actor.mood = mood; actor.rankColor = rankColor; updateLabel(actor.label, actor.person, actor.bubble, actor.task, mood, rankColor); } }

export function removeActor(scene: THREE.Scene, actor: OfficeActor): void { scene.remove(actor.root, actor.ring, actor.label); }
