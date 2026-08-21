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
    expect(manifest.dailyCounter).toEqual({ date: '2026-08-21', count: 1 });
  });
});
