import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const service = process.env.PUMP_SERVICE ?? 'http://127.0.0.1:8000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { '/api': { target: service, changeOrigin: false } },
  },
  build: { target: 'es2020', sourcemap: true },
});
