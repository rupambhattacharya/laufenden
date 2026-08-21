# laufenden — Multilingual German News Platform

Design spec. Status: approved by user 2026-08-21.

## Purpose

A news website covering Germany — global headlines, German-national news, and
regional news for all 16 Bundesländer — published in 5 languages. Sourced
entirely from freely available RSS feeds (summaries + attribution links, not
full-text scraping), translated with a free translation API, and published as
a static Next.js site on Vercel.

## Goals

- ~20 new articles/day, aggregated from public RSS feeds.
- Coverage across three tiers: Global, Germany-national, and each of the 16
  Bundesländer (Bayern, NRW, Berlin, etc.), prioritized in that order so
  quiet regions don't force filler content.
- Every article available in 5 languages: English, German, Hindi, Bengali,
  French. (Reduced from an original 9 — Turkish, Ukrainian, Polish, and
  Spanish were dropped to cut MyMemory translation volume roughly in half,
  reducing how often its free-tier rate limit is hit.)
- Fully automated pipeline — no manual review/approval step.
- Runs on free-tier infrastructure end to end (GitHub Actions, MyMemory
  translation API, Vercel hosting).

## Non-goals

- No full-text article scraping or republishing — only the title + summary a
  publisher already exposes via RSS, plus a visible attribution link back to
  the original source.
- No user accounts, comments, or personalization.
- No manual moderation/approval queue.
- No paid translation or hosting tiers at launch.

## Content sourcing

RSS feeds only, configured per category/region:

- **Global**: wire-style/international outlets with public RSS (e.g.
  Reuters, AP, BBC world feeds).
- **Germany-national**: public broadcaster and major outlet feeds (e.g.
  Tagesschau).
- **Per-Bundesland (16)**: each state's public broadcaster or major regional
  outlet feed (e.g. BR for Bayern, WDR for NRW, rbb for Berlin/Brandenburg).

Feed URLs live in a single config file (e.g. `content-pipeline/feeds.json`)
mapping `category/region → [feed URLs]`, so adding/adjusting sources doesn't
require touching pipeline logic.

Only the summary/snippet the feed itself provides is stored and translated —
never fetched full-page content — keeping this squarely within how RSS is
intended to be consumed and redistributed.

## Article volume & allocation

- Hard cap: **20 new articles/day total**, counted in Europe/Berlin time
  (reset at Berlin midnight).
- **Fixed per-tier quotas, not strict priority-drain:** ≤4 slots to Global,
  ≤6 to Germany-national, and the remaining ≥10 slots round-robined across
  the 16 Bundesländer (most-recent-first within each state, cycling through
  states with new items so no single state's volume crowds out the others).
  An amendment from the original design: strict Global → Germany-national →
  Bundesländer priority-drain was found (during implementation) to let
  Global's typically-higher item volume consume the entire daily cap before
  Germany-national or any state was ever considered — defeating the site's
  core premise of German/regional coverage. Fixed quotas guarantee every
  tier is represented daily regardless of relative feed volume.
  - Unused quota spills **downward only** (Global's unused slots go to
    Germany-national, Germany-national's unused slots go to the states;
    never upward) — a quiet global-news day lets national/regional fill
    more of the cap, but a heavy global-news day never crowds out national
    or regional.
- Dedup by feed item GUID/link against a manifest of already-published
  articles, so re-running the pipeline never double-publishes. Dedup must
  apply **within a single run's candidate batch**, not only against
  already-published history — two feed configs that happen to point at the
  same underlying feed (e.g. Berlin and Brandenburg both served by rbb)
  must not have the same story counted/published twice in one run.

## Translation

- **MyMemory API only** (free, no signup required for low volume; registered
  email raises the cap to 50,000 words/day). A Google Cloud Translate
  fallback (used only when MyMemory failed a request) was implemented and
  then deliberately removed — reducing from 9 to 5 target languages cuts
  MyMemory traffic per article roughly in half instead, avoiding a second
  provider's setup/billing complexity. Do not re-add a second provider
  without discussing it first; this was a considered choice, not an
  oversight.
- Translate `title` and `summary` fields only, into all 5 target languages,
  per selected article.
- Estimated load: 20 articles × 5 languages × ~2 short fields — well under
  the 50,000 words/day cap at this article volume.
- If translation fails for a given language after retries, the article still
  publishes; that language's field is simply omitted. **Listings** (home
  page sections, region pages) only show articles that have a real
  translation for the language being viewed — an article missing a
  translation simply doesn't appear there, rather than appearing with
  fallback text. A **direct link** to that article's own page still works,
  showing the original-language text with a "translation unavailable" note
  rather than 404ing. Neither case blocks the rest of the batch.

## Architecture

```
GitHub Actions (cron)          Vercel
─────────────────────         ─────────────────────
1. Fetch RSS feeds
2. Dedup + select (≤20/day)
3. Translate (5 languages)
4. Write JSON to content/
5. git commit + push    ───▶  auto-deploy triggered
                               Next.js builds static
                               pages from committed JSON
```

The content pipeline and the website are decoupled: the pipeline's only
interface with the frontend is the JSON files it commits into the repo.
Vercel's existing GitHub integration handles deployment automatically on
push — no Vercel Cron, no server-side database, no runtime API calls to
translation services from the deployed site.

### Why GitHub Actions instead of Vercel Cron

Content is git-backed by design (gives a free full history of everything
published, and keeps the frontend a pure static build). A Vercel Cron
function would need its own GitHub write credentials to commit back to the
repo, which is more moving parts than just running the whole pipeline as a
GitHub Actions workflow that already has repo write access natively.

## Content storage layout

```
content/
  feeds.json                          # category/region → RSS feed URLs
  manifest.json                       # published article IDs (dedup) + daily counter state
  articles/
    2026-08-21/
      <slug>.json
      <slug>.json
    2026-08-22/
      ...
```

### Article JSON schema

```json
{
  "id": "sha1-of-feed-guid",
  "slug": "kebab-case-title-en",
  "category": "global | germany | bayern | nrw | ... (16 states)",
  "sourceName": "Tagesschau",
  "sourceUrl": "https://...",
  "publishedAt": "2026-08-21T09:00:00+02:00",
  "originalLanguage": "de",
  "translations": {
    "en": { "title": "...", "summary": "..." },
    "de": { "title": "...", "summary": "..." },
    "tr": { "title": "...", "summary": "..." },
    "uk": { "title": "...", "summary": "..." },
    "hi": { "title": "...", "summary": "..." },
    "bn": { "title": "...", "summary": "..." },
    "pl": { "title": "...", "summary": "..." },
    "es": { "title": "...", "summary": "..." },
    "fr": { "title": "...", "summary": "..." }
  }
}
```

A language key is simply absent if translation failed for that article/language.

## Frontend (Next.js on Vercel)

- App Router, TypeScript, Tailwind CSS, static generation — pages are built
  from the committed JSON at deploy time (no database, no runtime API).
- **Scaffolding note:** Next.js and Tailwind are added into the *existing*
  `package.json`/`tsconfig.json` (which already serve the content
  pipeline's Vitest setup) — not generated fresh via `create-next-app` into
  an empty directory. The pipeline's tests and scripts must keep working
  unchanged.
- **Routing**: language-prefixed — `/[lang]` (home), `/[lang]/[region]`
  (category/state listing, `region` ∈ `global | germany | <16 states>`),
  `/[lang]/[region]/[slug]` (article). `lang` ∈ `en | de | hi | bn | fr`.
  Root `/` redirects to `/en`. An invalid `lang` or `region` segment 404s.
  A language switcher swaps only the `lang` segment, preserving the rest
  of the current path.
- **Home page**: three labeled sections — Global, Germany, Regional
  highlights (most recent regional articles across all states mixed
  together, not one slot per state) — each showing its most recent
  articles for the active language, **only counting articles that have a
  real translation for that language** (see the listings-vs-direct-link
  rule under Translation, above).
- **Category/region page**: most-recent-first listing for that
  region+language, filtered to articles with a real translation for that
  language (same rule). No pagination in v1 (article volume doesn't
  warrant it yet; add it later if it does) — cap the listing at the 100
  most recent (translated) articles for that region+language.
- **Article page**: translated title/summary for the active language,
  publish date, and a clearly visible "Source: <outlet>" link to the
  original article. If the active language's translation is missing, fall
  back to the original-language text with a visible "translation
  unavailable" note, rather than a blank field — reachable via a direct
  link even though the article won't appear in any listing for that
  language.
- **Empty states**: the site may have zero articles for a given
  region/language at any point (a quiet day, or before the first pipeline
  run lands) — every listing renders a real "no articles yet" state rather
  than erroring or rendering blank.
- **Data layer**: a `lib/content.ts` module reads `content/articles/**/*.json`
  directly via Node `fs` (server components only) — no API route, no
  database. Exposes functions like `getRecentByRegion(region, lang, limit)`,
  `getArticleBySlug(region, slug)`, `getRegions()`.
- **UI chrome strings** (nav labels, "Source:" label, the 18 region display
  names, etc.) live in a per-language dictionary — not a full i18n
  framework, since the chrome vocabulary is small (~25 strings). Rather
  than hand-authoring translations for languages like Bengali/Hindi that
  can't be verified by inspection, a one-off script
  (`scripts/generate-dictionaries.ts`) generates `shared/dictionaries/{lang}.json`
  from a hand-written `shared/dictionaries/en.json` base by reusing the
  content pipeline's existing, already-tested `translate.ts` (MyMemory) —
  run manually when the base dictionary changes, not on the automated
  fetch schedule. Article content translation itself remains entirely the
  pipeline's job, never done at render time.

### Visual design system — "Classic Editorial"

Chosen after reviewing mockups against a New York Times–inspired direction
(not a copy — an editorial reference point for typographic weight and
restraint):

- **Headlines**: Playfair Display (700/900) — high-contrast serif.
- **Deck/subhead text**: Lora, italic.
- **Body & UI text**: Inter (sans-serif).
- **Palette**: white background, near-black text, one accent color —
  masthead red `#b3121b` — used sparingly (active nav underline, section
  labels, source/timestamp accents).
- **Structure**: hairline black rules between sections, small-caps
  uppercase section/region labels (e.g. "GLOBAL", "BAYERN").
- **Non-Latin scripts** (Hindi, Bengali, and any future non-Latin language)
  use a matching Noto Serif/Sans variant for that script at equivalent
  weights, so headlines stay legible and consistent in weight across every
  language, not just Latin-script ones.
- These are configured as Tailwind theme tokens (colors, font families),
  not scattered inline styles, so the system stays consistent as pages are
  added.

## Error handling

- A single unreachable/malformed RSS feed is skipped and logged; the run
  continues with all other feeds (one bad feed never fails the whole
  pipeline run).
- Translation failures degrade per-language per-article (see Translation
  section) rather than blocking publication.
- The daily article cap counter is timezone-aware (Europe/Berlin) so a
  workflow run near midnight doesn't double- or under-count.
- Git push conflicts are not expected (single serialized workflow) but the
  workflow retries the push once on failure.

## Testing

- Unit tests for feed selection/dedup/cap/priority logic against fixture RSS
  data.
- Unit tests for the translation wrapper against a mocked MyMemory client.
- The GitHub Actions workflow supports `workflow_dispatch` for on-demand
  manual runs, used to verify the end-to-end pipeline before relying on the
  schedule.
- Unit tests for `lib/content.ts` (the frontend's data-reading layer)
  against a fixture content directory, covering the empty-state case.
- A manual `npm run dev` browser check of the golden path (home → category
  → article → language switch) before any frontend page is considered
  done — type-checking and unit tests verify correctness, not that the
  page actually renders and looks right.

## Open questions / explicitly deferred

- Search across articles — not in scope at launch; JSON files are
  date-partitioned but there's no search index.
- Images — RSS feeds vary in whether they include usable images; decide
  during implementation whether to display feed-provided images or ship
  text-only at launch.
- Analytics/monetization — out of scope for this spec.
