import type { CapacitorConfig } from '@capacitor/cli';

const url = process.env.CAP_SERVER_URL;
if (!url && process.env.CAP_REQUIRE_URL === '1') {
  throw new Error('CAP_SERVER_URL is required (e.g. https://your-app.example.com)');
}

const config: CapacitorConfig = {
  appId: 'com.homedesign.app',
  appName: 'Home Design',
  webDir: 'mobile/www',
  server: {
    ...(url
      ? {
          url,
          // Only the app origin may be navigated to inside the WebView.
          allowNavigation: [new URL(url).hostname],
          cleartext: url.startsWith('http://'),
        }
      : {}),
    errorPath: 'offline.html',
  },
  plugins: {
    SplashScreen: { launchAutoHide: true, launchShowDuration: 3000, backgroundColor: '#ffffff' },
  },
};

export default config;
