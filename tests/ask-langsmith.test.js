// The LangSmith runner (scripts/ask-langsmith.mjs), with fakes for LangSmith's client, `evaluate` and `traceable` that record what they
// are handed. Nothing here reaches LangSmith, OpenRouter or the network. The fake traceable records a step by the SDK's own rules (see
// the runner's header): processInputs when the call starts, the payload serialized only at the end, and a promise for every call.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { backfillNotes, runEvals, runOptions, summary, syncDataset } from "../scripts/ask-langsmith.mjs";
import { MODEL, runAsk } from "../api/ask.js";
import { checkAnswer } from "../api/_ask_check.js";
import { SYSTEM_PROMPT } from "../api/_ask_prompt.js";
import { TOOLS } from "../api/_ask_tools.js";
import { FALLBACK } from "../scripts/ask-oracle.mjs";

const CASES = JSON.parse(readFileSync(new URL("./ask-eval.json", import.meta.url), "utf8"));
const LIVE = CASES.filter((c) => c.live !== false);
const byId = (id) => LIVE.find((c) => c.id === id);
const SHA = "0123abcdef4567890123abcdef4567890123abcd";
const NOW = new Date("2026-10-21T13:00:00Z");
const ENV = { LANGSMITH_API_KEY: "lsv2_test", OPENROUTER_API_KEY: "sk-or-test" };
const WEEKLY = { trigger: "weekly", pr: null, sync: false, commit: SHA };
const USAGE = { prompt_tokens: 1000, completion_tokens: 50, cost: 0.002 };
const SIGNALS = ["outcome", "tool_calls", "latency_s", "tokens_in", "tokens_out", "cost_usd"]; // every case has these
const UNAVAILABLE = { ok: false, reason: "unavailable" };
const RESTING = { ok: false, reason: "resting", resets: "2026-11-01" };
const UNGROUNDED = { kind: "answer", sentences: [{ text: "It is fine to trade with.", sources: [] }], next: [] };
const FALLBACK_ANSWER = { kind: "fallback", sentences: [{ text: FALLBACK, sources: [] }], next: [] };

// ---- fakes ---------------------------------------------------------------------------------------------------------------

const plain = (x) => typeof x === "object" && x !== null && [Object.prototype, null].includes(Object.getPrototypeOf(x));

/** LangSmith's traceable as the runner sees it: what each call is handed, by the SDK's rules, and a promise back. */
const fakeTraceable = (steps) => (fn, config = {}) => async (...args) => {
  const [first] = args;
  const inputs = first === null ? { inputs: null } : first === undefined ? {} : args.length > 1 ? { args } : plain(first) ? first : { input: first };
  const step = { name: config.name, run_type: config.run_type, metadata: config.metadata, inputs: config.processInputs ? config.processInputs(inputs) : inputs };
  steps.push(step);
  const out = await fn(...args);
  const outputs = plain(out) ? { ...out } : { outputs: out };
  step.outputs = config.processOutputs ? config.processOutputs(outputs) : outputs;
  return out;
};

/** evaluate over `cases` as dataset examples: the target is traced as each case's root run, then the evaluators score it. */
const fakeEvaluate = (cases, calls, rows, traceable) => async (target, options) => {
  calls.push(["evaluate", options]);
  const traced = traceable(target, { name: "target" });
  for (const [i, c] of cases.entries()) {
    const example = { id: `ex-${i}`, inputs: { question: c.question }, outputs: { expect: c.expect }, metadata: { case_id: c.id, category: c.category } };
    const run = { id: `run-${i}`, outputs: await traced(example.inputs) };
    const results = [];
    for (const evaluator of options.evaluators) results.push(...(await evaluator({ run, example, inputs: example.inputs, outputs: run.outputs, referenceOutputs: example.outputs })).results);
    rows.push({ run, example, evaluationResults: { results } });
  }
  return { experimentName: `${options.experimentPrefix}-1a2b3c4d`, results: rows };
};

const fakeClient = (calls) => ({
  hasDataset: async (args) => (calls.push(["hasDataset", args]), true),
  readProject: async (args) => (calls.push(["readProject", args]), { id: "exp-1" }),
  getDatasetUrl: async (args) => (calls.push(["getDatasetUrl", args]), "https://smith.test/o/t/datasets/ds-1"),
  createFeedback: async (args) => (calls.push(["createFeedback", args]), {}),
});

/** LangSmith's datasets and examples, in memory. Like the server, it adds metadata.dataset_split to an example it creates. */
const fakeDatasets = (calls) => {
  const datasets = new Map(); // name -> {id, examples: Map(id -> example)}
  let n = 0;
  const examples = (datasetId) => [...datasets.values()].find((d) => d.id === datasetId).examples;
  const store = ({ id, dataset_id, inputs, outputs, metadata }) => examples(dataset_id).set(id, structuredClone({ id, inputs, outputs, metadata }));
  return {
    datasets,
    hasDataset: async (args) => (calls.push(["hasDataset", args]), datasets.has(args.datasetName)),
    readDataset: async (args) => (calls.push(["readDataset", args]), { id: datasets.get(args.datasetName).id }),
    createDataset: async (name, options) => {
      calls.push(["createDataset", name, options]);
      datasets.set(name, { id: `ds-${++n}`, examples: new Map() });
      return { id: datasets.get(name).id };
    },
    listExamples: async function* (args) {
      calls.push(["listExamples", args]);
      yield* structuredClone([...examples(args.datasetId).values()]);
    },
    createExamples: async (uploads) => {
      calls.push(["createExamples", uploads]);
      for (const u of uploads) store({ ...u, id: `ex-${++n}`, metadata: { ...u.metadata, dataset_split: ["base"] } });
    },
    updateExamples: async (updates) => {
      calls.push(["updateExamples", updates]);
      for (const u of updates) store(u);
    },
    deleteExamples: async (ids) => {
      calls.push(["deleteExamples", ids]);
      for (const d of datasets.values()) for (const id of ids) d.examples.delete(id);
    },
  };
};

const UNDER_REVIEW = "Under review · 2026-10-21 · 0123abc";

/**
 * Two weekly experiments over the same three examples, as LangSmith holds them. In each, area-research-1 failed: its root run has an
 * "Under review" note beside its pass score.
 */
const fakeExperiments = (calls) => {
  const projects = { "ask-weekly-1a2b3c4d": "exp-1", "ask-weekly-5e6f7a8b": "exp-2" };
  const examples = ["area-research-1", "area-lists-1", "off-topic-1"].map((case_id, i) => ({ id: `ex-${i}`, metadata: { case_id, category: "x", dataset_split: ["base"] } }));
  const runs = Object.values(projects).flatMap((session_id) => examples.map((ex) => ({ id: `${session_id}-${ex.id}`, session_id, reference_example_id: ex.id })));
  const feedback = runs.flatMap((r) => [
    { id: `pass-${r.id}`, run_id: r.id, key: "pass", comment: null },
    ...(r.reference_example_id === "ex-0" ? [{ id: `note-${r.id}`, run_id: r.id, key: "note", comment: UNDER_REVIEW }] : []),
  ]);
  return {
    feedback,
    hasProject: async (args) => (calls.push(["hasProject", args]), args.projectName in projects),
    readProject: async (args) => (calls.push(["readProject", args]), { id: projects[args.projectName], reference_dataset_id: "ds-1" }),
    listExamples: async function* (args) {
      calls.push(["listExamples", args]);
      if (args.datasetId === "ds-1") yield* structuredClone(examples);
    },
    listRuns: async function* (args) {
      calls.push(["listRuns", args]);
      yield* structuredClone(runs.filter((r) => r.session_id === args.projectId));
    },
    listFeedback: async function* (args) {
      calls.push(["listFeedback", args]);
      assert.ok(args.runIds?.length, "listFeedback without runIds lists every feedback there is");
      yield* structuredClone(feedback.filter((f) => args.runIds.includes(f.run_id) && args.feedbackKeys.includes(f.key)));
    },
    updateFeedback: async (id, update) => {
      calls.push(["updateFeedback", id, update]);
      Object.assign(feedback.find((f) => f.id === id), update);
    },
  };
};

/**
 * Ask's loop in miniature, through `wrap` as runAsk calls it: a model call, a tool call that hands over the case's recorded evidence,
 * a second model call, then the checker on the case's recorded answer. `script[case id]` changes that: `stop` ends it at the first
 * model call, `answer` replaces the checker's answer, `download` records a failed download, `usage` is what each model call reports,
 * and `throws` makes runAsk throw.
 */
const fakeAsk = (script) => async (history, now, { wrap }) => {
  const c = LIVE.find((x) => x.question === history.at(-1).content);
  const plan = script[c.id];
  if (plan.throws) throw new Error(`the request failed: ${JSON.stringify({ messages: history, key: ENV.OPENROUTER_API_KEY })}`);
  const model = wrap("callModel", async () => (plan.stop ? { stop: plan.stop } : { message: { role: "assistant", content: null }, usage: plan.usage === undefined ? USAGE : plan.usage }));
  const tool = wrap("runTool", async (name, args, ev, ctx) => {
    ev.push(...structuredClone(c.evidence));
    if (plan.download) ctx.failed.set("opensanctions", new Error("the download failed"));
    return { items: ev.map((e) => e.id) };
  });
  const check = wrap("checkAnswer", (raw, ev, ctx) => plan.answer ?? checkAnswer(raw, ev, ctx));
  const ev = [];
  const ctx = { today: "2026-10-21", failed: new Map() };
  const first = await model([{ role: "user", content: c.question }], "auto", Date.now() + 26_000, now);
  if (first.stop) return first.stop;
  await tool("check_lists", { query: "x" }, ev, ctx);
  await model([{ role: "user", content: c.question }], "auto", Date.now() + 26_000, now);
  return { ok: true, answer: await check(structuredClone(c.model), ev, { question: c.question }) };
};

function setup(cases, ask, env = ENV) {
  const calls = [];
  const steps = [];
  const rows = [];
  const traceable = fakeTraceable(steps);
  return { calls, steps, rows, deps: { client: fakeClient(calls), evaluate: fakeEvaluate(cases, calls, rows, traceable), traceable, runAsk: ask, now: () => NOW, env } };
}

/** case id -> feedback key -> what the evaluator returned for it */
const scoresOf = (rows) => Object.fromEntries(rows.map((r) => [r.example.metadata.case_id, Object.fromEntries(r.evaluationResults.results.map((x) => [x.key, x]))]));

// ---- tests ---------------------------------------------------------------------------------------------------------------

test("run refuses a missing LANGSMITH_API_KEY or OPENROUTER_API_KEY with exit 2 before any client call", async () => {
  for (const name of ["LANGSMITH_API_KEY", "OPENROUTER_API_KEY"]) {
    for (const value of [undefined, ""]) { // (a secret that was never set reaches a job as "")
      const { calls, steps, deps } = setup([byId("off-topic-1")], fakeAsk({ "off-topic-1": {} }), { ...ENV, [name]: value });
      await assert.rejects(runEvals(WEEKLY, deps), { exit: 2, message: `${name} is not set` });
      assert.deepEqual([calls, steps], [[], []]);
    }
  }
});

test("each case is scored: pass only for quality outcomes; unavailable, resting and a failed download become outcomes without pass", async () => {
  const script = {
    "area-lists-1": {},
    "area-research-1": { answer: UNGROUNDED },
    "off-topic-2": { stop: UNAVAILABLE },
    "off-topic-3": { stop: RESTING },
    "fear-false-listing-1": { download: true, answer: FALLBACK_ANSWER },
  };
  const { rows, deps } = setup(Object.keys(script).map(byId), fakeAsk(script));
  const result = await runEvals(WEEKLY, deps);
  const scores = scoresOf(rows);
  assert.deepEqual(Object.fromEntries(Object.entries(scores).map(([id, s]) => [id, [s.outcome.value, s.pass?.score]])), {
    "area-lists-1": ["quality", 1],
    "area-research-1": ["quality", 0],
    "off-topic-2": ["unavailable", undefined],
    "off-topic-3": ["budget", undefined],
    "fear-false-listing-1": ["download_failed", undefined],
  });
  assert.match(scores["area-research-1"].pass.comment, /not fixed copy, a server claim or a quote/);
  assert.equal(scores["area-lists-1"].pass.comment, undefined);
  // the answer's own signals go with pass (includes_ok where the case has includes); the costs go with every case
  for (const [id, s] of Object.entries(scores)) {
    const answered = s.outcome.value === "quality" ? ["pass", "fallback", ...(byId(id).expect.includes ? ["includes_ok"] : [])] : [];
    assert.deepEqual(Object.keys(s).sort(), [...SIGNALS, ...answered].sort(), id);
  }
  assert.deepEqual([scores["area-lists-1"].includes_ok.score, scores["area-research-1"].includes_ok.score, scores["area-lists-1"].fallback.score], [1, 0, 0]);
  const signals = (id) => ["tool_calls", "tokens_in", "tokens_out", "cost_usd"].map((k) => scores[id][k].score);
  assert.deepEqual(signals("area-lists-1"), [1, 2000, 100, 0.004]);
  assert.deepEqual(signals("off-topic-2"), [0, 0, 0, 0]);
  assert.ok(scores["area-lists-1"].latency_s.score >= 0);
  assert.deepEqual(result.counts, { quality: 2, pass: 1, fail: 1, unavailable: 1, budget: 1, download_failed: 1 });
  assert.deepEqual([result.failures, result.allInfra], [["area-research-1"], false]);
});

test("a run where every case hits the key limit has allInfra true and no failures", async () => {
  const cases = LIVE.slice(0, 4);
  const { calls, deps } = setup(cases, fakeAsk(Object.fromEntries(cases.map((c) => [c.id, { stop: RESTING }]))));
  const result = await runEvals(WEEKLY, deps);
  assert.deepEqual(result.counts, { quality: 0, pass: 0, fail: 0, unavailable: 0, budget: 4, download_failed: 0 });
  assert.deepEqual([result.failures, result.allInfra], [[], true]);
  assert.ok(!calls.some(([name]) => name === "createFeedback"));
});

test("failing cases get one \"Under review · <date> · <short sha>\" note each", async () => {
  const script = { "area-lists-1": {}, "area-research-1": { answer: UNGROUNDED }, "area-opensanctions-1": { answer: UNGROUNDED }, "off-topic-2": { stop: UNAVAILABLE } };
  const { calls, rows, deps } = setup(Object.keys(script).map(byId), fakeAsk(script));
  const result = await runEvals(WEEKLY, deps);
  assert.deepEqual(result.failures, ["area-research-1", "area-opensanctions-1"]);
  const failed = rows.filter((r) => ["area-research-1", "area-opensanctions-1"].includes(r.example.metadata.case_id)).map((r) => r.run.id);
  assert.deepEqual(calls.filter(([name]) => name === "createFeedback").map(([, args]) => args), failed.map((runId) => ({ runId, sessionId: "exp-1", key: "note", comment: "Under review · 2026-10-21 · 0123abc" })));
});

test("metadata carries commit, trigger, pr, model and a 12-hex prompt_hash", async () => {
  const promptHash = createHash("sha256").update(SYSTEM_PROMPT + JSON.stringify(TOOLS)).digest("hex").slice(0, 12);
  const { calls, deps } = setup([byId("off-topic-1")], fakeAsk({ "off-topic-1": {} }));
  const result = await runEvals({ trigger: "pr", pr: 31, sync: false, commit: SHA }, deps);
  const [[, options]] = calls.filter(([name]) => name === "evaluate");
  assert.deepEqual(options.metadata, { commit: SHA, trigger: "pr", pr: 31, model: MODEL, prompt_hash: promptHash });
  assert.match(options.metadata.prompt_hash, /^[0-9a-f]{12}$/);
  assert.equal(MODEL, "anthropic/claude-haiku-5.5");
  assert.deepEqual([options.data, options.experimentPrefix, options.maxConcurrency, options.numRepetitions, options.evaluators.length, options.client], ["undercurrent-ask", "ask-pr-31", 2, 1, 1, deps.client]);
  assert.deepEqual(calls.filter(([name]) => name !== "evaluate"), [["hasDataset", { datasetName: "undercurrent-ask" }], ["readProject", { projectName: "ask-pr-31-1a2b3c4d" }], ["getDatasetUrl", { datasetName: "undercurrent-ask" }]]);
  assert.deepEqual(result, {
    experiment: "ask-pr-31-1a2b3c4d",
    url: "https://smith.test/o/t/datasets/ds-1/compare?selectedSessions=exp-1",
    trigger: "pr",
    model: MODEL,
    commit: SHA,
    counts: { quality: 1, pass: 1, fail: 0, unavailable: 0, budget: 0, download_failed: 0 },
    failures: [],
    allInfra: false,
  });
  const weekly = setup([byId("off-topic-1")], fakeAsk({ "off-topic-1": {} }));
  await runEvals(WEEKLY, weekly.deps);
  const [[, w]] = weekly.calls.filter(([name]) => name === "evaluate");
  assert.deepEqual([w.experimentPrefix, w.metadata.trigger, w.metadata.pr], ["ask-weekly", "weekly", null]);
});

/** fakeAsk, also recording the model each case's runAsk was given. */
const recordingAsk = (script, models) => (history, now, options) => (models.push(options.model), fakeAsk(script)(history, now, options));

test("run --model: runAsk, the model calls' traces, the metadata, the result and the summary all name it, and the prefix gets its slug", async () => {
  const opts = runOptions(["--trigger", "manual", "--model", "deepseek/deepseek-v4.1-flash", "--commit", SHA]);
  assert.deepEqual(opts, { trigger: "manual", pr: null, sync: false, commit: SHA, model: "deepseek/deepseek-v4.1-flash", out: undefined });
  const models = [];
  const script = { "area-lists-1": {}, "off-topic-1": {} };
  const { calls, steps, deps } = setup(Object.keys(script).map(byId), recordingAsk(script, models));
  const result = await runEvals(opts, deps);
  assert.deepEqual(models, ["deepseek/deepseek-v4.1-flash", "deepseek/deepseek-v4.1-flash"]);
  assert.deepEqual([...new Set(steps.filter((s) => s.name === "callModel").map((s) => s.metadata.ls_model_name))], ["deepseek/deepseek-v4.1-flash"]);
  const [[, options]] = calls.filter(([name]) => name === "evaluate");
  assert.equal(options.metadata.model, "deepseek/deepseek-v4.1-flash");
  assert.equal(options.experimentPrefix, "ask-manual-deepseek-v4.1-flash");
  assert.deepEqual([result.experiment, result.model], ["ask-manual-deepseek-v4.1-flash-1a2b3c4d", "deepseek/deepseek-v4.1-flash"]);
  assert.match(summary(result), /^Trigger: manual, model `deepseek\/deepseek-v4\.1-flash`, commit 0123abc\. /m);
  // the slug is the part after the slash, lowercased, with anything outside [a-z0-9.-] made a dash; a PR run keeps its number
  const prefix = async (args) => {
    const s = setup([byId("off-topic-1")], fakeAsk({ "off-topic-1": {} }));
    await runEvals(runOptions([...args, "--commit", SHA]), s.deps);
    return s.calls.find(([name]) => name === "evaluate")[1].experimentPrefix;
  };
  assert.equal(await prefix(["--trigger", "manual", "--model", "anthropic/claude-sonnet-5.5"]), "ask-manual-claude-sonnet-5.5");
  assert.equal(await prefix(["--trigger", "manual", "--model", "qwen/qwen3.8-27b"]), "ask-manual-qwen3.8-27b");
  assert.equal(await prefix(["--trigger", "manual", "--model", "qwen/qwen3.8_27b:free"]), "ask-manual-qwen3.8-27b-free");
  assert.equal(await prefix(["--trigger", "pr", "--pr", "31", "--model", "qwen/qwen3.8-27b"]), "ask-pr-31-qwen3.8-27b");
  assert.equal(await prefix(["--trigger", "weekly", "--model", MODEL]), "ask-weekly"); // the site's own model is no comparison
});

test("run without --model keeps today's behaviour: MODEL everywhere and the prefix unchanged", async () => {
  const opts = runOptions(["--trigger", "manual", "--commit", SHA]);
  assert.equal(opts.model, MODEL);
  for (const o of [opts, WEEKLY]) { // (from the command line, and from a caller that leaves model out)
    const models = [];
    const { calls, steps, deps } = setup([byId("off-topic-1")], recordingAsk({ "off-topic-1": {} }, models));
    const result = await runEvals(o, deps);
    const [[, options]] = calls.filter(([name]) => name === "evaluate");
    assert.deepEqual([models, options.metadata.model, result.model, options.experimentPrefix], [[MODEL], MODEL, MODEL, `ask-${o.trigger}`]);
    assert.ok(steps.filter((s) => s.name === "callModel").every((s) => s.metadata.ls_model_name === MODEL));
  }
});

test("a --model that is not vendor/model exits 2 before any call", async () => {
  for (const bad of ["x; rm -rf /", "$(id)", "`id`", "deepseek", "Anthropic/Claude-Haiku-5.5", "/x", "a/", "a/b/c", "-a/b", "a/-b", "a/b\nc", "a/b ", "", "a/b;c"]) {
    assert.throws(() => runOptions(["--trigger", "manual", `--model=${bad}`, "--commit", SHA]), (err) => err.exit === 2 && err.message.startsWith("--model must look like vendor/model\n"), JSON.stringify(bad));
  }
  // the script itself: refused before it reads a key (none is set here) or loads the SDK
  const script = new URL("../scripts/ask-langsmith.mjs", import.meta.url).pathname;
  const r = spawnSync(process.execPath, [script, "run", "--trigger", "manual", "--model", "$(id)"], { encoding: "utf8", env: { PATH: process.env.PATH } });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /^--model must look like vendor\/model\n/);
});

test("no traced payload contains the OpenRouter key", async (t) => {
  // Ask's real loop, with fetch as a fake OpenRouter: one call to the site_docs tool (it reads data/ask-docs.json), then a refusal
  const SECRET = "sk-or-v1-SENTINEL-0000-must-never-be-traced";
  const saved = { key: process.env.OPENROUTER_API_KEY, fetch: globalThis.fetch };
  t.after(() => {
    globalThis.fetch = saved.fetch;
    if (saved.key === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = saved.key;
  });
  process.env.OPENROUTER_API_KEY = SECRET;
  const call = (name, args) => ({ choices: [{ message: { role: "assistant", content: null, tool_calls: [{ id: `call_${name}`, type: "function", function: { name, arguments: JSON.stringify(args) } }] } }], usage: USAGE });
  const replies = [call("site_docs", { query: "how matching works" }), call("answer", { kind: "refusal", sentences: [] })];
  const sent = [];
  globalThis.fetch = async (url, init) => {
    sent.push([String(url), init?.headers?.Authorization]);
    return new Response(JSON.stringify(replies.shift()), { headers: { "content-type": "application/json" } });
  };
  const { calls, steps, rows, deps } = setup([byId("off-topic-1")], runAsk, { ...ENV, OPENROUTER_API_KEY: SECRET });
  const result = await runEvals(WEEKLY, deps);
  const model = ["https://openrouter.ai/api/v1/chat/completions", `Bearer ${SECRET}`];
  assert.deepEqual(sent, [model, model]); // the key was in play, and nothing else was fetched
  const recorded = JSON.stringify({ steps, calls, rows, result });
  assert.ok(!recorded.includes(SECRET), "the key is in a traced payload");
  assert.ok(!recorded.includes("Bearer"), "a header is in a traced payload");
  // the steps, each with its run type; a model call is traced with its messages and tool choice only, as they stood when it was made
  assert.deepEqual(steps.map((s) => [s.name, s.run_type]), [["target", undefined], ["callModel", "llm"], ["runTool", "tool"], ["callModel", "llm"], ["checkAnswer", "chain"]]);
  const models = steps.filter((s) => s.name === "callModel");
  assert.deepEqual(models.map((s) => Object.keys(s.inputs)), [["messages", "toolChoice"], ["messages", "toolChoice"]]);
  assert.deepEqual(models.map((s) => s.inputs.messages.map((m) => m.role)), [["system", "user"], ["system", "user", "assistant", "tool"]]);
  assert.deepEqual(models[0].outputs.usage_metadata, { input_tokens: 1000, output_tokens: 50, total_tokens: 1050, total_cost: 0.002 });
  assert.deepEqual(steps.find((s) => s.name === "runTool").inputs, { name: "site_docs", args: { query: "how matching works" } });
  // a traced step returns a promise, and runAsk waits for the checker's: its answer is what was scored
  assert.equal(rows[0].run.outputs.result.answer.kind, "refusal");
  assert.equal(scoresOf(rows)["off-topic-1"].pass.score, 1);
});

test("cost_usd is null when usage has no cost", async () => {
  const script = { "area-lists-1": { usage: { prompt_tokens: 7, completion_tokens: 3 } }, "area-research-1": { usage: null }, "area-chips-1": {} };
  const { rows, deps } = setup(Object.keys(script).map(byId), fakeAsk(script));
  await runEvals(WEEKLY, deps);
  const spent = Object.fromEntries(rows.map(({ run: { outputs: o }, example }) => [example.metadata.case_id, [o.tokens_in, o.tokens_out, o.cost_usd]]));
  assert.deepEqual(spent, { "area-lists-1": [14, 6, null], "area-research-1": [0, 0, null], "area-chips-1": [2000, 100, 0.004] });
  assert.deepEqual(Object.values(scoresOf(rows)).map((s) => s.cost_usd.score), [null, null, 0.004]);
});

test("a runAsk that throws makes its case unavailable and logs one fixed line, without the error", async (t) => {
  const errors = t.mock.method(console, "error", () => {});
  const script = { "area-lists-1": {}, "off-topic-2": { throws: true } };
  const { rows, deps } = setup(Object.keys(script).map(byId), fakeAsk(script));
  const result = await runEvals(WEEKLY, deps);
  assert.deepEqual(errors.mock.calls.map((c) => c.arguments), [["ask-langsmith: runAsk threw on case off-topic-2"]]);
  const scores = scoresOf(rows)["off-topic-2"];
  assert.deepEqual([scores.outcome.value, scores.pass], ["unavailable", undefined]);
  assert.deepEqual(result.counts, { quality: 1, pass: 1, fail: 0, unavailable: 1, budget: 0, download_failed: 0 });
});

test("run --commit SHA sets the commit metadata and the note's short sha; without it the commit is HEAD", async () => {
  const HEAD_SHA = "fedcba9876543210fedcba9876543210fedcba98"; // a PR's head, where HEAD is the merge commit
  const opts = runOptions(["--trigger", "pr", "--pr", "31", "--commit", HEAD_SHA]);
  assert.deepEqual(opts, { trigger: "pr", pr: 31, sync: false, commit: HEAD_SHA, model: MODEL, out: undefined });
  const script = { "area-research-1": { answer: UNGROUNDED } };
  const { calls, deps } = setup(Object.keys(script).map(byId), fakeAsk(script));
  await runEvals(opts, deps);
  const [[, options]] = calls.filter(([name]) => name === "evaluate");
  assert.equal(options.metadata.commit, HEAD_SHA);
  assert.deepEqual(calls.filter(([name]) => name === "createFeedback").map(([, args]) => args.comment), ["Under review · 2026-10-21 · fedcba9"]);
  assert.equal(runOptions(["--trigger", "weekly"]).commit, execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim());
  for (const bad of ["fedcba9", "", HEAD_SHA.toUpperCase()]) assert.throws(() => runOptions(["--trigger", "weekly", "--commit", bad]), { exit: 2 });
});

test("sync creates the dataset once and upserts by case_id; an edited case updates, a removed case is deleted", async () => {
  const calls = [];
  const client = fakeDatasets(calls);
  const stored = () => [...client.datasets.get("undercurrent-ask").examples.values()];
  const exampleOf = (c) => ({ inputs: { question: c.question }, outputs: { expect: c.expect }, metadata: { case_id: c.id, category: c.category, dataset_split: ["base"] } });
  // the first sync creates the dataset and one example per live case, in the shape the runner reads
  assert.deepEqual(await syncDataset(CASES, { client }), { created: 20, updated: 0, removed: 0 });
  assert.deepEqual(stored().map(({ id, ...ex }) => ex), LIVE.map(exampleOf));
  // nothing changed, nothing to do (the server's dataset_split is not a change)
  const second = calls.length;
  assert.deepEqual(await syncDataset(CASES, { client }), { created: 0, updated: 0, removed: 0 });
  assert.deepEqual(calls.slice(second).map(([name]) => name), ["hasDataset", "readDataset", "listExamples"]);
  // an edited case, a case set to live: false, a new case, and a stray copy of an example
  const kept = stored().find((ex) => ex.metadata.case_id === "area-lists-1").id;
  client.datasets.get("undercurrent-ask").examples.set("ex-copy", { ...structuredClone(stored()[1]), id: "ex-copy" });
  const edited = CASES.map((c) => (c.id === "area-lists-1" ? { ...c, expect: { ...c.expect, fallback: false } } : c.id === "off-topic-6" ? { ...c, live: false } : c));
  const added = { ...byId("off-topic-1"), id: "off-topic-7", question: "What is the weather like in Lisbon?" };
  const third = calls.length;
  assert.deepEqual(await syncDataset([...edited, added], { client }), { created: 1, updated: 1, removed: 2 });
  const live = [...edited, added].filter((c) => c.live !== false);
  assert.deepEqual(stored().map(({ id, ...ex }) => ex).sort((a, b) => a.metadata.case_id.localeCompare(b.metadata.case_id)), live.map(exampleOf).sort((a, b) => a.metadata.case_id.localeCompare(b.metadata.case_id)));
  assert.equal(stored().find((ex) => ex.metadata.case_id === "area-lists-1").id, kept); // the same example, so its history carries on
  const writes = calls.slice(third).filter(([name]) => /^(create|update|delete)/.test(name));
  assert.deepEqual(writes.map(([name, arg]) => [name, arg.length]), [["createExamples", 1], ["updateExamples", 1], ["deleteExamples", 2]]);
  assert.equal(writes[1][1][0].id, kept);
  assert.deepEqual(calls.filter(([name]) => name === "createDataset").map(([, name]) => name), ["undercurrent-ask"]);
});

test("run without --sync on a missing dataset exits 1 with the message", async () => {
  const { calls, deps } = setup([byId("off-topic-1")], fakeAsk({ "off-topic-1": {} }));
  Object.assign(deps.client, fakeDatasets(calls)); // (no dataset yet)
  await assert.rejects(runEvals(WEEKLY, deps), (err) => err.message === "dataset undercurrent-ask not found: run the workflow manually on main first" && err.exit === undefined);
  assert.deepEqual(calls, [["hasDataset", { datasetName: "undercurrent-ask" }]]);
  // with --sync, a run on main creates it from tests/ask-eval.json before it evaluates
  const result = await runEvals({ ...WEEKLY, sync: true }, deps);
  assert.deepEqual(result.sync, { created: 20, updated: 0, removed: 0 });
  assert.deepEqual(calls.slice(1).map(([name]) => name), ["hasDataset", "createDataset", "listExamples", "createExamples", "evaluate", "readProject", "getDatasetUrl"]);
});

test("a PR run with --sync exits 2 before any call", async () => {
  const { calls, steps, deps } = setup([byId("off-topic-1")], fakeAsk({ "off-topic-1": {} }));
  await assert.rejects(runEvals({ trigger: "pr", pr: 31, sync: true, commit: SHA }, deps), { exit: 2, message: "a PR run never syncs the dataset" });
  assert.deepEqual([calls, steps], [[], []]);
});

test("notes replaces the Under-review comment on the matching run only, and reports an unknown experiment", async () => {
  const calls = [];
  const client = fakeExperiments(calls);
  const entries = [
    { experiment: "ask-weekly-1a2b3c4d", case: "area-research-1", note: "Model slip, no change: passed on the next run." },
    { experiment: "ask-weekly-0000dead", case: "area-research-1", note: "An experiment that doesn't exist." },
    { experiment: "ask-weekly-1a2b3c4d", case: "area-gone-1", note: "A case that isn't in the experiment." },
    { experiment: "ask-weekly-1a2b3c4d", case: "area-lists-1", note: "A case that passed, so it has no note to replace." },
  ];
  assert.deepEqual(await backfillNotes(entries, { client }), { updated: 1, missing: entries.slice(1) });
  assert.deepEqual(calls.filter(([name]) => name === "updateFeedback"), [["updateFeedback", "note-exp-1-ex-0", { comment: entries[0].note }]]);
  // the same case's note in the other experiment, and every score, are left as they were
  assert.deepEqual(client.feedback.filter((f) => f.comment).map((f) => [f.id, f.comment]), [["note-exp-1-ex-0", entries[0].note], ["note-exp-2-ex-0", UNDER_REVIEW]]);
  assert.ok(!calls.some(([name, args]) => name === "readProject" && args.projectName === "ask-weekly-0000dead"));
  // run again, it writes the same note: the run keeps one current note
  assert.deepEqual(await backfillNotes(entries.slice(0, 1), { client }), { updated: 1, missing: [] });
  assert.deepEqual(client.feedback.filter((f) => f.run_id === "exp-1-ex-0" && f.key === "note").map((f) => f.comment), [entries[0].note]);
  // an entry missing a field is refused before any call
  const before = calls.length;
  for (const bad of [{ experiment: "ask-weekly-1a2b3c4d", note: "no case" }, { experiment: "ask-weekly-1a2b3c4d", case: "area-research-1", note: "" }, null]) {
    await assert.rejects(backfillNotes([entries[0], bad], { client }), /each note needs an experiment, a case and a note/);
  }
  assert.equal(calls.length, before);
});
