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
