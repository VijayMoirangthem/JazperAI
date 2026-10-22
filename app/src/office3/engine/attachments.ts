import * as THREE from "three";
import type { Appearance } from "../core/appearance";

const material = (color: string) => new THREE.MeshStandardMaterial({ color, roughness: .55, metalness: .05 });

/** Visible fallbacks keep customisation usable for GLBs without named head or chest anchors. */
export function applyAttachments(root: THREE.Group, appearance: Appearance): void {
  const previous = root.getObjectByName("office3-attachments");
  if (previous) { root.remove(previous); previous.traverse(item => { const mesh = item as THREE.Mesh; mesh.geometry?.dispose(); const surface = mesh.material as THREE.Material | undefined; surface?.dispose(); }); }
  const group = new THREE.Group(); group.name = "office3-attachments";
  if (appearance.parts.hair !== "none") {
    const hair = new THREE.Mesh(new THREE.SphereGeometry(appearance.parts.hair === "long-01" ? .29 : .23, 16, 10), material(appearance.tints.hair));
    hair.position.set(0, 1.88, 0); hair.scale.y = appearance.parts.hair === "long-01" ? 1.45 : .65; group.add(hair);
  }
  if (appearance.parts.hat !== "none") { const cap = new THREE.Mesh(new THREE.CylinderGeometry(.28, .3, .12, 18), material(appearance.tints.top)); cap.position.set(0, 2.04, .01); group.add(cap); }
  if (appearance.parts.glasses !== "none") {
    const glasses = new THREE.Group();
    for (const x of [-.105, .105]) { const lens = new THREE.Mesh(new THREE.TorusGeometry(.085, .014, 6, 12), new THREE.MeshBasicMaterial({ color: 0x111827 })); lens.position.set(x, 1.83, .245); glasses.add(lens); }
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(.08, .015, .015), new THREE.MeshBasicMaterial({ color: 0x111827 })); bridge.position.set(0, 1.83, .245); glasses.add(bridge); group.add(glasses);
  }
  if (appearance.parts.badge !== "none" && appearance.badge.style !== "none") {
    const color = appearance.badge.style === "floating" ? "#fbbf24" : "#e2e8f0";
    if (appearance.parts.badge === "lanyard") { const strap = new THREE.Mesh(new THREE.TorusGeometry(.18, .014, 6, 16, Math.PI), material(appearance.tints.top)); strap.rotation.z = Math.PI; strap.position.set(0, 1.48, .245); group.add(strap); }
    const badge = new THREE.Mesh(appearance.parts.badge === "pin" ? new THREE.CircleGeometry(.07, 14) : new THREE.PlaneGeometry(.22, .13), material(color));
    badge.position.set(appearance.parts.badge === "pin" ? .17 : 0, appearance.parts.badge === "pin" ? 1.42 : 1.25, .25); group.add(badge);
  }
  root.add(group);
}
