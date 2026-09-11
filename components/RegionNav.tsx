import Link from 'next/link';
import { STATE_REGIONS } from '../shared/regions';
import type { LanguageCode } from '../shared/types';
import { getDictionary } from '../lib/dictionary';
import { RegionMenu } from './RegionMenu';

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
      <RegionMenu
        label={dict['nav.regionsMenu']}
        items={STATE_REGIONS.map((region) => ({
          href: `/${lang}/${region}`,
          label: dict[`region.${region}`],
        }))}
      />
    </nav>
  );
}
