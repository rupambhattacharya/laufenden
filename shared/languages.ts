export const LANGUAGES = ['en', 'de', 'hi', 'bn', 'fr'] as const;

export type LanguageCode = (typeof LANGUAGES)[number];

export function isLanguageCode(value: string): value is LanguageCode {
  return (LANGUAGES as readonly string[]).includes(value);
}
