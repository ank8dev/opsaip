import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The web app is a static SPA: the self-hosted Opsaip server (and later the
// desktop app) serves the files in dist/. `base: './'` keeps asset paths
// relative, so the same build also works when loaded from disk by Electron.
export default defineConfig({
  plugins: [react()],
  base: './',
});
