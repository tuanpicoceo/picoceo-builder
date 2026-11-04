import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// @ts-expect-error plain JS module shared with the production server
import { handleApi } from './server/design.mjs';

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'cyberbuild-api',
      configureServer(server) {
        server.middlewares.use(async (req, res, next) => {
          if (!req.url?.startsWith('/api/')) return next();
          return handleApi(req, res);
        });
      },
      configurePreviewServer(server) {
        server.middlewares.use((req, res, next) => (req.url?.startsWith('/api/') ? handleApi(req, res) : next()));
      },
    },
  ],
  server: { port: 5180 },
  worker: { format: 'es' },
  optimizeDeps: { exclude: ['manifold-3d'] },
});
