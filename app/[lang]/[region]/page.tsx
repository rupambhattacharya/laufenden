import { notFound } from 'next/navigation';
import { LANGUAGES, isLanguageCode } from '../../../shared/languages';
import { REGION_PRIORITY, isRegion } from '../../../shared/regions';
import { getArticlesByRegion } from '../../../lib/content';
import { getDictionary, getRegionDisplayName } from '../../../lib/dictionary';
import { ArticleCard } from '../../../components/ArticleCard';

export function generateStaticParams() {
  return LANGUAGES.flatMap((lang) => REGION_PRIORITY.map((region) => ({ lang, region })));
}

export default async function RegionPage({
  params,
}: {
  params: Promise<{ lang: string; region: string }>;
}) {
  const { lang, region } = await params;
  if (!isLanguageCode(lang) || !isRegion(region)) {
    notFound();
  }

  const dict = getDictionary(lang);
  const articles = await getArticlesByRegion(region, lang, 100);

  return (
    <div>
      <h1 className="mb-6 border-b-2 border-black pb-2 font-serif text-3xl font-black uppercase tracking-tight">
        {getRegionDisplayName(lang, region)}
      </h1>
      {articles.length === 0 ? (
        <p className="text-neutral-500">{dict.noArticlesYet}</p>
      ) : (
        <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
          {articles.map((article) => (
            <ArticleCard key={article.id} article={article} lang={lang} />
          ))}
        </div>
      )}
    </div>
  );
}
