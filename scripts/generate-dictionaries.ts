import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { translateTextViaProviders } from '../content-pipeline/src/translate';
import type { TranslateOptions } from '../content-pipeline/src/translate';
import { LANGUAGES } from '../shared/languages';

const DEFAULT_DICTIONARIES_DIR = path.join(process.cwd(), 'shared', 'dictionaries');

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function generateDictionary(
  base: Record<string, string>,
  targetLang: string,
  options: TranslateOptions = {},
  requestDelayMs = 600
): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  let first = true;
  for (const [key, value] of Object.entries(base)) {
    if (!first) await delay(requestDelayMs);
    first = false;
    const translated = await translateTextViaProviders(value, 'en', targetLang, options);
    result[key] = translated ?? value;
  }
  return result;
}

export async function generateAllDictionaries(dictionariesDir: string = DEFAULT_DICTIONARIES_DIR): Promise<void> {
  const baseRaw = await readFile(path.join(dictionariesDir, 'en.json'), 'utf-8');
  const base = JSON.parse(baseRaw) as Record<string, string>;
  const email = process.env.MYMEMORY_EMAIL;
  const googleApiKey = process.env.GOOGLE_TRANSLATE_API_KEY;
  const targets = LANGUAGES.filter((lang) => lang !== 'en');

  let first = true;
  for (const lang of targets) {
    if (!first) await delay(1500);
    first = false;
    const dict = await generateDictionary(base, lang, { email, googleApiKey });
    await writeFile(path.join(dictionariesDir, `${lang}.json`), `${JSON.stringify(dict, null, 2)}\n`, 'utf-8');
    console.log(`Wrote ${lang}.json`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  generateAllDictionaries().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
