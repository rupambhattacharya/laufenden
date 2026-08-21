# laufenden

A multilingual German news site — global, national, and regional (all 16
Bundesländer) news, in English, German, Turkish, Ukrainian, Hindi, Bengali,
Polish, Spanish, and French. See `docs/superpowers/specs/2026-08-21-laufenden-news-platform-design.md`
for the full design.

## Content pipeline

`npm run fetch-news` fetches configured RSS feeds (`content/feeds.json`),
selects up to 20 new articles/day, translates each into 9 languages via the
free MyMemory API, and writes them to `content/articles/YYYY-MM-DD/`.

Selection uses fixed per-tier quotas rather than strict priority, tracked
**across the whole Berlin calendar day** (not just within one run — the
pipeline runs every 2 hours, so this holds even across several runs):
≤4 articles/day to Global from its own quota, ≤6/day to Germany-national
from its own quota, and the remaining ≥10/day round-robined across the 16
Bundesländer, with the round-robin's starting state rotating daily so the
same states aren't always last in line. Unused quota spills downward only
(Global → Germany-national → states, never upward), so Germany-national or
the states tier can exceed their own quota on a quiet Global day — the
Global↔rest split is a hard ceiling, the Germany-national/states split
absorbs spillover. Articles are dedup'd against `content/manifest.json`
across runs and within each run's own batch, so two feeds serving the same
story (rbb covers both Berlin and Brandenburg) publish it once.

Translation tries **MyMemory first, falling back to Google Cloud Translate**
when MyMemory fails for a given request (rate-limited, quota-exhausted, or
erroring) — MyMemory stays primary since it needs no billing account, Google
just fills the gaps. Environment variables, both optional but recommended:
`MYMEMORY_EMAIL` (registering an email with MyMemory raises its free daily
quota from 5,000 to 50,000 words) and `GOOGLE_TRANSLATE_API_KEY` (a Google
Cloud Translation API key — Basic/v2, 500,000 free characters/month). Set
both as repository secrets (`Settings → Secrets and variables → Actions`) to
have the scheduled workflow use them.

**Known gap:** Saarland has no configured feed yet — no working public
text-news RSS feed for it was found. Add one to `content/feeds.json` with
`"region": "saarland"` whenever a suitable feed is identified; no code
changes are needed.

## Frontend

Next.js (App Router) reads `content/articles/**/*.json` directly at build
time — no database, no API route. Routes: `/[lang]` (home), `/[lang]/[region]`
(category listing), `/[lang]/[region]/[slug]` (article). `lang` is one of the
9 supported language codes; `region` is `global`, `germany`, or one of the 16
Bundesländer slugs. Visual system: "Classic Editorial" (Playfair Display
headlines, Lora deck text, Inter body/UI, masthead red `#b3121b` as the sole
accent), built as Tailwind CSS v4 `@theme` tokens in `app/globals.css`.

The UI chrome (nav labels, region names, a handful of fixed strings) lives in
`shared/dictionaries/{lang}.json`, generated from `shared/dictionaries/en.json`
via `npm run generate-dictionaries` (reuses the content pipeline's MyMemory
→ Google Translate fallback). Re-run it whenever `en.json` changes; the 8
generated files are committed to the repo, not regenerated automatically.

### Deploying to Vercel

1. In the Vercel dashboard, "Add New Project" and import this GitHub repo.
2. Vercel auto-detects Next.js — no build configuration is needed.
3. Every push to `master` (including the automated `content:` commits from
   `.github/workflows/fetch-news.yml`) triggers a new deploy, so the site's
   static pages stay in sync with newly fetched articles.

## Local development

```bash
npm install
npm test                      # run all unit + integration tests
npm run fetch-news             # run the content pipeline once against the real feeds
npm run generate-dictionaries  # regenerate the UI chrome dictionary (only needed after editing en.json)
npm run dev                    # start the Next.js dev server at localhost:3000
npm run build                  # production build (also used by Vercel)
```

## Automated fetching

`.github/workflows/fetch-news.yml` runs the pipeline every 2 hours and
commits any new articles directly to `master` (this repo's default branch),
which triggers a Vercel deploy (once Vercel is connected to this repo).
