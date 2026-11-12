// Runs in the browser before the app starts (Next.js 15.3+). Turns on error
// reporting; a no-op unless NEXT_PUBLIC_SENTRY_DSN was set at build time.
import { initClientMonitoring } from './lib/client/monitoring';

initClientMonitoring();
