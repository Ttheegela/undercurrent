#!/usr/bin/env node
// Runs the evaluation set against a deployed Ask: posts each live case's question to <base>/api/ask, one at a time, and checks the
// answer against the case's `expect` (its kind, and the phrases it must not contain; the model's choices vary, so nothing else).
// Every question calls the real model on the site's own budget. The script needs no key and reads none: the endpoint is public and
// is called the way the site's own panel calls it.
import { readFileSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

const PER_HOUR = 20; // the endpoint's per-visitor limit (api/ask.js)
const PAUSE_MS = 1500;
const TIMEOUT_MS = 40_000; // the endpoint gives up at 26 s

const USAGE = `Usage:
  node scripts/ask-live-eval.mjs --base <url> [--only <id,id,...>] [--limit-check]
  node scripts/ask-live-eval.mjs [--base <url>] --dry-run [--only <id,id,...>]
  node scripts/ask-live-eval.mjs --help

Posts the live questions of tests/ask-eval.json to <url>/api/ask (Origin: <url>), one at a time with a ${PAUSE_MS / 1000} s pause, and prints each
answer's kind, text, sources and time. Then it prints PASS or FAIL per case (kind and excluded phrases only), the p50 and p90 time,
and exits 1 if any case failed or was not run.

  --base <url>     the deployed site, e.g. https://undercurrent-research.vercel.app
  --only <ids>     run just these cases (comma separated); offline-only cases are refused
  --dry-run        print the plan and post nothing
  --limit-check    also report how many answers were FALLBACK, a quality signal for the quote-only design
  --help           this text

The endpoint allows ${PER_HOUR} questions per visitor per rolling hour, so start a full run in a fresh hour (no other questions from
this address in the last hour), and run anything beyond ${PER_HOUR} questions in batches an hour apart with --only. A 429 stops the run.
Each question spends a little of the model budget (typically well under a cent).`;

function usage(message) {
  if (message) console.error(`${message}\n`);
  console.error(USAGE);
  process.exit(2);
}

// ---- arguments -----------------------------------------------------------------------------------------------------------

const opt = { base: null, only: null, dry: false, limit: false };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--help" || a === "-h") {
    console.log(USAGE);
    process.exit(0);
  } else if (a === "--dry-run") opt.dry = true;
  else if (a === "--limit-check") opt.limit = true;
  else if (a === "--base" || a === "--only") {
    const v = argv[++i];
    if (!v || v.startsWith("--")) usage(`${a} needs a value`);
    opt[a.slice(2)] = v;
  } else usage(`Unknown argument: ${a}`);
}

let origin = null;
if (opt.base) {
  try {
    const u = new URL(opt.base);
    if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("scheme");
    origin = u.origin;
  } catch {
    usage(`--base is not a web address: ${opt.base}`);
  }
} else if (!opt.dry) usage("--base is required");

const all = JSON.parse(readFileSync(new URL("../tests/ask-eval.json", import.meta.url), "utf8"));
let cases = all.filter((c) => c.live !== false);
if (opt.only) {
  const wanted = opt.only.split(",").map((s) => s.trim()).filter(Boolean);
  for (const id of wanted) {
    const c = all.find((x) => x.id === id);
    if (!c) usage(`No such case: ${id}`);
    if (c.live === false) usage(`${id} is offline-only: its model answer is hand-written, so there is nothing to post`);
  }
  cases = cases.filter((c) => wanted.includes(c.id));
}
if (!cases.length) usage("No cases to run");

console.log(`Ask live evaluation: ${cases.length} question${cases.length === 1 ? "" : "s"}${origin ? ` against ${origin}` : ""}`);
console.log(`The endpoint allows ${PER_HOUR} questions per visitor per rolling hour: start in a fresh hour.`);
if (cases.length > PER_HOUR) {
  console.log(`${cases.length} is more than ${PER_HOUR}, so the ${PER_HOUR + 1}th would be answered 429. Run these in batches an hour apart:`);
  for (let i = 0; i < cases.length; i += PER_HOUR) console.log(`  --only ${cases.slice(i, i + PER_HOUR).map((c) => c.id).join(",")}`);
}

const expected = (c) => `${c.expect.kind}${c.expect.fallback ? " (or fallback)" : ""}`;
if (opt.dry) {
  cases.forEach((c, i) => console.log(`${String(i + 1).padStart(2)}. ${c.id}  [${c.category}]  expects ${expected(c)}  ${JSON.stringify(c.question)}`));
  console.log("\nDry run: nothing was posted.");
  process.exit(0);
}

// ---- running -----------------------------------------------------------------------------------------------------------------

/** Posts one question; {ms, status, body} or {ms, error}. */
async function post(question) {
  const t0 = performance.now();
  try {
    const res = await fetch(`${origin}/api/ask`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: origin },
      body: JSON.stringify({ messages: [{ role: "user", text: question }] }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    return { ms: Math.round(performance.now() - t0), status: res.status, body: await res.json().catch(() => null) };
  } catch (err) {
    return { ms: Math.round(performance.now() - t0), error: err?.name === "TimeoutError" ? `no reply within ${TIMEOUT_MS / 1000} s` : "the request failed" };
  }
}

/** What the reader would get: the answer's kind, sentences and numbered sources, or why there was none. */
function read({ status, body, error }) {
  const a = status === 200 && body?.ok === true ? body.answer : null;
  if (a && typeof a.kind === "string" && Array.isArray(a.sentences)) {
    const sources = new Map(a.sentences.flatMap((s) => s.sources ?? []).map((s) => [s.n, s]));
    return { kind: a.kind, sentences: a.sentences.map((s) => String(s.text)), sources: [...sources.values()].sort((x, y) => x.n - y.n) };
  }
  const why = error ?? (typeof body?.reason === "string" ? `${body.reason}${body.resets ? ` until ${body.resets}` : ""}` : `HTTP ${status}`);
  return { kind: error ? "error" : (typeof body?.reason === "string" ? body.reason : `http ${status}`), sentences: [], sources: [], why };
}

const results = [];
let stopped = null;
for (const [i, c] of cases.entries()) {
  if (i) await sleep(PAUSE_MS);
  const raw = await post(c.question);
  const r = read(raw);
  const text = r.sentences.join("\n");
  const found = (c.expect.excludes ?? []).filter((s) => text.toLowerCase().includes(s.toLowerCase()));
  const problems = [];
  if (r.kind !== c.expect.kind && !(r.kind === "fallback" && c.expect.fallback === true)) problems.push(`expected ${expected(c)}, got ${r.kind}${r.why ? ` (${r.why})` : ""}`);
  for (const s of found) problems.push(`the text contains ${JSON.stringify(s)}`);
  results.push({ c, r, ms: raw.ms, problems });

  console.log(`\n[${i + 1}/${cases.length}] ${c.id}  (${c.category})  ${raw.ms} ms`);
  console.log(`  Q: ${c.question}`);
  console.log(`  kind: ${r.kind}${r.why ? ` (${r.why})` : ""}`);
  if (text) console.log(`  text: ${r.sentences.join("\n        ")}`);
  if (r.sources.length) console.log(`  sources: ${r.sources.map((s) => `[${s.n}] ${s.label} (${s.url})`).join("; ")}`);
  console.log(problems.length ? `  FAIL: ${problems.join("; ")}` : "  PASS");
  if (raw.status === 429) {
    stopped = `Stopped at 429: the ${PER_HOUR}-an-hour limit is spent for this address. Wait for a fresh hour and run the rest with --only.`;
    break;
  }
}

// ---- summary ---------------------------------------------------------------------------------------------------------------------

const failed = results.filter((x) => x.problems.length);
const notRun = cases.slice(results.length);
const times = results.map((x) => x.ms).sort((a, b) => a - b);
const percentile = (p) => times[Math.max(0, Math.ceil(p * times.length) - 1)];
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed, ${notRun.length} not run, of ${cases.length}.`);
if (failed.length) console.log(`Failed: ${failed.map((x) => x.c.id).join(", ")}`);
if (notRun.length) console.log(`Not run: ${notRun.map((c) => c.id).join(", ")}`);
if (stopped) console.log(stopped);
if (times.length) console.log(`Latency over ${times.length} answers: p50 ${percentile(0.5)} ms, p90 ${percentile(0.9)} ms.`);
if (opt.limit) {
  const fb = results.filter((x) => x.r.kind === "fallback");
  const unexpected = fb.filter((x) => x.c.expect.kind !== "fallback" && x.c.expect.fallback !== true);
  console.log(`FALLBACK answers: ${fb.length} of ${results.length}${fb.length ? ` (${fb.length - unexpected.length} expected or allowed${unexpected.length ? `; unexpected: ${unexpected.map((x) => x.c.id).join(", ")}` : ""})` : ""}.`);
  console.log("An unexpected FALLBACK is a question the model could not answer from sentences the checker can write; many of them means the quote-only design is too tight.");
}
process.exit(failed.length || notRun.length ? 1 : 0);
