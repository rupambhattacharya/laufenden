import Link from 'next/link';
import type { Article, LanguageCode } from '../shared/types';
import { getDisplayFields } from '../lib/content';
import { getDictionary } from '../lib/dictionary';
import { headlineFontClass } from '../lib/typography';

export function ArticleCard({
  article,
  lang,
  variant = 'default',
}: {
  article: Article;
  lang: LanguageCode;
  variant?: 'lead' | 'default';
}) {
  const dict = getDictionary(lang);
  const fields = getDisplayFields(article, lang);
  const href = `/${lang}/${article.category}/${article.slug}`;
  const titleClass =
    variant === 'lead'
      ? `text-3xl font-black leading-tight ${headlineFontClass(lang)}`
      : `text-lg font-bold leading-snug ${headlineFontClass(lang)}`;

  return (
    <article className="flex flex-col gap-2">
      <Link href={href} className={`${titleClass} text-black hover:underline`}>
        {fields.title}
      </Link>
      <p className="font-deck text-sm italic text-neutral-600">{fields.summary}</p>
      {fields.isFallback && <p className="text-xs text-neutral-500">{dict.translationUnavailable}</p>}
      <p className="text-xs uppercase tracking-wide text-neutral-500">
        {dict.source}: {article.sourceName}
      </p>
    </article>
  );
}
