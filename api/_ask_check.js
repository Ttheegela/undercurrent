// Ask's answer renderer. The model writes no words: each sentence of its `answer` call is a claim type and evidence ids (S1, S2, …),
// and a `quote` names one item and the number of one of its quotes. This module writes every sentence itself: listing, not-found
// and change sentences from fixed copy and the cited items, quotes copied verbatim from the cited item. Anything it can't build is
// dropped, and an answer with nothing left is the fallback. Any `text` or label from the model is ignored. Pure, no I/O. The output
// is plain text plus {label, url} / {label, href} taken from the evidence: the panel escapes it.
import { LIST_LABELS, formatDate } from "../app/render.js";

// ---- fixed copy (global-constraints.md, verbatim; the range, OpenSanctions and clarify forms by ruling) --------------------

const REFUSAL = "I can only answer questions about what's on Undercurrent: sanctions lists, ship and company connections, lobbying, the semiconductor data, the research and the daily updates. I can't give legal or compliance advice.";
const FALLBACK = "I couldn't check an answer to that against the site's data, so I won't guess. Try the search on the home page.";
const CLARIFY = "Which of these did you mean?";
const day = (iso) => formatDate(iso) || iso; // d MMM yyyy; a bare year stays as it is
const NOT_FOUND = (name) => `${name} is not on the lists we check (US, UK, EU, UN, OpenSanctions). Not being found isn't proof.`;
const NO_CHANGES = (from, to) => `No changes were recorded between ${day(from)} and ${day(to)}.`;
const SOURCE_GAP = (g) => (g.date || g.from === g.to
  ? `${g.source} was unavailable on ${day(g.date ?? g.from)}, so changes from it that day aren't recorded.`
  : `${g.source} was unavailable from ${day(g.from)} to ${day(g.to)}, so changes from it on those days aren't recorded.`);
function LISTED(e) {
  const since = e.date ? ` since ${day(e.date)}` : "";
  return e.kind === "opensanctions"
    ? `${e.entity.name} appears in OpenSanctions${e.program ? ` as listed by ${e.program}` : ""}${since}.`
    : `${e.entity.name} appears on the ${LIST_LABELS[e.gov]} list${e.program ? ` under ${e.program}` : ""}${since}.`;
}

const only = (kind, text, next = []) => ({ kind, sentences: [{ text, sources: [] }], next });
const fallback = () => only("fallback", FALLBACK, [{ label: "Search", href: "/" }]);

// ---- rendering ---------------------------------------------------------------------------------------------------------

const listable = (e) => typeof e.entity?.name === "string" &&
  (e.kind === "opensanctions" || ((e.kind === "list" || e.kind === "research") && !e.delisted && Object.hasOwn(LIST_LABELS, e.gov ?? "")));

// The query is the model's own tool argument, so NOT_FOUND names it only when the reader typed it: its words, whole and in order,
// in the reader's question (case, spacing and punctuation aside). "SSOS" is not in "Is TASSOS sanctioned?".
const words = (s) => (typeof s === "string" ? ` ${s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim()} ` : "  ");
const typed = (query, question) => words(query) !== "  " && words(question).includes(words(query));

// Each returns the sentences to show as [{text, items}], [] to drop the sentence, or null to give the fallback for the whole answer.
const RENDER = {
  listed: (items) => (items.every(listable) ? items.map((e) => ({ text: LISTED(e), items: [e] })) : null),
  not_found: (items, s, all, ctx) => {
    const searches = items.filter((e) => e.kind === "search");
    if (!searches.length || !searches.every((e) => e.found === false)) return null;
    return searches.filter((e) => typed(e.query, ctx.question)).map((e) => ({ text: NOT_FOUND(e.query.replace(/\s+/g, " ").trim()), items: [e] }));
  },
  // "No changes" only from the change record's own item, followed by every gap of its range; never from an empty list
  change: (items, s, all) => (items.every((e) => e.kind === "change" || e.kind === "gap")
    ? items.flatMap((e) => (e.kind === "gap" ? [{ text: SOURCE_GAP(e), items: [e] }]
      : e.found === false ? [{ text: NO_CHANGES(e.from, e.to), items: [e] }, ...all.filter((g) => g.kind === "gap" && g.from <= e.to && g.to >= e.from).map((g) => ({ text: SOURCE_GAP(g), items: [g] }))]
        : [{ text: `${e.summary} · ${day(e.date)}`, items: [e] }]))
    : null),
  // one sentence of one item, verbatim
  quote: (items, s) => {
    const q = items.length === 1 && Number.isInteger(s.quote) && Array.isArray(items[0].quotes) ? items[0].quotes[s.quote] : undefined;
    return typeof q === "string" ? [{ text: q, items }] : [];
  },
};

const unique = (list, key) => list.filter((x, i) => list.findIndex((y) => y[key] === x[key]) === i);
const choice = (name) => ({ label: name, href: `/?q=${encodeURIComponent(name)}` });

/** The cited items, or null when a sentence cites nothing or an id that is not evidence. */
function cite(ids, byId) {
  if (!Array.isArray(ids) || !ids.length) return null;
  const items = [...new Set(ids)].map((id) => byId.get(id));
  return items.every(Boolean) ? items : null;
}

/** Numbers the sources in order of first citation; one sentence written twice becomes one sentence with both sources. */
function finish(kind, pieces, next) {
  const n = new Map();
  const byText = new Map();
  for (const { text, items } of pieces) {
    if (!byText.has(text)) byText.set(text, { text, sources: [] });
    const { sources } = byText.get(text);
    for (const e of items) {
      if (!n.has(e.id)) n.set(e.id, n.size + 1);
      if (!sources.some((x) => x.n === n.get(e.id))) sources.push({ n: n.get(e.id), label: e.label, url: e.url });
    }
  }
  return byText.size ? { kind, sentences: [...byText.values()], next } : fallback();
}

/** The fixed question, with the near names of the cited searches and the cited entities as the choices. */
function clarify(items) {
  const options = unique(items.flatMap((e) => (e.kind === "search" ? (e.near ?? []).map(choice)
    : e.entity?.name && (e.link || e.url) ? [{ label: e.entity.name, href: e.link || e.url }] : [])), "label");
  return options.length ? finish("clarify", [{ text: CLARIFY, items: [] }], options) : fallback();
}

/**
 * raw: the model's `answer` arguments {kind, refusal_reason?, sentences: [{claim, sources, quote?}], next: [{source}]};
 * ev: the evidence of this question; ctx.question: the reader's latest message (NOT_FOUND names a query only when it is there).
 * Returns {kind: "answer"|"refusal"|"clarify"|"fallback", sentences: [{text, sources: [{n, label, url}]}], next: [{label, href}]}.
 */
export function checkAnswer(raw, ev, ctx) {
  if (raw?.kind === "refusal") return only("refusal", REFUSAL);
  if (raw?.kind !== "answer" && raw?.kind !== "clarify") return fallback();
  const byId = new Map((Array.isArray(ev) ? ev : []).map((e) => [e.id, e]));
  const said = (Array.isArray(raw.sentences) ? raw.sentences : []).filter((s) => s !== null && typeof s === "object");
  const linked = (Array.isArray(raw.next) ? raw.next : []).map((x) => byId.get(x?.source)).filter(Boolean);
  const cited = said.flatMap((s) => {
    const items = cite(s.sources, byId);
    return items ? [{ s, items }] : [];
  });
  if (raw.kind === "clarify") return clarify([...cited.flatMap((c) => c.items), ...linked]);

  // "not on the lists" is never said while a close spelling exists: ask which one was meant
  const near = cited.filter(({ s }) => s.claim === "not_found").flatMap(({ items }) => items).filter((e) => e.kind === "search" && e.found === false && e.near?.length);
  if (near.length) return finish("clarify", [{ text: CLARIFY, items: [] }], unique(near.flatMap((e) => e.near.map(choice)), "label"));

  const all = [...byId.values()];
  const pieces = [];
  for (const { s, items } of cited) {
    const shown = typeof s.claim === "string" && Object.hasOwn(RENDER, s.claim) ? RENDER[s.claim](items, s, all, ctx ?? {}) : [];
    if (!shown) return fallback();
    pieces.push(...shown);
  }
  // a next step is the cited item's own label and link (or url)
  const next = unique(linked.filter((e) => e.link || e.url).map((e) => ({ label: e.label, href: e.link || e.url })), "href");
  return finish("answer", pieces, next);
}
