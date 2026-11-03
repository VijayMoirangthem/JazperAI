import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import { normalizeAsset, type NormalizedAsset } from "../core/assetNormalize";

export class PrefabLoader {
  private readonly loader = new GLTFLoader();
  private readonly cache = new Map<string, Promise<GLTF>>();

  load(url: string): Promise<GLTF> {
    let result = this.cache.get(url);
    if (!result) { result = this.loader.loadAsync(url); this.cache.set(url, result); }
    return result;
  }

  /** Placement data (scale, footprint, seat/anchor points) derived from the model's bounds and named nodes. */
  async describe(id: string, tile = 1, cells?: [number, number]): Promise<NormalizedAsset> {
    const scene = (await this.load(`/office3/models/${id}.glb`)).scene;
    scene.updateWorldMatrix(true, true);
    const box = new THREE.Box3().setFromObject(scene);
    const nodes: { name: string; pos: [number, number, number] }[] = [];
    scene.traverse(node => { if (nodes.length < 64 && node.name) { const p = node.getWorldPosition(new THREE.Vector3()); nodes.push({ name: node.name, pos: [p.x, p.y, p.z] }); } });
    return normalizeAsset({ min: [box.min.x, box.min.y, box.min.z], max: [box.max.x, box.max.y, box.max.z] }, tile, nodes, cells);
  }

  async fit(scene: THREE.Scene, id: string, x: number, z: number, width: number, height: number, rotation = 0, scale = 1): Promise<THREE.Group> {
    const object = cloneSkinned((await this.load(`/office3/models/${id}.glb`)).scene);
    const bounds = new THREE.Box3().setFromObject(object);
    const size = bounds.getSize(new THREE.Vector3());
    object.scale.setScalar(Math.max(width, height) * scale / Math.max(size.x, size.z));
    object.rotation.y = rotation;
    const fitted = new THREE.Box3().setFromObject(object);
    object.position.set(x - (fitted.min.x + fitted.max.x) / 2, -fitted.min.y, z - (fitted.min.z + fitted.max.z) / 2);
    scene.add(object);
    return object as THREE.Group;
  }
}
