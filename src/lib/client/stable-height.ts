'use client';

import { useEffect, useState } from 'react';

/**
 * A share of the window's height in px, taken once and only re-taken when the
 * window's width changes (rotation, a resized desktop window).
 *
 * `vh` units won't do on a phone: in the app's WebView the on-screen keyboard
 * shrinks the window, so a `60vh` plan shrinks too, and the field being typed
 * in jumps up the page. The keyboard never changes the width, so ignoring
 * height-only resizes keeps the layout still while typing.
 *
 * Returns undefined until mounted, so the server render falls back to CSS.
 */
export function useStableHeight(fraction: number): number | undefined {
  const [height, setHeight] = useState<number | undefined>(undefined);
  useEffect(() => {
    let width = window.innerWidth;
    setHeight(Math.round(window.innerHeight * fraction));
    const onResize = () => {
      if (window.innerWidth === width) return;
      width = window.innerWidth;
      setHeight(Math.round(window.innerHeight * fraction));
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [fraction]);
  return height;
}
