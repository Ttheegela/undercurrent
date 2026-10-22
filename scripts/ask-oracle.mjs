// The grounding check shared by the offline eval (tests/ask-eval.test.js) and the real-model runner: every sentence an answer carries is
// fixed copy, a claim the server writes from an evidence item, or a verbatim quote of one, and has its source. The fixed copy below is
// written out here by hand, not imported from api/, so a change to the server's wording is caught rather than followed.
import { isDeepStrictEqual } from "node:util";
import { LIST_LABELS, formatDate } from "../app/render.js";

export const REFUSAL = "I can only answer questions about what's on Undercurrent: sanctions lists, ship and company connections, lobbying, the semiconductor data, the research and the daily updates. I can't give legal or compliance advice.";
export const FALLBACK = "I couldn't check an answer to that against the site's data, so I won't guess. Try the search on the home page.";
export const CLARIFY = "Which of these did you mean?";
export const PARTIAL = "I could only answer part of the question. Ask about each name on its own to check the rest.";
export const NOT_ADVICE = "Ask can't give legal or compliance advice. These are records from the site, each with its source.";
const FIXED = new Set([REFUSAL, FALLBACK, CLARIFY, PARTIAL, NOT_ADVICE]); // fixed copy: written by the server, so it has no source
const NOT_FOUND = /^(.+) is not on the lists we check \(US, UK, EU, UN, OpenSanctions\)\. Not being found isn't proof\.$/;

const day = (iso) => formatDate(iso) || iso;
const clean = (s) => s.normalize("NFKC").replace(/[\p{Cf}\p{M}\uFEFF]/gu, "").replace(/\s+/g, " ").toLowerCase();
const SHOWING = (n, total) => `Showing ${n.toLocaleString("en-GB")} of ${total.toLocaleString("en-GB")}.`; // written by the server, no source
const NOTE = { first_seen_opensanctions: " (first seen on the list via OpenSanctions)", uk_transfer: " (the UK list's transfer date; the listing may be older)" };
const plural = (n, word) => (n ? [`${n} ${word}${n === 1 ? "" : "s"}`] : []);

/** The age of a dated list or research listing on `today`, or the undated copy; null for no age (a future date, or one without its day). */
function age(e, today) {
  const on = `the ${LIST_LABELS[e.gov]} list${e.program ? ` under ${e.program}` : ""}`;
  if (!e.date) return `The ${LIST_LABELS[e.gov]} list gives no listing date for ${e.entity.name.replace(/\.$/, "")}.`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date) || e.date > today) return null;
  // the whole months: the date moved on k months (to the month's last day when it has no such day) is still on or before today
  const [y, m, d] = e.date.split("-").map(Number);
  const after = (k) => new Date(Date.UTC(y, m - 1 + k, Math.min(d, new Date(Date.UTC(y, m + k, 0)).getUTCDate()))).toISOString().slice(0, 10);
  let k = 0;
  while (after(k + 1) <= today) k++;
  const span = k ? [...plural(Math.floor(k / 12), "year"), ...plural(k % 12, "month")] : plural((Date.parse(today) - Date.parse(e.date)) / 864e5, "day");
  const note = Object.hasOwn(NOTE, e.date_basis) ? NOTE[e.date_basis] : "";
  return span.length ? `${e.entity.name} has been on ${on} for ${span.join(" ")} (since ${day(e.date)})${note}.` : `${e.entity.name} was added to ${on} today${note}.`;
}

/**
 * Every sentence the checker may write for this evidence on `today`, from its fixed copy and the evidence alone, and which items can
 * have produced it: text -> Set of evidence items. A quote comes from the items that hold it, a claim from the items it is built from.
 */
function producers(ev, today) {
  const made = new Map();
  const add = (text, e) => made.set(text, (made.get(text) ?? new Set()).add(e));
  for (const e of ev) {
    for (const q of e.quotes) add(q, e);
    const since = e.date ? ` since ${day(e.date)}` : "";
    if (e.kind === "opensanctions") add(`${e.entity.name} appears in OpenSanctions${e.program ? ` as listed by ${e.program}` : ""}${since}.`, e);
    if ((e.kind === "list" || e.kind === "research") && e.gov && !e.delisted) {
      add(`${e.entity.name} appears on the ${LIST_LABELS[e.gov]} list${e.program ? ` under ${e.program}` : ""}${since}.`, e);
      if (age(e, today)) add(age(e, today), e);
    }
    if (e.kind === "change" && e.before_start) add(`Daily updates started on ${day(e.first_run)}, so there is no record before then.`, e);
    else if (e.kind === "change" && e.trimmed) add(`Days before ${day(e.started)} are no longer kept.`, e);
    else if (e.kind === "change" && e.not_yet) add("Today's nightly update hasn't run yet.", e);
    else if (e.kind === "change" && e.found === false) add(e.from === e.to ? `No changes were recorded on ${day(e.from)}.` : `No changes were recorded between ${day(e.from)} and ${day(e.to)}.`, e);
    else if (e.kind === "change") add(`${e.summary} · ${day(e.date)}`, e);
    if (e.kind === "gap") {
      add(e.date || e.from === e.to
        ? `${e.source} was unavailable on ${day(e.date ?? e.from)}, so changes from it that day aren't recorded.`
        : `${e.source} was unavailable from ${day(e.from)} to ${day(e.to)}, so changes from it on those days aren't recorded.`, e);
    }
  }
  return made;
}

/**
 * What is wrong with `answer` (the checker's output for `question` and the evidence `ev`, on `today` in UTC, which ages are counted to):
 * no sentence the model chose the words of, and every sentence with its source. An empty array means the answer is grounded.
 */
export function groundingProblems(question, ev, answer, today = new Date().toISOString().slice(0, 10)) {
  const problems = [];
  const ok = (cond, message) => { if (!cond) problems.push(message); };
  const made = producers(ev, today);
  // "Showing N of M." for a search of M matches when the answer's sources are N of them (distinct entities), fewer than all; the same
  // search run twice (one query) is one search
  const cites = new Set(answer.sentences.flatMap((s) => s.sources.map((x) => `${x.label}\n${x.url}`)));
  const searches = new Map();
  for (const r of ev.filter((x) => Number.isInteger(x.total))) {
    const key = `${r.kind}:${r.query ?? r.id}`;
    searches.set(key, { total: r.total, ids: (searches.get(key)?.ids ?? new Set()).add(r.id) });
  }
  const showing = new Set([...searches.values()].flatMap(({ total, ids }) => {
    const n = new Set(ev.filter((e) => ids.has(e.result) && cites.has(`${e.label}\n${e.url}`)).map((e) => e.entity?.id ?? e.id)).size;
    return n && n < total ? [SHOWING(n, total)] : [];
  }));
  const labelled = (items, src) => [...items].some((e) => e.label === src.label && e.url === src.url);
  for (const s of answer.sentences) {
    if (FIXED.has(s.text) || showing.has(s.text)) {
      ok(isDeepStrictEqual(s.sources, []), `fixed copy has no source: ${s.text.slice(0, 60)}`);
      continue;
    }
    let from = made.get(s.text);
    const name = NOT_FOUND.exec(s.text)?.[1];
    if (name !== undefined) {
      // the one sentence built from a typed word: the reader's own plain-ASCII span, never the model's query; from a search that found nothing
      ok(/^[A-Za-z0-9 .,&'-]+$/.test(name), "not-found name is not plain ASCII");
      ok(clean(question).includes(clean(name)), `"${name}" is not in the question`);
      from = ev.filter((e) => e.kind === "search" && e.found === false);
    }
    if (!from) {
      problems.push(`not fixed copy, a server claim or a quote: ${JSON.stringify(s.text).slice(0, 140)}`);
      continue;
    }
    // every other sentence names the evidence it was built from, and only that evidence: a quote its own item, a claim its items
    ok(s.sources.length >= 1, `no source: ${JSON.stringify(s.text).slice(0, 100)}`);
    for (const src of s.sources) ok(labelled(from, src), `"${src.label}" did not produce ${JSON.stringify(s.text).slice(0, 100)}`);
  }
  // the part-answer line and the notice come last (the notice after the line), once each, and only after something else
  const texts = answer.sentences.map((s) => s.text);
  const tail = texts.filter((t) => t === PARTIAL || t === NOT_ADVICE);
  ok(isDeepStrictEqual(texts.slice(texts.length - tail.length), tail), "the closing lines are not last");
  ok(tail.length === new Set(tail).size && (tail.length < 2 || tail[0] === PARTIAL), `${tail.length} closing lines, out of order`);
  if (tail.length) ok(texts.length > tail.length || texts[0] === CLARIFY, "a closing line alone");
  // sources are numbered 1, 2, … in order of first citation
  const numbered = new Map();
  for (const s of answer.sentences) for (const src of s.sources) numbered.set(src.n, src.label);
  ok(isDeepStrictEqual([...numbered.keys()].sort((a, b) => a - b), [...numbered.keys()].map((_, i) => i + 1)), "source numbers");
  // next steps: the home-page search, an evidence item's label and link, or a near name's search
  const near = ev.flatMap((e) => e.near ?? []);
  for (const n of answer.next) {
    const own = ev.some((e) => (n.label === e.label || n.label === e.entity?.name) && n.href === (e.link || e.url));
    const search = (n.label === "Search" && n.href === "/") || (near.includes(n.label) && n.href === `/?q=${encodeURIComponent(n.label)}`);
    ok(own || search, `next step ${JSON.stringify(n)}`);
  }
  return problems;
}
