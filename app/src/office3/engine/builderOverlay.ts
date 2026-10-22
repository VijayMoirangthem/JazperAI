import * as THREE from "three";

export class BuilderOverlay {
  private readonly grid: THREE.GridHelper;
  private readonly ghost: THREE.Mesh;
  private enabled = false;
  constructor(scene: THREE.Scene, width: number, height: number) {
    this.grid = new THREE.GridHelper(Math.max(width, height), Math.max(width, height), 0x60a5fa, 0x1e3a8a);
    this.grid.position.set(width / 2, 0.02, height / 2);
    this.grid.visible = false;
    scene.add(this.grid);
    this.ghost = new THREE.Mesh(new THREE.BoxGeometry(.9, .9, .9), new THREE.MeshBasicMaterial({ color: 0x22c55e, transparent: true, opacity: .45 }));
    this.ghost.position.y = .45; this.ghost.visible = false; scene.add(this.ghost);
  }
  setEnabled(enabled: boolean): void { this.enabled = enabled; this.grid.visible = enabled; this.ghost.visible = false; }
  preview(x: number, z: number, valid: boolean): void { if (!this.enabled) return; this.ghost.visible = true; this.ghost.position.set(Math.floor(x) + .5, .45, Math.floor(z) + .5); (this.ghost.material as THREE.MeshBasicMaterial).color.set(valid ? 0x22c55e : 0xef4444); }
  hidePreview(): void { this.ghost.visible = false; }
  isEnabled(): boolean { return this.enabled; }
  dispose(): void { this.grid.removeFromParent(); this.grid.geometry.dispose(); (this.grid.material as THREE.Material).dispose(); this.ghost.removeFromParent(); this.ghost.geometry.dispose(); (this.ghost.material as THREE.Material).dispose(); }
}
