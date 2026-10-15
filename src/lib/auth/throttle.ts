export const MAX_FAILURES = 5;
export const WINDOW_MS = 15 * 60 * 1000;
export const MAX_KEYS = 10_000;

type Entry = { count: number; start: number };

/** In-memory failure limiter: MAX_FAILURES per key per WINDOW_MS (window starts at the first failure). */
export class Throttle {
  private entries = new Map<string, Entry>();
  constructor(private now: () => number = Date.now) {}

  private live(key: string): Entry | undefined {
    const e = this.entries.get(key);
    if (e && this.now() - e.start >= WINDOW_MS) {
      this.entries.delete(key);
      return undefined;
    }
    return e;
  }

  allowed(key: string): boolean {
    const e = this.live(key);
    return !e || e.count < MAX_FAILURES;
  }

  recordFailure(key: string): void {
    const e = this.live(key);
    if (e) {
      e.count++;
      return;
    }
    if (this.entries.size >= MAX_KEYS) this.prune();
    this.entries.set(key, { count: 1, start: this.now() });
  }

  clear(key: string): void {
    this.entries.delete(key);
  }

  reset(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }

  private prune(): void {
    const t = this.now();
    for (const [k, e] of this.entries) if (t - e.start >= WINDOW_MS) this.entries.delete(k);
    // Still full: evict the oldest-inserted keys to leave room for one more.
    while (this.entries.size >= MAX_KEYS) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }
}

const KEY = Symbol.for('kitchen-design.login-throttle');
const holder = () => globalThis as typeof globalThis & { [KEY]?: Throttle };

/** Process-wide login throttle, shared by every route bundle. */
export function loginThrottle(): Throttle {
  const g = holder();
  return (g[KEY] ??= new Throttle());
}

/** Test hook: replace the process-wide throttle (or drop it with undefined). */
export function setLoginThrottle(t: Throttle | undefined): void {
  const g = holder();
  if (t) g[KEY] = t;
  else delete g[KEY];
}
