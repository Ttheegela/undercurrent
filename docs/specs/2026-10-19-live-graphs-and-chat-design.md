# Live graphs, daily updates and the Ask chat

Date: 2026-10-19 · Status: approved 2026-10-19; Part 2 model route changed from Vercel AI Gateway to OpenRouter by the owner on 2026-10-19 · Owner: Tarun Theegela

Part 1 was built on branch `feat/live-graphs` (2026-10-20).

## Intent

The shadow-fleet map and the Who lobbies influence network are frozen at the 25 September 2026 research snapshot. Everything else on Undercurrent refreshes nightly. The owner wants the graphs to stay current, and wants people to see **what changed**, day by day, without reading raw lists. The Updates page is the shared record of those changes. The chatbot then lets anyone ask about anything on the site, including "what are the updates from the past 10 days?", and get a short, sourced answer that points them into the graphs.

Two parts, built in this order:

1. **Live graphs and the daily change record**: nightly rebuild of the two graphs, a record of each day's changes, a "Show changes since" panel with a calendar on both graphs, and an Updates page.
2. **Ask**: a text chat panel on every page, answering only from the site's own data and pages, with sources.

Part 2 depends on the change record from part 1, but the rest of Ask (lookups, explainers) can ship first if part 1 runs long.

## Goals

- The shadow-fleet map and the influence network reflect the official data from the latest nightly run, with a visible "Data updated <date>" line.
- Each night's differences are recorded as dated changes: added, removed or changed ships, companies, people and links, and on the lobbying side new filings, firms, lobbyists, agencies and bills.
- On both graphs, a **Show changes since** control offers Yesterday, 7 days, 10 days and **Pick a day** (calendar). Choosing a day highlights everything that changed **from that day up to today**:
  - new nodes and links get a green ring;
  - removed ones show as dashed grey outlines for as long as the chosen window covers their removal date;
  - a side list names each change with its date, and clicking one moves the graph to it.
  - Days with changes are marked on the calendar. Days before the live graphs started are disabled.
- An **Updates** page lists every day's changes in plain words, newest first, each with **Show on map** or **Show on network**, opening the graph focused on that item with the change highlighted. The page has date filtering and a filter for fleet or lobbying changes.
- **Ask**:
  - The chat answers questions about anything the site covers, with a source link for every claim:
    - sanctions status from the official lists and OpenSanctions
    - connections and lobbying
    - the semiconductor data
    - the research dossiers
    - the daily changes
    - the explainer, About and Methods pages
  - It suggests where to look next: a graph focused on a ship or company, or a page.
- **Every page reflects the updates (owner's requirement).** Wherever a page states a count or a date that the nightly data changes, it is read from the latest nightly output, not hard-coded. This includes:
  - home cards (ships, lobbying reports, semiconductor months)
  - "Data built" and "Data as of" lines on the graphs
  - the stats on the Methods and About pages
  - the influence network's node, link and ship counts
  - the research notes pages that quote these figures

  Where a figure belongs to the fixed 25 September research (for example "Key findings" in the notes), it stays, but is labelled as of 25 September. A test fails if a page shows a figure that disagrees with the current data files.
- **No raw Markdown anywhere.** Every reader-facing page is HTML in the site design. (Done in PR #25: notes are generated from `.md` by `scripts/build_docs.py`, old `.md` URLs redirect, and a test blocks `.md` links.) Any new page from this design follows the same rule.

## Non-goals

- Rebuilding the hackathon research. The 25 September research layer stays as a fixed, labelled base: hand-checked bridges, "lead" lines, research notes, Ukraine-database former names and flags, and generic labels for unlisted companies. Only the official-data layer updates nightly.
- Reconstructing daily history before launch. History starts the day the live build first runs; earlier calendar days are disabled.
- The clean-names graph. It is small and hand-checked, so it stays as it is.
- Voice, accounts, saved chat history, languages other than English.
- Real-time updates. Nightly is enough.

## Anti-goals: the owner's own words, which the build must never do

The chatbot must never:

1. **Say a ship, company or person is sanctioned when it isn't.**
2. **Invent an update that never happened.**
3. **Give an answer with no source to check.**
4. **Go off-topic**, such as chatting about the weather or giving legal or compliance advice.

The graphs must also never:

- show a "change" caused by a source failing (a list that failed to download is not "everything was delisted");
- name an unlisted company or person that no official list or government document names (the site's existing naming rule).

## Constraints

- **Stack:** static site (plain HTML/CSS/ES modules, no build step), Vercel Functions in `api/` (Node), Python standard-library nightly builders in `scripts/`, GitHub Actions nightly (`.github/workflows/update-lists.yml`). Vercel Hobby plan.
- **Nightly security model (keep it):**
  - The **build** job parses all outside data with read-only access and no secrets.
  - The **publish** job runs no project code. It commits only allowlisted `.json` paths and uploads release assets.
  - New outputs must be added to the publish allowlist and `git add` list deliberately.
- **Failure model (keep it):** each source fails alone, keeps yesterday's copy, uses the 20% shrink guard, and is named in the nightly issue. A source that kept its previous copy produces **no changes** for that day, and the Updates page says the source was unavailable.
- **Data rules:**
  - No Sayari or Tradeverifyd data, and no mention of either.
  - People are named only as official lists, government documents or (for lobbyists) their own LDA filings name them. `exclude_lobbyists` is honoured everywhere, including in the change record and in chat answers.
- **Security:** the enforced CSP in `vercel.json` (app: `script-src 'self'`, `connect-src 'self'`) stays. Any new endpoint is GET or POST under `/api/` (the Vercel Firewall already rate-limits `/api/` to 120 requests/min/IP, and POST must be explicitly allowed for the chat endpoint only, see below). Every value reaching the DOM is escaped and every URL goes through `safeUrl`.
- **Design:** the main site's tokens and components; the shadow-fleet map's programme colours and the influence network's category colours stay as they are. Green (`#4ade80`-ish, as a page-local data-viz token checked for contrast) marks "new" and dashed grey marks "removed". Independent-project voice: no "team" wording.
- **Performance:** graph pages must not get noticeably slower. Today the map ships its data inline. If the live data is loaded separately, keep first render under roughly what it is now.
- **Monitoring:** UptimeRobot already watches home, `/api/search` and `/api/connections`. Add a keyword monitor for the chat endpoint's health check.

## Part 1: Live graphs and the daily change record

### Decided

- **Sources for the live layer**, all of which the nightly job already downloads or can download free:
  - **Ships, companies and people:** the official lists (US CSL including its "Linked To" field for vessels, UK list including owner, operator and IMO columns, EU, UN).
  - **Ownership and management links:** OpenSanctions relationships (already built into `connections.json.gz`).
  - **The lobbying side:** lda.gov via the existing lobbying build.
  - **Bridges between the fleet and lobbying sides:** the existing hand-checked bridges (`data/lobbying-bridges.json`).
  - The original hackathon builders (`veil-trace@88dcaa2: tools/fleet/network/merge.py`, `build_base.py`, `research/knowledge-graph/scripts/build_kg.py`) are the reference for how nodes and links were derived from these lists; port only the parts that use official data. The veil-trace repo is read-only.
  - **EU ship listings and US listing dates (designer's call):**
    - **The problem with the official files:** the EU financial-sanctions file the nightly job downloads has no ships. EU vessel bans (port bans) are published in the Official Journal annexes instead. The US screening list has no dates on vessel rows.
    - **Where the live layer takes them from:** OpenSanctions, which the nightly job already downloads. Its `eu_journal_sanctions` dataset carries the EU port-ban ships (about 736 vessels). For US vessels, its record dates are used.
    - **Labelling:** on the map and in the change record, these are labelled as coming from the official source via OpenSanctions (for example "EU Official Journal, via OpenSanctions"). The link is the specific Official Journal act where OpenSanctions names it, otherwise the OpenSanctions entity page.
    - **Guard:** "official data wins" never removes a status merely because one source lacks that field. A status is removed only when the source that carried it stops carrying it.
- **Base layer plus live layer:** each node and link carries a layer: `research` (fixed 25 Sep base) or `official` (rebuilt nightly).
  - A research item is never removed by the nightly build.
  - An official item appears, changes or disappears with the data.
  - Where both layers describe the same thing, the official data wins for list status and dates; research notes stay attached.
- **Change record:**
  - Each nightly run compares today's live graph with yesterday's and writes that day's changes:
    - added, removed or changed node or link
    - field-level change for name, flag, listing status, listed-by authorities and programme
    - the lobbying additions listed in Goals
  - Each change carries:
    - date
    - graph (`fleet` or `lobby`)
    - kind
    - the item's id and display name
    - a plain-English summary
    - the official source URL of the record that caused it (per-entry links, as the site now uses)
  - The record is kept for at least 90 days. Calendar and Updates page read it.
- **Links that come only from OpenSanctions relationships (designer's call):**
  - **Stable keys:** a link is identified by its two endpoints' stable keys (IMO for ships; US/UK/EU/UN list id, or exact list name, for companies and people), never by OpenSanctions entity ids. When OpenSanctions merges or splits its ids, nothing changes on the map or in the record.
  - **What gets recorded:** an added or removed link is recorded as a dated change only when it appears or disappears in the underlying list data, and the authority labels (US, UK, …) say which list.
  - **Source:** the per-entry US or UK record where one can be resolved (extend the connections build to keep dataset and record ids). Otherwise the OpenSanctions entity page, labelled "via OpenSanctions".
  - **Suppressed changes:** a link with neither a resolvable record nor a stable endpoint key updates the graph but produces no dated change entry.
- **No phantom changes:** if a source kept its previous copy that night, its items are carried over unchanged, and the day's record notes "<source> unavailable". On the first run there is no "yesterday", so it records no changes; the day is the baseline.
- **Both graphs** get the Show-changes panel with presets, calendar, change list and fly-to.
- **Updates page:** at `stories/updates/` (or a path the builder finds cleaner). It is linked from the top menu next to the two graphs.
- **Deep links:** "Show on map" and "Show on network" open the graph with the item selected and the change window set (for example a URL hash `#focus=IMO9408695&since=2026-10-12`). This hash handling is in the same allowlisted style as the graphs' existing hash handling.

### Left to the builder

- Data file layout: one live graph file per graph plus one changes file, sharded by month if it grows. Release asset versus committed JSON, sizes within reason.
- How the map loads data now that it isn't frozen inline (fetch a JSON file is the obvious route; CSP `connect-src 'self'` already allows same-origin).
- Matching rules between official records and research nodes (IMO for ships; list ids, then exact names, for companies; never fuzzy). Keep a test fixture of known pairs.
- Layout stability: new nodes shouldn't reshuffle the whole graph each day. Seed positions from yesterday where the layout library allows.
- Exact calendar widget. No new library unless it's small and pinned with SRI. A plain accessible grid is fine.

## Part 2: Ask (chat)

### Decided

- **Model:** Claude Haiku 5.5 through **OpenRouter** (owner's decision 2026-10-19, replacing Vercel AI Gateway).
  - The model id is `anthropic/claude-haiku-5.5`, called at `https://openrouter.ai/api/v1/chat/completions`.
  - Price: $0.10 / $0.50 per million input/output tokens, from OpenRouter's model list on 2026-10-19. That list also shows the model supports `tools` and `tool_choice`.
  - **The API key:** an OpenRouter key kept only in the Vercel environment variable `OPENROUTER_API_KEY`. The owner enters it, and it never appears in the repo, logs, tests or chat.
  - **Provider data:** every request sends `provider: {"data_collection": "deny"}`.
- **Where it lives:** an "Ask" button in the bottom corner of every page that opens a chat panel (right-side drawer on desktop, full-height sheet on phones). It doesn't cover the graphs' controls. The panel shows 3–4 starter questions:
  - "What changed this week?"
  - "Is TASSOS sanctioned?"
  - "Who manages TASSOS?"
  - "How long does it take to list a new semiconductor firm?"
- **What it can answer:** anything on the site, through tools that call the site's own data:
  - **Lookups:** the existing `/api/search`, `/api/connections` and research-index search. These cover sanctions status, list entries, owners, managers, lobbying firms, lobbyists and dossier facts.
  - **Updates:** the change record, for date ranges and per item.
  - **Semiconductors:** routes, coverage and listing-lag data.
  - **Explainers:** the How sanctions work, About the data and Methods text, retrieved by section.
- **The four anti-goals are enforced by design, not just by prompt:**
  1. **Sanctions claims come only from a tool result in the same conversation.**
     - "Not found" is phrased as "not on the lists we check (US, UK, EU, UN, OpenSanctions)", never "clean" or "not sanctioned", followed by "not being found isn't proof".
     - The server checks the final answer: any sentence asserting a listing must correspond to a tool result. If it doesn't, the answer is replaced with a safe fallback.
  2. **Updates come only from the change record.** Empty ranges are said as empty.
  3. **Every claim carries a source link** taken from tool results. The server rejects or repairs answers with uncited claims, and links render through `safeUrl`.
  4. **Off-topic, legal and compliance advice ("should I trade with…"), opinions on people, and prompt-injection attempts** get a short refusal that points back to what Ask can do.
     - Tool results are treated as data, never instructions.
- **Ask points onward:** answers end with suggested next steps where useful, rendered as links: open a graph focused on an item, open the Updates page for a range, or run a site search.
- **Privacy:**
  - No accounts, no stored conversations, no analytics on message content.
  - Conversation state lives in the page only and is gone when the panel closes.
  - The function logs no message text.
  - About the data gets one plain paragraph saying so.
- **Cost and abuse limits:**
  - **Budget: $5 a month (owner's decision).**
    - **The cap:** Ask uses a dedicated OpenRouter key with a **credit limit of $5** and `limit_reset: monthly`. OpenRouter resets the limit at midnight UTC.
      - Once the limit is spent, OpenRouter rejects requests with HTTP 402 or 403, with `error.metadata.limit_source` set to `openrouter_key_limit`.
      - An empty account balance gives `openrouter_credits` instead.
      - The request that crosses the limit may still complete.
    - **No datastore:** Ask maps those errors to "Ask is resting" with the reset date, and the rest of the site is unaffected.
    - **Owner's one-time steps:**
      - Buy OpenRouter credits (for example $5–10) with auto top-up left **off**. OpenRouter adds a 5.5% fee to credit purchases.
      - Create the key "undercurrent-ask" with the $5 monthly limit.
      - Check that input/output logging is off in OpenRouter's privacy settings.
      - Add the key to Vercel production with `vercel env add OPENROUTER_API_KEY production`, typing it at the hidden prompt.
    - **Roughly 3,000 answers a month at about $0.0017 each.** That assumes up to three model calls of about 4,000 input tokens each and about 1,000 output tokens per answer.
  - A per-visitor cap on questions per hour, enforced server-side without storing content (best effort per function instance is acceptable, since the budget is the hard backstop).
  - A max conversation length, and a max output length per answer.
  - The existing `/api/` rate limit applies.
  - The Firewall's "read-only methods" rule must be updated to allow POST on the chat path only.
- **Failure:**
  - If OpenRouter or a tool fails, Ask says so plainly and offers the site search.
  - It never answers from the model's general knowledge instead.
- **Accessibility:** keyboard-operable panel, focus moves into the panel on open and back on close, live region for new answers, visible labels, works at 320 px.

### Left to the builder

- Streaming versus one-shot responses. Streaming is nicer if it stays simple under the CSP.
- How the claim-checking step works: a structured answer format with claims and their source ids is the expected route.
- The per-visitor limit mechanism within Hobby-plan limits.
- Whether an SDK is worth adding as a runtime dependency for the chat function, versus calling OpenRouter's API directly with `fetch`. The rest of the site stays dependency-free.
- An evaluation set of at least 40 questions. How it runs (designer's call):
  - **In CI:** the set runs on every PR with **recorded** tool results **and recorded model outputs**. This tests the server-side claim checker, the refusals and the answer format without calling the model, and needs no new secret.
  - **Live pass:** the same questions run against the real model through a deployed endpoint, by hand before launch and after any prompt or model change. It costs a few cents, and the owner runs it, or a helper does in a session, from a script.

  The set covers:
  - the owner's four fears
  - each data area
  - off-topic and legal-advice probes
  - injection attempts embedded in names
  - "not on the lists" cases
  - empty date ranges

## Success looks like

- A week after launch, the map's calendar shows a dot on each day the lists changed, the Updates page lists those changes with working "Show on map" links, and every change matches the official entry it links to.
- On a night when a source is down, no false removals appear, and the Updates page says which source was unavailable.
- Ask answers "What changed this week?", "Is TASSOS sanctioned?" and "Who lobbied for Nord Stream 2?" with correct, linked sources, and refuses "Should I buy oil from this ship?" and "What's the weather?".
- Asked about a name that isn't in the data, Ask says it's not on the lists checked and never says "not sanctioned".
- The day after a list change, every page that shows a count or date (home cards, graphs, Methods, About, notes) shows the new figure, and no page anywhere opens as raw Markdown.
- Ask's spend for the month never exceeds $5 by more than one request, and when it's used up the panel says so while the rest of the site keeps working.
