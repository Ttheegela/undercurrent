// The live relevance gate (api/_ask_gate.js): TypeSafe's Jev judges each sentence an answer would show, and the ones that don't bear on
// the question are dropped. Answers are the checker's own, built from small hand-made evidence; TypeSafe is a fake fetch that records
// each request. Nothing here reaches the network.
import { test, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { checkAnswer } from "../api/_ask_check.js";
import { gate, GATE_THRESHOLD } from "../api/_ask_gate.js";
import { groundingProblems, NOTHING_ANSWERS, PARTIAL, NOT_ADVICE } from "../scripts/ask-oracle.mjs";

const KEY = "ts-fake-key-for-tests-only";
const TODAY = "2026-10-22";
const QUESTION = "Which ships named Iran are on the US list?";
const LINE = "ask: relevance gate unavailable";

// a search of 5 matches, 3 of them handed back; a doc that says nothing of these ships; a name the search did not find
const search = { id: "S1", kind: "search", query: "IRAN", found: true, near: [], shown: 3, total: 5, label: "Search of the lists, research and OpenSanctions", url: "/", quotes: [] };
const record = (n, name) => ({
  id: `S${n}`, kind: "list", gov: "us", program: "Iran", date: "2020-01-15", date_basis: "list", entity: { id: `us:${n}`, name },
  label: `United States list · ${name}`, url: `https://example.org/us/${n}`, quotes: [], result: "S1",
});
const doc = { id: "S5", kind: "doc", label: "The main tools", url: "/stories/how-sanctions-work/index.html", quotes: ["Asset freeze (also called blocking). Nobody may pay, hold or move money for a blocked person."] };
const missing = { id: "S6", kind: "search", query: "Zephyr Marine Services", found: false, near: [], label: "Search of the lists, research and OpenSanctions", url: "/", quotes: [] };
const EV = [search, record(2, "IRAN SHALAK"), record(3, "IRAN YOUSHAT"), record(4, "IRAN PARAK"), doc, missing];
const SHALAK = "IRAN SHALAK appears on the United States list under Iran since 15 Jan 2020.";
const YOUSHAT = "IRAN YOUSHAT appears on the United States list under Iran since 15 Jan 2020.";
const PARAK = "IRAN PARAK appears on the United States list under Iran since 15 Jan 2020.";
const FREEZE = doc.quotes[0];

const listed = (id) => ({ claim: "listed", sources: [id] });
const quote = { claim: "quote", sources: ["S5"], quote: 0 };
/** The checker's answer to `question` from these sentences. */
const built = (sentences = [listed("S2"), listed("S3"), quote, listed("S4")], question = QUESTION) => checkAnswer({ kind: "answer", sentences, next: [] }, EV, { question, today: TODAY });
const texts = (a) => a.sentences.map((s) => s.text);
const src = (n, e) => ({ n, label: e.label, url: e.url });

/** TypeSafe's System One: each request recorded, each sentence's noul `p(text)`; `respond(init)` replaces the reply. */
function typesafe(p = () => 0.9, respond) {
  const requests = [];
  const fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    requests.push({ url, method: init.method, headers: new Headers(init.headers), body });
    if (respond) return respond(init);
    const answers = Object.fromEntries(body.state.sentences.map((s) => [`s${s.i}`, { type: "noul", noul: p(s.text) }]));
    return Response.json({ model: "jev-1.13.0", answers, usage: { input_tokens: 200, output_tokens: 8 } });
  };
  return { requests, fetch };
}
const sent = (ts) => ts.requests.flatMap((r) => r.body.state.sentences.map((s) => s.text));

let logged;
const capture = () => {
  logged = [];
  for (const level of ["log", "info", "warn", "error", "debug"]) mock.method(console, level, (...args) => logged.push(args.map(String).join(" ")));
};
afterEach(() => mock.restoreAll());

test("the gate keeps sentences that bear on the question and drops the rest", async () => {
  capture();
  const answer = built();
  assert.deepEqual(texts(answer), [SHALAK, YOUSHAT, FREEZE, PARAK, "Showing 3 of 5."]);
  // 0.5 is kept: the threshold is p(yes) ≥ 0.5
  const ts = typesafe((t) => ({ [FREEZE]: 0.2, [YOUSHAT]: 0.5 })[t] ?? 0.9);
  const out = await gate(QUESTION, answer, { fetch: ts.fetch, apiKey: KEY });
  assert.equal(GATE_THRESHOLD, 0.5);
  assert.deepEqual(texts(out), [SHALAK, YOUSHAT, PARAK, "Showing 3 of 5."]);
  assert.deepEqual(groundingProblems(QUESTION, EV, out, TODAY), []);
  // one request, as the docs give it: the question and each sentence with its sources' labels, one noul a sentence
  assert.equal(ts.requests.length, 1);
  const [r] = ts.requests;
  assert.deepEqual([r.url, r.method, r.headers.get("authorization"), r.headers.get("content-type")], ["https://api.typesafe.ai/v1/systemone", "POST", `Bearer ${KEY}`, "application/json"]);
  assert.deepEqual(r.body, {
    model: "jev-latest",
    state: {
      question: QUESTION,
      sentences: [
        { i: 0, text: SHALAK, source: "United States list · IRAN SHALAK" },
        { i: 1, text: YOUSHAT, source: "United States list · IRAN YOUSHAT" },
        { i: 2, text: FREEZE, source: "The main tools" },
        { i: 3, text: PARAK, source: "United States list · IRAN PARAK" },
      ],
    },
    questions: Object.fromEntries([0, 1, 2, 3].map((i) => [`s${i}`, { type: "noul", instructions: `Does sentence ${i} bear on what the question asks?` }])),
  });
  // a sentence of several sources (a count with an example) sends their labels together
  const firms = { id: "S7", kind: "count", unit: "firms", n: 64, label: "Chips research · firms", url: "/chips", quotes: [] };
  const release = { id: "S8", kind: "chips", result: "S7", label: "US Treasury press release jy2700", url: "/jy2700", quotes: [] };
  const ts2 = typesafe();
  await gate(QUESTION, checkAnswer({ kind: "answer", sentences: [{ claim: "count", sources: ["S7", "S8"] }], next: [] }, [firms, release], { question: QUESTION, today: TODAY }), { fetch: ts2.fetch, apiKey: KEY });
  assert.deepEqual(ts2.requests[0].body.state.sentences, [{ i: 0, text: "64 firms are named in Undercurrent's research as shipping chips to Russia.", source: "Chips research · firms; US Treasury press release jy2700" }]);
  assert.deepEqual(logged, []); // a gate that answered logs nothing
});

test("the gate renumbers sources and rebuilds Showing lines", async () => {
  const answer = built();
  const [shalak, youshat, freeze, parak] = [EV[1], EV[2], doc, EV[3]];
  assert.deepEqual(answer.sentences.map((s) => s.sources), [[src(1, shalak)], [src(2, youshat)], [src(3, freeze)], [src(4, parak)], []]);
  const without = async (...drop) => gate(QUESTION, answer, { fetch: typesafe((t) => (drop.includes(t) ? 0.1 : 0.9)).fetch, apiKey: KEY });
  // a listing dropped: the rest are numbered again, and the line counts the two listings left
  const one = await without(YOUSHAT);
  assert.deepEqual(one.sentences, [
    { text: SHALAK, sources: [src(1, shalak)] }, { text: FREEZE, sources: [src(2, freeze)] }, { text: PARAK, sources: [src(3, parak)] },
    { text: "Showing 2 of 5.", sources: [] },
  ]);
  // the last listing dropped: the line follows the last listing that is left
  assert.deepEqual(texts(await without(PARAK)), [SHALAK, YOUSHAT, "Showing 2 of 5.", FREEZE]);
  // every listing dropped: no line, since nothing of the search is shown
  const none = await without(SHALAK, YOUSHAT, PARAK);
  assert.deepEqual(none.sentences, [{ text: FREEZE, sources: [src(1, freeze)] }]);
  for (const out of [one, none, await without(PARAK), await without(FREEZE)]) assert.deepEqual(groundingProblems(QUESTION, EV, out, TODAY), []);
});

test("final review minor 1: a See also link goes when every sentence citing its item is dropped", async () => {
  // links to the doc, to two records the answer cites, and to one it never cites (the model's own choice, which the gate does not judge)
  const linked = checkAnswer({ kind: "answer", sentences: [listed("S2"), quote, listed("S4")], next: ["S5", "S2", "S4", "S3"].map((source) => ({ source })) }, EV, { question: QUESTION, today: TODAY });
  const link = (e) => ({ label: e.label, href: e.url });
  assert.deepEqual(linked.next, [link(doc), link(EV[1]), link(EV[3]), link(EV[2])]);
  const without = async (...drop) => gate(QUESTION, linked, { fetch: typesafe((t) => (drop.includes(t) ? 0.1 : 0.9)).fetch, apiKey: KEY });
  assert.deepEqual((await without(FREEZE, PARAK)).next, [link(EV[1]), link(EV[2])]);
  assert.deepEqual((await without(SHALAK)).next, [link(doc), link(EV[3]), link(EV[2])]);
  assert.deepEqual((await without()).next, linked.next); // nothing dropped: the links as they were
  for (const drop of [[FREEZE, PARAK], [SHALAK]]) assert.deepEqual(groundingProblems(QUESTION, EV, await without(...drop), TODAY), []);
});

test("the gate never sends or drops fixed copy", async () => {
  // the part-answer line (a name typed but not found, beside a found one) and the notice (the question asks for advice)
  const question = "Should I trade with IRAN SHALAK or Zephyr Marine Services?";
  const answer = built([listed("S2"), quote, { claim: "not_found", sources: ["S6"] }], question);
  assert.deepEqual(texts(answer), [SHALAK, "Showing 1 of 5.", FREEZE, PARTIAL, NOT_ADVICE]);
  // judged all unrelated but one: only the two written from evidence are sent, and the fixed lines stay, in order
  const ts = typesafe((t) => (t === SHALAK ? 0.9 : 0));
  const out = await gate(question, answer, { fetch: ts.fetch, apiKey: KEY });
  assert.deepEqual(sent(ts), [SHALAK, FREEZE]);
  assert.deepEqual(texts(out), [SHALAK, "Showing 1 of 5.", PARTIAL, NOT_ADVICE]);
  assert.deepEqual(groundingProblems(question, EV, out, TODAY), []);
  // all kept: the same answer
  assert.deepEqual(await gate(question, answer, { fetch: typesafe().fetch, apiKey: KEY }), answer);
  // an answer of fixed copy only (nothing answers) is not sent at all
  capture();
  const nothing = checkAnswer({ kind: "answer", sentences: [] }, EV, { question, today: TODAY });
  const idle = typesafe(() => 0);
  assert.equal(await gate(question, nothing, { fetch: idle.fetch, apiKey: KEY }), nothing);
  assert.deepEqual([idle.requests, logged], [[], []]);
});

test("all dropped gives NOTHING_ANSWERS", async () => {
  const question = "Should I trade with IRAN SHALAK or Zephyr Marine Services?";
  for (const answer of [built(), built([listed("S2"), quote, { claim: "not_found", sources: ["S6"] }], question)]) {
    const out = await gate(question, answer, { fetch: typesafe(() => 0.1).fetch, apiKey: KEY });
    assert.deepEqual(out, { kind: "answer", sentences: [{ text: NOTHING_ANSWERS, sources: [] }], next: [] });
    assert.deepEqual(groundingProblems(question, EV, out, TODAY), []);
  }
});

test("an unset key, a timeout, HTTP 500 or a malformed reply returns the answer unchanged and logs only the fixed line", async () => {
  const answer = built();
  const reply = (body, status = 200) => () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  const nouls = (...p) => ({ model: "jev-1.13.0", answers: Object.fromEntries(p.map((x, i) => [`s${i}`, { type: "noul", noul: x }])), usage: { input_tokens: 1, output_tokens: 1 } });
  // a reply that never comes, until the gate gives up (the interval stands in for the open socket that keeps a real process alive)
  const stall = (init) => new Promise((_, reject) => {
    const socket = setInterval(() => {}, 1000);
    init.signal.addEventListener("abort", () => (clearInterval(socket), reject(init.signal.reason)));
  });
  const cases = [
    ["HTTP 500", reply({ error: "boom" }, 500)],
    ["HTTP 401", reply({ detail: "bad key" }, 401)],
    ["not JSON", reply("<html>oops</html>")],
    ["null", reply("null")],
    ["no answers", reply({ model: "jev-1.13.0", usage: {} })],
    ["a sentence unanswered", reply(nouls(0.9, 0.9, 0.9))],
    ["a noul as text", reply(nouls(0.9, "0.9", 0.9, 0.9))],
    ["a noul above 1", reply(nouls(0.9, 1.5, 0.9, 0.9))],
    ["a noul below 0", reply(nouls(0.9, -0.1, 0.9, 0.9))],
    ["the network failed", () => Promise.reject(new TypeError("fetch failed"))],
    ["a timeout", stall],
  ];
  for (const [what, respond] of cases) {
    capture();
    const ts = typesafe(undefined, respond);
    assert.equal(await gate(QUESTION, answer, { fetch: ts.fetch, apiKey: KEY, timeoutMs: 20 }), answer, what);
    assert.deepEqual([ts.requests.length, logged], [1, [LINE]], what);
    mock.restoreAll();
  }
  // no key: nothing is sent
  for (const apiKey of [undefined, ""]) {
    capture();
    const ts = typesafe(() => 0);
    assert.equal(await gate(QUESTION, answer, { fetch: ts.fetch, apiKey }), answer);
    assert.deepEqual([ts.requests.length, logged], [0, [LINE]]);
    mock.restoreAll();
  }
  // the key comes from TYPESAFE_API_KEY when none is given, and the budget is 3 s
  const saved = process.env.TYPESAFE_API_KEY;
  const real = AbortSignal.timeout.bind(AbortSignal);
  const budgets = [];
  mock.method(AbortSignal, "timeout", (ms) => (budgets.push(ms), real(ms)));
  try {
    process.env.TYPESAFE_API_KEY = KEY;
    const ts = typesafe();
    await gate(QUESTION, answer, { fetch: ts.fetch });
    assert.equal(ts.requests[0].headers.get("authorization"), `Bearer ${KEY}`);
    assert.deepEqual(budgets, [3000]);
  } finally {
    if (saved === undefined) delete process.env.TYPESAFE_API_KEY;
    else process.env.TYPESAFE_API_KEY = saved;
  }
});

test("no question or sentence text in any log", async () => {
  const question = "Which ships named Iran are on the US list? my secret case 4471";
  const answer = built(undefined, question);
  const echo = (init) => `${init.body} ${KEY}`; // a reply that quotes the request, the key with it
  const flows = [
    typesafe(), typesafe(() => 0.1), typesafe((t) => (t === FREEZE ? 0 : 1)),
    typesafe(undefined, (init) => new Response(echo(init), { status: 500 })),
    typesafe(undefined, (init) => new Response(echo(init))),
    typesafe(undefined, (init) => Promise.reject(new Error(echo(init)))),
  ];
  capture();
  for (const ts of flows) await gate(question, answer, { fetch: ts.fetch, apiKey: KEY });
  await gate(question, answer, { fetch: typesafe().fetch, apiKey: undefined });
  assert.ok(logged.length > 0);
  assert.ok(logged.every((line) => line === LINE), logged.join("\n"));
});

test("TYPESAFE_API_KEY is read in api/_ask_gate.js and nowhere else under api/", () => {
  const api = new URL("../api/", import.meta.url);
  const readers = readdirSync(api, { recursive: true }).filter((f) => /\.[cm]?js$/.test(f) && readFileSync(new URL(f, api), "utf8").includes("TYPESAFE_API_KEY"));
  assert.deepEqual(readers, ["_ask_gate.js"]);
});

// ---- fix round 2: a caveat goes with the sentence it qualifies ------------------------------------------------------------------

// a topic's none for 20 to 21 Oct with 10 updates that can't be checked against it, a UK list gap on 21 Oct, and a quiet 21 Oct
const iranNone = {
  id: "C1", kind: "change", found: false, topic: { label: "Iran" }, checked_fleet: 0, checked_lobby: 0, unchecked: 10, from: "2026-10-20", to: "2026-10-21",
  label: "Updates involving Iran, 20 Oct 2026 to 21 Oct 2026: none", url: "/stories/updates/index.html?from=2026-10-20&to=2026-10-21&graph=all", quotes: [],
};
const ukGap = { id: "C2", kind: "gap", source: "The UK list", from: "2026-10-21", to: "2026-10-21", label: "The UK list unavailable on 21 Oct 2026", url: "/stories/updates/index.html?from=2026-10-21&to=2026-10-21&graph=fleet", quotes: [] };
const quiet = { id: "C3", kind: "change", found: false, from: "2026-10-21", to: "2026-10-21", label: "No changes on 21 Oct 2026", url: "/stories/updates/index.html?from=2026-10-21&to=2026-10-21&graph=all", quotes: [] };
const CEV = [iranNone, ukGap, quiet, doc];
const NONE = "None of the 0 updates recorded between 20 Oct 2026 and 21 Oct 2026 involve Iran.";
const UNCHECKED = "10 updates in that period can't be checked against Iran.";
const GAP = "The UK list was unavailable on 21 Oct 2026, so changes from it that day aren't recorded.";
const QUIET = "No changes were recorded on 21 Oct 2026.";
const UPDATES = "Any updates involving Iran in the last two days?";
const fromChanges = (sentences) => checkAnswer({ kind: "answer", sentences, next: [] }, CEV, { question: UPDATES, today: TODAY });
const drop = (...gone) => typesafe((t) => (gone.includes(t) ? 0 : 1));

test("a gate that drops only the UNCHECKED line still keeps it with its head: a caveat is never sent, and follows its head", async () => {
  const answer = fromChanges([{ claim: "none_matched", sources: ["C1"] }, quote]);
  assert.deepEqual(texts(answer), [NONE, UNCHECKED, GAP, FREEZE]);
  for (const gone of [[UNCHECKED], [UNCHECKED, GAP], [GAP]]) {
    const ts = drop(...gone);
    const out = await gate(UPDATES, answer, { fetch: ts.fetch, apiKey: KEY });
    assert.deepEqual(sent(ts), [NONE, FREEZE], gone.join(" | ")); // the head and the quote only
    assert.deepEqual(out, answer, gone.join(" | "));
  }
  // what reaches the reader is text and sources only: nothing says which sentence follows which
  assert.ok(answer.sentences.every((s) => Object.keys(s).join() === "text,sources"));
});

test("a gate that drops the head drops its followers too", async () => {
  const answer = fromChanges([{ claim: "none_matched", sources: ["C1"] }, quote]);
  const out = await gate(UPDATES, answer, { fetch: drop(NONE).fetch, apiKey: KEY });
  assert.deepEqual(out.sentences, [{ text: FREEZE, sources: [src(1, doc)] }]);
  assert.deepEqual(groundingProblems(UPDATES, CEV, out, TODAY), []);
  // alone, the none and its caveats go together: nothing answers
  const alone = await gate(UPDATES, fromChanges([{ claim: "none_matched", sources: ["C1"] }]), { fetch: drop(NONE).fetch, apiKey: KEY });
  assert.deepEqual(texts(alone), [NOTHING_ANSWERS]);
});

test("the same for a no-changes line and its gap, and a gap cited on its own stands on its own", async () => {
  const answer = fromChanges([{ claim: "change", sources: ["C3"] }, quote]);
  assert.deepEqual(texts(answer), [QUIET, GAP, FREEZE]);
  const ts = drop(GAP);
  assert.deepEqual(await gate(UPDATES, answer, { fetch: ts.fetch, apiKey: KEY }), answer); // the gap line follows its kept head
  assert.deepEqual(sent(ts), [QUIET, FREEZE]);
  const out = await gate(UPDATES, answer, { fetch: drop(QUIET).fetch, apiKey: KEY });
  assert.deepEqual(texts(out), [FREEZE]);
  assert.deepEqual(groundingProblems(UPDATES, CEV, out, TODAY), []);
  // the model cites the gap item too: the gap line is then a claim of its own, judged, and kept when the no-changes line is dropped
  const both = fromChanges([{ claim: "change", sources: ["C3", "C2"] }]);
  assert.deepEqual(texts(both), [QUIET, GAP]);
  const judged = drop(QUIET);
  const kept = await gate(UPDATES, both, { fetch: judged.fetch, apiKey: KEY });
  assert.deepEqual([sent(judged), texts(kept)], [[QUIET, GAP], [GAP]]);
  assert.deepEqual(groundingProblems(UPDATES, CEV, kept, TODAY), []);
  // and when only the gap is judged unrelated, it still follows the no-changes line it qualifies
  assert.deepEqual(texts(await gate(UPDATES, both, { fetch: drop(GAP).fetch, apiKey: KEY })), [QUIET, GAP]);
});

test("relaunch: an empty answer over a none is gated as the cited none is: the head is sent, and its caveats go with it", async () => {
  const empty = checkAnswer({ kind: "answer", sentences: [], next: [] }, [iranNone, ukGap], { question: UPDATES, today: TODAY });
  assert.deepEqual(texts(empty), [NONE, UNCHECKED, GAP]);
  const ts = drop(UNCHECKED, GAP);
  assert.deepEqual(await gate(UPDATES, empty, { fetch: ts.fetch, apiKey: KEY }), empty);
  assert.deepEqual(sent(ts), [NONE]);
  assert.deepEqual(texts(await gate(UPDATES, empty, { fetch: drop(NONE).fetch, apiKey: KEY })), [NOTHING_ANSWERS]);
});

test("the oracle flags a none without its caveats, a caveat without its none, and a no-changes line without its gap", () => {
  const line = (text, ...items) => ({ text, sources: items.map((e, i) => src(i + 1, e)) });
  const flagged = (...sentences) => groundingProblems(UPDATES, CEV, { kind: "answer", sentences, next: [] }, TODAY);
  // the checker's own answers pass
  for (const sentences of [[{ claim: "none_matched", sources: ["C1"] }], [{ claim: "change", sources: ["C3"] }], [{ claim: "change", sources: ["C2"] }]]) {
    assert.deepEqual(groundingProblems(UPDATES, CEV, fromChanges(sentences), TODAY), [], JSON.stringify(sentences));
  }
  assert.deepEqual(flagged(line(GAP, ukGap)), []); // a gap cited on its own needs no other line
  // a none without what it could not check, or without the gap of its range; what could not be checked without its none
  assert.ok(flagged(line(NONE, iranNone)).length > 0);
  assert.ok(flagged(line(NONE, iranNone), line(UNCHECKED, iranNone)).length > 0);
  assert.ok(flagged(line(NONE, iranNone), line(GAP, ukGap)).length > 0);
  assert.ok(flagged(line(UNCHECKED, iranNone)).length > 0);
  // a no-changes line without the gap of its day
  assert.ok(flagged(line(QUIET, quiet)).length > 0);
});

test("a malformed answer, or one the checker did not write, comes back unchanged with the fixed line and nothing sent", async () => {
  const made = built();
  const foreign = { kind: "answer", sentences: made.sentences.map((s) => ({ ...s })), next: [] }; // a copy: not the checker's own
  for (const answer of [foreign, { kind: "answer", sentences: [{ text: SHALAK }] }, { kind: "answer" }, null]) {
    capture();
    const ts = typesafe();
    assert.equal(await gate(QUESTION, answer, { fetch: ts.fetch, apiKey: KEY }), answer, JSON.stringify(answer)?.slice(0, 80));
    assert.deepEqual([ts.requests.length, logged], [0, [LINE]], JSON.stringify(answer)?.slice(0, 80));
    mock.restoreAll();
  }
});
