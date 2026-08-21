import type { FeedItem, Manifest, Region } from '../../shared/types';
import { REGION_PRIORITY } from '../../shared/regions';

const DAILY_CAP = 20;
const BERLIN_TZ = 'Europe/Berlin';

export function berlinDateString(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BERLIN_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

export function selectArticles(
  items: FeedItem[],
  manifest: Manifest,
  now: Date = new Date(),
  dailyCap: number = DAILY_CAP
): { selected: FeedItem[]; manifest: Manifest } {
  const today = berlinDateString(now);
  const dailyCounter =
    manifest.dailyCounter.date === today ? { ...manifest.dailyCounter } : { date: today, count: 0 };

  const publishedIds = new Set(manifest.publishedIds);
  const candidates = items.filter((item) => !publishedIds.has(item.id));

  const byRegion = new Map<Region, FeedItem[]>();
  for (const item of candidates) {
    if (!byRegion.has(item.region)) byRegion.set(item.region, []);
    byRegion.get(item.region)!.push(item);
  }
  for (const list of byRegion.values()) {
    list.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
  }

  const selected: FeedItem[] = [];
  const remainingSlots = () => dailyCap - dailyCounter.count - selected.length;

  // Tier 1 + 2: global and germany-national get first claim on remaining slots.
  for (const region of ['global', 'germany'] as Region[]) {
    const list = byRegion.get(region) ?? [];
    while (list.length > 0 && remainingSlots() > 0) {
      selected.push(list.shift()!);
    }
  }

  // Tier 3: the 16 Bundesländer, round-robin so one state's volume never
  // crowds out the others.
  const stateRegions = REGION_PRIORITY.filter((r) => r !== 'global' && r !== 'germany');
  let progress = true;
  while (remainingSlots() > 0 && progress) {
    progress = false;
    for (const region of stateRegions) {
      if (remainingSlots() <= 0) break;
      const list = byRegion.get(region);
      if (!list || list.length === 0) continue;
      selected.push(list.shift()!);
      progress = true;
    }
  }

  selected.forEach((item) => publishedIds.add(item.id));
  dailyCounter.count += selected.length;

  return {
    selected,
    manifest: { publishedIds: Array.from(publishedIds), dailyCounter },
  };
}
