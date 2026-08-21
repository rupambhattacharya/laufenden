import { describe, it, expect } from 'vitest';
import { selectArticles, berlinDateString, stateRotationOffset } from '../src/selectArticles';
import { REGION_PRIORITY } from '../../shared/regions';
import type { FeedItem, Manifest } from '../../shared/types';

function item(id: string, region: FeedItem['region'], publishedAt: string): FeedItem {
  return {
    id,
    region,
    language: 'de',
    title: `Title ${id}`,
    summary: `Summary ${id}`,
    link: `https://example.com/${id}`,
    sourceName: 'Test Source',
    publishedAt,
  };
}

/** n items in `region`, newest first by construction (i=0 is the newest). */
function items(prefix: string, region: FeedItem['region'], n: number): FeedItem[] {
  return Array.from({ length: n }, (_, i) =>
    item(`${prefix}${i}`, region, new Date(Date.UTC(2026, 7, 21, 9, 0, 0) - i * 60_000).toISOString())
  );
}

const NOW = new Date('2026-08-21T10:00:00Z');

/**
 * A Berlin date whose state round-robin rotation offset is 0, so the cycle starts
 * at REGION_PRIORITY's first state (baden-wuerttemberg). 20260816 % 16 === 0.
 * Used by the ordering assertions so they read against the canonical order.
 */
const ROTATION_ZERO_NOW = new Date('2026-08-16T10:00:00Z');

const STATE_REGIONS = REGION_PRIORITY.filter((r) => r !== 'global' && r !== 'germany');

const emptyManifest = (now: Date = NOW): Manifest => ({
  publishedIds: [],
  dailyCounter: { date: berlinDateString(now), count: 0 },
});

const countByRegion = (selected: FeedItem[], region: FeedItem['region']) =>
  selected.filter((i) => i.region === region).length;

/** One item for every one of the 16 Bundeslaender, ids prefixed per state. */
const oneItemPerState = (): FeedItem[] =>
  STATE_REGIONS.map((region, i) =>
    item(`st-${region}`, region, new Date(Date.UTC(2026, 7, 21, 9, 0, 0) - i * 1000).toISOString())
  );

describe('selectArticles', () => {
  it('excludes items already in the manifest', () => {
    const manifest = emptyManifest();
    manifest.publishedIds.push('a1');
    const list = [item('a1', 'global', '2026-08-21T09:00:00Z'), item('a2', 'global', '2026-08-21T09:05:00Z')];
    const { selected } = selectArticles(list, manifest, NOW, 20);
    expect(selected.map((i) => i.id)).toEqual(['a2']);
  });

  it('selects nothing when every candidate is already published', () => {
    const manifest: Manifest = {
      publishedIds: ['a1', 'a2', 's1'],
      dailyCounter: { date: '2026-08-21', count: 0 },
    };
    const list = [
      item('a1', 'global', '2026-08-21T09:00:00Z'),
      item('a2', 'germany', '2026-08-21T09:00:00Z'),
      item('s1', 'bayern', '2026-08-21T09:00:00Z'),
    ];
    const { selected, manifest: updated } = selectArticles(list, manifest, NOW, 20);
    expect(selected).toEqual([]);
    expect(updated.dailyCounter.count).toBe(0);
  });

  it('selects nothing and does not crash on an empty items array', () => {
    const { selected, manifest: updated } = selectArticles([], emptyManifest(), NOW, 20);
    expect(selected).toEqual([]);
    expect(updated.publishedIds).toEqual([]);
    expect(updated.dailyCounter).toEqual({
      date: '2026-08-21',
      count: 0,
      byTier: { global: 0, germany: 0, states: 0 },
    });
  });

  it('selects nothing when the daily cap is already exhausted', () => {
    const manifest: Manifest = {
      publishedIds: [],
      dailyCounter: { date: '2026-08-21', count: 20, byTier: { global: 4, germany: 6, states: 10 } },
    };
    const list = [...items('g', 'global', 5), ...items('d', 'germany', 5), ...items('b', 'bayern', 5)];
    const { selected, manifest: updated } = selectArticles(list, manifest, NOW, 20);
    expect(selected).toEqual([]);
    expect(updated.dailyCounter).toEqual({
      date: '2026-08-21',
      count: 20,
      byTier: { global: 4, germany: 6, states: 10 },
    });
  });

  describe('fixed per-tier quotas', () => {
    it('caps global at 4 slots even with plenty of global candidates', () => {
      const { selected } = selectArticles(items('g', 'global', 10), emptyManifest(), NOW, 20);
      expect(countByRegion(selected, 'global')).toBe(4);
      expect(selected).toHaveLength(4);
    });

    it('caps germany at 6 slots and never lets global overflow into them', () => {
      const list = [...items('g', 'global', 10), ...items('d', 'germany', 10)];
      const { selected } = selectArticles(list, emptyManifest(), NOW, 20);
      expect(countByRegion(selected, 'global')).toBe(4);
      expect(countByRegion(selected, 'germany')).toBe(6);
      expect(selected).toHaveLength(10);
    });

    it('reserves at least 10 slots for the states when every tier is full', () => {
      const list = [
        ...items('g', 'global', 10),
        ...items('d', 'germany', 10),
        ...items('bay', 'bayern', 10),
        ...items('nrw', 'nrw', 10),
      ];
      const { selected } = selectArticles(list, emptyManifest(), NOW, 20);
      expect(selected).toHaveLength(20);
      expect(countByRegion(selected, 'global')).toBe(4);
      expect(countByRegion(selected, 'germany')).toBe(6);
      expect(countByRegion(selected, 'bayern') + countByRegion(selected, 'nrw')).toBe(10);
    });

    it('selects most-recent-first within a region', () => {
      const list = [
        item('old', 'global', '2026-08-21T06:00:00Z'),
        item('newest', 'global', '2026-08-21T09:00:00Z'),
        item('middle', 'global', '2026-08-21T08:00:00Z'),
      ];
      const { selected } = selectArticles(list, emptyManifest(), NOW, 20);
      expect(selected.map((i) => i.id)).toEqual(['newest', 'middle', 'old']);
    });
  });

  describe('downward-only spillover', () => {
    it("grows germany's budget with global's unused slots", () => {
      const list = [...items('g', 'global', 2), ...items('d', 'germany', 10)];
      const { selected } = selectArticles(list, emptyManifest(), NOW, 20);
      expect(countByRegion(selected, 'global')).toBe(2);
      // germany's own 6 plus global's 2 unused slots.
      expect(countByRegion(selected, 'germany')).toBe(8);
      expect(selected).toHaveLength(10);
    });

    it("flows global's and germany's unused slots down to the states", () => {
      const list = [...items('d', 'germany', 3), ...items('bay', 'bayern', 30)];
      const { selected } = selectArticles(list, emptyManifest(), NOW, 20);
      expect(countByRegion(selected, 'global')).toBe(0);
      expect(countByRegion(selected, 'germany')).toBe(3);
      // states' own 10 plus global's unused 4 plus germany's unused 7.
      expect(countByRegion(selected, 'bayern')).toBe(17);
      expect(selected).toHaveLength(20);
    });

    it('never spills upward: surplus state items do not take global or germany slots', () => {
      const list = [...items('g', 'global', 1), ...items('d', 'germany', 1), ...items('bay', 'bayern', 50)];
      const { selected } = selectArticles(list, emptyManifest(), NOW, 20);
      expect(countByRegion(selected, 'global')).toBe(1);
      expect(countByRegion(selected, 'germany')).toBe(1);
      expect(countByRegion(selected, 'bayern')).toBe(18);
      expect(selected).toHaveLength(20);
    });

    it('never spills upward: the states’ unused slots do not flow back to germany or global', () => {
      // No state has any candidate, so the states' 10 slots go unused. Global and
      // germany stay pinned at their quotas rather than absorbing the remainder,
      // and the run simply publishes fewer than the cap.
      const list = [...items('g', 'global', 50), ...items('d', 'germany', 50)];
      const { selected } = selectArticles(list, emptyManifest(), NOW, 20);
      expect(countByRegion(selected, 'global')).toBe(4);
      expect(countByRegion(selected, 'germany')).toBe(6);
      expect(selected).toHaveLength(10);
    });
  });

  describe('within-batch dedup', () => {
    it('collapses the same id appearing under two regions, keeping REGION_PRIORITY order', () => {
      // Berlin and Brandenburg are both served by rbb24.de, so the same story can
      // surface twice with an identical sha1 id. Brandenburg is listed first here
      // to prove region priority — not array order — decides the winner.
      const list = [
        item('rbb-shared', 'brandenburg', '2026-08-21T09:00:00Z'),
        item('rbb-shared', 'berlin', '2026-08-21T09:00:00Z'),
      ];
      const { selected, manifest: updated } = selectArticles(list, emptyManifest(), NOW, 20);
      expect(selected).toHaveLength(1);
      expect(selected[0].region).toBe('berlin');
      expect(updated.publishedIds).toEqual(['rbb-shared']);
      expect(updated.dailyCounter.count).toBe(1);
    });

    it('does not let a within-batch duplicate consume two quota slots', () => {
      const list = [
        ...items('g', 'global', 3),
        item('dup', 'global', '2026-08-21T09:30:00Z'),
        item('dup', 'germany', '2026-08-21T09:30:00Z'),
      ];
      const { selected } = selectArticles(list, emptyManifest(), NOW, 20);
      expect(selected.filter((i) => i.id === 'dup')).toHaveLength(1);
      expect(countByRegion(selected, 'global')).toBe(4);
      expect(countByRegion(selected, 'germany')).toBe(0);
    });
  });

  describe('state round-robin', () => {
    it('cycles across states in REGION_PRIORITY order rather than draining one', () => {
      const list = [
        ...items('bay', 'bayern', 3),
        ...items('ber', 'berlin', 3),
        ...items('nrw', 'nrw', 3),
      ];
      const manifest = emptyManifest(ROTATION_ZERO_NOW);
      const { selected } = selectArticles(list, manifest, ROTATION_ZERO_NOW, 20);
      expect(selected.map((i) => i.region)).toEqual([
        'bayern',
        'berlin',
        'nrw',
        'bayern',
        'berlin',
        'nrw',
        'bayern',
        'berlin',
        'nrw',
      ]);
    });

    it('continues the round-robin when one state runs out mid-cycle', () => {
      const list = [...items('bay', 'bayern', 3), ...items('ber', 'berlin', 1), ...items('nrw', 'nrw', 2)];
      const manifest = emptyManifest(ROTATION_ZERO_NOW);
      const { selected } = selectArticles(list, manifest, ROTATION_ZERO_NOW, 20);
      expect(selected.map((i) => i.id)).toEqual(['bay0', 'ber0', 'nrw0', 'bay1', 'nrw1', 'bay2']);
    });

    it('stops the round-robin at the states budget', () => {
      const list = [
        ...items('g', 'global', 4),
        ...items('d', 'germany', 6),
        ...items('bay', 'bayern', 20),
        ...items('ber', 'berlin', 20),
      ];
      const { selected } = selectArticles(list, emptyManifest(), NOW, 20);
      expect(selected).toHaveLength(20);
      expect(countByRegion(selected, 'bayern')).toBe(5);
      expect(countByRegion(selected, 'berlin')).toBe(5);
    });
  });

  it('resets the daily counter on a new Berlin day but keeps dedup history', () => {
    const manifest: Manifest = {
      publishedIds: ['old1'],
      dailyCounter: { date: '2026-08-20', count: 20, byTier: { global: 4, germany: 6, states: 10 } },
    };
    const list = [item('a1', 'global', '2026-08-21T09:00:00Z'), item('old1', 'global', '2026-08-21T09:05:00Z')];
    const { selected, manifest: updated } = selectArticles(list, manifest, NOW, 20);
    expect(selected.map((i) => i.id)).toEqual(['a1']);
    // Both the total and every per-tier counter reset with the new Berlin day.
    expect(updated.dailyCounter).toEqual({
      date: '2026-08-21',
      count: 1,
      byTier: { global: 1, germany: 0, states: 0 },
    });
    expect(updated.publishedIds).toContain('old1');
  });

  it('does not mutate the manifest it is given', () => {
    const manifest: Manifest = {
      publishedIds: ['old1'],
      dailyCounter: { date: '2026-08-21', count: 3, byTier: { global: 1, germany: 1, states: 1 } },
    };
    const snapshot = JSON.parse(JSON.stringify(manifest));
    selectArticles(items('g', 'global', 5), manifest, NOW, 20);
    expect(manifest).toEqual(snapshot);
  });

  describe('per-day (not per-run) tier quotas', () => {
    it('charges each tier against its whole-day quota, not the run’s leftover cap', () => {
      const manifest: Manifest = {
        publishedIds: [],
        dailyCounter: { date: '2026-08-21', count: 10, byTier: { global: 1, germany: 2, states: 7 } },
      };
      const list = [...items('g', 'global', 10), ...items('d', 'germany', 10), ...items('bay', 'bayern', 10)];
      const { selected, manifest: updated } = selectArticles(list, manifest, NOW, 20);
      // 4-1 global, 6-2 germany, 10-7 states still owed today.
      expect(countByRegion(selected, 'global')).toBe(3);
      expect(countByRegion(selected, 'germany')).toBe(4);
      expect(countByRegion(selected, 'bayern')).toBe(3);
      expect(selected).toHaveLength(10);
      expect(updated.dailyCounter).toEqual({
        date: '2026-08-21',
        count: 20,
        byTier: { global: 4, germany: 6, states: 10 },
      });
    });

    it('keeps cumulative global at 4/day across many runs even when early runs are regional-thin', () => {
      // Three runs on one Berlin day. Runs 1-2 have no state candidates at all,
      // so their unused state slots simply go unfilled; run 3 arrives with a
      // heavy global feed. Under a per-run proportional split, run 2 would grant
      // global a fresh quota and push the day's global total past 4.
      let manifest = emptyManifest();
      const perRun: FeedItem[][] = [
        [...items('g1', 'global', 3), ...items('d1', 'germany', 2)],
        [...items('g2', 'global', 10), ...items('d2', 'germany', 10)],
        [
          ...items('g3', 'global', 10),
          ...items('d3', 'germany', 10),
          ...items('bay3', 'bayern', 20),
          ...items('ber3', 'berlin', 20),
        ],
      ];

      const cumulative = { global: 0, germany: 0, states: 0 };
      for (const list of perRun) {
        const result = selectArticles(list, manifest, NOW, 20);
        manifest = result.manifest;
        for (const sel of result.selected) {
          if (sel.region === 'global') cumulative.global += 1;
          else if (sel.region === 'germany') cumulative.germany += 1;
          else cumulative.states += 1;
        }
      }

      expect(cumulative.global).toBe(4);
      expect(cumulative.germany).toBe(6);
      expect(cumulative.states).toBe(10);
      expect(manifest.dailyCounter).toEqual({
        date: '2026-08-21',
        count: 20,
        byTier: { global: 4, germany: 6, states: 10 },
      });
    });

    it('never lets cumulative global exceed 4 no matter how many runs happen', () => {
      let manifest = emptyManifest();
      let globalTotal = 0;
      for (let run = 0; run < 12; run++) {
        const result = selectArticles(items(`g${run}-`, 'global', 10), manifest, NOW, 20);
        manifest = result.manifest;
        globalTotal += countByRegion(result.selected, 'global');
      }
      expect(globalTotal).toBe(4);
      expect(manifest.dailyCounter.byTier).toEqual({ global: 4, germany: 0, states: 0 });
    });

    it('still reserves the states’ 10 daily slots after germany absorbed global’s spillover', () => {
      // Run 1: no global candidates, so global's 4 slots spill to germany, which
      // takes 10. Run 2 has a fat global feed — but global's slots were already
      // spent downward, so the states keep their 10.
      let manifest = emptyManifest();
      const run1 = selectArticles(items('d', 'germany', 20), manifest, NOW, 20);
      manifest = run1.manifest;
      expect(countByRegion(run1.selected, 'germany')).toBe(10);

      const run2 = selectArticles(
        [...items('g2', 'global', 20), ...items('bay2', 'bayern', 20)],
        manifest,
        NOW,
        20
      );
      expect(countByRegion(run2.selected, 'global')).toBe(0);
      expect(countByRegion(run2.selected, 'bayern')).toBe(10);
      expect(run2.manifest.dailyCounter).toEqual({
        date: '2026-08-21',
        count: 20,
        byTier: { global: 0, germany: 10, states: 10 },
      });
    });

    it('treats a manifest with no byTier field as all-zero without crashing', () => {
      // The shape of content/manifest.json before per-day tier tracking existed.
      const legacy = JSON.parse('{"publishedIds":[],"dailyCounter":{"date":"2026-08-21","count":6}}') as Manifest;
      expect(legacy.dailyCounter.byTier).toBeUndefined();

      const list = [...items('g', 'global', 10), ...items('d', 'germany', 10), ...items('bay', 'bayern', 10)];
      const { selected, manifest: updated } = selectArticles(list, legacy, NOW, 20);
      // Unknown history reads as zero, so all three quotas are still fully open;
      // the remaining total cap of 14 is what limits the run.
      expect(countByRegion(selected, 'global')).toBe(4);
      expect(countByRegion(selected, 'germany')).toBe(6);
      expect(countByRegion(selected, 'bayern')).toBe(4);
      expect(updated.dailyCounter).toEqual({
        date: '2026-08-21',
        count: 20,
        byTier: { global: 4, germany: 6, states: 4 },
      });
    });

    it('accepts a partial byTier object without producing NaN budgets', () => {
      const manifest = JSON.parse(
        '{"publishedIds":[],"dailyCounter":{"date":"2026-08-21","count":2,"byTier":{"global":2}}}'
      ) as Manifest;
      const { selected, manifest: updated } = selectArticles(items('g', 'global', 10), manifest, NOW, 20);
      expect(countByRegion(selected, 'global')).toBe(2);
      expect(updated.dailyCounter).toEqual({
        date: '2026-08-21',
        count: 4,
        byTier: { global: 4, germany: 0, states: 0 },
      });
    });
  });

  describe('per-day state round-robin rotation', () => {
    it('starts the round-robin at a different state on a different Berlin day', () => {
      const dayA = new Date('2026-08-16T10:00:00Z'); // offset 0 -> baden-wuerttemberg
      const dayB = new Date('2026-08-21T10:00:00Z'); // offset 5 -> hamburg

      const firstOn = (now: Date) => {
        const { selected } = selectArticles(oneItemPerState(), emptyManifest(now), now, 20);
        return selected[0].region;
      };

      expect(firstOn(dayA)).toBe('baden-wuerttemberg');
      expect(firstOn(dayB)).toBe('hamburg');
      expect(firstOn(dayA)).not.toBe(firstOn(dayB));
    });

    it('gives every one of the 16 states first pick across 16 consecutive days', () => {
      const firsts = new Set<string>();
      for (let day = 16; day <= 31; day++) {
        const now = new Date(`2026-08-${day}T10:00:00Z`);
        const { selected } = selectArticles(oneItemPerState(), emptyManifest(now), now, 20);
        firsts.add(selected[0].region);
      }
      expect(firsts.size).toBe(16);
      expect([...firsts].sort()).toEqual([...STATE_REGIONS].sort());
    });

    it('still cycles through every state, only reordered — nothing is skipped', () => {
      // A single 10-slot states budget can only reach 10 of the 16 states, but
      // the rotation walks the whole cycle from its offset, so over enough days
      // every state with candidates gets picked.
      const seen = new Set<string>();
      for (let day = 16; day <= 31; day++) {
        const now = new Date(`2026-08-${day}T10:00:00Z`);
        const list = [...items('g', 'global', 4), ...items('d', 'germany', 6), ...oneItemPerState()];
        const { selected } = selectArticles(list, emptyManifest(now), now, 20);
        const states = selected.filter((i) => i.region !== 'global' && i.region !== 'germany');
        // The states tier is held to its 10 slots; the picks are 10 distinct
        // states walked consecutively from that day's offset.
        expect(states).toHaveLength(10);
        expect(new Set(states.map((i) => i.region)).size).toBe(10);
        const offset = stateRotationOffset(berlinDateString(now));
        expect(states.map((i) => i.region)).toEqual(
          Array.from({ length: 10 }, (_, i) => STATE_REGIONS[(offset + i) % STATE_REGIONS.length])
        );
        states.forEach((i) => seen.add(i.region));
      }
      expect([...seen].sort()).toEqual([...STATE_REGIONS].sort());
    });

    it('derives a deterministic, in-range offset from the Berlin date string', () => {
      expect(stateRotationOffset('2026-08-16')).toBe(0);
      expect(stateRotationOffset('2026-08-21')).toBe(5);
      expect(stateRotationOffset('2026-08-21')).toBe(stateRotationOffset('2026-08-21'));
      for (let day = 1; day <= 28; day++) {
        const offset = stateRotationOffset(`2026-02-${String(day).padStart(2, '0')}`);
        expect(offset).toBeGreaterThanOrEqual(0);
        expect(offset).toBeLessThan(16);
      }
    });
  });
});
