/**
 * Text cleanup shared between feed parsing (fetchFeeds) and article-page
 * enrichment (enrich). Everything here is pure string-in/string-out.
 */

// rss-parser decodes XML entities in plain element text, but content:encoded
// CDATA payloads and <meta> attribute values arrive as raw HTML strings whose
// entities are still encoded. Only the handful that actually occur in the
// configured feeds is mapped; unknown entities pass through untouched.
const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, code: string) => {
    if (code.startsWith('#')) {
      const codePoint =
        code[1]?.toLowerCase() === 'x' ? Number.parseInt(code.slice(2), 16) : Number.parseInt(code.slice(1), 10);
      return Number.isFinite(codePoint) && codePoint > 0 && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : match;
    }
    return NAMED_ENTITIES[code.toLowerCase()] ?? match;
  });
}

/**
 * Convert an HTML fragment to plain text, keeping paragraph structure: <br>
 * and block-element closers become line breaks before tags are stripped, so a
 * multi-paragraph content:encoded payload doesn't collapse into one blob.
 */
export function htmlToText(html: string): string {
  const withBreaks = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:p|div|li|h[1-6]|blockquote|tr)>/gi, '\n\n')
    .replace(/<[^>]*>/g, '');
  return decodeEntities(withBreaks)
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .join('\n')
    .replace(/\n{2,}/g, '\n\n')
    .replace(/^\n+/, '')
    .replace(/\n+$/, '')
    .trim();
}

// tagesschau-family feeds close their content:encoded with a "[mehr]" link,
// and BR bulletins end with "( BR24 Radio-Nachrichten 24.08.2026 18:15)".
// Neither is article text. The stamp pattern requires a time/date-like token
// inside the parentheses so an ordinary trailing aside survives.
const TRAILING_MORE_LINK = /\s*\[\s*mehr\s*\]\s*$/i;
const TRAILING_SOURCE_STAMP = /\s*\(\s*[^()]*\d{1,2}[.:]\d{2}[^()]*\)\s*$/;

export function cleanArtifacts(text: string): string {
  return text.replace(TRAILING_MORE_LINK, '').replace(TRAILING_SOURCE_STAMP, '').trim();
}

export const SENTENCE_BREAK = /(?<=[.!?])\s+/;

export const TEASER_MAX_CHARS = 320;

/**
 * Cap a teaser at whole sentences within `maxChars`. Feeds like BR ship the
 * entire bulletin as the description; the full text belongs in `body`, not on
 * an article card. Keeping teasers short also keeps their translations under
 * MyMemory's ~500-byte query cap instead of letting the translator cut
 * mid-sentence.
 */
export function deriveTeaser(text: string, maxChars: number = TEASER_MAX_CHARS): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= maxChars) return flat;
  let teaser = '';
  for (const sentence of flat.split(SENTENCE_BREAK)) {
    const candidate = teaser ? `${teaser} ${sentence}` : sentence;
    if (candidate.length > maxChars) break;
    teaser = candidate;
  }
  if (teaser) return teaser;
  // A single over-long sentence: cut at the last word boundary that fits.
  const cut = flat.slice(0, maxChars);
  const atWord = cut.replace(/\s+\S*$/, '');
  return `${atWord || cut}…`;
}

// tagesschau signs analyses inside the description text ("… Von H.
// Schwesinger."), and no configured feed exposes a machine-readable byline —
// this tail pattern is the only author signal the pipeline gets. Every name
// token must start uppercase so sentences like "Von Montag an gilt …" or
// "von der Leyen" never read as bylines, and a trailing ", MDR"-style station
// suffix is tolerated but not captured.
const TRAILING_BYLINE = /[.!?"»]\s*Von (\p{Lu}[\p{L}'.-]*(?: \p{Lu}[\p{L}'.-]*){0,3})(?:,[^.]{0,40})?\.?\s*$/u;

export function extractByline(text: string): string | undefined {
  const name = TRAILING_BYLINE.exec(text)?.[1]?.trim();
  if (!name || name.length > 60) return undefined;
  // The sentence period sticks to the last name token; strip it unless that
  // token is an initial ("H."), whose dot belongs to the name.
  const lastToken = name.slice(name.lastIndexOf(' ') + 1);
  return /^\p{Lu}\.$/u.test(lastToken) ? name : name.replace(/\.$/, '');
}

const NON_ALNUM = /[^a-z0-9]+/g;

function normalizeName(value: string): string {
  return value.toLowerCase().replace(NON_ALNUM, '');
}

/**
 * Broadcasters commonly stamp themselves as the author ("rbb24.de", "WDR").
 * That would just duplicate the source line on every article, so only bylines
 * distinct from the source name/host are worth storing.
 */
export function isRedundantAuthor(author: string, sourceName: string, sourceUrl: string): boolean {
  const name = normalizeName(author);
  if (!name || author.length > 60) return true;
  let host = '';
  try {
    host = new URL(sourceUrl).hostname;
  } catch {
    // Not a valid URL — compare against the source name alone.
  }
  if (normalizeName(sourceName).includes(name) || normalizeName(host).includes(name)) return true;
  // Also the reverse: "hessenschau.de, Frankfurt, Germany" embeds the host
  // rather than being contained by it. Short hosts stay out of this check so
  // a real name can never be swallowed by a coincidental substring.
  const bareHost = normalizeName(host.replace(/^www\d*\./, ''));
  return bareHost.length >= 5 && name.includes(bareHost);
}
