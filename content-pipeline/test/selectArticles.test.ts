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

const emptyManifest = (): Manifest => ({
  publishedIds: [],
  dailyCounter: { date: berlinDateString(new Date('2026-08-21T10:00:00Z')), count: 0 },
});

describe('selectArticles', () => {
  it('excludes items already in the manifest', () => {
    const manifest = emptyManifest();
    manifest.publishedIds.push('a1');
    const items = [item('a1', 'global', '2026-08-21T09:00:00Z'), item('a2', 'global', '2026-08-21T09:05:00Z')];
    const { selected } = selectArticles(items, manifest, new Date('2026-08-21T10:00:00Z'), 20);
    expect(selected.map((i) => i.id)).toEqual(['a2']);
  });

  it('enforces the daily cap and exhausts higher-priority tiers first', () => {
    const manifest = emptyManifest();
    const items = Array.from({ length: 5 }, (_, i) => item(`g${i}`, 'global', `2026-08-21T0${i}:00:00Z`)).concat([
      item('s1', 'bayern', '2026-08-21T09:00:00Z'),
    ]);
    const { selected } = selectArticles(items, manifest, new Date('2026-08-21T10:00:00Z'), 3);
    expect(selected).toHaveLength(3);
    expect(selected.every((i) => i.region === 'global')).toBe(true);
  });

  it('round-robins across states once global and germany are exhausted', () => {
    const manifest = emptyManifest();
    const items = [
      item('g1', 'global', '2026-08-21T09:00:00Z'),
      item('bay1', 'bayern', '2026-08-21T08:00:00Z'),
      item('bay2', 'bayern', '2026-08-21T07:00:00Z'),
      item('nrw1', 'nrw', '2026-08-21T08:30:00Z'),
      item('berlin1', 'berlin', '2026-08-21T08:15:00Z'),
    ];
    const { selected } = selectArticles(items, manifest, new Date('2026-08-21T10:00:00Z'), 4);
    const regions = selected.map((i) => i.region);
    expect(regions[0]).toBe('global');
    expect(new Set(regions.slice(1))).toEqual(new Set(['bayern', 'nrw', 'berlin']));
  });

  it('resets the daily counter on a new Berlin day but keeps dedup history', () => {
    const manifest: Manifest = {
      publishedIds: ['old1'],
      dailyCounter: { date: '2026-08-20', count: 20 },
    };
    const items = [item('a1', 'global', '2026-08-21T09:00:00Z'), item('old1', 'global', '2026-08-21T09:05:00Z')];
    const { selected, manifest: updated } = selectArticles(items, manifest, new Date('2026-08-21T10:00:00Z'), 20);
    expect(selected.map((i) => i.id)).toEqual(['a1']);
    expect(updated.dailyCounter).toEqual({ date: '2026-08-21', count: 1 });
    expect(updated.publishedIds).toContain('old1');
  });
});
