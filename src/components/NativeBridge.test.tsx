// @vitest-environment happy-dom
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';

const exitApp = vi.fn();
const remove = vi.fn();
let backHandler: ((e: { canGoBack: boolean }) => void) | undefined;
const addListener = vi.fn(async (_n: string, h: (e: { canGoBack: boolean }) => void) => {
  backHandler = h;
  return { remove };
});
const hide = vi.fn(async () => {});
const setStyle = vi.fn(async () => {});
const setBackgroundColor = vi.fn(async () => {});
vi.mock('@capacitor/app', () => ({ App: { addListener, exitApp } }));
vi.mock('@capacitor/splash-screen', () => ({ SplashScreen: { hide } }));
vi.mock('@capacitor/status-bar', () => ({ StatusBar: { setStyle, setBackgroundColor }, Style: { Dark: 'DARK' } }));

import NativeBridge from './NativeBridge';

describe('NativeBridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    backHandler = undefined;
  });
  afterEach(() => {
    cleanup();
    (window as unknown as { Capacitor?: unknown }).Capacitor = undefined;
  });

  it('does nothing on the web', async () => {
    render(<NativeBridge />);
    await new Promise((r) => setTimeout(r, 10));
    expect(addListener).not.toHaveBeenCalled();
    expect(hide).not.toHaveBeenCalled();
  });

  it('hides the splash, styles the status bar and routes the back button', async () => {
    (window as unknown as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => true };
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {});
    const { unmount } = render(<NativeBridge />);
    await waitFor(() => expect(hide).toHaveBeenCalled());
    expect(setStyle).toHaveBeenCalled();
    window.history.pushState({}, '', '/projects/1');
    backHandler!({ canGoBack: true });
    expect(back).toHaveBeenCalledTimes(1);
    expect(exitApp).not.toHaveBeenCalled();
    window.history.pushState({}, '', '/');
    backHandler!({ canGoBack: true });
    expect(exitApp).toHaveBeenCalledTimes(1);
    expect(back).toHaveBeenCalledTimes(1);
    unmount();
    expect(remove).toHaveBeenCalled();
  });
});
