import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { backfillArticleMedia } from './backfill-article-media';
import type { Article } from '../shared/types';

let dir: string;

function makeArticle(overrides: Partial<Article> = {}): Article {
  return {
    id: 'id-1',
    slug: 'sample-slug',
    category: 'berlin',
    sourceName: 'Beispiel Quelle',
    sourceUrl: 'https://www.example.com/artikel.html',
    publishedAt: '2026-08-21T10:00:00Z',
    originalLanguage: 'de',
    translations: {
      de: { title: 'Titel', summary: '' },
      en: { title: 'Title', summary: 'Teaser.' },
    },
    ...overrides,
  };
}

async function writeFixture(article: Article, dateDir = '2026-08-21'): Promise<string> {
  const target = path.join(dir, dateDir);
  await mkdir(target, { recursive: true });
  const file = path.join(target, `${article.slug}.json`);
  await writeFile(file, `${JSON.stringify(article, null, 2)}\n`, 'utf-8');
  return file;
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'laufenden-backfill-test-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const PAGE = `<html><head>
  <meta property="og:image" content="https://img.example.com/pic.jpg"/>
  <meta property="og:description" content="Nachgeladener Teaser."/>
</head><body></body></html>`;

describe('backfillArticleMedia', () => {
  it('adds the image and fills an empty original-language teaser, leaving other languages alone', async () => {
    const file = await writeFixture(makeArticle());
    const result = await backfillArticleMedia(dir, async () => PAGE);
    expect(result).toEqual({ scanned: 1, updated: 1 });

    const updated = JSON.parse(await readFile(file, 'utf-8')) as Article;
    expect(updated.imageUrl).toBe('https://img.example.com/pic.jpg');
    expect(updated.translations.de?.summary).toBe('Nachgeladener Teaser.');
    // Translated teasers are not backfilled — that would spend MyMemory quota.
    expect(updated.translations.en?.summary).toBe('Teaser.');
  });

  it('skips articles that already have an image, without fetching', async () => {
    await writeFixture(makeArticle({ imageUrl: 'https://img.example.com/existing.jpg' }));
    const fetchPage = vi.fn(async () => PAGE);
    const result = await backfillArticleMedia(dir, fetchPage);
    expect(result).toEqual({ scanned: 1, updated: 0 });
    expect(fetchPage).not.toHaveBeenCalled();
  });

  it('leaves the article untouched when the source page is gone', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const file = await writeFixture(makeArticle());
    const before = await readFile(file, 'utf-8');
    const result = await backfillArticleMedia(dir, async () => {
      throw new Error('HTTP 404');
    });
    expect(result.updated).toBe(0);
    expect(await readFile(file, 'utf-8')).toBe(before);
    errorSpy.mockRestore();
  });
});
