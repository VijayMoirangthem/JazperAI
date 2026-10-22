import * as THREE from "three";
import type { Person } from "../../office2/types";
import { layoutLabels } from "../core/labelLayout";

export function createLabel(): THREE.Sprite {
  const label = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthTest: false }));
  label.scale.set(3.2, 1.0, 1);
  label.renderOrder = 10;
  return label;
}

export function updateLabel(label: THREE.Sprite, person: Person, bubble: string, task = "", mood = "", rank = ""): void {
  const canvas = document.createElement("canvas");
  canvas.width = 256; canvas.height = 112;
  const context = canvas.getContext("2d");
  if (!context) return;
  context.font = "bold 26px system-ui, sans-serif"; context.textAlign = "center";
  const name = `${mood ? `${mood} ` : ""}${person.name.split(" ")[0]}`;
  const nameWidth = Math.max(80, context.measureText(name).width + 20);
  context.fillStyle = "rgba(15,23,42,0.85)"; context.fillRect(128 - nameWidth / 2, 70, nameWidth, 28);
  context.fillStyle = rank || "#f8fafc"; context.fillText(name, 128, 93);
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
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  const material = label.material as THREE.SpriteMaterial;
  material.map?.dispose(); material.map = texture; material.needsUpdate = true;
}

interface LabelActor { person: Person; root: THREE.Group; label: THREE.Sprite; bubble: string; state: string; }
export function layoutActorLabels(actors: Iterable<LabelActor>, camera: THREE.Camera, width: number, height: number, labelMode: "all" | "near" | "hover" | "off" = "all"): void {
  const source = [...actors];
  const candidates = source.map(actor => {
    const point = actor.root.position.clone(); point.y += 2.45; point.project(camera);
    const distance = actor.root.position.distanceTo(camera.position);
    const priority = (actor.person.kind === "human" ? 50 : 0) + (actor.state === "waiting_human" || actor.state === "escalated" ? 40 : 0) + (actor.bubble ? 20 : 0);
    return { id: actor.person.slug, x: (point.x + 1) * .5 * width, y: (1 - point.y) * .5 * height, distance, priority };
  });
  const placements = new Map(layoutLabels(candidates, width, height).map(item => [item.id, item]));
  for (const actor of source) {
    const placement = placements.get(actor.person.slug); if (!placement) continue;
    actor.label.visible = placement.visible && labelMode !== "off" && (labelMode === "all" || actor.person.kind === "human" || placement.detail === "full");
    actor.label.scale.set(placement.detail === "dot" ? .42 : placement.detail === "name" ? 1.8 : 3.2, placement.detail === "full" ? 1.25 : .72, 1);
    actor.label.position.y = actor.root.position.y + (placement.detail === "dot" ? 2.18 : 2.45);
  }
}
