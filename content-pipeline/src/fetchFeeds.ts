import Parser from 'rss-parser';
import { computeId } from './id';
import type { FeedConfig, FeedItem } from '../../shared/types';

export type FetchFn = (url: string) => Promise<string>;

const defaultFetch: FetchFn = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Feed request failed: ${res.status} ${url}`);
  return res.text();
};

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
      summary: item.contentSnippet ?? item.content ?? '',
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
