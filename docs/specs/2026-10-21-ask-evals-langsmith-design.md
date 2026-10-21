# Ask evals in LangSmith: design

Status: draft for the owner's approval, 21 Oct 2026.

## Why

The owner wants a public dashboard of evaluation runs on Ask, Undercurrent's chat panel, to show recruiters. A recruiter who clicks the link should come away believing the owner **can build and test reliable AI products**. The site and its tests already exist. This project makes that testing visible, and makes it a regular habit rather than a single check before launch.

"Reliable" is shown three ways:
1. **It stays right over time.** Scheduled runs keep passing as the nightly data and the model provider change underneath.
2. **Changes are tested before they ship.** A change to Ask's prompt, model or answer rules gets a run, and its results sit next to the previous run's.
3. **The scores mean something.** Every answer is checked for grounding (every sentence traces to a real record or fixed copy), for the right kind of answer (answer, refusal or clarify), and for phrases it must never contain. Time, tokens and cost are measured too.

## Goals

- A LangSmith dataset holding Ask's real-model evaluation cases, with tests/ask-eval.json in the repo as its source of truth.
- Runs that execute Ask's own code in-process against the real model. The owner chose this, option B, over hitting the live site. LangSmith records every step: each model call (with tokens and cost), each tool call the model chose, and the checker's final answer.
- Runs **weekly** on a schedule, **once per pull request** that touches Ask (when it is ready for review), and **on demand**.
- A public share link a recruiter can open without an account.
- **Failures stay visible, each with a note** explaining why it failed and what fixed it. The owner chose this explicitly.

## Non-goals

- No tracing of real visitors. See the anti-goals.
- No LLM-as-judge. The scores are deterministic code checks: the design writes every sentence on the server, so grounding can be checked exactly. A judge may come later as its own decision.
- Model comparisons (Haiku against other models) are out of scope for now. The setup should not rule them out.
- The existing tests are not replaced. `npm test` (the offline eval, the unit tests and the oracle), Playwright and `scripts/ask-live-eval.mjs` stay as they are. The live-site script is still the launch check.

## Anti-goals (a failure even if it works)

- **A visitor's question reaches LangSmith.** The site promises "The conversation isn't stored."
  - Tracing must be impossible in production. It isn't enough for it to be switched off.
  - The `langsmith` package is a devDependency only, and nothing under `api/` imports it.
- **An eval run spends the site's $5 Ask budget**, or counts against a visitor's limit.
- **A secret reaches a log, an artifact, a trace or the repo.** Traces hold prompts, tool results and answers only, never headers or keys.
- **A flaky model result blocks a merge.** The eval is informational, not a required check.
- **Vendor data, or "team" wording, on the dashboard.** The standing project rules apply to dataset names, descriptions and notes.

## Constraints

- **Ask's loop lives in `api/ask.js`.** `converse(history, now)` runs at most 4 rounds and 10 tool calls, then forces an `answer` call. `callModel` posts to OpenRouter (model `anthropic/claude-haiku-5.5`, `provider.data_collection: deny`, `max_tokens: 800`). `runTool` (api/_ask_tools.js) returns evidence, and `checkAnswer` (api/_ask_check.js) writes every sentence.
- **Some tool data is only reachable over the internet.** Tools read committed files plus release assets fetched over HTTPS from the public `data-latest` release (`api/_asset.js`). A CI runner can reach both, with no extra download step.
- **The 20 "live" cases in tests/ask-eval.json are the real-model cases.** These are the cases without `"live": false`. Each case's `expect` has `kind`, `excludes`, sometimes `includes`, `fallback` and `notice`. The other 43 cases replay hand-written model answers against the checker. They test the checker and don't belong in a real-model run.
- **The current live script checks only `kind` and `excludes`**, because the model's choices vary.
- **Keys** live in GitHub Actions secrets, entered by the owner. They are never in chat, the repo or a log.
  - `LANGSMITH_API_KEY`
  - `OPENROUTER_EVAL_KEY`: a separate OpenRouter key with its own $2 monthly limit, so a run never touches the site's key or budget.
- **Repo conventions:**
  - Node 22 ESM.
  - `node:test`.
  - Workflows are linted with actionlint.
  - A job holds only the secrets it needs, with `permissions: contents: read` unless it needs more.
- **LangSmith free Developer plan.** Its limits must be checked before building: the monthly trace allowance, and how long base traces are kept.
- **Cost estimate:**
  - One run is 20 questions at about $0.0007–0.019 each, so roughly $0.01–0.40.
  - A month of weekly runs plus a few PR runs comes to well under $2.
  - When the eval key's limit is reached, the run is marked "budget reached", not "failed".

## Decided
- **PR runs are public.** The owner decided this on 21 Oct.
  - Each pull request that touches Ask gets **one run when it is marked ready for review**, not one per push. That caps cost at about $0.40 a PR.
  - The run lands on the same public dataset as the weekly runs, so a recruiter can see a change tested before it shipped.
  - A failing PR run gets "Under review" and a note, like any other failure.
  - The dataset's cases are synced **only from main**. A PR run evaluates main's cases, so an unmerged edit to tests/ask-eval.json never reaches the public history. New cases first run once their PR merges.

- **Option B:** in-process runs with a separate eval key. The owner decided this.
- **Failures with notes are shown publicly.** The owner decided this.
- **Cadence: weekly, plus one run per Ask PR when it is ready for review, plus manual.** The weekly cadence was my suggestion and the owner didn't object; the owner set one run per PR.
- **The seam into production code is small:**
  - `api/ask.js` exports its loop with optional hooks, through which the eval runner wraps the model call, each tool call and the checker in LangSmith tracing.
  - Without hooks, production behaves exactly as it does today, so existing tests pin that.
  - *My call:* injecting the hooks keeps the `langsmith` package out of the deployed function entirely.
- **What gets scored on each case:**
  - **pass/fail:** right `kind`, no `excludes` phrase, and grounded. Grounded means every rendered sentence is fixed copy, a server claim, or a verbatim quote from evidence returned in that same run. It reuses the oracle in tests/ask-eval.test.js.
  - **signals, not pass/fail:**
    - fell back to FALLBACK
    - `includes` matched, where the case has it
    - number of tool calls
    - latency
    - input and output tokens
    - cost in USD
- **Each run carries metadata:** the commit SHA, the trigger (weekly, pr or manual), the model id, and a hash of the system prompt and the tool definitions, so a recruiter can see what changed between runs.
- **Failure notes:**
  - A run that fails a case attaches an automatic comment straight away: "Under review", plus the date and the commit.
  - Written later, the real note is keyed by **experiment and case id**, not by case id alone, so an old note never sticks to a later failure. It says what failed, why, and what happened next. That is "fixed in <PR or commit>", "model slip, no change: passed on the next run", or "the expectation was wrong, corrected in <commit>".
  - Notes live in a small reviewable file in the repo. When that file changes on main, a backfill step posts each note to its experiment's failing case, replacing "Under review".
  - *My call:* notes in the repo stay reviewable and survive even if LangSmith expires old traces. If retention turns out shorter than the time a note takes to write, the experiment-level description carries the note instead (see "Facts to check first").
- **Failure handling:**
  - A scheduled run with a quality failure opens a GitHub issue, like the nightly workflow does. The issue quotes the case ids and links the experiment.
  - A PR run writes its result and link to the job summary, and never blocks the merge.
- **Infrastructure outcomes are not quality failures:**
  - These are an OpenRouter error or timeout ("unavailable"), a data-latest download that failed, and the eval key's limit ("budget reached").
  - Each is marked with its own outcome and shown on the dashboard, but left out of the pass rate.
  - There is no retry, so what the run shows is what a visitor would have met.
  - The weekly issue opens for an infrastructure outcome only when every case in the run hit one.
  - A failed download is told apart from a quality FALLBACK by the tool's own failure record in the run, not by the answer text.
  - *My call:* the pass rate stays an honest measure of answer quality, and outages are still visible.

## Left to the builder

- The exact LangSmith SDK calls: `evaluate`, `traceable`, dataset sync and sharing.
- The hook interface's shape, and how tokens and cost are captured from OpenRouter's `usage`.
- Dataset and experiment naming.
- The workflow's name, its schedule time, and its path filters.
- How the dataset is synced from tests/ask-eval.json: upsert by case id, so the history of runs survives edits.
- README wording for a new "Evals" section, which links the public dashboard.

## Facts to check first (before planning past them)

1. **Public share.** Can a LangSmith dataset, and its experiments, be shared as a public link on the free plan? Does that link show the per-step traces and the comments?
   - If not, come back to the owner before building further.
   - The fallback would be a small static page on the site, generated from the run results. That is a different project.
2. **Retention.** How long does the free plan keep traces and experiment results? If the per-run traces expire after about 14 days:
   - Confirm that the experiment-level scores still show history.
   - Otherwise, the runner also commits or uploads a one-line summary of each run.
3. **Trace allowance.** Does the free plan's monthly allowance cover about 6 runs a month, at 20 cases each with nested steps?

## Owner setup (done by the owner, never in chat)

1. Create a LangSmith account on the free Developer plan.
2. Create a LangSmith API key, then run `gh secret set LANGSMITH_API_KEY --repo Ttheegela/undercurrent` and paste the key at the hidden prompt.
3. Create a second OpenRouter key named `undercurrent-eval` with a $2 monthly limit, then run `gh secret set OPENROUTER_EVAL_KEY --repo Ttheegela/undercurrent`.
4. After the first run, turn on public sharing for the dataset in LangSmith (publishing is the owner's step), and put the link on the resume and portfolio.
