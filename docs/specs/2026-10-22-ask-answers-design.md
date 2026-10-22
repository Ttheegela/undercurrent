# Ask answers that answer the question: design

Status: draft for the owner's approval, 22 Oct 2026.

## Why

On 21 Oct the owner tested Ask on the live site, and most answers missed the question.

| Question | What Ask said | What was wrong |
|---|---|---|
| How old are the sanctions on DJI? | "on the US Entity List since 18 Dec 2020", plus a second DJI entry | Gave a date, not an age |
| Any sanctions on ships related to Iran? | 4 ships | Examples presented as the full list |
| How many ships have changed their name? | "each hull had a median of 4 names" | Answered a different question |
| Iran-related companies in recent updates? | 2 unrelated lobbying updates | Records unrelated to the question |

Every sentence was a true record with its source. That guarantee holds, but it isn't enough.

The four-model comparison on 21 Oct showed that a different model doesn't fix this:
- **Haiku 5.5, the current model, scored best:**
  - 38 of 39 passed;
  - Jev's mean unrelated-record score was 0.27;
  - $0.0011 per question.
- **Sonnet 5.5 scored worse:** an unrelated-record score of 0.39 at $0.020 per question. It answered more often and padded its answers more.

**The cause is what Ask can say:**
- it can't count;
- it can't turn a date into an age;
- it can't search by programme or topic;
- it can't say "none", "partial" or "examples";
- nothing checks that a cited record bears on the question.

Ask stays off (`ASK_PUBLIC` unset) until this is fixed.

## Goals

1. **Ask can say the honest negative.** Each comes from fixed copy the server decides:
   - "none of the records match";
   - "these are examples: N of M";
   - "there's no record for that period" (this one exists already).
2. **New answers the server computes:** counts, ages, and searches by programme or topic. They are still built from the data and never written by the model.
3. **Partial answers say so automatically.** When a lookup returns more matches than Ask shows, the server adds "Showing N of M." The model doesn't decide this.
4. **A relevance check before an answer is shown.** The kind of check is the owner's decision; see "Decision for the owner".
5. **Measured success,** on the eval set (39 live cases, the Jev judge, LangSmith):
   - mean unrelated-record score of **0.10 or lower** (Haiku today: 0.27), measured on the sentences that cite a record; the owner accepted (22 Oct) a fallback bar of **0.20 or lower** if 0.10 isn't reached;
   - mean relevance of **0.85 or higher** (today: 0.82);
   - the owner's 5 live questions answered correctly, where today 4 decline or fail;
   - no drop in the deterministic pass rate.

## Non-goals

- **No free text.** The model still writes no prose: every sentence is fixed copy, a server claim, or a verbatim quote.
- **No model change.** Haiku 5.5 stays, per the comparison.
- **No country-of-record counts from the official lists in phase 1.** The lists pipeline drops type, flag and country today; see phase 3.

## Anti-goals (a failure even if it works)

- **An answer that implies completeness when it is partial**, or implies a match when the records are unrelated.
- **Counts that mix units.** Lists store aliases as rows, so counts must be of distinct records (`ref`). For example, the US list has 55,187 rows but only 26,063 records.
- **An age presented as exact when its date is approximate.** Research dates marked "first seen via OpenSanctions" must say so. Many UK dates are 31 Dec 2020, the date of the post-Brexit transfer, so the age is understated; say so.
- **Echoing the reader's words unsafely.** A topic named in an answer comes from a closed vocabulary of known programmes and countries, never from free text. The existing `typedSpan` and verdict guards stay.
- **Sending a visitor's question to a new third party** without the owner's yes and an updated privacy line on the site.
- **Losing the "nothing invented" guarantee.**

## What the data supports today

From a read of the repo on 22 Oct:

- **Official lists** (`data/lists/*.json`). Each record is `[name, normName, program, date, ref, imo, url]`. There is no type, country or flag.
  - **Telling vessels apart:** a valid IMO checksum is not reliable, since company numbers pass about 1 in 10 (see Definitions); ships come from the research map. On the US list, an Iran programme gives about 701 vessel records and Russia about 458. The EU and UN lists have no IMO numbers, so their vessel counts aren't possible.
  - **Programme strings:** US programmes can be compound (e.g. "Iran, Weapons proliferation"), and there are 184 distinct strings.
- **Listing dates:** UK 100% (with the 31 Dec 2020 caveat); UN 100%; EU 91%; US only about 19%.
  - Most US sanctions programmes have no date: Russia 0 of 7,009 and Iran 14 of 4,083. The Entity List and the Denied Persons list are dated.
  - Ages therefore work for UK, UN, EU and dated US lists. Otherwise Ask says "the US list gives no listing date".
- **Research map** (`stories/shadow-fleet/network/fleet-data.json`):
  - ships by `program_group`: russia 874, iran 607, both 55, terrorism 91, venezuela 57;
  - flags: `flagged_in` and `formerly_flagged_in` edges, plus `flag_now`;
  - names per hull: `name_count` and `names_by_source`.
  - 1,076 of the 1,722 hulls with an IMO have more than one name (median 2, maximum 11).
  - "Median of 4 names" comes from a 42-hull case study in FINDINGS/METHOD, not the whole map.
- **Changes** (`data/changes/changes.json`): `graph`, `kind`, `item`, `id`, `name`, `node_type`, `field`, `from`/`to`, `summary`, `date`. There is no programme or country, but both can be reached by joining `id` to the fleet-data node.
- **Today's silent caps:**
  - check_lists shows at most 5 per list, 3 research entries and 3 OpenSanctions entries;
  - changes shows at most 30;
  - site_docs returns the top 3 sections.
  - None of these says "partial" in the rendered answer.

## Design

### New claims (server-rendered; the model only cites evidence ids)

- **`count`:** renders a count the server computed, with its scope.
  - Example: "701 vessels are on the United States list under an Iran programme." Vessels here are records with a valid IMO number; the copy names that basis.
  - Example: "1,076 of the 1,722 ships in Undercurrent's research map have had more than one name."
- **`age`:** from a list or research item's date and today.
  - Example: "DJI has been on the United States Entity List for 5 years 10 months (since 18 Dec 2020)."
  - Approximate dates add "(first seen on the list via OpenSanctions)".
  - Undated: "The United States list gives no listing date for X."
- **`none_matched`:** for a topic filter that found nothing.
  - Example: "None of the 10 updates recorded between 20 Oct 2026 and 21 Oct 2026 involve Iran."
  - The topic word comes from the closed vocabulary.
- **`examples` framing:** fixed copy the server adds after a list of examples when more exist.
  - Example: "Showing 5 of 701." This is automatic, never chosen by the model.

### Tool changes

- **check_lists** gains optional `programme` (closed vocabulary), `vessels_only` and `list` parameters. It returns:
  - a **count item** (distinct records, with its basis);
  - up to 5 example items;
  - the total.

  Name search is unchanged.
- **A research query,** a new `research` tool or a parameter on check_lists, over the research map:
  - counts by `program_group`, `flag_now` and names per hull, with examples;
  - it serves "ships related to Iran", "Venezuelan-flagged ships" and "how many ships changed names".
- **changes** gains structured filters: `programme` and `country` via the fleet-data join, plus `node_type` and `list`. It returns a `none_matched` item when nothing matches. The free-text `query` stays.
- **Every capped result** carries `shown` and `total`, and the renderer adds the examples line.

### Relevance check before showing (owner's decision; see below)

Per sentence:
1. Score whether the sentence bears on the question.
2. Drop sentences that don't.
3. If nothing is left, show "Nothing recorded on this site answers that." (new fixed copy)

This runs within the existing 26 s request limit, with a 3 s budget. If the check is unavailable, Ask shows the answer unchanged and logs a fixed line, so the check can never block an answer.

### Prompt

- Teach the new claims and tool parameters.
- Add: "If no record answers the question, use none_matched or finish with no sentences."
- The prompt-hash change marks the new version on the dashboard.

### Evals

- **Re-baseline expectations:**
  - the cases that expect a fallback today (relevance-1, relevance-2, the duration and count cases) now expect the new claims;
  - each case's `note` already says what a good answer is.
- **New cases:** each new claim gets cases, including:
  - an undated US listing;
  - a UK 31 Dec 2020 date;
  - an EU ship question, answered from the research map's listing authority.
- **Success** is measured with the targets under Goals, on Haiku, over 3 repeated runs.

## Phases

1. **Phase 1 (no pipeline change):**
   - the examples framing and `shown`/`total`;
   - the `count`, `age` and `none_matched` claims;
   - check_lists programme counts (records, not vessels);
   - the research query;
   - the changes structured filters;
   - prompt and evals.
2. **Phase 2:** the relevance check, as decided by the owner.
3. **Phase 3:** the lists pipeline (`scripts/lists.py`) keeps entity type, flag and country from the raw files, added at the end of the record so existing readers still work. That enables country counts and EU and UN vessel counts.

## Decided by the owner

**The relevance check runs on Jev, live (option A).** The owner decided this on 22 Oct.

- **What is sent:** a visitor's question plus the candidate sentences and their source labels go to TypeSafe's `/v1/systemone` (`jev-latest`). TypeSafe doesn't train on user data; retention is set by its DPA.
- **Privacy:** the site's privacy line and the About page's Ask/privacy section are updated before relaunch. They name TypeSafe alongside the AI model, and still say the conversation isn't stored by Undercurrent.
- **Key:** `TYPESAFE_API_KEY` is added to Vercel Production (Secret) by the owner, using the same `vercel env add` flow as the OpenRouter key. The eval secret already exists.
- **If the key is unset, or TypeSafe fails:** Ask shows the answer unchanged and logs a fixed line, so the check never blocks or breaks Ask.
- **What is measured:** time added per question (the budget is 3 s), and token usage per question. The check is recorded in traces like the other steps.
- **Rejected alternatives:**
  - a same-model second pass (Haiku): weaker, and unmeasured;
  - no live check.

## Definitions and measurement (my calls, after the builder check)

1. **What counts as a ship.**
   - "Ship" and "vessel" questions are answered from the **research map's ship nodes**. These are the curated hulls joined by IMO, which already carry listing authority, programme group, flags and type.
   - Copy states that scope, e.g. "662 ships in Undercurrent's research map are listed by the United States under an Iran programme."
   - The official-list programme count (`check_lists` with `programme`) counts **records on the list**, with no vessel filter, and says so ("4,083 records on the United States list are under an Iran programme"). This avoids the IMO checksum, which also passes about 1 company number in 10, so a firm can never be counted or shown as a ship.
2. **Flags.** A ship's flag comes from every flag source in the map: `flagged_in` links, `flag_us` and `flag_now`. When sources disagree, a ship counts under each flag a source gives, and the copy says "recorded as X-flagged by at least one source". `flag_now` alone (UK only, 491 ships) is never the basis.
3. **"None of the updates" is honest about what can be checked.**
   - **Fleet updates** join to fleet-data for programme and country.
   - **Lobbying updates** join through `stories/who-lobbies/influence-network/kg.json`'s group field `g` (russia, china, chips).
   - **Updates that join to neither** are reported, not counted as non-matching. Example: "None of the 0 fleet updates between 20 and 21 Oct 2026 involve Iran. The 10 lobbying updates in that period carry no country or programme to check."
4. **EU and UK ship counts** come from the research map's listing authority: 733 EU and 645 UK ships, from the EU Official Journal ship list and the UK list joined by IMO. The research query takes a `listed_by` parameter. The planned "can't count EU vessels" case is dropped; Ask answers it from the map.
5. **Phase 1 scope includes:**
   - ship type (`type`, e.g. tanker) and more than one programme at once (an AND of programme groups) in the research query, which serves count-1 and programme-2;
   - the chips firm total via the chips tool (count-3).

   Eval notes whose numbers have drifted are re-baselined to the data on the day they're rebuilt. For example, count-1's 42 is now 55 in the map, 54 of them tankers.
6. **How success is measured:**
   - **Runs:** the targets apply to the **mean of 3 runs on Haiku**, over the full live set at that time. No single run may miss a target by more than 0.05.
   - **Answer rate:** Ask must answer at least **75%** of the questions it should answer. Today it answers 27 of 39, about 69%. This stops a lower unrelated-record score being bought by declining more.
   - **Fixed cases:** the owner's 5 questions must be answered correctly in all 3 runs.
   - **Unrelated records (owner's decision, 22 Oct):** the judge scores only the sentences that cite a record, as the live gate does; fixed lines such as "Showing N of M." are scope statements and aren't scored. The target stays 0.10, with a fallback bar of **0.20 or lower** that the owner accepted if 0.10 isn't reached. The other bar items are unchanged.

## Relaunch bar (my recommendation)

Set `ASK_PUBLIC=1` again only after phase 1, plus phase 2 if chosen, when all of these hold:
- the Goals targets are met on 3 runs;
- the owner has re-asked his 5 questions on a preview deployment;
- the owner is happy with the answers.

## Left to the builder

- Exact copy for the new fixed lines, within the anti-goals; the owner reviews the copy in the PR.
- The closed vocabulary's contents: built from the 184 US programme strings, the UK/EU/UN regimes and the fleet-data countries.
- The tool parameter names.
- Whether the research query is a new tool or a check_lists mode.
