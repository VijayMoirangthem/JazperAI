import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import { defineConfig, loadEnv } from "vite";

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, here, "");
  return {
    plugins: [react(), tailwind()],
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
