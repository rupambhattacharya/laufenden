export const LANGUAGES = ['en', 'de', 'tr', 'uk', 'hi', 'bn', 'pl', 'es', 'fr'] as const;

export type LanguageCode = (typeof LANGUAGES)[number];
