export interface RetryOptions {
  readonly maxAttempts?: number;
  readonly baseDelayMs?: number;
  readonly maxDelayMs?: number;
  readonly signal?: AbortSignal;
}

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_BASE_DELAY_MS = 200;
const DEFAULT_MAX_DELAY_MS = 10_000;

function jitteredDelay(baseMs: number, attempt: number, maxMs: number): number {
  const exponential = baseMs * 2 ** attempt;
  const capped = Math.min(exponential, maxMs);
  return capped * (0.5 + Math.random() * 0.5);
}

export async function retry<T>(
  fn: (attempt: number) => Promise<T>,
  opts?: RetryOptions,
): Promise<T> {
  const maxAttempts = opts?.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const baseDelayMs = opts?.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxDelayMs = opts?.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;

  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    opts?.signal?.throwIfAborted();

    try {
      return await fn(attempt);
    } catch (err) {
      lastError = err;
      if (attempt < maxAttempts - 1) {
        const delay = jitteredDelay(baseDelayMs, attempt, maxDelayMs);
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, delay);
          opts?.signal?.addEventListener(
            "abort",
            () => {
              clearTimeout(timer);
              reject(opts.signal!.reason);
            },
            { once: true },
          );
        });
      }
    }
  }

  throw lastError;
}
