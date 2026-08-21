import { describe, it, expect } from 'vitest';
import { computeId } from '../src/id';

describe('computeId', () => {
  it('produces the same hash for the same input', () => {
    expect(computeId('https://example.com/a')).toBe(computeId('https://example.com/a'));
  });

  it('produces different hashes for different input', () => {
    expect(computeId('https://example.com/a')).not.toBe(computeId('https://example.com/b'));
  });

  it('produces a 40-character hex sha1 digest', () => {
    expect(computeId('anything')).toMatch(/^[a-f0-9]{40}$/);
  });
});
