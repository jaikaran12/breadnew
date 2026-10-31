import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { isNativeApp } from './store';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Browser version only: keep the app files on the phone so it also opens without internet.
if (!isNativeApp() && 'serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => undefined);
  });
}
