import * as THREE from "three";

export type WallMode = "auto" | "cutaway" | "full";

const materialsFor = (root: THREE.Object3D): THREE.Material[] => {
  const materials: THREE.Material[] = [];
  root.traverse(item => {
    if (!(item instanceof THREE.Mesh)) return;
    const source = item.material;
    materials.push(...(Array.isArray(source) ? source : [source]));
  });
  return materials;
};

export class WallOcclusion {
  private mode: WallMode = "auto";
  private target = new THREE.Vector3();

  constructor(private scene: THREE.Scene) {}

  setMode(mode: WallMode) { this.mode = mode; this.apply(); }
  setTarget(target: THREE.Vector3) { this.target.copy(target); }
  update(camera: THREE.Camera) { if (this.mode === "auto") this.apply(camera); }

  private apply(camera?: THREE.Camera) {
    const walls = this.scene.userData.office3Walls as THREE.Object3D | undefined;
    if (!walls) return;
    const autoOpacity = camera && camera.position.distanceTo(this.target) > 10 ? .12 : 1;
    for (const material of materialsFor(walls)) {
      if (!(material instanceof THREE.MeshStandardMaterial)) continue;
      const base = material.userData.office3OcclusionBase as { transparent: boolean; depthWrite: boolean; opacity: number } | undefined
        ?? { transparent: material.transparent, depthWrite: material.depthWrite, opacity: material.opacity };
      material.userData.office3OcclusionBase = base;
      if (this.mode === "auto") {
        material.transparent = true;
        material.depthWrite = autoOpacity === 1 && base.depthWrite;
        material.opacity = base.opacity * autoOpacity;
      } else {
        material.transparent = base.transparent;
        material.depthWrite = base.depthWrite;
        material.opacity = base.opacity;
      }
      material.needsUpdate = true;
    }
    walls.scale.y = this.mode === "cutaway" ? .21 : 1;
  }
}
