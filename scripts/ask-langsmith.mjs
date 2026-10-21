#!/usr/bin/env node
// Runs Ask's real-model evaluation cases in LangSmith. Each case's question goes through Ask's own loop (runAsk in api/ask.js) in this
// process, against the real model on the eval key, and LangSmith records the model calls, the tool calls and the checker as the steps
// of the case's run. One evaluator scores every case. A case that fails gets an "Under review" note until its real note is written.
//
//   node scripts/ask-langsmith.mjs run --trigger weekly|manual|pr [--pr N] [--sync] [--out FILE]
//
// Exit 0 when the run completed, whatever the scores; 1 on a runner error; 2 on bad arguments or a missing key. The result JSON goes to
// --out, and a summary to $GITHUB_STEP_SUMMARY when that is set. The runner reads LANGSMITH_API_KEY and OPENROUTER_API_KEY and prints
// neither. It must run from the repository root, where Ask's tools read the site's data.
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
import { createHash } from "node:crypto";
import { appendFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import { MODEL, runAsk } from "../api/ask.js";
import { TOOLS } from "../api/_ask_tools.js";
import { SYSTEM_PROMPT } from "../api/_ask_prompt.js";
import { judge } from "./ask-judge.mjs";
import { groundingProblems } from "./ask-oracle.mjs";

const DATASET = "undercurrent-ask";
const TRIGGERS = ["weekly", "manual", "pr"];
const USAGE = "Usage: node scripts/ask-langsmith.mjs run --trigger weekly|manual|pr [--pr N] [--sync] [--out FILE]";
const PROMPT_HASH = createHash("sha256").update(SYSTEM_PROMPT + JSON.stringify(TOOLS)).digest("hex").slice(0, 12);
const UNAVAILABLE = { ok: false, reason: "unavailable" };
const usageError = (message) => Object.assign(new Error(message), { exit: 2 });

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
const target = ({ runAsk, traceable, now }) => async ({ question }) => {
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
      metadata: { ls_provider: "openrouter", ls_model_name: MODEL },
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
  const t0 = performance.now();
  const result = await runAsk([{ role: "user", content: question }], now(), { wrap: (name, fn) => steps[name](fn) })
    .catch(() => UNAVAILABLE); // (what the endpoint replies when the loop throws)
  const latency_s = Math.round(performance.now() - t0) / 1000;
  const outcome = !result.ok ? (result.reason === "resting" ? "budget" : "unavailable") : failed.size ? "download_failed" : "quality";
  return { result, ev, outcome, tool_calls, tokens_in, tokens_out, cost_usd, latency_s };
};

/** The one evaluator: the outcome and what the case spent, for every case; pass and the answer's signals only where Ask answered. */
function score({ inputs, outputs, referenceOutputs }) {
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
  const ungrounded = groundingProblems(inputs.question, ev, result.answer);
  const problems = [...v.problems, ...ungrounded];
  results.push({ key: "pass", score: Number(v.kindOk && v.excludesOk && !ungrounded.length), ...(problems.length && { comment: problems.join("; ") }) });
  results.push({ key: "fallback", score: Number(v.fallback) });
  if (v.includesOk !== null) results.push({ key: "includes_ok", score: Number(v.includesOk) });
  return { results };
}

/**
 * One run of the dataset's cases as a LangSmith experiment. `opts` = {trigger, pr, sync, commit}; `deps` = {client, evaluate, traceable,
 * runAsk, now, env}. Resolves to the result JSON; throws an error with `exit: 2` for a missing key, before anything is called.
 */
export async function runEvals(opts, deps) {
  for (const name of ["LANGSMITH_API_KEY", "OPENROUTER_API_KEY"]) if (!deps.env[name]) throw usageError(`${name} is not set`);
  const { client } = deps;
  const results = await deps.evaluate(target(deps), {
    data: DATASET,
    evaluators: [score],
    experimentPrefix: opts.trigger === "pr" ? `ask-pr-${opts.pr}` : `ask-${opts.trigger}`,
    metadata: { commit: opts.commit, trigger: opts.trigger, pr: opts.pr ?? null, model: MODEL, prompt_hash: PROMPT_HASH },
    maxConcurrency: 2,
    numRepetitions: 1, // no retries: what the run shows is what a visitor would have met
    client,
  });
  const experiment = results.experimentName;
  const { id } = await client.readProject({ projectName: experiment });
  const url = `${await client.getDatasetUrl({ datasetName: DATASET })}/compare?selectedSessions=${id}`;
  const counts = { quality: 0, pass: 0, fail: 0, unavailable: 0, budget: 0, download_failed: 0 };
  const failures = [];
  const note = `Under review · ${deps.now().toISOString().slice(0, 10)} · ${opts.commit.slice(0, 7)}`;
  for (const { run, example, evaluationResults } of results.results) {
    const got = Object.fromEntries(evaluationResults.results.map((r) => [r.key, r]));
    if (!got.outcome) throw new Error(`case ${example.metadata?.case_id} has no scores: its evaluator failed`);
    counts[got.outcome.value]++;
    if (!got.pass) continue;
    if (got.pass.score) {
      counts.pass++;
      continue;
    }
    counts.fail++;
    failures.push(example.metadata.case_id);
    await client.createFeedback({ runId: run.id, sessionId: id, key: "note", comment: note });
  }
  return { experiment, url, trigger: opts.trigger, commit: opts.commit, counts, failures, allInfra: counts.quality === 0 };
}

/** The run in a few lines of Markdown, for the job summary. */
function summary({ experiment, url, trigger, commit, counts: c, failures }) {
  return [
    `### Ask evals: ${experiment}`,
    "",
    `Trigger: ${trigger}, commit ${commit.slice(0, 7)}. [Open the experiment in LangSmith](${url})`,
    "",
    `- Answered: ${c.quality} (${c.pass} passed, ${c.fail} failed)`,
    `- Unavailable: ${c.unavailable}. Budget reached: ${c.budget}. Download failed: ${c.download_failed}.`,
    ...(failures.length ? [`- Failed: ${failures.join(", ")}`] : []),
    "",
  ].join("\n");
}

async function main(argv) {
  const [command, ...rest] = argv;
  if (command !== "run") throw usageError(USAGE);
  let values;
  try {
    ({ values } = parseArgs({ args: rest, options: { trigger: { type: "string" }, pr: { type: "string" }, sync: { type: "boolean", default: false }, out: { type: "string" } } }));
  } catch (err) {
    throw usageError(`${err.message}\n${USAGE}`);
  }
  if (!TRIGGERS.includes(values.trigger)) throw usageError(`--trigger must be weekly, manual or pr\n${USAGE}`);
  if (values.trigger === "pr" ? !/^[1-9]\d*$/.test(values.pr ?? "") : values.pr !== undefined) throw usageError(`--pr N (the pull request's number) goes with --trigger pr, and only with it\n${USAGE}`);
  const opts = { trigger: values.trigger, pr: values.pr ? Number(values.pr) : null, sync: values.sync, commit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim() };
  const { Client } = await import("langsmith"); // (loaded here, so the tests never load the SDK)
  const { evaluate } = await import("langsmith/evaluation");
  const { traceable } = await import("langsmith/traceable");
  const result = await runEvals(opts, { client: new Client(), evaluate, traceable, runAsk, now: () => new Date(), env: process.env });
  if (values.out) writeFileSync(values.out, `${JSON.stringify(result, null, 2)}\n`);
  const md = summary(result);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, md);
  console.log(md);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(err.message);
    process.exitCode = err.exit ?? 1;
  });
}
