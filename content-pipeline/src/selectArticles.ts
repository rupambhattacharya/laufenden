import type { DailyCounter, FeedItem, Manifest } from '../../shared/types';
import type { Region } from '../../shared/regions';
import { REGION_PRIORITY } from '../../shared/regions';

const DAILY_CAP = 20;
const BERLIN_TZ = 'Europe/Berlin';

/**
 * Per-tier quotas at the full daily cap of 20: <=4 global, <=6 germany-national,
 * and the remaining >=10 round-robined across the 16 Bundeslaender.
 *
 * These quotas are per *Berlin calendar day*, not per run. The workflow runs
 * every 2 hours, so a run's budget is whatever the day's tier quota has left,
 * tracked in `dailyCounter.byTier`. Unused quota still only ever spills
 * downward (global -> germany -> states).
 */
const GLOBAL_SHARE = 4 / DAILY_CAP;
const GERMANY_SHARE = 6 / DAILY_CAP;

type TierCounts = NonNullable<DailyCounter['byTier']>;

const zeroTiers = (): TierCounts => ({ global: 0, germany: 0, states: 0 });

export function berlinDateString(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: BERLIN_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

const REGION_RANK = new Map<string, number>(REGION_PRIORITY.map((region, index) => [region, index]));

const STATE_REGIONS: Region[] = REGION_PRIORITY.filter((r) => r !== 'global' && r !== 'germany');

/**
 * Which state gets first pick in today's round-robin.
 *
 * The states tier is budgeted at ~10 slots but spans 16 Bundeslaender, so a
 * round-robin that always started at REGION_PRIORITY's first state would starve
 * the tail of the list on every single run, forever. Rotating the starting
 * index by a value derived from the Berlin date gives every state a turn at the
 * front. The whole cycle is still walked in order (wrapping around), so this
 * only reorders states — it never makes one ineligible.
 *
 * `20260821` -> 20260821 % 16. Consecutive days within a month shift the offset
 * by one, which is deterministic and spreads across all 16 states.
 */
export function stateRotationOffset(dateStr: string, stateCount: number = STATE_REGIONS.length): number {
  if (stateCount <= 0) return 0;
  const numeric = Number(dateStr.replace(/-/g, ''));
  if (!Number.isFinite(numeric)) return 0;
  return ((Math.trunc(numeric) % stateCount) + stateCount) % stateCount;
}

/** STATE_REGIONS cycled so that today's rotation offset comes first. */
function rotatedStateRegions(dateStr: string): Region[] {
  const offset = stateRotationOffset(dateStr);
  return STATE_REGIONS.map((_, i) => STATE_REGIONS[(i + offset) % STATE_REGIONS.length]);
}

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
  const sameDay = manifest.dailyCounter.date === today;
  // A new Berlin day resets both the total and the per-tier counters. On the
  // same day, a manifest written before byTier existed reads as all-zero.
  const spentByTier: TierCounts = sameDay
    ? { ...zeroTiers(), ...(manifest.dailyCounter.byTier ?? {}) }
    : zeroTiers();
  const spentTotal = sameDay ? manifest.dailyCounter.count : 0;

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

  // Whole-day tier quotas, scaled if the caller passes a non-default cap.
  const globalQuota = Math.floor(dailyCap * GLOBAL_SHARE);
  const germanyQuota = Math.floor(dailyCap * GERMANY_SHARE);
  const statesQuota = dailyCap - globalQuota - germanyQuota;

  const totalBudget = Math.max(0, dailyCap - spentTotal);
  // Combined ceiling for the two upper tiers across the day. Downward spill is a
  // *transfer* of slots, not a bonus: if germany already consumed global's
  // unused slots in an earlier run, global cannot claim them again later, and
  // the states tier keeps its >=10 reservation over the day as a whole.
  const upperAllowance = Math.max(0, globalQuota + germanyQuota - (spentByTier.global + spentByTier.germany));

  const selected: FeedItem[] = [];

  const takeFrom = (region: Region, budget: number): number => {
    const list = byRegion.get(region) ?? [];
    const taken = Math.min(Math.max(0, budget), list.length);
    for (let i = 0; i < taken; i++) selected.push(list.shift()!);
    return taken;
  };

  // Tier 1: global, capped at whatever is left of its daily quota. Unused slots
  // spill down to germany.
  const globalBudget = Math.min(Math.max(0, globalQuota - spentByTier.global), upperAllowance, totalBudget);
  const globalTaken = takeFrom('global', globalBudget);

  // Tier 2: germany-national, the rest of its daily quota plus whatever global
  // left unused in this run.
  const germanyBudget = Math.min(
    Math.max(0, germanyQuota - spentByTier.germany) + (globalBudget - globalTaken),
    upperAllowance - globalTaken,
    totalBudget - globalTaken
  );
  const germanyTaken = takeFrom('germany', germanyBudget);

  // Tier 3: the 16 Bundeslaender, round-robin (from today's rotated starting
  // state) so one state's volume never crowds out the others. Gets the rest of
  // its daily quota plus germany's unused slots. Nothing ever spills upward.
  let statesBudget = Math.min(
    Math.max(0, statesQuota - spentByTier.states) + (germanyBudget - germanyTaken),
    totalBudget - globalTaken - germanyTaken
  );
  const stateRegions = rotatedStateRegions(today);
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
  const statesTaken = selected.length - globalTaken - germanyTaken;

  selected.forEach((item) => publishedIds.add(item.id));

  const dailyCounter: DailyCounter = {
    date: today,
    count: spentTotal + selected.length,
    byTier: {
      global: spentByTier.global + globalTaken,
      germany: spentByTier.germany + germanyTaken,
      states: spentByTier.states + statesTaken,
    },
  };

  return {
    selected,
    manifest: { publishedIds: Array.from(publishedIds), dailyCounter },
  };
}
