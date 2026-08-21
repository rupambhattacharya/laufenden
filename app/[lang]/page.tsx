import { notFound } from 'next/navigation';
import { isLanguageCode } from '../../shared/languages';
import { STATE_REGIONS } from '../../shared/regions';
import { getArticlesByRegion, getRecentAcrossRegions } from '../../lib/content';
import { getDictionary } from '../../lib/dictionary';
import { ArticleCard } from '../../components/ArticleCard';

export default async function HomePage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = await params;
  if (!isLanguageCode(lang)) {
    notFound();
  }

  const dict = getDictionary(lang);
  const [globalArticles, germanyArticles, regionalArticles] = await Promise.all([
    getArticlesByRegion('global', 6),
    getArticlesByRegion('germany', 6),
    getRecentAcrossRegions(STATE_REGIONS, 6),
  ]);

  const sections = [
    { label: dict['region.global'], articles: globalArticles },
    { label: dict['region.germany'], articles: germanyArticles },
    { label: dict['nav.regionalHighlights'], articles: regionalArticles },
  ];

  return (
    <div className="flex flex-col gap-12">
      {sections.map((section) => (
        <section key={section.label}>
          <h2 className="mb-4 border-b-2 border-black pb-2 font-serif text-xs font-bold uppercase tracking-widest text-masthead">
            {section.label}
          </h2>
          {section.articles.length === 0 ? (
            <p className="text-neutral-500">{dict.noArticlesYet}</p>
          ) : (
            <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
              {section.articles.map((article, index) => (
                <ArticleCard
                  key={article.id}
                  article={article}
                  lang={lang}
                  variant={index === 0 ? 'lead' : 'default'}
                />
              ))}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}
