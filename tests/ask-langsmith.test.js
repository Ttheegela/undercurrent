// The LangSmith runner (scripts/ask-langsmith.mjs), with fakes for LangSmith's client, `evaluate` and `traceable` that record what they
// are handed. Nothing here reaches LangSmith, OpenRouter or the network. The fake traceable records a step by the SDK's own rules (see
// the runner's header): processInputs when the call starts, the payload serialized only at the end, and a promise for every call.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { runEvals } from "../scripts/ask-langsmith.mjs";
import { MODEL, runAsk } from "../api/ask.js";
import { checkAnswer } from "../api/_ask_check.js";
import { SYSTEM_PROMPT } from "../api/_ask_prompt.js";
import { TOOLS } from "../api/_ask_tools.js";
import { FALLBACK } from "../scripts/ask-oracle.mjs";

const LIVE = JSON.parse(readFileSync(new URL("./ask-eval.json", import.meta.url), "utf8")).filter((c) => c.live !== false);
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
  readProject: async (args) => (calls.push(["readProject", args]), { id: "exp-1" }),
  getDatasetUrl: async (args) => (calls.push(["getDatasetUrl", args]), "https://smith.test/o/t/datasets/ds-1"),
  createFeedback: async (args) => (calls.push(["createFeedback", args]), {}),
});

/**
 * Ask's loop in miniature, through `wrap` as runAsk calls it: a model call, a tool call that hands over the case's recorded evidence,
 * a second model call, then the checker on the case's recorded answer. `script[case id]` changes that: `stop` ends it at the first
 * model call, `answer` replaces the checker's answer, `download` records a failed download, `usage` is what each model call reports.
 */
const fakeAsk = (script) => async (history, now, { wrap }) => {
  const c = LIVE.find((x) => x.question === history.at(-1).content);
  const plan = script[c.id];
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
  assert.deepEqual(calls.filter(([name]) => name !== "evaluate"), [["readProject", { projectName: "ask-pr-31-1a2b3c4d" }], ["getDatasetUrl", { datasetName: "undercurrent-ask" }]]);
  assert.deepEqual(result, {
    experiment: "ask-pr-31-1a2b3c4d",
    url: "https://smith.test/o/t/datasets/ds-1/compare?selectedSessions=exp-1",
    trigger: "pr",
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
