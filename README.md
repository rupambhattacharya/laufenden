# laufenden

A multilingual German news site — global, national, and regional (all 16
Bundesländer) news, in English, German, Hindi, Bengali, and French. See
`docs/superpowers/specs/2026-08-21-laufenden-news-platform-design.md`
for the full design.

## Content pipeline

`npm run fetch-news` fetches configured RSS feeds (`content/feeds.json`),
selects up to 20 new articles/day, translates each into 5 languages via the
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

Translation uses **MyMemory only** — a Google Cloud Translate fallback was
tried and deliberately removed in favor of cutting the language count from
9 to 5, which roughly halves MyMemory traffic per article and avoids a
second provider's billing/setup complexity. Optional environment variable:
`MYMEMORY_EMAIL` — registering an email with MyMemory raises its free daily
quota from 5,000 to 50,000 words. Set it as a repository secret (`Settings →
Secrets and variables → Actions`) named `MYMEMORY_EMAIL` to have the
scheduled workflow use it.

Saarland is the one state not served by its own broadcaster's feed: SR
exposes no public text-news RSS, so its entry uses tagesschau.de's regional
Saarland feed (ARD-aktuell), which carries SR's reporting. Stories that also
run in the national tagesschau feed share guids with it and dedupe into the
Germany tier.

## Frontend

Next.js (App Router) reads `content/articles/**/*.json` directly at build
time — no database, no API route. Routes: `/[lang]` (home), `/[lang]/[region]`
(category listing), `/[lang]/[region]/[slug]` (article). `lang` is one of the
5 supported language codes (`en`, `de`, `hi`, `bn`, `fr`); `region` is
`global`, `germany`, or one of the 16 Bundesländer slugs. Visual system:
"Classic Editorial" (Playfair Display headlines, Lora deck text, Inter
body/UI, masthead red `#b3121b` as the sole accent), built as Tailwind CSS
v4 `@theme` tokens in `app/globals.css`.

Listings (home page sections, region pages) only show articles that have a
real translation for the language being viewed — an article missing a
translation for that language simply doesn't appear there. A direct link to
that article's own page still works, showing the original-language text
with a "Translation unavailable" note instead of 404ing.

The UI chrome (nav labels, region names, a handful of fixed strings) lives in
`shared/dictionaries/{lang}.json`, generated from `shared/dictionaries/en.json`
via `npm run generate-dictionaries` (reuses the content pipeline's MyMemory
wrapper). Re-run it whenever `en.json` changes; the 4 generated files are
committed to the repo, not regenerated automatically.

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
