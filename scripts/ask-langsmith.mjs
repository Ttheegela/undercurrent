#!/usr/bin/env node
// Runs Ask's real-model evaluation cases in LangSmith. Each case's question goes through Ask's own loop (runAsk in api/ask.js) in this
// process, against the real model on the eval key, and LangSmith records the model calls, the tool calls and the checker as the steps
// of the case's run. One evaluator scores every case. A case that fails gets an "Under review" note until its real note is written.
// The relevance judge (scripts/ask-relevance.mjs, TypeSafe's Jev) adds `relevance` and `unrelated` to each answered case whose answer
// is an answer (a clarify is counted apart); it never changes `pass`.
//
//   node scripts/ask-langsmith.mjs run --trigger weekly|manual|pr [--pr N] [--sync] [--commit SHA] [--model ID] [--out FILE]
//   node scripts/ask-langsmith.mjs notes
//   node scripts/ask-langsmith.mjs judge-check
//
// `run` evaluates the dataset's cases. --sync first makes the dataset match the live cases in tests/ask-eval.json; only runs on main
// sync, so a PR run evaluates main's cases and refuses --sync. --commit is the commit the run is recorded against (default: HEAD; a PR
// run passes its head, as HEAD there is the merge commit). --model is the OpenRouter model to compare (vendor/model; default: the
// site's MODEL); a model other than MODEL adds its name to the experiment's prefix, as in ask-manual-deepseek-v4.1-flash. Exit 0 when
// the run completed, whatever the scores; 1 on a runner error, a missing dataset included; 2 on bad arguments or a missing key. The
// result JSON goes to --out, and a summary to $GITHUB_STEP_SUMMARY when that is set. The runner reads LANGSMITH_API_KEY,
// OPENROUTER_API_KEY and TYPESAFE_API_KEY and prints none of them; without TYPESAFE_API_KEY it skips the relevance judge and says so.
// It must run from the repository root, where Ask's tools read the site's data.
//
// `notes` posts each note in tests/ask-eval-notes.json, an array of {experiment, case, note}, as the comment of the `note` feedback on
// that case's run in that experiment, replacing "Under review". Exit 1 when an entry's experiment, case or note feedback isn't found.
//
// `judge-check` runs the relevance judge on the hand-labelled answers in tests/ask-relevance-labels.json and prints, per label, the
// judge's relevance and unrelated and whether it agrees with the label (THRESHOLDS in scripts/ask-relevance.mjs), then how many agree
// and the judge's input tokens. It is informational: exit 0 whatever the agreement, 1 when the judge was unavailable for a label, 2
// without TYPESAFE_API_KEY (the only key it reads, and never prints).
//
// The SDK calls used, as langsmith 0.11.0 defines them (node_modules/langsmith/lib/*.d.ts):
// - evaluate(target, {data, evaluators, experimentPrefix, metadata, maxConcurrency, numRepetitions, client}) from
//   "langsmith/evaluation" (lib/evaluation/_runner.d.ts). It traces each target call as its case's root run, with tracing on whatever
//   the environment says, and resolves to {experimentName, results: [{run, example, evaluationResults: {results: [{key, score, value,
//   comment}]}}]}, where run.id is that root run. An evaluator is ({inputs, outputs, referenceOutputs}) => ({results: [...]}): inputs
//   and referenceOutputs are the example's, outputs the target's, and each result becomes a feedback on the run.
// - The experiment's URL is the one evaluate prints ("View results at"): client.getDatasetUrl({datasetName}) + "/compare?selectedSessions="
//   + the experiment's id, which is client.readProject({projectName: experimentName}).id.
// - traceable(fn, {name, run_type, metadata, processInputs, processOutputs}) from "langsmith/traceable" (lib/traceable.d.ts). Called
//   inside the target, it records a child run, which takes the parent's client and tracing switch. It returns a promise even for a
//   synchronous fn. processInputs is handed {args: [...]} for a call with more than one argument ({} when the first is undefined) and
//   runs when the call starts, but the payload is sent later in a batch, so it copies what the caller goes on to change. An llm run's
//   outputs.usage_metadata ({input_tokens, output_tokens, total_tokens, total_cost}) gives it its tokens and cost.
// - client.createFeedback({runId, sessionId, key, comment}) (lib/client.d.ts, CreateFeedbackParams), where sessionId is the experiment's id.
// - Datasets (lib/client.d.ts, lib/schemas.d.ts): hasDataset({datasetName}), readDataset({datasetName}) and createDataset(name,
//   {description}), each dataset {id}; listExamples({datasetId}), an async iterable of {id, inputs, outputs, metadata}, where the server
//   adds its own keys (dataset_split) to metadata; createExamples([{dataset_id, inputs, outputs, metadata}]), updateExamples([{id,
//   dataset_id, inputs, outputs, metadata}]) and deleteExamples(ids), which soft-deletes, so past experiments keep their examples.
// - Notes: hasProject({projectName}) and readProject({projectName}) give an experiment's {id, reference_dataset_id};
//   listRuns({projectId, isRoot}) its root runs, each with its reference_example_id; listFeedback({runIds, feedbackKeys}) a run's
//   feedback by key (with no runIds it lists every feedback there is); updateFeedback(id, {comment}).
//   ponytail: listRuns is deprecated in 0.11.0 and prints one DeprecationWarning; the SDK drops it after Jan 31, 2027. Its successor,
//   client.runs.query, needs min_start_time set to the experiment's start, as it defaults to a day ago.
import { createHash } from "node:crypto";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { isDeepStrictEqual, parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { MODEL, runAsk } from "../api/ask.js";
import { TOOLS } from "../api/_ask_tools.js";
import { SYSTEM_PROMPT } from "../api/_ask_prompt.js";
import { judge } from "./ask-judge.mjs";
import { groundingProblems } from "./ask-oracle.mjs";
import { checkReport, JUDGE_MODEL, judgeCheck, judgeRelevance } from "./ask-relevance.mjs";

const DATASET = "undercurrent-ask";
const TRIGGERS = ["weekly", "manual", "pr"];
const DESCRIPTION = "The questions Undercurrent's Ask is evaluated on with the real model, synced from tests/ask-eval.json on main.";
const CASES = new URL("../tests/ask-eval.json", import.meta.url);
const NOTES = new URL("../tests/ask-eval-notes.json", import.meta.url);
const LABELS = new URL("../tests/ask-relevance-labels.json", import.meta.url);
const USAGE = [
  "Usage: node scripts/ask-langsmith.mjs run --trigger weekly|manual|pr [--pr N] [--sync] [--commit SHA] [--model ID] [--out FILE]",
  "       node scripts/ask-langsmith.mjs notes",
  "       node scripts/ask-langsmith.mjs judge-check",
].join("\n");
const PROMPT_HASH = createHash("sha256").update(SYSTEM_PROMPT + JSON.stringify(TOOLS)).digest("hex").slice(0, 12);
const UNAVAILABLE = { ok: false, reason: "unavailable" };
const MODEL_ID = /^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._:-]*$/; // vendor/model, as OpenRouter names them (the workflow checks the same)
const usageError = (message) => Object.assign(new Error(message), { exit: 2 });
const JUDGED = ["answer"]; // (a fallback, a refusal and a clarify's question are fixed copy: there is nothing to judge)
const round3 = (x) => Math.round(x * 1000) / 1000;

/** The labels a reader sees with an answer: its sentences' sources, then its links. */
const labelsOf = (a) => [...new Set([...a.sentences.flatMap((s) => (s.sources ?? []).map((x) => x.label)), ...(a.next ?? []).map((n) => n.label)])];

/** OpenRouter's usage as LangSmith reads it on an llm run. */
const usageMetadata = (u) => ({
  input_tokens: u.prompt_tokens ?? 0,
  output_tokens: u.completion_tokens ?? 0,
  total_tokens: (u.prompt_tokens ?? 0) + (u.completion_tokens ?? 0),
  total_cost: u.cost,
});

/**
 * The target: one case's question through Ask's own loop, with each step traced. It returns the reply, the evidence the tools handed
 * back, the outcome, and what the case spent. cost_usd is null once a model reply comes without a cost.
 */
const target = ({ runAsk, traceable, now }, model) => async ({ question }) => {
  let ev = [];
  let failed = new Map();
  let tool_calls = 0;
  let tokens_in = 0;
  let tokens_out = 0;
  let cost_usd = 0;
  const steps = {
    // traced with its messages and tool choice only: never the request's headers or the key
    callModel: (fn) => traceable(async (...args) => {
      const out = await fn(...args);
      if (out.message) {
        tokens_in += out.usage?.prompt_tokens ?? 0;
        tokens_out += out.usage?.completion_tokens ?? 0;
        cost_usd = cost_usd !== null && typeof out.usage?.cost === "number" ? cost_usd + out.usage.cost : null;
      }
      return out;
    }, {
      name: "callModel",
      run_type: "llm",
      metadata: { ls_provider: "openrouter", ls_model_name: model },
      processInputs: ({ args: [messages, toolChoice] }) => ({ messages: structuredClone(messages), toolChoice }), // (Ask goes on adding turns to it)
      processOutputs: ({ message, usage, stop }) => (stop ? { stop } : { message, ...(usage && { usage_metadata: usageMetadata(usage) }) }),
    }),
    runTool: (fn) => traceable((name, args, evidence, ctx) => {
      tool_calls++;
      ev = evidence;
      failed = ctx.failed;
      return fn(name, args, evidence, ctx);
    }, { name: "runTool", run_type: "tool", processInputs: ({ args: [name, args] }) => ({ name, args: structuredClone(args) }) }),
    checkAnswer: (fn) => traceable((raw, evidence, ctx) => {
      ev = evidence;
      return fn(raw, evidence, ctx);
    }, { name: "checkAnswer", run_type: "chain", processInputs: ({ args }) => ({ answer: structuredClone(args?.[0]) }) }),
  };
  let threw = false;
  const t0 = performance.now();
  const at = now();
  const result = await runAsk([{ role: "user", content: question }], at, { wrap: (name, fn) => steps[name](fn), model }).catch(() => {
    threw = true;
    return UNAVAILABLE; // (what the endpoint replies when the loop throws)
  });
  const latency_s = Math.round(performance.now() - t0) / 1000;
  const outcome = !result.ok ? (result.reason === "resting" ? "budget" : "unavailable") : failed.size ? "download_failed" : "quality";
  // today: the run's date (UTC), which the answer's ages count to; the grading uses it, so a run graded after midnight still matches
  return { result, ev, outcome, threw, tool_calls, tokens_in, tokens_out, cost_usd, latency_s, today: at.toISOString().slice(0, 10) };
};

/**
 * The one evaluator: the outcome and what the case spent, for every case; pass and the answer's signals only where Ask answered; and,
 * when `relevanceOf` is given (the judge runs), relevance and unrelated where that answer is an answer.
 */
const scorer = (relevanceOf) => async ({ inputs, outputs, referenceOutputs }) => {
  const { result, ev, outcome } = outputs;
  const results = [
    { key: "outcome", value: outcome },
    { key: "tool_calls", score: outputs.tool_calls },
    { key: "latency_s", score: outputs.latency_s },
    { key: "tokens_in", score: outputs.tokens_in },
    { key: "tokens_out", score: outputs.tokens_out },
    { key: "cost_usd", score: outputs.cost_usd },
  ];
  if (outcome !== "quality") return { results }; // so the pass rate leaves the infrastructure out
  const v = judge({ question: inputs.question, expect: referenceOutputs.expect }, result);
  const ungrounded = groundingProblems(inputs.question, ev, result.answer, outputs.today);
  const problems = [...v.problems, ...ungrounded];
  results.push({ key: "pass", score: Number(v.kindOk && v.excludesOk && !ungrounded.length), ...(problems.length && { comment: problems.join("; ") }) });
  results.push({ key: "fallback", score: Number(v.fallback) });
  if (v.includesOk !== null) results.push({ key: "includes_ok", score: Number(v.includesOk) });
  if (relevanceOf && JUDGED.includes(result.answer.kind)) {
    const r = await relevanceOf(inputs.question, result.answer); // (null when the judge is unavailable: the case is left unjudged)
    if (r) results.push({ key: "relevance", score: r.relevance }, { key: "unrelated", score: r.unrelated });
  }
  return { results };
};

/** A case as its dataset example: what the runner reads (inputs.question, outputs.expect, metadata.case_id) and its category. */
const exampleOf = (c) => ({ inputs: { question: c.question }, outputs: { expect: c.expect }, metadata: { case_id: c.id, category: c.category } });

/**
 * Makes the dataset hold one example per live case in `cases` (tests/ask-eval.json), matched by metadata.case_id: it creates the dataset
 * if it is missing, adds new cases, updates edited ones in place, so their history carries on, and deletes the rest. Returns the counts.
 */
export async function syncDataset(cases, { client }) {
  const live = new Map(cases.filter((c) => c.live !== false).map((c) => [c.id, c]));
  const { id: dataset_id } = (await client.hasDataset({ datasetName: DATASET }))
    ? await client.readDataset({ datasetName: DATASET })
    : await client.createDataset(DATASET, { description: DESCRIPTION });
  const seen = new Set();
  const updates = [];
  const removed = [];
  for await (const ex of client.listExamples({ datasetId: dataset_id })) {
    const c = live.get(ex.metadata?.case_id);
    if (!c || seen.has(c.id)) { // (no longer live, or a second copy)
      removed.push(ex.id);
      continue;
    }
    seen.add(c.id);
    const want = exampleOf(c);
    if (isDeepStrictEqual([ex.inputs, ex.outputs, ex.metadata.category], [want.inputs, want.outputs, c.category])) continue;
    updates.push({ id: ex.id, dataset_id, ...want, metadata: { ...ex.metadata, ...want.metadata } }); // (keeping the server's own keys)
  }
  const creates = [...live.values()].filter((c) => !seen.has(c.id)).map((c) => ({ dataset_id, ...exampleOf(c) }));
  if (creates.length) await client.createExamples(creates);
  if (updates.length) await client.updateExamples(updates);
  if (removed.length) await client.deleteExamples(removed);
  return { created: creates.length, updated: updates.length, removed: removed.length };
}

/**
 * One run of the dataset's cases as a LangSmith experiment. `opts` = {trigger, pr, sync, commit, model (default MODEL)}; `deps` =
 * {client, evaluate, traceable, runAsk, now, env, fetch (the relevance judge's)}. Resolves to the result JSON. Throws an error with
 * `exit: 2` for a PR run with sync or a missing key, before anything is called, and one without `exit` when the dataset is missing
 * and the run doesn't sync.
 */
export async function runEvals(opts, deps) {
  if (opts.sync && opts.trigger === "pr") throw usageError("a PR run never syncs the dataset");
  for (const name of ["LANGSMITH_API_KEY", "OPENROUTER_API_KEY"]) if (!deps.env[name]) throw usageError(`${name} is not set`);
  const { client } = deps;
  const apiKey = deps.env.TYPESAFE_API_KEY;
  if (!apiKey) console.log("ask-langsmith: TYPESAFE_API_KEY is not set, so the relevance judge was skipped");
  const judge = { tokens: 0, models: new Set(), unavailable: 0 };
  const relevanceOf = apiKey && (async (question, answer) => {
    const r = await judgeRelevance({ question, sentences: answer.sentences.map((s) => String(s.text)), sources: labelsOf(answer) }, { fetch: deps.fetch, apiKey });
    if (!r) judge.unavailable++;
    else {
      judge.tokens += r.input_tokens;
      judge.models.add(r.judge_model); // (the version that answered, as jev-latest resolves it)
    }
    return r;
  });
  const sync = opts.sync ? await syncDataset(JSON.parse(readFileSync(CASES, "utf8")), deps) : null;
  if (!sync && !(await client.hasDataset({ datasetName: DATASET }))) throw new Error(`dataset ${DATASET} not found: run the workflow manually on main first`);
  const model = opts.model ?? MODEL;
  const prefix = opts.trigger === "pr" ? `ask-pr-${opts.pr}` : `ask-${opts.trigger}`;
  const results = await deps.evaluate(target(deps, model), {
    data: DATASET,
    evaluators: [scorer(relevanceOf)],
    // a comparison names its model: ask-manual-deepseek-v4.1-flash (the part after the slash, cut down to what a name may hold)
    experimentPrefix: model === MODEL ? prefix : `${prefix}-${model.split("/")[1].toLowerCase().replace(/[^a-z0-9.-]/g, "-")}`,
    metadata: { commit: opts.commit, trigger: opts.trigger, pr: opts.pr ?? null, model, prompt_hash: PROMPT_HASH, judge_model: apiKey ? JUDGE_MODEL : null },
    maxConcurrency: 2,
    numRepetitions: 1, // no retries: what the run shows is what a visitor would have met
    client,
  });
  const experiment = results.experimentName;
  const { id } = await client.readProject({ projectName: experiment });
  const url = `${await client.getDatasetUrl({ datasetName: DATASET })}/compare?selectedSessions=${id}`;
  const counts = { quality: 0, pass: 0, fail: 0, unavailable: 0, budget: 0, download_failed: 0 };
  const failures = [];
  const judged = { n: 0, relevance: 0, unrelated: 0, clarified: 0 };
  const note = `Under review · ${deps.now().toISOString().slice(0, 10)} · ${opts.commit.slice(0, 7)}`;
  for (const { run, example, evaluationResults } of results.results) {
    if (run.outputs?.threw) console.error(`ask-langsmith: runAsk threw on case ${example.metadata?.case_id}`); // (not the error: it can quote the request)
    const got = Object.fromEntries(evaluationResults.results.map((r) => [r.key, r]));
    if (!got.outcome) throw new Error(`case ${example.metadata?.case_id} has no scores: its evaluator or its feedback upload failed (see the error above)`);
    counts[got.outcome.value]++;
    if (got.outcome.value === "quality" && run.outputs?.result?.answer?.kind === "clarify") judged.clarified++; // (asked back, not judged)
    if (got.relevance) {
      judged.n++;
      judged.relevance += got.relevance.score;
      judged.unrelated += got.unrelated.score;
    }
    if (!got.pass) continue;
    if (got.pass.score) {
      counts.pass++;
      continue;
    }
    counts.fail++;
    failures.push(example.metadata.case_id);
    await client.createFeedback({ runId: run.id, sessionId: id, key: "note", comment: note });
  }
  const mean = (sum) => (judged.n ? round3(sum / judged.n) : null);
  const relevance = {
    judged: judged.n, mean_relevance: mean(judged.relevance), mean_unrelated: mean(judged.unrelated), judge_tokens: judge.tokens,
    judge_models: [...judge.models], unavailable: judge.unavailable, clarified: judged.clarified,
  };
  return { experiment, url, trigger: opts.trigger, model, commit: opts.commit, counts, failures, allInfra: counts.quality === 0, ...(sync && { sync }), relevance };
}

/**
 * Posts each {experiment, case, note} entry as the comment of the `note` feedback on that case's root run in that experiment. An entry
 * whose experiment, case or note feedback isn't found goes in `missing`. Throws, before any call, when an entry lacks a field.
 */
export async function backfillNotes(entries, { client }) {
  const bad = entries.find((e) => ![e?.experiment, e?.case, e?.note].every((v) => typeof v === "string" && v));
  if (bad !== undefined) throw new Error(`each note needs an experiment, a case and a note: ${JSON.stringify(bad)}`);
  let updated = 0;
  const missing = [];
  for (const entry of entries) {
    const ids = await noteIds(client, entry);
    for (const id of ids) await client.updateFeedback(id, { comment: entry.note });
    if (ids.length) updated++;
    else missing.push(entry);
  }
  return { updated, missing };
}

/** The ids of the `note` feedback on case `entry.case`'s root run in experiment `entry.experiment`; none when any of them isn't found. */
async function noteIds(client, { experiment, case: caseId }) {
  if (!(await client.hasProject({ projectName: experiment }))) return [];
  const project = await client.readProject({ projectName: experiment });
  const examples = new Set();
  for await (const ex of client.listExamples({ datasetId: project.reference_dataset_id })) if (ex.metadata?.case_id === caseId) examples.add(ex.id);
  const runIds = [];
  for await (const run of client.listRuns({ projectId: project.id, isRoot: true })) if (examples.has(run.reference_example_id)) runIds.push(run.id);
  if (!runIds.length) return []; // (with no runIds, listFeedback would list every feedback there is)
  const ids = [];
  for await (const f of client.listFeedback({ runIds, feedbackKeys: ["note"] })) ids.push(f.id);
  return ids;
}

/** What the judge made of the run: the judged cases' means, the cases it could not judge, and the clarifies, which it does not judge. */
function relevanceLine(r) {
  const parts = [
    ...(r.judged ? [`${r.judged} judged, mean relevance ${r.mean_relevance}, mean unrelated ${r.mean_unrelated}, ${r.judge_tokens} judge input tokens (${r.judge_models.join(", ")})`] : []),
    ...(r.unavailable ? [`judge unavailable for ${r.unavailable} ${r.unavailable === 1 ? "case" : "cases"}`] : []),
  ];
  return [...(parts.length ? parts : ["no case judged"]), `asked to clarify: ${r.clarified}`].join("; ");
}

/** The run in a few lines of Markdown, for the job summary. */
export function summary({ experiment, url, trigger, model, commit, counts: c, failures, sync, relevance: r }) {
  return [
    `### Ask evals: ${experiment}`,
    "",
    `Trigger: ${trigger}, model \`${model}\`, commit ${commit.slice(0, 7)}. [Open the experiment in LangSmith](${url})`,
    "",
    `- Answered: ${c.quality} (${c.pass} passed, ${c.fail} failed)`,
    `- Unavailable: ${c.unavailable}. Budget reached: ${c.budget}. Download failed: ${c.download_failed}.`,
    ...(failures.length ? [`- Failed: ${failures.join(", ")}`] : []),
    `- Relevance (Jev): ${relevanceLine(r)}.`,
    ...(sync ? [`- Dataset synced from main: ${sync.created} added, ${sync.updated} updated, ${sync.removed} removed.`] : []),
    "",
  ].join("\n");
}

/** `run`'s options from its arguments: runEvals' opts, plus `out`. Throws an error with `exit: 2` for bad arguments. */
export function runOptions(args) {
  let values;
  try {
    ({ values } = parseArgs({ args, options: { trigger: { type: "string" }, pr: { type: "string" }, sync: { type: "boolean", default: false }, commit: { type: "string" }, model: { type: "string" }, out: { type: "string" } } }));
  } catch (err) {
    throw usageError(`${err.message}\n${USAGE}`);
  }
  if (!TRIGGERS.includes(values.trigger)) throw usageError(`--trigger must be weekly, manual or pr\n${USAGE}`);
  if (values.trigger === "pr" ? !/^[1-9]\d*$/.test(values.pr ?? "") : values.pr !== undefined) throw usageError(`--pr N (the pull request's number) goes with --trigger pr, and only with it\n${USAGE}`);
  if (values.commit !== undefined && !/^[0-9a-f]{40}$/.test(values.commit)) throw usageError(`--commit takes a full commit SHA (40 lowercase hex characters)\n${USAGE}`);
  if (values.model !== undefined && !MODEL_ID.test(values.model)) throw usageError(`--model must look like vendor/model\n${USAGE}`);
  const commit = values.commit ?? execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  return { trigger: values.trigger, pr: values.pr ? Number(values.pr) : null, sync: values.sync, commit, model: values.model ?? MODEL, out: values.out };
}

async function main(argv) {
  const [command, ...rest] = argv;
  if (command === "notes" && !rest.length) return notes();
  if (command === "judge-check" && !rest.length) return checkTheJudge();
  if (command !== "run") throw usageError(USAGE);
  const opts = runOptions(rest);
  const { Client } = await import("langsmith"); // (loaded here, so the tests never load the SDK)
  const { evaluate } = await import("langsmith/evaluation");
  const { traceable } = await import("langsmith/traceable");
  const result = await runEvals(opts, { client: new Client(), evaluate, traceable, runAsk, now: () => new Date(), env: process.env, fetch });
  if (opts.out) writeFileSync(opts.out, `${JSON.stringify(result, null, 2)}\n`);
  const md = summary(result);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
  console.log(md);
}

async function notes() {
  if (!process.env.LANGSMITH_API_KEY) throw usageError("LANGSMITH_API_KEY is not set");
  const entries = JSON.parse(readFileSync(NOTES, "utf8"));
  const { Client } = await import("langsmith");
  const { updated, missing } = await backfillNotes(entries, { client: new Client() });
  console.log(`ask-langsmith: ${updated} of ${entries.length} notes posted`);
  if (missing.length) throw new Error(missing.map((e) => `no note to replace for case ${e.case} in ${e.experiment}`).join("\n"));
}

async function checkTheJudge() {
  const apiKey = process.env.TYPESAFE_API_KEY;
  if (!apiKey) throw usageError("TYPESAFE_API_KEY is not set");
  const result = await judgeCheck(JSON.parse(readFileSync(LABELS, "utf8")), { fetch, apiKey });
  console.log(checkReport(result));
  if (result.unavailable) throw new Error(`the judge was unavailable for ${result.unavailable} ${result.unavailable === 1 ? "label" : "labels"}, so the check is incomplete`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(err.message);
    process.exitCode = err.exit ?? 1;
  });
}
