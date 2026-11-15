'use client';

import { useSyncExternalStore } from 'react';

const noSubscription = () => () => {};

/**
 * A value only the browser can read (storage, feature detection), read during render instead of
 * being copied into state by an effect: `serverValue` on the server and while hydrating, then the
 * browser's value. `read` runs on every render, so it must be cheap and return a primitive (or
 * the same object each time); nothing re-reads it later, so it suits values fixed for the page's life.
 */
export function useBrowserValue<T>(read: () => T, serverValue: T): T {
  return useSyncExternalStore(noSubscription, read, () => serverValue);
}
