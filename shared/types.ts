import type { Region } from './regions';
import type { LanguageCode } from './languages';

// Re-exported so `import type { Region } from '.../shared/types'` is a valid
// path too — the plausible-looking import that has bitten this codebase before.
export type { Region } from './regions';
export type { LanguageCode } from './languages';

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
  /**
   * Full text in the original language, only when the feed provides more than
   * the teaser (BR ships whole bulletins as the description; most feeds don't).
   */
  body?: string;
  imageUrl?: string;
  author?: string;
  link: string;
  sourceName: string;
  publishedAt: string;
}

export interface TranslatedFields {
  title: string;
  summary: string;
  /** Optional per language: a failed body translation downgrades to teaser-only. */
  body?: string;
}

export interface Article {
  id: string;
  slug: string;
  category: Region;
  sourceName: string;
  sourceUrl: string;
  publishedAt: string;
  originalLanguage: LanguageCode;
  /** Absent on articles published before the pipeline captured media fields. */
  imageUrl?: string;
  author?: string;
  translations: Partial<Record<LanguageCode, TranslatedFields>>;
}

export interface DailyCounter {
  date: string;
  count: number;
  /**
   * How many articles of each tier have been selected so far on `date`.
   *
   * Optional for backward compatibility with manifests written before per-day
   * tier tracking existed; a missing value is read as all-zero. `selectArticles`
   * always writes it back, so it self-heals on the first run of any day.
   */
  byTier?: { global: number; germany: number; states: number };
}

export interface Manifest {
  publishedIds: string[];
  dailyCounter: DailyCounter;
}
