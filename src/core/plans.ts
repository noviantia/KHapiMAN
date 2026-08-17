interface PlanEntry<T> {
  value: T;
  expiresAt: number;
}

export interface ExpiringPlanStoreOptions {
  ttlMs?: number;
  maxEntries?: number;
  now?: () => number;
}

export class ExpiringPlanStore<T> {
  private readonly entries = new Map<string, PlanEntry<T>>();
  private readonly ttlMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor(options: ExpiringPlanStoreOptions = {}) {
    this.ttlMs = options.ttlMs ?? 5 * 60_000;
    this.maxEntries = options.maxEntries ?? 32;
    this.now = options.now ?? Date.now;
    if (this.ttlMs <= 0 || this.maxEntries <= 0) {
      throw new Error("Plan TTL and capacity must be positive.");
    }
  }

  set(id: string, value: T): void {
    const now = this.now();
    this.prune(now);
    this.entries.delete(id);
    while (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    this.entries.set(id, { value, expiresAt: now + this.ttlMs });
  }

  take(id: string): T | undefined {
    this.prune(this.now());
    const entry = this.entries.get(id);
    this.entries.delete(id);
    return entry?.value;
  }

  delete(id: string): boolean {
    return this.entries.delete(id);
  }

  get size(): number {
    this.prune(this.now());
    return this.entries.size;
  }

  private prune(now: number): void {
    for (const [id, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(id);
    }
  }
}
