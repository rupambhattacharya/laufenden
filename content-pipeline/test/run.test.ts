import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runPipeline } from '../src/run';

let dir: string;

const SAMPLE_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Test Wire</title>
    <item>
      <title>Global Headline</title>
      <link>https://example.com/global-1</link>
      <guid>https://example.com/global-1</guid>
      <description>A global story summary.</description>
      <pubDate>Fri, 21 Aug 2026 08:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>`;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'laufenden-pipeline-test-'));
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, 'feeds.json'),
    JSON.stringify([{ region: 'global', language: 'en', url: 'https://example.com/rss.xml' }])
  );

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.includes('mymemory')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ responseData: { translatedText: 'Übersetzt' }, responseStatus: 200 }),
        } as Response;
      }
      return { ok: true, status: 200, text: async () => SAMPLE_RSS } as Response;
    })
  );
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await rm(dir, { recursive: true, force: true });
});

describe('runPipeline', () => {
  it('fetches, translates, and writes an article to the content directory', async () => {
    const result = await runPipeline({ contentDir: dir, now: new Date('2026-08-21T10:00:00Z') });
    expect(result.published).toBe(1);

    const files = await readdir(path.join(dir, 'articles', '2026-08-21'));
    expect(files).toHaveLength(1);

    const article = JSON.parse(await readFile(path.join(dir, 'articles', '2026-08-21', files[0]), 'utf-8'));
    expect(article.category).toBe('global');
    expect(article.translations.en).toEqual({ title: 'Global Headline', summary: 'A global story summary.' });
    expect(article.translations.de).toEqual({ title: 'Übersetzt', summary: 'Übersetzt' });

    const manifest = JSON.parse(await readFile(path.join(dir, 'manifest.json'), 'utf-8'));
    expect(manifest.publishedIds).toHaveLength(1);
    // byTier round-trips through writeManifest so the next run of the day can
    // charge its tier quotas against what this run already published.
    expect(manifest.dailyCounter).toEqual({
      date: '2026-08-21',
      count: 1,
      byTier: { global: 1, germany: 0, states: 0 },
    });
  });

  it('suffixes a slug that collides with an article written by an earlier run today', async () => {
    // Simulate an earlier run today that already published a "global-headline".
    const dayDir = path.join(dir, 'articles', '2026-08-21');
    await mkdir(dayDir, { recursive: true });
    await writeFile(path.join(dayDir, 'global-headline.json'), JSON.stringify({ id: 'earlier', slug: 'global-headline' }));

    const result = await runPipeline({ contentDir: dir, now: new Date('2026-08-21T10:00:00Z') });
    expect(result.published).toBe(1);

    const files = (await readdir(dayDir)).sort();
    expect(files).toEqual(['global-headline-2.json', 'global-headline.json']);

    // The earlier run's article must survive untouched.
    const earlier = JSON.parse(await readFile(path.join(dayDir, 'global-headline.json'), 'utf-8'));
    expect(earlier.id).toBe('earlier');

    const fresh = JSON.parse(await readFile(path.join(dayDir, 'global-headline-2.json'), 'utf-8'));
    expect(fresh.slug).toBe('global-headline-2');
    expect(fresh.category).toBe('global');
  });

  it('skips feeds.json entries with an unknown region, loudly, and keeps the valid ones', async () => {
    await writeFile(
      path.join(dir, 'feeds.json'),
      JSON.stringify([
        { region: 'global', language: 'en', url: 'https://example.com/rss.xml' },
        { region: 'atlantis', language: 'de', url: 'https://example.com/bogus.xml' },
      ])
    );
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const result = await runPipeline({ contentDir: dir, now: new Date('2026-08-21T10:00:00Z') });

    expect(result.published).toBe(1);
    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const fetchedUrls = fetchMock.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(fetchedUrls).toContain('https://example.com/rss.xml');
    expect(fetchedUrls).not.toContain('https://example.com/bogus.xml');

    const logged = errorSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(logged).toContain('atlantis');
    expect(logged).toContain('https://example.com/bogus.xml');
    errorSpy.mockRestore();
  });

  it('skips feeds.json entries with an unknown language, loudly', async () => {
    await writeFile(
      path.join(dir, 'feeds.json'),
      JSON.stringify([
        { region: 'global', language: 'en', url: 'https://example.com/rss.xml' },
        { region: 'bayern', language: 'kl', url: 'https://example.com/klingon.xml' },
      ])
    );
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await runPipeline({ contentDir: dir, now: new Date('2026-08-21T10:00:00Z') });

    const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
    const fetchedUrls = fetchMock.mock.calls.map((c: unknown[]) => c[0] as string);
    expect(fetchedUrls).not.toContain('https://example.com/klingon.xml');
    expect(errorSpy.mock.calls.map((c) => c.join(' ')).join('\n')).toContain('unknown language "kl"');
    errorSpy.mockRestore();
  });

  it('logs a run summary covering fetch counts, per-region selection, and per-language translations', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});

    await runPipeline({ contentDir: dir, now: new Date('2026-08-21T10:00:00Z') });

    const logged = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(logged).toContain('fetched=1');
    expect(logged).toContain('selected=1');
    expect(logged).toContain('global=1');
    // en is the source language (copied through) and de was mock-translated.
    expect(logged).toContain('en 1/1');
    expect(logged).toContain('de 1/1');
    logSpy.mockRestore();
  });

  it('reports failed translations in the summary rather than silently dropping them', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('mymemory')) return { ok: false, status: 500, json: async () => ({}) } as Response;
        return { ok: true, status: 200, text: async () => SAMPLE_RSS } as Response;
      })
    );
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await runPipeline({
      contentDir: dir,
      now: new Date('2026-08-21T10:00:00Z'),
      delayFn: async () => {},
    });

    const logged = logSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(logged).toContain('en 1/1');
    expect(logged).toContain('de 0/1');
    logSpy.mockRestore();
    errorSpy.mockRestore();
  });
});
