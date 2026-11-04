import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

export const MAX_CUSTOM_MODEL_BYTES = 8 * 1024 * 1024;
export const MAX_CUSTOM_MODEL_TRIANGLES = 120_000;
export const isGlbMagic = (bytes: Uint8Array): boolean => bytes.length >= 4 && bytes[0] === 0x67 && bytes[1] === 0x6c && bytes[2] === 0x54 && bytes[3] === 0x46;
export const validateGlb = (bytes: Uint8Array): string | null => {
  if (bytes.byteLength < 20 || !isGlbMagic(bytes)) return "The GLB file signature is invalid.";
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(4, true) !== 2) return "Only GLB version 2 is supported.";
  if (view.getUint32(8, true) !== bytes.byteLength) return "The GLB file length is invalid.";
  const jsonLength = view.getUint32(12, true), jsonType = view.getUint32(16, true);
  if (jsonType !== 0x4e4f534a || jsonLength > bytes.byteLength - 20) return "The GLB JSON chunk is invalid.";
  try { JSON.parse(new TextDecoder().decode(bytes.slice(20, 20 + jsonLength)).trim()); } catch { return "The GLB JSON document is invalid."; }
  return null;
};
export const validateCustomModel = (name: string, bytes: Uint8Array): string | null => { if (!/^[a-zA-Z0-9_.-]+\.glb$/i.test(name)) return "Use a self-contained .glb file."; if (bytes.byteLength > MAX_CUSTOM_MODEL_BYTES) return "Model exceeds 8 MB."; return validateGlb(bytes); };
export const inspectCustomModel = async (bytes: Uint8Array): Promise<string | null> => {
  try {
    const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const gltf = await new Promise<Awaited<ReturnType<GLTFLoader["loadAsync"]>>>((resolve, reject) => new GLTFLoader().parse(data, "", resolve, reject));
    let triangles = 0, skinnedMeshes = 0, bones = 0;
    gltf.scene.traverse(item => { const mesh = item as THREE.Mesh; if (!mesh.isMesh) return; const position = mesh.geometry.getAttribute("position"); triangles += (mesh.geometry.getIndex()?.count ?? position?.count ?? 0) / 3; if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) { skinnedMeshes++; bones = Math.max(bones, (mesh as THREE.SkinnedMesh).skeleton.bones.length); } });
    if (!skinnedMeshes) return "Founder models need at least one skinned mesh.";
    if (bones > 256) return "Model skeleton exceeds 256 bones.";
    if (triangles > MAX_CUSTOM_MODEL_TRIANGLES) return `Model exceeds ${MAX_CUSTOM_MODEL_TRIANGLES.toLocaleString()} triangles.`;
    return null;
  } catch { return "The GLB could not be parsed as a renderable model."; }
};
