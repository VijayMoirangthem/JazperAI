import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";

export class PrefabLoader {
  private readonly loader = new GLTFLoader();
  private readonly cache = new Map<string, Promise<GLTF>>();

  load(url: string): Promise<GLTF> {
    let result = this.cache.get(url);
    if (!result) { result = this.loader.loadAsync(url); this.cache.set(url, result); }
    return result;
  }

  async fit(scene: THREE.Scene, id: string, x: number, z: number, width: number, height: number, rotation = 0): Promise<void> {
    const object = cloneSkinned((await this.load(`/office3/models/${id}.glb`)).scene);
    const bounds = new THREE.Box3().setFromObject(object);
    const size = bounds.getSize(new THREE.Vector3());
    object.scale.setScalar(Math.max(width, height) / Math.max(size.x, size.z));
    object.rotation.y = rotation;
    const fitted = new THREE.Box3().setFromObject(object);
    object.position.set(x - (fitted.min.x + fitted.max.x) / 2, -fitted.min.y, z - (fitted.min.z + fitted.max.z) / 2);
    scene.add(object);
  }
}
