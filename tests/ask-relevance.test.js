// The relevance judge (scripts/ask-relevance.mjs), with fetch faked: nothing here reaches TypeSafe or the network. The fake answers
// in the shape the System One docs give (https://docs.typesafe.ai/api/system-one.md): {model, answers: {<name>: …}, usage}.
import { test } from "node:test";
import assert from "node:assert/strict";
import { judgeRelevance, QUESTIONS } from "../scripts/ask-relevance.mjs";

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
          "The answer gives what the question asks for, or clearly says it shows only part of it or only examples.",
        ],
      },
      unrelated: {
        type: "noul",
        instructions: "Does the answer include any record or sentence that does not bear on the question, presented as though it answered it?",
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
