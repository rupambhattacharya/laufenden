import { USER_AGENT } from './fetchFeeds';
import { cleanArtifacts, decodeEntities, deriveTeaser, isRedundantAuthor } from './text';
import type { FeedItem } from '../../shared/types';

export type FetchPageFn = (url: string) => Promise<string>;

/** Same rationale as the feed fetch cap: one hung host must not stall the run. */
const REQUEST_TIMEOUT_MS = 15_000;

export const fetchArticlePage: FetchPageFn = async (url) => {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: { 'User-Agent': USER_AGENT },
  });
  if (!res.ok) throw new Error(`Page request failed: ${res.status} ${url}`);
  return res.text();
};

const META_TAG = /<meta\s[^>]*>/gi;
// rbb writes its og:* keys in `name=` rather than `property=`, and attribute
// order varies per site, so key and content are matched independently.
const META_KEY = /(?:property|name)\s*=\s*["']([^"']+)["']/i;
const META_CONTENT = /content\s*=\s*["']([^"']*)["']/i;

export function extractMeta(html: string, key: string): string | undefined {
  for (const tag of html.match(META_TAG) ?? []) {
    const tagKey = META_KEY.exec(tag)?.[1];
    if (tagKey?.toLowerCase() !== key) continue;
    const content = META_CONTENT.exec(tag)?.[1];
    const value = content ? decodeEntities(content).trim() : '';
    if (value) return value;
  }
  return undefined;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * Items that share one page and differ only by #fragment (BR's Meldungen all
 * link to index.html#nN) would get page-level og data — a station logo instead
 * of this item's image — so they are not worth fetching at all.
 */
export function isEnrichableLink(link: string): boolean {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false;
  return !url.hash;
}

/**
 * Fill gaps a feed left open (image, empty teaser, author) from the article
 * page's Open Graph / meta tags. Fetches only when something is missing, and
 * only for the handful of items that survived selection, so this adds at most
 * one page request per published article. Never throws: an unreachable page
 * just means the item stays as the feed delivered it.
 */
export async function enrichItem(item: FeedItem, fetchPage: FetchPageFn = fetchArticlePage): Promise<FeedItem> {
  const needsImage = !item.imageUrl;
  const needsSummary = !item.summary;
  if ((!needsImage && !needsSummary) || !isEnrichableLink(item.link)) return item;

  let html: string;
  try {
    html = await fetchPage(item.link);
  } catch (err) {
    console.error(`[enrichItem] failed to fetch ${item.link}: ${(err as Error).message}`);
    return item;
  }

  const enriched = { ...item };
  if (needsImage) {
    const imageUrl = extractMeta(html, 'og:image') ?? extractMeta(html, 'twitter:image');
    if (imageUrl && isHttpUrl(imageUrl)) enriched.imageUrl = imageUrl;
  }
  if (needsSummary) {
    const description = extractMeta(html, 'og:description') ?? extractMeta(html, 'description');
    if (description) enriched.summary = deriveTeaser(cleanArtifacts(description));
  }
  if (!enriched.author) {
    const author = extractMeta(html, 'author');
    if (author && !isRedundantAuthor(author, item.sourceName, item.link)) enriched.author = author;
  }
  return enriched;
}
