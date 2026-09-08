import { describe, it, expect, vi } from 'vitest';
import { enrichItem, extractMeta, isEnrichableLink } from '../src/enrich';
import type { FeedItem } from '../../shared/types';

function makeItem(overrides: Partial<FeedItem> = {}): FeedItem {
  return {
    id: 'abc',
    region: 'berlin',
    language: 'de',
    title: 'Ein Titel',
    summary: 'Eine Zusammenfassung.',
    link: 'https://www.example.com/artikel/eins.html',
    sourceName: 'Example Quelle',
    publishedAt: '2026-08-21T10:00:00.000Z',
    ...overrides,
  };
}

describe('extractMeta', () => {
  it('reads property= and name= metas in any attribute order', () => {
    // rbb writes og:* keys in name=, and some sites put content first.
    expect(extractMeta('<meta property="og:image" content="https://img/a.jpg"/>', 'og:image')).toBe('https://img/a.jpg');
    expect(extractMeta('<meta name="og:image" content="https://img/b.jpg"/>', 'og:image')).toBe('https://img/b.jpg');
    expect(extractMeta('<meta content="https://img/c.jpg" property="og:image">', 'og:image')).toBe('https://img/c.jpg');
  });

  it('returns the first non-empty match and decodes entities', () => {
    const html =
      '<meta property="og:image" content=""/><meta property="og:image" content="https://img/first.jpg?a=1&amp;b=2"/><meta property="og:image" content="https://img/second.jpg"/>';
    expect(extractMeta(html, 'og:image')).toBe('https://img/first.jpg?a=1&b=2');
  });

  it('returns undefined when the key is absent', () => {
    expect(extractMeta('<meta name="description" content="x">', 'og:image')).toBeUndefined();
  });
});

describe('isEnrichableLink', () => {
  it('accepts plain http(s) article links', () => {
    expect(isEnrichableLink('https://www.example.com/a.html')).toBe(true);
  });

  it('rejects fragment links, non-http schemes, and garbage', () => {
    // BR's Meldungen all share index.html and differ only by #nN — the page's
    // og data would be the station logo, not the item's image.
    expect(isEnrichableLink('https://www.br.de/nachrichten/meldungen/index.html#n1')).toBe(false);
    expect(isEnrichableLink('ftp://example.com/a')).toBe(false);
    expect(isEnrichableLink('not a url')).toBe(false);
    expect(isEnrichableLink('')).toBe(false);
  });
});

describe('enrichItem', () => {
  const PAGE = `<!doctype html><html><head>
    <meta name="author" content="H. Schwesinger"/>
    <meta name="og:image" content="https://img.example.com/pic.jpg"/>
    <meta property="og:description" content="Beschreibung von der Artikelseite."/>
  </head><body></body></html>`;

  it('fills a missing image, empty teaser, and author from the article page', async () => {
    const fetchPage = vi.fn(async () => PAGE);
    const enriched = await enrichItem(makeItem({ summary: '' }), fetchPage);
    expect(fetchPage).toHaveBeenCalledWith('https://www.example.com/artikel/eins.html');
    expect(enriched.imageUrl).toBe('https://img.example.com/pic.jpg');
    expect(enriched.summary).toBe('Beschreibung von der Artikelseite.');
    expect(enriched.author).toBe('H. Schwesinger');
  });

  it('does not fetch at all when the item already has image and teaser', async () => {
    const fetchPage = vi.fn(async () => PAGE);
    const item = makeItem({ imageUrl: 'https://img.example.com/feed.jpg' });
    const enriched = await enrichItem(item, fetchPage);
    expect(fetchPage).not.toHaveBeenCalled();
    expect(enriched).toBe(item);
  });

  it('does not fetch fragment links that share one page', async () => {
    const fetchPage = vi.fn(async () => PAGE);
    const item = makeItem({ link: 'https://www.br.de/nachrichten/meldungen/index.html#n3' });
    await enrichItem(item, fetchPage);
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it('returns the item unchanged when the page fetch fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const item = makeItem({ summary: '' });
    const enriched = await enrichItem(item, async () => {
      throw new Error('boom');
    });
    expect(enriched).toBe(item);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it('discards a page author that just names the broadcaster', async () => {
    const page = '<meta name="author" content="rbb24.de"/><meta property="og:image" content="https://img/x.jpg">';
    const enriched = await enrichItem(
      makeItem({ sourceName: 'rbb24 - Nachrichten', link: 'https://www.rbb24.de/a.html' }),
      async () => page
    );
    expect(enriched.author).toBeUndefined();
    expect(enriched.imageUrl).toBe('https://img/x.jpg');
  });

  it('ignores a non-http og:image value', async () => {
    const page = '<meta property="og:image" content="data:image/png;base64,AAAA">';
    const enriched = await enrichItem(makeItem(), async () => page);
    expect(enriched.imageUrl).toBeUndefined();
  });

  it('keeps an existing feed author instead of the page meta', async () => {
    const enriched = await enrichItem(makeItem({ author: 'Feed Byline', imageUrl: undefined }), async () => PAGE);
    expect(enriched.author).toBe('Feed Byline');
  });
});
