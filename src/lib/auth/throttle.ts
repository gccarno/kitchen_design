export const MAX_FAILURES = 5;
export const WINDOW_MS = 15 * 60 * 1000;
export const MAX_KEYS = 10_000;

type Entry = { count: number; start: number };

/** In-memory failure limiter: MAX_FAILURES per key per WINDOW_MS (window starts at the first failure). */
export class Throttle {
  private entries = new Map<string, Entry>();
  constructor(
    private now: () => number = Date.now,
    private maxFailures: number = MAX_FAILURES
  ) {}

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
    return !e || e.count < this.maxFailures;
  }

  /**
   * Reserve one attempt for `key` BEFORE doing the work it guards, so concurrent attempts
   * cannot all pass a check-then-act race. Returns false (and consumes nothing) when the key
   * is at its limit. Call `clear(key)` on success; failures simply stay counted.
   * A new key is also refused when the map is full of keys that are all at their limit
   * (conservatively treated as limited rather than growing or evicting a victim's counter).
   */
  tryConsume(key: string): boolean {
    const e = this.live(key);
    if (e) {
      if (e.count >= this.maxFailures) return false;
      e.count++;
      return true;
    }
    if (this.entries.size >= MAX_KEYS && !this.makeRoom()) return false;
    this.entries.set(key, { count: 1, start: this.now() });
    return true;
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

  /** Drop expired keys, then the oldest keys still below their limit; never an at-limit key. */
  private makeRoom(): boolean {
    const t = this.now();
    for (const [k, e] of this.entries) if (t - e.start >= WINDOW_MS) this.entries.delete(k);
    for (const [k, e] of this.entries) {
      if (this.entries.size < MAX_KEYS) break;
      if (e.count < this.maxFailures) this.entries.delete(k);
    }
    return this.entries.size < MAX_KEYS;
  }
}

export const MAX_EMAIL_FAILURES = 20;

const KEY = Symbol.for('kitchen-design.login-throttle');
const EMAIL_KEY = Symbol.for('kitchen-design.login-email-throttle');
type G = typeof globalThis & { [KEY]?: Throttle; [EMAIL_KEY]?: Throttle };
const holder = () => globalThis as G;

/** Process-wide per-(ip|email) login throttle, shared by every route bundle. */
export function loginThrottle(): Throttle {
  const g = holder();
  return (g[KEY] ??= new Throttle());
}

/**
 * Process-wide per-email throttle (looser limit) so rotating IPs cannot bypass the limit.
 * Tradeoff: someone can lock a victim's email out of login by spamming failures; accepted
 * for a single-user app.
 */
export function emailThrottle(): Throttle {
  const g = holder();
  return (g[EMAIL_KEY] ??= new Throttle(Date.now, MAX_EMAIL_FAILURES));
}

/** Test hook: replace the process-wide throttle (or drop it with undefined). */
export function setLoginThrottle(t: Throttle | undefined): void {
  const g = holder();
  if (t) g[KEY] = t;
  else delete g[KEY];
}

/** Test hook: replace the process-wide email throttle (or drop it with undefined). */
export function setEmailThrottle(t: Throttle | undefined): void {
  const g = holder();
  if (t) g[EMAIL_KEY] = t;
  else delete g[EMAIL_KEY];
}
