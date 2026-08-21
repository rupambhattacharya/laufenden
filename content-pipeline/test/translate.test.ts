import { describe, it, expect, vi } from 'vitest';
import {
  translateText,
  translateTextViaProviders,
  translateFields,
  truncateToByteLimit,
  backoffDelayMs,
} from '../src/translate';

function mockResponse(body: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 500, json: async () => body } as Response;
}

/** Keeps retry tests instant instead of actually waiting out the backoff. */
const noDelay = vi.fn(async (_ms: number) => {});

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
    const result = await translateText('Hello', 'en', 'de', { fetchFn, maxRetries: 1, delayFn: noDelay });
    expect(result).toBe('Hallo');
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('gives up and returns null after exhausting retries', async () => {
    const fetchFn = vi.fn().mockResolvedValue(mockResponse({}, false));
    const result = await translateText('Hello', 'en', 'de', { fetchFn, maxRetries: 1, delayFn: noDelay });
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

describe('retry backoff', () => {
  it('waits between a failed attempt and the retry', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(mockResponse({}, false))
      .mockResolvedValueOnce(mockResponse({ responseData: { translatedText: 'Hallo' }, responseStatus: 200 }));
    const delayFn = vi.fn(async (_ms: number) => {});

    const result = await translateText('Hello', 'en', 'de', { fetchFn, maxRetries: 1, delayFn });

    expect(result).toBe('Hallo');
    expect(delayFn).toHaveBeenCalledTimes(1);
    // First retry: 1000ms base plus up to 250ms of jitter.
    expect(delayFn.mock.calls[0][0]).toBeGreaterThanOrEqual(1000);
    expect(delayFn.mock.calls[0][0]).toBeLessThan(1250);
  });

  it('does not wait after the final attempt fails', async () => {
    const fetchFn = vi.fn().mockResolvedValue(mockResponse({}, false));
    const delayFn = vi.fn(async (_ms: number) => {});
    await translateText('Hello', 'en', 'de', { fetchFn, maxRetries: 2, delayFn });
    expect(fetchFn).toHaveBeenCalledTimes(3);
    expect(delayFn).toHaveBeenCalledTimes(2);
  });

  it('grows the delay exponentially and caps it at 4s', () => {
    expect(backoffDelayMs(0)).toBeGreaterThanOrEqual(1000);
    expect(backoffDelayMs(0)).toBeLessThan(1250);
    expect(backoffDelayMs(1)).toBeGreaterThanOrEqual(2000);
    expect(backoffDelayMs(1)).toBeLessThan(2250);
    expect(backoffDelayMs(5)).toBeGreaterThanOrEqual(4000);
    expect(backoffDelayMs(5)).toBeLessThan(4250);
  });
});

describe('query length guard', () => {
  const queryOf = (fetchFn: ReturnType<typeof vi.fn>): string => {
    const url = new URL(fetchFn.mock.calls[0][0] as string);
    return url.searchParams.get('q') ?? '';
  };

  it('truncates a >450-byte input at a word boundary before sending it', async () => {
    const long = Array.from({ length: 120 }, (_, i) => `word${i}`).join(' ');
    expect(new TextEncoder().encode(long).length).toBeGreaterThan(450);

    const fetchFn = vi
      .fn()
      .mockResolvedValue(mockResponse({ responseData: { translatedText: 'ok' }, responseStatus: 200 }));
    await translateText(long, 'en', 'de', { fetchFn });

    const sent = queryOf(fetchFn);
    expect(new TextEncoder().encode(sent).length).toBeLessThanOrEqual(450);
    expect(sent.length).toBeLessThan(long.length);
    expect(long.startsWith(sent)).toBe(true);
    // Cut at a word boundary, so the last word sent is intact.
    expect(long.split(' ')).toContain(sent.split(' ').at(-1));
  });

  it('sends short text through untouched', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(mockResponse({ responseData: { translatedText: 'ok' }, responseStatus: 200 }));
    await translateText('Hello world', 'en', 'de', { fetchFn });
    expect(queryOf(fetchFn)).toBe('Hello world');
  });

  it('counts bytes rather than characters for multi-byte text', () => {
    // Each 'ä' is 2 bytes in UTF-8, so 300 chars is 600 bytes.
    const umlauts = Array.from({ length: 100 }, () => 'äää').join(' ');
    const truncated = truncateToByteLimit(umlauts);
    expect(new TextEncoder().encode(truncated).length).toBeLessThanOrEqual(450);
    expect(truncated.endsWith('äää')).toBe(true);
  });

  it('falls back to a hard cut when there is no word boundary to cut at', () => {
    const unbroken = 'a'.repeat(600);
    expect(truncateToByteLimit(unbroken)).toHaveLength(450);
  });
});

describe('translateTextViaProviders', () => {
  it('returns the MyMemory result when it succeeds, without trying Google', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(mockResponse({ responseData: { translatedText: 'Hallo' }, responseStatus: 200 }));
    const result = await translateTextViaProviders('Hello', 'en', 'de', { fetchFn, googleApiKey: 'test-key' });
    expect(result).toBe('Hallo');
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('falls back to Google when MyMemory fails', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(mockResponse({}, false))
      .mockResolvedValueOnce(mockResponse({ data: { translations: [{ translatedText: 'Hallo (Google)' }] } }));
    const result = await translateTextViaProviders('Hello', 'en', 'de', {
      fetchFn,
      googleApiKey: 'test-key',
      maxRetries: 0,
      delayFn: noDelay,
    });
    expect(result).toBe('Hallo (Google)');
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('returns null when both providers fail', async () => {
    const fetchFn = vi.fn().mockResolvedValue(mockResponse({}, false));
    const result = await translateTextViaProviders('Hello', 'en', 'de', {
      fetchFn,
      googleApiKey: 'test-key',
      maxRetries: 0,
      delayFn: noDelay,
    });
    expect(result).toBeNull();
  });

  it('returns null without attempting Google when no googleApiKey is configured', async () => {
    const fetchFn = vi.fn().mockResolvedValue(mockResponse({}, false));
    const result = await translateTextViaProviders('Hello', 'en', 'de', { fetchFn, maxRetries: 0, delayFn: noDelay });
    expect(result).toBeNull();
    expect(fetchFn).toHaveBeenCalledTimes(1);
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

  it('omits a language entirely if either field fails to translate on both providers', async () => {
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

  it('falls back to Google for a language when MyMemory fails for it', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(mockResponse({}, false))
      .mockResolvedValueOnce(mockResponse({}, false))
      .mockResolvedValueOnce(mockResponse({ data: { translations: [{ translatedText: 'Titel (Google)' }] } }))
      .mockResolvedValueOnce(
        mockResponse({ data: { translations: [{ translatedText: 'Zusammenfassung (Google)' }] } })
      );
    const result = await translateFields({ title: 'Hello', summary: 'World' }, 'en', ['de'], {
      fetchFn,
      googleApiKey: 'test-key',
      maxRetries: 0,
      delayFn: noDelay,
    });
    expect(result.de).toEqual({ title: 'Titel (Google)', summary: 'Zusammenfassung (Google)' });
  });
});
