import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  base: '/munder/',
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify('0.4.4'),
    'import.meta.env.VITE_CTH_DEMO': JSON.stringify('1')
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src/renderer/src'),
      '@shared': resolve(__dirname, 'src/shared'),
      '@brand': resolve(__dirname, 'brand')
    }
  },
  build: {
    outDir: 'dist',
    assetsInlineLimit: 4096,
    chunkSizeWarningLimit: 4000
  },
  server: {
    port: 5174,
    strictPort: false
  }
});