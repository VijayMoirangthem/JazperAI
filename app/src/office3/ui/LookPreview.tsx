"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

export function LookPreview({ file, label, active = true }: { file?: string; label?: string; active?: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const target = host.current;
    if (!target || !file || !active) { target?.replaceChildren(); return; }
    let disposed = false;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(28, 1, .1, 100);
    camera.position.set(0, 1.15, 4);
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setSize(128, 128); target.replaceChildren(renderer.domElement);
    scene.add(new THREE.HemisphereLight(0xe0f2fe, 0x0f172a, 2));
    const key = new THREE.DirectionalLight(0xffffff, 2); key.position.set(2, 3, 4); scene.add(key);
    let model: THREE.Object3D | null = null, frame = 0;
    void new GLTFLoader().loadAsync(file).then(gltf => {
      if (disposed) { gltf.scene.traverse(item => { const mesh = item as THREE.Mesh; mesh.geometry?.dispose(); const material = mesh.material as THREE.Material | THREE.Material[] | undefined; if (Array.isArray(material)) material.forEach(value => value.dispose()); else material?.dispose(); }); return; }
      model = gltf.scene;
      const bounds = new THREE.Box3().setFromObject(model), size = bounds.getSize(new THREE.Vector3()), center = bounds.getCenter(new THREE.Vector3());
      model.scale.setScalar(2.25 / Math.max(size.y, .01));
      model.position.set(-center.x * model.scale.x, -bounds.min.y * model.scale.y - 1.1, -center.z * model.scale.z);
      scene.add(model);
    }).catch(() => undefined);
    const render = () => { frame = requestAnimationFrame(render); if (model) model.rotation.y += .012; renderer.render(scene, camera); };
    render();
    return () => { disposed = true; cancelAnimationFrame(frame); scene.traverse(item => { const mesh = item as THREE.Mesh; mesh.geometry?.dispose(); const material = mesh.material as THREE.Material | THREE.Material[] | undefined; if (Array.isArray(material)) material.forEach(value => value.dispose()); else material?.dispose(); }); renderer.dispose(); renderer.forceContextLoss(); };
  }, [file, active]);
  return <div className="flex h-36 items-center justify-center overflow-hidden rounded bg-slate-900/80" aria-label={label ? `${label} live appearance preview` : "Live appearance preview"} ref={host}><span className="text-xs text-slate-500">Loading preview…</span></div>;
}
