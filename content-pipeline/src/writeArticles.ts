import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { regex } from 'shorol';
import type { Article, FeedItem, Manifest } from '../../shared/types';
import type { LanguageCode } from '../../shared/languages';

// Combining diacritical marks (U+0300–U+036F) that NFKD splits off their base
// letter, e.g. "ü" → "u" + U+0308. Spelled as \u escapes because the raw marks
// are invisible in an editor.
const COMBINING_MARKS = regex().range('\u0300', '\u036f').global().toRegExp();

const SLUG_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const NON_SLUG_RUN = regex().noneOf(SLUG_ALPHABET).oneOrMore().global().toRegExp();

const EDGE_DASHES = regex()
  .oneOf(
    (b) => b.start().literal('-').oneOrMore(),
    (b) => b.literal('-').oneOrMore().end()
  )
  .global()
  .toRegExp();

export function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(COMBINING_MARKS, '')
    .replace(NON_SLUG_RUN, '-')
    .replace(EDGE_DASHES, '')
    .slice(0, 80);
  return slug || 'article';
}

export async function writeArticle(
  item: FeedItem,
  translations: Article['translations'],
  originalLanguage: LanguageCode,
  contentDir: string,
  dateStr: string,
  existingSlugs: Set<string> = new Set()
): Promise<Article> {
  const base = slugify(item.title);
  let slug = base;
  let suffix = 2;
  while (existingSlugs.has(slug)) {
    slug = `${base}-${suffix}`;
    suffix += 1;
  }
  existingSlugs.add(slug);

  const article: Article = {
    id: item.id,
    slug,
    category: item.region,
    sourceName: item.sourceName,
    sourceUrl: item.link,
    publishedAt: item.publishedAt,
    originalLanguage,
    translations,
  };

  const dir = path.join(contentDir, 'articles', dateStr);
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, `${slug}.json`), `${JSON.stringify(article, null, 2)}\n`, 'utf-8');

  return article;
}

export async function writeManifest(manifest: Manifest, contentDir: string): Promise<void> {
  await mkdir(contentDir, { recursive: true });
  await writeFile(path.join(contentDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf-8');
}
