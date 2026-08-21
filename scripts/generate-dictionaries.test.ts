import { describe, it, expect, vi } from 'vitest';
import { generateDictionary } from './generate-dictionaries';

function mockResponse(body: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 500, json: async () => body } as Response;
}

describe('generateDictionary', () => {
  it('translates every value in the base dictionary into the target language', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(mockResponse({ responseData: { translatedText: 'Übersetzt' }, responseStatus: 200 }));
    const result = await generateDictionary({ a: 'Hello', b: 'World' }, 'de', { fetchFn }, 0);
    expect(result).toEqual({ a: 'Übersetzt', b: 'Übersetzt' });
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('falls back to the original value when translation fails', async () => {
    const fetchFn = vi.fn().mockResolvedValue(mockResponse({}, false));
    const result = await generateDictionary({ a: 'Hello' }, 'de', { fetchFn, maxRetries: 0 }, 0);
    expect(result).toEqual({ a: 'Hello' });
  });
});
