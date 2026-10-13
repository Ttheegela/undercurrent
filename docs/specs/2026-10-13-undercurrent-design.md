# Undercurrent: design

Date: 2026-10-13
Status: draft, awaiting review

## Purpose

A free website where a journalist or researcher can type the name of a ship, company or person and find out, in plain English, whether it is sanctioned, what other names it has used, who it is connected to, and where that information comes from. Below the search, four short research stories explain how sanctions evasion by Russia, Iran and others works.

Undercurrent is a clean rebuild of the research from the VeilTrace hackathon project (Trace the Unseen build day, 25 Sep 2026). The original repo (`Ttheegela/veil-trace`) and its site (`veiltrace-psi.vercel.app`) stay untouched for the team.

## Users

Journalists and researchers covering sanctions and evasion. Comfortable on the web, not comfortable with terminals, Python, graph tools or API keys. They need answers they can quote and sources they can cite.

## Success criteria

1. A first-time visitor can search a name and understand the result without reading any help text.
2. Every fact on a result card links to its source.
3. The site works with zero setup: no API key, no account, no build step for a reader.
4. Official-list data refreshes nightly with no human action, and the page shows when it was last updated.
5. Running it locally takes one command.

## Non-goals

- Legal or compliance verdicts. Every match is a "possible match, check the source".
- User accounts, saved searches, alerts.
- Re-running the hackathon data pipelines (they need Sayari and Tradeverifyd access we no longer have).
- The Lukoil Control Tracer (unmerged `lukoil` branch) and the hackathon demo deck.

## Page (one page, search first)

1. **Header**: "Undercurrent" plus nav anchors: Search, Research, About the data.
2. **Search block**: heading "Is this ship or company sanctioned?", one input ("Type a ship name, IMO number, company or person"), three clickable example searches, and "Official lists updated <date>".
3. **Results**: three labeled groups, shown in this order, each hidden when empty:
   1. **In our research**: richest card. Name, type (tanker, company, person), IMO if a ship, red "Sanctioned" badge if listed anywhere, one plain sentence per listing ("Listed by US on 10 Jan 2025 under Russia sanctions"), other names, flags flown, links to the story page that shows it, collapsible source list.
   2. **On official sanctions lists**: one line per hit: list, name as listed, program, listing date if the list gives one, link to the official list.
   3. **Wider check (OpenSanctions)**: hits from OpenSanctions when the server has a key; otherwise a single "Search this name on OpenSanctions" link.
   Footer on every result set: "Name matches are possible matches, not proof. Always check the source."
   No results anywhere: "Not found in our research or on the official lists" plus the OpenSanctions link.
4. **Research**: four story cards, each with a two-line intro, opening the existing pages:
   - How sanctions work (plain-language explainer)
   - The shadow fleet (tanker network map, findings, method)
   - Chips into Russia (routes, flow river, listing lag)
   - Who lobbies (sanctions influence network, clean-names lobbying graph)
5. **About the data**: sources, how matching works, limits, update schedule, team credit.

Mobile: single column, search input full width, cards stack.

Language rules: plain words ("Listed by US", not "SDN / EO14024"); program codes only inside the source detail. Documented facts stated plainly with a source; our inferences labeled "lead".

## Search: three layers

All matching uses one normalisation, ported from the hackathon `tools/sanctions/lists.py`: case-fold, strip accents and punctuation, drop legal suffixes (LLC, LTD, OOO, JSC and the rest of that list), collapse spaces. A seven-digit number is treated as an IMO and matched exactly.

Ranking: exact normalised match, then all query tokens present, then token overlap at or above 0.6 of the query's tokens. Top 10 per layer. Written by hand, no search library. If recall turns out poor in testing, swap in Fuse.js; not before.

### Layer 1: our research (static)

`data/research-index.json`, built once by `scripts/build_research_index.py` from files copied out of the old repo:
- shadow-fleet `nodes.json` and `edges.json`: 1,724 ships, 1,024 companies, 25 people, with aliases, listings, flags and sources; edges supply "managed by" and "owned by" lines.
- chips `listing_lag.json`: 8 chip-route companies with first-suspicious and first-listing dates.
- lobbying clean-names graph `nodes.json`.

Each entry: `id, kind, name, aliases[], imo?, listings[{by, date, program}], facts[] (plain sentences), links[{label, story_url}], sources[{label, url}]`. Loaded on first keystroke.

This file is rebuilt only when research data changes, not nightly.

### Layer 2: official lists (static, refreshed nightly)

`data/official-lists.json`, built by `scripts/build_official_lists.py` from the public files:
- US Consolidated Screening List (includes OFAC SDN)
- UK Sanctions List
- EU Financial Sanctions consolidated list
- UN Security Council consolidated list

Exact download URLs are confirmed during implementation. Each record: `list, name, normalised name, program, date?, url`. One record per name or alias. Only fields the page shows are kept, to keep the file small; target under 3 MB gzipped. Loaded lazily on first search.

The file carries `updated_at` and per-list record counts; the page shows `updated_at`.

### Layer 3: OpenSanctions (live, optional)

`api/search.js`, a Vercel Function on the default Node runtime. Takes `?q=`, calls the OpenSanctions search API with `OPENSANCTIONS_API_KEY`, returns up to 10 results trimmed to `name, schema, datasets, url`. Rules:
- Key missing: returns `{enabled:false}`; page shows the outbound link instead.
- Query capped at 200 characters; only `q` is forwarded.
- Upstream error or timeout (5 s): returns `{error:true}`; page shows the outbound link and a short note. Layers 1 and 2 are unaffected.
- Response cached at the CDN for 24 hours per query.

OpenSanctions is free for non-commercial use with an API key. This site is non-commercial. The key is a manual signup by the owner and lives only in Vercel environment variables.

## Nightly update

`.github/workflows/update-lists.yml`:
1. Runs daily at 04:00 UTC and on manual trigger.
2. Runs `scripts/build_official_lists.py`.
3. Sanity check: fails and commits nothing if any list downloads empty or any list's record count drops more than 20% versus the committed file. GitHub emails the failure; the site keeps serving yesterday's file.
4. If the file changed, commits only `data/official-lists.json` as `data: official lists YYYY-MM-DD` with the built-in `GITHUB_TOKEN`.
5. The push to `main` triggers a Vercel production deploy.

One-time owner setting: repo Settings, Actions, Workflow permissions, "Read and write".

## Repo layout

```
index.html                 the one page
app/search.js              loading, normalising, ranking, rendering
app/style.css
data/research-index.json
data/official-lists.json
api/search.js              OpenSanctions proxy
scripts/normalize.py       shared normalisation
scripts/build_research_index.py
scripts/build_official_lists.py
scripts/test_normalize.py  the one check (pytest)
scripts/normalize_cases.json  shared cases for Python and JS
stories/how-sanctions-work/     from docs/sanctions-explained
stories/shadow-fleet/           from research/shadow-fleet (map, data, FINDINGS, METHOD)
stories/chips-into-russia/      from research/russia-ukraine/viz + FINDINGS
stories/who-lobbies/            from research/knowledge-graph + research/lobbying
stories/about-the-data.md       merged RESEARCH_AND_SOURCES + METHODS_LOG, trimmed
.github/workflows/update-lists.yml
.github/workflows/check.yml     on every push: pytest + JS normalisation check
vercel.json
README.md
LICENSE                    MIT for code
```

Story pages are copied with their folders intact so their relative links keep working; any link pointing outside its folder is fixed during the copy. `app/search.js` mirrors the Python normalisation; `test_normalize.py` checks the Python side and a small shared fixture file (`scripts/normalize_cases.json`) is checked by both Python and a tiny JS assertion run in CI.

Frontend: plain HTML, CSS and JavaScript, no framework, no build step. Fonts and any CDN scripts pinned to exact versions. Light and dark mode via `prefers-color-scheme`.

## What comes from the old repo

Copied: shadow-fleet network data and map, FINDINGS and METHOD files; russia-ukraine viz pages and FINDINGS; knowledge-graph pages and data; lobbying clean-names graph and FINDINGS; sanctions-explained page and fonts; RESEARCH_AND_SOURCES and METHODS_LOG (merged); normalisation logic.

Not copied: hackathon landing page and hero video, demo deck and script, pitch diagrams, sponsor setup guides, sponsor lookup tool, fleet/detect pipelines, Python extract scripts, SOCIAL and planning notes.

The old repo is read only; nothing there is modified.

## Credit and licensing

- First commit and README credit the VeilTrace team and link `github.com/Ttheegela/veil-trace` as the origin of the research.
- Code: MIT. Data keeps its sources' terms, listed in About the data (government lists are public; OpenSanctions results are CC BY-NC and attributed on the card).

## Hosting

New GitHub repo `Ttheegela/undercurrent` (public) and new Vercel project `undercurrent` under the owner's account, production branch `main`. Created only after the owner confirms each step.

## README

Three short parts: Use it (the URL), Run it locally (`npx serve .`; the OpenSanctions layer shows the outbound link locally unless run with `vercel dev` and a key), How the data updates (nightly job, optional key). Then credit.

## Testing

- `scripts/test_normalize.py`: normalisation cases, IMO detection, ranking order on a small fixture.
- JS check in `check.yml`: the same `normalize_cases.json` through `app/search.js`.
- Build scripts fail loudly on empty or shrunken downloads.
- Manual pass before launch in the browser: the three example searches, a made-up name (expects no results), an IMO number, mobile width, dark mode, with and without the OpenSanctions key.

## Open risks

- EU list download URL has historically required a token parameter; confirm a stable public URL during implementation.
- Official-lists file size; if it passes 3 MB gzipped, split per list and load in parallel.
- Story pages were built under deadline; some may have broken internal links once moved. Each is opened and clicked through during the copy.
