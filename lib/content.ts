import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import type { Article, LanguageCode, Region } from '../shared/types';

const DEFAULT_ARTICLES_DIR = path.join(process.cwd(), 'content', 'articles');

export interface DisplayFields {
  title: string;
  summary: string;
  isFallback: boolean;
}

export async function getAllArticles(articlesDir: string = DEFAULT_ARTICLES_DIR): Promise<Article[]> {
  let dateDirs: string[];
  try {
    dateDirs = await readdir(articlesDir);
  } catch {
    return [];
  }

  const articles: Article[] = [];
  for (const dateDir of dateDirs) {
    const fullDateDir = path.join(articlesDir, dateDir);
    let files: string[];
    try {
      files = await readdir(fullDateDir);
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.endsWith('.json')) continue;
      try {
        const raw = await readFile(path.join(fullDateDir, file), 'utf-8');
        articles.push(JSON.parse(raw) as Article);
      } catch {
        continue;
      }
    }
  }
  return articles;
}

function sortByRecency(articles: Article[]): Article[] {
  return [...articles].sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
}

/** An article only counts as available in `lang` if it has a real translation for it. */
function hasTranslation(article: Article, lang: LanguageCode): boolean {
  return Boolean(article.translations[lang]);
}

export async function getArticlesByRegion(
  region: Region,
  lang: LanguageCode,
  limit = 100,
  articlesDir: string = DEFAULT_ARTICLES_DIR
): Promise<Article[]> {
  const all = await getAllArticles(articlesDir);
  const filtered = all.filter((a) => a.category === region && hasTranslation(a, lang));
  return sortByRecency(filtered).slice(0, limit);
}

export async function getRecentAcrossRegions(
  regions: Region[],
  lang: LanguageCode,
  limit: number,
  articlesDir: string = DEFAULT_ARTICLES_DIR
): Promise<Article[]> {
  const all = await getAllArticles(articlesDir);
  const regionSet = new Set(regions);
  const filtered = all.filter((a) => regionSet.has(a.category) && hasTranslation(a, lang));
  return sortByRecency(filtered).slice(0, limit);
}

export async function getArticleBySlug(
  region: Region,
  slug: string,
  articlesDir: string = DEFAULT_ARTICLES_DIR
): Promise<Article | null> {
  const all = await getAllArticles(articlesDir);
  return all.find((a) => a.category === region && a.slug === slug) ?? null;
}

export function getDisplayFields(article: Article, lang: LanguageCode): DisplayFields {
  const translated = article.translations[lang];
  if (translated) {
    return { title: translated.title, summary: translated.summary, isFallback: false };
  }
  const original = article.translations[article.originalLanguage];
  if (original) {
    return { title: original.title, summary: original.summary, isFallback: true };
  }
  return { title: article.slug, summary: '', isFallback: true };
}
