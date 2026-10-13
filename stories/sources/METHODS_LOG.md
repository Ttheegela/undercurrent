# Methods log: how we find and check sanctions-evasion leads (Fri 25 Sept 2026)

What we did, how, what it found, what worked, what didn't. Newest entries last in each section. Times EDT.
Rating: **works** · **works with care** · **weak** · **failed**. Findings themselves live in `LOG_2026-09-25.md`; questions in `QUESTIONS_2026-09-25.md`.

---

## A. Discovery methods (how we find leads)

| # | Method | How (tools / recipe) | What it found | Rating | Lessons |
|---|---|---|---|---|---|
| A1 | **Route facets by product code** | Sayari `search_trade_facets` with `hs_code` + arrival/departure country; read bucket counts and first/last dates | New chip (HS 8542) routes into Russia via Kyrgyzstan, UAE, Kazakhstan from Apr-May 2022 | works | Use bucket counts, not `total_available` (capped at 10,000). Date filter is ignored: get dates from rows. Single keyword only for text facets. |
| A2 | **Mirror statistics (countries' own reports)** | UN Comtrade free preview API, reporter -> Russia, by HS code and year | Independent confirmation: Kyrgyzstan ~$0 -> $13.5M (2023) chips; Kazakhstan -> $18.3M (2022); Armenia -> $13.1M (2022) | works with care | Filter to aggregate rows only (isAggregate, motCode 0, partner2Code 0), or totals double. Pre-2014 rows are flagged differently. Rate-limited: 3.5 s between calls. Declared values; latest year may be partial. |
| A3 | **Re-export share** | Compare departure country with product-origin country in the same facet | Turkey: only 988 of 21,537 chip shipments to Russia were Turkish-made | works | Normal for trading hubs; a signal, not proof. |
| A4 | **Concentration on a route** | Top-1/top-2 shipper share per route | Kazakhstan: ELEM GROUP 93% of the route | works | Narrow routes are both fragile and easy to spot. |
| A5 | **Follow listed firms' trading partners** | Tradeverifyd `entity_trade_relationships` / `annotated_relationship_paths`; Sayari `search_shipments` by name | Daqo (Entity List) -> Enkor Grupp (OFAC): 5 shipments after listing; Sinno -> Titan-Micro: 24 after | works | Match by tax / registration numbers, not names. Tradeverifyd links have no dates or volumes. |
| A6 | **Ownership traversal** | Sayari `get_entity_profile` (has `shares_pct`, `former`), `find_beneficial_owners`, `find_downstream_entities` | Tanker Velikiy Novgorod listed while its owner Boreray (Sovcomflot subsidiary) isn't; NIS at 44.85% | works with care | **Always check `former`**: the Sovcomflot->Cyprus->Dubai chain was former ownership. Downstream includes minority stakes: "downstream" isn't "controlled". |
| A7 | **Front-company timing** | Registration date vs trigger date; Kyrgyz tax IDs encode the date | ELEM (18 days after invasion), RM Design (21 days), GTME (tax ID date pattern) | works | Timing is a multiplier, not a signal alone (many real firms moved post-2022). |
| A8 | **Churn analysis ("same river, new boats")** | Full shipment rows per route; merge name variants; firms per half-year, active days, handovers | Kyrgyz route: 1 -> 4 -> 12 -> 6 firms while flow continued; median firm active 40 days; 4 of 5 listed shippers stopped before listing | works | Merge spelling variants first (RM Design had 6 records). Check "new" firms for earlier bursts (GTME). |
| A9 | **Buyer anchoring** | Sayari shipments to one buyer across years; supplier sets per period | Testkomplekt: one record 2019-2025, three supplier generations, received 22 months after its listing | works | Confirm buyer by entity id; name filter unreliable. |
| A10 | **Part-number fingerprint** | Sayari `search_shipments` with the full ordering code in the query | Xilinx: 58 shipper names, 45 seen one month only; STM32F765VIT6 exact part | works with care | Needs the full ordering code (STM32F765 = 0 hits; STM32F765VIT6 = 3). |
| A11 | **Weapon-to-route trace** | Ukraine GUR components DB (part + maker) -> Sayari exact-part search -> list check | Shahed-136 chip: ACE (HK) -> Onelek, 2022-08-26, 100 pcs; all firms listed later | works with care | Chip-to-weapon link is never proven by shipments. GUR is a party to the war. Maker-name matches are weak. |
| A12 | **Alias and ID cross-check** | Exact normalised aliases + identifiers from US/EU/UK/UA lists vs sponsor records flagged clean | A Russian firm matches UK-listed LLC Phoenix (same tax, registration number, address) | works | Most "gaps" were split duplicates of already-flagged records; require ID/address/country agreement to call it the same company. |
| A13 | **Sibling finder** | Normalised address + shared trading partner; weight 1/log(tenants) | Back-test: 240 Russia-programme address pairs listed ~167 days apart | works with care | Strict address key is sound; loose matcher false-merges (plot buildings, same street in different cities). Registered-agent addresses (Monrovia) are noise. |
| A14 | **Listing lag** | First suspicious date vs official listing date (OFAC recent-actions, Federal Register, UK list) | Front companies listed 15-23 months after appearing | works | Official pages only; show lags as "at least" (data thins after late 2023). |
| A15 | **Web corroboration** | Tavily `corroborate`: official domains first (treasury, OFAC, BIS, gov.uk, EU), then investigative outlets | 10 of 12 leads confirmed; caught ITIC listed, Sinno's real date | works | Advanced depth; general topic (news topic missed official pages). Never cite the AI summary: it invented a paragraph once. |
| A16 | **Blind-spot mapping** | Sayari `lookup_data_sources`; own vs partner records per country; compare with Comtrade | No own records for Kyrgyzstan, Armenia, Hong Kong...; Armenia 2 Sayari rows vs $13.1M own report | works | The gaps are evidence too; say them out loud. |
| A17 | **Tradeverifyd risk paths** | `annotated_relationship_paths` from a known company | Xinjiang polysilicon cluster; cobalt chain Glencore Commodities -> Huayou -> CATL | works with care | Flags often belong to neighbours; score is higher = safer; place search and country filter don't work. |
| A18 | **AI-chip text search** | Sayari product text ("NVIDIA", "H100") by destination | 2,474 NVIDIA rows into Russia; China nearly dark | works | Text search is noisy ("GPU" hit filters). |
| A19 | **All departure countries per firm** | Sayari `search_trade_facets` per listed firm, all departure countries at once, with first/last dates per country | Rama Group and Shisan ran Kyrgyzstan, Thailand and Hong Kong at the same time; the Kyrgyz leg stopped, the firm kept shipping. RM Design moved to Turkey 24 days BEFORE listing | works | Looking at one route makes a firm look "stopped" when it only dropped a leg. Ask "did the firm stop?" and "did the route stop?" separately. |
| A20 | **Hub concentration (one country as a hub)** | Top-30 suppliers on a route, grouped by firm (Sayari splits one firm into many records), plus top buyers; then list check on each | Turkey: one logistics firm ~45% of chip shipments, one buyer 61%; 9 of the top 10 firms now on US lists, listed 2-31 months after first shipping | works | Group split records by hand before counting (one firm had 6 records). A logistics firm ships for many clients: concentration is a signal, not guilt. |
| A21 | **Shared-address pivot** | Take a listed firm's exact street address from shipment rows; search lists and web for other firms at the same unit | GQ Solution (OFAC) at the exact Istanbul unit RM Design used; a secondary source links them | works with care | Big office towers hold hundreds of firms: needs the exact unit number plus a second signal. Secondary sources stay agency-only. |

## B. Verification methods (how we check)

| # | Method | What it caught | Rating |
|---|---|---|---|
| B1 | **Independent verifier per investigator** (re-derives every figure from saved raw files, never from the report) | "Former" ownership reported as current; bearings figure with no saved file; Turkey bearings meaningless; Glory fleet claim on 1 of 7 ships | works |
| B2 | **Official page for every listing date** | Sinno's "2023-04-20" (OpenSanctions dataset start) vs real 2022-09-30; RM Design 2023-07-20 not Aug 8 | works |
| B3 | **Checker + official page, never a sponsor flag alone** | ITIC flagged "not sanctioned" by Sayari but OFAC-listed 2024-06-12 | works |
| B4 | **Run the tool on known positives** | Checker missed "Hoshine Silicon", then "Katrade", then "GTME" (short/transliterated) | works (and still finding gaps) |
| B5 | **Two independent signals per lead** | Stopped the Istanbul tower (194 tenants) becoming a "front company" claim | works |
| B6 | **ID / address / country agreement before "same company"** | Turkish RM DESIGN record demoted to agency-only | works |
| B7 | **Cross-source triangulation** (sponsor data vs countries' own statistics vs official pages) | Confirmed routes are new, not a data artifact | works |
| B8 | **Save every raw answer with its time; cite the file** | Made B1 possible; exposed the file-overwrite bug | works |
| B9 | **Pull every page before counting** | The first RM Design Turkey pull showed 25 rows; the full pull showed 76 (40 after listing). A partial page nearly became a headline number | works |
| B10 | **Verifier recomputes counts from the saved file** | "Alfa Trading 413 shipments" was in no file (323 exact, 587 loose); "HKG 519 / THA 692" corrected to 576 / 693 | works |

## C. What didn't work (traps and dead ends)

| Trap | Where | Fix / workaround |
|---|---|---|
| Summing all Comtrade rows | our 10:00 figures ($52M Armenia) | Aggregate rows only (corrected 10:19) |
| Sayari date filter ignored | shipments, facets | Read dates from rows |
| Sayari receiver_name filter returns other buyers | Titan-Micro pull | Use query text; check buyer entity id |
| Sayari `limit` ignored | networks, watchlist | Trim in code; small pages |
| Sayari upstream-chain tool with product filter | errored, hung 10+ min | Don't use |
| Sayari "sanctioned" can mean other countries' lists | Lockheed near Chalco | Checker + official page |
| Tradeverifyd place search, country filter | timed out / ignored | Seed from lists or Sayari |
| OpenSanctions `first_seen` as a listing date | Sinno | Official pages; 2023-04-20 = dataset start |
| Exact-string list search | missed ITIC | Normalised + fuzzy checker |
| Checker blind to short/transliterated names | Hoshine, Katrade, GTME | Contained multi-word and rare single-word rules added; GTME still open |
| Our intake tool with unfamiliar tool names | Tradeverifyd | Small direct caller with its own read-only allowlist |
| Save files named to the second | two raw answers overwritten | Microseconds + process id in names |
| Parallel agents sharing scratch scripts | nearly posted as wrong agent | Per-agent folders |
| Screening only against asset-freeze lists | Shisan Ltd and Rama Group are on EU Annex IV (export restrictions, 2026-07-24), invisible to our checker | Add EU Annex IV and other export-control lists to the checker |
| Reading Sayari's "origin" as where goods were made (Turkey route) | RM Design rows all say Turkish origin, including Taiwan-made chips | Treat as a likely default; use the product text |
| Short-name text search | "GTME" returns 10,000+ unrelated rows | Search by entity id or full legal name |
| Comtrade free preview row cap | Turkey 4-code pull cut off at 500 rows | One code and one year per call |
| Reading "last record before listing" as "stopped because of listing" | river view: "Rama stopped 525 days before" | Say "the Kyrgyz route stopped"; check the firm's other departure countries |

## D. How we organise the work (orchestration)

| # | Practice | Rating | Notes |
|---|---|---|---|
| D1 | Cards on the team board; agents with their own keys claim, work, comment, send to check | works | Board join glitch: one-word names until the fix is deployed |
| D2 | Parallel waves of 3-12 agents, each on one angle, with a verifier behind each | works | Verifiers caught errors in most rounds |
| D3 | Big-picture thinkers alongside investigators | works | Produced the "need, not the name" and "method is the product" framings |
| D4 | Lead reviews every build before commit (tests, secrets scan, known positives) | works | Caught checker misses |
| D5 | One running findings log + questions log + this methods log | works | Corrections written in place with CORRECTED |
| D6 | Unlisted companies agency-only; nothing licensed in git | works | Sponsor-derived data files are git-ignored |

## E. Open method questions

- How to catch short and transliterated names (GTME) without flooding false positives? (transliteration table; screen IDs, not names)
- How to measure "listing lag" when Russia-side data thins after late 2023?
- Can the sibling finder rank candidates *before* they're listed (true prediction), not just re-find same-wave listings?
- How to get dated before/after splits from Sayari when facet date filters don't work (pull rows in pages)?
- How to tell a Sayari record merge (two firms in one record) from a real link (the Turkish RM DESIGN record)?
- How to separate a real 2024 drop (bank pressure after E.O. 14114) from Russia-side data thinning?
- How to verify registration dates without official registries (Kyrgyz tax-ID date encoding worked once)?

---

## Updates (newest last)

| Time | Entry |
|---|---|
| 12:08 | Log started; backfilled from the whole morning. |
| 12:25 | Turkey deep dive: added A19-A21, B9-B10, five traps, two open questions. Posted to the board (Materials > methods). |
