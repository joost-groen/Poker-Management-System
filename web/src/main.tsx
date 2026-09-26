import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { isNative } from './api.ts';
import { App } from './App.tsx';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Lets the home-screen app open without network; skipped in dev (Vite) and in the native shell.
if ('serviceWorker' in navigator && import.meta.env.PROD && !isNative) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
