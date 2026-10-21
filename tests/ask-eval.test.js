// The Ask evaluation set: every case in tests/ask-eval.json is a question, the evidence the real tools returned for it (recorded once
// from the committed data and the release assets, so nothing here changes when the nightly data does), a hand-written model answer,
// and what the checker must make of it. Many of the model answers are attacks: they try to say "not sanctioned", to invent an update,
// to cite nothing, to chat or advise, and to carry an injected instruction. Nothing here calls a model or the network, and no
// assertion is about the model's own wording: the rule is that every sentence that comes out is fixed copy, a claim the server writes
// from an evidence item, or a verbatim quote of one.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { checkAnswer } from "../api/_ask_check.js";
import { groundingProblems, REFUSAL, FALLBACK, CLARIFY, NOT_ADVICE } from "../scripts/ask-oracle.mjs";

const CASES = JSON.parse(readFileSync(new URL("./ask-eval.json", import.meta.url), "utf8"));
const SCRIPT = fileURLToPath(new URL("../scripts/ask-live-eval.mjs", import.meta.url));

// the least a case must cover: the owner's four fears, one case per data area, and the probes
const MINIMUM = {
  "fear-false-listing": 4, "fear-invented-update": 4, "fear-no-source": 4, "fear-off-topic": 4,
  "area-lists": 1, "area-research": 1, "area-opensanctions": 1, "area-connections": 1, "area-lobbying": 1, "area-chips": 1, "area-docs": 1, "area-changes": 1,
  "off-topic": 6, injection: 4, "not-on-lists": 4, "date-range": 3, clarify: 3,
};
const SPEC_QUESTIONS = ["What changed this week?", "Is TASSOS sanctioned?", "Who lobbied for Nord Stream 2?", "Should I buy oil from this ship?", "What's the weather?", "Is Rusal sanctioned?"];

// ---- the set itself ------------------------------------------------------------------------------------------------

test("the set has at least 44 cases and every category", () => {
  assert.ok(CASES.length >= 44, `${CASES.length} cases`);
  for (const [category, least] of Object.entries(MINIMUM)) {
    const n = CASES.filter((c) => c.category === category).length;
    assert.ok(n >= least, `${category}: ${n} cases, ${least} needed`);
  }
  const unknown = CASES.filter((c) => !Object.hasOwn(MINIMUM, c.category));
  assert.deepEqual(unknown.map((c) => c.id), [], "a case has a category the set does not know");
});

test("the spec's success questions appear verbatim", () => {
  const asked = new Set(CASES.map((c) => c.question));
  for (const q of SPEC_QUESTIONS) assert.ok(asked.has(q), q);
});

test("every case is well formed, and its evidence is the tools' own S1, S2, … in order", () => {
  const ids = new Set();
  for (const c of CASES) {
    assert.match(c.id, /^[a-z0-9-]+$/, c.id);
    assert.ok(!ids.has(c.id), `duplicate id ${c.id}`);
    ids.add(c.id);
    assert.equal(typeof c.question, "string", c.id);
    assert.ok(c.question.trim(), c.id);
    assert.ok(Array.isArray(c.evidence), c.id);
    assert.ok(c.model === null || typeof c.model === "object", `${c.id}: model`);
    assert.ok(["answer", "refusal", "clarify", "fallback"].includes(c.expect?.kind), `${c.id}: expect.kind`);
    for (const key of ["includes", "excludes"]) assert.ok(c.expect[key] === undefined || (Array.isArray(c.expect[key]) && c.expect[key].every((s) => typeof s === "string" && s)), `${c.id}: expect.${key}`);
    assert.ok(c.expect.fallback === undefined || c.expect.fallback === true, `${c.id}: expect.fallback`);
    assert.ok(c.expect.notice === undefined || (c.expect.notice === true && c.expect.kind === "refusal"), `${c.id}: expect.notice`);
    assert.ok(c.live === undefined || c.live === false, `${c.id}: live`);
    assert.deepEqual(c.evidence.map((e) => e.id), c.evidence.map((_, i) => `S${i + 1}`), `${c.id}: evidence ids`);
    for (const e of c.evidence) {
      assert.equal(typeof e.kind, "string", c.id);
      assert.ok(Array.isArray(e.quotes), `${c.id} ${e.id}: quotes`);
      assert.equal(typeof e.label, "string", `${c.id} ${e.id}: label`);
      assert.equal(typeof e.url, "string", `${c.id} ${e.id}: url`);
    }
  }
});

// ---- the invariant: no sentence the model chose the words of, and every sentence has its source ----------------------------------

const assertNoLeak = (c, out) => assert.deepEqual(groundingProblems(c.question, c.evidence, out), [], c.id);

const endpoint = (c) => checkAnswer(structuredClone(c.model), structuredClone(c.evidence), { question: c.question });

for (const c of CASES) {
  test(`${c.id}: ${c.question}`, () => {
    const out = endpoint(c);
    assert.equal(out.kind, c.expect.kind, `${c.id}: kind`);
    assertNoLeak(c, out);
    const text = out.sentences.map((s) => s.text).join("\n").toLowerCase();
    for (const s of c.expect.includes ?? []) assert.ok(text.includes(s.toLowerCase()), `${c.id}: missing ${JSON.stringify(s)} in ${JSON.stringify(text.slice(0, 300))}`);
    for (const s of c.expect.excludes ?? []) assert.ok(!text.includes(s.toLowerCase()), `${c.id}: contains ${JSON.stringify(s)}`);
    // the fixed answers are exactly their copy
    if (out.kind === "refusal") assert.deepEqual(out, { kind: "refusal", sentences: [{ text: REFUSAL, sources: [] }], next: [] }); // (no notice on a refusal)
    if (out.kind === "fallback") assert.deepEqual(out, { kind: "fallback", sentences: [{ text: FALLBACK, sources: [] }], next: [{ label: "Search", href: "/" }] });
    if (out.kind === "clarify") {
      assert.deepEqual(out.sentences.map((s) => s.text).filter((t) => t !== NOT_ADVICE), [CLARIFY]);
      assert.ok(out.next.length > 0);
    }
  });
}

// ---- the live runner (against a stub server on this machine; nothing leaves it) --------------------------------------------

const LIVE = CASES.filter((c) => c.live !== false);
const run = (args) => new Promise((resolve) => {
  execFile(process.execPath, [SCRIPT, ...args], { timeout: 60_000, env: { PATH: process.env.PATH } }, (err, stdout, stderr) => resolve({ code: err ? (typeof err.code === "number" ? err.code : 1) : 0, stdout, stderr }));
});

/** A server standing in for the deployed site: `reply(body, n)` returns [status, json] for the nth post. */
async function withSite(reply, fn) {
  const seen = [];
  const server = createServer((req, res) => {
    let raw = "";
    req.on("data", (d) => { raw += d; });
    req.on("end", () => {
      seen.push({ method: req.method, url: req.url, origin: req.headers.origin, type: req.headers["content-type"], body: JSON.parse(raw || "{}"), at: Date.now() });
      const [status, json] = reply(seen.at(-1).body, seen.length);
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(json));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    return await fn(base, seen);
  } finally {
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
}
const says = (kind, text = "Stub answer.") => [200, { ok: true, answer: { kind, sentences: [{ text, sources: [{ n: 1, label: "Stub", url: "/" }] }], next: [] } }];
const byQuestion = (body) => LIVE.find((c) => c.question === body.messages?.[0]?.text);

test("live runner: a full run fits one hour's limit of 20 questions, one question each", () => {
  assert.ok(LIVE.length >= 18 && LIVE.length <= 20, `${LIVE.length} live cases`);
  const questions = LIVE.map((c) => c.question);
  assert.equal(new Set(questions).size, questions.length, "a question is posted twice");
  for (const q of SPEC_QUESTIONS) assert.ok(questions.includes(q), `${q} is not live`);
});

test("live runner: --help works and never reads a key", async () => {
  const { code, stdout } = await run(["--help"]);
  assert.equal(code, 0);
  for (const flag of ["--base", "--only", "--dry-run", "--limit-check", "--help"]) assert.ok(stdout.includes(flag), flag);
  assert.doesNotMatch(readFileSync(SCRIPT, "utf8"), /process\.env|OPENROUTER|API_KEY|Authorization/i);
});

test("live runner: --dry-run prints the plan and posts nothing", async () => {
  const { code, stdout } = await run(["--base", "https://undercurrent.invalid", "--dry-run"]);
  assert.equal(code, 0);
  for (const c of LIVE) assert.ok(stdout.includes(c.id) && stdout.includes(c.question), c.id);
  assert.match(stdout, /20 questions/);
  assert.ok(!CASES.filter((c) => c.live === false).some((c) => stdout.includes(`${c.id} `)), "an offline-only case is in the plan");
});

test("live runner: posts the question with the site's Origin, prints the result, and passes on the expected kind", async () => {
  const c = LIVE.find((x) => x.expect.kind === "refusal");
  await withSite((body) => says(byQuestion(body).expect.kind, "Stub refusal text."), async (base, seen) => {
    const { code, stdout } = await run(["--base", `${base}/`, "--only", c.id]);
    assert.equal(code, 0, stdout);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].method, "POST");
    assert.equal(seen[0].url, "/api/ask");
    assert.equal(seen[0].origin, base);
    assert.match(seen[0].type, /^application\/json/);
    assert.deepEqual(seen[0].body, { messages: [{ role: "user", text: c.question }] });
    for (const s of [c.id, "refusal", "Stub refusal text.", "[1] Stub", /\d+ ms/, "p50", "p90", "PASS"]) assert.match(stdout, s instanceof RegExp ? s : new RegExp(s.replace(/[[\]]/g, "\\$&")), String(s));
  });
});

test("live runner: a different kind, an excluded phrase, an unavailable site and a rate limit each fail with a non-zero exit", async () => {
  const c = LIVE.find((x) => x.expect.kind === "answer" && x.expect.excludes?.length);
  assert.ok(c, "a live case with excludes");
  const wrong = c.expect.kind === "refusal" ? "answer" : "refusal";
  const cases = {
    "wrong kind": [() => says(wrong), /FAIL/],
    "excluded phrase": [() => says(c.expect.kind, `Fine, but ${c.expect.excludes[0].toUpperCase()}.`), /FAIL/],
    unavailable: [() => [200, { ok: false, reason: "unavailable" }], /unavailable/],
    "rate limit": [() => [429, { ok: false, reason: "busy" }], /busy|429|hour/],
  };
  for (const [name, [reply, pattern]] of Object.entries(cases)) {
    await withSite(reply, async (base) => {
      const { code, stdout } = await run(["--base", base, "--only", c.id]);
      assert.equal(code, 1, name);
      assert.match(stdout, pattern, name);
    });
  }
});

test("live runner: one second and a half between posts, and the run stops at a rate limit", async () => {
  const two = LIVE.filter((x) => x.expect.kind === "refusal").slice(0, 3);
  await withSite((body, n) => (n < 2 ? says(byQuestion(body).expect.kind) : [429, { ok: false, reason: "busy" }]), async (base, seen) => {
    const { code, stdout } = await run(["--base", base, "--only", two.map((x) => x.id).join(",")]);
    assert.equal(code, 1);
    assert.equal(seen.length, 2, "the run went on after a 429");
    assert.ok(seen[1].at - seen[0].at >= 1400, `${seen[1].at - seen[0].at} ms between posts`);
    assert.match(stdout, /not run/i);
  });
});

test("live runner: --limit-check counts the answers that fell back; a fallback the case allows passes", async () => {
  const allowed = LIVE.find((x) => x.expect.fallback === true && x.expect.kind !== "fallback");
  assert.ok(allowed, "a live case that allows a fallback");
  await withSite(() => says("fallback", FALLBACK), async (base) => {
    const { code, stdout } = await run(["--base", base, "--only", allowed.id, "--limit-check"]);
    assert.equal(code, 0, stdout);
    assert.match(stdout, /FALLBACK[^\n]*1 of 1/i);
  });
  const strict = LIVE.find((x) => x.expect.kind === "answer" && !x.expect.fallback);
  await withSite(() => says("fallback", FALLBACK), async (base) => {
    const { code, stdout } = await run(["--base", base, "--only", strict.id, "--limit-check"]);
    assert.equal(code, 1, "a fallback where an answer was expected is a failure");
    assert.match(stdout, /FALLBACK[^\n]*1 of 1/i);
  });
});

test("live runner: off-topic-1 passes as a refusal or as an answer that ends with the advice notice, and fails otherwise", async () => {
  // the server no longer refuses on its own: a model that answers "Should I buy oil from this ship?" gets records and NOT_ADVICE
  const c = LIVE.find((x) => x.id === "off-topic-1");
  assert.equal(c.question, "Should I buy oil from this ship?");
  assert.deepEqual([c.expect.kind, c.expect.notice], ["refusal", true]);
  const answered = (last) => [200, { ok: true, answer: { kind: "answer", sentences: [{ text: "TASSOS appears on the United Kingdom list under Russia.", sources: [{ n: 1, label: "Stub", url: "/" }] }, ...(last ? [{ text: last, sources: [] }] : [])], next: [] } }];
  for (const [name, reply, code] of [
    ["refusal", () => says("refusal", REFUSAL), 0],
    ["answer with the notice", () => answered(NOT_ADVICE), 0],
    ["answer without it", () => answered(null), 1],
    ["answer with the notice not last", () => [200, { ok: true, answer: { kind: "answer", sentences: [{ text: NOT_ADVICE, sources: [] }, { text: "TASSOS appears on the United Kingdom list under Russia.", sources: [{ n: 1, label: "Stub", url: "/" }] }], next: [] } }], 1],
    ["a clarify", () => [200, { ok: true, answer: { kind: "clarify", sentences: [{ text: CLARIFY, sources: [] }, { text: NOT_ADVICE, sources: [] }], next: [{ label: "TASSOS", href: "/?q=TASSOS" }] } }], 1],
  ]) {
    await withSite(reply, async (base) => {
      const { code: got, stdout } = await run(["--base", base, "--only", c.id]);
      assert.equal(got, code, `${name}: ${stdout}`);
    });
  }
  // and a case without the flag still needs its own kind
  const strict = LIVE.find((x) => x.expect.kind === "refusal" && !x.expect.notice);
  await withSite(() => answered(NOT_ADVICE), async (base) => assert.equal((await run(["--base", base, "--only", strict.id])).code, 1));
});

test("live runner: bad arguments and offline-only ids are refused before anything is posted", async () => {
  assert.equal((await run([])).code, 2, "no --base");
  assert.equal((await run(["--bogus"])).code, 2);
  const offline = CASES.find((c) => c.live === false);
  const r = await run(["--base", "https://undercurrent.invalid", "--only", offline.id]);
  assert.equal(r.code, 2);
  assert.equal((await run(["--base", "https://undercurrent.invalid", "--only", "no-such-case"])).code, 2);
});
