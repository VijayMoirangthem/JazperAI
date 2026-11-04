import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { hash } from "../../office2/hash";
import { ringColor } from "../../office2/behavior";
import type { Person, Place, Pt, Spot } from "../../office2/types";
import { createLabel, disposeLabel, updateLabel } from "./labels";
import type { PrefabLoader } from "./prefabs";
import { facingYaw } from "../core/seats";
import { defaultAppearance, parseAppearance, type Appearance } from "../core/appearance";
import { applyAttachments, disposeAttachments } from "./attachments";

export type ActorAnimation = "idle" | "walk" | "sit" | "typing" | "reading" | "hand-raise" | "pace" | "wave" | "thumbsup" | "clap" | "laugh" | "question" | "heart" | "coffee" | "thinking" | "sleep";
export const CHARACTER_HEIGHT = 2.1;
// These meshes differ only by per-actor material/transform, so retain one
// immutable geometry per module rather than allocating hundreds in a busy Office.
const ACTOR_PROXY_GEOMETRY = new THREE.CapsuleGeometry(.24, .82, 3, 8);
const ACTOR_RING_GEOMETRY = new THREE.RingGeometry(.34, .46, 24);
const MAX_TINT_MATERIALS = 40;
type TintMaterialEntry = { material: THREE.MeshStandardMaterial; refs: number; sourceUuid: string };
const tintMaterials = new Map<string, TintMaterialEntry>();
export interface OfficeActor {
  person: Person; root: THREE.Group; mixer: THREE.AnimationMixer; actions: Partial<Record<ActorAnimation, THREE.AnimationAction>>; current: ActorAnimation | null; activeAction: THREE.AnimationAction | null;
  ring: THREE.Mesh; label: THREE.Sprite; leader: THREE.Line; proxy: THREE.Mesh; gestureBone: THREE.Object3D | null; gestureRest: THREE.Euler | null; lod: "full" | "reduced" | "proxy"; home: Spot; spot: Spot | null; path: Pt[]; tile: Pt; place: Place; state: string; bubble: string; task: string; mood: string; rankColor: string; appearance: Appearance;
}

const animationTransitionSeconds = (from: ActorAnimation | null, to: ActorAnimation): number => {
  if (!from || from === to) return .14;
  if (from === "walk" || to === "walk") return .16;
  if (from === "sit" || to === "sit") return .3;
  if (from === "hand-raise" || to === "hand-raise") return .12;
  return .22;
};

const prepared = new WeakSet<GLTF>();

const animationKind = (name: string): ActorAnimation | null => {
  const normalized = name.toLowerCase().replace(/[\s_-]+/g, "");
  if (normalized.includes("typing") || normalized.includes("keyboard") || normalized.includes("working")) return "typing";
  if (normalized.includes("reading") || normalized.includes("read") || normalized.includes("book")) return "reading";
  if (normalized.includes("handraise") || normalized.includes("raisehand") || normalized.includes("attention")) return "hand-raise";
  if (normalized.includes("pace") || normalized.includes("impatient")) return "pace";
  if (normalized.includes("thumb") || normalized.includes("like")) return "thumbsup";
  if (normalized.includes("clap") || normalized.includes("applause")) return "clap";
  if (normalized.includes("laugh") || normalized.includes("giggle")) return "laugh";
  if (normalized.includes("question") || normalized.includes("shrug")) return "question";
  if (normalized.includes("heart") || normalized.includes("love")) return "heart";
  if (normalized.includes("coffee") || normalized.includes("drink")) return "coffee";
  if (normalized.includes("think") || normalized.includes("ponder")) return "thinking";
  if (normalized.includes("sleep") || normalized.includes("yawn")) return "sleep";
  if (normalized.includes("wave") || normalized.includes("hello") || normalized.includes("greet")) return "wave";
  if (normalized.includes("walk") || normalized.includes("run") || normalized.includes("locomotion") || normalized.includes("move")) return "walk";
  if (normalized.includes("sit") || normalized.includes("seat") || normalized.includes("chair")) return "sit";
  if (normalized.includes("idle") || normalized.includes("stand") || normalized.includes("breath") || normalized.includes("rest") || normalized.includes("default") || normalized.includes("pose")) return "idle";
  return null;
};

const animationScore = (name: string, kind: ActorAnimation): number => {
  const normalized = name.toLowerCase().replace(/[\s_-]+/g, "");
  const preferred: Record<ActorAnimation, string[]> = {
    idle: ["idle", "stand", "breath", "rest", "default", "pose"],
    walk: ["walk", "run", "locomotion", "move"],
    sit: ["sit", "seat", "chair", "typing", "working"],
    typing: ["typing", "keyboard", "working"],
    reading: ["reading", "read", "book"],
    "hand-raise": ["handraise", "raisehand", "attention"],
    pace: ["pace", "impatient"],
    wave: ["wave", "hello", "greet"],
    thumbsup: ["thumb", "like"],
    clap: ["clap", "applause"],
    laugh: ["laugh", "giggle"],
    question: ["question", "shrug"],
    heart: ["heart", "love"],
    coffee: ["coffee", "drink"],
    thinking: ["think", "ponder"],
    sleep: ["sleep", "yawn"],
  };
  return preferred[kind].findIndex(token => normalized.includes(token));
};

const animationActions = (mixer: THREE.AnimationMixer, clips: THREE.AnimationClip[]): OfficeActor["actions"] => {
  const actions: OfficeActor["actions"] = {};
  for (const clip of clips) {
    const kind = animationKind(clip.name);
    if (!kind) continue;
    const existing = actions[kind];
    if (!existing || animationScore(clip.name, kind) < animationScore(existing.getClip().name, kind)) actions[kind] = mixer.clipAction(clip);
  }
  return actions;
};

/** Prefer an upper torso bone for procedural gestures; root motion remains a safe fallback. */
const gestureBoneFor = (root: THREE.Object3D): THREE.Object3D | null => {
  let candidate: THREE.Object3D | null = null;
  root.traverse(node => {
    if (candidate) return;
    const name = node.name.toLowerCase().replace(/[ _.-]+/g, "");
    if (name.includes("upperchest") || name.includes("chest") || name.includes("spine2") || name.includes("spine1")) candidate = node;
  });
  return candidate;
};

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
  const next = actor.actions[animation] ?? actor.actions.idle;
  if (!next) return;
  const duration = animationTransitionSeconds(actor.current, animation);
  next.enabled = true;
  next.setLoop(THREE.LoopRepeat, Infinity).setEffectiveTimeScale(animation === "pace" ? 1.15 : 1).reset().play();
  if (actor.activeAction && actor.activeAction !== next) next.crossFadeFrom(actor.activeAction, duration, true);
  else next.fadeIn(duration);
  actor.current = animation;
  actor.activeAction = next;
}

export function placeActor(actor: OfficeActor, tile: Pt): void {
  actor.root.position.set(tile[0] + 0.5, 0, tile[1] + 0.5); actor.tile = tile;
  actor.proxy.position.set(tile[0] + 0.5, .66, tile[1] + 0.5);
  actor.ring.position.set(tile[0] + 0.5, 0.03, tile[1] + 0.5);
  actor.label.position.set(tile[0] + 0.5, CHARACTER_HEIGHT + 0.35, tile[1] + 0.5);
}

const animationForState = (state: string): ActorAnimation => {
  if (state === "working") return "typing";
  if (state === "planning") return "reading";
  if (state === "waiting_human") return "hand-raise";
  if (state === "waiting_tool") return "pace";
  return "idle";
};

export function settle(actor: OfficeActor): void {
  const stateAnimation = animationForState(actor.state);
  if (actor.spot?.type === "seat") {
    // A seated actor still gets a dedicated working/reading/attention clip
    // when its model has one; otherwise the authored seat pose is preserved.
    play(actor, actor.actions[stateAnimation] ? stateAnimation : "sit");
    actor.root.rotation.y = facingYaw(actor.spot.facing ?? "up");
    actor.root.position.y = 0;
  } else play(actor, stateAnimation);
}

export async function addActor(scene: THREE.Scene, actors: Map<string, OfficeActor>, loader: PrefabLoader, names: string[], person: Person, home: Spot): Promise<void> {
  const file = names[hash(person.slug) % names.length];
  const gltf = await loader.load(`/office3/characters/${file}`);
  if (actors.has(person.slug)) return;
  prepare(gltf);
  const object = cloneSkinned(gltf.scene) as THREE.Group;
  const mixer = new THREE.AnimationMixer(object), actions = animationActions(mixer, gltf.animations);
  const gestureBone = gestureBoneFor(object);
  object.updateMatrixWorld(true);
  const modelHeight = new THREE.Box3().setFromObject(object).getSize(new THREE.Vector3()).y;
  object.scale.setScalar(modelHeight > 0.001 ? CHARACTER_HEIGHT / modelHeight : 1);
  const root = new THREE.Group(); root.add(object); scene.add(root);
  const proxy = new THREE.Mesh(ACTOR_PROXY_GEOMETRY, new THREE.MeshStandardMaterial({ color: hash(person.slug) & 0xffffff, roughness: .82, metalness: 0 }));
  proxy.visible = false; scene.add(proxy);
  const ring = new THREE.Mesh(ACTOR_RING_GEOMETRY, new THREE.MeshBasicMaterial({ color: ringColor("idle"), side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2; scene.add(ring);
  const label = createLabel(); scene.add(label);
  const leader = new THREE.Line(new THREE.BufferGeometry().setAttribute("position", new THREE.BufferAttribute(new Float32Array(6), 3)), new THREE.LineBasicMaterial({ color: 0x94a3b8, transparent: true, opacity: .55, depthTest: false }));
  leader.visible = false; leader.renderOrder = 9; scene.add(leader);
  const actor: OfficeActor = { person, root, mixer, actions, current: null, activeAction: null, ring, label, leader, proxy, gestureBone, gestureRest: gestureBone?.rotation.clone() ?? null, lod: "full", home, spot: home, path: [], tile: [home.x, home.y], place: "desk", state: "idle", bubble: "", task: "", mood: "", rankColor: "", appearance: defaultAppearance(file.replace(/\.glb$/i, "")) };
  root.userData.officeActor = actor; proxy.userData.officeActor = actor; actors.set(person.slug, actor); placeActor(actor, [home.x, home.y]); updateLabel(label, person, "", "", "", "", actor.state); applyAppearance(actor, actor.appearance); settle(actor); mixer.update(Math.random() * 2);
}

const paletteFor = (appearance: Appearance, quantise = false): THREE.Color[] => [appearance.tints.skin, appearance.tints.hair, appearance.tints.top, appearance.tints.bottom, appearance.tints.shoes].map(value => {
  const color = new THREE.Color(value);
  if (quantise) color.setRGB(Math.round(color.r * 11) / 11, Math.round(color.g * 11) / 11, Math.round(color.b * 11) / 11);
  return color;
});
const paletteKey = (palette: readonly THREE.Color[]) => palette.map(color => color.getHexString()).join("");
const releaseTintMaterial = (mesh: THREE.Mesh): void => {
  const key = mesh.userData.office3TintKey as string | undefined;
  if (!key) return;
  const entry = tintMaterials.get(key);
  if (entry && --entry.refs <= 0) { entry.material.dispose(); tintMaterials.delete(key); }
  delete mesh.userData.office3TintKey;
};
const createTintMaterial = (source: THREE.MeshStandardMaterial, palette: THREE.Color[]): THREE.MeshStandardMaterial => {
  const material = source.clone();
  const uniform = { value: palette };
  material.userData.office3RegionTint = true;
  material.userData.office3TintSource = source;
  material.onBeforeCompile = shader => {
    shader.uniforms.uOfficeTints = uniform;
    shader.vertexShader = `attribute float region; varying float vOfficeRegion;\n${shader.vertexShader}`.replace("#include <begin_vertex>", "#include <begin_vertex>\nvOfficeRegion = region;");
    shader.fragmentShader = `varying float vOfficeRegion; uniform vec3 uOfficeTints[5];\n${shader.fragmentShader}`.replace("#include <color_fragment>", "#include <color_fragment>\nvec3 officeTint = vOfficeRegion < .5 ? uOfficeTints[0] : vOfficeRegion < 1.5 ? uOfficeTints[1] : vOfficeRegion < 2.5 ? uOfficeTints[2] : vOfficeRegion < 3.5 ? uOfficeTints[3] : uOfficeTints[4];\ndiffuseColor.rgb = officeTint;");
  };
  material.needsUpdate = true;
  return material;
};
const installRegionTint = (mesh: THREE.Mesh, appearance: Appearance) => {
  const current = mesh.material as THREE.MeshStandardMaterial | undefined;
  if (!current?.isMeshStandardMaterial || !mesh.geometry.getAttribute("region")) return;
  const source = (current.userData.office3TintSource as THREE.MeshStandardMaterial | undefined) ?? current;
  let palette = paletteFor(appearance), key = `${source.uuid}:${paletteKey(palette)}`;
  if (!tintMaterials.has(key) && tintMaterials.size >= MAX_TINT_MATERIALS) { palette = paletteFor(appearance, true); key = `${source.uuid}:${paletteKey(palette)}`; }
  if (!tintMaterials.has(key) && tintMaterials.size >= MAX_TINT_MATERIALS) {
    const fallback = [...tintMaterials.entries()].find(([, entry]) => entry.sourceUuid === source.uuid);
    if (fallback) key = fallback[0];
  }
  if (!tintMaterials.has(key) && tintMaterials.size >= MAX_TINT_MATERIALS) return;
  if (mesh.userData.office3TintKey === key) return;
  releaseTintMaterial(mesh);
  let entry = tintMaterials.get(key);
  if (!entry) { entry = { material: createTintMaterial(source, palette), refs: 0, sourceUuid: source.uuid }; tintMaterials.set(key, entry); }
  entry.refs++;
  mesh.material = entry.material;
  mesh.userData.office3TintKey = key;
};

export function applyAppearance(actor: OfficeActor, raw: Appearance): void { const appearance = parseAppearance(raw); actor.appearance = appearance; actor.root.scale.setScalar(appearance.scale); actor.root.traverse(node => installRegionTint(node as THREE.Mesh, appearance)); applyAttachments(actor.root, appearance, actor.rankColor); }

const disposeActorDecorations = (root: THREE.Group) => {
  disposeAttachments(root);
  root.traverse(node => releaseTintMaterial(node as THREE.Mesh));
};

export async function applyCustomModel(actor: OfficeActor, loader: PrefabLoader, url: string): Promise<void> { const gltf = await loader.load(url); const model = cloneSkinned(gltf.scene) as THREE.Group; const height = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3()).y; model.scale.setScalar(height > .001 ? CHARACTER_HEIGHT / height : 1); actor.mixer.stopAllAction(); disposeActorDecorations(actor.root); actor.root.clear(); actor.root.add(model); actor.mixer = new THREE.AnimationMixer(model); actor.actions = animationActions(actor.mixer, gltf.animations); actor.gestureBone = gestureBoneFor(model); actor.gestureRest = actor.gestureBone?.rotation.clone() ?? null; actor.current = null; actor.activeAction = null; applyAppearance(actor, actor.appearance); settle(actor); }

export function setActorState(actor: OfficeActor, state: string, bubble: string): void {
  actor.state = state;
  (actor.ring.material as THREE.MeshBasicMaterial).color.setHex(ringColor(state));
  (actor.proxy.material as THREE.MeshStandardMaterial).color.setHex(ringColor(state));
  if (bubble !== actor.bubble) actor.bubble = bubble;
  updateLabel(actor.label, actor.person, actor.bubble, actor.task, actor.mood, actor.rankColor, actor.state);
}

export function setActorTask(actor: OfficeActor, task: string): void { if (task !== actor.task) { actor.task = task; updateLabel(actor.label, actor.person, actor.bubble, task, actor.mood, actor.rankColor, actor.state); } }
export function setActorMood(actor: OfficeActor, mood: string, rankColor: string): void { if (actor.mood !== mood || actor.rankColor !== rankColor) { const rankChanged = actor.rankColor !== rankColor; actor.mood = mood; actor.rankColor = rankColor; if (rankChanged) applyAttachments(actor.root, actor.appearance, rankColor); updateLabel(actor.label, actor.person, actor.bubble, actor.task, mood, rankColor, actor.state); } }

/** L2: near actors keep their full meshes; medium/far actors use one shared pickable capsule batch. */
export function setActorLod(actor: OfficeActor, lod: OfficeActor["lod"]): void {
  if (actor.lod === lod) return;
  actor.lod = lod;
  actor.root.visible = lod === "full";
  // Medium and far actors are rendered by Office3's shared InstancedMesh
  // batch. Keep the per-actor proxy dormant so it never adds a draw call.
  actor.proxy.visible = false;
  actor.ring.visible = lod !== "proxy";
  actor.label.visible = lod !== "proxy";
  actor.leader.visible = false;
  actor.root.traverse(item => { if (item.name === "office3-attachment") item.visible = lod === "full"; });
}

export function removeActor(scene: THREE.Scene, actor: OfficeActor): void { disposeActorDecorations(actor.root); scene.remove(actor.root, actor.proxy, actor.ring, actor.label, actor.leader); (actor.proxy.material as THREE.Material).dispose(); (actor.ring.material as THREE.Material).dispose(); disposeLabel(actor.label); actor.leader.geometry.dispose(); (actor.leader.material as THREE.Material).dispose(); }
