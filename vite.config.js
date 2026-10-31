import { defineConfig } from 'vite';
// base './' lets the built viewer run from any folder or sub-path (exported tours, static hosts).
export default defineConfig({
  base: './',
  server: { host: '127.0.0.1', port: 5173, proxy: { '/api': 'http://127.0.0.1:4174', '/media': 'http://127.0.0.1:4174' } },
  build: { target: 'es2022', chunkSizeWarningLimit: 1600 }
});
