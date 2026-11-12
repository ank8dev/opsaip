import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The web app is a static SPA: the self-hosted Opsaip server (and later the
// desktop app) serves the files in dist/. `base: './'` keeps asset paths
// relative, so the same build also works when loaded from disk by Electron.
//
// The app calls the API with relative paths (/v1/...), so it always talks to
// its own origin. In `npm run dev` and `npm run preview`, Vite forwards /v1 to
// the Opsaip server at OPSAIP_URL. This runs in Node only: the address is not
// part of the build, and the token never passes through this file.
const serverUrl = process.env.OPSAIP_URL?.trim() || 'http://127.0.0.1:4100';
const proxy = { '/v1': { target: serverUrl } };

export default defineConfig({
  plugins: [react()],
  base: './',
  server: { proxy },
  preview: { proxy },
});
