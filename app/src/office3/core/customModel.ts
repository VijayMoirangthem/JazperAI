export const MAX_CUSTOM_MODEL_BYTES = 8 * 1024 * 1024;
export const isGlbMagic = (bytes: Uint8Array): boolean => bytes.length >= 4 && bytes[0] === 0x67 && bytes[1] === 0x6c && bytes[2] === 0x54 && bytes[3] === 0x46;
export const validateCustomModel = (name: string, bytes: Uint8Array): string | null => { if (!/^[a-zA-Z0-9_.-]+\.(glb|gltf)$/i.test(name)) return "Use a .glb or .gltf file."; if (bytes.byteLength > MAX_CUSTOM_MODEL_BYTES) return "Model exceeds 8 MB."; if (/\.glb$/i.test(name) && !isGlbMagic(bytes)) return "The GLB file signature is invalid."; return null; };
