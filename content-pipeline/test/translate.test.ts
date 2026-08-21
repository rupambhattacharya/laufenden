import { describe, it, expect, vi } from 'vitest';
import { translateText, translateFields } from '../src/translate';

function mockResponse(body: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 500, json: async () => body } as Response;
}

describe('translateText', () => {
  it('returns the translated text on a successful response', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(mockResponse({ responseData: { translatedText: 'Hallo Welt' }, responseStatus: 200 }));
    const result = await translateText('Hello world', 'en', 'de', { fetchFn });
    expect(result).toBe('Hallo Welt');
  });

  it('returns null when MyMemory reports a non-200 responseStatus even on HTTP 200', async () => {
    const fetchFn = vi.fn().mockResolvedValue(
      mockResponse({
        responseData: { translatedText: "'XX' IS AN INVALID TARGET LANGUAGE" },
        responseStatus: '403',
        responseDetails: 'invalid language',
      })
    );
    const result = await translateText('Hello world', 'en', 'xx', { fetchFn, maxRetries: 0 });
    expect(result).toBeNull();
  });

  it('retries on failure and succeeds on a later attempt', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(mockResponse({}, false))
      .mockResolvedValueOnce(mockResponse({ responseData: { translatedText: 'Hallo' }, responseStatus: 200 }));
    const result = await translateText('Hello', 'en', 'de', { fetchFn, maxRetries: 1 });
    expect(result).toBe('Hallo');
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('gives up and returns null after exhausting retries', async () => {
    const fetchFn = vi.fn().mockResolvedValue(mockResponse({}, false));
    const result = await translateText('Hello', 'en', 'de', { fetchFn, maxRetries: 1 });
    expect(result).toBeNull();
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('passes text through untranslated for empty/whitespace input, without calling fetch', async () => {
    const fetchFn = vi.fn();
    const result = await translateText('   ', 'en', 'de', { fetchFn });
    expect(result).toBe('   ');
    expect(fetchFn).not.toHaveBeenCalled();
  });
});

describe('translateFields', () => {
  it('copies fields directly for the source language and translates the rest', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(mockResponse({ responseData: { translatedText: 'Hallo' }, responseStatus: 200 }));
    const result = await translateFields({ title: 'Hello', summary: 'World' }, 'en', ['en', 'de'], { fetchFn });
    expect(result.en).toEqual({ title: 'Hello', summary: 'World' });
    expect(result.de).toEqual({ title: 'Hallo', summary: 'Hallo' });
  });

  it('omits a language entirely if either field fails to translate', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(mockResponse({ responseData: { translatedText: 'Hallo' }, responseStatus: 200 }))
      .mockResolvedValueOnce(mockResponse({}, false));
    const result = await translateFields({ title: 'Hello', summary: 'World' }, 'en', ['de'], {
      fetchFn,
      maxRetries: 0,
    });
    expect(result.de).toBeUndefined();
  });
});
