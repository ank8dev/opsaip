import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// Fonts are bundled with the app (no Google Fonts request), so it works
// offline, on a self-hosted server, and inside the desktop app.
import '@fontsource/instrument-sans/400.css';
import '@fontsource/instrument-sans/500.css';
import '@fontsource/dm-mono/400.css';
import '@fontsource/dm-mono/500.css';

import './styles/tokens.css';
import './styles/base.css';
import { App } from './App';
import { markShell } from './lib/shell';

// Before the first render, so the desktop window never paints without its title bar space.
markShell(document, location);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
