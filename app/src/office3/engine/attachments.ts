import * as THREE from "three";
import type { Appearance } from "../core/appearance";

const material = (color: string) => new THREE.MeshStandardMaterial({ color, roughness: .55, metalness: .05 });
const attachmentName = "office3-attachment";

const findBone = (root: THREE.Group, pattern: RegExp): THREE.Bone | null => {
  let result: THREE.Bone | null = null;
  root.traverse(item => { if (!result && (item as THREE.Bone).isBone && pattern.test(item.name.toLowerCase())) result = item as THREE.Bone; });
  return result;
};

const disposeAttachment = (item: THREE.Object3D) => item.traverse(child => {
  const mesh = child as THREE.Mesh;
  mesh.geometry?.dispose();
  const surface = mesh.material as THREE.Material | undefined;
  surface?.dispose();
});

const place = (root: THREE.Group, item: THREE.Object3D, bone: THREE.Bone | null, anchored: THREE.Vector3, fallback: THREE.Vector3) => {
  item.name = attachmentName;
  item.position.copy(bone ? anchored : fallback);
  (bone ?? root).add(item);
};

/** Visible fallbacks keep customisation usable for GLBs without named head or chest anchors. */
export function applyAttachments(root: THREE.Group, appearance: Appearance, rankColor = ""): void {
  disposeAttachments(root);
  const head = findBone(root, /head/), chest = findBone(root, /chest|upperchest|spine/);
  if (appearance.parts.hair !== "none") {
    const hair = new THREE.Mesh(new THREE.SphereGeometry(appearance.parts.hair === "long-01" ? .29 : .23, 16, 10), material(appearance.tints.hair));
    hair.scale.y = appearance.parts.hair === "long-01" ? 1.45 : .65; place(root, hair, head, new THREE.Vector3(0, .12, 0), new THREE.Vector3(0, 1.88, 0));
  }
  if (appearance.parts.hat !== "none") { const cap = new THREE.Mesh(new THREE.CylinderGeometry(.28, .3, .12, 18), material(appearance.tints.top)); place(root, cap, head, new THREE.Vector3(0, .28, .01), new THREE.Vector3(0, 2.04, .01)); }
  if (appearance.parts.glasses !== "none") {
    const glasses = new THREE.Group();
    for (const x of [-.105, .105]) { const lens = new THREE.Mesh(new THREE.TorusGeometry(.085, .014, 6, 12), new THREE.MeshBasicMaterial({ color: 0x111827 })); lens.position.set(x, 0, 0); glasses.add(lens); }
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(.08, .015, .015), new THREE.MeshBasicMaterial({ color: 0x111827 })); glasses.add(bridge); place(root, glasses, head, new THREE.Vector3(0, 0, .18), new THREE.Vector3(0, 1.83, .245));
  }
  if (appearance.parts.badge !== "none" && appearance.badge.style !== "none") {
    const color = appearance.badge.style === "floating" ? "#fbbf24" : "#e2e8f0";
    if (appearance.parts.badge === "lanyard") { const strap = new THREE.Mesh(new THREE.TorusGeometry(.18, .014, 6, 16, Math.PI), material(rankColor || appearance.tints.top)); strap.rotation.z = Math.PI; place(root, strap, chest, new THREE.Vector3(0, -.14, .14), new THREE.Vector3(0, 1.48, .245)); }
    const badge = new THREE.Mesh(appearance.parts.badge === "pin" ? new THREE.CircleGeometry(.07, 14) : new THREE.PlaneGeometry(.22, .13), material(color));
    place(root, badge, chest, appearance.parts.badge === "pin" ? new THREE.Vector3(.17, -.2, .15) : new THREE.Vector3(0, -.36, .15), appearance.parts.badge === "pin" ? new THREE.Vector3(.17, 1.42, .25) : new THREE.Vector3(0, 1.25, .25));
  }
}

/** Remove all per-actor procedural attachment GPU resources. */
export function disposeAttachments(root: THREE.Group): void {
  const previous: THREE.Object3D[] = [];
  root.traverse(item => { if (item.name === attachmentName) previous.push(item); });
  for (const item of previous) { item.removeFromParent(); disposeAttachment(item); }
}
