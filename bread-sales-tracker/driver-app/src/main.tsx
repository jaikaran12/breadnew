import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { actions } from './store';
import './styles.css';

// Listen before anything else: the service worker announces a downloaded new version right after the page
// starts, and a message that arrives before anyone listens is lost.
navigator.serviceWorker?.addEventListener('message', (event: MessageEvent) => {
  if ((event.data as { type?: string } | null)?.type === 'app-updated') actions.updateReady();
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Keep the app's files on the phone so it opens instantly, even without internet
// (in Chrome and in the Android app, which is Chrome showing this web app).
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => undefined);
  });
}
