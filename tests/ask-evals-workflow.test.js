// The Ask evals workflow (.github/workflows/ask-evals.yml), read as plain text: its triggers, which job holds which secret and
// permission, the fork guard, and the two scripts that decide something (the runner's arguments, the failure issue). Those two are run
// under bash with `node` and `gh` replaced by stubs that record what they are called with. Nothing here reaches LangSmith, OpenRouter
// or GitHub. The issue script needs jq, which GitHub's runners have.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const read = (name) => readFileSync(new URL(`../.github/workflows/${name}`, import.meta.url), "utf8");
const TEXT = read("ask-evals.yml");
const [TOP, JOBS_TEXT] = TEXT.split(/^jobs:\n/m);
const JOBS = {}; // job name -> its lines
let current;
for (const line of JOBS_TEXT.split("\n")) {
  const m = line.match(/^ {2}([a-z]+):$/);
  if (m) JOBS[(current = m[1])] = [];
  else if (current) JOBS[current].push(line);
}
const indent = (line) => line.match(/^ */)[0].length;

/** The lines under `header` (the exact line, indentation included), trimmed, comments left out. */
function block(lines, header) {
  const i = lines.indexOf(header);
  assert.notEqual(i, -1, `no "${header.trim()}"`);
  const out = [];
  for (const l of lines.slice(i + 1)) {
    if (l.trim() && indent(l) <= indent(header)) break;
    if (l.trim() && !l.trim().startsWith("#")) out.push(l.trim());
  }
  return out;
}

/** One step's lines, from its `- name:` line to the next step or comment at the steps' own indentation. */
function step(job, name) {
  const i = JOBS[job].indexOf(`      - name: ${name}`);
  assert.notEqual(i, -1, `no step "${name}" in ${job}`);
  const rest = JOBS[job].slice(i + 1);
  const end = rest.findIndex((l) => l.trim() && indent(l) <= 6);
  return [JOBS[job][i], ...(end === -1 ? rest : rest.slice(0, end))];
}

/** A step's `run: |` script, as bash gets it. */
function script(job, name) {
  const lines = step(job, name);
  const i = lines.indexOf("        run: |");
  assert.notEqual(i, -1, `step "${name}" has no run: |`);
  return lines.slice(i + 1).map((l) => l.slice(10)).join("\n");
}

const secretLines = (lines) => lines.map((l) => l.trim()).filter((l) => !l.startsWith("#") && l.includes("secrets."));

// ---- what the workflow is -------------------------------------------------------------------------------------------------

test("it runs weekly on Monday, by hand (with an optional model to compare), once per opened or ready PR that touches Ask, and on a push of the notes to main", () => {
  assert.deepEqual(block(TOP.split("\n"), "on:"), [
    "schedule:",
    '- cron: "0 13 * * 1"',
    "workflow_dispatch:",
    "inputs:",
    "model:",
    'description: "OpenRouter model id to compare (empty = the site\'s model)"',
    "type: string",
    "required: false",
    'default: ""',
    "pull_request:",
    "types: [opened, ready_for_review]",
    "paths:",
    "- api/ask.js",
    "- api/_ask_*.js",
    "- tests/ask-eval.json",
    "- scripts/ask-langsmith.mjs",
    "- scripts/ask-judge.mjs",
    "- scripts/ask-oracle.mjs",
    "push:",
    "branches: [main]",
    "paths: [tests/ask-eval-notes.json]",
  ]);
  assert.deepEqual(Object.keys(JOBS), ["evals", "issue", "notes"]);
});

test("secrets reach only the one step in evals that runs the cases and the one in notes that posts the notes", () => {
  assert.equal(secretLines(TOP.split("\n")).length, 0);
  assert.equal(secretLines(JOBS.issue).length, 0);
  assert.deepEqual(secretLines(JOBS.evals), ["LANGSMITH_API_KEY: ${{ secrets.LANGSMITH_API_KEY }}", "OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_EVAL_KEY }}"]);
  assert.deepEqual(secretLines(step("evals", "Run the evals")), secretLines(JOBS.evals));
  assert.deepEqual(secretLines(JOBS.notes), ["LANGSMITH_API_KEY: ${{ secrets.LANGSMITH_API_KEY }}"]);
  assert.deepEqual(secretLines(step("notes", "Post the notes")), secretLines(JOBS.notes));
  assert.ok(!/secrets:\s*inherit/.test(TEXT));
});

test("permissions: none by default, read-only for evals and notes, issues: write only for the issue job", () => {
  assert.ok(TOP.includes("\npermissions: {}\n"));
  assert.deepEqual(block(JOBS.evals, "    permissions:"), ["contents: read"]);
  assert.deepEqual(block(JOBS.notes, "    permissions:"), ["contents: read"]);
  assert.deepEqual(block(JOBS.issue, "    permissions:"), ["issues: write"]);
});

test("no run script holds a ${{ }} expression: every value reaches the shell as an environment variable", () => {
  let scripts = 0;
  for (const [job, lines] of Object.entries(JOBS)) {
    lines.forEach((l, i) => {
      if (/^\s*(- )?run: \|$/.test(l)) {
        scripts++;
        for (const s of lines.slice(i + 1)) {
          if (s.trim() && indent(s) <= indent(l)) break;
          assert.ok(!s.includes("${{"), `${job}: ${s.trim()}`);
        }
      } else if (/^\s*(- )?run: /.test(l)) {
        scripts++;
        assert.ok(!l.includes("${{"), `${job}: ${l.trim()}`);
      }
    });
  }
  assert.ok(scripts >= 5);
});

test("every action is pinned to a full commit SHA with a version comment that check.yml or update-lists.yml already uses", () => {
  const uses = (text) => text.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("- uses: ")).map((l) => l.slice(8));
  const known = new Set([...uses(read("check.yml")), ...uses(read("update-lists.yml"))]);
  const mine = uses(TEXT);
  assert.ok(mine.length >= 6);
  for (const u of mine) {
    assert.match(u, /^actions\/[a-z-]+@[0-9a-f]{40} # v\d/, u);
    assert.ok(known.has(u), u);
  }
});

// ---- the evals job --------------------------------------------------------------------------------------------------------

/** The job's `if:` as GitHub evaluates it, for these event shapes: its expression is plain JavaScript once the ${{ }} is off. */
function runs(github) {
  const expr = JOBS.evals.find((l) => l.startsWith("    if: ")).slice(8).replace(/^\$\{\{\s*|\s*\}\}$/g, "");
  return new Function("github", `return ${expr}`)(github);
}

test("evals runs on schedule, dispatch and same-repo PRs that are not drafts, and skips a push, a draft and a fork", () => {
  const pr = (head, draft) => ({ event_name: "pull_request", repository: "Ttheegela/undercurrent", event: { pull_request: { draft, head: { repo: { full_name: head } } } } });
  assert.equal(runs({ event_name: "schedule", event: {} }), true);
  assert.equal(runs({ event_name: "workflow_dispatch", event: {} }), true);
  assert.equal(runs(pr("Ttheegela/undercurrent", false)), true);
  assert.equal(runs(pr("Ttheegela/undercurrent", true)), false);
  assert.equal(runs(pr("someone/undercurrent", false)), false);
  assert.equal(runs({ event_name: "push", event: {} }), false);
  assert.ok(JOBS.evals.join("\n").includes("github.event.pull_request.head.repo.full_name == github.repository"));
});

test("evals gets 20 minutes, one concurrency group per ref that never cancels a run, and uploads the result", () => {
  assert.ok(JOBS.evals.includes("    timeout-minutes: 20"));
  // main's runs (weekly, and a dispatch on main) share refs/heads/main, a PR has refs/pull/N/merge, so two syncs cannot overlap
  assert.deepEqual(block(JOBS.evals, "    concurrency:"), ["group: ask-evals-${{ github.ref }}", "cancel-in-progress: false"]);
  assert.ok(JOBS.evals.includes("      - run: npm ci"));
  const upload = JOBS.evals.slice(JOBS.evals.findIndex((l) => l.includes("actions/upload-artifact@")));
  assert.deepEqual(block(upload, "        with:"), [
    "name: ask-evals-result",
    "path: ${{ runner.temp }}/ask-evals.json",
    "retention-days: 7",
    "if-no-files-found: error",
  ]);
});

/** Runs the "Run the evals" script with `node` stubbed; returns the arguments `node` was called with, one per line. */
function runnerArgs(env) {
  const dir = mkdtempSync(join(tmpdir(), "ask-evals-run-"));
  mkdirSync(join(dir, "bin"));
  writeFileSync(join(dir, "bin", "node"), '#!/bin/sh\nprintf "%s\\n" "$@" > "$RUNNER_TEMP/node-args"\necho "node was called"\n');
  chmodSync(join(dir, "bin", "node"), 0o755);
  writeFileSync(join(dir, "run.sh"), script("evals", "Run the evals"));
  execFileSync("bash", ["--noprofile", "--norc", "-e", "-o", "pipefail", join(dir, "run.sh")], {
    env: { PATH: `${join(dir, "bin")}:${process.env.PATH}`, RUNNER_TEMP: dir, ...env },
    stdio: "pipe",
  });
  return readFileSync(join(dir, "node-args"), "utf8").trim().split("\n");
}

const SHA = "0123abcdef4567890123abcdef4567890123abcd";
const HEAD = "fedcba9876543210fedcba9876543210fedcba98";
const OUT = (args) => ["scripts/ask-langsmith.mjs", "run", ...args, "--out"];

test("the runner syncs the dataset on main alone, and records the PR's own commit on a PR run", () => {
  const got = (env) => runnerArgs({ SHA, ...env }).slice(0, -1); // (the last is the --out path)
  assert.deepEqual(got({ EVENT: "schedule", REF: "refs/heads/main" }), OUT(["--trigger", "weekly", "--commit", SHA, "--sync"]));
  assert.deepEqual(got({ EVENT: "workflow_dispatch", REF: "refs/heads/main" }), OUT(["--trigger", "manual", "--commit", SHA, "--sync"]));
  assert.deepEqual(got({ EVENT: "workflow_dispatch", REF: "refs/heads/feat/ask-evals" }), OUT(["--trigger", "manual", "--commit", SHA]));
  assert.deepEqual(got({ EVENT: "pull_request", REF: "refs/pull/31/merge", PR: "31", HEAD_SHA: HEAD }), OUT(["--trigger", "pr", "--pr", "31", "--commit", HEAD]));
  assert.ok(runnerArgs({ SHA, EVENT: "schedule", REF: "refs/heads/main" }).at(-1).endsWith("/ask-evals.json"));
});

const MODEL_RE = "^[a-z0-9][a-z0-9._-]*/[a-z0-9][a-z0-9._:-]*$"; // the runner's own pattern for --model

test("a dispatch's model input reaches the runner as --model, through env, and only when it is set", () => {
  assert.ok(step("evals", "Run the evals").includes("          MODEL_ID: ${{ inputs.model }}"));
  const got = (env) => runnerArgs({ SHA, ...env }).slice(0, -1); // (the last is the --out path)
  const id = "deepseek/deepseek-v4.1-flash";
  assert.deepEqual(got({ EVENT: "workflow_dispatch", REF: "refs/heads/main", MODEL_ID: id }), OUT(["--trigger", "manual", "--commit", SHA, "--sync", "--model", id]));
  assert.deepEqual(got({ EVENT: "workflow_dispatch", REF: "refs/heads/feat/ask-eval-models", MODEL_ID: id }), OUT(["--trigger", "manual", "--commit", SHA, "--model", id]));
  assert.deepEqual(got({ EVENT: "workflow_dispatch", REF: "refs/heads/main", MODEL_ID: "qwen/qwen3.8-27b:free" }), OUT(["--trigger", "manual", "--commit", SHA, "--sync", "--model", "qwen/qwen3.8-27b:free"]));
  assert.deepEqual(got({ EVENT: "workflow_dispatch", REF: "refs/heads/main", MODEL_ID: "" }), OUT(["--trigger", "manual", "--commit", SHA, "--sync"]));
  assert.deepEqual(got({ EVENT: "schedule", REF: "refs/heads/main" }), OUT(["--trigger", "weekly", "--commit", SHA, "--sync"])); // (no input at all)
  // the shell checks the runner's own pattern
  assert.ok(script("evals", "Run the evals").includes(`'${MODEL_RE}'`));
  assert.ok(readFileSync(new URL("../scripts/ask-langsmith.mjs", import.meta.url), "utf8").includes(`/${MODEL_RE.replace("/", "\\/")}/`));
});

test("a model input that is not vendor/model fails the step with a fixed message, and the runner is never called", () => {
  const hostile = ["x; rm -rf /", "$(id)", "`id`", "a/b; id", "a/b\nid", "a/b && id", "a/b' --sync '", "--sync", "../../etc/passwd", "Anthropic/Claude-Haiku-5.5", "deepseek", "a/b/c", " a/b"];
  for (const value of hostile) {
    assert.throws(() => runnerArgs({ SHA, EVENT: "workflow_dispatch", REF: "refs/heads/main", MODEL_ID: value }), (e) => {
      assert.equal(e.status, 1, JSON.stringify(value));
      assert.equal(e.stdout.toString(), "::error::The model input must look like vendor/model.\n", JSON.stringify(value)); // (fixed: the value is not echoed)
      return true;
    });
  }
});

// ---- the issue job --------------------------------------------------------------------------------------------------------

test("the issue job runs after evals, on schedule only, whether evals finished or not, and downloads only a result that was made", () => {
  assert.ok(JOBS.issue.includes("    needs: evals"));
  assert.ok(JOBS.issue.includes("    if: github.event_name == 'schedule' && !cancelled()"));
  const download = JOBS.issue.findIndex((l) => l.includes("actions/download-artifact@"));
  assert.notEqual(download, -1);
  assert.equal(JOBS.issue[download + 1], "        if: needs.evals.result == 'success'");
  assert.ok(JOBS.issue.includes("          EVALS_RESULT: ${{ needs.evals.result }}"));
  assert.ok(!JOBS.issue.some((l) => l.includes("actions/checkout@")), "it runs none of the repository's code");
});

/**
 * Runs the issue script on a result file (none when `result` is undefined, as when evals did not finish), with `gh` stubbed and
 * `needs.evals.result` as `evals`. Returns what `gh` was called with, one call per line, arguments tab-separated.
 */
function issueCalls(result, { existing = "", evals = "success" } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "ask-evals-issue-"));
  mkdirSync(join(dir, "bin"));
  mkdirSync(join(dir, "ask-evals"));
  writeFileSync(join(dir, "bin", "gh"), '#!/bin/sh\nprintf "%s\\t" "$@" >> "$GH_LOG"\nprintf "\\n" >> "$GH_LOG"\n[ "$1 $2" = "issue list" ] && printf "%s" "$GH_EXISTING"\nexit 0\n');
  chmodSync(join(dir, "bin", "gh"), 0o755);
  if (result !== undefined) writeFileSync(join(dir, "ask-evals", "ask-evals.json"), typeof result === "string" ? result : JSON.stringify(result));
  writeFileSync(join(dir, "issue.sh"), script("issue", "Open or update the failure issue"));
  const log = join(dir, "gh.log");
  writeFileSync(log, "");
  execFileSync("bash", ["--noprofile", "--norc", "-e", "-o", "pipefail", join(dir, "issue.sh")], {
    env: { PATH: `${join(dir, "bin")}:${process.env.PATH}`, RUNNER_TEMP: dir, GH_LOG: log, GH_EXISTING: existing, EVALS_RESULT: evals, RUN_URL: "https://github.com/o/r/actions/runs/9", GH_TOKEN: "t", GH_REPO: "o/r" },
    stdio: "pipe",
  });
  return readFileSync(log, "utf8").split("\n").filter((l) => l && !l.startsWith("issue\tlist\t")).map((l) => l.split("\t").slice(0, -1));
}

const URL_OK = "https://smith.langchain.com/o/1/datasets/2/compare?selectedSessions=3";
const result = (over = {}) => ({
  experiment: "ask-weekly-1", url: URL_OK, trigger: "weekly", commit: SHA, allInfra: false, failures: [],
  counts: { quality: 20, pass: 20, fail: 0, unavailable: 0, budget: 0, download_failed: 0 }, ...over,
});

test("issue rule: no issue when every answered case passed, one when any failed or when none was answered", () => {
  assert.deepEqual(issueCalls(result()), []);
  assert.deepEqual(issueCalls(result({ counts: { ...result().counts, quality: 12, pass: 12, unavailable: 8 } })), []); // (infrastructure alone is no failure while some were answered)
  const failed = issueCalls(result({ failures: ["fear-false-listing-1", "b-2"], counts: { ...result().counts, pass: 18, fail: 2 } }));
  assert.equal(failed.length, 1);
  assert.deepEqual(failed[0].slice(0, 3), ["issue", "create", "--title"]);
  assert.match(failed[0][3], /^Ask evals: weekly run failed \(\d{4}-\d\d-\d\d\)$/);
  assert.equal(failed[0][4], "--body");
  assert.match(failed[0][5], /Failed cases: `fear-false-listing-1, b-2`/);
  assert.ok(failed[0][5].includes("Run: https://github.com/o/r/actions/runs/9."));
  assert.ok(failed[0][5].endsWith(`Experiment: ${URL_OK}`));
  const infra = issueCalls(result({ allInfra: true, counts: { quality: 0, pass: 0, fail: 0, unavailable: 20, budget: 0, download_failed: 0 } }));
  assert.equal(infra.length, 1);
  assert.match(infra[0][5], /No case was answered/);
  assert.ok(!infra[0][5].includes("Failed cases"));
});

test("an open issue with the title's prefix gets a comment instead of a second issue", () => {
  const calls = issueCalls(result({ failures: ["a-1"], counts: { ...result().counts, pass: 19, fail: 1 } }), { existing: "42" });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].slice(0, 3), ["issue", "comment", "42"]);
  assert.match(calls[0][4], /^Ask evals: weekly run failed \(\d{4}-\d\d-\d\d\)\. /);
});

test("case ids and the experiment URL are inert data: cut down to what they may hold, and a foreign URL left out", () => {
  const evil = "x`\n## [click](https://evil.example) $(touch /tmp/pwned) ${HOME} <img src=x>";
  const [call] = issueCalls(result({ failures: ["ok-1", evil, 7, null, "A".repeat(200), "a".repeat(200)], url: `${URL_OK}\n[x](https://evil.example)`, counts: { ...result().counts, pass: 14, fail: 6 } }));
  const body = call[5];
  assert.ok(!body.includes("\n"));
  assert.ok(!/[[\]()<>$]/.test(body), body);
  assert.ok(!body.includes("evil.example") && !body.includes("Experiment:"), body);
  assert.ok(body.includes(`Failed cases: \`ok-1, xclickhttpsevilexampletouchtmppwnedimgsrcx, ${"a".repeat(60)}\`.`), body); // (a 60-character cut; the uppercase id is empty)
  for (const url of [`${URL_OK}\n`, "https://evil.example/x", "http://smith.langchain.com/x", "https://smith.langchain.com.evil.example/x", "javascript:alert(1)", 5]) {
    assert.ok(!issueCalls(result({ allInfra: true, url }))[0][5].includes("Experiment:"), String(url));
  }
  assert.ok(issueCalls(result({ allInfra: true, url: "https://eu.smith.langchain.com/o/1/datasets/2/compare?selectedSessions=3" }))[0][5].includes("Experiment: https://eu.smith.langchain.com/"));
});

test("a result file without counts.fail and allInfra fails the job instead of passing quietly", () => {
  assert.throws(() => issueCalls({ experiment: "x" }), (e) => e.status === 1);
  assert.throws(() => issueCalls(result({ counts: { fail: "0" } })), (e) => e.status === 1);
  assert.throws(() => issueCalls("not json"), (e) => e.status > 0); // (jq's own status for unreadable input differs between versions)
});

const RUNNER_ERROR_BODY = "The eval runner did not finish. See the run: https://github.com/o/r/actions/runs/9";

test("a scheduled run whose evals job did not finish opens the issue with fixed text and the run's link, whatever is in the artifact", () => {
  for (const evals of ["failure", "cancelled"]) { // (a runner error or a crash; the time limit)
    const calls = issueCalls(undefined, { evals }); // (no artifact: nothing for jq to fail on)
    assert.equal(calls.length, 1, evals);
    assert.deepEqual(calls[0].slice(0, 3), ["issue", "create", "--title"]);
    assert.match(calls[0][3], /^Ask evals: weekly run failed \(\d{4}-\d\d-\d\d\)$/);
    assert.deepEqual(calls[0].slice(4), ["--body", RUNNER_ERROR_BODY]);
  }
  // an artifact left over from somewhere is not read when evals did not succeed
  const hostile = result({ failures: ["x`## [click](https://evil.example)"], url: "https://smith.langchain.com/x", counts: { ...result().counts, pass: 19, fail: 1 } });
  assert.deepEqual(issueCalls(hostile, { evals: "failure" })[0].slice(4), ["--body", RUNNER_ERROR_BODY]);
  assert.deepEqual(issueCalls("not json", { evals: "failure" })[0].slice(4), ["--body", RUNNER_ERROR_BODY]);
  // evals reported success but its result file is not there: the same issue, not a jq error
  assert.deepEqual(issueCalls(undefined, { evals: "success" })[0].slice(4), ["--body", RUNNER_ERROR_BODY]);
});

test("a runner-error issue goes as a comment on an open issue with the same title prefix", () => {
  const calls = issueCalls(undefined, { evals: "failure", existing: "42" });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].slice(0, 3), ["issue", "comment", "42"]);
  assert.match(calls[0][4], /^Ask evals: weekly run failed \(\d{4}-\d\d-\d\d\)\. The eval runner did not finish\. See the run: https:\/\/github\.com\/o\/r\/actions\/runs\/9$/);
});

// ---- the notes job --------------------------------------------------------------------------------------------------------

test("notes runs on a push, with the LangSmith key alone", () => {
  assert.ok(JOBS.notes.includes("    if: github.event_name == 'push'"));
  assert.ok(JOBS.notes.includes("        run: node scripts/ask-langsmith.mjs notes"));
  assert.ok(!JOBS.notes.join("\n").includes("OPENROUTER"));
});
