import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  getAllArticles,
  getArticlesByRegion,
  getRecentAcrossRegions,
  getArticleBySlug,
  getDisplayFields,
} from './content';
import type { Article } from '../shared/types';

let dir: string;

function makeArticle(overrides: Partial<Article> = {}): Article {
  return {
    id: `id-${Math.random()}`,
    slug: 'sample-slug',
    category: 'global',
    sourceName: 'Test Source',
    sourceUrl: 'https://example.com',
    publishedAt: '2026-08-21T10:00:00Z',
    originalLanguage: 'en',
    translations: { en: { title: 'Sample Title', summary: 'Sample summary.' } },
    ...overrides,
  };
}

async function writeArticleFixture(articlesDir: string, dateDir: string, article: Article) {
  const target = path.join(articlesDir, dateDir);
  await mkdir(target, { recursive: true });
  await writeFile(path.join(target, `${article.slug}.json`), JSON.stringify(article), 'utf-8');
}

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'laufenden-content-lib-test-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('getArticlesByRegion', () => {
  it('returns only articles for the given region, most recent first', async () => {
    await writeArticleFixture(dir, '2026-08-21', makeArticle({ slug: 'a', category: 'global', publishedAt: '2026-08-21T08:00:00Z' }));
    await writeArticleFixture(dir, '2026-08-21', makeArticle({ slug: 'b', category: 'global', publishedAt: '2026-08-21T10:00:00Z' }));
    await writeArticleFixture(dir, '2026-08-21', makeArticle({ slug: 'c', category: 'bayern', publishedAt: '2026-08-21T09:00:00Z' }));

    const result = await getArticlesByRegion('global', 'en', 100, dir);
    expect(result.map((a) => a.slug)).toEqual(['b', 'a']);
  });

  it('respects the limit', async () => {
    await writeArticleFixture(dir, '2026-08-21', makeArticle({ slug: 'a', publishedAt: '2026-08-21T08:00:00Z' }));
    await writeArticleFixture(dir, '2026-08-21', makeArticle({ slug: 'b', publishedAt: '2026-08-21T09:00:00Z' }));

    const result = await getArticlesByRegion('global', 'en', 1, dir);
    expect(result).toHaveLength(1);
  });

  it('excludes articles that have no translation for the requested language', async () => {
    await writeArticleFixture(
      dir,
      '2026-08-21',
      makeArticle({
        slug: 'de-only',
        originalLanguage: 'de',
        translations: { de: { title: 'Nur Deutsch', summary: 'Nur Deutsch.' } },
        publishedAt: '2026-08-21T09:00:00Z',
      })
    );
    await writeArticleFixture(
      dir,
      '2026-08-21',
      makeArticle({ slug: 'has-en', publishedAt: '2026-08-21T08:00:00Z' })
    );

    const result = await getArticlesByRegion('global', 'en', 100, dir);
    expect(result.map((a) => a.slug)).toEqual(['has-en']);
  });

  it('returns an empty array when the articles directory does not exist', async () => {
    const result = await getArticlesByRegion('global', 'en', 100, path.join(dir, 'does-not-exist'));
    expect(result).toEqual([]);
  });
});

describe('getRecentAcrossRegions', () => {
  it('mixes articles from multiple regions, most recent first', async () => {
    await writeArticleFixture(dir, '2026-08-21', makeArticle({ slug: 'a', category: 'bayern', publishedAt: '2026-08-21T08:00:00Z' }));
    await writeArticleFixture(dir, '2026-08-21', makeArticle({ slug: 'b', category: 'nrw', publishedAt: '2026-08-21T10:00:00Z' }));
    await writeArticleFixture(dir, '2026-08-21', makeArticle({ slug: 'c', category: 'global', publishedAt: '2026-08-21T09:00:00Z' }));

    const result = await getRecentAcrossRegions(['bayern', 'nrw'], 'en', 10, dir);
    expect(result.map((a) => a.slug)).toEqual(['b', 'a']);
  });

  it('excludes articles that have no translation for the requested language', async () => {
    await writeArticleFixture(
      dir,
      '2026-08-21',
      makeArticle({
        slug: 'de-only',
        category: 'bayern',
        originalLanguage: 'de',
        translations: { de: { title: 'Nur Deutsch', summary: 'Nur Deutsch.' } },
      })
    );

    const result = await getRecentAcrossRegions(['bayern'], 'en', 10, dir);
    expect(result).toEqual([]);
  });
});

describe('getArticleBySlug', () => {
  it('finds an article by region and slug', async () => {
    await writeArticleFixture(dir, '2026-08-21', makeArticle({ slug: 'find-me', category: 'bayern' }));
    const result = await getArticleBySlug('bayern', 'find-me', dir);
    expect(result?.slug).toBe('find-me');
  });

  it('returns null when no article matches', async () => {
    const result = await getArticleBySlug('bayern', 'missing', dir);
    expect(result).toBeNull();
  });
});

describe('getAllArticles', () => {
  it('returns every article across all dates and regions', async () => {
    await writeArticleFixture(dir, '2026-08-20', makeArticle({ slug: 'yesterday', category: 'global' }));
    await writeArticleFixture(dir, '2026-08-21', makeArticle({ slug: 'today', category: 'bayern' }));
    const result = await getAllArticles(dir);
    expect(result.map((a) => a.slug).sort()).toEqual(['today', 'yesterday']);
  });
});

describe('getDisplayFields', () => {
  it('returns the translation for the requested language when available', () => {
    const article = makeArticle({
      originalLanguage: 'de',
      translations: {
        de: { title: 'Deutscher Titel', summary: 'Deutsche Zusammenfassung.' },
        en: { title: 'English Title', summary: 'English summary.' },
      },
    });
    expect(getDisplayFields(article, 'en')).toEqual({ title: 'English Title', summary: 'English summary.', isFallback: false });
  });

  it('falls back to the original language and flags it when the requested language is missing', () => {
    const article = makeArticle({
      originalLanguage: 'de',
      translations: { de: { title: 'Deutscher Titel', summary: 'Deutsche Zusammenfassung.' } },
    });
    expect(getDisplayFields(article, 'fr')).toEqual({ title: 'Deutscher Titel', summary: 'Deutsche Zusammenfassung.', isFallback: true });
  });
});
