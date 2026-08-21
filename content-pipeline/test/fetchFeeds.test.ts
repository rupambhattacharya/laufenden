import { describe, it, expect } from 'vitest';
import { fetchFeed, fetchAllFeeds, stripHtml } from '../src/fetchFeeds';

const SAMPLE_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Test Wire</title>
    <item>
      <title>Sample Headline</title>
      <link>https://example.com/a</link>
      <guid>https://example.com/a</guid>
      <description>A short summary of the story.</description>
      <pubDate>Mon, 21 Aug 2026 08:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>`;

const SAMPLE_ATOM = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Test Atom Wire</title>
  <entry>
    <title>Atom Headline</title>
    <link href="https://example.com/b" />
    <id>https://example.com/b</id>
    <summary>An atom summary.</summary>
    <updated>2026-08-21T09:00:00Z</updated>
  </entry>
</feed>`;

describe('fetchFeed', () => {
  it('parses RSS items into normalized FeedItems', async () => {
    const items = await fetchFeed(
      { region: 'global', language: 'en', url: 'https://example.com/rss.xml' },
      async () => SAMPLE_RSS
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      region: 'global',
      language: 'en',
      title: 'Sample Headline',
      link: 'https://example.com/a',
      sourceName: 'Test Wire',
    });
    expect(items[0].summary).toContain('short summary');
    expect(items[0].id).toMatch(/^[a-f0-9]{40}$/);
  });

  it('parses Atom items into normalized FeedItems', async () => {
    const items = await fetchFeed(
      { region: 'germany', language: 'de', url: 'https://example.com/atom.xml' },
      async () => SAMPLE_ATOM
    );
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('Atom Headline');
    expect(items[0].link).toBe('https://example.com/b');
  });

  it('returns an empty list when the fetch fails, without throwing', async () => {
    const items = await fetchFeed(
      { region: 'bayern', language: 'de', url: 'https://example.com/broken.xml' },
      async () => {
        throw new Error('network error');
      }
    );
    expect(items).toEqual([]);
  });

  it('returns an empty list when the XML is malformed, without throwing', async () => {
    const items = await fetchFeed(
      { region: 'bayern', language: 'de', url: 'https://example.com/bad.xml' },
      async () => 'not xml at all'
    );
    expect(items).toEqual([]);
  });
});

describe('summary HTML stripping', () => {
  it('strips tags from raw HTML content, leaving readable text', () => {
    // rss-parser only ever populates `content` (the summary fallback) with raw,
    // unstripped markup, so exercise that shape directly.
    expect(stripHtml('<p>Hello <b>world</b></p>')).toBe('Hello world');
    expect(stripHtml('<img src="x.jpg" />Text after')).toBe('Text after');
    expect(stripHtml('  plain text  ')).toBe('plain text');
    expect(stripHtml('')).toBe('');
  });

  it('strips markup that survives into contentSnippet from a double-escaped feed', async () => {
    // Feeds that escape their HTML twice defeat rss-parser's own stripping: it
    // strips before decoding entities, so live tags land in contentSnippet.
    const doubleEscaped = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Test Wire</title>
    <item>
      <title>Escaped Headline</title>
      <link>https://example.com/c</link>
      <guid>https://example.com/c</guid>
      <description>&amp;lt;p&amp;gt;Double &amp;lt;b&amp;gt;escaped&amp;lt;/b&amp;gt; summary&amp;lt;/p&amp;gt;</description>
    </item>
  </channel>
</rss>`;
    const items = await fetchFeed(
      { region: 'global', language: 'en', url: 'https://example.com/escaped.xml' },
      async () => doubleEscaped
    );
    expect(items[0].summary).toBe('Double escaped summary');
    expect(items[0].summary).not.toMatch(/[<>]/);
  });
});

describe('fetchAllFeeds', () => {
  it('merges items from multiple feed configs', async () => {
    const items = await fetchAllFeeds(
      [
        { region: 'global', language: 'en', url: 'https://example.com/rss.xml' },
        { region: 'germany', language: 'de', url: 'https://example.com/atom.xml' },
      ],
      async (url) => (url.includes('rss') ? SAMPLE_RSS : SAMPLE_ATOM)
    );
    expect(items).toHaveLength(2);
  });
});
