/**
 * Models that were just rate-limited upstream, so the next request tries the
 * others first. In memory, per server process: enough for one instance, and
 * a restart simply forgets.
 */
export class ModelCooldown {
  private readonly coolUntil = new Map<string, number>();

  constructor(
    private readonly cooldownMs: number,
    private readonly now: () => number = Date.now
  ) {}

  mark(model: string): void {
    this.coolUntil.set(model, this.now() + this.cooldownMs);
  }

  isCool(model: string): boolean {
    const until = this.coolUntil.get(model);
    if (until === undefined) return false;
    if (until > this.now()) return true;
    this.coolUntil.delete(model);
    return false;
  }

  /** The models in their configured order, with cooling ones moved to the back (never dropped). */
  order(models: string[]): string[] {
    return [...models.filter((m) => !this.isCool(m)), ...models.filter((m) => this.isCool(m))];
  }
}
