import { notFound } from 'next/navigation';
import { LANGUAGES, isLanguageCode } from '../../../../shared/languages';
import { isRegion } from '../../../../shared/regions';
import { getAllArticles, getArticleBySlug, getDisplayFields } from '../../../../lib/content';
import { getDictionary, getRegionDisplayName } from '../../../../lib/dictionary';
import { headlineFontClass } from '../../../../lib/typography';

export async function generateStaticParams() {
  const articles = await getAllArticles();
  return LANGUAGES.flatMap((lang) =>
    articles.map((article) => ({ lang, region: article.category, slug: article.slug }))
  );
}

export default async function ArticlePage({
  params,
}: {
  params: Promise<{ lang: string; region: string; slug: string }>;
}) {
  const { lang, region, slug } = await params;
  if (!isLanguageCode(lang) || !isRegion(region)) {
    notFound();
  }

  const article = await getArticleBySlug(region, slug);
  if (!article) {
    notFound();
  }

  const dict = getDictionary(lang);
  const fields = getDisplayFields(article, lang);
  const publishedDate = new Date(article.publishedAt).toLocaleDateString(lang, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return (
    <article className="mx-auto max-w-2xl">
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-masthead">
        {getRegionDisplayName(lang, region)}
      </p>
      <h1 className={`mb-4 text-4xl font-black leading-tight ${headlineFontClass(lang)}`}>{fields.title}</h1>
      <p className="mb-6 text-sm text-neutral-500">
        {dict.publishedOn} {publishedDate}
      </p>
      {fields.isFallback && (
        <p className="mb-4 border border-neutral-300 bg-neutral-50 px-3 py-2 text-sm text-neutral-600">
          {dict.translationUnavailable}
        </p>
      )}
      <p className="font-deck text-lg italic leading-relaxed text-neutral-800">{fields.summary}</p>
      <a
        href={article.sourceUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-8 inline-block border-b border-black text-sm font-semibold"
      >
        {dict.source}: {article.sourceName}
      </a>
    </article>
  );
}
