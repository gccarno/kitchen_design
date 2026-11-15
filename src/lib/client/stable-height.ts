'use client';

import { useSyncExternalStore } from 'react';

/**
 * A share of the window's height in px, taken once and only re-taken when the
 * window's width changes (rotation, a resized desktop window).
 *
 * `vh` units won't do on a phone: in the app's WebView the on-screen keyboard
 * shrinks the window, so a `60vh` plan shrinks too, and the field being typed
 * in jumps up the page. The keyboard never changes the width, so ignoring
 * height-only resizes keeps the layout still while typing.
 *
 * Returns undefined on the server and while hydrating, so the server render falls back to CSS.
 */
export function useStableHeight(fraction: number): number | undefined {
  const windowHeight = useSyncExternalStore(subscribe, measuredHeight, () => undefined);
  return windowHeight === undefined ? undefined : Math.round(windowHeight * fraction);
}

/** The window size as last measured: at first use, and again only when the width changes. */
let measured: { width: number; height: number } | null = null;

function measuredHeight(): number {
  measured ??= { width: window.innerWidth, height: window.innerHeight };
  return measured.height;
}

function subscribe(onChange: () => void): () => void {
  const onResize = () => {
    if (measured && window.innerWidth === measured.width) return;
    measured = { width: window.innerWidth, height: window.innerHeight };
    onChange();
  };
  window.addEventListener('resize', onResize);
  return () => window.removeEventListener('resize', onResize);
}

/** Test hook: forget the measurement, as if the page had just loaded. */
export function resetStableHeight(): void {
  measured = null;
}
