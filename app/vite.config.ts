import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import { defineConfig, loadEnv } from "vite";

const here = path.dirname(fileURLToPath(import.meta.url));
const fe = (p: string) => path.resolve(here, "../frontend", p);

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, here, "");
  return {
    plugins: [react(), tailwind()],
    resolve: {
      alias: [
        { find: "@", replacement: fe("src") },
        { find: "next/dynamic", replacement: path.resolve(here, "src/shims/dynamic.tsx") },
        // one React instance for both the app shell and the shared frontend sources
        { find: /^react$/, replacement: fe("node_modules/react") },
        { find: /^react\/(.*)$/, replacement: fe("node_modules/react/$1") },
        { find: /^react-dom$/, replacement: fe("node_modules/react-dom") },
        { find: /^react-dom\/(.*)$/, replacement: fe("node_modules/react-dom/$1") },
      ],
    },
    define: { "process.env.NEXT_PUBLIC_API_URL": JSON.stringify(env.JASPER_API_URL || "http://localhost:8000") },
    server: { fs: { allow: [path.resolve(here, "..")] } },
    build: { chunkSizeWarningLimit: 4000 },
  };
});
