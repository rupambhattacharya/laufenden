import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fetchAllFeeds } from './fetchFeeds';
import { berlinDateString, selectArticles } from './selectArticles';
import { translateFields } from './translate';
import { writeArticle, writeManifest } from './writeArticles';
import { LANGUAGES } from '../../shared/languages';
import type { FeedConfig, Manifest } from '../../shared/types';

const CONTENT_DIR = path.join(process.cwd(), 'content');

async function loadJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(filePath, 'utf-8')) as T;
  } catch {
    return fallback;
  }
}

export interface PipelineDeps {
  contentDir?: string;
  now?: Date;
}

export async function runPipeline({ contentDir = CONTENT_DIR, now = new Date() }: PipelineDeps = {}): Promise<{
  published: number;
}> {
  const feeds = await loadJson<FeedConfig[]>(path.join(contentDir, 'feeds.json'), []);
  const manifest = await loadJson<Manifest>(path.join(contentDir, 'manifest.json'), {
    publishedIds: [],
    dailyCounter: { date: berlinDateString(now), count: 0 },
  });

  const items = await fetchAllFeeds(feeds);
  const { selected, manifest: updatedManifest } = selectArticles(items, manifest, now);

  const dateStr = berlinDateString(now);
  const existingSlugs = new Set<string>();
  const email = process.env.MYMEMORY_EMAIL;

  for (const item of selected) {
    const translations = await translateFields(
      { title: item.title, summary: item.summary },
      item.language,
      LANGUAGES,
      { email }
    );
    await writeArticle(item, translations, item.language, contentDir, dateStr, existingSlugs);
  }

  await writeManifest(updatedManifest, contentDir);
  return { published: selected.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runPipeline()
    .then(({ published }) => {
      console.log(`Published ${published} article(s).`);
    })
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    });
}
