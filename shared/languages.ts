export const LANGUAGES = ['en', 'de', 'tr', 'uk', 'hi', 'bn', 'pl', 'es', 'fr'] as const;

export type LanguageCode = (typeof LANGUAGES)[number];

export function isLanguageCode(value: string): value is LanguageCode {
  return (LANGUAGES as readonly string[]).includes(value);
}
