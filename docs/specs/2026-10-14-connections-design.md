# Connections: live ownership and lobbying links in every result

Date: 2026-10-14
Status: approved 2026-10-14; built per docs/plans/2026-10-14-connections.md
Builds on: `docs/specs/2026-10-13-undercurrent-design.md` (and its 2026-10-14 OpenSanctions amendment)

## Purpose

A journalist who finds a sanctioned ship or company wants the next answer straight away: who is behind it, what else they run, and who has been lobbying Washington on their behalf. Today Undercurrent shows the entity alone; its network sits in a separate, frozen September 2026 graph.

This adds a **Connections** panel under each search result:
- **Sanctions links:** owners, managers, "linked to" companies, directors and other ships under the same manager. Rebuilt every night from the official lists via OpenSanctions.
- **Lobbying links:** lobbying firms hired, named lobbyists and their former government posts, bodies lobbied, bills, and the US subsidiary that filed for a foreign parent. Rebuilt every night from the US lobbying-disclosure database, following the method of the VeilTrace knowledge graph.

## Success criteria

1. Searching TASSOS shows Zulu Ships Management and Zulu's other ships, labelled "US, UK", with each name searchable in one click.
2. Searching Nord Stream 2 shows the firms it hired, with filing counts, fees and years, its lobbyists and their former posts, the bodies lobbied and key bills, each linked to its filing.
3. Searching Sovcomflot shows its sanctions links and "No US lobbying filings found (checked nightly)".
4. All connection data refreshes nightly with no human action; a failed source keeps yesterday's copy and opens an issue.
5. Nothing new is added to the browser's first download, and git history does not grow with the data.
6. Every link shown names who says so (US, UK or EU list; LDA filing; Treasury release) and its evidence grade.

## Non-goals

- Rebuilding the big network pages (`stories/…`); they stay as the September snapshot.
- FARA filings and EU lobbying-register entries.
- Automatic discovery of new lobbying clients (clients are a hand-edited list).
- Fuzzy matching between datasets. Unmatched means "no recorded connections", never a guess.

## Data sources and how the hackathon graph was built

The VeilTrace knowledge graph (`stories/who-lobbies/influence-network/`, methods in its README and `methods.html`) joined:
- **Fleet side:** ships joined across lists by IMO; owners and operators from the UK list and the US "Linked To" field.
- **Lobbying side:** `lda.gov/api/v1/filings/` (public, no key), queried for a fixed list of 24 clients by `client_name` and for parents by `foreign_entity_name` (35 queries), every page. Extracted into firms, clients, foreign parents, named lobbyists, government bodies, bills and former posts.
- **Bridges:** 18 hand-checked links between the two sides (`scripts/curated.json`), each with an official source, plus a list of companies searched with no lobbying found.

This design keeps that method and makes both sides refresh nightly. The sanctions side moves to OpenSanctions' relationship data, which already joins the official lists (US OFAC SDN "Linked To" and ownership, UK owner/operator, EU, Switzerland and others).

Measured on 2026-10-14:
- OpenSanctions `sanctions/entities.ftm.json`: 373 MB with 12,278 relationship records: Ownership 6,491, UnknownLink 3,601, Representation 1,536, Directorship 437, Family 154, Membership 59. They touch 12,726 entities, and 2,080 involve a ship.
- TASSOS → "Property in the interest of" → Zulu Ships Management (US OFAC, UK FCDO). Zulu → 11 ships, plus "Providing support to" Hossein Shamkhani (US OFAC).
- `lda.gov/api/v1/filings/?client_name=Nord Stream 2` → 60 filings.

Plan note: the client list is stored as separate "queries" and "clients" arrays (one company can need several queries), and lobbied/lobbied_on edges carry their client so one firm's work for two clients is not mixed.

## Design

### 1. Nightly data (extends `update-lists.yml`)

Two new builders. Each writes one gzipped JSON asset uploaded to the existing `data-latest` release, plus a small status file committed to `data/`.

**`scripts/build_connections.py` → `connections.json.gz`**
- **Input:** `https://data.opensanctions.org/datasets/latest/sanctions/entities.ftm.json`. Streamed line by line, never loaded whole.
- **Keeps** the relationship schemas Ownership, UnknownLink, Representation, Directorship, Family and Membership. It also keeps every entity they touch whose schema is Person, Organization, Company, LegalEntity, Vessel or Airplane.
- **Per entity:** `id, schema, name, imo, authorities`.
  - `name` is the caption.
  - `authorities` uses the same plain-words mapping as the OpenSanctions index (US, UK, EU, Switzerland and so on), taken from the entity's datasets.
- **Per link:** `a, b, kind, role, authorities`.
  - Direction is normalised so `a` is the owner, director, agent, member or subject, and `b` is the asset, organisation, client or object.
  - `role` is the list's own wording ("Property in the interest of", "Owned or Controlled By", "Providing support to"); if missing, a default per kind.
- **Safeguards:** the same as the other sources.
  - Shrink guard: at most 20% fewer links than the last good build.
  - Smoke sample: TASSOS must link to Zulu Ships Management.
  - Any failure keeps yesterday's asset.
- **Status file:** `data/connections-meta.json`.

**`scripts/build_lobbying.py` → `lobbying.json.gz`**
- **Fetch:** a port of the hackathon `fetch_lda.py`.
  - Walks every page of each query in `data/lobbying-clients.json`, waiting 1.2 s between calls and backing off on HTTP 429 and 5xx.
  - Raw pages are not saved; the builder works in memory.
- **Extract:** a port of the hackathon `extract_lobby.py`, keeping its rules verbatim:
  - client patterns (from the clients file) and foreign-entity aliases
  - fees counted once per firm, client, year and quarter: the latest posted version that states an amount; subcontracted ("ON BEHALF OF") money shown but not added to client totals
  - government-body and former-post mappings
  - bills kept if they are key bills or named in at least 3 filings, with the key-bill titles
  - every edge carries its filing UUIDs, year range and filing URL
- **Merged in:** the hackathon's hand-checked bridges and its "no lobbying found" list. They are copied from `stories/who-lobbies/influence-network/` sources into `data/lobbying-bridges.json`, unchanged, each with its source URL.
- **Output:** `nodes` (client, firm, person, parent, government, bill) and `edges` (hired, lobbied_in_house, lobbyist_at, lobbied_for, lobbied, lobbied_on, foreign_entity_of, formerly_served_in, plus bridge types), with `as_of`.
- **Safeguards:**
  - Shrink guard on filings kept.
  - Smoke sample: Nord Stream 2 has at least one "hired" edge.
  - Any failure keeps yesterday's asset.
  - The step is time-boxed at 20 minutes.
- **Status file:** `data/lobbying-meta.json`.

**`data/lobbying-clients.json`** is the editable client list. It starts as the hackathon's 24 client patterns and 11 foreign-entity queries. Each entry looks like:

`{"query": {"client_name": "Nord Stream 2"}, "pattern": "NORD STREAM 2", "id": "co:nord-stream-2", "name": "Nord Stream 2 AG", "group": "russia"}`

Adding a company means adding one line.

The same file holds `"exclude_lobbyists": []`, a list of normalised lobbyist names never shown, for takedown requests. It starts empty.

**Workflow:** the two builders run after the OpenSanctions index build, as separate `continue-on-error` steps with their own upload steps. A failure in one never blocks the official lists, the OpenSanctions index, or each other. The failure issue names which source failed. The workflow keeps `contents: write` and `issues: write`.

### 2. `api/connections.js`

**Request:** `GET /api/connections?imo=<7 digits>` or `?name=<text>` (≤ 200 characters). Anything else → 400 `{error:"bad query"}`.

**Loading:** both assets are loaded and cached like `api/search.js`: in memory, a 12-hour refresh, a 10-minute backoff on failure, and stale-but-good kept on failure. Each asset is independent. If one cannot load, its section returns `{available:false}` and the other still works.

**Entity resolution** (exact only):
- **Sanctions side:**
  - match by IMO
  - otherwise by normalised name (same `normalizeName` as search) against entity names
  - if several entities share the name, use the one with the most links and report `others: N`
- **Lobbying side:** match by normalised name against client names, the names they appear under in filings, and foreign-parent names.

**Expansion** (sanctions side):
- the focus entity's direct links
- for each direct neighbour that is a company or organisation, its other links, grouped by schema (ships, companies, people)
- never expand from a person
- groups capped at 20 items plus a `more` count

**Response:**
```json
{
  "query": "TASSOS",
  "sanctions": {"available": true, "focus": {"name": "TASSOS", "schema": "Vessel", "imo": "9408695"}, "others": 0,
                "links": [{"name": "Zulu Ships Management", "schema": "Organization", "role": "Property in the interest of",
                           "direction": "out", "authorities": ["US", "UK"],
                           "groups": [{"schema": "Vessel", "items": [{"name": "TAGOR", "role": "Property in the interest of", "authorities": ["US","UK"]}], "more": 0},
                                      {"schema": "Person", "items": [{"name": "Hossein Shamkhani", "role": "Providing support to", "authorities": ["US"]}], "more": 0}]}]},
  "lobbying": {"available": true, "as_of": "2026-10-14", "client": "Nord Stream 2 AG", "checked_no_filings": false,
               "firms": [{"name": "Capitol Counsel LLC", "filings": 12, "fees_usd": 1234567, "years": [2017, 2022], "url": "https://lda.gov/filings/public/filing/<uuid>/print/", "subcontract": false}],
               "lobbyists": [{"name": "Jane Example", "firm": "Capitol Counsel LLC", "former_posts": ["Legislative Assistant, Sen. X"], "former_bodies": ["US Senate"]}],
               "bodies": [{"name": "US Senate", "filings": 30}], "bills": [{"label": "S.722", "title": "…", "filings": 9}],
               "parents": [{"name": "Gazprom", "note": "50% of NS2 operating budget", "url": "…"}],
               "bridges": [{"name": "Gazprom Neft", "relation": "owns", "source_url": "https://home.treasury.gov/news/press-releases/jl2629"}]},
  "attribution": "Sanctions links: official lists via OpenSanctions (CC BY-NC 4.0). Lobbying: US Senate LDA filings."
}
```
(The example values are illustrative of shape; real values come from the data.)

When matched but nothing is linked, `links: []`. A company on the "no lobbying found" list, or any matched company with no filings, gets `lobbying.checked_no_filings: true`.

Cache: successful answers `public, s-maxage=21600`; errors `no-store`.

### 3. Connections panel (page)

- **Where:** in each dossier, below Sources. It is fetched after the result renders (`/api/connections?imo=…` for ships, `?name=…` otherwise) and guarded by the existing latest-only ticket.
- **Sanctions section ("Connections on the sanctions lists"):**
  - On desktop, a left-to-right SVG drawn by hand, no library: focus → direct links → their groups (as in the approved mockup).
  - At most 8 boxes; larger groups collapse into one box such as "10 other ships".
  - Edge labels give the role and authorities in mono caps.
  - Below it, the same facts as a list. Every name is a button that runs a search for it.
- **Lobbying section ("Lobbying in Washington"):**
  - The graph extends to the right with up to 4 firm boxes ("Capitol Counsel · 12 filings").
  - A list of firms (filings, fees, years, filing link).
  - Lobbyists by name, with disclosed former posts, grouped by firm; a revolving-door summary line ("4 lobbyists previously served at the US Senate").
  - Bodies lobbied and key bills, the US subsidiary or foreign parent, and bridges with their sources.
  - Fees are labelled "self-reported, rounded".
- **Empty and failure states:**
  - "No recorded connections on the sanctions lists."
  - "No US lobbying filings found (checked nightly). No filing found is not proof of no influence."
  - A section whose data could not load: "Connections are unavailable right now" plus Retry.
- **Phone (< 48rem):** lists only, no graph.
- **Footer note:** attribution and "A listed link is a government finding; check the source before you publish. Lobbying is legal; filings describe disclosed activity."
- **Naming:** lobbyists are named from their own LDA disclosures, in that role, as in the hackathon graph. People on the sanctions side are named only as the official lists name them.
- **Accessibility:** the SVG has a text `aria-label` summary and the list carries the full content. Name buttons are real `<button>`s.
- **Escaping:** all data goes through `escapeHtml`/`safeUrl`.

### 4. Reliability

- Each source (official lists, OpenSanctions index, connections, lobbying) fails alone: its own build step, upload step and status file. Yesterday's asset stays on failure.
- LDA politeness: 1.2 s between calls, `Retry-After` honoured, at most 6 retries per call. The whole step is time-boxed.
- The function answers within the page's 5 s budget on a warm instance. A cold load of both assets is measured during implementation and reported. The panel shows "Loading connections…" and never blocks the dossier.
- Rate limiting: the existing pending Firewall rule should cover `/api/connections` as well as `/api/search`.

## Testing

- **Parsers on saved samples** (fixtures cut from the real files, committed small):
  - OpenSanctions relationship lines, including TASSOS–Zulu and a Family link
  - several LDA filing pages, including an amendment, a subcontract and a foreign entity with a note
- **Fees:** an amendment for the same firm, client and quarter is counted once; the version with an amount wins; subcontracted money is excluded from the client total.
- **Builders:** fresh, download failure, shrink, missing smoke sample, corrupt previous meta.
- **API:** IMO and name lookup; ambiguous names (`others`); caps and `more`; no expansion from people; each asset failing alone; bad queries; caching.
- **Render:** sanctions and lobbying sections, empty states, phone list-only, escaping of hostile names.
- **Playwright:** TASSOS shows Zulu and its ships; Nord Stream 2 shows a lobbying section with a firm; Sovcomflot shows "No US lobbying filings found"; no clipping at 375 px. These tests use a stubbed `/api/connections` (route fulfilment with fixture JSON), since the function does not run under the static test server.

## Risks

- **LDA API availability or limits:** the step is time-boxed and keeps yesterday's file. If pulls grow too slow, switch to an incremental pull (`filing_dt_posted_after`).
- **Name collisions on the sanctions side:** exact match only; `others: N` is shown so readers know there are other list entries with the same name.
- **Hub size:** IRISL has 120 links and Hizballah 232. Caps keep payloads small; the full set stays one search away.
- **Memory:** the function holds the OpenSanctions index (≈173 MB measured) plus connections and lobbying. Measured during implementation; split into a second function if it exceeds 1 GB.
- **Named lobbyists:** public record from their own disclosures, as in the hackathon graph. If a takedown request arrives, the client list and an exclusion list in `data/lobbying-clients.json` handle it.
