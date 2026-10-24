// Inlines CAP_SERVER_URL into the copied offline page. Capacitor runs it after every
// `cap copy`/`cap sync` (the `capacitor:copy:after` script). The offline page can't ask the
// bridge: Capacitor doesn't inject it into the errorPath page, and with server.url set no other
// bundled file is served, so the url has to live in the page itself.
import { readFileSync, writeFileSync } from 'node:fs';

const PLACEHOLDER = '<script src="server-url.js"></script>';
const file = new URL('../android/app/src/main/assets/public/offline.html', import.meta.url);

const url = process.env.CAP_SERVER_URL || '';
if (url) new URL(url); // throws on a malformed url

const html = readFileSync(file, 'utf8');
if (!html.includes(PLACEHOLDER)) throw new Error(`offline.html is missing ${PLACEHOLDER}`);
// Escape "<" so the url can't close the script tag.
const value = JSON.stringify(url).replace(/</g, '\\u003c');
writeFileSync(file, html.replace(PLACEHOLDER, `<script>window.CAP_SERVER_URL = ${value};</script>`));
