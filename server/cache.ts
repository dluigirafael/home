export class Cache<T> {
  #value: T | null = null;
  #refreshedAt = 0;
  #failedAt = 0;
  #inflight: Promise<T> | null = null;

  constructor(
    private producer: () => Promise<T>,
    private ttlMs: number,
    private failTtlMs = 30_000,
  ) {}

  async get(): Promise<T> {
    const now = Date.now();
    if (this.#value !== null && now - this.#refreshedAt < this.ttlMs) {
      return this.#value;
    }
    if (this.#inflight) return this.#inflight;

    this.#inflight = (async () => {
      try {
        const next = await this.producer();
        this.#value = next;
        this.#refreshedAt = Date.now();
        this.#failedAt = 0;
        return next;
      } catch {
        this.#failedAt = Date.now();
        if (this.#value !== null) return this.#value;
        throw new Error("no value");
      } finally {
        this.#inflight = null;
      }
    })();

    return this.#inflight;
  }

  peek(): T | null {
    return this.#value;
  }
}

export async function withDeadline<T>(
  promise: Promise<T>,
  ms: number,
  fallback: T,
): Promise<T> {
  let timer: number | undefined;
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}