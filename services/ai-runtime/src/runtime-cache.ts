export interface DisposableRuntime {
  dispose(): Promise<void>;
}

/** Small LRU cache with concurrent-load deduplication; intended for one warm Vercel instance. */
export class RuntimeCache<T extends DisposableRuntime> {
  private readonly entries = new Map<string, { runtime: T; lastUsed: number }>();
  private readonly loads = new Map<string, Promise<{ runtime: T; cacheHit: boolean }>>();

  constructor(
    private readonly maximumEntries: number,
    private readonly clock: () => number = Date.now
  ) {
    if (!Number.isSafeInteger(maximumEntries) || maximumEntries < 1 || maximumEntries > 4) {
      throw new Error("Runtime cache size must be between 1 and 4.");
    }
  }

  async acquire(key: string, loader: () => Promise<T>): Promise<{ runtime: T; cacheHit: boolean }> {
    const existing = this.entries.get(key);
    if (existing !== undefined) {
      existing.lastUsed = this.clock();
      return { runtime: existing.runtime, cacheHit: true };
    }
    const loading = this.loads.get(key);
    if (loading !== undefined) return loading;
    const promise = (async () => {
      const runtime = await loader();
      await this.evictForInsert();
      this.entries.set(key, { runtime, lastUsed: this.clock() });
      return { runtime, cacheHit: false };
    })().finally(() => this.loads.delete(key));
    this.loads.set(key, promise);
    return promise;
  }

  async clear(): Promise<void> {
    const runtimes = [...this.entries.values()].map((entry) => entry.runtime);
    this.entries.clear();
    await Promise.allSettled(runtimes.map((runtime) => runtime.dispose()));
  }

  get size(): number {
    return this.entries.size;
  }

  private async evictForInsert(): Promise<void> {
    if (this.entries.size < this.maximumEntries) return;
    const oldest = [...this.entries.entries()].sort(
      ([leftKey, left], [rightKey, right]) =>
        left.lastUsed - right.lastUsed || leftKey.localeCompare(rightKey)
    )[0];
    if (oldest === undefined) return;
    this.entries.delete(oldest[0]);
    await oldest[1].runtime.dispose();
  }
}
