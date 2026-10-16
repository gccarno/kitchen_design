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
        if (window.location.pathname === '/') void App.exitApp();
        else if (canGoBack) window.history.back();
        else window.location.assign('/');
      });
      if (cancelled) {
        void handle.remove();
        return;
      }
      remove = () => void handle.remove();
      await StatusBar.setStyle({ style: Style.Dark }).catch(() => {});
      await StatusBar.setBackgroundColor({ color: '#111827' }).catch(() => {});
    })().catch(() => {});
    return () => {
      cancelled = true;
      remove?.();
    };
  }, []);
  return null;
}
