import type { LanguageCode, Region } from '../shared/types';
import en from '../shared/dictionaries/en.json';
import de from '../shared/dictionaries/de.json';
import hi from '../shared/dictionaries/hi.json';
import bn from '../shared/dictionaries/bn.json';
import fr from '../shared/dictionaries/fr.json';

const DICTIONARIES: Record<LanguageCode, Record<string, string>> = {
  en, de, hi, bn, fr,
};

export function getDictionary(lang: LanguageCode): Record<string, string> {
  return DICTIONARIES[lang] ?? DICTIONARIES.en;
}

export function t(lang: LanguageCode, key: string): string {
  return getDictionary(lang)[key] ?? DICTIONARIES.en[key] ?? key;
}

export function getRegionDisplayName(lang: LanguageCode, region: Region): string {
  return t(lang, `region.${region}`);
}
