import { describe, it, expect } from 'vitest';
import { fetchFeed, fetchAllFeeds } from '../src/fetchFeeds';

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
