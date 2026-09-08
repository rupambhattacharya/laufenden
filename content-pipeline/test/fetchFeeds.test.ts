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

function rssWithItem(itemXml: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:media="http://search.yahoo.com/mrss/" xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>Test Wire</title>
    <item>
      <title>Sample Headline</title>
      <link>https://example.com/a</link>
      <guid>https://example.com/a</guid>
      ${itemXml}
    </item>
  </channel>
</rss>`;
}

async function parseSingle(itemXml: string, language: 'en' | 'de' = 'de') {
  const items = await fetchFeed(
    { region: 'bayern', language, url: 'https://example.com/rss.xml' },
    async () => rssWithItem(itemXml)
  );
  return items[0];
}

describe('media, body, and author extraction', () => {
  it('takes the image from an image enclosure but ignores audio enclosures', async () => {
    const withImage = await parseSingle(
      '<description>Text.</description><enclosure url="https://img.example.com/a.jpg" length="1" type="image/jpeg"/>'
    );
    expect(withImage.imageUrl).toBe('https://img.example.com/a.jpg');

    const withAudio = await parseSingle(
      '<description>Text.</description><enclosure url="https://cdn.example.com/a.mp3" length="1" type="audio/mpeg"/>'
    );
    expect(withAudio.imageUrl).toBeUndefined();
  });

  it('takes the image from a media:thumbnail (BBC shape)', async () => {
    const item = await parseSingle(
      '<description>Text.</description><media:thumbnail width="240" height="135" url="https://ichef.example.com/240/pic.jpg"/>',
      'en'
    );
    expect(item.imageUrl).toBe('https://ichef.example.com/240/pic.jpg');
  });

  it('takes the image from the first <img> inside content:encoded (tagesschau shape)', async () => {
    const item = await parseSingle(
      `<description>Die Meldung.</description>
       <content:encoded><![CDATA[<p> <a href="https://example.com/a"><img src="https://images.example.com/16x9.jpg?width=1920" alt="x" /></a> <br/> <br/>Die Meldung.[<a href="https://example.com/a">mehr</a>]</p>]]></content:encoded>`
    );
    expect(item.imageUrl).toBe('https://images.example.com/16x9.jpg?width=1920');
    // content:encoded merely repeats the description, so no body is stored.
    expect(item.body).toBeUndefined();
    expect(item.summary).toBe('Die Meldung.');
  });

  it('derives a sentence-capped teaser and keeps the full text as body for long descriptions (BR shape)', async () => {
    const sentences = Array.from({ length: 10 }, (_, i) => `Satz Nummer ${i + 1} enthaelt etwas laengeren Beispieltext fuer die Meldung.`);
    const item = await parseSingle(
      `<description>${sentences.join(' ')} ( BR24 Radio-Nachrichten 24.08.2026 18:15)</description>`
    );
    expect(item.summary.length).toBeLessThanOrEqual(320);
    expect(item.summary.endsWith('.')).toBe(true);
    expect(item.body).toBeDefined();
    expect(item.body).toContain('Satz Nummer 10');
    // The trailing BR source stamp is an artifact, not article text.
    expect(item.body).not.toContain('BR24 Radio-Nachrichten');
    expect(item.summary).not.toContain('BR24 Radio-Nachrichten');
  });

  it('falls back to the Atom <summary> so summary-only feeds keep their teasers (butenunbinnen shape)', async () => {
    const atom = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>buten un binnen</title>
  <entry>
    <title>Bremer Meldung</title>
    <link href="https://example.com/hb" />
    <id>https://example.com/hb</id>
    <updated>2026-08-21T09:00:00Z</updated>
    <summary>Die Polizei teilt Einzelheiten mit.</summary>
  </entry>
</feed>`;
    const items = await fetchFeed({ region: 'bremen', language: 'de', url: 'https://example.com/atom.xml' }, async () => atom);
    expect(items[0].summary).toBe('Die Polizei teilt Einzelheiten mit.');
  });

  it('keeps a dc:creator byline but drops one that just repeats the source', async () => {
    const withByline = await parseSingle('<description>Text.</description><dc:creator>Maria Muster</dc:creator>');
    expect(withByline.author).toBe('Maria Muster');

    const selfNamed = await parseSingle('<description>Text.</description><dc:creator>Test Wire</dc:creator>');
    expect(selfNamed.author).toBeUndefined();
  });

  it('extracts a tagesschau-style trailing byline from German descriptions only', async () => {
    const description = '<description>Die Lage bleibt offen. Von H. Schwesinger.</description>';
    const german = await parseSingle(description, 'de');
    expect(german.author).toBe('H. Schwesinger');

    const english = await parseSingle(description, 'en');
    expect(english.author).toBeUndefined();
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
