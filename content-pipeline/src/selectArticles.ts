import type { FeedItem, Manifest } from '../../shared/types';
import type { Region } from '../../shared/regions';
import { REGION_PRIORITY } from '../../shared/regions';

const DAILY_CAP = 20;
const BERLIN_TZ = 'Europe/Berlin';

/**
 * Per-tier quotas at the full daily cap of 20: <=4 global, <=6 germany-national,
 * and the remaining >=10 round-robined across the 16 Bundeslaender.
 *
 * When the budget available to a run is smaller than the full cap (a second run
 * on the same day, or a caller-supplied smaller cap), the global/germany quotas
 * are scaled down proportionally and rounded *down*, so the states' share never
 * drops below half the budget. Unused quota only ever spills downward.
 */
const GLOBAL_SHARE = 4 / DAILY_CAP;
const GERMANY_SHARE = 6 / DAILY_CAP;

export function berlinDateString(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BERLIN_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

const REGION_RANK = new Map<string, number>(REGION_PRIORITY.map((region, index) => [region, index]));

/**
 * Collapse feed items that share an id within a single run's candidate batch.
 *
 * Two feed configs can point at the same underlying feed (Berlin and Brandenburg
 * are both served by rbb24.de), producing two FeedItems with the same id under
 * different regions. Keep the occurrence whose region comes first in
 * REGION_PRIORITY; ties (same region) keep the earlier array position.
 */
function dedupeWithinBatch(items: FeedItem[]): FeedItem[] {
  const byId = new Map<string, FeedItem>();
  for (const item of items) {
    const existing = byId.get(item.id);
    if (!existing) {
      byId.set(item.id, item);
      continue;
    }
    const incomingRank = REGION_RANK.get(item.region) ?? Number.MAX_SAFE_INTEGER;
    const existingRank = REGION_RANK.get(existing.region) ?? Number.MAX_SAFE_INTEGER;
    if (incomingRank < existingRank) byId.set(item.id, item);
  }
  return Array.from(byId.values());
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
  // Dedup against permanently-published history first, then within this batch.
  const candidates = dedupeWithinBatch(items.filter((item) => !publishedIds.has(item.id)));

  const byRegion = new Map<Region, FeedItem[]>();
  for (const item of candidates) {
    if (!byRegion.has(item.region)) byRegion.set(item.region, []);
    byRegion.get(item.region)!.push(item);
  }
  for (const list of byRegion.values()) {
    list.sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime());
  }

  const totalBudget = Math.max(0, dailyCap - dailyCounter.count);
  const globalQuota = Math.floor(totalBudget * GLOBAL_SHARE);
  const germanyQuota = Math.floor(totalBudget * GERMANY_SHARE);
  const statesQuota = totalBudget - globalQuota - germanyQuota;

  const selected: FeedItem[] = [];

  const takeFrom = (region: Region, budget: number): number => {
    const list = byRegion.get(region) ?? [];
    const taken = Math.min(budget, list.length);
    for (let i = 0; i < taken; i++) selected.push(list.shift()!);
    return taken;
  };

  // Tier 1: global, capped at its own quota. Unused slots spill down to germany.
  const globalBudget = globalQuota;
  const globalTaken = takeFrom('global', globalBudget);

  // Tier 2: germany-national, its own quota plus whatever global left unused.
  const germanyBudget = germanyQuota + (globalBudget - globalTaken);
  const germanyTaken = takeFrom('germany', germanyBudget);

  // Tier 3: the 16 Bundeslaender, round-robin so one state's volume never
  // crowds out the others. Gets its own quota plus germany's unused slots.
  // Nothing ever spills back upward.
  let statesBudget = statesQuota + (germanyBudget - germanyTaken);
  const stateRegions = REGION_PRIORITY.filter((r) => r !== 'global' && r !== 'germany');
  let progress = true;
  while (statesBudget > 0 && progress) {
    progress = false;
    for (const region of stateRegions) {
      if (statesBudget <= 0) break;
      const list = byRegion.get(region);
      if (!list || list.length === 0) continue;
      selected.push(list.shift()!);
      statesBudget -= 1;
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
