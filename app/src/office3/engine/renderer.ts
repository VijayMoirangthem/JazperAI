import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { qualitySettings, type QualityTier } from "../core/quality";

export interface RendererHandle {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  setQuality(tier: QualityTier): void;
  resize(): void;
  dispose(): void;
}

export function createRenderer(host: HTMLElement, width: number, height: number): RendererHandle {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.setSize(host.clientWidth || 800, host.clientHeight || 600);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  host.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#0b0f14");
  const camera = new THREE.PerspectiveCamera(35, (host.clientWidth || 800) / (host.clientHeight || 600), 0.5, 400);
  camera.position.set(width / 2, 42, height + 16);
  const controls = new OrbitControls(camera, renderer.domElement);
  const onContextLost = (event: Event) => { event.preventDefault(); window.dispatchEvent(new Event("office3:webgl-lost")); };
  const onContextRestored = () => window.dispatchEvent(new Event("office3:webgl-restored"));
  renderer.domElement.addEventListener("webglcontextlost", onContextLost);
  renderer.domElement.addEventListener("webglcontextrestored", onContextRestored);
  controls.target.set(width / 2, 0, height / 2 + 2);
  controls.enableDamping = true;
  controls.maxPolarAngle = 1.25;
  controls.minDistance = 6;
  controls.maxDistance = 110;
  controls.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.ROTATE };

  const resize = () => {
    const nextWidth = host.clientWidth;
    const nextHeight = host.clientHeight;
    if (!nextWidth || !nextHeight) return;
    renderer.setSize(nextWidth, nextHeight);
    camera.aspect = nextWidth / nextHeight;
    camera.updateProjectionMatrix();
  };
  const setQuality = (tier: QualityTier) => { const settings = qualitySettings(tier); renderer.setPixelRatio(Math.min(window.devicePixelRatio, settings.pixelRatio)); renderer.shadowMap.enabled = settings.shadows; resize(); };
  return { renderer, scene, camera, controls, setQuality, resize, dispose: () => { renderer.domElement.removeEventListener("webglcontextlost", onContextLost); renderer.domElement.removeEventListener("webglcontextrestored", onContextRestored); controls.dispose(); renderer.dispose(); renderer.domElement.remove(); } };
}
