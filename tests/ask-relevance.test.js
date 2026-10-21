// The relevance judge (scripts/ask-relevance.mjs) and its check against the hand labels in tests/ask-relevance-labels.json, with fetch
// faked: nothing here reaches TypeSafe or the network. The fake answers
// in the shape the System One docs give (https://docs.typesafe.ai/api/system-one.md): {model, answers: {<name>: …}, usage}.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { agrees, checkReport, judgeCheck, judgeRelevance, QUESTIONS, THRESHOLDS } from "../scripts/ask-relevance.mjs";
import { checkAnswer } from "../api/_ask_check.js";

const KEY = "ts-test-SENTINEL-key-0000";
const ASKED = {
  question: "how many ships have changed their name of their ship?",
  sentences: ["Across all sources, each hull had a median of 4 names (range 2 to 7)."],
  sources: ["Names change, the hull stays"],
};
const BODY = {
  model: "jev-1.13.0",
  answers: {
    addresses: { type: "score", score: 2.4, confidence: 0.71, probabilities: { 0: 0.05, 1: 0.1, 2: 0.25, 3: 0.6 }, legend: {} },
    unrelated: { type: "noul", noul: 0.12 },
  },
  usage: { input_tokens: 412, output_tokens: 31 },
};
const reply = (body, status = 200) => async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** fetch as a fake that records each call and answers with `answer`. */
function fakeFetch(answer = reply(BODY)) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    return answer(url, init);
  };
  return { calls, fetch };
}

test("it posts the question, the answer's sentences and their sources to System One with the key as a bearer token", async () => {
  const { calls, fetch } = fakeFetch();
  await judgeRelevance(ASKED, { fetch, apiKey: KEY });
  assert.equal(calls.length, 1);
  const [{ url, init }] = calls;
  assert.equal(url, "https://api.typesafe.ai/v1/systemone");
  assert.equal(init.method, "POST");
  assert.deepEqual(init.headers, { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" });
  assert.ok(init.signal instanceof AbortSignal);
  assert.deepEqual(JSON.parse(init.body), {
    model: "jev-latest",
    state: { question: ASKED.question, answer: ASKED.sentences, sources: ASKED.sources },
    questions: {
      addresses: {
        type: "score",
        instructions: "How directly does the answer respond to what the question asks?",
        criteria: [
          "The answer is about something other than what the question asks: its records do not bear on the question.",
          "The answer is about the right subject but gives a different kind of information than the question asks for, for example the question asks how many or how long and the answer gives some other figure or fact.",
          "The answer gives only part of what the question asks for and does not say that it is partial or only examples.",
          "The answer gives what the question asks for.",
        ],
      },
      unrelated: {
        type: "noul",
        instructions: "Does the answer include any record or sentence that does not bear on the question?",
        criteria: { true: "At least one sentence is about something the question does not ask about.", false: "Every sentence bears on what the question asks." },
      },
    },
  });
  assert.deepEqual(QUESTIONS, JSON.parse(init.body).questions);
  // another model can be named
  const other = fakeFetch();
  await judgeRelevance(ASKED, { fetch: other.fetch, apiKey: KEY, model: "jev-1.13.0" });
  assert.equal(JSON.parse(other.calls[0].init.body).model, "jev-1.13.0");
});

test("the score is normalised to 0..1 over its four levels; the noul, the model that answered and the billable tokens come back as given", async () => {
  const { fetch } = fakeFetch();
  const r = await judgeRelevance(ASKED, { fetch, apiKey: KEY });
  assert.deepEqual(Object.keys(r).sort(), ["input_tokens", "judge_model", "relevance", "relevance_confidence", "relevance_probabilities", "unrelated"]);
  assert.ok(Math.abs(r.relevance - 0.8) < 1e-9, String(r.relevance));
  assert.deepEqual([r.relevance_probabilities, r.relevance_confidence, r.unrelated, r.judge_model, r.input_tokens], [BODY.answers.addresses.probabilities, 0.71, 0.12, "jev-1.13.0", 412]);
  for (const [score, relevance] of [[0, 0], [1.5, 0.5], [3, 1]]) {
    const body = structuredClone(BODY);
    body.answers.addresses.score = score;
    assert.equal((await judgeRelevance(ASKED, { fetch: fakeFetch(reply(body)).fetch, apiKey: KEY })).relevance, relevance);
  }
});

/** Runs `fn` with console's log, warn and error recorded; returns [result, lines]. */
async function logged(t, fn) {
  const lines = [];
  for (const m of ["log", "warn", "error", "info"]) t.mock.method(console, m, (...args) => lines.push(args.map(String).join(" ")));
  const result = await fn();
  t.mock.restoreAll();
  return [result, lines];
}

const UNAVAILABLE = ["ask-relevance: judge unavailable"];

test("no key: null and one fixed line, and nothing is fetched", async (t) => {
  for (const apiKey of [undefined, ""]) {
    const { calls, fetch } = fakeFetch();
    const [r, lines] = await logged(t, () => judgeRelevance(ASKED, { fetch, apiKey }));
    assert.equal(r, null);
    assert.deepEqual(lines, UNAVAILABLE);
    assert.equal(calls.length, 0);
  }
});

test("an HTTP error, a failed request, a timeout or a malformed body: null and one fixed line, never the key or the response text", async (t) => {
  const SECRET_TEXT = "response-text-SENTINEL";
  const wrong = (edit) => {
    const body = structuredClone(BODY);
    edit(body);
    return reply(body);
  };
  const hangs = (url, init) => new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(new DOMException(`aborted ${SECRET_TEXT}`, "AbortError"))));
  const cases = {
    "HTTP 401": reply({ detail: SECRET_TEXT }, 401),
    "HTTP 422": reply({ detail: [{ msg: SECRET_TEXT }] }, 422),
    "HTTP 500": reply(SECRET_TEXT, 500),
    "network error": async () => { throw new TypeError(`fetch failed ${SECRET_TEXT} ${KEY}`); },
    timeout: hangs,
    "not JSON": reply(`<html>${SECRET_TEXT}</html>`),
    "JSON null": reply("null"),
    "no answers": wrong((b) => delete b.answers),
    "no score": wrong((b) => delete b.answers.addresses),
    "score not a number": wrong((b) => { b.answers.addresses.score = "2"; }),
    "score above the top level": wrong((b) => { b.answers.addresses.score = 3.5; }),
    "negative score": wrong((b) => { b.answers.addresses.score = -0.1; }),
    "no noul": wrong((b) => delete b.answers.unrelated),
    "noul above 1": wrong((b) => { b.answers.unrelated.noul = 1.2; }),
    "noul NaN": reply(JSON.stringify(BODY).replace('"noul":0.12', '"noul":"NaN"')),
    "no model": wrong((b) => delete b.model),
    "no usage": wrong((b) => delete b.usage),
    "tokens not a number": wrong((b) => { b.usage.input_tokens = "412"; }),
  };
  for (const [name, answer] of Object.entries(cases)) {
    const { calls, fetch } = fakeFetch(answer);
    const t0 = Date.now();
    const [r, lines] = await logged(t, () => judgeRelevance(ASKED, { fetch, apiKey: KEY, timeoutMs: 50 }));
    assert.equal(r, null, name);
    assert.equal(calls.length, 1, name);
    assert.deepEqual(lines, UNAVAILABLE, name);
    assert.ok(!lines.join("\n").includes(KEY) && !lines.join("\n").includes(SECRET_TEXT), name);
    if (name === "timeout") assert.ok(Date.now() - t0 < 2000, "the timeout did not stop the request");
  }
});

test("a judgment that comes back logs nothing", async (t) => {
  const [r, lines] = await logged(t, () => judgeRelevance(ASKED, { fetch: fakeFetch().fetch, apiKey: KEY }));
  assert.ok(r);
  assert.deepEqual(lines, []);
});

// ---- the judge check ------------------------------------------------------------------------------------------------------

const LABELS = JSON.parse(readFileSync(new URL("./ask-relevance-labels.json", import.meta.url), "utf8"));
const CASES = JSON.parse(readFileSync(new URL("./ask-eval.json", import.meta.url), "utf8"));

// The owner's questions on the live site (21 Oct 2026) and the sentences Ask answered with, word for word
const OWNER = [
  ["How long does it take to list a new semiconductor firm?", "good", ["The median time to list a new chip supplier (US Treasury OFAC) is 20.3 months from founding to OFAC listing, across 25 firms founded after 24 February 2022 (the middle half took 16.1 to 25.8 months)."]],
  ["how old are the sanctions on dji?", "partial", ["DJI appears on the United States list under Entity List (EL) since 18 Dec 2020.", "SZ DJI Technology Co., Ltd. appears on the United States list under Chinese military companies."]],
  ["any sanctions on ships which are related to iran?", "partial", ["FORTUNE appears on the United States list under Iran since 20 Apr 2023.", "IRAN PARAK appears on the United States list under Iran since 20 Apr 2023.", "IRAN CHARAK appears on the United States list under Iran since 20 Apr 2023.", "HAYAN appears in OpenSanctions as listed by US."]],
  ["how many ships have changed their name of their ship?", "bad", ["Across all sources, each hull had a median of 4 names (range 2 to 7)."]],
  ["please check if there are any companies related to iran in the recent updates!", "bad", ["New bill: H.R.6058 · 21 Oct 2026", "NVIDIA lobbied on H.R.8800 · 20 Oct 2026"]],
];

// The seven built labels: the recorded case each comes from, and the labels of what its sentences cite there (an answer that is the
// case's whole answer carries every label a reader saw with it, its links included, as a real run sends them)
const BUILT = {
  "tassos-listed": ["area-lists-1", ["Undercurrent research: TASSOS · United States", "Undercurrent research: TASSOS · European Union", "Undercurrent research: TASSOS · United Kingdom", "United Kingdom list · TASSOS", "United States list · TASSOS"]],
  "tassos-manager": ["area-research-1", ["Undercurrent research: TASSOS · United States"]],
  "january-changes": ["date-range-1", ["No record before 20 Oct 2026"]],
  "zephyr-not-found": ["not-on-lists-1", ["Search of the lists, research and OpenSanctions"]],
  "tassos-lobbying": ["area-changes-1", ["20 Oct 2026: NVIDIA lobbied on H.R.8800"]],
  "nord-stream-tassos": ["area-lists-1", ["Undercurrent research: TASSOS · United States"]],
  "chips-lobbying": ["area-changes-1", ["20 Oct 2026: NVIDIA lobbied on S.4784"]],
};

test("the labels: well formed, the owner's five live answers word for word with no sources, and the rest as the checker renders them, sources included", () => {
  const ids = new Set();
  for (const l of LABELS) {
    assert.deepEqual(Object.keys(l), ["id", "question", "sentences", ...(l.id.startsWith("owner-") ? [] : ["sources"]), "label", "why"], l.id);
    assert.match(l.id, /^[a-z0-9-]+$/);
    assert.ok(!ids.has(l.id), `duplicate id ${l.id}`);
    ids.add(l.id);
    assert.ok(typeof l.question === "string" && l.question.trim(), l.id);
    assert.ok(Array.isArray(l.sentences) && l.sentences.length && l.sentences.every((x) => typeof x === "string" && x.trim()), l.id);
    assert.ok(["good", "partial", "bad"].includes(l.label), l.id);
    assert.ok(typeof l.why === "string" && l.why.trim(), l.id);
  }
  assert.equal(LABELS.length, 12);
  const owner = LABELS.filter((l) => l.id.startsWith("owner-"));
  assert.deepEqual(owner.map((l) => [l.question, l.label, l.sentences]), OWNER);
  const built = LABELS.filter((x) => !x.id.startsWith("owner-"));
  assert.deepEqual(built.map((l) => [l.id, l.sources]), Object.entries(BUILT).map(([id, [, sources]]) => [id, sources]));
  for (const l of built) {
    const c = CASES.find((x) => x.id === BUILT[l.id][0]);
    const shown = checkAnswer(structuredClone(c.model), structuredClone(c.evidence), { question: c.question });
    const cited = l.sentences.map((x) => shown.sentences.find((y) => y.text === x));
    assert.ok(cited.every(Boolean), `${l.id}: a sentence ${c.id}'s answer does not render`);
    assert.deepEqual(l.sources, [...new Set(cited.flatMap((x) => x.sources.map((y) => y.label)))], l.id);
    if (cited.length === shown.sentences.length) assert.deepEqual(l.sources, [...new Set([...shown.sentences.flatMap((x) => x.sources.map((y) => y.label)), ...shown.next.map((n) => n.label)])], l.id);
  }
  const count = (label) => LABELS.filter((l) => l.label === label).length;
  assert.deepEqual([count("good"), count("partial"), count("bad")], [5, 2, 5]);
});

test("the agreement rule: one exported set of provisional thresholds, applied at its edges", () => {
  assert.deepEqual(THRESHOLDS, { good: { relevance: 0.67, unrelated: 0.5 }, bad: { relevance: 0.5, unrelated: 0.5 }, partial: { low: 0.33, high: 0.9 } });
  const at = (relevance, unrelated) => ({ relevance, unrelated });
  // good: relevance at least 0.67 and unrelated under 0.5
  assert.deepEqual([at(0.67, 0.49), at(1, 0), at(0.66, 0), at(1, 0.5)].map((r) => agrees("good", r)), [true, true, false, false]);
  // bad: relevance under 0.5, or unrelated at least 0.5
  assert.deepEqual([at(0.49, 0), at(1, 0.5), at(0.5, 0.49), at(1, 0)].map((r) => agrees("bad", r)), [true, true, false, false]);
  // partial: 0.33 up to, not including, 0.9; unrelated does not count
  assert.deepEqual([at(0.33, 0.9), at(0.89, 0), at(0.32, 0), at(0.9, 0)].map((r) => agrees("partial", r)), [true, true, false, false]);
});

test("judgeCheck judges every label on its question, sentences and sources (none when it has none), and reports each verdict, the agreements and the tokens", async (t) => {
  t.mock.method(console, "error", () => {}); // (the label the judge fails on logs its fixed line)
  const labels = [
    { id: "a-good", question: "Q1?", sentences: ["S1."], label: "good", why: "w" },
    { id: "b-bad", question: "Q2?", sentences: ["S2.", "S3."], sources: ["Label 2", "Label 3"], label: "bad", why: "w" },
    { id: "c-partial", question: "Q3?", sentences: ["S4."], label: "partial", why: "w" },
    { id: "d-good", question: "Q4?", sentences: ["S5."], label: "good", why: "w" },
  ];
  const verdicts = { "Q1?": [3, 0.05], "Q2?": [3, 0.1], "Q3?": [1.5, 0.3] }; // Q4? fails
  const requests = [];
  const fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    requests.push(body.state);
    const v = verdicts[body.state.question];
    if (!v) return new Response("{}", { status: 500 });
    return Response.json({ ...BODY, answers: { addresses: { ...BODY.answers.addresses, score: v[0] }, unrelated: { type: "noul", noul: v[1] } } });
  };
  const result = await judgeCheck(labels, { fetch, apiKey: KEY });
  assert.deepEqual(requests, labels.map((l) => ({ question: l.question, answer: l.sentences, sources: l.sources ?? [] })));
  assert.deepEqual(requests[1].sources, ["Label 2", "Label 3"]);
  assert.deepEqual(result, {
    rows: [
      { id: "a-good", label: "good", relevance: 1, unrelated: 0.05, verdict: "agree" },
      { id: "b-bad", label: "bad", relevance: 1, unrelated: 0.1, verdict: "disagree" },
      { id: "c-partial", label: "partial", relevance: 0.5, unrelated: 0.3, verdict: "agree" },
      { id: "d-good", label: "good", relevance: null, unrelated: null, verdict: "unavailable" },
    ],
    agreed: 2, unavailable: 1, total: 4, input_tokens: 3 * 412, judge_models: ["jev-1.13.0"],
  });
  assert.equal(checkReport(result), [
    "id         label    relevance  unrelated  verdict",
    "a-good     good     1.00       0.05       agree",
    "b-bad      bad      1.00       0.10       disagree",
    "c-partial  partial  0.50       0.30       agree",
    "d-good     good     -          -          unavailable",
    "",
    "2 of 4 agree, 1 unavailable. Judge input tokens: 1236 (jev-1.13.0).",
  ].join("\n"));
  assert.match(checkReport({ ...result, unavailable: 0 }), /\n2 of 4 agree\. Judge input tokens: 1236 \(jev-1\.13\.0\)\.$/);
});
