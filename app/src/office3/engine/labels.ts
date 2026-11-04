import * as THREE from "three";
import type { Person } from "../../office2/types";
import { layoutLabels } from "../core/labelLayout";

const LABEL_WIDTH = 256, LABEL_HEIGHT = 128, ATLAS_COLUMNS = 8, ATLAS_ROWS = 16, ATLAS_CAPACITY = ATLAS_COLUMNS * ATLAS_ROWS;
let atlasCanvas: HTMLCanvasElement | null = null;
let atlasTexture: THREE.CanvasTexture | null = null;
let atlasUsers = 0;
const freeAtlasSlots = new Set<number>(Array.from({ length: ATLAS_CAPACITY }, (_, index) => index));
const ensureAtlas = (): THREE.CanvasTexture => {
  if (atlasTexture) return atlasTexture;
  atlasCanvas = document.createElement("canvas"); atlasCanvas.width = LABEL_WIDTH * ATLAS_COLUMNS; atlasCanvas.height = LABEL_HEIGHT * ATLAS_ROWS;
  atlasTexture = new THREE.CanvasTexture(atlasCanvas); atlasTexture.colorSpace = THREE.SRGBColorSpace;
  return atlasTexture;
};
const atlasSlot = (): number | null => { const next = freeAtlasSlots.values().next().value as number | undefined; if (next === undefined) return null; freeAtlasSlots.delete(next); atlasUsers++; return next; };
const releaseAtlasSlot = (slot: number): void => {
  freeAtlasSlots.add(slot); atlasUsers--;
  const context = atlasCanvas?.getContext("2d"); if (context) { context.clearRect((slot % ATLAS_COLUMNS) * LABEL_WIDTH, Math.floor(slot / ATLAS_COLUMNS) * LABEL_HEIGHT, LABEL_WIDTH, LABEL_HEIGHT); if (atlasTexture) atlasTexture.needsUpdate = true; }
  if (atlasUsers > 0 || !atlasTexture) return;
  atlasTexture.dispose(); atlasTexture = null; atlasCanvas = null;
};

export function createLabel(): THREE.Sprite {
  const slot = atlasSlot();
  const material = new THREE.SpriteMaterial({ map: slot === null ? null : ensureAtlas(), transparent: true, depthTest: false });
  if (slot !== null) {
    const row = Math.floor(slot / ATLAS_COLUMNS);
    const offset = new THREE.Vector2((slot % ATLAS_COLUMNS) / ATLAS_COLUMNS, 1 - (row + 1) / ATLAS_ROWS), scale = new THREE.Vector2(1 / ATLAS_COLUMNS, 1 / ATLAS_ROWS);
    material.onBeforeCompile = shader => {
      shader.uniforms.uOffice3LabelOffset = { value: offset };
      shader.uniforms.uOffice3LabelScale = { value: scale };
      shader.fragmentShader = `uniform vec2 uOffice3LabelOffset; uniform vec2 uOffice3LabelScale;\n${shader.fragmentShader}`.replace("#include <map_fragment>", "#ifdef USE_MAP\nvec4 sampledDiffuseColor = texture2D( map, uOffice3LabelOffset + vMapUv * uOffice3LabelScale );\ndiffuseColor *= sampledDiffuseColor;\n#endif");
    };
    material.needsUpdate = true;
  }
  const label = new THREE.Sprite(material);
  if (slot !== null) label.userData.office3LabelSlot = slot;
  label.scale.set(3.2, 1.0, 1);
  label.renderOrder = 10;
  return label;
}

const statusLabel = (state: string): { text: string; background: string; foreground: string } | null => {
  const labels: Record<string, { text: string; background: string; foreground: string }> = {
    working: { text: "Working", background: "rgba(22,101,52,.92)", foreground: "#dcfce7" },
    thinking: { text: "Thinking", background: "rgba(30,64,175,.92)", foreground: "#dbeafe" },
    planning: { text: "Planning", background: "rgba(88,28,135,.92)", foreground: "#f3e8ff" },
    repairing: { text: "Repairing", background: "rgba(154,52,18,.92)", foreground: "#ffedd5" },
    waiting_tool: { text: "Awaiting tool", background: "rgba(8,145,178,.92)", foreground: "#cffafe" },
    interacting: { text: "In use", background: "rgba(8,145,178,.92)", foreground: "#cffafe" },
    focus: { text: "Focus", background: "rgba(30,64,175,.92)", foreground: "#dbeafe" },
    dnd: { text: "Do not disturb", background: "rgba(159,18,57,.92)", foreground: "#ffe4e6" },
    busy: { text: "Busy", background: "rgba(154,52,18,.92)", foreground: "#ffedd5" },
    blocked: { text: "Blocked", background: "rgba(190,24,93,.95)", foreground: "#fce7f3" },
    error: { text: "Error", background: "rgba(185,28,28,.95)", foreground: "#fef2f2" },
    waiting_human: { text: "Needs you", background: "rgba(190,24,93,.95)", foreground: "#fce7f3" },
    escalated: { text: "Escalated", background: "rgba(185,28,28,.95)", foreground: "#fef2f2" },
    success: { text: "Completed", background: "rgba(21,128,61,.92)", foreground: "#dcfce7" },
    offline: { text: "Offline", background: "rgba(71,85,105,.92)", foreground: "#e2e8f0" },
  };
  return labels[state] ?? null;
};

const drawLabel = (context: CanvasRenderingContext2D, person: Person, bubble: string, task: string, mood: string, rank: string, state: string): void => {
  context.font = "bold 26px system-ui, sans-serif"; context.textAlign = "center";
  const name = `${mood ? `${mood} ` : ""}${person.name.split(" ")[0]}`;
  const founder = person.kind === "human";
  const nameWidth = Math.max(80, context.measureText(name).width + 20) + (founder ? 56 : 0);
  const nameLeft = 128 - nameWidth / 2;
  context.fillStyle = "rgba(15,23,42,0.85)"; context.fillRect(nameLeft, 70, nameWidth, 28);
  if (founder) {
    context.font = "bold 12px system-ui, sans-serif";
    context.fillStyle = "rgba(161,98,7,.95)"; context.fillRect(nameLeft + 4, 76, 48, 16);
    context.fillStyle = "#fef3c7"; context.fillText("FOUNDER", nameLeft + 28, 88);
    context.font = "bold 26px system-ui, sans-serif";
  }
  context.fillStyle = rank || "#f8fafc"; context.fillText(name, founder ? 128 + 28 : 128, 93);
  if (task) {
    context.font = "16px system-ui, sans-serif";
    const taskText = task.length > 30 ? `${task.slice(0, 30)}…` : task;
    const taskWidth = Math.min(238, context.measureText(taskText).width + 16);
    context.fillStyle = "rgba(30,64,175,.88)"; context.fillRect(128 - taskWidth / 2, 45, taskWidth, 19);
    context.fillStyle = "#dbeafe"; context.fillText(taskText, 128, 60);
  }
  if (bubble) {
    context.font = "20px system-ui, sans-serif";
    const text = bubble.length > 22 ? `${bubble.slice(0, 22)}…` : bubble;
    const textWidth = context.measureText(text).width;
    context.fillStyle = "#e2e8f0"; context.fillRect(128 - textWidth / 2 - 8, 6, textWidth + 16, 28);
    context.fillStyle = "#0f172a"; context.fillText(text, 128, 28);
  }
  const status = statusLabel(state);
  if (status) {
    context.font = "bold 15px system-ui, sans-serif";
    const width = Math.min(180, context.measureText(status.text).width + 18);
    context.fillStyle = status.background; context.fillRect(128 - width / 2, 101, width, 20);
    context.fillStyle = status.foreground; context.fillText(status.text, 128, 116);
  }
};

export function updateLabel(label: THREE.Sprite, person: Person, bubble: string, task = "", mood = "", rank = "", state = "idle"): void {
  // State updates can arrive repeatedly from polling/network reconciliation.
  // Keep the existing canvas texture when its visible contents are identical.
  const signature = JSON.stringify([person.name, person.kind, bubble, task, mood, rank, state]);
  if (label.userData.office3LabelSignature === signature) return;
  label.userData.office3LabelSignature = signature;
  const slot = label.userData.office3LabelSlot as number | undefined;
  const canvas = slot === undefined ? document.createElement("canvas") : atlasCanvas;
  if (!canvas) return;
  if (slot === undefined) { canvas.width = LABEL_WIDTH; canvas.height = LABEL_HEIGHT; }
  const context = canvas.getContext("2d");
  if (!context) return;
  if (slot !== undefined) { context.save(); context.translate((slot % ATLAS_COLUMNS) * LABEL_WIDTH, Math.floor(slot / ATLAS_COLUMNS) * LABEL_HEIGHT); context.clearRect(0, 0, LABEL_WIDTH, LABEL_HEIGHT); drawLabel(context, person, bubble, task, mood, rank, state); context.restore(); if (atlasTexture) atlasTexture.needsUpdate = true; return; }
  drawLabel(context, person, bubble, task, mood, rank, state);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  const material = label.material as THREE.SpriteMaterial;
  material.map?.dispose(); material.map = texture; material.needsUpdate = true;
}

/** Labels own a CanvasTexture and SpriteMaterial outside their actor root. */
export function disposeLabel(label: THREE.Sprite): void {
  const material = label.material as THREE.SpriteMaterial;
  const slot = label.userData.office3LabelSlot as number | undefined;
  if (slot === undefined) material.map?.dispose(); else releaseAtlasSlot(slot);
  material.dispose();
  delete label.userData.office3LabelSignature;
  delete label.userData.office3LabelSlot;
}

interface LabelActor { person: Person; root: THREE.Group; label: THREE.Sprite; leader: THREE.Line; bubble: string; state: string; }
export function layoutActorLabels(actors: Iterable<LabelActor>, camera: THREE.Camera, width: number, height: number, labelMode: "all" | "near" | "hover" | "off" = "all", labelScale = 1, hoveredSlug: string | null = null): void {
  const source = [...actors];
  const candidates = source.map(actor => {
    const point = actor.root.position.clone(); point.y += 2.45; point.project(camera);
    const distance = actor.root.position.distanceTo(camera.position);
    const priority = (actor.person.kind === "human" ? 50 : 0) + (actor.state === "waiting_human" || actor.state === "escalated" ? 40 : 0) + (actor.bubble ? 20 : 0);
    return { id: actor.person.slug, x: (point.x + 1) * .5 * width, y: (1 - point.y) * .5 * height, distance, priority };
  });
  const placements = new Map(layoutLabels(candidates, width, height, labelScale).map(item => [item.id, item]));
  const screenUp = new THREE.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
  const perspective = camera as THREE.PerspectiveCamera;
  for (const actor of source) {
    const placement = placements.get(actor.person.slug); if (!placement) continue;
    const visible = placement.visible && labelMode !== "off" && (labelMode === "hover" ? actor.person.slug === hoveredSlug : labelMode === "all" || actor.person.kind === "human" || placement.detail === "full");
    actor.label.visible = visible;
    actor.label.scale.set((placement.detail === "dot" ? .42 : placement.detail === "name" ? 1.8 : 3.2) * labelScale, (placement.detail === "full" ? 1.25 : .72) * labelScale, 1);
    const anchor = actor.root.position.clone(); anchor.y += placement.detail === "dot" ? 2.18 : 2.45;
    const candidate = candidates.find(item => item.id === actor.person.slug);
    const shiftPixels = placement.y - (candidate?.y ?? placement.y);
    const worldPerPixel = 2 * Math.tan(THREE.MathUtils.degToRad(perspective.fov / 2)) * actor.root.position.distanceTo(camera.position) / Math.max(1, height);
    actor.label.position.copy(anchor).addScaledVector(screenUp, -shiftPixels * worldPerPixel);
    const leaderVisible = visible && placement.detail !== "dot" && Math.abs(shiftPixels) > 5;
    actor.leader.visible = leaderVisible;
    if (leaderVisible) { const points = actor.leader.geometry.getAttribute("position") as THREE.BufferAttribute; points.setXYZ(0, anchor.x, anchor.y - .08, anchor.z); points.setXYZ(1, actor.label.position.x, actor.label.position.y - .18, actor.label.position.z); points.needsUpdate = true; actor.leader.geometry.computeBoundingSphere(); }
  }
}
