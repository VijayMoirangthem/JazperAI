import * as THREE from "three";
import type { World } from "../core/world";

const COLORS: Record<string, number> = { work: 0x38bdf8, meet: 0xa78bfa, tools: 0xf97316, social: 0x22c55e, private: 0xf43f5e, transit: 0x94a3b8 };

export class ZoneOverlay {
  private readonly group = new THREE.Group();
  constructor(scene: THREE.Scene, world: World) {
    this.group.visible = false;
    for (const room of world.rooms) {
      const width = room.rect[2] - room.rect[0] + 1, height = room.rect[3] - room.rect[1] + 1, color = COLORS[room.kind] ?? 0xffffff;
      const fill = new THREE.Mesh(new THREE.PlaneGeometry(width, height), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: .12, depthWrite: false, side: THREE.DoubleSide }));
      fill.rotation.x = -Math.PI / 2; fill.position.set(room.rect[0] + width / 2, .012, room.rect[1] + height / 2); this.group.add(fill);
      const points = [new THREE.Vector3(room.rect[0], .02, room.rect[1]), new THREE.Vector3(room.rect[2] + 1, .02, room.rect[1]), new THREE.Vector3(room.rect[2] + 1, .02, room.rect[3] + 1), new THREE.Vector3(room.rect[0], .02, room.rect[3] + 1)];
      this.group.add(new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color, transparent: true, opacity: .8 })));
    }
    scene.add(this.group);
  }
  setVisible(visible: boolean): void { this.group.visible = visible; }
  dispose(): void { this.group.removeFromParent(); this.group.traverse((item) => { const mesh = item as THREE.Mesh; mesh.geometry?.dispose(); const material = mesh.material as THREE.Material | undefined; material?.dispose(); }); }
}
