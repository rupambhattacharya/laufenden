# laufenden

A multilingual German news site — global, national, and regional (all 16
Bundesländer) news, in English, German, Turkish, Ukrainian, Hindi, Bengali,
Polish, Spanish, and French. See `docs/superpowers/specs/2026-08-21-laufenden-news-platform-design.md`
for the full design.

## Content pipeline

`npm run fetch-news` fetches configured RSS feeds (`content/feeds.json`),
selects up to 20 new articles/day, translates each into 9 languages via the
free MyMemory API, and writes them to `content/articles/YYYY-MM-DD/`.

Selection uses fixed per-tier quotas rather than strict priority: ≤4 slots to
Global, ≤6 to Germany-national, and the remaining ≥10 round-robined across
the 16 Bundesländer (most-recent-first within each). Unused quota spills
downward only, so a quiet global day gives national/regional more room while
a heavy global day never crowds them out. Articles are dedup'd against
`content/manifest.json` and within each run's own batch, so two feeds serving
the same story (rbb covers both Berlin and Brandenburg) publish it once.

Optional environment variable: `MYMEMORY_EMAIL` — registering an email with
MyMemory raises its free daily quota from 5,000 to 50,000 words. Set it as a
repository secret (`Settings → Secrets and variables → Actions`) named
`MYMEMORY_EMAIL` to have the scheduled workflow use it.

**Known gap:** Saarland has no configured feed yet — no working public
text-news RSS feed for it was found. Add one to `content/feeds.json` with
`"region": "saarland"` whenever a suitable feed is identified; no code
changes are needed.

## Local development

```bash
npm install
npm test          # run the pipeline's unit + integration tests
npm run fetch-news # run the pipeline once against the real feeds
```

## Automated fetching

`.github/workflows/fetch-news.yml` runs the pipeline every 2 hours and
commits any new articles directly to `main`, which triggers a Vercel deploy
(once Vercel is connected to this repo).
