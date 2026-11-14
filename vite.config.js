import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

const privateProjectFiles = {
  name: 'teachforward-private-files',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      let requestPath;
      try { requestPath = path.posix.normalize(decodeURIComponent((req.url || '/').split('?')[0]).replace(/\\/g, '/')).toLowerCase(); }
      catch { res.statusCode = 400; res.end('Invalid request path.'); return; }
      // Case-insensitive protection is necessary on Windows, including /@fs paths.
      const privatePath = /^\/(?:server|tests|scripts)(?:\/|$)/.test(requestPath)
        || (requestPath.startsWith('/@fs/') && /\/(?:server|tests|scripts)(?:\/|$)/.test(requestPath));
      if (privatePath) { res.statusCode = 403; res.end('Private project files are not served.'); return; }
      next();
    });
  },
};

export default defineConfig({
  plugins: [privateProjectFiles, react()],
  server: {
    port: 5173,
    strictPort: true,
    fs: {
      deny: ['.env', '.env.*', '**/.env', '**/.env.*', '*.{crt,pem}', '**/.git/**', '**/server/**', '**/tests/**', '**/scripts/**'],
    },
    proxy: { '/api': 'http://127.0.0.1:3001' },
  },
});
