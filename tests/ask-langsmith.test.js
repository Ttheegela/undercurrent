// The LangSmith runner (scripts/ask-langsmith.mjs), with fakes for LangSmith's client, `evaluate` and `traceable` that record what they
// are handed, and a fake fetch for the relevance judge. Nothing here reaches LangSmith, OpenRouter, TypeSafe or the network. The fake traceable records a step by the SDK's own rules (see
// the runner's header): processInputs when the call starts, the payload serialized only at the end, and a promise for every call.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
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
const ENV = { LANGSMITH_API_KEY: "lsv2_test", OPENROUTER_API_KEY: "sk-or-test", TYPESAFE_API_KEY: "ts-test" };
const WEEKLY = { trigger: "weekly", pr: null, sync: false, commit: SHA };
const USAGE = { prompt_tokens: 1000, completion_tokens: 50, cost: 0.002 };
const SIGNALS = ["outcome", "tool_calls", "latency_s", "tokens_in", "tokens_out", "cost_usd"]; // every case has these
const JUDGED = ["relevance", "unrelated"]; // answered cases whose answer is an answer have these too
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

/**
 * TypeSafe's System One as the judge sees it: each request is recorded, and the answer is `verdicts[question]` ({score, noul}; by
 * default a full score and a low noul), or `status` for an HTTP error.
 */
const fakeJudge = (verdicts = {}) => {
  const requests = [];
  const fetch = async (url, init) => {
    requests.push({ url, headers: init.headers, body: JSON.parse(init.body) });
    const v = verdicts[JSON.parse(init.body).state.question] ?? { score: 3, noul: 0.1 };
    if (v.status) return new Response("{}", { status: v.status });
    return Response.json({ model: "jev-1.13.0", answers: { addresses: { type: "score", score: v.score, confidence: 0.9, probabilities: {}, legend: {} }, unrelated: { type: "noul", noul: v.noul } }, usage: { input_tokens: 300, output_tokens: 20 } });
  };
  return { requests, fetch };
};

function setup(cases, ask, env = ENV, judge = fakeJudge()) {
  const calls = [];
  const steps = [];
  const rows = [];
  const traceable = fakeTraceable(steps);
  return { calls, steps, rows, judge, deps: { client: fakeClient(calls), evaluate: fakeEvaluate(cases, calls, rows, traceable), traceable, runAsk: ask, now: () => NOW, env, fetch: judge.fetch } };
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
    const answered = s.outcome.value === "quality" ? ["pass", "fallback", ...(byId(id).expect.includes ? ["includes_ok"] : []), ...JUDGED] : []; // (both answers here are kind answer)
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
  assert.deepEqual(options.metadata, { commit: SHA, trigger: "pr", pr: 31, model: MODEL, prompt_hash: promptHash, judge_model: "jev-latest" });
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
    relevance: { judged: 0, mean_relevance: null, mean_unrelated: null, judge_tokens: 0, judge_models: [], unavailable: 0, clarified: 0 }, // (a refusal is not judged)
  });
  const weekly = setup([byId("off-topic-1")], fakeAsk({ "off-topic-1": {} }));
  await runEvals(WEEKLY, weekly.deps);
  const [[, w]] = weekly.calls.filter(([name]) => name === "evaluate");
  assert.deepEqual([w.experimentPrefix, w.metadata.trigger, w.metadata.pr], ["ask-weekly", "weekly", null]);
});

/** The labels a reader sees with an answer: its sentences' sources, then its links. */
const labelsOf = (a) => [...new Set([...a.sentences.flatMap((s) => s.sources.map((x) => x.label)), ...a.next.map((n) => n.label)])];
const NONE = { judged: 0, mean_relevance: null, mean_unrelated: null, judge_tokens: 0, judge_models: [], unavailable: 0, clarified: 0 };

test("the relevance judge scores answered cases whose answer is an answer, on what the reader saw; a clarify is counted, not judged", async () => {
  const script = {
    "area-lists-1": {}, // an answer
    "clarify-1": {}, // a clarify: counted apart, not judged
    "area-research-1": { answer: UNGROUNDED }, // an answer that fails pass is judged all the same
    "off-topic-2": {}, // a refusal: fixed copy, not judged
    "relevance-2": {}, // a fallback: fixed copy, not judged
    "off-topic-3": { stop: UNAVAILABLE }, // infrastructure: no answer
  };
  const judge = fakeJudge({ [byId("area-research-1").question]: { score: 0, noul: 0.9 } });
  const { calls, rows, deps } = setup(Object.keys(script).map(byId), fakeAsk(script), ENV, judge);
  const result = await runEvals(WEEKLY, deps);
  const scores = scoresOf(rows);
  const judged = ["area-lists-1", "area-research-1"];
  assert.deepEqual(Object.keys(scores).filter((id) => scores[id].relevance || scores[id].unrelated), judged);
  assert.deepEqual(judged.map((id) => [scores[id].relevance.score, scores[id].unrelated.score]), [[1, 0.1], [0, 0.9]]);
  assert.deepEqual([scores["clarify-1"].pass.score, scores["off-topic-2"].pass.score, scores["relevance-2"].fallback.score], [1, 1, 1]); // (answered, scored, not judged)
  assert.equal(rows.find((r) => r.example.metadata.case_id === "clarify-1").run.outputs.result.answer.kind, "clarify");
  // one request per judged case: the question, the sentences and the labels the reader saw, with the key as a bearer token
  assert.deepEqual(judge.requests.map((r) => [r.url, r.headers.Authorization, r.body.model, r.body.state.question]), judged.map((id) => ["https://api.typesafe.ai/v1/systemone", "Bearer ts-test", "jev-latest", byId(id).question]));
  const c = byId("area-lists-1");
  const shown = checkAnswer(structuredClone(c.model), structuredClone(c.evidence), { question: c.question });
  assert.deepEqual(judge.requests[0].body.state, { question: c.question, answer: shown.sentences.map((x) => x.text), sources: labelsOf(shown) });
  assert.ok(judge.requests[0].body.state.answer.length >= 2 && judge.requests[0].body.state.sources.length >= 2);
  // the run's totals: the experiment names the judge asked for; the result and the summary carry the means, the judge's tokens and
  // the version that answered, and the clarifies apart
  assert.equal(calls.find(([name]) => name === "evaluate")[1].metadata.judge_model, "jev-latest");
  assert.deepEqual(result.relevance, { judged: 2, mean_relevance: 0.5, mean_unrelated: 0.5, judge_tokens: 600, judge_models: ["jev-1.13.0"], unavailable: 0, clarified: 1 });
  assert.match(summary(result), /^- Relevance \(Jev\): 2 judged, mean relevance 0\.5, mean unrelated 0\.5, 600 judge input tokens \(jev-1\.13\.0\); asked to clarify: 1\.$/m);
});

test("the judge never changes pass or any other score: the same answers judged as badly as can be, and not judged at all", async (t) => {
  t.mock.method(console, "log", () => {}); // (the run without a key says the judge was skipped)
  const script = { "area-lists-1": {}, "area-research-1": { answer: UNGROUNDED }, "clarify-1": {}, "relevance-3": {}, "off-topic-2": {} };
  const worst = fakeJudge(Object.fromEntries(Object.keys(script).map((id) => [byId(id).question, { score: 0, noul: 1 }])));
  const run = async (env, judge) => {
    const { rows, deps } = setup(Object.keys(script).map(byId), fakeAsk(script), env, judge);
    const { relevance, ...result } = await runEvals(WEEKLY, deps);
    const scores = scoresOf(rows);
    const rest = Object.fromEntries(Object.entries(scores).map(([id, s]) => [id, Object.fromEntries(Object.entries(s).filter(([key]) => !JUDGED.includes(key) && key !== "latency_s"))]));
    return { scores, rest, result, relevance };
  };
  const judged = await run(ENV, worst);
  const plain = await run({ ...ENV, TYPESAFE_API_KEY: undefined });
  assert.deepEqual([judged.relevance.judged, judged.relevance.clarified], [3, 1]);
  assert.deepEqual([plain.relevance.judged, plain.relevance.clarified], [0, 1]);
  assert.deepEqual(judged.rest, plain.rest);
  assert.deepEqual(judged.result, plain.result);
  assert.deepEqual(Object.values(judged.scores).map((s) => s.pass.score), [1, 0, 1, 1, 1]);
});

test("without TYPESAFE_API_KEY the judge is skipped with one line: nothing is fetched and the run goes on", async (t) => {
  const logs = t.mock.method(console, "log", () => {});
  for (const value of [undefined, ""]) { // (a secret that was never set reaches a job as "")
    logs.mock.resetCalls();
    const script = { "area-lists-1": {}, "clarify-1": {} };
    const { calls, rows, judge, deps } = setup(Object.keys(script).map(byId), fakeAsk(script), { ...ENV, TYPESAFE_API_KEY: value });
    const result = await runEvals(WEEKLY, deps);
    assert.deepEqual(logs.mock.calls.map((c) => c.arguments), [["ask-langsmith: TYPESAFE_API_KEY is not set, so the relevance judge was skipped"]]);
    assert.equal(judge.requests.length, 0);
    assert.deepEqual(Object.values(scoresOf(rows)).map((s) => [s.pass.score, s.relevance, s.unrelated]), [[1, undefined, undefined], [1, undefined, undefined]]);
    assert.equal(calls.find(([name]) => name === "evaluate")[1].metadata.judge_model, null);
    assert.deepEqual(result.relevance, { ...NONE, clarified: 1 });
    assert.match(summary(result), /^- Relevance \(Jev\): no case judged; asked to clarify: 1\.$/m);
  }
});

test("a case the judge could not judge gets no relevance scores and is counted as unavailable, not judged", async (t) => {
  const errors = t.mock.method(console, "error", () => {});
  const script = { "area-lists-1": {}, "area-research-1": {} };
  const judge = fakeJudge({ [byId("area-research-1").question]: { status: 503 } });
  const { rows, deps } = setup(Object.keys(script).map(byId), fakeAsk(script), ENV, judge);
  const result = await runEvals(WEEKLY, deps);
  assert.deepEqual(errors.mock.calls.map((c) => c.arguments), [["ask-relevance: judge unavailable"]]);
  const scores = scoresOf(rows);
  assert.deepEqual([scores["area-lists-1"].relevance.score, scores["area-research-1"].relevance, scores["area-research-1"].pass.score], [1, undefined, 1]);
  assert.deepEqual(result.relevance, { judged: 1, mean_relevance: 1, mean_unrelated: 0.1, judge_tokens: 300, judge_models: ["jev-1.13.0"], unavailable: 1, clarified: 0 });
  assert.match(summary(result), /^- Relevance \(Jev\): 1 judged, mean relevance 1, mean unrelated 0\.1, 300 judge input tokens \(jev-1\.13\.0\); judge unavailable for 1 case; asked to clarify: 0\.$/m);
});

test("a key that is set but a judge that fails every time: the summary says the judge was unavailable, not that no case was judged", async (t) => {
  t.mock.method(console, "error", () => {});
  const script = { "area-lists-1": {}, "area-research-1": {}, "clarify-1": {} };
  const judge = fakeJudge(Object.fromEntries(Object.keys(script).map((id) => [byId(id).question, { status: 500 }])));
  const { deps } = setup(Object.keys(script).map(byId), fakeAsk(script), ENV, judge);
  const result = await runEvals(WEEKLY, deps);
  assert.equal(judge.requests.length, 2); // (the clarify is not sent)
  assert.deepEqual(result.relevance, { ...NONE, unavailable: 2, clarified: 1 });
  const line = summary(result).split("\n").find((l) => l.startsWith("- Relevance"));
  assert.equal(line, "- Relevance (Jev): judge unavailable for 2 cases; asked to clarify: 1.");
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
  assert.deepEqual(await syncDataset(CASES, { client }), { created: 39, updated: 0, removed: 0 });
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
  assert.deepEqual(result.sync, { created: 39, updated: 0, removed: 0 });
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

// ---- judge-check ----------------------------------------------------------------------------------------------------------

const RUNNER = new URL("../scripts/ask-langsmith.mjs", import.meta.url).pathname;
const LABELS = JSON.parse(readFileSync(new URL("./ask-relevance-labels.json", import.meta.url), "utf8"));

/**
 * Runs `judge-check` as the workflow does, with fetch replaced (through --import) by a fake System One that logs each request and
 * judges every answer fully relevant except those to "Is TASSOS sanctioned?" (not at all), and fails with HTTP 500 for `fail`.
 */
function judgeCheckRun(env, fail = "") {
  const dir = mkdtempSync(join(tmpdir(), "judge-check-"));
  const stub = join(dir, "fetch.mjs");
  writeFileSync(stub, `import { appendFileSync } from "node:fs";
globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init.body);
  appendFileSync(${JSON.stringify(join(dir, "requests"))}, JSON.stringify({ url, auth: init.headers.Authorization, state: body.state }) + "\\n");
  if (body.state.question === ${JSON.stringify(fail)}) return new Response("{}", { status: 500 });
  const score = body.state.question === "Is TASSOS sanctioned?" ? 0 : 3;
  return Response.json({ model: "jev-1.13.0", answers: { addresses: { type: "score", score, confidence: 0.9, probabilities: {}, legend: {} }, unrelated: { type: "noul", noul: 0.1 } }, usage: { input_tokens: 100, output_tokens: 5 } });
};
`);
  const r = spawnSync(process.execPath, ["--import", pathToFileURL(stub).href, RUNNER, "judge-check"], { encoding: "utf8", env: { PATH: process.env.PATH, ...env } });
  let requests = [];
  try { requests = readFileSync(join(dir, "requests"), "utf8").trim().split("\n").map((l) => JSON.parse(l)); } catch {}
  return { ...r, requests };
}

test("judge-check without TYPESAFE_API_KEY exits 2 before anything is fetched", () => {
  for (const env of [{}, { TYPESAFE_API_KEY: "" }]) {
    const r = judgeCheckRun(env);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /^TYPESAFE_API_KEY is not set$/m);
    assert.deepEqual(r.requests, []);
  }
  const extra = spawnSync(process.execPath, [RUNNER, "judge-check", "--now"], { encoding: "utf8", env: { PATH: process.env.PATH } });
  assert.equal(extra.status, 2);
  assert.match(extra.stderr, /node scripts\/ask-langsmith\.mjs judge-check/);
});

test("judge-check judges every label, prints a row each and the agreements, and exits 0 even where the judge disagrees", () => {
  const r = judgeCheckRun({ TYPESAFE_API_KEY: "ts-test" });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.requests.map((q) => [q.url, q.auth, q.state]), LABELS.map((l) => ["https://api.typesafe.ai/v1/systemone", "Bearer ts-test", { question: l.question, answer: l.sentences, sources: l.sources ?? [] }]));
  assert.ok(r.requests.some((q) => q.state.sources.length));
  const lines = r.stdout.trim().split("\n");
  assert.match(lines[0], /^id +label +relevance +unrelated +verdict$/);
  const rows = Object.fromEntries(lines.slice(1, 1 + LABELS.length).map((l) => l.split(/ +/)).map(([id, ...rest]) => [id, rest]));
  assert.deepEqual(Object.keys(rows), LABELS.map((l) => l.id));
  assert.deepEqual(rows["owner-chips-lag"], ["good", "1.00", "0.10", "agree"]);
  assert.deepEqual(rows["tassos-listed"], ["good", "0.00", "0.10", "disagree"]);
  assert.deepEqual(rows["tassos-lobbying"], ["bad", "0.00", "0.10", "agree"]);
  assert.deepEqual(rows["owner-dji-age"], ["partial", "1.00", "0.10", "disagree"]);
  assert.equal(lines.at(-1), "5 of 12 agree. Judge input tokens: 1200 (jev-1.13.0).");
  assert.ok(!(r.stdout + r.stderr).includes("ts-test"));
});

test("judge-check exits 1 when the judge was unavailable for a label, after printing the rest", () => {
  const r = judgeCheckRun({ TYPESAFE_API_KEY: "ts-test" }, "Who manages TASSOS?");
  assert.equal(r.status, 1);
  assert.equal(r.requests.length, LABELS.length);
  assert.match(r.stdout, /^tassos-manager +good +- +- +unavailable$/m);
  assert.match(r.stdout, /\n4 of 12 agree, 1 unavailable\. Judge input tokens: 1100 \(jev-1\.13\.0\)\.\n$/);
  assert.match(r.stderr, /ask-relevance: judge unavailable/);
  assert.match(r.stderr, /the judge was unavailable for 1 label, so the check is incomplete/);
});
