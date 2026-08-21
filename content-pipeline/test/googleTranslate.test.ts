import { describe, it, expect, vi } from 'vitest';
import { translateTextGoogle } from '../src/googleTranslate';

function mockResponse(body: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 500, json: async () => body } as Response;
}

/** Keeps retry tests instant instead of actually waiting out the backoff. */
const noDelay = vi.fn(async (_ms: number) => {});

describe('translateTextGoogle', () => {
  it('returns null immediately when no API key is configured, without calling fetch', async () => {
    const fetchFn = vi.fn();
    const result = await translateTextGoogle('Hello', 'en', 'de', { fetchFn });
    expect(result).toBeNull();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('returns the translated text on a successful response', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(mockResponse({ data: { translations: [{ translatedText: 'Hallo Welt' }] } }));
    const result = await translateTextGoogle('Hello world', 'en', 'de', { fetchFn, googleApiKey: 'test-key' });
    expect(result).toBe('Hallo Welt');
  });

  it('sends the API key, source, target, and text in the request', async () => {
    const fetchFn = vi.fn().mockResolvedValue(mockResponse({ data: { translations: [{ translatedText: 'ok' }] } }));
    await translateTextGoogle('Hello world', 'en', 'de', { fetchFn, googleApiKey: 'test-key' });

    const [url, init] = fetchFn.mock.calls[0];
    expect(new URL(url as string).searchParams.get('key')).toBe('test-key');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({ q: 'Hello world', source: 'en', target: 'de', format: 'text' });
  });

  it('retries on failure and succeeds on a later attempt', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(mockResponse({}, false))
      .mockResolvedValueOnce(mockResponse({ data: { translations: [{ translatedText: 'Hallo' }] } }));
    const result = await translateTextGoogle('Hello', 'en', 'de', {
      fetchFn,
      googleApiKey: 'test-key',
      maxRetries: 1,
      delayFn: noDelay,
    });
    expect(result).toBe('Hallo');
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('gives up and returns null after exhausting retries', async () => {
    const fetchFn = vi.fn().mockResolvedValue(mockResponse({}, false));
    const result = await translateTextGoogle('Hello', 'en', 'de', {
      fetchFn,
      googleApiKey: 'test-key',
      maxRetries: 1,
      delayFn: noDelay,
    });
    expect(result).toBeNull();
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it('returns null when the response has no translation data', async () => {
    const fetchFn = vi.fn().mockResolvedValue(mockResponse({ data: { translations: [] } }));
    const result = await translateTextGoogle('Hello', 'en', 'de', {
      fetchFn,
      googleApiKey: 'test-key',
      maxRetries: 0,
      delayFn: noDelay,
    });
    expect(result).toBeNull();
  });

  it('passes text through untranslated for empty/whitespace input, without calling fetch', async () => {
    const fetchFn = vi.fn();
    const result = await translateTextGoogle('   ', 'en', 'de', { fetchFn, googleApiKey: 'test-key' });
    expect(result).toBe('   ');
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
