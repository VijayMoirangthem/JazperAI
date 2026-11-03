import * as THREE from "three";import {OrbitControls} from "three/examples/jsm/controls/OrbitControls.js";import {DEG,clampTilt,ease,fitRoomDistance,snapYaw} from "../core/cameraMath";import type {World} from "../core/world";import type {Office3Bus} from "../core/bus";
export type CameraPreset="isometric"|"top-down"|"cinematic"|"eye-level";const PRESETS:Record<CameraPreset,[number,number,number]>={isometric:[45,55,30],"top-down":[0,90,30],cinematic:[45,25,45],"eye-level":[0,72,60]};
export class CameraRig3D {
  private yaw = 45 * DEG;
  private tilt = 55 * DEG;
  private distance = 62;
  private preset: CameraPreset = "isometric";
  private changed = 0;
  private readonly followTarget = new THREE.Vector3();

  constructor(private camera: THREE.PerspectiveCamera, private controls: OrbitControls, private world: World, private bus: Office3Bus) {
    const saved = localStorage.getItem("office3.camera");
    if (saved) try { Object.assign(this, JSON.parse(saved)); } catch {}
    this.controls.enableDamping = true;
    this.controls.dampingFactor = .12;
    this.apply();
  }

  private apply() {
    const y = this.tilt, d = this.distance;
    this.camera.position.set(this.controls.target.x + d * Math.sin(this.yaw) * Math.sin(y), d * Math.cos(y), this.controls.target.z + d * Math.cos(this.yaw) * Math.sin(y));
    this.camera.fov = PRESETS[this.preset][2];
    this.camera.updateProjectionMatrix();
    this.controls.update();
  }

  movementDelta(forward: number, strafe: number): [number, number] {
    const x = -Math.sin(this.yaw) * forward + Math.cos(this.yaw) * strafe, z = -Math.cos(this.yaw) * forward - Math.sin(this.yaw) * strafe;
    const dx = Math.round(x), dz = Math.round(z);
    return [dx || Math.sign(x), dz || Math.sign(z)];
  }

  rotate(degrees: number) { this.yaw += degrees * DEG; this.save(); }
  setPreset(p: CameraPreset) { this.preset = p; const [x, y] = PRESETS[p]; this.yaw = x * DEG; this.tilt = clampTilt(y * DEG); this.save(); }
  cyclePreset() { const all: CameraPreset[] = ["isometric", "top-down", "cinematic", "eye-level"]; this.setPreset(all[(all.indexOf(this.preset) + 1) % all.length]); }
  focusRoom(index: number) { const rooms = this.world.rooms.filter(room => room.rules.focusable), room = rooms[index]; if (!room) return; this.controls.target.set((room.rect[0] + room.rect[2] + 1) / 2, 0, (room.rect[1] + room.rect[3] + 1) / 2); this.distance = fitRoomDistance(room.rect[2] - room.rect[0] + 1, room.rect[3] - room.rect[1] + 1); this.save(); }
  home() { this.controls.target.set(this.world.spawn.founder[0] + .5, 0, this.world.spawn.founder[1] + .5); this.save(); }
  reset() { const [yaw, tilt] = PRESETS.isometric; this.preset = "isometric"; this.yaw = yaw * DEG; this.tilt = clampTilt(tilt * DEG); this.distance = 62; this.controls.target.set(this.world.spawn.founder[0] + .5, 0, this.world.spawn.founder[1] + .5); this.save(); }
  focusPoint(x: number, z: number) { this.controls.target.set(x, 0, z); this.save(); }
  followPoint(x: number, z: number, seconds: number) { this.followTarget.set(x, 0, z); this.controls.target.lerp(this.followTarget, Math.min(1, seconds * 8)); this.controls.update(); }
  tick(seconds: number, reducedMotion = false) { if (this.preset !== "cinematic" || reducedMotion) return; this.yaw += seconds * .08; this.apply(); }
  setPhotoMode(enabled: boolean) { this.controls.screenSpacePanning = enabled; this.controls.minPolarAngle = enabled ? .05 : 0; this.controls.maxPolarAngle = enabled ? Math.PI - .05 : 1.25; this.controls.minDistance = enabled ? 1 : 6; this.controls.maxDistance = enabled ? 180 : 110; this.controls.update(); }
  handle(key: string, shift: boolean, viewCycleKey = "t") { if (key === "q") this.rotate(shift ? -15 : -90); else if (key === "e") this.rotate(shift ? 15 : 90); else if (key === "r") this.reset(); else if (key === viewCycleKey) this.cyclePreset(); else if (key === "home") this.home(); else if (/^[1-9]$/.test(key)) this.focusRoom(Number(key) - 1); }
  save() { this.yaw = snapYaw(this.yaw, 15); this.tilt = clampTilt(this.tilt); this.distance = Math.max(6, Math.min(110, this.distance)); localStorage.setItem("office3.camera", JSON.stringify({ yaw: this.yaw, tilt: this.tilt, distance: this.distance, preset: this.preset })); this.apply(); const now = performance.now(); if (now - this.changed > 100) { this.changed = now; this.bus.emit("camera.change", { yaw: this.yaw, tilt: this.tilt, distance: this.distance }); } }
  dispose() {}
}
