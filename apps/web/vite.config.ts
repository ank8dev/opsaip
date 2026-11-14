import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';

// The app's version, from this package's package.json, for Settings → About.
const version = (JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string }).version;

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
  define: { __APP_VERSION__: JSON.stringify(version) },
  server: { proxy },
  preview: { proxy },
});
