import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// Tauri expects a fixed port and does not want vite to clear the screen.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: { ignored: ['**/src-tauri/**'] },
  },
  build: {
    target: 'safari15',
    rollupOptions: { input: { main: path.resolve(__dirname, 'index.html'), orb: path.resolve(__dirname, 'orb.html') } },
    outDir: 'dist',
    emptyOutDir: true,
  },
});
