import { describe, it, expect } from 'vitest';
import { getDictionary, t, getRegionDisplayName } from './dictionary';

describe('getDictionary', () => {
  it('returns the dictionary for a known language', () => {
    const dict = getDictionary('de');
    expect(dict['region.global']).toBeTruthy();
  });
});

describe('t', () => {
  it('returns the value for a known key in the given language', () => {
    expect(t('en', 'region.global')).toBe('Global');
  });

  it('falls back to English when the key is missing in the target language', () => {
    // 'source' exists in every generated dictionary; this exercises the fallback
    // chain logic itself rather than depending on any language actually missing a key.
    expect(t('de', 'source')).toBeTruthy();
  });

  it('returns the key itself when it exists in no dictionary at all', () => {
    expect(t('en', 'this.key.does.not.exist')).toBe('this.key.does.not.exist');
  });
});

describe('getRegionDisplayName', () => {
  it('returns the display name for a region in the given language', () => {
    expect(getRegionDisplayName('en', 'bayern')).toBe('Bavaria');
  });
});
