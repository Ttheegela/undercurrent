# Ask finds list records by a word in their names: design

Status: approved by the owner, 24 Oct 2026: no "reader typed it" check on the echo guard; the 3-run eval waits for the eval key's 1 Nov reset.

## Why

Ask can't find the official lists' records by a word in their names. `check_lists` takes either one whole name (`query`) or a programme from the closed vocabulary (`programme`). A question like "are there any recent sanctions on chinese electronic companies?" has no route to the lists: "electronic" is not a programme, and as a name it matches nothing exactly.

Today that question (eval case relevance-4) is answered only through the chips research: the firms US Treasury named for sending chips to Russia, filtered to China. That route is real but narrow. It covers 41 firms, the newest named on 30 Oct 2024. The lists hold far more, and much more recent records: 453 US records have ELECTRONIC or ELECTRONICS in a name, the newest dated 9 Oct 2025.

The idea came from a peer session, inspired by the elstongun/leviathan FTS5 tool. That tool was not adopted, and this design doesn't use it either (see Design).

## Goals

1. Ask can count and show the records on the US, UK, EU and UN lists that have a given word in their names, on one list or on all four.
2. The answer says exactly what was matched, a word in a name, and never implies a firm's trade or country.
3. The existing machinery carries it: the `count` and `listed` claims, `shown`/`total`, and the automatic "Showing N of M." line.
4. Measured: the new live cases pass, and the relaunch bar in `docs/specs/2026-10-22-ask-answers-design.md` holds over 3 runs.

## Non-goals

- **No country filter.** The list records carry no country, so "Chinese" can't be answered from the lists. That stays phase 3 of the answers spec.
- **No new dependency, index or database.** That means no SQLite and no FTS5.
- **One word per search.** No phrases or ANDs (see "Where this departs from the brief").
- **No word search with a programme filter** (for example, Iran-programme records with SHIPPING in their names). That could be a follow-up.
- **The research map, OpenSanctions and the changes record are not searched by word.**

## Anti-goals (a failure even if it works)

- **Printing the reader's words or the model's words.** Every word in the new copy is fixed copy, a list's label, a number the server counted, or a word spelled as it appears in an official list record's name.
- **Implying an industry or a country.** "Records with the word ELECTRONICS in their names" is a word match, not "electronics companies", and the answer says so.
- **A verdict in the printed word**, such as "the word CLEAN" or "the word SANCTIONED". No listing, authority or clean-bill word is ever printed.
- **Counting rows instead of records.** Counts are of distinct `ref`s, as the programme counts are.
- **Losing the "nothing invented" guarantee.**

## What the data supports (measured 24 Oct 2026)

- **The lists:** 95,430 rows (US 55,197, UK 12,155, EU 24,385, UN 3,693). They hold 39,762 distinct records, since alias rows share a `ref`. Each row is `[name, normName, program, date, ref, imo, url]`, where `normName` is upper-case ASCII words with legal forms (LTD, CO, LIMITED …) dropped.
- **Speed:** one whole-word scan of all four lists, with the plural folding below, takes 12 to 26 ms in Node on this machine. The tools already read these files (`data()` caches them), so an index isn't worth its code.
- **Singular and plural:**
  - ELECTRONIC alone matches 208 US records and ELECTRONICS alone 294. Folded together they match 453.
  - Without folding, "electronic companies" misses most of the electronics firms.
- **Examples of counts (US / UK / EU / UN):**

  | Word | US | UK | EU | UN |
  |---|---|---|---|---|
  | BANK | 269 | 85 | 118 | 12 |
  | SHIPPING | 391 | 39 | 43 | 20 |
  | SEMICONDUCTOR(S) | 87 | 0 | 2 | 0 |
  | CHINA | 242 | 1 | 3 | 0 |

- **Listing dates:** UK and UN records are all dated. On the US list the Entity List records are dated and most OFAC programmes aren't, so "newest first" examples on the US list are mostly Entity List records.

## Design

### The tool: a `word` mode of check_lists

`check_lists` gains one optional parameter, `word`. I chose a mode of check_lists over a new tool for three reasons:
- it is the tool for the official lists;
- `list` already means "this list only";
- the count-plus-examples shape, the example spread and `listItem` already exist for `programme`.

**What it takes:**
- `word`: one word of a name, such as electronics or shipping.
  - It is normalised the way list names are (`normalizeName`). It must then be exactly one word of 3 to 30 letters.
  - Errors, returned as tool errors with no evidence:
    - more than one word;
    - digits only;
    - a legal form (LTD, CO, LIMITED …), which the lists' names don't keep;
    - a function word (THE, AND, OF …).
- `list` (optional): `us`, `uk`, `eu` or `un`, the same as with programme.
- `word` with `query` runs both, the same as `programme` with `query` does today. `word` with `programme` is an error: "give programme or word, not both".

**How it matches:**
- A record matches when any of its rows (its name or one of its other names) has a whole name word equal to the word, once a trailing S is folded.
  - The fold: drop one trailing S from words of 4 letters or more, on both sides.
  - ELECTRONIC matches ELECTRONICS and the reverse; BANK doesn't match BANKING; ARMS matches ARM.
- Records are counted once by `ref`. The example shown is the first matching row, so an alias that holds the word is shown by that alias.
- `forms`: the distinct name words, across all four lists, that matched (for example ELECTRONIC and ELECTRONICS). There are at most 2 by the fold rule. These are the only spellings of the word that the copy may print.

**What it returns:**
- One `count` item per list with matches. With `list` given, there is exactly one count item, even when its count is 0.
  - Each item has `unit: "name_word"`, `list`, `forms`, `n`, `shown` and `total` (n).
  - The text and label are for the model only. The label is generic: "United States list · records by a word in their names".
- Up to 5 example list items in all, spread across the lists the way the programme mode does it (the first record of each list, then more from the first list on).
  - Each is `listItem`'s usual item, with `result` set to its count's id.
  - Examples are ordered by newest listing date first, with undated records last in the list's order, because "recent" is the usual question.
- When no list has the word (and no list was given), there is one count item with n 0 and no forms. It renders nothing. Its text tells the model that no record name on the four lists holds the word, and that a name search (`query`) checks a name.

### The copy (renderer, `api/_ask_check.js`)

Each line below is new fixed copy, filled only with a list label, a number and the forms.

- **Count**, n of 1 or more:
  - "453 records on the United States list have the word ELECTRONIC or ELECTRONICS in their names."
  - "1 record on the United Nations list has the word ELECTRONIC or ELECTRONICS in its name."
  - The forms are shared across the four lists (my call). This line prints both spellings although the UN record has only one, and that is still true: each record has one of them. Per-list forms would be more exact, but a nightly change on one list could then move a live include.
- **None**, with a list given and n 0 (the word exists on another list, so it has forms):
  - "No record on the United Nations list has the word SEMICONDUCTOR or SEMICONDUCTORS in its name."
- **Caveat**, which follows every count or none line above:
  - "This matches the word in names only: Undercurrent's copy of the lists records no country or line of business."
  - It cites its count item and is a `follows` line, like the line after a topic's none. When several count lines are cited, finish() merges the identical caveats into one sentence, which stays after the first count line. The relevance gate keeps it exactly when it keeps the line before it, and never judges it on its own.
  - It is there for the anti-goal: an answer to "Chinese electronic companies" must not read as if the country had been checked. The owner reviews the wording in the PR.
- **Examples and "Showing N of M."** need no new copy. They are the `listed` claim's existing sentences, and finish() adds "Showing 5 of 453." from `shown` and `total`.

**The echo guard.**
- The renderer prints the forms only when there are 1 or 2 of them, and each is 3 to 30 capital letters A to Z.
- No form may match the existing `verdict()` test: the LISTING, AUTHORITY and CLEAN_BILL patterns.
- Otherwise the count or none sentence fails the check: it is dropped, and the part-answer line follows what remains.
- The reader's question and the model's `word` argument are never printed. Only the forms are printed, which are words from official list names.
- For example, SAFE (US 5, EU 4) and CABLE (US 5) fail `verdict()`. A count of them is dropped, never printed.

### The oracle (`scripts/ask-oracle.mjs`)

The oracle mirrors the new copy by hand, as it does for every claim:
- the count and none sentences come from a `name_word` count item, and its examples produce the count sentence too;
- the caveat comes from the same item;
- a new check: the caveat is never said without its count or none line, and that line is never said without its caveat.

### The prompt (`api/_ask_prompt.js`) and tool description

- **The check_lists bullet** gains: "Or word (one word, such as electronics or shipping), with list when one is asked about, to count the records whose names hold it, newest first. It matches names only: the lists record no country."
- **The check_lists description and the `list` parameter** say the same. `list` now reads "With programme or word: …".
- **The prompt hash** changes, which marks the new version on the dashboard.

### Where this departs from the brief

1. **The echo guard is data-derived, not the NOT_FOUND typedSpan guard.**
   - typedSpan also requires a name-like word that is outside the site's own prose. It would refuse "electronic", "bank" and "shipping", so the count line would almost never print.
   - A word spelled as an official list name spells it, printed inside a fixed frame with a true count, can't carry the reader's text or the model's.
   - **The owner's call:** add "the reader typed it" on top? The cost: a word the model chose itself, such as SEMICONDUCTOR for "chip makers", would then be dropped. I recommend against it.
2. **One word, not several keywords.**
   - An AND of a place and a trade word (CHINA + ELECTRONICS) is the easiest way for a word match to read as a classification.
   - One word keeps the copy to one clean shape.
   - The model can make two calls.
3. **The caveat line** is a small addition the brief didn't name. It is there because a count alone could read as answering a nationality question.

## Evals

**New live cases** (category `word`, at least 3, with notes):
- Each is recorded with Ask's own tools (`runTool`) from the committed data, per the README's rules.
- Each include holds only fixed parts: no count, no "Showing" line, no date.

| id | Question | Calls | Expect |
|---|---|---|---|
| word-1 | Which banks are on the EU sanctions list? | check_lists {word: "bank", list: "eu"} | answer; includes "on the European Union list have the word BANK"; excludes "is not on the lists" |
| word-2 | Are any electronics companies on the UK sanctions list? | check_lists {word: "electronics", list: "uk"} | answer; includes "on the United Kingdom list have the word ELECTRONIC or ELECTRONICS in their names." and the caveat |
| word-3 | Does the UN list name any semiconductor companies? | check_lists {word: "semiconductor", list: "un"} | answer; includes "No record on the United Nations list has the word SEMICONDUCTOR or SEMICONDUCTORS in its name."; excludes "appears on" |

- **relevance-4** (the motivating question) gains a fourth alternative include, the US count line's fixed part ("list have the word ELECTRONIC or ELECTRONICS in their names."). Its note gains the list route. Its recorded calls stay as they are, since the chips route is still a good answer.
- **Offline tests come first** (test-first):
  - `tests/ask-tools.test.js`: counting by ref, the fold, whole words only, alias rows, forms, the newest-first order, the list filter and the spread, every input error, and `result` links.
  - `tests/ask-check.test.js`: the copy (singular, plural, none and caveat), the guard dropping a verdict form or a malformed one, `keepSentences` keeping the caveat with its line, and "Showing N of M".
  - Oracle tests: the new sentences are grounded, and a caveat alone is caught.
- **Counts that change:**
  - live cases go from 48 to 51, and question-pattern cases from 22 to 25;
  - the README's three "48"s, `tests/ask-eval.test.js` (the live-count test, the runner's printed count, and the live batches, which go from 20/20/8 to 20/20/11), `tests/ask-langsmith.test.js` (`created: 48`);
  - `MINIMUM` and `PATTERNS` gain `word`.

**Measurement:**
- Run `ask-evals` (task=evals, repetitions=3) on **main, after the merge** (my call).
  - The workflow syncs the LangSmith dataset only on main (`ask-evals.yml`, the `--sync` line). A run on the PR branch would score the PR's code against main's 48 cases and leave out word-1 to word-3.
  - The PR's own automatic eval still runs once, when it is opened, on main's cases. While the key is spent it costs nothing: its cases end as `budget`.
  - If the bar misses after the merge, Ask stays off (`ASK_PUBLIC` is unset), so I keep the change and report the numbers with a follow-up. I revert only if the new mode is the cause, which the per-case failures show: the word cases fail, or unrelated rises against the #39 run on cases that use `word`.
- Report it against the relaunch bar:
  - mean unrelated ≤ 0.20, with no run above 0.25;
  - mean relevance ≥ 0.85;
  - answer rate ≥ 75%;
  - no drop in pass rate;
  - the owner's 5 questions correct in all 3 runs.
- The last full run (on #39) gave unrelated 0.202 (worst 0.22) and relevance 0.851. The partial run on #40 gave 0.271 with 75 cases at budget, so it doesn't count.

**The eval key:**
- `OPENROUTER_EVAL_KEY` ran out during the #40 run on 22 Oct: 75 of 144 cases ended as `budget`.
- A full 3-run eval of 51 cases needs most of the $2 monthly limit.
- The PR can merge on CI before the eval. The eval numbers follow when the key has budget.

## Left to the builder

- Code layout: a small `wordRows` helper beside `programmeCount`, and the example spread shared by both modes.
- The model-facing wording of the count item's text and the error messages.
- The exact function-word list. The existing `FUNCTION_WORDS` is the base.
