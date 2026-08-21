import Parser from 'rss-parser';
import { computeId } from './id';
import type { FeedConfig, FeedItem } from '../../shared/types';

export type FetchFn = (url: string) => Promise<string>;

/** Cap on a single feed request. fetchAllFeeds runs every feed through
 *  Promise.all, so without this one hung host stalls the entire run. */
const REQUEST_TIMEOUT_MS = 15_000;

/** Some broadcaster feeds reject requests with a default/absent User-Agent. */
const USER_AGENT = 'laufenden-news-bot/1.0 (+https://github.com/rupambhattacharya/laufenden)';

const defaultFetch: FetchFn = async (url) => {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: { 'User-Agent': USER_AGENT },
  });
  if (!res.ok) throw new Error(`Feed request failed: ${res.status} ${url}`);
  return res.text();
};

/** Feed `content` is frequently raw HTML; keep markup out of the JSON a
 *  frontend will render. Not a full sanitizer — just tag removal. */
export function stripHtml(value: string): string {
  return value
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function fetchFeed(config: FeedConfig, fetchFn: FetchFn = defaultFetch): Promise<FeedItem[]> {
  let xml: string;
  try {
    xml = await fetchFn(config.url);
  } catch (err) {
    console.error(`[fetchFeed] failed to fetch ${config.url}: ${(err as Error).message}`);
    return [];
  }

  const parser = new Parser();
  let feed;
  try {
    feed = await parser.parseString(xml);
  } catch (err) {
    console.error(`[fetchFeed] failed to parse ${config.url}: ${(err as Error).message}`);
    return [];
  }

  const sourceName = feed.title ?? config.url;
  return (feed.items ?? []).map((item) => {
    const raw = item as Record<string, unknown>;
    const link = item.link ?? '';
    const guid = (raw.guid as string | undefined) ?? (raw.id as string | undefined) ?? link;
    const identity = guid || link || item.title || '';
    return {
      id: computeId(identity),
      region: config.region,
      language: config.language,
      title: item.title ?? '(untitled)',
      summary: stripHtml(item.contentSnippet ?? item.content ?? ''),
      link,
      sourceName,
      publishedAt: item.isoDate ?? new Date().toISOString(),
    };
  });
}

export async function fetchAllFeeds(configs: FeedConfig[], fetchFn: FetchFn = defaultFetch): Promise<FeedItem[]> {
  const results = await Promise.all(configs.map((config) => fetchFeed(config, fetchFn)));
  return results.flat();
}
