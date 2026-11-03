import * as THREE from "three";

interface Effect { mesh: THREE.Mesh; born: number; life: number; kind: string; }
/** A small bounded effect pool; effects are decorative and never allocate in the frame loop. */
export class InteractionFx {
  private readonly group = new THREE.Group();
  private readonly effects: Effect[] = [];
  constructor(scene: THREE.Scene, private readonly max = 150) { scene.add(this.group); }
  spawn(kind: string, x: number, z: number): void {
    while (this.effects.length >= this.max) { const old = this.effects.shift(); old?.mesh.removeFromParent(); old?.mesh.geometry.dispose(); (old?.mesh.material as THREE.Material | undefined)?.dispose(); }
    const coffee = kind === "coffee", paper = kind === "printer", alert = kind === "server-rack", birthday = kind === "birthday";
    const geometry = coffee ? new THREE.SphereGeometry(.07, 8, 6) : paper ? new THREE.PlaneGeometry(.18, .24) : birthday ? new THREE.PlaneGeometry(.08, .13) : new THREE.RingGeometry(.15, .24, 16);
    const material = new THREE.MeshBasicMaterial({ color: coffee ? 0xd6d3d1 : alert ? 0xef4444 : birthday ? [0xf472b6, 0xfacc15, 0x60a5fa, 0x34d399][Math.floor(Math.random() * 4)] : 0x67e8f9, transparent: true, opacity: .85, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geometry, material); mesh.position.set(x + (birthday ? (Math.random() - .5) * 1.1 : 0), birthday ? 1.2 + Math.random() * .8 : coffee ? .7 : .08, z + (birthday ? (Math.random() - .5) * 1.1 : 0)); if (!coffee && !paper && !birthday) mesh.rotation.x = -Math.PI / 2; mesh.userData.office3FxDrift = birthday ? (Math.random() - .5) * .012 : 0; this.group.add(mesh); this.effects.push({ mesh, born: performance.now(), life: birthday ? 1800 : coffee ? 2200 : paper ? 1500 : 1100, kind });
  }
  update(now: number): void { for (let index = this.effects.length - 1; index >= 0; index--) { const effect = this.effects[index], age = (now - effect.born) / effect.life; if (age >= 1) { effect.mesh.removeFromParent(); effect.mesh.geometry.dispose(); (effect.mesh.material as THREE.Material).dispose(); this.effects.splice(index, 1); continue; } const material = effect.mesh.material as THREE.MeshBasicMaterial; material.opacity = .85 * (1 - age); if (effect.kind === "coffee") effect.mesh.position.y += .002; else if (effect.kind === "birthday") { effect.mesh.position.y -= .012; effect.mesh.position.x += Number(effect.mesh.userData.office3FxDrift ?? 0); effect.mesh.rotation.z += .12; } else effect.mesh.scale.setScalar(1 + age * 2); } }
  dispose(): void { for (const effect of this.effects) { effect.mesh.geometry.dispose(); (effect.mesh.material as THREE.Material).dispose(); } this.effects.length = 0; this.group.removeFromParent(); }
}
