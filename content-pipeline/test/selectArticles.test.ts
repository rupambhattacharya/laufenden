import { describe, it, expect } from 'vitest';
import { selectArticles, berlinDateString } from '../src/selectArticles';
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

const emptyManifest = (): Manifest => ({
  publishedIds: [],
  dailyCounter: { date: berlinDateString(NOW), count: 0 },
});

const countByRegion = (selected: FeedItem[], region: FeedItem['region']) =>
  selected.filter((i) => i.region === region).length;

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
    expect(updated.dailyCounter).toEqual({ date: '2026-08-21', count: 0 });
  });

  it('selects nothing when the daily cap is already exhausted', () => {
    const manifest: Manifest = {
      publishedIds: [],
      dailyCounter: { date: '2026-08-21', count: 20 },
    };
    const list = [...items('g', 'global', 5), ...items('d', 'germany', 5), ...items('b', 'bayern', 5)];
    const { selected, manifest: updated } = selectArticles(list, manifest, NOW, 20);
    expect(selected).toEqual([]);
    expect(updated.dailyCounter).toEqual({ date: '2026-08-21', count: 20 });
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
      const { selected } = selectArticles(list, emptyManifest(), NOW, 20);
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
      const { selected } = selectArticles(list, emptyManifest(), NOW, 20);
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
      dailyCounter: { date: '2026-08-20', count: 20 },
    };
    const list = [item('a1', 'global', '2026-08-21T09:00:00Z'), item('old1', 'global', '2026-08-21T09:05:00Z')];
    const { selected, manifest: updated } = selectArticles(list, manifest, NOW, 20);
    expect(selected.map((i) => i.id)).toEqual(['a1']);
    expect(updated.dailyCounter).toEqual({ date: '2026-08-21', count: 1 });
    expect(updated.publishedIds).toContain('old1');
  });

  it('scales the tier budgets down when part of the daily cap is already spent', () => {
    const manifest: Manifest = {
      publishedIds: [],
      dailyCounter: { date: '2026-08-21', count: 10 },
    };
    const list = [...items('g', 'global', 10), ...items('d', 'germany', 10), ...items('bay', 'bayern', 10)];
    const { selected, manifest: updated } = selectArticles(list, manifest, NOW, 20);
    expect(selected).toHaveLength(10);
    expect(countByRegion(selected, 'global')).toBe(2);
    expect(countByRegion(selected, 'germany')).toBe(3);
    expect(countByRegion(selected, 'bayern')).toBe(5);
    expect(updated.dailyCounter).toEqual({ date: '2026-08-21', count: 20 });
  });

  it('does not mutate the manifest it is given', () => {
    const manifest: Manifest = {
      publishedIds: ['old1'],
      dailyCounter: { date: '2026-08-21', count: 3 },
    };
    const snapshot = JSON.parse(JSON.stringify(manifest));
    selectArticles(items('g', 'global', 5), manifest, NOW, 20);
    expect(manifest).toEqual(snapshot);
  });
});
