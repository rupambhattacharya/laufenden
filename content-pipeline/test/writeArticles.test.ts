import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { writeArticle, writeManifest, slugify } from '../src/writeArticles';
import type { FeedItem } from '../../shared/types';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'laufenden-test-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const sampleItem: FeedItem = {
  id: 'abc123',
  region: 'bayern',
  language: 'de',
  title: 'München plant neue Radwege',
  summary: 'Die Stadt München kündigt neue Radwege an.',
  link: 'https://example.com/muenchen-radwege',
  sourceName: 'BR24',
  publishedAt: '2026-08-21T09:00:00+02:00',
};

describe('slugify', () => {
  it('converts titles to kebab-case ascii slugs', () => {
    expect(slugify('München plant neue Radwege')).toBe('munchen-plant-neue-radwege');
  });

  it('falls back to "article" for titles with no ascii-safe characters', () => {
    expect(slugify('日本語')).toBe('article');
  });
});

describe('writeArticle', () => {
  it('writes a JSON file matching the article schema', async () => {
    const article = await writeArticle(
      sampleItem,
      { de: { title: 'München plant neue Radwege', summary: 'Die Stadt München kündigt neue Radwege an.' } },
      'de',
      dir,
      '2026-08-21'
    );
    const raw = await readFile(path.join(dir, 'articles', '2026-08-21', `${article.slug}.json`), 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed.id).toBe('abc123');
    expect(parsed.category).toBe('bayern');
    expect(parsed.sourceUrl).toBe('https://example.com/muenchen-radwege');
    expect(parsed.translations.de.title).toBe('München plant neue Radwege');
  });

  it('appends a numeric suffix when the slug already exists', async () => {
    const existingSlugs = new Set<string>();
    const first = await writeArticle(sampleItem, {}, 'de', dir, '2026-08-21', existingSlugs);
    const second = await writeArticle(sampleItem, {}, 'de', dir, '2026-08-21', existingSlugs);
    expect(first.slug).not.toBe(second.slug);
    expect(second.slug).toBe(`${first.slug}-2`);
  });
});

describe('writeManifest', () => {
  it('writes the manifest as formatted JSON', async () => {
    await writeManifest({ publishedIds: ['abc123'], dailyCounter: { date: '2026-08-21', count: 1 } }, dir);
    const raw = await readFile(path.join(dir, 'manifest.json'), 'utf-8');
    expect(JSON.parse(raw)).toEqual({ publishedIds: ['abc123'], dailyCounter: { date: '2026-08-21', count: 1 } });
  });
});
