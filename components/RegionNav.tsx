import Link from 'next/link';
import { STATE_REGIONS } from '../shared/regions';
import type { LanguageCode } from '../shared/types';
import { getDictionary } from '../lib/dictionary';

export function RegionNav({ lang }: { lang: LanguageCode }) {
  const dict = getDictionary(lang);

  return (
    <nav className="flex items-center gap-6 border-b border-black px-6 py-2 text-xs uppercase tracking-wide text-neutral-600">
      <Link href={`/${lang}/global`} className="hover:text-black">
        {dict['region.global']}
      </Link>
      <Link href={`/${lang}/germany`} className="hover:text-black">
        {dict['region.germany']}
      </Link>
      <details className="relative">
        <summary className="cursor-pointer list-none hover:text-black">{dict['nav.regionsMenu']}</summary>
        <div className="absolute left-0 top-full z-10 grid w-64 grid-cols-1 gap-1 border border-black bg-white p-3 normal-case tracking-normal text-black">
          {STATE_REGIONS.map((region) => (
            <Link key={region} href={`/${lang}/${region}`} className="hover:underline">
              {dict[`region.${region}`]}
            </Link>
          ))}
        </div>
      </details>
    </nav>
  );
}
