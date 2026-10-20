# Live Graphs and Daily Changes Implementation Plan (Part 1)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the shadow-fleet map and the influence network every night from official data on top of the fixed 25 September research layer. Record each day's changes, show them on both graphs with a "Show changes since" panel and calendar and on a new Updates page, and make every page's counts and dates come from the nightly data.

**Architecture:**
- **One-time split:** the current graph files are split once into a fixed *research base* and a *list-derived* part. Each night a stdlib Python builder:
  1. rebuilds the list-derived part from the official downloads (the UK and US raw files saved by the lists build, plus two small OpenSanctions dataset CSVs);
  2. merges it with the base;
  3. projects it into the exact shape the pages already read;
  4. derives the influence network;
  5. diffs both graphs against yesterday's;
  6. appends the day to a change record;
  7. writes a small stats file.
- **Outputs are JSON only.** The publish job commits them under a widened allowlist.
- **Pages:** the graph pages switch from inline/script data to `fetch()` of those JSON files, and gain a shared changes panel. A new Updates page and a stats filler read the same files.

**Tech Stack:** Python 3.12 stdlib (pytest), plain ES modules and classic scripts (node:test), Playwright 1.64 smoke, GitHub Actions, Vercel static hosting.

**Spec:** `docs/specs/2026-10-19-live-graphs-and-chat-design.md` (Part 1 only; Ask gets its own plan).

## Global Constraints

- **Workspace:**
  - Repo `~/Desktop/portfolio/projects/undercurrent`. Work on a branch per task group created from `main`; never push to `main`.
  - Python tests: `.venv/bin/python -m pytest -q scripts`. JS: `npm test`. Smoke: `npm run smoke` (Playwright starts `python3 -m http.server 4173`).
- **No new dependencies:** builders use the standard library only, and the site gets no new npm runtime dependencies.
- **Security model stays:**
  - **build job:** read-only, no secrets.
  - **publish job:** runs no project code and commits only allowlisted plain `.json` files (mode 100644).
  - **New outputs:** they must be `.json`, never `.js` or `.html`.
- **Failure model:**
  - Each source fails alone and keeps yesterday's copy, under the 20% shrink guard, and failures are named in the nightly issue.
  - A source that kept its previous copy produces **no changes** that day, and the change record notes it as unavailable.
- **Data rules:**
  - No Sayari or Tradeverifyd data or mentions.
  - People are named only as official lists, government documents or their own LDA filings name them, and `exclude_lobbyists` is honoured everywhere.
  - Unlisted companies not named by an official record keep `name_policy: "generic"`.
  - **Never port** veil-trace's fuzzy "Claude match" merge (`build_base.py:350-381`), its country-from-name regex (`:340-348`) or `merge.py`'s private research inputs (`:53-130`).
- **Stable ids:**
  - Ships `IMO#######`.
  - Companies `co:` + `norm_co(name)` slug.
  - People `p:` + slug.
  - Countries `cc:xx`; governments `gov:us|uk|eu|un`.
  - Edges `e:` + first 12 hex chars of `sha1(f"{source}|{target}|{type}")`.
  - Never OpenSanctions entity ids, never positional ids.
- **Dates:** UTC `YYYY-MM-DD` everywhere. History starts on the first live run; earlier calendar days are disabled.
- **Colours and text:**
  - Change colours are page-local tokens: `--chg-new` = `oklch(80% 0.17 150)` (green, check ≥3:1 on `--color-paper-2`); "removed" = dashed `--color-neutral`.
  - Every DOM value is escaped (`escapeHtml` / the graph pages' `esc`) and every URL goes through `safeUrl` (http/https/relative only).
- **Voice:** independent project. No "team" wording in new copy; existing credits to "the VeilTrace team" stay.
- **CSP stays as in `vercel.json`:** pages fetch same-origin JSON only (`connect-src 'self'`).
- **Commits:** every commit message ends with a blank line then `Co-Authored-By: Claude <model name> <noreply@anthropic.com>`.

## Review Focus

1. **A night when one list fails to download.** Nothing disappears from either graph and no "removed" changes are recorded. The Updates page says which source was unavailable. → Task 6 `test_kept_previous_source_records_no_changes`, Task 7 `test_stale_input_keeps_previous_graphs`.
2. **OpenSanctions merges or renames its own entity ids overnight.** No change is recorded, because graph keys never use OpenSanctions ids. → Task 6 `test_opensanctions_id_churn_is_not_a_change`.
3. **Hostile or odd names** (`<img onerror>`, quotes, very long names, right-to-left text) in a change summary, the calendar list, the Updates page or a deep-link hash. They are escaped everywhere and never break layout. → Task 8 `renderChangeList escapes names`, Task 11 smoke `updates page escapes hostile names`.
4. **A huge change day** (an EU package adds ~200 ships). The panel list shows the first 50 with "+N more · see all on the Updates page"; highlighting all of them stays responsive. → Task 8 `renderChangeList caps at 50`, Task 9 smoke `200 changes highlight without timeout`.
5. **First run, empty record, and picking a day before launch, after today or with no changes.** The panel shows "No changes since <date>" or a disabled day; it never crashes and never shows the full graph as "new". → Task 6 `test_first_run_is_baseline_without_changes`, Task 8 `changesSince handles empty and out-of-range`.

---

## File Map

| File | Responsibility |
|---|---|
| `scripts/build_official_lists.py` (modify) | Also save raw US and UK downloads to `build/raw/` when fresh |
| `scripts/fleet_base.py` (new, one-time + library) | Split current graph files into research base; load base |
| `data/fleet-base.json`, `data/kg-base.json` (new, committed once) | Fixed 25 Sep research layers |
| `scripts/fleet_official.py` (new) | Parse raw UK CSV, US CSL, OpenSanctions EU-journal and OFAC CSVs into list-derived nodes and edges |
| `scripts/fleet_merge.py` (new) | Merge base + official; naming policy; stable edge ids; compact page payload + meta |
| `scripts/kg_build.py` (new) | Influence network from fleet graph + lobbying asset + kg base |
| `scripts/changes.py` (new) | Diff two graphs → dated changes; maintain change record |
| `scripts/build_live_graphs.py` (new) | Nightly orchestrator, freshness gating, guards, stats file |
| `.github/workflows/update-lists.yml` (modify) | Build step, outputs, collect/put-in-place/git add/allowlist, issue naming |
| `stories/shadow-fleet/network/fleet-data.json` (generated) | Map payload (same shape as old `FLEET_DATA`) |
| `stories/who-lobbies/influence-network/kg.json` (generated) | Network payload (same shape as old `window.KG`) |
| `data/changes/changes.json` (generated) | Rolling 120-day change record |
| `data/site-stats.json` (generated) | Counts and dates the pages show |
| `app/changes.js` (new, ES module) | Pure change helpers + panel/calendar UI |
| `app/stats.js` (new, ES module) | Fill `[data-stat]` elements from `site-stats.json` |
| `stories/shadow-fleet/network/shadow_fleet_map.html` (modify) | Fetch payload, dynamic time range, `since` hash, panel, ghosts |
| `stories/who-lobbies/influence-network/index.html` (modify) | Fetch payload, hash handling, panel, ghosts |
| `stories/updates/index.html` + `app/updates.js` (new) | Updates page |
| `index.html`, `stories/about-the-data.html`, `stories/who-lobbies/influence-network/methods.html`, note sources (modify) | `data-stat` spans; Updates nav link |

---

### Task 1: Keep raw US and UK list downloads for the graph builder

**Files:**
- Modify: `scripts/build_official_lists.py`
- Test: `scripts/test_build_official_lists.py`

**Interfaces:**
- Produces: when a list builds fresh, its downloaded bytes are written to `build/raw/us.csv` and `build/raw/uk.csv` (only these two; `build/` is gitignored and never committed). No file is written for a list that kept its previous copy.

- [ ] **Step 1: Write failing tests.**
  - `test_fresh_lists_write_raw_copies`: with stubbed fetches, both raw files exist and are byte-equal to the stubbed downloads.
  - `test_failed_list_writes_no_raw_copy`: when the UK fetch raises, `build/raw/uk.csv` does not exist and `build/raw/us.csv` does.
- [ ] **Step 2:** Run `.venv/bin/python -m pytest -q scripts/test_build_official_lists.py` → the 2 new tests FAIL.
- [ ] **Step 3: Implement.** In the existing per-list loop, after a list passes its guards, write its bytes to `ROOT / "build" / "raw" / f"{list_id}.{ext}"` for `list_id in ("us", "uk")`. Make the output dir a module constant `RAW_DIR` that tests can override.
- [ ] **Step 4:** Run the full Python suite → all pass.
- [ ] **Step 5: Commit.** `feat(lists): keep raw US and UK downloads for the graph builder`

---

### Task 2: Split the current graphs into fixed research bases

**Files:**
- Create: `scripts/fleet_base.py`, `scripts/test_fleet_base.py`, `data/fleet-base.json`, `data/kg-base.json`

**Interfaces:**
- Produces:
  - `split_fleet(nodes: list[dict], edges: list[dict], meta: dict) -> dict`, returning `{"nodes": [...], "edges": [...], "node_fields": {id: {...research fields...}}, "meta": {findings, patterns, study_counts, title, subtitle, credits, coverage}, "generated": "2026-09-25"}`. `meta` comes from the current `meta.json`.
  - `split_kg(kg: dict) -> dict`, returning `{"nodes": [...], "edges": [...], "lob_alias": {...}, "meta": {"no_lobbying_found": ..., "live": ...}}`.
  - `load_fleet_base(path=DATA/"fleet-base.json") -> dict` and `load_kg_base(path=DATA/"kg-base.json") -> dict`.
- **Rules for `split_fleet`:**
  - An edge goes to the base when **any** of its `sources` has `angle != "lists"`. A mixed edge is kept with only its non-lists sources.
  - Edges whose sources are all `angle == "lists"` are dropped. The official builder regenerates them.
  - Nodes with no `"lists"` in `angle` go to the base whole.
  - For list-derived nodes, only these research fields go to `node_fields[id]`:
    - `research_notes`, `history`
    - `ua_former_names`, `ua_flag_countries`
    - `name_policy`, `generic_name`, `name_note`
    - `role`, `angle` (minus `"lists"`)
- **Rules for `split_kg`:** the base keeps edges with `L in ("team", "curated")`, their endpoint nodes, `live` flags and `meta.no_lobbying_found` / `meta.live`. Copy `LOB_ALIAS` from `veil-trace@88dcaa2:research/knowledge-graph/scripts/build_kg.py:43-58` into `lob_alias`.

- [ ] **Step 1: Write failing tests** in `scripts/test_fleet_base.py`.
  - `test_lists_only_edges_leave_the_base`: on a 5-edge fixture (lists-only, research-only, mixed), the base has 2 edges and the mixed one keeps only its research source.
  - `test_research_fields_kept_for_list_nodes`: `node_fields["IMO9408695"]` keeps `research_notes` and drops `listed_by`.
  - `test_generic_companies_stay_generic`: a `co:unlisted-003` node keeps `name_policy == "generic"` and its `generic_name`.
  - `test_kg_base_keeps_team_and_curated_only`: no base edge has `L` in `("fleet", "lobby")`.
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Implement** the four functions. Add a `__main__` that reads the current `stories/shadow-fleet/network/{nodes,edges,meta}.json` and `stories/who-lobbies/influence-network/kg_data.js` (strip `window.KG=` and the trailing `;`, then `json.loads`), and writes `data/fleet-base.json` and `data/kg-base.json` with `sort_keys=True, indent=0, ensure_ascii=False`.
- [ ] **Step 4:** Run the tests → PASS. Then run `.venv/bin/python scripts/fleet_base.py` once and print the counts. Expected: fleet base edges ≈ 498 + 150 (±5) and kg base edges = count of team+curated in `kg_data.js`.
- [ ] **Step 5: Commit** the script, tests and both generated base files: `feat(graphs): fixed 25 Sep research bases for the live graphs`.

---

### Task 3: Official layer from the lists

**Files:**
- Create: `scripts/fleet_official.py`, `scripts/test_fleet_official.py`, `scripts/fixtures/fleet/{uk_sample.csv,csl_sample.csv,os_eu_journal_sample.csv,os_ofac_sample.csv}`

**Interfaces:**
- Consumes: `build/raw/uk.csv`, `build/raw/us.csv` (Task 1), and two OpenSanctions CSVs downloaded by this module:
  - `https://data.opensanctions.org/datasets/latest/eu_journal_sanctions/targets.simple.csv`
  - `https://data.opensanctions.org/datasets/latest/us_ofac_sdn/targets.simple.csv`
- Produces:
  - `norm_co(name: str) -> str`, ported verbatim from `veil-trace@88dcaa2:tools/fleet/network/build_base.py:59-72`.
  - `co_id(name) -> str` returning `"co:" + norm_co(name)`.
  - `parse_uk(text: str) -> tuple[list[dict], list[dict]]`, `parse_csl(text: str) -> tuple[...]`, `parse_os_eu_journal(text: str) -> tuple[...]`, `parse_os_ofac_dates(text: str) -> dict[str, str]` (IMO → first_seen date).
  - `build_official(raw_dir: Path, fetch=fetch_text) -> dict` returning `{"nodes": [...], "edges": [...]}` in the long `nodes.json`/`edges.json` shape:
    - nodes: `id, type, name, aliases, imo, programs, listed_by, listing_dates, flag_now, ship_type, ...`
    - edges: `source, target, type, date, source_url, record, quote, confidence="Documented", sources=[{url, file, quote, record, angle:"lists", confidence}]`
- **What it ports:** the official parts of `build_base.py`:
  - **UK (`:114-168`):** `designated_by`→`gov:uk` with record = Unique ID and `source_url` = `https://search-uk-sanctions-list.service.gov.uk/designations/<ID>/Ship`; `flagged_in`, `formerly_flagged_in`, `operates`, `formerly_operated`.
  - **CSL Treasury vessels (`:195-251`):** `designated_by`→`gov:us` with record `OFAC ent_num <n>` and `source_url` `https://sanctionssearch.ofac.treas.gov/Details.aspx?id=<n>`; flags; `remarks` "Linked To: X" → `linked_to`; `vessel_owner` → `owns`.
  - **EU journal via OpenSanctions (`:253-270`):** `designated_by`→`gov:eu`, with `source_url` = the OpenSanctions entity page `https://www.opensanctions.org/entities/<id>/` and label "EU Official Journal, via OpenSanctions".
  - **OFAC `first_seen` (`:181-192`):** the US date where the CSL has none, labelled "via OpenSanctions".
  - **Excluded:** fuzzy merges and name-based country guesses.

- [ ] **Step 1: Make the fixtures.** Cut ~10 real rows per source from today's downloads: include TASSOS (IMO 9408695, UK `RUS3483`, OFAC ent_num 54815) and its manager "Zulu Ships Management", one ship with a former flag, and one EU-journal ship.
- [ ] **Step 2: Write failing tests.**
  - `test_tassos_designations`: three `designated_by` edges from `IMO9408695` to `gov:uk`, `gov:us` and `gov:eu`, with the UK and OFAC per-entry URLs above.
  - `test_linked_to_creates_company_edge`: a `linked_to` edge to `co_id("Zulu Ships Management …")` exists.
  - `test_ids_are_stable_across_runs`: two runs on the same fixtures give identical sorted node and edge keys.
  - `test_no_fuzzy_company_merge`: two companies differing only by "LLC" vs "L.L.C." normalise the same through `norm_co`; two different names never merge.
  - `test_eu_status_source_label`: the EU edge's source label contains "via OpenSanctions".
- [ ] **Step 3:** Run → FAIL. **Step 4:** Implement. **Step 5:** Run → PASS.
- [ ] **Step 6: Check against real data.** Run `build_official` on today's raw files with a live fetch. Compare its `(source, target, type)` keys with the lists-only edges in the current `edges.json`, and print the overlap %, the top 10 missing and the top 10 new. Expected: ≥85% overlap. Lists changed since 25 Sep, so it won't be 100%. Note the result in the commit message. If overlap is <85%, stop and report (BLOCKED) with the diff summary.
- [ ] **Step 7: Commit.** `feat(graphs): official fleet layer from UK, US and EU-journal data`

---

### Task 4: Merge, naming policy, stable ids and the page payload

**Files:**
- Create: `scripts/fleet_merge.py`, `scripts/test_fleet_merge.py`

**Interfaces:**
- Consumes: `load_fleet_base()` (Task 2), `build_official()` output (Task 3).
- Produces:
  - `edge_id(source: str, target: str, type_: str) -> str`, as `"e:" + sha1(...)[:12]`.
  - `merge(base: dict, official: dict) -> dict` returning `{"nodes": [...], "edges": [...]}` in long form:
    - every node and edge carries `"layer": "research" | "official"`;
    - list status and dates come from official;
    - research fields from `base["node_fields"]` are re-attached.
  - `apply_naming_policy(graph: dict) -> dict`, ported from `veil-trace@88dcaa2:tools/fleet/network/merge.py:194-224`, with one change: generic ids come from the base and are **never renumbered**.
  - `compact(graph: dict, generated: str) -> dict` returning `{"nodes","edges","sources","quotes","meta"}` in exactly today's `FLEET_DATA` shape (see `merge.py:333-355`):
    - edges are `{"i","s","t","y","d","c","src":[[srcIdx,quoteIdx,record,angle,"D"|"L"]],"n"?}`, with `"i"` = `edge_id`;
    - `meta.generated` = the run date;
    - `meta.counts` is recomputed.
  - `meta` keeps `findings`, `patterns`, `study_counts`, `title`, `subtitle`, `credits` and `coverage` from `base["meta"]`.
  - **List status:** the official layer owns it. The orchestrator (Task 7) only rebuilds the fleet when every official input is fresh, so a missing status in official data means the ship is no longer listed by that authority.

- [ ] **Step 1: Write failing tests.**
  - `test_research_item_survives_when_official_is_empty`: merging the base with an empty official layer keeps every base edge.
  - `test_official_wins_for_status`: base says `listed_by: ["us"]`, official says `["us","uk"]`; the merged node has `["uk","us"]` (sorted).
  - `test_research_only_node_has_no_list_status`: a base node absent from the official layer keeps `listed_by: []` and `layer: "research"`.
  - `test_generic_ids_not_renumbered`: `co:unlisted-003` keeps its id after merge.
  - `test_compact_matches_page_shape`: the keys of `compact(...)` equal the old blob's top-level keys, and the first edge has `i`, `s`, `t`, `y`, `src`.
  - `test_compact_is_deterministic`: two runs give byte-identical `json.dumps(sort_keys=True)`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5: Commit.** `feat(graphs): merge base and official layers into the map payload`

---

### Task 5: Influence network from the live fleet graph and lobbying

**Files:**
- Create: `scripts/kg_build.py`, `scripts/test_kg_build.py`

**Interfaces:**
- Consumes:
  - `merge()` output (Task 4);
  - the lobbying asset (`build/lobbying.json.gz`). If that's absent because lobbying kept its previous copy, read yesterday's lobby layer from the committed `kg.json` instead;
  - `load_kg_base()` (Task 2).
- Produces: `build_kg(fleet: dict, lobby: dict | None, base: dict, previous_kg: dict | None, generated: str) -> dict` returning `{"meta","nodes","edges"}` in today's `window.KG` shape.
  - Port `veil-trace@88dcaa2:research/knowledge-graph/scripts/build_kg.py:78-202` (fleet layer, lobby layer, bridges `br`, orphan-ship drop and count) using `base["lob_alias"]`.
  - Add `meta.generated`.
  - When `lobby is None`, copy yesterday's `L == "lobby"` nodes and edges from `previous_kg` unchanged.

- [ ] **Step 1: Write failing tests.**
  - `test_nord_stream_lobby_edges_present`: with the lobbying fixture `scripts/fixtures/lobbying_sample.json` (cut from today's asset), there is a `hired` edge from `co:nord-stream-2`.
  - `test_lobby_layer_carried_when_lobbying_stale`: with `lobby=None`, the lobby nodes and edges equal `previous_kg`'s.
  - `test_team_and_curated_edges_always_present`: every base edge is in the output.
  - `test_generic_fleet_names_hidden`: a generic fleet node's `n` is its `generic_name` and it has no aliases.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5: Check against real data.** Rebuild from today's data and compare node ids with the current `kg_data.js` by layer. Expected ≥85% of current fleet node ids and ≥85% of lobby node ids present. Report the numbers in the commit message.
- [ ] **Step 6: Commit.** `feat(graphs): rebuild the influence network nightly`

---

### Task 6: Daily change record

**Files:**
- Create: `scripts/changes.py`, `scripts/test_changes.py`

**Interfaces:**
- Produces:
  - `Change` is a dict with these keys:
    - `date`
    - `graph` (`"fleet"|"lobby"`)
    - `kind` (`"added"|"removed"|"changed"`)
    - `item` (`"node"|"edge"`)
    - `id`, `name`, `node_type`
    - `field?`, `from?`, `to?`
    - `endpoints?` (`[sourceName, targetName]` for edges)
    - `summary`, `source_url`, `source_label`
  - `diff(prev: dict | None, curr: dict, graph: str, date: str, unavailable: set[str]) -> list[Change]`:
    - It compares only `layer == "official"` items (fleet) or `L in ("fleet","lobby")` items (kg).
    - Node fields compared: `name`, `flag_now`, `listed_by`, `programs`. Lobby additions: new `hired`, `lobbyist_at`, `lobbied` and `lobbied_on` edges, and new firm, lobbyist, agency and bill nodes.
    - It returns `[]` when `prev is None` (baseline).
    - Items attributable to a source in `unavailable` are skipped. A list name maps to the `gov:` targets it produces, and `"lobbying"` covers the lobby layer.
    - Lobby-layer edges never produce `removed` changes. LDA filings don't get deleted; a missing edge means a fetch gap.
  - `summarize(change: Change) -> str` produces plain English. Exact forms:
    - `"UK listed TASSOS (IMO 9408695)"`
    - `"EU removed ADISA (IMO 9341279)"`
    - `"New link: TASSOS → Zulu Ships Management (managed by)"`
    - `"TASSOS changed flag: Liberia → Cameroon"`
    - `"Nord Stream 2 AG hired Capitol Counsel LLC"`
  - `update_record(record: dict | None, date: str, changes: list[Change], sources: dict[str, str], keep_days: int = 120) -> dict` returns `{"started": firstDate, "days": [{"date", "sources": {name: "fresh"|"unavailable"}, "changes": [...]}]}`, sorted newest first, trimmed to `keep_days`. If `date` is already present, that day is replaced (re-runs are idempotent).

- [ ] **Step 1: Write failing tests**, using small handmade graphs.
  - `test_first_run_is_baseline_without_changes`: `diff(None, g, ...) == []`, and `update_record(None, ...)` sets `started` to that date.
  - `test_added_and_removed_ship`
  - `test_flag_change`: summary `"TASSOS changed flag: Liberia → Cameroon"`.
  - `test_research_items_never_change`: research-layer additions and removals give `[]`.
  - `test_kept_previous_source_records_no_changes`: with `unavailable={"uk"}`, a UK-only edge missing from `curr` gives no change, and the day's `sources["uk"] == "unavailable"`.
  - `test_opensanctions_id_churn_is_not_a_change`: the same IMO/list-keyed graph with different `record` strings ("OpenSanctions NK-abc" → "OpenSanctions NK-xyz") gives `[]`.
  - `test_lobby_edges_never_removed`
  - `test_record_trims_and_replaces_same_day`
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5: Commit.** `feat(graphs): daily change record`

---

### Task 7: Nightly orchestrator and stats file

**Files:**
- Create: `scripts/build_live_graphs.py`, `scripts/test_build_live_graphs.py`

**Interfaces:**
- Consumes: Tasks 2–6, `data/lists/meta.json`, `data/lobbying-meta.json`, `build/lobbying.json.gz` (may be absent).
- Produces: `build(now: str | None = None, fetch=fetch_text, paths: Paths = DEFAULT_PATHS) -> int`, returning exit code 0 or 1. It writes:
  - `stories/shadow-fleet/network/fleet-data.json`, from `compact()`;
  - `stories/shadow-fleet/network/nodes.json` and `edges.json`, the merged long form, kept because `scripts/build_research_index.py:312-313` reads them;
  - `stories/who-lobbies/influence-network/kg.json`;
  - `data/changes/changes.json`;
  - `data/site-stats.json`;
  - `data/live-graphs-meta.json`: `{label, checked_at, status: "fresh"|"kept-previous", error?, updated_at, record_count: <fleet edges>}`, the same shape as other `*-meta.json`.
- **Rules:**
  - **Fleet freshness gate:** if `uk` or `us` in `data/lists/meta.json` is not `fresh`, or a raw file is missing, or an OpenSanctions CSV fetch fails, do not rebuild the fleet. Keep yesterday's `fleet-data.json`, mark those sources `unavailable` in today's record, and still rebuild the kg lobby layer if lobbying is fresh.
  - **Shrink guard:** reject (keep previous, exit 1) if the official fleet edge count drops >20% versus yesterday's.
  - **Sample check:** TASSOS (`IMO9408695`) has an edge to a node whose name contains "Zulu".
  - **Stats file:** `site-stats.json` = `{"generated": date, "fleet": {"ships","companies","people","countries","edges","lead_edges"}, "kg": {"nodes","edges","lead_edges","ships","companies","lobbyists","lobby_firms","filings_kept","filings_scanned"}, "lists": {"us","uk","eu","un"} (record counts), "opensanctions_sources": <int from opensanctions-meta or 95>}`.
  - All JSON is written with `sort_keys=True, ensure_ascii=False, separators=(",", ":")`.

- [ ] **Step 1: Write failing tests**, with tmp paths and fixtures from Tasks 2–5.
  - `test_fresh_run_writes_all_outputs`
  - `test_stale_input_keeps_previous_graphs`: UK meta `kept-previous` leaves `fleet-data.json` byte-identical, the day's sources include `uk: unavailable`, and there are no fleet changes.
  - `test_shrink_guard_rejects`
  - `test_missing_sample_rejects`
  - `test_stats_match_payload`: `site-stats.fleet.ships` equals the ship count in `fleet-data.json`.
  - `test_outputs_are_plain_json_paths`: every written path ends in `.json`.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5: Bootstrap the first run.** Run `.venv/bin/python scripts/build_official_lists.py && .venv/bin/python scripts/build_lobbying.py; .venv/bin/python scripts/build_live_graphs.py` locally. This network run makes the baseline. Commit the generated `fleet-data.json`, `kg.json`, `changes.json` (one baseline day, `started` = today), `site-stats.json` and `live-graphs-meta.json`. Do **not** commit `data/lists` changes from this local run (`git checkout data/lists data/*-meta.json` except `live-graphs-meta.json`).
- [ ] **Step 6: Commit.** `feat(graphs): nightly live-graph build, baseline day`

---

### Task 8: Changes panel and calendar (shared front end)

**Files:**
- Create: `app/changes.js`, `tests/changes.test.js`; append `.chg-*` styles to `app/style.css`

**Interfaces:**
- Consumes: `data/changes/changes.json` (Task 6 shape), `escapeHtml` and `safeUrl` from `app/render.js`.
- Produces (ES module exports):
  - `changesSince(record, graph, sinceISO, todayISO) -> Change[]`: newest first; `[]` for an empty record, `since > today`, or `since < record.started` (then clamped to `started`).
  - `daysWithChanges(record, graph) -> Set<string>`
  - `presetSince(preset: "yesterday"|"7d"|"10d", todayISO) -> string`
  - `renderChangeList(changes, {limit = 50, updatesHref}) -> string`: escaped HTML. Past the limit it ends with `"+N more · see all on the Updates page"`.
  - `mountChangesPanel(root: HTMLElement, {record, graph, today, onWindow(sinceISO, changes), onSelect(change)}) -> {setSince(iso), destroy()}`. It renders:
    - preset buttons Yesterday / 7 days / 10 days / **Pick a day**;
    - an accessible month calendar: a `role="grid"` of buttons, arrow-key navigation, a dot on days with changes, days before `started` and after today `disabled`, ‹ › month buttons;
    - the heading `"Since <D Mon> · N changes"`;
    - the list.

    It calls `onWindow` whenever the window changes and `onSelect` on list click or Enter. With no record or zero changes it shows `"No changes since <D Mon YYYY>."`.

- [ ] **Step 1: Write failing tests** (`node:test`).
  - `changesSince handles empty and out-of-range`: empty record → `[]`; `since` after today → `[]`; `since` before `started` → treated as `started`.
  - `daysWithChanges marks only days with changes for the graph`
  - `renderChangeList escapes names`: `<img src=x onerror=alert(1)>` appears only as `&lt;img`.
  - `renderChangeList caps at 50`: 200 changes → 50 `<li>` items plus `"+150 more"`.
  - `presetSince`: 7 days before `2026-10-19` = `2026-10-12`.
- [ ] **Step 2:** Run `npm test` → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5: Commit.** `feat(ui): changes panel and calendar`

---

### Task 9: Shadow-fleet map goes live

**Files:**
- Modify: `stories/shadow-fleet/network/shadow_fleet_map.html`
- Delete: the inline `window.FLEET_DATA=` blob (line ~244). `nodes.json` and `edges.json` stay, regenerated nightly by Task 7.
- Test: `tests/smoke.spec.js` (new map tests)

**Interfaces:**
- Consumes: `fleet-data.json` (Task 7), `app/changes.js` (Task 8), `data/changes/changes.json`.
- **Behaviour:**
  - **Loading:** the page fetches `fleet-data.json` (same folder). While it loads it shows the existing loading state; on failure it shows "Map data unavailable right now" with Retry.
  - **Time slider:** the slider range comes from the data: `TMAX` = months from Jan 2019 to `meta.generated`, and the markup `max` is set at runtime.
  - **Footer:** "Data built <meta.generated>" comes from the payload.
  - **Panel:** a "What changed" section is added to the rail, mounted with `mountChangesPanel(..., {graph: "fleet"})`.
    - `onWindow` adds class `chg-new` to nodes and edges added in the window, and draws **ghost** elements (class `chg-removed`, dashed `--color-neutral`, not clickable for details) for removed items, using the change's `id`, `name` and `endpoints`.
    - `onSelect` calls the existing `focusNode(id)`. For a removed item it centres on the ghost.
  - **Hash:**
    - It accepts `since=YYYY-MM-DD` with `focus`: for example `#focus=IMO9408695&since=2026-10-12` opens with that window and focus.
    - It adds a `hashchange` listener that re-applies `focus`, `select` and `since`.
    - Values are validated: ids must exist in `byId` or the change record, and the date must match `^\d{4}-\d{2}-\d{2}$`.
  - **Legend:** a "New since" swatch and a "Removed" swatch are added to the existing `.lg` legend.

- [ ] **Step 1: Write failing smoke tests.** Stub `fleet-data.json` and `changes.json` via `page.route` with small fixtures that include an added ship and a removed ship.
  - `map loads data by fetch and shows Data built date`
  - `since window highlights added ship and draws removed ghost`
  - `deep link #focus=…&since=… opens focused with window`
  - `hashchange re-focuses`
  - `200 changes highlight without timeout`: a fixture with 200 added nodes; the panel renders within 3 s and shows "+150 more".
  - `map shows retry when data fails`
- [ ] **Step 2:** Run `npm run smoke` → new tests FAIL. **Step 3:** Implement. **Step 4:** Run → all PASS (existing map smoke tests included).
- [ ] **Step 5: Check by eye.** At 1280 and 375 with the production CSP injected: no console errors, page weight ≤ old page + 10%, first graph render ≤ old + 500 ms. Screenshots go to the scratchpad.
- [ ] **Step 6: Commit.** `feat(map): live data, changes panel and calendar`

---

### Task 10: Influence network goes live

**Files:**
- Modify: `stories/who-lobbies/influence-network/index.html`
- Delete: `kg_data.js` (replaced by `kg.json`). Update `scripts/specific_sources.py` and any tests that read `kg_data.js` to read `kg.json`.
- Test: `tests/smoke.spec.js`

**Interfaces:**
- Consumes: `kg.json` (Task 5/7), `app/changes.js`, `changes.json`.
- **Behaviour:**
  - **Loading:** it fetches `kg.json` and keeps the existing render and story code operating on the parsed object (`window.KG` assigned from the fetch result before the existing init runs).
  - **Counts:** they come from `meta.counts` (already).
  - **Story:** step text with hard-coded figures (e.g. "18 ship managers", "seven shipping companies") is labelled "as of 25 September 2026" if it's a research finding, or computed from data if it's a live count.
  - **Panel:** a changes panel (`graph: "lobby"`, also showing fleet-layer changes that touch kg nodes) goes into a "What changed" control in the top bar that opens a drawer.
  - **Highlights:** new nodes and links get `--chg-new` rings and particles; removed items are ghosts.
  - **Hash:** a new hash handler accepts `#focus=<id>&since=YYYY-MM-DD`, validated like Task 9, plus a `hashchange` listener.

- [ ] **Step 1: Write failing smoke tests**, with stubbed `kg.json` and `changes.json`.
  - `network loads kg.json`
  - `since window rings new lobbying firm`
  - `deep link focus works`
  - `network shows retry when data fails`
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5: Check by eye** at 1280 and 375 (same checks as Task 9 Step 5).
- [ ] **Step 6: Commit.** `feat(network): live data, changes panel and deep links`

---

### Task 11: Updates page and nav link

**Files:**
- Create: `stories/updates/index.html`, `app/updates.js`, `tests/updates.test.js`
- Modify: the header nav on every page with the main header (add "Updates" to `nav.nav-graphs`), `tests/smoke.spec.js` (nav test now expects 3 links)

**Interfaces:**
- Consumes: `changes.json`, `renderChangeList` and `changesSince` from `app/changes.js`.
- Produces: `renderUpdates(record, {from, to, graph: "all"|"fleet"|"lobby"}) -> string`, grouped by day, newest first.
  - Each day lists its changes with **Show on map** (`../shadow-fleet/network/shadow_fleet_map.html#focus=<id>&since=<date>`) or **Show on network** (`../who-lobbies/influence-network/index.html#focus=<id>&since=<date>`).
  - Each change links its source (`safeUrl`, label = `source_label`).
  - A day with unavailable sources shows `"<Source> unavailable; showing the previous data."`.
  - A day with zero changes shows `"No changes on the lists."`.
  - Before `started` the page shows `"Daily updates started on <date>."`.
- **Page:** the main design (header, footer, tokens). Filters are `<input type="date">` from/to (defaults: last 10 days) plus a graph select. The filter state lives in the URL query (`?from=&to=&graph=`). On the narrow page, links wrap.

- [ ] **Step 1: Write failing tests.**
  - `renderUpdates groups by day newest first`
  - `renderUpdates shows unavailable source note`
  - `renderUpdates escapes names and uses safeUrl`
  - **Smoke:** `updates page escapes hostile names`, `Show on map link carries focus and since`, and the nav test asserting `Shadow fleet map`, `Influence network` and `Updates` on every page.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement. **Step 4:** Run → PASS.
- [ ] **Step 5: Commit.** `feat(ui): Updates page and nav link`

---

### Task 12: Pages read their figures from the data

**Files:**
- Create: `app/stats.js`, `tests/stats.test.js`, `scripts/test_site_figures.py`
- Modify:
  - `index.html` (ships and reports cards)
  - `stories/about-the-data.html:41,46`
  - `stories/who-lobbies/influence-network/methods.html:82-86,94,118,123,129-131`
  - note sources (`stories/who-lobbies/influence-network/README.md:13,31,70,83`), then regenerate with `scripts/build_docs.py`. **Depends on PR #25 being merged first**; if it isn't, skip the notes part and record that in the task report.

**Interfaces:**
- Produces:
  - `fillStats(root = document, stats) -> number`, returning the count filled.
    - Every element with `data-stat="kg.nodes"` (a dotted path into `site-stats.json`) gets that value formatted with `toLocaleString("en-GB")`.
    - Unknown paths keep their fallback text.
  - `loadAndFill()` fetches `/data/site-stats.json` once and is a no-op on failure.
  - **`build_docs.py` token:** `{{stat:kg.nodes}}` in a note's Markdown renders `<span data-stat="kg.nodes">3,183</span>`, with the fallback taken from `data/site-stats.json` at generation time.
- **Rules:**
  - Live counts become `<span data-stat="…">fallback</span>`.
  - Figures that are 25 September research findings stay as text and are labelled "(as of 25 September 2026)" where not already.
  - Pages that use `stats.js` load it as `<script type="module" src=".../app/stats.js">`.

- [ ] **Step 1: Write failing tests.**
  - `fillStats fills known paths and leaves unknown`
  - `fillStats formats 3183 as 3,183`
  - `test_site_figures.py::test_every_data_stat_key_exists`: every `data-stat` in served HTML resolves in `data/site-stats.json`.
  - `test_site_figures.py::test_every_data_stat_value_is_a_number`: every `data-stat` path resolves to an integer in `data/site-stats.json`.
  - **Why fallbacks aren't compared with current values:** the nightly publish may only commit JSON, so HTML fallbacks go stale by design, and the runtime fill is the source of truth.
- [ ] **Step 2:** Run → FAIL. **Step 3:** Implement and mark up the pages. **Step 4:** Run → PASS.
- [ ] **Step 5: Commit.** `feat(ui): pages show live counts from site-stats.json`

---

### Task 13: Wire it into the nightly workflow and document it

**Files:**
- Modify: `.github/workflows/update-lists.yml`, `README.md`, `stories/about-the-data.html` (a short "How the graphs update" paragraph), `vercel.json` (`/data/changes/*` and the two payloads get `Cache-Control: public, max-age=300, must-revalidate`), `docs/specs/2026-10-19-live-graphs-and-chat-design.md` (note Part 1 built)

**Interfaces:**
- **Build job:** a new step after `chipsbuild`: `- name: Build live graphs`, `id: graphsbuild`, `continue-on-error: true`, `timeout-minutes: 20`, `run: python scripts/build_live_graphs.py`. Add the output `graphs: ${{ steps.graphsbuild.outcome }}`.
- **Collect / put in place / `git add`:** add these paths:
  - `stories/shadow-fleet/network/fleet-data.json`
  - `stories/shadow-fleet/network/nodes.json`
  - `stories/shadow-fleet/network/edges.json`
  - `stories/who-lobbies/influence-network/kg.json`
  - `data/changes/changes.json`
  - `data/site-stats.json`
  - `data/live-graphs-meta.json`
- **Allowlist regex:** becomes exactly
  `^(data\/lists\/[a-z]+\.json|data\/[a-z-]+-meta\.json|data\/site-stats\.json|data\/changes\/changes\.json|stories\/chips-into-russia\/data\/[a-z_-]+\.json|stories\/shadow-fleet\/network\/(fleet-data|nodes|edges)\.json|stories\/who-lobbies\/influence-network\/kg\.json)$`.
  The `[a-z-]+-meta` change is needed because `live-graphs-meta.json` has a hyphen.
- **Issue step:** `GRAPHS_BUILD: ${{ needs.build.outputs.graphs }}`. When it is `failure`, append `", live graphs"` to `up`.

- [ ] **Step 1: Make the edits.** Run actionlint (binary in the scratchpad from earlier sessions, or download and verify the checksum) → 0 findings.
- [ ] **Step 2: Test the allowlist.** In a throwaway repo, stage each new path (pass), plus `stories/shadow-fleet/network/evil.html` and `stories/who-lobbies/influence-network/kg_data.js` (fail). Paste the output into the task report.
- [ ] **Step 3:** Run the full suites (`pytest`, `npm test`, `npm run smoke`) → PASS.
- [ ] **Step 4: Commit.** `ci: build live graphs nightly`
- [ ] **Step 5: After merge (owner):** run `gh workflow run update-lists.yml --ref main`. Then check that both jobs pass, the publish commit includes the new JSON files, and the live map shows today's "Data built" date.
