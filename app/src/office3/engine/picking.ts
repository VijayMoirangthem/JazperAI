import * as THREE from "three";
import type { OfficeActor } from "./actors";

const rayFor = (event: MouseEvent, canvas: HTMLCanvasElement, camera: THREE.Camera) => {
  const rect = canvas.getBoundingClientRect(), ray = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), camera);
  return ray;
};

export const pickActor = (event: MouseEvent, canvas: HTMLCanvasElement, camera: THREE.Camera, actors: Iterable<OfficeActor>, additionalRoots: THREE.Object3D[] = []) => {
  const hits = rayFor(event, canvas, camera).intersectObjects([...actors].flatMap((actor): THREE.Object3D[] => [actor.root, actor.proxy]).concat(additionalRoots as THREE.Object3D[]), true);
  if (!hits[0]) return null;
  const instanced = hits[0].object.userData.officeActorInstances as Map<number, OfficeActor> | undefined;
  if (instanced && hits[0].instanceId !== undefined) return instanced.get(hits[0].instanceId) ?? null;
  let hit: THREE.Object3D | null = hits[0].object;
  while (hit?.parent && !hit.userData.officeActor) hit = hit.parent;
  return hit?.userData.officeActor as OfficeActor | undefined;
};

/** Finds a persisted world prefab root from a hit on any of its GLB child meshes. */
export const pickWorldObject = (event: MouseEvent, canvas: HTMLCanvasElement, camera: THREE.Camera, scene: THREE.Scene) => {
  const indexed = scene.userData.office3WorldObjects as Map<string, THREE.Object3D> | undefined;
  const instanced = scene.userData.office3WorldInstanceRoots as THREE.Object3D[] | undefined;
  const roots = (indexed ? [...indexed.values()] : (() => { const found: THREE.Object3D[] = []; scene.traverse(item => { if (typeof item.userData.office3WorldObjectId === "string") found.push(item); }); return found; })()).concat(instanced ?? []);
  const hitRecord = rayFor(event, canvas, camera).intersectObjects(roots, true)[0];
  const hit = hitRecord?.object;
  const instanceIds = hitRecord?.object.userData.office3WorldInstanceIds as string[] | undefined;
  if (instanceIds && hitRecord?.instanceId !== undefined) return indexed?.get(instanceIds[hitRecord.instanceId]) ?? null;
  let current: THREE.Object3D | null | undefined = hit;
  while (current?.parent && typeof current.userData.office3WorldObjectId !== "string") current = current.parent;
  return typeof current?.userData.office3WorldObjectId === "string" ? current : null;
};
