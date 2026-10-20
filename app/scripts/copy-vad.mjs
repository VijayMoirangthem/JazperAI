// Copies the Silero VAD model, worklet and ONNX runtime wasm into public/vad so voice mode works offline and under the desktop CSP.
import fs from "node:fs";
import path from "node:path";
const out = path.resolve("public/vad");
fs.mkdirSync(out, { recursive: true });
const from = (pkg, files) => files.forEach((f) => { const src = path.resolve("node_modules", pkg, "dist", f); if (fs.existsSync(src)) fs.copyFileSync(src, path.join(out, f)); else console.warn("missing", src); });
from("@ricky0123/vad-web", ["silero_vad_v5.onnx", "vad.worklet.bundle.min.js"]);
from("onnxruntime-web", ["ort-wasm-simd-threaded.wasm", "ort-wasm-simd-threaded.mjs", "ort-wasm-simd-threaded.jsep.wasm", "ort-wasm-simd-threaded.jsep.mjs"]);
console.log("vad assets ->", out);
