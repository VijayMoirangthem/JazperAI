import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import { defineConfig, loadEnv } from "vite";

const here = path.dirname(fileURLToPath(import.meta.url));

// Dev only: Vite refuses to serve public/*.mjs as an import (the ONNX runtime loads its wasm loader that way), so /vad/ is served raw.
const MIME: Record<string, string> = { ".mjs": "application/javascript", ".js": "application/javascript", ".wasm": "application/wasm", ".onnx": "application/octet-stream" };
const vadStatic = {
  name: "vad-static",
  configureServer(server: { middlewares: { use: (p: string, h: (req: { url?: string }, res: { setHeader: (k: string, v: string) => void }, next: () => void) => void) => void } }) {
    server.middlewares.use("/vad", (req, res, next) => {
      const file = path.join(here, "public", "vad", decodeURIComponent((req.url || "").split("?")[0]));
      if (!file.startsWith(path.join(here, "public", "vad")) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return next();
      res.setHeader("Content-Type", MIME[path.extname(file)] || "application/octet-stream");
      fs.createReadStream(file).pipe(res as unknown as NodeJS.WritableStream);
    });
  },
};

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, here, "");
  return {
    base: env.JASPER_BASE || "/", // production build is served by the backend under /ui/
    plugins: [react(), tailwind(), vadStatic],
    resolve: {
      alias: [
        { find: "@", replacement: path.resolve(here, "src") },
        { find: "next/dynamic", replacement: path.resolve(here, "src/shims/dynamic.tsx") },
      ],
    },
    define: { "process.env.NEXT_PUBLIC_API_URL": JSON.stringify(env.JASPER_API_URL || "http://localhost:8000") },
    build: { chunkSizeWarningLimit: 4000 },
  };
});
