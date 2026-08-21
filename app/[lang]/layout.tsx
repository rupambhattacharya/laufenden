import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { LANGUAGES, isLanguageCode } from '../../shared/languages';
import { RegionNav } from '../../components/RegionNav';
import { LanguageSwitcher } from '../../components/LanguageSwitcher';

export function generateStaticParams() {
  return LANGUAGES.map((lang) => ({ lang }));
}

export default async function LangLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  if (!isLanguageCode(lang)) {
    notFound();
  }

  return (
    <div>
      <header className="flex items-center justify-between border-b-4 border-black px-6 py-3">
        <a href={`/${lang}`} className="font-serif text-2xl font-black">
          laufenden
        </a>
        <LanguageSwitcher currentLang={lang} />
      </header>
      <RegionNav lang={lang} />
      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
    </div>
  );
}
