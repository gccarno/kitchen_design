'use client';

import { useEffect } from 'react';
import { isNative } from '@/lib/client/native';

/** In the Android shell: hides the splash, styles the status bar and wires the hardware back button. No-op on the web. */
export default function NativeBridge() {
  useEffect(() => {
    if (!isNative()) return;
    let cancelled = false;
    let remove: (() => void) | undefined;
    (async () => {
      const [{ App }, { SplashScreen }, { StatusBar, Style }] = await Promise.all([
        import('@capacitor/app'),
        import('@capacitor/splash-screen'),
        import('@capacitor/status-bar'),
      ]);
      await SplashScreen.hide().catch(() => {});
      const handle = await App.addListener('backButton', ({ canGoBack }) => {
        // /login is the root for a signed-out user: `/` redirects there, so going "home" would loop.
        if (window.location.pathname === '/' || window.location.pathname === '/login') void App.exitApp();
        else if (canGoBack) window.history.back();
        else window.location.assign('/');
      });
      if (cancelled) {
        void handle.remove();
        return;
      }
      remove = () => void handle.remove();
      // Dark icons on white, matching the pages: Android 15+ ignores the bar colour (edge-to-edge),
      // so light icons would sit on the white page.
      await StatusBar.setStyle({ style: Style.Light }).catch(() => {});
      await StatusBar.setBackgroundColor({ color: '#ffffff' }).catch(() => {});
    })().catch(() => {});
    return () => {
      cancelled = true;
      remove?.();
    };
  }, []);
  return null;
}
