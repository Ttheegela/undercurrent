# Ask answers that answer the question: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ask answers what was asked:
- counts, ages, and searches by programme, flag, ship type and topic, all computed by the server;
- automatic "Showing N of M" and honest "none" lines;
- a live Jev relevance gate that drops sentences that don't bear on the question.

All of this keeps the guarantee that the model writes no text.

**Architecture:**
- **Tools** in `api/_ask_tools.js` return new structured evidence items: `count`, a richer `change` with topic fields, and research ship items.
- **Renderers** in `api/_ask_check.js` turn each item into fixed copy through new claim types: `count`, `age` and `none_matched`. They also append "Showing N of M" for capped results.
- **The gate** (`api/_ask_gate.js`) asks TypeSafe's Jev, per rendered sentence, whether it bears on the question, and drops those that don't. It fails open.
- **A closed vocabulary** (`api/_ask_vocab.js`) is the only source of topic words the server may print.

**Tech stack:** Node 22 ESM, `node:test`, Vercel functions. OpenRouter Haiku 5.5 (unchanged). TypeSafe `/v1/systemone` (`jev-latest`) through plain `fetch`. LangSmith evals (existing).

**Spec:** docs/specs/2026-10-22-ask-answers-design.md, approved 22 Oct 2026. Read it first. Its "Definitions and measurement" and "Anti-goals" sections are binding.

## Global constraints

- **No free text.** The model writes no prose. Every rendered sentence is fixed copy, a server claim built from an evidence item, or a verbatim quote. `groundingProblems` (scripts/ask-oracle.mjs) must accept every new sentence; extend its producers in the same task that adds the copy.
- **Topic words.** Any topic word the server prints (a programme, country, flag or group) comes from `api/_ask_vocab.js`, never from the model's or the reader's free text.
- **Ships.** Ships are research-map nodes with `id` starting `IMO` in `stories/shadow-fleet/network/fleet-data.json`. Copy names that scope: "in Undercurrent's research map". Official-list programme counts are "records on the … list", counted by distinct `ref`, never rows.
- **Flags.** A ship's flags are the union of its `flagged_in` edges, `flag_us` and `flag_now`. Copy for flags says "recorded as X-flagged by at least one source".
- **Dates.** Ages come from `date` or `listing_dates[list]` and today (UTC).
  - A research date whose basis is "first seen via OpenSanctions" adds "(first seen on the list via OpenSanctions)".
  - A UK date of 2020-12-31 adds "(the UK list's transfer date; the listing may be older)".
  - Undated: "The {list} gives no listing date for {name}."
- **Partial results.** Every capped result carries `shown` and `total`. The renderer appends `Showing {shown} of {total}.` after the sentences citing that result, never chosen by the model.
- **The gate:**
  - `TYPESAFE_API_KEY` is read only in `api/_ask_gate.js`.
  - Budget 3,000 ms; on unset key, timeout, HTTP error or a malformed reply, the answer is unchanged, with one fixed log line `ask: relevance gate unavailable`.
  - It never logs question or sentence text.
  - Threshold: drop a sentence when `p(unrelated) ≥ 0.5`. This is provisional and lives in one exported constant.
- **Existing rules stay:**
  - "langsmith" never appears in `api/`;
  - production `POST` passes no model;
  - the 26 s request race stays;
  - logs carry only fixed phrases.
- **Prompt length.** The prompt-length test limit rises from 2500 to 3500 characters. That is the only allowed change to that test.
- **Wording and commits.** Independent-project voice; no "team". Each commit ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review focus

1. **A count of zero.** "0 ships …" must render as `none_matched` copy ("None of the ships in Undercurrent's research map …"), never as "0 ships are". Pinned in Task 3.
2. **A topic word that is also part of a name.** For example, `programme:"Iran"` against the query "Iran Air". Programme filters match only the `program` / `programs` fields, never names, and name search is unchanged. Pinned in Task 2.
3. **The gate removes every sentence.** The answer becomes the fixed `NOTHING_ANSWERS`. When the gate drops sentences, the "Showing N of M" lines and source numbering are rebuilt from the kept sentences. Pinned in Task 6.
4. **Age arithmetic.**
   - Today equal to the listing date: "listed today (since …)".
   - A future date (bad data): no age, fall back to "since {date}".
   - Leap days and month ends: whole months by calendar.

   Pinned in Task 1.
5. **Flag disagreement.** A ship with 2 current flags counts once under each flag. A count by flag never says "flagged in X" without "by at least one source". Pinned in Task 3.

---

### Task 1: The closed vocabulary, the `age` claim, and "Showing N of M"

**Files:**
- Create: `api/_ask_vocab.js`
- Modify: `api/_ask_tools.js` (list, research and opensanctions items; the caps)
- Modify: `api/_ask_check.js` (RENDER, fixed copy, `finish`)
- Modify: `scripts/ask-oracle.mjs`
- Test: `tests/ask-vocab.test.js`, `tests/ask-check.test.js`, `tests/ask-tools.test.js`

**Interfaces:**
- **Produces:**
  - `export const VOCAB` and `export function topicOf(word) -> {kind: "programme"|"country"|"group", key, label} | null` from `api/_ask_vocab.js`.
    - **Built from:** the 184 US programme strings, the UK, EU and UN regimes in `data/lists/*.json` (split on ", "), fleet-data `program_group` values, `cc:` country nodes, and kg.json group `g` values (russia, china, chips).
    - **`label`:** the printable form, e.g. "Iran", "Russia", "Venezuela".
    - **Exact match only:** `topicOf` matches case-insensitively on the label or a known alias (e.g. "Iranian" → Iran). Anything else returns null.
  - **List, research and opensanctions items** gain:
    - `date_basis: "list"|"first_seen_opensanctions"|"uk_transfer"` where a date exists;
    - `shown` and `total` on the search item for each capped source.
  - **The `age` claim:** `{claim:"age", sources:[id]}` on one list or research item. It renders:
    - `AGE(e, today)`: "{name} has been on the {list label} for {Y} years {M} months (since {d MMM yyyy})." Drop "0 years". A zero span reads "{name} was added to the {list label} today."
    - with the `date_basis` suffixes from Global constraints;
    - or the undated copy.
  - **`finish`** appends `Showing {shown} of {total}.` (with no sources) once per capped search item cited, after its last sentence.

- [ ] **Step 1: Write the failing tests.**
  - `topicOf maps labels and aliases and rejects free text`: "iran" and "Iranian" → Iran; "Russia" → Russia; "Iran Air" → null; "hello" → null.
  - `age renders years and months from a dated list item`: DJI, Entity List, 2020-12-18, today 2026-10-22 → "DJI has been on the United States list under Entity List (EL) for 5 years 10 months (since 18 Dec 2020)." Reuse the existing `LISTED` wording for the list label.
  - `age flags approximate and UK-transfer dates, and says when a list gives no date`.
  - `age edge cases`: today equals the date; a future date falls back to `LISTED`; 29 Feb to 28 Feb.
  - `a capped search adds Showing N of M after its sentences` (fixture: 12 matches, 5 shown) → the last sentence is exactly "Showing 5 of 12.".
  - `groundingProblems accepts the age and Showing lines`.
- [ ] **Step 2:** `node --test tests/ask-vocab.test.js tests/ask-check.test.js tests/ask-tools.test.js`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.**
  - Vocab is built once at module load from the committed files. Use the same `readFileSync` pattern as `_ask_tools.js`.
  - `vercel.json` `includeFiles` already covers `data/lists/*.json`. Add `stories/shadow-fleet/network/fleet-data.json` and `stories/who-lobbies/influence-network/kg.json` if they aren't already listed.
- [ ] **Step 4:** `npm test`. Expected: all pass.
- [ ] **Step 5: Commit:** `feat(ask): ages, Showing N of M, and a closed topic vocabulary`.

### Task 2: Programme counts on the official lists

**Files:**
- Modify: `api/_ask_tools.js` (the `check_lists` parameters and a count item)
- Modify: `api/_ask_check.js`
- Modify: `scripts/ask-oracle.mjs`
- Test: `tests/ask-tools.test.js`, `tests/ask-check.test.js`

**Interfaces:**
- **Consumes:** `topicOf` (Task 1).
- **Produces:**
  - **New `check_lists` parameters:** `{query?, programme?, list?: "us"|"uk"|"eu"|"un"}`. At least one of `query` and `programme` is required.
  - **With `programme`:** the tool returns
    - a count item `{kind:"count", unit:"records", scope:"list", list, topic:{label}, n, examples_shown, label, url}`, counting distinct `ref` whose `program` contains the topic;
    - up to 5 example `list` items;
    - the search item's `shown` and `total`.
  - **The `count` claim:** `{claim:"count", sources:[id]}` renders `COUNT(e)`:
    - **records:** "{n} records on the {list label} are under {topic label} programmes." With no list given, one sentence per list with n > 0.
    - **n = 0:** `NONE_MATCHED(e)` = "None of the records on the {list label} are under {topic label} programmes."

- [ ] **Step 1: Write the failing tests.**
  - `programme count counts distinct refs, not alias rows`: US + Iran → the n equals the distinct-ref count from the committed data (assert against a computed value in the test, about 4,083).
  - `programme filter never matches names`: `programme:"Iran"` doesn't bring in "BIMEH IRAN" unless its `program` contains Iran.
  - `name search is unchanged when no programme is given`: the existing check_lists tests still pass.
  - `count renders with its list and topic, and n=0 renders none_matched`.
  - `an unknown programme word returns a search item found:false, never a count`.
  - `groundingProblems accepts count and none_matched copy`.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3: Implement.** Put the count item's computation in one function, `programmeCount(list, topic)`.
- [ ] **Step 4:** `npm test`. Expected: all pass.
- [ ] **Step 5: Commit:** `feat(ask): count official-list records under a programme`.

### Task 3: The research query (ships)

**Files:**
- Modify: `api/_ask_tools.js` (a new tool, `research`, plus its entry in `TOOLS`)
- Modify: `api/_ask_check.js`
- Modify: `scripts/ask-oracle.mjs`
- Test: `tests/ask-tools.test.js`, `tests/ask-check.test.js`

**Interfaces:**
- **Consumes:** `topicOf`, and `COUNT` / `NONE_MATCHED` (Tasks 1 and 2).
- **Produces:**
  - **The tool:** `research {programme?: string|string[], listed_by?: "us"|"uk"|"eu"|"un", flag?: string, ship_type?: string, names_changed?: boolean}` over fleet-data nodes whose `id` starts `IMO`.
    - `programme` matches `programs` / `program_group`. An array means AND.
    - `flag` uses the flag union.
    - `ship_type` is a case-insensitive contains on `ship_type`.
    - `names_changed` means `name_count > 1`.
  - **What it returns:**
    - a count item `{kind:"count", unit:"ships", scope:"research", filters, n, total_ships, ...}`;
    - up to 5 ship example items `{kind:"research", entity:{id,name,imo}, ...}`, in the existing research item shape;
    - `shown` and `total`.
  - **The copy:**
    - "{n} ships in Undercurrent's research map {filter phrase}."
    - The filter phrase is built from fixed fragments, for example:
      - "are listed by the European Union";
      - "are under an Iran programme";
      - "are recorded as Venezuelan-flagged by at least one source";
      - "are tankers";
      - "have had more than one name".
    - For `names_changed`: "{n} of the {total_ships} ships in Undercurrent's research map have had more than one name."
    - n = 0 renders `NONE_MATCHED`.

- [ ] **Step 1: Write the failing tests,** asserting against values computed from the committed fleet-data:
  - `names_changed counts hulls with name_count > 1`: about 1,076 of 1,722 IMO ships. Assert the test-computed values.
  - `listed_by eu counts 733-ish ships`.
  - `programme ["russia","iran"] with ship_type tanker is an AND`: the case behind count-1 (about 54).
  - `flag uses the union and says at least one source`: Venezuela gives a value of at least 38.
  - `a ship with two current flags counts under each`.
  - `zero matches renders none_matched copy`.
  - `examples are ships only`: every example `id` starts with IMO.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3: Implement.** Precompute a ship index at module load: `[{id, name, imo, programs, listed_by, flags:Set, ship_type, name_count}]`.
- [ ] **Step 4:** `npm test`. Expected: all pass.
- [ ] **Step 5: Commit:** `feat(ask): count and list research-map ships by programme, authority, flag, type and names`.

### Task 4: Topic filters on the updates

**Files:**
- Modify: `api/_ask_tools.js` (the `changes` parameters and the change items)
- Modify: `api/_ask_check.js`
- Modify: `scripts/ask-oracle.mjs`
- Test: `tests/ask-tools.test.js`, `tests/ask-check.test.js`

**Interfaces:**
- **Consumes:** `topicOf`.
- **Produces:**
  - **The new parameter:** `changes {since, until?, graph?, query?, topic?}`. `topic` is a vocab word.
  - **Classifying each change in range:**
    - **fleet:** joined to its fleet-data node through `id` or `endpoint_ids`, then matched on `programs`, `program_group` and flags;
    - **lobby:** joined through kg.json node group `g`;
    - **unknown:** neither join gives a programme, country or group.
  - **Results:** matches return as change items, as today.
  - **When nothing matches:** a `{kind:"change", found:false, topic:{label}, checked_fleet, checked_lobby, unchecked, from, to}` item renders:
    - "None of the {checked} updates recorded between {from} and {to} involve {topic}."
    - plus, when `unchecked > 0`: "{unchecked} updates in that period carry no programme or country to check."
  - **Unchanged:** the existing before-start, trimmed, not-yet and gap logic still apply first.

- [ ] **Step 1: Write the failing tests.** Fixture records cover a fleet change for an Iran-programme ship, a lobby change in the russia group, and an unjoinable bill.
  - `topic filter matches fleet changes by programme`.
  - `topic filter matches lobby changes by kg group`.
  - `nothing matching says none of the checked updates and counts the unchecked`. On the committed record of 20–21 Oct, topic Iran gives "None of the 0 updates …" plus "10 updates in that period carry no programme or country to check." Assert the exact text.
  - `free-text query still works and is unaffected by topic`.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** `npm test`. Expected: all pass.
- [ ] **Step 5: Commit:** `feat(ask): filter the updates by topic and say honestly what could be checked`.

### Task 5: Prompt, answer schema and chips total

**Files:**
- Modify: `api/_ask_prompt.js`
- Modify: `api/_ask_tools.js` (the `TOOLS` descriptions and the `answer` claim enum; `chips` topic `firms` gains a count item)
- Modify: `tests/ask.test.js` (the prompt-length limit goes to 3500 and the new claims are pinned)
- Test: `tests/ask-tools.test.js`

**Interfaces:**
- **Consumes:** every claim and parameter from Tasks 1–4.
- **Produces:**
  - **The prompt** teaches:
    - the `count`, `age` and `none_matched` claims;
    - the parameters of `research`, `check_lists` (programme) and `changes` (topic);
    - one rule: "If no record answers the question, finish with an answer that has no sentences."
  - **An empty answer** (kind `answer`, zero sentences) renders `NOTHING_ANSWERS` = "Nothing recorded on this site answers that.", a new fixed copy. It is not FALLBACK, because FALLBACK means "couldn't check".
  - **chips `firms`** adds a count item: "{n} firms are named in Undercurrent's research as shipping chips to Russia." Take n from the chips data and confirm it is 64 against the file.

- [ ] **Step 1: Write the failing tests.**
  - `the prompt names each claim and the research tool, and stays under 3500 characters`.
  - `the answer tool's claim enum includes count, age and none_matched`.
  - `an empty answer renders NOTHING_ANSWERS with no sources`.
  - `chips firms count`.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** `npm test`. Expected: all pass. The eval offline suite must still pass; update recorded `model` answers only where a recorded case's claim names changed, and say which in the commit.
- [ ] **Step 5: Commit:** `feat(ask): teach the new claims and tools, and say when nothing answers`.

### Task 6: The live relevance gate (Jev)

**Files:**
- Create: `api/_ask_gate.js`
- Modify: `api/ask.js` (wire the gate after `checkAnswer` inside `converse`; wrap it as `"gate"`)
- Modify: `app/ask-panel.js` (privacy line)
- Modify: `stories/about-the-data.html` (Ask privacy section)
- Modify: `README.md`
- Test: `tests/ask-gate.test.js`, `tests/ask.test.js`

**Interfaces:**
- **Produces:**
  - **The gate:** `export async function gate(question, answer, { fetch, apiKey = process.env.TYPESAFE_API_KEY, timeoutMs = 3000 }) -> answer`.
    - **The request:** one `POST https://api.typesafe.ai/v1/systemone` with model `jev-latest`. State `{question, sentences:[{i, text, source}]}`. One noul per sentence (`s0`, `s1`, …): "Does sentence {i} bear on what the question asks?".
    - **What it keeps:** sentences with `p(yes) ≥ 0.5`. `export const GATE_THRESHOLD = 0.5`.
    - **Fixed copy is never sent or dropped:** REFUSAL, FALLBACK, CLARIFY, PARTIAL, NOT_ADVICE, NOTHING_ANSWERS and the Showing lines.
    - **After a drop:** sources are renumbered and the Showing lines rebuilt.
    - **All sentences dropped:** returns `NOTHING_ANSWERS`.
  - **Wiring:** `runAsk` applies the gate only to kind `answer`, as `wrap("gate", gate)`.
  - **The privacy line in `app/ask-panel.js`:** "Your question and data from this site go to an AI model and a relevance checker (TypeSafe). The conversation isn't stored."
  - **About-the-data:** the Ask privacy paragraph names OpenRouter (the model) and TypeSafe (the relevance check), says that neither is used for training under its terms, and keeps "Undercurrent stores no conversation".

- [ ] **Step 1: Write the failing tests** (fake fetch):
  - `the gate keeps sentences that bear on the question and drops the rest`;
  - `the gate renumbers sources and rebuilds Showing lines`;
  - `the gate never sends or drops fixed copy`;
  - `all dropped gives NOTHING_ANSWERS`;
  - `an unset key, a timeout, HTTP 500 or a malformed reply returns the answer unchanged and logs only the fixed line`;
  - `no question or sentence text in any log`;
  - `runAsk wraps the gate as "gate" and POST still passes no model`;
  - `the panel and the about page name TypeSafe`.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3: Implement.** The gate's time counts inside the existing 26 s race.
- [ ] **Step 4:** `npm test` and `npm run smoke -- -g "Ask"`. Expected: all pass. The smoke check confirms the privacy copy renders.
- [ ] **Step 5: Commit:** `feat(ask): a live Jev relevance gate, and privacy copy that names it`.

### Task 7: Evals: re-baseline, new cases, repetitions and answer rate

**Files:**
- Modify: `tests/ask-eval.json`
- Modify: `scripts/ask-langsmith.mjs` (`--repetitions N`, answer rate)
- Modify: `.github/workflows/ask-evals.yml` (an optional `repetitions` input on dispatch)
- Modify: `README.md`
- Test: `tests/ask-eval.test.js`, `tests/ask-langsmith.test.js`, `tests/ask-evals-workflow.test.js`

**Interfaces:**
- **Re-baseline** the cases that today expect a fallback for lack of a claim (relevance-1, relevance-2, relevance-3, area-lists-3, count-*, duration-*, programme-*, topic-*, none-*). Each `note` already says what a good answer is.
  - **Expectations:** use `kind:"answer"`, with `includes` holding the exact new copy built from today's data.
  - **Drifted numbers:** refresh them, e.g. count-1's 42 becomes the research value.
  - **Evidence:** re-record each case's evidence with the real tools, offline.
- **New cases:**
  - an undated US listing's age;
  - a UK 2020-12-31 age;
  - EU-listed ships;
  - a two-flag ship;
  - a programme that matches nothing;
  - a question where nothing answers, expecting `NOTHING_ANSWERS`.
- **Runner:**
  - `run --repetitions N`, accepted only with `--trigger manual`, 1 ≤ N ≤ 3. It maps to `numRepetitions`.
  - The result JSON gains `answer_rate = answered / should_answer`. `should_answer` covers cases whose `expect.kind` is `answer`, or whose `also` includes `answer`.
  - With repetitions, the mean and minimum per metric across repetitions.
- **Declines:** an answer made only of `NOTHING_ANSWERS` counts as a decline, like FALLBACK. It isn't sent to the Jev judge, and it isn't counted as answered.
- **Workflow:** a `repetitions` dispatch input (choice 1, 2 or 3), passed through `env:` as before. The existing input rules and tests apply.

- [ ] **Step 1: Write the failing tests:**
  - the new cases' shapes;
  - repetitions parsing and the `numRepetitions` mapping;
  - `answer_rate`, and the mean and minimum across repetitions;
  - the workflow input passes `--repetitions`.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3: Implement**, and record the cases.
- [ ] **Step 4:** `npm test`, pytest and actionlint. Expected: all pass.
- [ ] **Step 5: Commit:** `evals: re-baseline for the new claims, add their cases, and measure over repetitions`.

### Task 8: Measure and relaunch (the controller and the owner, after merge)

1. **The owner** adds `TYPESAFE_API_KEY` to Vercel Production as a Secret: `vercel env add`, the `pbpaste` flow if needed. Verify by name only.
2. **Dispatch** `ask-evals.yml` on main with `repetitions=3` and the default model.
   - **Targets:** the means meet the spec's targets:
     - unrelated-record score ≤ 0.10;
     - relevance ≥ 0.85;
     - answer rate ≥ 75%;
     - no run more than 0.05 off any target;
     - the owner's 5 questions correct in all 3 repetitions.
   - **Report** the table to the owner.
3. **If targets are met:** set `ASK_PUBLIC=1` on the **Preview** environment and deploy a preview. The owner re-asks his 5 questions there.
4. **On the owner's yes:** `ASK_PUBLIC=1` in Production, then redeploy. Verify `/api/ask` shows `public:true`.
