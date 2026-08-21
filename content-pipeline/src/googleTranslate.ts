import { backoffDelayMs, sleep } from './retryBackoff';
import type { TranslateOptions } from './translate';

/** Cap on a single Google Translate request, so a hung call can't stall the run. */
const REQUEST_TIMEOUT_MS = 15_000;

interface GoogleTranslateResponse {
  data?: { translations?: Array<{ translatedText?: string }> };
}

/**
 * Translates via the Google Cloud Translation API (Basic/v2, API-key auth).
 * Returns `null` immediately (no request made) when no `googleApiKey` is
 * configured, so this is safe to call unconditionally as a fallback.
 */
export async function translateTextGoogle(
  text: string,
  sourceLang: string,
  targetLang: string,
  options: TranslateOptions = {}
): Promise<string | null> {
  if (!text.trim()) return text;
  const { googleApiKey, fetchFn = fetch, maxRetries = 2, delayFn = sleep } = options;
  if (!googleApiKey) return null;

  const url = `https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(googleApiKey)}`;
  const body = JSON.stringify({ q: text, source: sourceLang, target: targetLang, format: 'text' });

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetchFn(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as GoogleTranslateResponse;
      const translated = data.data?.translations?.[0]?.translatedText;
      if (typeof translated !== 'string' || !translated) {
        throw new Error('Google Translate: missing translatedText in response');
      }
      return translated;
    } catch (err) {
      if (attempt === maxRetries) {
        console.error(`[translateTextGoogle] giving up on ${sourceLang}->${targetLang}: ${(err as Error).message}`);
        return null;
      }
      await delayFn(backoffDelayMs(attempt));
    }
  }
  return null;
}
