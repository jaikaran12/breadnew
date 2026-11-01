import { actions, getState } from './store';

// Things like open pop-ups register here so the Back button closes them first.
const backHandlers: Array<() => void> = [];

export function pushBackHandler(fn: () => void): () => void {
  backHandlers.push(fn);
  return () => {
    const i = backHandlers.lastIndexOf(fn);
    if (i >= 0) backHandlers.splice(i, 1);
  };
}

/** Same behaviour for the phone's Back button and the ← in the app. */
export function handleBack(): void {
  const top = backHandlers[backHandlers.length - 1];
  if (top) {
    top();
    return;
  }
  if (getState().stack.length > 1) actions.back();
}

export function canGoBackInApp(): boolean {
  return backHandlers.length > 0 || getState().stack.length > 1;
}

/** Share text with the phone's share sheet (WhatsApp etc.), or open WhatsApp directly. */
export async function shareText(text: string): Promise<void> {
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
