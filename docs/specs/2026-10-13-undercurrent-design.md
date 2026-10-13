# Undercurrent: design

Date: 2026-10-13
Status: draft v2, awaiting review

## Purpose

A free website where a journalist or researcher can type the name of a ship, company or person and find out, in plain English, whether it is sanctioned, what other names it has used, who it is connected to, and where that information comes from. A guided walkthrough teaches the site with one real tanker. Below the search, four research stories explain how sanctions evasion by Russia, Iran and others works.

Undercurrent is a clean rebuild of the research from the VeilTrace hackathon project (Trace the Unseen build day, 25 Sep 2026). The original repo (`Ttheegela/veil-trace`) and its site (`veiltrace-psi.vercel.app`) stay untouched for the team.

## Users

Journalists and researchers covering sanctions and evasion. Comfortable on the web, not comfortable with terminals, Python, graph tools or API keys. They need answers they can quote and sources they can cite.

## Success criteria

1. A first-time visitor can search a name and understand the result without reading any help text.
2. Every fact on a result links to its source.
3. The site works with zero setup: no API key, no account, no build step for a reader.
4. Official-list data refreshes nightly with no human action, and the page shows when it was last updated.
5. Running it locally takes one command.
6. No single failure (a list download, a data file, OpenSanctions, a bad commit) takes the search down. See Reliability.

## Non-goals

- Legal or compliance verdicts. Every match is a "possible match, check the source".
- User accounts, saved searches, alerts.
- A light theme (dark only for v1).
- Re-running the hackathon data pipelines (they need Sayari and Tradeverifyd access we no longer have).
- The Lukoil Control Tracer (unmerged `lukoil` branch) and the hackathon demo deck.

## Visual design

Approved mockup: `docs/design/mockup-dark.html` (static, real TASSOS data). It is the reference for layout, type and spacing; the build reproduces it with live data.

- **Direction**: dark investigative newsroom (Bellingcat, Rest of World, Reuters Investigates register). Designed with the Hallmark skill.
- **Colour** (OKLCH tokens on `:root`, no raw values outside the token block): paper `oklch(15% 0.012 250)`, raised surfaces at 19% and 23%, rules at 30%, ink `oklch(94% 0.008 250)`, one accent, vermilion `oklch(68% 0.19 32)`. The accent marks government listings, the primary walkthrough button and focus rings, nothing else.
- **Type**: Schibsted Grotesk (display and interface), Source Serif 4 (reported text: facts, walkthrough notes, story summaries), JetBrains Mono (dates, IMO numbers, labels). Loaded from Google Fonts. Headings never italic.
- **Motion**: walkthrough text cross-fades (240 ms), hover colour shifts (150 ms). Nothing else. `prefers-reduced-motion` respected.
- **Responsive**: verified at 320, 375, 414, 768 and 1280 px; no horizontal scroll at any width.

## Page (one page, search first)

1. **Top bar**: "Undercurrent" wordmark left; Research, About the data, Walkthrough right. On phones only Walkthrough stays.
2. **Hero**: headline "Names change. The hull doesn't." One line of serif explaining what is checked. A large search bar (`/` focuses it). Under it: "Official lists updated <date, time UTC>", three example searches (TASSOS · Sovcomflot · 9408695), and the primary button "Follow one tanker, 5 steps".
3. **Results**, in this order; each layer hidden when empty:
   1. **In our research** (the dossier):
      - Header: name, kind, IMO, flag, manager; one chip per listing government with date and program.
      - **Timeline** of the entity's dated events (ownership, management, listings), listings in the accent colour. Horizontal on desktop, vertical on phones. Note: "Spacing is approximate."
      - **What the records show**: serif sentences, each with numbered footnotes.
      - **Names**: current and former names, flags flown.
      - **Sources**: numbered list matching the footnotes.
      - Actions: "Open on the shadow-fleet map" (or the matching story), "Copy citation".
      - More than one match: the top match is shown in full; the others are listed as one-line entries (name, kind, listing chips) that expand in place.
   2. **On official sanctions lists**: table of list, listed as, program, date, link to the record.
   3. **Wider check**: OpenSanctions results when the server has a key, otherwise a "Search on OpenSanctions" link.
   - Caveat under every result: "A name match is a possible match, not proof. Ships and companies share names; check the numbered source before you publish. This site describes documented conduct and makes no legal findings."
   - No results anywhere: "Not found in our research or on the official lists", plus the OpenSanctions link and a hint to try the IMO number.
4. **Research**: "Four investigations, one dataset", a 2x2 grid led by a real figure each:
   - 1,724 ships: The shadow fleet (network map, findings, method)
   - 15 to 20 months: Chips into Russia (routes, flow, listing lag)
   - 1,513 reports: Who lobbies (influence network, clean-names graph)
   - Start here: How sanctions work (plain-language explainer)
5. **Footer**: single line: Undercurrent, research credit to the VeilTrace team, About the data, Methods, original research repo, "Not legal advice".

**Copy citation** puts this on the clipboard: `TASSOS (IMO 9408695): listed by the United States on 30 July 2025 (Iran), the European Union on 24 October 2025 (Russia), the United Kingdom on 24 February 2026 (Russia). Sources: <urls>. Via Undercurrent, <page url>, accessed <date>.` Silent success: the button label changes to "Copied" for two seconds.

Language rules: plain words ("Listed by the United States", not "SDN / EO14024"); program codes only in the sources list. Documented facts stated plainly with a source; our inferences labelled "lead".

## Walkthrough

A guided case that also tours the page. Starts from the hero button or the top-bar link, and never on its own.

- Five steps, driven by the real page: it types TASSOS into the search, runs it, then points at each part in turn with an accent outline and a floating card (bottom-left on desktop, bottom of screen on phones). The card shows "Walkthrough · n of 5", a progress bar, the step text in serif, and Back / Next / Leave; Esc leaves.
- Steps:
  1. Search: TASSOS is the current name; IMO 9408695 also works and never changes.
  2. Listing chips: three governments within seven months, under two programs, first Iran then Russia.
  3. Timeline: sold out of a mainstream fleet, handed to a new manager, first listed 29 months after the sale.
  4. Names: five names, one hull; any of them finds this record.
  5. Sources: every sentence has a number; open it before you quote.
- Step text lives in `app/walkthrough.js` with the target element for each step. If a target is missing (data changed), that step is skipped rather than breaking the tour.
- Finishing or leaving restores the page as the user left it, minus the outline.

## Search: three layers

All matching uses one normalisation, ported from the hackathon `tools/sanctions/lists.py`: case-fold, strip accents and punctuation, drop legal suffixes (LLC, LTD, OOO, JSC and the rest of that list), collapse spaces. A seven-digit number is treated as an IMO and matched exactly.

Ranking: exact normalised match, then all query tokens present, then token overlap at or above 0.6 of the query's tokens. Top 10 per layer. Written by hand, no search library. If recall turns out poor in testing, swap in Fuse.js; not before.

### Layer 1: our research (static)

`data/research-index.json`, built by `scripts/build_research_index.py` from files copied out of the old repo:
- shadow-fleet `nodes.json` and `edges.json`: 1,724 ships, 1,024 companies, 25 people, with aliases, listings, flags, history and sources; edges supply manager and owner lines.
- chips `listing_lag.json`: 8 chip-route companies with first-suspicious and first-listing dates.
- lobbying clean-names graph `nodes.json`.

Each entry: `id, kind, name, aliases[], imo?, flag?, manager?, listings[{by, date, program}], events[{date, kind, text}], facts[{text, refs[]}], names[{name, current}], flags[], story{label, url}, sources[{n, label, url}]`. Loaded on first keystroke. Rebuilt only when research data changes, not nightly.

### Layer 2: official lists (static, refreshed nightly)

One file per list, so one list can fail without touching the others:
- `data/lists/us.json`: US Consolidated Screening List (includes OFAC SDN)
- `data/lists/uk.json`: UK Sanctions List
- `data/lists/eu.json`: EU Financial Sanctions consolidated list
- `data/lists/un.json`: UN Security Council consolidated list
- `data/lists/meta.json`: per list `updated_at`, `source_url`, `record_count`, `status` (`fresh` or `kept-previous`)

Built by `scripts/build_official_lists.py`. Each record: `name, normalised name, program, date?, url`. One record per name or alias; only fields the page shows. Each file loads lazily and in parallel on first search.

### Layer 3: OpenSanctions (live, optional)

`api/search.js`, a Vercel Function on the default Node runtime. Takes `?q=`, calls the OpenSanctions search API with `OPENSANCTIONS_API_KEY`, returns up to 10 results trimmed to `name, schema, datasets, url`. OpenSanctions is free for non-commercial use with an API key; this site is non-commercial. The key is a manual signup by the owner and lives only in Vercel environment variables. Results carry the CC BY-NC attribution.

## Reliability

1. **Static core.** Layers 1 and 2 are static files served by Vercel's CDN. No server runs at search time, so nothing can crash there. Only Layer 3 is live.
2. **Layers fail alone.** Each data file is fetched independently. A file that fails to load shows "Couldn't load <layer>. Retry" in its own section; the other layers keep working. Layer 3 waits at most 5 seconds, then falls back to the outbound link.
3. **Nightly job never publishes bad data.** Per list:
   - download; parse; validate against the expected record shape;
   - reject if empty or more than 20% smaller than the committed file;
   - on rejection, keep yesterday's file for that list, mark it `kept-previous` in `meta.json`, and continue with the other lists.

   After all lists: a smoke check loads every file and confirms known names are found (TASSOS in our research and in US/EU/UK, plus one fixed sample name per list). If the smoke check fails, nothing is committed. Any rejection or failure opens a GitHub issue (title `Nightly lists: <list> failed <date>`, de-duplicated against open issues).
4. **Stale data is visible.** If any list's `updated_at` is older than 3 days, or its status is `kept-previous`, the hero date line reads "Some lists may be out of date" with the per-list dates on hover/tap.
5. **Format changes caught early.** Each list parser is tested against a small saved sample of the real file (`scripts/fixtures/`). An upstream format change fails the test on the next run instead of producing a wrong file.
6. **Nothing reaches production untested.** `check.yml` runs on every push and pull request:
   - Python tests (normalisation, parsers on fixtures, research-index build);
   - JS normalisation check on the shared cases;
   - Playwright smoke test against a local static server: search TASSOS (dossier, timeline, three chips render), search 9408695 (same record), search a made-up name (empty state), run the walkthrough start to finish, check no horizontal scroll at 375 px, check every story URL returns 200, check no console errors.

   `main` is protected: merges need `check.yml` to pass. Every pull request gets a Vercel preview deploy.
7. **OpenSanctions proxy hardening.** Only `q` is forwarded; capped at 200 characters; empty or whitespace queries rejected locally. A Vercel Firewall rate-limit rule on `/api/search` (60 requests per minute per IP). Responses cached at the CDN for 24 hours per query. The function never returns an error page: missing key gives `{enabled:false}`, upstream error or timeout gives `{error:true}`, and the page shows the link in both cases.
8. **Uptime alerts.** A free external monitor (UptimeRobot) checks the home page, `data/lists/meta.json` and `/api/search?q=tassos` every 5 minutes and emails the owner on failure.

## Nightly update

`.github/workflows/update-lists.yml`:
1. Runs daily at 04:00 UTC and on manual trigger.
2. Runs `scripts/build_official_lists.py` (per-list rules above), then the smoke check.
3. If any list file or `meta.json` changed and the smoke check passed, commits only `data/lists/` as `data: official lists YYYY-MM-DD` with the built-in `GITHUB_TOKEN`.
4. The push to `main` triggers a Vercel production deploy.
5. On rejection or failure, opens or updates the GitHub issue.

Workflow permissions: `contents: write`, `issues: write`. One-time owner setting: repo Settings, Actions, Workflow permissions, "Read and write".

## Repo layout

```
index.html                       the one page
app/style.css                    tokens + page styles
app/search.js                    loading, normalising, ranking, rendering
app/walkthrough.js               steps and the tour controller
data/research-index.json
data/lists/{us,uk,eu,un,meta}.json
api/search.js                    OpenSanctions proxy
scripts/normalize.py             shared normalisation
scripts/normalize_cases.json     shared cases for Python and JS
scripts/build_research_index.py
scripts/build_official_lists.py
scripts/smoke_lists.py
scripts/fixtures/                small saved samples of each official list
scripts/test_*.py                pytest
tests/smoke.spec.js              Playwright smoke test
stories/how-sanctions-work/      from docs/sanctions-explained
stories/shadow-fleet/            from research/shadow-fleet (map, data, FINDINGS, METHOD)
stories/chips-into-russia/       from research/russia-ukraine/viz + FINDINGS
stories/who-lobbies/             from research/knowledge-graph + research/lobbying
stories/about-the-data.html      merged RESEARCH_AND_SOURCES + METHODS_LOG, trimmed, styled like the page
docs/specs/                      this spec
docs/design/mockup-dark.html     approved visual reference
.github/workflows/update-lists.yml
.github/workflows/check.yml
package.json                     dev only: Playwright and a static server for tests
vercel.json
README.md
LICENSE                          MIT for code
```

The site itself has no build step and no runtime dependencies: plain HTML, CSS and JavaScript. `package.json` exists only for the test tooling.

Story pages are copied with their folders intact so their relative links keep working; any link pointing outside its folder is fixed during the copy. They keep their own look; each gets a small "Back to Undercurrent" link at the top.

## What comes from the old repo

Copied: shadow-fleet network data and map, FINDINGS and METHOD files; russia-ukraine viz pages and FINDINGS; knowledge-graph pages and data; lobbying clean-names graph and FINDINGS; sanctions-explained page and fonts; RESEARCH_AND_SOURCES and METHODS_LOG (merged); normalisation logic.

Not copied: hackathon landing page and hero video, demo deck and script, pitch diagrams, sponsor setup guides, sponsor lookup tool, fleet/detect pipelines, Python extract scripts, SOCIAL and planning notes.

The old repo is read only; nothing there is modified.

## Credit and licensing

- First commit and README credit the VeilTrace team and link `github.com/Ttheegela/veil-trace` as the origin of the research.
- Code: MIT. Data keeps its sources' terms, listed in About the data (government lists are public; OpenSanctions results are CC BY-NC and attributed where shown).

## Hosting

New GitHub repo `Ttheegela/undercurrent` (public) and new Vercel project `undercurrent` under the owner's account (`theegelatarun-4606`), production branch `main`, linked with the Vercel CLI. Each is created only after the owner confirms. Owner-only steps: OpenSanctions API key signup, UptimeRobot account.

## README

Three short parts: Use it (the URL), Run it locally (`npx serve .`; the OpenSanctions layer shows the outbound link locally unless run with `vercel dev` and a key), How the data updates (nightly job, what happens when a list fails, optional key). Then credit.

## Testing summary

- Unit: normalisation, IMO detection, ranking order, each list parser on its fixture, research-index build on a small sample.
- Smoke: Playwright flow in `check.yml` (see Reliability 6).
- Nightly: per-list validation plus the post-build smoke check.
- Manual before launch: the three example searches, a company and a person search, a made-up name, an IMO number, the walkthrough, 320 / 375 / 768 / 1280 px, keyboard only, with and without the OpenSanctions key.

## Open risks

- EU list download URL has historically required a token parameter; confirm a stable public URL during implementation.
- Official-list file sizes; if a single list passes 2 MB gzipped, trim fields further or shard it by first letter.
- Vercel Firewall rate-limit rules may need the dashboard rather than config; confirm during hosting setup.
- Story pages were built under deadline; some may have broken internal links once moved. Each is opened and clicked through during the copy, and the Playwright test checks that each story URL returns 200.
