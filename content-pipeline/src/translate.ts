import { regex } from 'shorol';
import { backoffDelayMs, sleep } from './retryBackoff';

export { backoffDelayMs };

export interface TranslateOptions {
  email?: string;
  fetchFn?: typeof fetch;
  maxRetries?: number;
  /** Injectable so tests don't have to actually wait out the backoff. */
  delayFn?: (ms: number) => Promise<void>;
}

interface MyMemoryResponse {
  responseData?: { translatedText?: string };
  responseStatus?: number | string;
  responseDetails?: string;
}

/** Cap on a single MyMemory request, so a hung call can't stall the run. */
const REQUEST_TIMEOUT_MS = 15_000;

/** MyMemory documents a ~500-byte limit on `q`; stay under it with headroom. */
const MAX_QUERY_BYTES = 450;

// `^(.*)\s\S*$` with dotAll, so `.` spans line breaks: group 1 greedily
// captures everything up to the last whitespace, dropping the trailing
// (possibly cut-mid-word) fragment. `raw` because the builder has no
// non-whitespace token.
const UP_TO_LAST_WHITESPACE = regex()
  .start()
  .group((b) => b.any().zeroOrMore())
  .whitespace()
  .raw('\\S')
  .zeroOrMore()
  .end()
  .dotAll()
  .toRegExp();

/**
 * Truncate `text` to at most `maxBytes` UTF-8 bytes, cutting at the last word
 * boundary at or before the limit rather than mid-word.
 */
export function truncateToByteLimit(text: string, maxBytes: number = MAX_QUERY_BYTES): string {
  const encoder = new TextEncoder();
  if (encoder.encode(text).length <= maxBytes) return text;

  // Walk code points (not UTF-16 units) so surrogate pairs are never split.
  let bytes = 0;
  let cut = '';
  for (const char of text) {
    const size = encoder.encode(char).length;
    if (bytes + size > maxBytes) break;
    bytes += size;
    cut += char;
  }

  const atWordBoundary = UP_TO_LAST_WHITESPACE.exec(cut);
  if (atWordBoundary && atWordBoundary[1].trim()) return atWordBoundary[1].trimEnd();
  return cut;
}

export async function translateText(
  text: string,
  sourceLang: string,
  targetLang: string,
  options: TranslateOptions = {}
): Promise<string | null> {
  if (!text.trim()) return text;
  const { email, fetchFn = fetch, maxRetries = 2, delayFn = sleep } = options;

  const query = truncateToByteLimit(text);
  const params = new URLSearchParams({ q: query, langpair: `${sourceLang}|${targetLang}` });
  if (email) params.set('de', email);
  const url = `https://api.mymemory.translated.net/get?${params.toString()}`;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetchFn(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as MyMemoryResponse;
      const status = Number(data.responseStatus);
      const translated = data.responseData?.translatedText;
      if (status !== 200 || typeof translated !== 'string' || !translated) {
        throw new Error(`MyMemory error (status=${data.responseStatus}): ${data.responseDetails ?? 'unknown'}`);
      }
      return translated;
    } catch (err) {
      if (attempt === maxRetries) {
        console.error(`[translateText] giving up on ${sourceLang}->${targetLang}: ${(err as Error).message}`);
        return null;
      }
      await delayFn(backoffDelayMs(attempt));
    }
  }
  return null;
}

export async function translateFields(
  fields: { title: string; summary: string },
  sourceLang: string,
  targetLangs: readonly string[],
  options: TranslateOptions = {}
): Promise<Partial<Record<string, { title: string; summary: string }>>> {
  const result: Partial<Record<string, { title: string; summary: string }>> = {};
  for (const lang of targetLangs) {
    if (lang === sourceLang) {
      result[lang] = fields;
      continue;
    }
    const [title, summary] = await Promise.all([
      translateText(fields.title, sourceLang, lang, options),
      translateText(fields.summary, sourceLang, lang, options),
    ]);
    if (title !== null && summary !== null) {
      result[lang] = { title, summary };
    }
  }
  return result;
}
