# Content Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the automated pipeline that fetches German/global RSS news, selects up to 20 articles/day across Global → Germany-national → 16-Bundesländer priority tiers, translates each into 9 languages via MyMemory, and commits the result as JSON content files — the foundation the frontend (a later plan) will read from.

**Architecture:** A set of small, independently-testable TypeScript modules (fetch → select → translate → write) orchestrated by a single `run.ts` script, executed on a schedule by a GitHub Actions workflow which commits new `content/` JSON files directly to the repo. Vercel's git integration (set up separately) auto-deploys on that push.

**Tech Stack:** Node.js + TypeScript (run via `tsx`, no build step needed for the pipeline), `rss-parser` for feed parsing, native `fetch` for HTTP, Vitest for tests, GitHub Actions for scheduling.

**Spec:** `docs/superpowers/specs/2026-08-21-laufenden-news-platform-design.md`

## Global Constraints

- Article cap: **20 new articles/day total**, counted against a counter that resets at Europe/Berlin midnight.
- Selection priority: **Global → Germany-national → the 16 Bundesländer**, round-robin across states once global/national are exhausted, so one state's news never crowds out the others.
- Languages (9, exact set): `en`, `de`, `tr`, `uk`, `hi`, `bn`, `pl`, `es`, `fr`.
- Translation provider: **MyMemory API** free tier. A response can be HTTP 200 while still being an error (`responseStatus` in the JSON body is `"403"` or similar) — every caller must check `responseStatus === 200`, not just presence of `translatedText`.
- No full-text scraping — only the `title` and `summary` a feed itself provides.
- Storage paths (exact, per spec): `content/feeds.json`, `content/manifest.json`, `content/articles/YYYY-MM-DD/<slug>.json`.
- If translation fails for a language after retries, that article still publishes — the language key is simply omitted, never blocking the rest of the batch.
- A broken/unreachable RSS feed is skipped and logged; it never fails the whole pipeline run.
- Content is committed to git **by the GitHub Actions workflow itself** (not by a Vercel Cron function) — this is why GitHub Actions was chosen over Vercel Cron.

---

## File Structure

```
package.json
tsconfig.json
vitest.config.ts
.gitignore
README.md
shared/
  regions.ts          # Region type + REGION_PRIORITY (single source of truth)
  languages.ts         # LanguageCode type + LANGUAGES
  types.ts              # FeedConfig, FeedItem, Article, Manifest, etc.
content-pipeline/
  src/
    id.ts               # computeId() — sha1 hashing for dedup IDs
    fetchFeeds.ts        # fetchFeed(), fetchAllFeeds()
    selectArticles.ts    # selectArticles(), berlinDateString()
    translate.ts         # translateText(), translateFields()
    writeArticles.ts     # writeArticle(), writeManifest(), slugify()
    run.ts                # runPipeline() orchestrator + CLI entry point
  test/
    id.test.ts
    fetchFeeds.test.ts
    selectArticles.test.ts
    translate.test.ts
    writeArticles.test.ts
    run.test.ts
content/
  feeds.json            # 17 verified RSS feed configs
  manifest.json         # initial empty manifest
.github/
  workflows/
    fetch-news.yml
```

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Test: `content-pipeline/test/smoke.test.ts`

**Interfaces:**
- Produces: an `npm test` command (Vitest) and an `npm run fetch-news` command (added in Task 7) that every later task relies on.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "laufenden",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run"
  },
  "dependencies": {
    "rss-parser": "^3.13.0"
  },
  "devDependencies": {
    "@types/node": "^22.10.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "outDir": "dist"
  },
  "include": ["shared", "content-pipeline"]
}
```

- [ ] **Step 3: Create `vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['content-pipeline/test/**/*.test.ts'],
  },
});
```

- [ ] **Step 4: Create `.gitignore`**

```
node_modules/
dist/
.DS_Store
```

- [ ] **Step 5: Install dependencies**

Run: `npm install`
Expected: installs cleanly, creates `package-lock.json`.

- [ ] **Step 6: Write a smoke test**

```typescript
// content-pipeline/test/smoke.test.ts
import { describe, it, expect } from 'vitest';

describe('smoke', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 7: Run the test suite to verify the setup works**

Run: `npm test`
Expected: 1 test file, 1 test, PASS.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts .gitignore content-pipeline/test/smoke.test.ts
git commit -m "chore: scaffold project with vitest"
```

---

### Task 2: Shared types, language/region constants, and ID hashing

**Files:**
- Create: `shared/regions.ts`
- Create: `shared/languages.ts`
- Create: `shared/types.ts`
- Create: `content-pipeline/src/id.ts`
- Test: `content-pipeline/test/id.test.ts`

**Interfaces:**
- Produces: `Region` type, `REGION_PRIORITY` array, `LanguageCode` type, `LANGUAGES` array, `FeedConfig`, `FeedItem`, `Article`, `TranslatedFields`, `Manifest`, `DailyCounter` types (used by every subsequent task), and `computeId(value: string): string`.

- [ ] **Step 1: Write the failing test for `computeId`**

```typescript
// content-pipeline/test/id.test.ts
import { describe, it, expect } from 'vitest';
import { computeId } from '../src/id';

describe('computeId', () => {
  it('produces the same hash for the same input', () => {
    expect(computeId('https://example.com/a')).toBe(computeId('https://example.com/a'));
  });

  it('produces different hashes for different input', () => {
    expect(computeId('https://example.com/a')).not.toBe(computeId('https://example.com/b'));
  });

  it('produces a 40-character hex sha1 digest', () => {
    expect(computeId('anything')).toMatch(/^[a-f0-9]{40}$/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- id.test.ts`
Expected: FAIL — cannot find module `../src/id`.

- [ ] **Step 3: Create the shared constants and types**

```typescript
// shared/regions.ts
export const REGION_PRIORITY = [
  'global',
  'germany',
  'baden-wuerttemberg',
  'bayern',
  'berlin',
  'brandenburg',
  'bremen',
  'hamburg',
  'hessen',
  'mecklenburg-vorpommern',
  'niedersachsen',
  'nrw',
  'rheinland-pfalz',
  'saarland',
  'sachsen',
  'sachsen-anhalt',
  'schleswig-holstein',
  'thueringen',
] as const;

export type Region = (typeof REGION_PRIORITY)[number];
```

```typescript
// shared/languages.ts
export const LANGUAGES = ['en', 'de', 'tr', 'uk', 'hi', 'bn', 'pl', 'es', 'fr'] as const;

export type LanguageCode = (typeof LANGUAGES)[number];
```

```typescript
// shared/types.ts
import type { Region } from './regions';
import type { LanguageCode } from './languages';

export interface FeedConfig {
  region: Region;
  language: LanguageCode;
  url: string;
}

export interface FeedItem {
  id: string;
  region: Region;
  language: LanguageCode;
  title: string;
  summary: string;
  link: string;
  sourceName: string;
  publishedAt: string;
}

export interface TranslatedFields {
  title: string;
  summary: string;
}

export interface Article {
  id: string;
  slug: string;
  category: Region;
  sourceName: string;
  sourceUrl: string;
  publishedAt: string;
  originalLanguage: LanguageCode;
  translations: Partial<Record<LanguageCode, TranslatedFields>>;
}

export interface DailyCounter {
  date: string;
  count: number;
}

export interface Manifest {
  publishedIds: string[];
  dailyCounter: DailyCounter;
}
```

```typescript
// content-pipeline/src/id.ts
import { createHash } from 'node:crypto';

export function computeId(value: string): string {
  return createHash('sha1').update(value).digest('hex');
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- id.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add shared/regions.ts shared/languages.ts shared/types.ts content-pipeline/src/id.ts content-pipeline/test/id.test.ts
git commit -m "feat: add shared types, region/language constants, and id hashing"
```

---

### Task 3: RSS/Atom feed fetcher

**Files:**
- Create: `content-pipeline/src/fetchFeeds.ts`
- Test: `content-pipeline/test/fetchFeeds.test.ts`

**Interfaces:**
- Consumes: `FeedConfig`, `FeedItem` from `shared/types.ts`; `computeId` from `./id`.
- Produces: `fetchFeed(config: FeedConfig, fetchFn?: FetchFn): Promise<FeedItem[]>`, `fetchAllFeeds(configs: FeedConfig[], fetchFn?: FetchFn): Promise<FeedItem[]>`, and the exported type `FetchFn = (url: string) => Promise<string>`. Both functions never throw — a broken feed resolves to `[]`.

- [ ] **Step 1: Install the RSS parsing dependency (already listed in Task 1's package.json — just verify)**

Run: `npm ls rss-parser`
Expected: shows `rss-parser@3.x` installed. If missing, run `npm install rss-parser@^3.13.0`.

- [ ] **Step 2: Write the failing tests**

```typescript
// content-pipeline/test/fetchFeeds.test.ts
import { describe, it, expect } from 'vitest';
import { fetchFeed, fetchAllFeeds } from '../src/fetchFeeds';

const SAMPLE_RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Test Wire</title>
    <item>
      <title>Sample Headline</title>
      <link>https://example.com/a</link>
      <guid>https://example.com/a</guid>
      <description>A short summary of the story.</description>
      <pubDate>Mon, 21 Aug 2026 08:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>`;

const SAMPLE_ATOM = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Test Atom Wire</title>
  <entry>
    <title>Atom Headline</title>
    <link href="https://example.com/b" />
    <id>https://example.com/b</id>
    <summary>An atom summary.</summary>
    <updated>2026-08-21T09:00:00Z</updated>
  </entry>
</feed>`;

describe('fetchFeed', () => {
  it('parses RSS items into normalized FeedItems', async () => {
    const items = await fetchFeed(
      { region: 'global', language: 'en', url: 'https://example.com/rss.xml' },
      async () => SAMPLE_RSS
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      region: 'global',
      language: 'en',
      title: 'Sample Headline',
      link: 'https://example.com/a',
      sourceName: 'Test Wire',
    });
    expect(items[0].summary).toContain('short summary');
    expect(items[0].id).toMatch(/^[a-f0-9]{40}$/);
  });

  it('parses Atom items into normalized FeedItems', async () => {
    const items = await fetchFeed(
      { region: 'germany', language: 'de', url: 'https://example.com/atom.xml' },
      async () => SAMPLE_ATOM
    );
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('Atom Headline');
    expect(items[0].link).toBe('https://example.com/b');
  });

  it('returns an empty list when the fetch fails, without throwing', async () => {
    const items = await fetchFeed(
      { region: 'bayern', language: 'de', url: 'https://example.com/broken.xml' },
      async () => {
        throw new Error('network error');
      }
    );
    expect(items).toEqual([]);
  });

  it('returns an empty list when the XML is malformed, without throwing', async () => {
    const items = await fetchFeed(
      { region: 'bayern', language: 'de', url: 'https://example.com/bad.xml' },
      async () => 'not xml at all'
    );
    expect(items).toEqual([]);
  });
});

describe('fetchAllFeeds', () => {
  it('merges items from multiple feed configs', async () => {
    const items = await fetchAllFeeds(
      [
        { region: 'global', language: 'en', url: 'https://example.com/rss.xml' },
        { region: 'germany', language: 'de', url: 'https://example.com/atom.xml' },
      ],
      async (url) => (url.includes('rss') ? SAMPLE_RSS : SAMPLE_ATOM)
    );
    expect(items).toHaveLength(2);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test -- fetchFeeds.test.ts`
Expected: FAIL — cannot find module `../src/fetchFeeds`.

- [ ] **Step 4: Implement `fetchFeeds.ts`**

```typescript
// content-pipeline/src/fetchFeeds.ts
import Parser from 'rss-parser';
import { computeId } from './id';
import type { FeedConfig, FeedItem } from '../../shared/types';

export type FetchFn = (url: string) => Promise<string>;

const defaultFetch: FetchFn = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Feed request failed: ${res.status} ${url}`);
  return res.text();
};

export async function fetchFeed(config: FeedConfig, fetchFn: FetchFn = defaultFetch): Promise<FeedItem[]> {
  let xml: string;
  try {
    xml = await fetchFn(config.url);
  } catch (err) {
    console.error(`[fetchFeed] failed to fetch ${config.url}: ${(err as Error).message}`);
    return [];
  }

  const parser = new Parser();
  let feed;
  try {
    feed = await parser.parseString(xml);
  } catch (err) {
    console.error(`[fetchFeed] failed to parse ${config.url}: ${(err as Error).message}`);
    return [];
  }

  const sourceName = feed.title ?? config.url;
  return (feed.items ?? []).map((item) => {
    const raw = item as Record<string, unknown>;
    const link = item.link ?? '';
    const guid = (raw.guid as string | undefined) ?? (raw.id as string | undefined) ?? link;
    const identity = guid || link || item.title || '';
    return {
      id: computeId(identity),
      region: config.region,
      language: config.language,
      title: item.title ?? '(untitled)',
      summary: item.contentSnippet ?? item.content ?? '',
      link,
      sourceName,
      publishedAt: item.isoDate ?? new Date().toISOString(),
    };
  });
}

export async function fetchAllFeeds(configs: FeedConfig[], fetchFn: FetchFn = defaultFetch): Promise<FeedItem[]> {
  const results = await Promise.all(configs.map((config) => fetchFeed(config, fetchFn)));
  return results.flat();
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test -- fetchFeeds.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add content-pipeline/src/fetchFeeds.ts content-pipeline/test/fetchFeeds.test.ts
git commit -m "feat: fetch and normalize RSS/Atom feed items"
```

---

### Task 4: Selection, dedup, and daily-cap logic

**Files:**
- Create: `content-pipeline/src/selectArticles.ts`
- Test: `content-pipeline/test/selectArticles.test.ts`

**Interfaces:**
- Consumes: `FeedItem`, `Manifest`, `Region` from `shared/types.ts`; `REGION_PRIORITY` from `shared/regions.ts`.
- Produces: `berlinDateString(date: Date): string`, `selectArticles(items: FeedItem[], manifest: Manifest, now?: Date, dailyCap?: number): { selected: FeedItem[]; manifest: Manifest }`. Default `dailyCap` is 20.

- [ ] **Step 1: Write the failing tests**

```typescript
// content-pipeline/test/selectArticles.test.ts
import { describe, it, expect } from 'vitest';
import { selectArticles, berlinDateString } from '../src/selectArticles';
import type { FeedItem, Manifest } from '../../shared/types';

function item(id: string, region: FeedItem['region'], publishedAt: string): FeedItem {
  return {
    id,
    region,
    language: 'de',
    title: `Title ${id}`,
    summary: `Summary ${id}`,
    link: `https://example.com/${id}`,
    sourceName: 'Test Source',
    publishedAt,
  };
}

const emptyManifest = (): Manifest => ({
  publishedIds: [],
  dailyCounter: { date: berlinDateString(new Date('2026-08-21T10:00:00Z')), count: 0 },
});

describe('selectArticles', () => {
  it('excludes items already in the manifest', () => {
    const manifest = emptyManifest();
    manifest.publishedIds.push('a1');
    const items = [item('a1', 'global', '2026-08-21T09:00:00Z'), item('a2', 'global', '2026-08-21T09:05:00Z')];
    const { selected } = selectArticles(items, manifest, new Date('2026-08-21T10:00:00Z'), 20);
    expect(selected.map((i) => i.id)).toEqual(['a2']);
  });

  it('enforces the daily cap and exhausts higher-priority tiers first', () => {
    const manifest = emptyManifest();
    const items = Array.from({ length: 5 }, (_, i) => item(`g${i}`, 'global', `2026-08-21T0${i}:00:00Z`)).concat([
      item('s1', 'bayern', '2026-08-21T09:00:00Z'),
    ]);
    const { selected } = selectArticles(items, manifest, new Date('2026-08-21T10:00:00Z'), 3);
    expect(selected).toHaveLength(3);
    expect(selected.every((i) => i.region === 'global')).toBe(true);
  });

  it('round-robins across states once global and germany are exhausted', () => {
    const manifest = emptyManifest();
    const items = [
      item('g1', 'global', '2026-08-21T09:00:00Z'),
      item('bay1', 'bayern', '2026-08-21T08:00:00Z'),
      item('bay2', 'bayern', '2026-08-21T07:00:00Z'),
      item('nrw1', 'nrw', '2026-08-21T08:30:00Z'),
      item('berlin1', 'berlin', '2026-08-21T08:15:00Z'),
    ];
    const { selected } = selectArticles(items, manifest, new Date('2026-08-21T10:00:00Z'), 4);
    const regions = selected.map((i) => i.region);
    expect(regions[0]).toBe('global');
    expect(new Set(regions.slice(1))).toEqual(new Set(['bayern', 'nrw', 'berlin']));
  });

  it('resets the daily counter on a new Berlin day but keeps dedup history', () => {
    const manifest: Manifest = {
      publishedIds: ['old1'],
      dailyCounter: { date: '2026-08-20', count: 20 },
    };
    const items = [item('a1', 'global', '2026-08-21T09:00:00Z'), item('old1', 'global', '2026-08-21T09:05:00Z')];
    const { selected, manifest: updated } = selectArticles(items, manifest, new Date('2026-08-21T10:00:00Z'), 20);
    expect(selected.map((i) => i.id)).toEqual(['a1']);
    expect(updated.dailyCounter).toEqual({ date: '2026-08-21', count: 1 });
    expect(updated.publishedIds).toContain('old1');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- selectArticles.test.ts`
Expected: FAIL — cannot find module `../src/selectArticles`.

- [ ] **Step 3: Implement `selectArticles.ts`**

```typescript
// content-pipeline/src/selectArticles.ts
import type { FeedItem, Manifest, Region } from '../../shared/types';
import { REGION_PRIORITY } from '../../shared/regions';

const DAILY_CAP = 20;
const BERLIN_TZ = 'Europe/Berlin';

export function berlinDateString(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BERLIN_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function selectArticles(
  items: FeedItem[],
  manifest: Manifest,
  now: Date = new Date(),
  dailyCap: number = DAILY_CAP
): { selected: FeedItem[]; manifest: Manifest } {
  const today = berlinDateString(now);
  const dailyCounter =
    manifest.dailyCounter.date === today ? { ...manifest.dailyCounter } : { date: today, count: 0 };

  const publishedIds = new Set(manifest.publishedIds);
  const candidates = items.filter((item) => !publishedIds.has(item.id));

  const byRegion = new Map<Region, FeedItem[]>();
  for (const item of candidates) {
    if (!byRegion.has(item.region)) byRegion.set(item.region, []);
    byRegion.get(item.region)!.push(item);
  }
  for (const list of byRegion.values()) {
    list.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
  }

  const selected: FeedItem[] = [];
  const remainingSlots = () => dailyCap - dailyCounter.count - selected.length;

  // Tier 1 + 2: global and germany-national get first claim on remaining slots.
  for (const region of ['global', 'germany'] as Region[]) {
    const list = byRegion.get(region) ?? [];
    while (list.length > 0 && remainingSlots() > 0) {
      selected.push(list.shift()!);
    }
  }

  // Tier 3: the 16 Bundesländer, round-robin so one state's volume never
  // crowds out the others.
  const stateRegions = REGION_PRIORITY.filter((r) => r !== 'global' && r !== 'germany');
  let progress = true;
  while (remainingSlots() > 0 && progress) {
    progress = false;
    for (const region of stateRegions) {
      if (remainingSlots() <= 0) break;
      const list = byRegion.get(region);
      if (!list || list.length === 0) continue;
      selected.push(list.shift()!);
      progress = true;
    }
  }

  selected.forEach((item) => publishedIds.add(item.id));
  dailyCounter.count += selected.length;

  return {
    selected,
    manifest: { publishedIds: Array.from(publishedIds), dailyCounter },
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- selectArticles.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add content-pipeline/src/selectArticles.ts content-pipeline/test/selectArticles.test.ts
git commit -m "feat: select articles with dedup, daily cap, and tier priority"
```

---

### Task 5: MyMemory translation wrapper

**Files:**
- Create: `content-pipeline/src/translate.ts`
- Test: `content-pipeline/test/translate.test.ts`

**Interfaces:**
- Produces: `TranslateOptions { email?, fetchFn?, maxRetries? }`, `translateText(text, sourceLang, targetLang, options?): Promise<string | null>`, `translateFields(fields: { title, summary }, sourceLang, targetLangs, options?): Promise<Partial<Record<string, { title, summary }>>>`.

- [ ] **Step 1: Write the failing tests**

```typescript
// content-pipeline/test/translate.test.ts
import { describe, it, expect, vi } from 'vitest';
import { translateText, translateFields } from '../src/translate';

function mockResponse(body: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 500, json: async () => body } as Response;
}

describe('translateText', () => {
  it('returns the translated text on a successful response', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(mockResponse({ responseData: { translatedText: 'Hallo Welt' }, responseStatus: 200 }));
    const result = await translateText('Hello world', 'en', 'de', { fetchFn });
    expect(result).toBe('Hallo Welt');
  });

  it('returns null when MyMemory reports a non-200 responseStatus even on HTTP 200', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      mockResponse({
        responseData: { translatedText: "'XX' IS AN INVALID TARGET LANGUAGE" },
        responseStatus: '403',
        responseDetails: 'invalid language',
      })
    );
    const result = await translateText('Hello world', 'en', 'xx', { fetchFn, maxRetries: 0 });
    expect(result).toBeNull();
  });

  it('retries on failure and succeeds on a later attempt', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(mockResponse({}, false))
      .mockResolvedValueOnce(mockResponse({ responseData: { translatedText: 'Hallo' }, responseStatus: 200 }));
    const result = await translateText('Hello', 'en', 'de', { fetchFn, maxRetries: 1 });
    expect(result).toBe('Hallo');
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('gives up and returns null after exhausting retries', async () => {
    const fetchFn = vi.fn().mockResolvedValue(mockResponse({}, false));
    const result = await translateText('Hello', 'en', 'de', { fetchFn, maxRetries: 1 });
    expect(result).toBeNull();
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('passes text through untranslated for empty/whitespace input, without calling fetch', async () => {
    const fetchFn = vi.fn();
    const result = await translateText('   ', 'en', 'de', { fetchFn });
    expect(result).toBe('   ');
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe('translateFields', () => {
  it('copies fields directly for the source language and translates the rest', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(mockResponse({ responseData: { translatedText: 'Hallo' }, responseStatus: 200 }));
    const result = await translateFields({ title: 'Hello', summary: 'World' }, 'en', ['en', 'de'], { fetchFn });
    expect(result.en).toEqual({ title: 'Hello', summary: 'World' });
    expect(result.de).toEqual({ title: 'Hallo', summary: 'Hallo' });
  });

  it('omits a language entirely if either field fails to translate', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(mockResponse({ responseData: { translatedText: 'Hallo' }, responseStatus: 200 }))
      .mockResolvedValueOnce(mockResponse({}, false));
    const result = await translateFields({ title: 'Hello', summary: 'World' }, 'en', ['de'], {
      fetchFn,
      maxRetries: 0,
    });
    expect(result.de).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- translate.test.ts`
Expected: FAIL — cannot find module `../src/translate`.

- [ ] **Step 3: Implement `translate.ts`**

```typescript
// content-pipeline/src/translate.ts
export interface TranslateOptions {
  email?: string;
  fetchFn?: typeof fetch;
  maxRetries?: number;
}

interface MyMemoryResponse {
  responseData?: { translatedText?: string };
  responseStatus?: number | string;
  responseDetails?: string;
}

export async function translateText(
  text: string,
  sourceLang: string,
  targetLang: string,
  options: TranslateOptions = {}
): Promise<string | null> {
  if (!text.trim()) return text;
  const { email, fetchFn = fetch, maxRetries = 2 } = options;

  const params = new URLSearchParams({ q: text, langpair: `${sourceLang}|${targetLang}` });
  if (email) params.set('de', email);
  const url = `https://api.mymemory.translated.net/get?${params.toString()}`;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetchFn(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as MyMemoryResponse;
      const status = Number(data.responseStatus);
      const translated = data.responseData?.translatedText;
      if (status !== 200 || typeof translated !== 'string' || !translated) {
        throw new Error(`MyMemory error (status=${data.responseStatus}): ${data.responseDetails ?? 'unknown'}`);
      }
      return translated;
    } catch (err) {
      if (attempt === maxRetries) {
        console.error(`[translateText] giving up on ${sourceLang}->${targetLang}: ${(err as Error).message}`);
        return null;
      }
    }
  }
  return null;
}

export async function translateFields(
  fields: { title: string; summary: string },
  sourceLang: string,
  targetLangs: readonly string[],
  options: TranslateOptions = {}
): Promise<Partial<Record<string, { title: string; summary: string }>>> {
  const result: Partial<Record<string, { title: string; summary: string }>> = {};
  for (const lang of targetLangs) {
    if (lang === sourceLang) {
      result[lang] = fields;
      continue;
    }
    const [title, summary] = await Promise.all([
      translateText(fields.title, sourceLang, lang, options),
      translateText(fields.summary, sourceLang, lang, options),
    ]);
    if (title !== null && summary !== null) {
      result[lang] = { title, summary };
    }
  }
  return result;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- translate.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add content-pipeline/src/translate.ts content-pipeline/test/translate.test.ts
git commit -m "feat: add MyMemory translation wrapper with status-aware error handling"
```

---

### Task 6: Article and manifest writer

**Files:**
- Create: `content-pipeline/src/writeArticles.ts`
- Test: `content-pipeline/test/writeArticles.test.ts`

**Interfaces:**
- Consumes: `Article`, `FeedItem`, `LanguageCode`, `Manifest` from `shared/types.ts`.
- Produces: `slugify(title: string): string`, `writeArticle(item, translations, originalLanguage, contentDir, dateStr, existingSlugs?): Promise<Article>`, `writeManifest(manifest: Manifest, contentDir: string): Promise<void>`.

- [ ] **Step 1: Write the failing tests**

```typescript
// content-pipeline/test/writeArticles.test.ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- writeArticles.test.ts`
Expected: FAIL — cannot find module `../src/writeArticles`.

- [ ] **Step 3: Implement `writeArticles.ts`**

```typescript
// content-pipeline/src/writeArticles.ts
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Article, FeedItem, LanguageCode, Manifest } from '../../shared/types';

export function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- writeArticles.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add content-pipeline/src/writeArticles.ts content-pipeline/test/writeArticles.test.ts
git commit -m "feat: write article and manifest JSON files"
```

---

### Task 7: Pipeline orchestrator, feed config, and integration test

**Files:**
- Create: `content-pipeline/src/run.ts`
- Create: `content/feeds.json`
- Create: `content/manifest.json`
- Modify: `package.json` (add `fetch-news` script)
- Test: `content-pipeline/test/run.test.ts`

**Interfaces:**
- Consumes: `fetchAllFeeds` (Task 3), `selectArticles`/`berlinDateString` (Task 4), `translateFields` (Task 5), `writeArticle`/`writeManifest` (Task 6), `LANGUAGES` (Task 2).
- Produces: `runPipeline(deps?: { contentDir?: string; now?: Date }): Promise<{ published: number }>`, plus a CLI entry point runnable via `npm run fetch-news`.

- [ ] **Step 1: Write the failing integration test**

```typescript
// content-pipeline/test/run.test.ts
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- run.test.ts`
Expected: FAIL — cannot find module `../src/run`.

- [ ] **Step 3: Implement `run.ts`**

```typescript
// content-pipeline/src/run.ts
import { readFile } from 'node:fs/promises';
import path from 'node:path';
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

if (import.meta.url === `file://${process.argv[1]}`) {
  runPipeline()
    .then(({ published }) => {
      console.log(`Published ${published} article(s).`);
    })
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    });
}
```

- [ ] **Step 4: Create `content/feeds.json`** with the 17 verified feeds (Global, Germany-national, and 15 of the 16 Bundesländer — Saarland has no working public text-news RSS feed after a thorough search; Berlin and Brandenburg share RBB's single feed, matching how that broadcaster actually covers both states; the Region type already includes `saarland` so adding its feed later is a one-line content change, not a code change)

```json
[
  { "region": "global", "language": "en", "url": "https://feeds.bbci.co.uk/news/world/rss.xml" },
  { "region": "germany", "language": "de", "url": "https://www.tagesschau.de/infoservices/alle-meldungen-100~rss2.xml" },
  { "region": "bayern", "language": "de", "url": "https://www.br.de/nachrichten/meldungen/nachrichten-bayerischer-rundfunk100~newsRss.xml" },
  { "region": "nrw", "language": "de", "url": "https://www1.wdr.de/uebersicht-100.feed" },
  { "region": "berlin", "language": "de", "url": "https://www.rbb24.de/index.xml/feed=rss.xml" },
  { "region": "brandenburg", "language": "de", "url": "https://www.rbb24.de/index.xml/feed=rss.xml" },
  { "region": "baden-wuerttemberg", "language": "de", "url": "https://www.swr.de/~rss/swraktuell/baden-wuerttemberg/index.xml" },
  { "region": "rheinland-pfalz", "language": "de", "url": "https://www.swr.de/~rss/swraktuell/rheinland-pfalz/index.xml" },
  { "region": "hessen", "language": "de", "url": "https://www.hessenschau.de/index.rss" },
  { "region": "sachsen", "language": "de", "url": "https://www.mdr.de/nachrichten/sachsen/index-rss.xml" },
  { "region": "sachsen-anhalt", "language": "de", "url": "https://www.mdr.de/nachrichten/sachsen-anhalt/index-rss.xml" },
  { "region": "thueringen", "language": "de", "url": "https://www.mdr.de/nachrichten/thueringen/index-rss.xml" },
  { "region": "hamburg", "language": "de", "url": "https://www.ndr.de/nachrichten/hamburg/index-rss.xml" },
  { "region": "mecklenburg-vorpommern", "language": "de", "url": "https://www.ndr.de/nachrichten/mecklenburg-vorpommern/index-rss.xml" },
  { "region": "niedersachsen", "language": "de", "url": "https://www.ndr.de/nachrichten/niedersachsen/index-rss.xml" },
  { "region": "schleswig-holstein", "language": "de", "url": "https://www.ndr.de/nachrichten/schleswig-holstein/index-rss.xml" },
  { "region": "bremen", "language": "de", "url": "https://www.butenunbinnen.de/feed/rss/nachrichten/neuste-nachrichten100.xml" }
]
```

- [ ] **Step 5: Create the initial `content/manifest.json`**

```json
{
  "publishedIds": [],
  "dailyCounter": { "date": "2026-08-21", "count": 0 }
}
```

- [ ] **Step 6: Add the `fetch-news` script to `package.json`**

In the `"scripts"` object, add:

```json
"fetch-news": "tsx content-pipeline/src/run.ts"
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `npm test -- run.test.ts`
Expected: PASS (1 test).

- [ ] **Step 8: Run the full test suite**

Run: `npm test`
Expected: all test files PASS.

- [ ] **Step 9: Commit**

```bash
git add content-pipeline/src/run.ts content-pipeline/test/run.test.ts content/feeds.json content/manifest.json package.json
git commit -m "feat: add pipeline orchestrator and initial feed config"
```

---

### Task 8: GitHub Actions workflow, README, and live verification

**Files:**
- Create: `.github/workflows/fetch-news.yml`
- Create: `README.md`

**Interfaces:**
- Consumes: `npm run fetch-news` (Task 7).
- Produces: a scheduled + manually-triggerable workflow that commits `content/` changes.

- [ ] **Step 1: Create the workflow**

```yaml
# .github/workflows/fetch-news.yml
name: Fetch News

on:
  schedule:
    - cron: '0 */2 * * *'
  workflow_dispatch: {}

permissions:
  contents: write

jobs:
  fetch:
    runs-on: ubuntu-latest
    steps:
      - name: Check out repository
        uses: actions/checkout@v4

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - name: Install dependencies
        run: npm ci

      - name: Run content pipeline
        env:
          MYMEMORY_EMAIL: ${{ secrets.MYMEMORY_EMAIL }}
        run: npm run fetch-news

      - name: Commit and push new content
        run: |
          git config user.name "laufenden-bot"
          git config user.email "actions@users.noreply.github.com"
          git add content/
          if git diff --cached --quiet; then
            echo "No new articles, nothing to commit."
          else
            git commit -m "content: automated news fetch $(date -u +'%Y-%m-%d %H:%M UTC')"
            git push
          fi
```

- [ ] **Step 2: Create `README.md`**

```markdown
# laufenden

A multilingual German news site — global, national, and regional (all 16
Bundesländer) news, in English, German, Turkish, Ukrainian, Hindi, Bengali,
Polish, Spanish, and French. See `docs/superpowers/specs/2026-08-21-laufenden-news-platform-design.md`
for the full design.

## Content pipeline

`npm run fetch-news` fetches configured RSS feeds (`content/feeds.json`),
selects up to 20 new articles/day (Global → Germany-national → the 16
Bundesländer, dedup'd against `content/manifest.json`), translates each into
9 languages via the free MyMemory API, and writes them to
`content/articles/YYYY-MM-DD/`.

Optional environment variable: `MYMEMORY_EMAIL` — registering an email with
MyMemory raises its free daily quota from 5,000 to 50,000 words. Set it as a
repository secret (`Settings → Secrets and variables → Actions`) named
`MYMEMORY_EMAIL` to have the scheduled workflow use it.

**Known gap:** Saarland has no configured feed yet — no working public
text-news RSS feed for it was found. Add one to `content/feeds.json` with
`"region": "saarland"` whenever a suitable feed is identified; no code
changes are needed.

## Local development

```bash
npm install
npm test          # run the pipeline's unit + integration tests
npm run fetch-news # run the pipeline once against the real feeds
```

## Automated fetching

`.github/workflows/fetch-news.yml` runs the pipeline every 2 hours and
commits any new articles directly to `main`, which triggers a Vercel deploy
(once Vercel is connected to this repo).
```

- [ ] **Step 3: Run the pipeline once locally against the real, live feeds**

Run: `npm run fetch-news`
Expected: console prints `Published N article(s).` with `N` between 1 and 20; `content/articles/<today's date>/` now contains that many `.json` files; `content/manifest.json` is updated.

Inspect a couple of the generated files (`cat content/articles/<date>/<slug>.json`) to confirm: `sourceUrl` points at a real article, `translations` has entries for multiple languages with genuinely different text per language, and no language's `title`/`summary` is literally the untranslated source text (aside from the source language itself, which is expected).

- [ ] **Step 4: Decide what to do with this real test-run content**

Either:
- **(a)** Keep it as the site's first real batch of articles — proceed to Step 5 and commit `content/articles/` and the updated `content/manifest.json` along with everything else, or
- **(b)** Treat it as a dry run only — run `git checkout -- content/manifest.json && git clean -fd content/articles/` to discard it, leaving `content/manifest.json` at its initial empty state, so the first real batch comes from the scheduled GitHub Actions run after this is merged.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/fetch-news.yml README.md content/
git commit -m "feat: add scheduled GitHub Actions workflow for content fetching"
```

- [ ] **Step 6: Manual post-push verification (cannot be done from this session — requires GitHub access)**

After pushing this branch and merging to `main`:
1. Go to the repo's **Actions** tab → **Fetch News** workflow → **Run workflow** (uses the `workflow_dispatch` trigger) to confirm it runs end-to-end in CI, not just locally.
2. Confirm the workflow run shows a new commit (or "No new articles, nothing to commit." if the daily cap was already reached by the local run in Step 3).
3. If translations are failing broadly in CI but worked locally, check whether GitHub's shared runner IP has hit MyMemory's anonymous rate limit — register `MYMEMORY_EMAIL` as a repository secret (see README) to raise the quota.

---

## Self-Review Notes

- **Spec coverage:** RSS-only sourcing ✅ (Task 3), 20/day cap with tier priority ✅ (Task 4), 9 languages via MyMemory with graceful per-language failure ✅ (Task 5), exact storage paths ✅ (Task 6/7), GitHub Actions scheduling + git commit ✅ (Task 8), broken-feed resilience ✅ (Task 3 tests), Berlin-timezone daily reset ✅ (Task 4 tests). Frontend consumption of this content is intentionally out of scope — covered by the next plan.
- **Type consistency:** `FeedItem`, `Article`, `Manifest`, `FeedConfig` are defined once in `shared/types.ts` (Task 2) and referenced identically by name across Tasks 3–7; verified no renamed fields between tasks.
- **No placeholders:** every step has real, runnable code; the one known content gap (Saarland's feed) is a documented data gap, not a code TODO, and is called out explicitly in both the plan and the README rather than silently left in.
