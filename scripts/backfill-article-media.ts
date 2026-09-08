import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { enrichItem, isEnrichableLink } from '../content-pipeline/src/enrich';
import type { FetchPageFn } from '../content-pipeline/src/enrich';
import type { Article, FeedItem } from '../shared/types';

const DEFAULT_ARTICLES_DIR = path.join(process.cwd(), 'content', 'articles');

/** Modest parallelism: ~10 broadcaster hosts share the load, one-off run. */
const CONCURRENCY = 4;

/**
 * One-off backfill for articles published before the pipeline captured media
 * fields: re-visits each article's source page and fills imageUrl, author, and
 * an empty original-language teaser via the same og/meta extraction the
 * pipeline now uses. Translated teasers are NOT backfilled — that would spend
 * MyMemory quota on old articles — so a filled teaser only shows on the
 * article's original language until re-translated. Idempotent: articles that
 * already have an image are skipped, and pages that 404 (news links expire)
 * leave the article untouched.
 */
export async function backfillArticleMedia(
  articlesDir: string = DEFAULT_ARTICLES_DIR,
  fetchPage?: FetchPageFn
): Promise<{ scanned: number; updated: number }> {
  const files: string[] = [];
  for (const dateDir of await readdir(articlesDir)) {
    const fullDateDir = path.join(articlesDir, dateDir);
    let entries: string[];
    try {
      entries = await readdir(fullDateDir);
    } catch {
      continue;
    }
    for (const file of entries) {
      if (file.endsWith('.json')) files.push(path.join(fullDateDir, file));
    }
  }

  let updated = 0;
  let cursor = 0;
  const worker = async () => {
    while (cursor < files.length) {
      const file = files[cursor];
      cursor += 1;
      try {
        if (await backfillOne(file, fetchPage)) updated += 1;
      } catch (err) {
        console.error(`[backfill] ${file}: ${(err as Error).message}`);
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  return { scanned: files.length, updated };
}

async function backfillOne(file: string, fetchPage?: FetchPageFn): Promise<boolean> {
  const article = JSON.parse(await readFile(file, 'utf-8')) as Article;
  const original = article.translations[article.originalLanguage];
  if (article.imageUrl || !isEnrichableLink(article.sourceUrl)) return false;

  const item: FeedItem = {
    id: article.id,
    region: article.category,
    language: article.originalLanguage,
    title: original?.title ?? article.slug,
    summary: original?.summary ?? '',
    link: article.sourceUrl,
    sourceName: article.sourceName,
    publishedAt: article.publishedAt,
    ...(article.author ? { author: article.author } : {}),
  };
  const enriched = fetchPage ? await enrichItem(item, fetchPage) : await enrichItem(item);

  let changed = false;
  if (enriched.imageUrl) {
    article.imageUrl = enriched.imageUrl;
    changed = true;
  }
  if (enriched.author && enriched.author !== article.author) {
    article.author = enriched.author;
    changed = true;
  }
  if (original && !original.summary && enriched.summary) {
    original.summary = enriched.summary;
    changed = true;
  }
  if (!changed) return false;

  // Rebuild in writeArticle's key order so backfilled files diff cleanly
  // against ones the pipeline writes.
  const ordered: Article = {
    id: article.id,
    slug: article.slug,
    category: article.category,
    sourceName: article.sourceName,
    sourceUrl: article.sourceUrl,
    publishedAt: article.publishedAt,
    originalLanguage: article.originalLanguage,
    ...(article.imageUrl ? { imageUrl: article.imageUrl } : {}),
    ...(article.author ? { author: article.author } : {}),
    translations: article.translations,
  };
  await writeFile(file, `${JSON.stringify(ordered, null, 2)}\n`, 'utf-8');
  return true;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  backfillArticleMedia()
    .then(({ scanned, updated }) => {
      console.log(`Backfilled ${updated} of ${scanned} article(s).`);
    })
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    });
}
