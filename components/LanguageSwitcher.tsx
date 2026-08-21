'use client';

import { usePathname, useRouter } from 'next/navigation';
import type { ChangeEvent } from 'react';
import { LANGUAGES } from '../shared/languages';
import type { LanguageCode } from '../shared/types';

const LANGUAGE_LABELS: Record<LanguageCode, string> = {
  en: 'English',
  de: 'Deutsch',
  hi: 'हिन्दी',
  bn: 'বাংলা',
  fr: 'Français',
};

export function LanguageSwitcher({ currentLang }: { currentLang: LanguageCode }) {
  const pathname = usePathname();
  const router = useRouter();

  function handleChange(event: ChangeEvent<HTMLSelectElement>) {
    const segments = pathname.split('/');
    segments[1] = event.target.value;
    router.push(segments.join('/'));
  }

  return (
    <select
      aria-label="Language"
      value={currentLang}
      onChange={handleChange}
      className="border border-black bg-white px-2 py-1 text-xs uppercase tracking-wide"
    >
      {LANGUAGES.map((lang) => (
        <option key={lang} value={lang}>
          {LANGUAGE_LABELS[lang]}
        </option>
      ))}
    </select>
  );
}
