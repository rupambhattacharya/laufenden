import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { fetchAllFeeds } from './fetchFeeds';
import { berlinDateString, selectArticles } from './selectArticles';
import { translateFields } from './translate';
import { writeArticle, writeManifest } from './writeArticles';
import { LANGUAGES } from '../../shared/languages';
import { REGION_PRIORITY } from '../../shared/regions';
import type { FeedConfig, Manifest } from '../../shared/types';

const CONTENT_DIR = path.join(process.cwd(), 'content');

const VALID_REGIONS = new Set<string>(REGION_PRIORITY);
const VALID_LANGUAGES = new Set<string>(LANGUAGES);

async function loadJson<T>(filePath: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(filePath, 'utf-8')) as T;
  } catch {
    return fallback;
  }
}

/**
 * Drop feed entries whose region/language isn't one we know about, loudly.
 * A typo'd config entry silently contributing nothing is worse than a bad
 * entry that announces itself, but one bad entry must not fail the whole run.
 */
function validateFeeds(feeds: FeedConfig[]): FeedConfig[] {
  return feeds.filter((feed) => {
    const problems: string[] = [];
    if (!VALID_REGIONS.has(feed?.region)) problems.push(`unknown region "${feed?.region}"`);
    if (!VALID_LANGUAGES.has(feed?.language)) problems.push(`unknown language "${feed?.language}"`);
    if (problems.length === 0) return true;
    console.error(
      `[runPipeline] skipping invalid feeds.json entry (${problems.join('; ')}) ` +
        `— region=${feed?.region}, language=${feed?.language}, url=${feed?.url}`
    );
    return false;
  });
}

/**
 * Seed the slug set from what's already on disk for today, so a second run on
 * the same day (a manual workflow_dispatch after the scheduled one) suffixes a
 * colliding slug instead of overwriting an article whose id is already in
 * publishedIds — which would lose that article permanently.
 */
async function readExistingSlugs(dir: string): Promise<Set<string>> {
  try {
    const files = await readdir(dir);
    return new Set(files.filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -'.json'.length)));
  } catch {
    // Directory doesn't exist yet — first run of the day.
    return new Set<string>();
  }
}

export interface PipelineDeps {
  contentDir?: string;
  now?: Date;
  /** Injectable retry backoff, so tests don't sit through real delays. */
  delayFn?: (ms: number) => Promise<void>;
}

export async function runPipeline({
  contentDir = CONTENT_DIR,
  now = new Date(),
  delayFn,
}: PipelineDeps = {}): Promise<{
  published: number;
}> {
  const configuredFeeds = await loadJson<FeedConfig[]>(path.join(contentDir, 'feeds.json'), []);
  const feeds = validateFeeds(configuredFeeds);
  const manifest = await loadJson<Manifest>(path.join(contentDir, 'manifest.json'), {
    publishedIds: [],
    dailyCounter: { date: berlinDateString(now), count: 0 },
  });

  const items = await fetchAllFeeds(feeds);
  const { selected, manifest: updatedManifest } = selectArticles(items, manifest, now);

  const dateStr = berlinDateString(now);
  const existingSlugs = await readExistingSlugs(path.join(contentDir, 'articles', dateStr));
  const email = process.env.MYMEMORY_EMAIL;

  const translationsOk: Record<string, number> = Object.fromEntries(LANGUAGES.map((lang) => [lang, 0]));

  for (const item of selected) {
    const translations = await translateFields(
      { title: item.title, summary: item.summary },
      item.language,
      LANGUAGES,
      { email, delayFn }
    );
    for (const lang of LANGUAGES) {
      if (translations[lang]) translationsOk[lang] += 1;
    }
    await writeArticle(item, translations, item.language, contentDir, dateStr, existingSlugs);
  }

  await writeManifest(updatedManifest, contentDir);

  logSummary({ items: items.length, feeds: feeds.length, selected, translationsOk });

  return { published: selected.length };
}

function logSummary({
  items,
  feeds,
  selected,
  translationsOk,
}: {
  items: number;
  feeds: number;
  selected: { region: string }[];
  translationsOk: Record<string, number>;
}): void {
  const byRegion = new Map<string, number>();
  for (const item of selected) byRegion.set(item.region, (byRegion.get(item.region) ?? 0) + 1);
  const regions =
    REGION_PRIORITY.filter((r) => byRegion.has(r))
      .map((r) => `${r}=${byRegion.get(r)}`)
      .join(', ') || 'none';
  const langs = LANGUAGES.map((lang) => {
    const ok = translationsOk[lang] ?? 0;
    return `${lang} ${ok}/${selected.length}`;
  }).join(', ');

  console.log(`[summary] feeds=${feeds} fetched=${items} selected=${selected.length}`);
  console.log(`[summary] by region: ${regions}`);
  console.log(`[summary] translations ok/selected: ${langs}`);
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
