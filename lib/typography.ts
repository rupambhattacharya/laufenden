import type { LanguageCode } from '../shared/types';

export function headlineFontClass(lang: LanguageCode): string {
  if (lang === 'hi') return 'font-serif-hi';
  if (lang === 'bn') return 'font-serif-bn';
  return 'font-serif';
}
