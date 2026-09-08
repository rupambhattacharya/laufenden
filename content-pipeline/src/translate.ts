import { regex } from 'shorol';
import { backoffDelayMs, sleep } from './retryBackoff';
import { SENTENCE_BREAK } from './text';

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

/**
 * Split `text` into pieces that each fit MyMemory's query cap, preferring
 * sentence boundaries and falling back to word boundaries for a single
 * over-long sentence.
 */
export function splitIntoChunks(text: string, maxBytes: number = MAX_QUERY_BYTES): string[] {
  const encoder = new TextEncoder();
  const byteLength = (value: string) => encoder.encode(value).length;
  const chunks: string[] = [];
  let current = '';
  const flush = () => {
    if (current) {
      chunks.push(current);
      current = '';
    }
  };
  for (const rawSentence of text.split(SENTENCE_BREAK)) {
    let sentence = rawSentence;
    while (byteLength(sentence) > maxBytes) {
      flush();
      const head = truncateToByteLimit(sentence, maxBytes);
      if (!head) break;
      chunks.push(head);
      sentence = sentence.slice(head.length).trimStart();
    }
    if (!sentence) continue;
    const candidate = current ? `${current} ${sentence}` : sentence;
    if (byteLength(candidate) > maxBytes) {
      flush();
      current = sentence;
    } else {
      current = candidate;
    }
  }
  flush();
  return chunks;
}

/**
 * Cap on the source bytes of one body translation (per language). A body is
 * nice-to-have; letting one long bulletin burn the day's MyMemory quota would
 * starve the articles behind it. The cut lands on a sentence boundary because
 * chunks are built from whole sentences.
 */
export const MAX_BODY_TRANSLATION_BYTES = 2_250;

export async function translateLongText(
  text: string,
  sourceLang: string,
  targetLang: string,
  options: TranslateOptions = {}
): Promise<string | null> {
  const encoder = new TextEncoder();
  const translatedParagraphs: string[] = [];
  let budget = MAX_BODY_TRANSLATION_BYTES;
  for (const paragraph of text.split(/\n+/)) {
    if (!paragraph.trim() || budget <= 0) continue;
    const translatedChunks: string[] = [];
    for (const chunk of splitIntoChunks(paragraph)) {
      const size = encoder.encode(chunk).length;
      if (size > budget) {
        budget = 0;
        break;
      }
      const translated = await translateText(chunk, sourceLang, targetLang, options);
      // All or nothing: a body missing its middle reads like a bug.
      if (translated === null) return null;
      budget -= size;
      translatedChunks.push(translated);
    }
    if (translatedChunks.length > 0) translatedParagraphs.push(translatedChunks.join(' '));
  }
  return translatedParagraphs.join('\n\n') || null;
}

export interface TranslatableFields {
  title: string;
  summary: string;
  body?: string;
}

export async function translateFields(
  fields: TranslatableFields,
  sourceLang: string,
  targetLangs: readonly string[],
  options: TranslateOptions = {}
): Promise<Partial<Record<string, TranslatableFields>>> {
  const result: Partial<Record<string, TranslatableFields>> = {};
  for (const lang of targetLangs) {
    if (lang === sourceLang) {
      result[lang] = fields;
      continue;
    }
    const [title, summary] = await Promise.all([
      translateText(fields.title, sourceLang, lang, options),
      translateText(fields.summary, sourceLang, lang, options),
    ]);
    if (title === null || summary === null) continue;
    const entry: TranslatableFields = { title, summary };
    if (fields.body) {
      // A failed body downgrades this language to teaser-only instead of
      // dropping the whole translation.
      const body = await translateLongText(fields.body, sourceLang, lang, options);
      if (body !== null) entry.body = body;
    }
    result[lang] = entry;
  }
  return result;
}
