# Releasing the dark ASCII redesign

PR #48 (`claude/project-ui-ux-redesign-0bc81e`). Design: `docs/specs/2026-10-26-ascii-dark-redesign-design.md`.

This plan also folds in what the Ask chatbot work of 26–27 Oct found (PRs #44–47), because Ask lives on every page of the new design and journalists judge the two together.

## What the Ask work found that touches the UI

1. **Answers read as a list of quotes.** Ask writes no prose by design ("No free text", `docs/specs/2026-10-22-ask-answers-design.md`), so it cannot explain or say "because". Journalists asked for the reasoning.
2. **Presentation clutter.** Examples come back as near-identical sentences instead of a list (the chips question gave ten). PR #44 fixed the repeated fact and the bare "Showing N of M".
3. **The page and Ask disagree on TASSOS.** The result page says "Listed by 3 of 4: the United States, the European Union and the United Kingdom". Ask (preview, 27 Oct) names only the UK and US lists and says "Showing 2 of 4 matching records". The EU listing comes from the research (the EU list has no IMO numbers), and Ask does not cite it as a listing.
4. **Model choice is open.** Haiku 5.5 passes 172 of 177 eval runs (answer rate 0.968). DeepSeek V4.1 Flash is being compared on the same code, 3 runs per case.

## Release steps

### 1. Check the preview (Tarun, about 10 minutes)

Open the Vercel preview link on PR #48, then:

1. Home: the tanker moves, the search box is first.
2. Search `TASSOS`: the red verdict line shows, the tanker and intro hide.
3. Open the shadow-fleet map and the influence network: labels readable, key fits.
4. On a phone: home and a result, no sideways scroll.
5. Open Ask, ask "Is TASSOS sanctioned?": the panel matches the dark design.

### 2. Merge and verify production (Claude, about 5 minutes, after Tarun's yes)

1. Merge PR #48 with a merge commit once CI is green.
2. Wait for the Vercel production deploy (about 1 minute).
3. Check production: home returns 200, `/?q=TASSOS` shows the verdict line, the map loads, one Ask question answers.
4. Next morning, after the 04:00 UTC nightly run: the lists date updates and the nightly commit lands without errors.

**Rollback (about 2 minutes):** Vercel Instant Rollback to the previous production deployment, then `git revert -m 1 <merge commit>` on a branch and a PR. No data or Ask changes ride on this PR, so a rollback touches only the look.

### 3. Make Ask agree with the page (Ask work, about 1–2 hours)

1. Ask cites research listings as listings, so TASSOS gets the EU listing too.
2. Ask's count line and the page's verdict use the same unit ("3 of 4 governments", not "2 of 4 matching records").
3. Add TASSOS's full verdict as an eval case.

### 4. Show the work in Ask (Ask work plus UI, about half a day)

1. The API returns which checks ran: the lists, the research, OpenSanctions, the docs.
2. The panel shows them as one line in the page's style: `4/4 checks · lists ✓ research ✓ wider ✓ docs ✓`.
3. Example lists come back as a list type and render as a `├─ └─` list, not ten sentences.

### 5. Decisions that need Tarun

1. **Ask model.** After the Haiku vs DeepSeek comparison: keep Haiku, or switch. Switching production also needs the OpenRouter guardrail "undercurrent" allowlist changed (today: `anthropic/claude-haiku-5.5` only). That is a settings change and needs its own yes.
2. **Explanation layer.** Let the model write a short explanation under the checked facts, with the server checking every name, number and date. It reverses the "No free text" rule, so it gets its own design doc first.
3. **Wording.** About the data and the influence network's methods page still say "VeilTrace team" in their research credits.

## After release, for one week

- Vercel runtime errors: none new.
- Ask fallback logs (`ask: fallback` lines with their reason codes): no rise.
- OpenRouter: the undercurrent guardrail stays under its $1 a day.
- The nightly `update-lists` workflow: commits each night, no new issues.
