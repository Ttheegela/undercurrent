// The shared judge and grounding check (scripts/ask-judge.mjs, scripts/ask-oracle.mjs): the live script, the offline eval and the
// LangSmith runner all score an answer through these two, so they must agree. Nothing here calls a model or the network.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkAnswer } from "../api/_ask_check.js";
import { judge } from "../scripts/ask-judge.mjs";
import { groundingProblems, REFUSAL, NOT_ADVICE } from "../scripts/ask-oracle.mjs";

const CASES = JSON.parse(readFileSync(new URL("./ask-eval.json", import.meta.url), "utf8"));
const byId = (id) => CASES.find((c) => c.id === id);
const reply = (kind, ...texts) => ({ ok: true, answer: { kind, sentences: texts.map((text) => ({ text, sources: [] })), next: [] } });

test("judge passes off-topic-1 as a refusal or an answer ending in the notice, and fails a plain answer", () => {
  const c = byId("off-topic-1");
  for (const result of [reply("refusal", REFUSAL), reply("answer", "TASSOS appears on the United Kingdom list under Russia.", NOT_ADVICE)]) {
    const v = judge(c, result);
    assert.deepEqual([v.kindOk, v.problems], [true, []]);
  }
  const plain = judge(c, reply("answer", "TASSOS appears on the United Kingdom list under Russia."));
  assert.equal(plain.kindOk, false);
  assert.deepEqual(plain.problems, ["expected refusal (or an answer ending in the advice notice), got answer"]);
  assert.equal(judge(c, reply("answer", NOT_ADVICE, "TASSOS appears on the United Kingdom list under Russia.")).kindOk, false, "the notice must be last");
});

test("judge flags each excluded phrase, case-insensitively", () => {
  const c = CASES.find((x) => x.expect.excludes?.length > 1);
  const phrases = c.expect.excludes;
  const v = judge(c, reply(c.expect.kind, `Fine, but ${phrases.map((s) => s.toUpperCase()).join(" and ")}.`));
  assert.equal(v.excludesOk, false);
  assert.deepEqual(v.problems.filter((p) => p.startsWith("the text contains")), phrases.map((s) => `the text contains ${JSON.stringify(s)}`));
  const clean = judge(c, reply(c.expect.kind, "Nothing to see."));
  assert.equal(clean.excludesOk, true);
  assert.deepEqual(clean.problems, []);
});

test("judge treats {ok:false, reason:\"unavailable\"} as kind \"unavailable\" with kindOk false", () => {
  const c = byId("fear-false-listing-1");
  const v = judge(c, { ok: false, reason: "unavailable" });
  assert.deepEqual([v.kind, v.sentences, v.kindOk, v.fallback], ["unavailable", [], false, false]);
  assert.equal(v.excludesOk, true);
  assert.equal(v.problems.length, 1);
  assert.match(v.problems[0], /^expected answer.*got unavailable/);
});

test("judge allows a fallback where the case does, and reports includes only where the case has them", () => {
  const allowed = CASES.find((x) => x.expect.fallback === true && x.expect.kind !== "fallback");
  const v = judge(allowed, reply("fallback", "x"));
  assert.deepEqual([v.kind, v.kindOk, v.fallback], ["fallback", true, true]);
  const strict = CASES.find((x) => x.expect.kind === "answer" && !x.expect.fallback);
  assert.equal(judge(strict, reply("fallback", "x")).kindOk, false);
  const withIncludes = CASES.find((x) => x.expect.includes?.length === 1);
  assert.equal(judge(withIncludes, reply(withIncludes.expect.kind, withIncludes.expect.includes[0].toUpperCase())).includesOk, true);
  assert.equal(judge(withIncludes, reply(withIncludes.expect.kind, "nothing")).includesOk, false);
  assert.equal(judge(CASES.find((x) => !x.expect.includes), reply("answer", "x")).includesOk, null);
});

test("judge accepts a kind listed in expect.also, still rejects an unlisted one, and also does nothing when absent", () => {
  for (const [id, kind] of [["not-on-lists-4", "fallback"], ["clarify-1", "clarify"]]) {
    const c = byId(id);
    assert.deepEqual([c.expect.kind, c.expect.also], [kind, ["answer"]], id);
    for (const ok of [kind, "answer"]) assert.deepEqual(judge(c, reply(ok, "TASSOS appears on the United Kingdom list under Russia.")).problems, [], `${id} ${ok}`);
    const wrong = judge(c, reply("refusal", REFUSAL));
    assert.deepEqual([wrong.kindOk, wrong.problems], [false, [`expected ${kind} (or answer), got refusal`]], id);
    const { also, ...without } = c.expect;
    const strict = judge({ ...c, expect: without }, reply("answer", "TASSOS appears on the United Kingdom list under Russia."));
    assert.deepEqual([strict.kindOk, strict.problems], [false, [`expected ${kind}, got answer`]], id);
  }
});

test("groundingProblems is [] for every case's recorded model answer through checkAnswer, and names the sentence for an injected free-text sentence", () => {
  for (const c of CASES) {
    const out = checkAnswer(structuredClone(c.model), structuredClone(c.evidence), { question: c.question });
    assert.deepEqual(groundingProblems(c.question, c.evidence, out), [], c.id);
  }
  const free = "Rusal is definitely fine to trade with.";
  const injected = { kind: "answer", sentences: [{ text: free, sources: [] }], next: [] };
  const problems = groundingProblems("Is Rusal sanctioned?", [], injected);
  assert.equal(problems.length, 1);
  assert.ok(problems[0].includes(JSON.stringify(free)), problems[0]);
});
