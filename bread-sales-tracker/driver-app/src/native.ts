import { App as CapApp } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { Share } from '@capacitor/share';
import { actions, getState, wakeUp } from './store';

// Things like open pop-ups register here so the phone's Back button closes them first.
const backHandlers: Array<() => void> = [];

export function pushBackHandler(fn: () => void): () => void {
  backHandlers.push(fn);
  return () => {
    const i = backHandlers.lastIndexOf(fn);
    if (i >= 0) backHandlers.splice(i, 1);
  };
}

/** Same behaviour for the phone's Back button, the browser Back button and the ← in the app. */
export function handleBack(): void {
  const top = backHandlers[backHandlers.length - 1];
  if (top) {
    top();
    return;
  }
  if (getState().stack.length > 1) {
    actions.back();
    return;
  }
  if (Capacitor.isNativePlatform()) void CapApp.minimizeApp().catch(() => undefined);
}

export function canGoBackInApp(): boolean {
  return backHandlers.length > 0 || getState().stack.length > 1;
}

export function setupNative(): void {
  if (!Capacitor.isNativePlatform()) return;
  void CapApp.addListener('backButton', () => handleBack());
  void CapApp.addListener('resume', () => wakeUp());
}

export async function shareText(text: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    await Share.share({ text, dialogTitle: 'Share bill' });
    return;
  }
  const nav = navigator as Navigator & { share?: (data: { text: string }) => Promise<void> };
  if (nav.share) {
    try {
      await nav.share({ text });
      return;
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
    }
  }
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
}

export function vibrate(ms = 12): void {
  try {
    navigator.vibrate?.(ms);
  } catch {
    // not supported
  }
}
