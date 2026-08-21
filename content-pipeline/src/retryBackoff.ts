const BASE_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 4000;

/** Exponential backoff with jitter, so retries don't hammer a struggling API. */
export function backoffDelayMs(attempt: number): number {
  return Math.min(BASE_BACKOFF_MS * 2 ** attempt, MAX_BACKOFF_MS) + Math.random() * 250;
}

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
