import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

// Puertos propios de Taller: el 3000 lo usa otra app local (sistema-erp).
const CLIENT_PORT = 3100;
const API_PORT = 3101;

export default defineConfig(() => ({
  root: '.',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    port: CLIENT_PORT,
    strictPort: true,
    host: '127.0.0.1',
    hmr: process.env.DISABLE_HMR !== 'true',
    watch: process.env.DISABLE_HMR === 'true' ? null : {},
    proxy: {
      '/api': `http://127.0.0.1:${API_PORT}`,
    },
  },
}));
