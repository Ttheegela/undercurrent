# Ask evals in LangSmith: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** a public LangSmith dashboard of real-model eval runs on Ask. It runs weekly, once per Ask PR and on demand, and every step of each run is traced. Failures stay visible with notes.

**Architecture:**
- `api/ask.js` exports its loop as `runAsk(history, now, { wrap })`. A `wrap` hook lets a caller wrap the model call, each tool call and the checker. Production passes no hook, and nothing under `api/` imports `langsmith`.
- A Node runner (`scripts/ask-langsmith.mjs`) wraps those three steps in LangSmith's `traceable` and runs `evaluate()` over a dataset synced from tests/ask-eval.json. It scores each case with shared judge and grounding modules that the existing live script and offline eval also use.
- A GitHub workflow runs it with two secrets. It opens an issue when a weekly run fails, and backfills notes when the notes file changes.

**Tech stack:**
- Node 22 ESM and `node:test`.
- `langsmith` (npm, pinned exact, a devDependency only).
- GitHub Actions, with actions pinned by SHA as in check.yml.
- OpenRouter `anthropic/claude-haiku-5.5`.

**Spec:** docs/specs/2026-10-21-ask-evals-langsmith-design.md, approved 21 Oct 2026. Read it first. Its "Decided" and "Anti-goals" sections are binding.

## Global constraints

- **No visitor reaches LangSmith.**
  - `langsmith` appears only in `devDependencies`.
  - No file under `api/` imports it.
  - Production calls `runAsk` with no `wrap`.
- **Secrets:**
  - `LANGSMITH_API_KEY` and `OPENROUTER_EVAL_KEY` are GitHub secrets only.
  - In the eval job, `OPENROUTER_EVAL_KEY` is exposed as env `OPENROUTER_API_KEY`, which `api/ask.js` already reads.
  - Nothing prints either key. Traced inputs never include headers or env.
- **Workflow permissions:**
  - The eval and notes jobs get `permissions: contents: read`.
  - Only the issue job gets `issues: write`, and it holds no secrets.
  - Fork PRs are skipped: `github.event.pull_request.head.repo.full_name == github.repository`.
- **Runs:**
  - Weekly at `0 13 * * 1` (Monday 13:00 UTC), plus `workflow_dispatch`.
  - On `pull_request` with `types: [opened, ready_for_review]` and `!draft`, path-filtered to Ask files. That is one run per PR, and pushes to an open PR don't re-run.
- **The dataset is synced only from main:**
  - Weekly and manual runs on main sync before running.
  - A PR run never syncs; it evaluates main's examples.
- **Dataset name:** `undercurrent-ask`.
- **Experiment prefixes:** `ask-weekly`, `ask-manual`, `ask-pr-<number>`.
- **Metadata on every experiment:**
  - `commit` (full SHA)
  - `trigger` (`weekly` | `manual` | `pr`)
  - `pr` (number or null)
  - `model` (`anthropic/claude-haiku-5.5`)
  - `prompt_hash`: the first 12 hex characters of sha256 over `SYSTEM_PROMPT + JSON.stringify(TOOLS)`.
- **Cases:** the 20 cases in tests/ask-eval.json without `"live": false`. The example id is the case `id`, stored as the example's metadata `case_id`, and sync upserts by it.
- **Outcomes per case:**
  - `quality`: Ask answered.
  - `unavailable`: runAsk returned `{ok:false, reason:"unavailable"}`.
  - `budget`: `reason:"resting"`.
  - `download_failed`: any tool recorded a failed download in `ctx.failed`, which takes precedence over `quality`.
- **Scores:**
  - `pass` (1 or 0) is recorded **only** for `quality` outcomes, so the pass rate leaves infrastructure out.
  - `pass` = `kind_ok && excludes_ok && grounded`.
  - Signals: `fallback`, `includes_ok` (only where the case has `includes`), `tool_calls`, `latency_s`, `tokens_in`, `tokens_out`, `cost_usd` (null when OpenRouter doesn't report a cost) and `outcome` (the string).
- **No retries.** `numRepetitions: 1`, `maxConcurrency: 2`.
- **Failure notes:**
  - Every case with `pass` = 0 gets feedback key `note` with comment `Under review · YYYY-MM-DD · <short sha>`.
  - Backfill replaces that comment from tests/ask-eval-notes.json, an array of `{ "experiment": "<full experiment name>", "case": "<case id>", "note": "<text>" }`.
- **Issue rule:** a weekly run opens an issue titled `Ask evals: weekly run failed (<date>)` when any `quality` case has `pass` = 0, or when every case is non-`quality`.
- **Wording:** independent-project voice, no "team", no vendor names other than LangSmith and OpenRouter.

## Review focus

1. **Secrets are missing** (a fork PR, or before the owner adds them). The runner exits 2 with `LANGSMITH_API_KEY is not set` or `OPENROUTER_API_KEY is not set` before any network call, and the workflow skips fork PRs rather than going red. Pinned in Task 3.
2. **The eval key's limit is reached mid-run.** The remaining cases are `budget`, have no `pass` score and open no issue unless every case is non-quality. Pinned in Task 3.
3. **A key leaks into a trace.** The traced `callModel` inputs are `{messages, toolChoice}` only, and a fake key string never appears in any captured trace payload. Pinned in Task 3.
4. **A PR run before the dataset exists.** The runner exits 1 with `dataset undercurrent-ask not found: run the workflow manually on main first`. Pinned in Task 4.
5. **A PR tries to sync.** `run --trigger pr --sync` is refused with exit 2 before any call. Pinned in Task 4.

---

### Task 1: The seam in api/ask.js

**Files:**
- Modify: `api/ask.js` (`callModel`, `converse`, `POST`; add `runAsk`; export `MODEL`)
- Test: `tests/ask.test.js`

**Interfaces:**
- Produces:
  - `export const MODEL = "anthropic/claude-haiku-5.5"`.
  - `export async function runAsk(history, now, { wrap } = {})`. It returns exactly what POST replies with today: `{ok:true, answer}` or `{ok:false, reason, resets?}`. It holds the existing 26 s race and `clearTimeout`, moved out of POST.
  - `wrap(name, fn)` is called once per request for each of `"callModel"`, `"runTool"` and `"checkAnswer"`, and its return value replaces `fn` for that request. Default: identity.
  - `callModel` resolves to `{message, usage}`, where `usage` is OpenRouter's `body.usage` or `null`, or to `{stop}` as today.
  - POST calls `runAsk(history, now)` with no third argument.

- [ ] **Step 1: Write failing tests.** Add to tests/ask.test.js (stub `fetch` as the file already does):
  - `runAsk without wrap gives the same reply as POST for the same stubbed model`
  - `runAsk calls wrap once each for callModel, runTool and checkAnswer, and uses what it returns`: record the names, and make the `checkAnswer` wrapper return a sentinel answer that runAsk passes through.
  - `the wrapped callModel resolves to {message, usage} with OpenRouter's usage`: stub a body with `usage: {prompt_tokens: 10, completion_tokens: 2, cost: 0.0001}`.
  - `nothing under api/ imports langsmith, and package.json has it only in devDependencies`: read the files and assert no `langsmith` in any `api/**/*.js`.
- [ ] **Step 2:** `node --test tests/ask.test.js`. Expected: the new tests FAIL (runAsk is not exported).
- [ ] **Step 3: Implement.** Move the race into `runAsk`, apply `wrap` inside `converse` for that request, and return `usage` from `callModel`. Don't change the request body, limits or logging.
- [ ] **Step 4:** `npm test`. Expected: everything passes, and the existing POST tests are unchanged.
- [ ] **Step 5: Commit** `feat(ask): export runAsk with a wrap hook for traced eval runs`.

### Task 2: Shared judge and grounding check

**Files:**
- Create: `scripts/ask-judge.mjs`
- Create: `scripts/ask-oracle.mjs`
- Modify: `scripts/ask-live-eval.mjs`, which uses `judge`
- Modify: `tests/ask-eval.test.js`, which uses `groundingProblems` inside `assertNoLeak`
- Test: `tests/ask-judge.test.js`

**Interfaces:**
- Produces:
  - `export function judge(c, result) -> { kind, sentences, kindOk, excludesOk, includesOk, fallback, problems }`.
    - `result` is a runAsk-shaped reply. `kind` is the answer's kind, or the reason when `ok:false`.
    - `kindOk` follows the live script's rule, accepting `expect.fallback` and `expect.notice`.
    - `includesOk` is null when the case has no `includes`.
    - `fallback` is true when kind is `"fallback"`.
    - `problems` holds the live script's messages, unchanged.
  - `export function groundingProblems(question, ev, answer) -> string[]`: the body of `assertNoLeak` (tests/ask-eval.test.js:86-147), returning messages instead of asserting. An empty array means grounded. The fixed-copy constants and `NOT_FOUND` move here with it.
  - `ask-live-eval.mjs` maps its HTTP reply to a runAsk shape (`{ok:true, answer}` or `{ok:false, reason}`) and calls `judge`. Its output and exit codes are unchanged.

- [ ] **Step 1: Write failing tests** in tests/ask-judge.test.js:
  - `judge passes off-topic-1 as a refusal or an answer ending in the notice, and fails a plain answer`
  - `judge flags each excluded phrase, case-insensitively`
  - `judge treats {ok:false, reason:"unavailable"} as kind "unavailable" with kindOk false`
  - `groundingProblems is [] for every case's recorded model answer through checkAnswer, and names the sentence for an injected free-text sentence`
- [ ] **Step 2:** `node --test tests/ask-judge.test.js`. Expected: FAIL, because the modules are missing.
- [ ] **Step 3: Implement both modules by moving code, not rewriting it.** Make `assertNoLeak` become `assert.deepEqual(groundingProblems(c.question, c.evidence, out), [], c.id)`.
- [ ] **Step 4:** `npm test`. Expected: all pass, and the live-runner tests in ask-eval.test.js are unchanged.
- [ ] **Step 5: Commit** `refactor(ask): share the eval judge and the grounding check`.

### Task 3: The LangSmith runner (`run`)

**Files:**
- Create: `scripts/ask-langsmith.mjs`
- Modify: `package.json`, adding `"langsmith": "<exact current version>"` to devDependencies; then run `npm install`
- Test: `tests/ask-langsmith.test.js`

**Interfaces:**
- Consumes:
  - `runAsk` and `MODEL` (Task 1)
  - `judge` and `groundingProblems` (Task 2)
  - `TOOLS` from `api/_ask_tools.js` and `SYSTEM_PROMPT` from `api/_ask_prompt.js`
- Produces:
  - **CLI:** `node scripts/ask-langsmith.mjs run --trigger weekly|manual|pr [--pr N] [--sync] [--out FILE]`. It writes the result JSON to `--out`, and appends a Markdown summary to `$GITHUB_STEP_SUMMARY` when that is set.
  - **Exit codes:** 0 when the run completed, whatever the scores. 1 on a runner error. 2 on bad arguments or a missing key.
  - **Result JSON:** `{ experiment, url, trigger, commit, counts: {quality, pass, fail, unavailable, budget, download_failed}, failures: [case ids], allInfra: boolean }`.
  - **For tests:** `export async function runEvals(opts, deps)`. `deps` = `{ client, evaluate, traceable, runAsk, now, env }`, so tests pass fakes and make no network calls.
  - **`target(inputs)`:** calls `runAsk([{role:"user", content: inputs.question}], now, { wrap })`.
    - `wrap` puts `traceable` around each step, with run types `llm` for callModel, `tool` for runTool and `chain` for checkAnswer.
    - It captures `ev`, `ctx.failed`, the tool-call count and the usage totals.
    - It returns `{ result, ev, outcome, tool_calls, tokens_in, tokens_out, cost_usd, latency_s }`.
  - **One evaluator** returns every feedback key listed under Global constraints.
  - After `evaluate`, every `pass` = 0 run gets the `note` feedback "Under review · …".

- [ ] **Step 1: Read the installed SDK's documentation.** Then pin in a code comment the exact calls used: `evaluate` options (`data`, `evaluators`, `experimentPrefix`, `metadata`, `maxConcurrency`, `numRepetitions`), how to read each result's run id and the experiment URL, `traceable` options, and `client.createFeedback` arguments.
- [ ] **Step 2: Write failing tests**, using a fake client, evaluate and traceable that record calls:
  - `run refuses a missing LANGSMITH_API_KEY or OPENROUTER_API_KEY with exit 2 before any client call`
  - `each case is scored: pass only for quality outcomes; unavailable, resting and a failed download become outcomes without pass`
  - `a run where every case hits the key limit has allInfra true and no failures`
  - `failing cases get one "Under review · <date> · <short sha>" note each`
  - `metadata carries commit, trigger, pr, model and a 12-hex prompt_hash`
  - `no traced payload contains the OpenRouter key`: set env to a sentinel string and search every recorded traceable input and output.
  - `cost_usd is null when usage has no cost`
- [ ] **Step 3:** `node --test tests/ask-langsmith.test.js`. Expected: FAIL.
- [ ] **Step 4: Implement `runEvals` and the CLI.** Leave `--sync` to Task 4: here it is parsed and passed on.
- [ ] **Step 5:** `npm test`. Expected: all pass.
- [ ] **Step 6: Commit** `feat(evals): run Ask's eval cases in LangSmith with traced steps`.

### Task 4: Dataset sync and note backfill

**Files:**
- Modify: `scripts/ask-langsmith.mjs`, adding `--sync` and a `notes` command
- Create: `tests/ask-eval-notes.json`, containing `[]`
- Test: `tests/ask-langsmith.test.js`

**Interfaces:**
- Produces:
  - `export async function syncDataset(cases, deps)`:
    - Creates `undercurrent-ask` if it is missing.
    - Upserts one example per live case. Inputs are `{question}`. Outputs are `{expect}`. Metadata is `{case_id, category}`.
    - Removes examples whose `case_id` is no longer live.
    - Returns `{created, updated, removed}`.
  - **`run` without `--sync` when the dataset is missing:** exit 1 with `dataset undercurrent-ask not found: run the workflow manually on main first`.
  - **`--trigger pr` with `--sync`:** exit 2 with `a PR run never syncs the dataset`.
  - **CLI** `node scripts/ask-langsmith.mjs notes`: for each entry in tests/ask-eval-notes.json, it finds the experiment and the run whose example `case_id` matches, then replaces that run's `note` comment.
    - An entry whose experiment or case isn't found is reported, and makes the command exit 1.
  - `export async function backfillNotes(entries, deps) -> {updated, missing: [entries]}`.

- [ ] **Step 1: Write failing tests**, using a fake client:
  - `sync creates the dataset once and upserts by case_id; an edited case updates, a removed case is deleted`
  - `run without --sync on a missing dataset exits 1 with the message`
  - `a PR run with --sync exits 2 before any call`
  - `notes replaces the Under-review comment on the matching run only, and reports an unknown experiment`
- [ ] **Step 2:** run them. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** `npm test`. Expected: all pass.
- [ ] **Step 5: Commit** `feat(evals): sync the dataset from main and backfill failure notes`.

### Task 5: Workflow and README

**Files:**
- Create: `.github/workflows/ask-evals.yml`
- Modify: `README.md`, adding a section "Evals" after "Ask". Also regenerate README.html if the repo's docs build covers it (`scripts/build_docs.py`).
- Test: `tests/ask-evals-workflow.test.js`

**Interfaces:**
- Consumes: the CLI from Tasks 3 and 4.
- **Workflow:**
  - **Triggers** (see Global constraints for the values):
    - `schedule`
    - `workflow_dispatch`
    - `pull_request` (types and paths). The paths are `api/ask.js`, `api/_ask_*.js`, `tests/ask-eval.json`, `scripts/ask-langsmith.mjs`, `scripts/ask-judge.mjs` and `scripts/ask-oracle.mjs`.
    - `push` to `main` with `paths: [tests/ask-eval-notes.json]`.
  - **Jobs:**
    - `evals`: runs on schedule, dispatch and same-repo PRs that aren't drafts. It runs `run --trigger …` with `--sync` on schedule and dispatch, uploads the result JSON as an artifact, and has `timeout-minutes: 20`.
    - `issue`: runs on schedule only, after `evals`. It has no secrets and `issues: write`. It reads the artifact and opens the issue according to the issue rule, with the failing case ids and the experiment URL as inert text.
    - `notes`: runs on push only, with `LANGSMITH_API_KEY` only.

- [ ] **Step 1: Write a failing test** in tests/ask-evals-workflow.test.js. It parses the YAML text with simple line checks, as the repo's other workflow tests do, and asserts:
  - the triggers and the cron;
  - that secrets appear only in the `evals` and `notes` jobs;
  - `permissions` per job;
  - the fork guard.
- [ ] **Step 2:** run it. Expected: FAIL.
- [ ] **Step 3: Write the workflow.** Pin actions by the same SHAs as check.yml. Then `actionlint .github/workflows/ask-evals.yml`. Expected: no findings.
- [ ] **Step 4: Write the README "Evals" section.** Cover:
  - what runs and when;
  - the scores and outcomes;
  - notes and how to add one;
  - the two secrets, by name only;
  - cost ($0.01–0.40 a run, with a $2 monthly eval key);
  - the public dashboard link, as a placeholder line `Dashboard: (link added after the first run)`.
- [ ] **Step 5:** `npm test` and `.venv/bin/python -m pytest -q scripts`. Expected: all pass.
- [ ] **Step 6: Commit** `ci(evals): weekly and per-PR Ask evals in LangSmith`.

### Task 6: First run (the controller and the owner, after merge)

Run this once the PR merges, not as a subagent task.
1. The owner adds both secrets. Verify them by name only with `gh secret list --repo Ttheegela/undercurrent`.
2. `gh workflow run ask-evals.yml --ref main`. Check that the job is green, that the dataset holds 20 examples and that the experiment is listed, and read the result JSON from the artifact.
3. Check LangSmith's Usage page with the owner, to confirm experiments run on the free plan and to see what one run used.
4. **The owner shares the dataset publicly.** This is a publishing step, so it is theirs.
5. A small PR replaces the README placeholder with the link.
