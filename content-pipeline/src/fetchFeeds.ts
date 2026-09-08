import Parser from 'rss-parser';
import { computeId } from './id';
import { cleanArtifacts, deriveTeaser, extractByline, htmlToText, isRedundantAuthor } from './text';
import type { FeedConfig, FeedItem } from '../../shared/types';

export type FetchFn = (url: string) => Promise<string>;

/** Cap on a single feed request. fetchAllFeeds runs every feed through
 *  Promise.all, so without this one hung host stalls the entire run. */
const REQUEST_TIMEOUT_MS = 15_000;

/** Some broadcaster feeds reject requests with a default/absent User-Agent. */
export const USER_AGENT = 'laufenden-news-bot/1.0 (+https://github.com/rupambhattacharya/laufenden)';

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

const IMAGE_URL = /\.(?:avif|gif|jpe?g|png|webp)(?:[?#]|$)/i;
const FIRST_IMG_SRC = /<img[^>]*\ssrc\s*=\s*["']([^"']+)["']/i;

/** How much longer than the teaser the full text must be to count as a body. */
const BODY_MIN_EXTRA_CHARS = 80;

interface MediaAttrs {
  $?: { url?: string; type?: string; medium?: string };
}

/**
 * Pull a URL out of a media:content / media:thumbnail custom field (kept as an
 * array). media:content can carry video or audio, so callers that read it must
 * demand evidence the entry is an image; media:thumbnail is an image by
 * definition.
 */
function mediaUrl(value: unknown, mustBeImage: boolean): string | undefined {
  for (const entry of Array.isArray(value) ? value : [value]) {
    const attrs = (entry as MediaAttrs | null | undefined)?.$;
    const url = attrs?.url;
    if (typeof url !== 'string' || !url) continue;
    if (!mustBeImage || attrs?.medium === 'image' || (attrs?.type ?? '').startsWith('image/') || IMAGE_URL.test(url)) {
      return url;
    }
  }
  return undefined;
}

function extractImageUrl(raw: Record<string, unknown>, encodedHtml: string): string | undefined {
  // SWR and hessenschau attach the article image as an enclosure; feeds also
  // use enclosures for audio, so the type has to say image.
  const enclosure = raw.enclosure as { url?: string; type?: string } | undefined;
  if (enclosure?.url && (enclosure.type ? enclosure.type.startsWith('image/') : IMAGE_URL.test(enclosure.url))) {
    return enclosure.url;
  }
  return (
    mediaUrl(raw.mediaContent, true) ?? // BBC-style media RSS
    mediaUrl(raw.mediaThumbnail, false) ??
    FIRST_IMG_SRC.exec(encodedHtml)?.[1] // tagesschau/NDR/MDR embed the image in content:encoded
  );
}

function extractAuthor(item: Parser.Item): string | undefined {
  const raw = item as Record<string, unknown>;
  for (const candidate of [item.creator, raw.author]) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  return undefined;
}

export async function fetchFeed(config: FeedConfig, fetchFn: FetchFn = defaultFetch): Promise<FeedItem[]> {
  let xml: string;
  try {
    xml = await fetchFn(config.url);
  } catch (err) {
    console.error(`[fetchFeed] failed to fetch ${config.url}: ${(err as Error).message}`);
    return [];
  }

  const parser = new Parser<Record<string, unknown>, Record<string, unknown>>({
    customFields: {
      item: [
        ['media:content', 'mediaContent', { keepArray: true }],
        ['media:thumbnail', 'mediaThumbnail', { keepArray: true }],
      ],
    },
  });
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

    // Atom feeds with a bare <summary> (butenunbinnen) populate neither
    // contentSnippet nor content, so item.summary has to be in the chain or
    // those teasers come out empty.
    const snippet = cleanArtifacts(stripHtml(item.contentSnippet ?? item.content ?? item.summary ?? ''));
    const encodedHtml = typeof raw['content:encoded'] === 'string' ? (raw['content:encoded'] as string) : '';
    // The longest text the feed offers. Only stored as a body when it
    // meaningfully extends the teaser: BR ships whole bulletins as the
    // description, while the tagesschau family's content:encoded merely
    // repeats the description around an image.
    const encodedText = cleanArtifacts(htmlToText(encodedHtml));
    const contentText = cleanArtifacts(htmlToText(item.content ?? ''));
    const fullText = encodedText.length >= contentText.length ? encodedText : contentText;

    const summary = deriveTeaser(snippet || fullText);
    const body = fullText.length > summary.length + BODY_MIN_EXTRA_CHARS ? fullText : undefined;

    const feedAuthor = extractAuthor(item) ?? (config.language === 'de' ? extractByline(snippet) : undefined);
    const author = feedAuthor && !isRedundantAuthor(feedAuthor, sourceName, link) ? feedAuthor : undefined;
    const imageUrl = extractImageUrl(raw, encodedHtml);

    return {
      id: computeId(identity),
      region: config.region,
      language: config.language,
      title: item.title ?? '(untitled)',
      summary,
      ...(body ? { body } : {}),
      ...(imageUrl ? { imageUrl } : {}),
      ...(author ? { author } : {}),
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
