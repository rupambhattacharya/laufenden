export interface TranslateOptions {
  email?: string;
  fetchFn?: typeof fetch;
  maxRetries?: number;
}

interface MyMemoryResponse {
  responseData?: { translatedText?: string };
  responseStatus?: number | string;
  responseDetails?: string;
}

export async function translateText(
  text: string,
  sourceLang: string,
  targetLang: string,
  options: TranslateOptions = {}
): Promise<string | null> {
  if (!text.trim()) return text;
  const { email, fetchFn = fetch, maxRetries = 2 } = options;

  const params = new URLSearchParams({ q: text, langpair: `${sourceLang}|${targetLang}` });
  if (email) params.set('de', email);
  const url = `https://api.mymemory.translated.net/get?${params.toString()}`;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetchFn(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as MyMemoryResponse;
      const status = Number(data.responseStatus);
      const translated = data.responseData?.translatedText;
      if (status !== 200 || typeof translated !== 'string' || !translated) {
        throw new Error(`MyMemory error (status=${data.responseStatus}): ${data.responseDetails ?? 'unknown'}`);
      }
      return translated;
    } catch (err) {
      if (attempt === maxRetries) {
        console.error(`[translateText] giving up on ${sourceLang}->${targetLang}: ${(err as Error).message}`);
        return null;
      }
    }
  }
  return null;
}

export async function translateFields(
  fields: { title: string; summary: string },
  sourceLang: string,
  targetLangs: readonly string[],
  options: TranslateOptions = {}
): Promise<Partial<Record<string, { title: string; summary: string }>>> {
  const result: Partial<Record<string, { title: string; summary: string }>> = {};
  for (const lang of targetLangs) {
    if (lang === sourceLang) {
      result[lang] = fields;
      continue;
    }
    const [title, summary] = await Promise.all([
      translateText(fields.title, sourceLang, lang, options),
      translateText(fields.summary, sourceLang, lang, options),
    ]);
    if (title !== null && summary !== null) {
      result[lang] = { title, summary };
    }
  }
  return result;
}
