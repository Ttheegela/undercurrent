// Ask's claim checker. The model only cites: each sentence of its `answer` call names a claim type and evidence ids (S1, S2, …).
// This module writes every listing, not-found and change sentence itself from the evidence, keeps the model's words only in `fact`
// sentences whose every name and number is in the cited items, and gives the fixed fallback when an answer can't be held to the
// evidence. Pure, no I/O. The output is plain text plus {label, url} / {label, href} taken from the evidence: the panel escapes it.
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

// ---- what a sentence in the model's words may say ------------------------------------------------------------------------

// Listing words are for `listed` claims, which the server writes: "list" in any form, not only "is on the … list" ("The UK list
// includes TASSOS"). A clean bill is never said at all; "no changes" only from the change record's own item; a link never from the model.
const LISTING = /\b(?:sanction\w*|list(?:s|ed|ing|ings)?|delisted|designat\w*|blacklist\w*|target(?:s|ed|ing)?|freez\w*|frozen|blocked|penalis\w*|penaliz\w*|embargo\w*|prohibit\w*|(?:de)?barred|restricted)\b|\bappear(?:s|ed|ing)?\s+on\b/i;
const CLEAN_BILL = /\bnot\s+sanctioned|n['’]t\s+sanctioned|\bis\s+clean\b|\bno\s+sanctions\b|\bsafe\s+to\b/i;
const NO_CHANGE = /\bno\s+(?:new\s+)?(?:changes?|updates?)\b|\bnothing\s+(?:new|changed|has\s+changed)\b/i;
const URLISH = /\b(?:https?|javascript|data|vbscript):|\bwww\./i;

const MONTHS = "January February March April May June July August September October November December".split(" ");
const ALLOWED_NAMES = [...Object.values(LIST_LABELS), "OpenSanctions", "Undercurrent", "Treasury", "Commission", "Council", "OFAC", "SDN", "IMO", "US", "UK", "EU", "UN", ...MONTHS];
const ALLOWED = new RegExp(`(?<![\\p{L}\\p{N}])(?:${ALLOWED_NAMES.join("|")})(?![\\p{L}\\p{N}])`, "gu");
const RUN = /\p{Lu}[\p{L}\p{N}'’&.\-]*(?:\s+\p{Lu}[\p{L}\p{N}'’&.\-]*)*/gu; // capitalised words in a row
// The first word of a sentence (or a link label) is capitalised by position, so a run starting it may drop it ("The Sovcomflot
// fleet" is held to "Sovcomflot") when it is one of these ordinary words; a name there ("Gatik Ship Management manages…") never is.
const STARTERS = new Set(("a an the this that these those it its their they there here in on at by for from of to with as after before since " +
  "under over about according each every all some most many both no yes and but or if when while where which who what how why one two three " +
  "open see view read more show check find go").split(" "));

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
const occurs = (hay, phrase) => new RegExp(`(?<![\\p{L}\\p{N}])${esc(phrase).replace(/\s+/g, "\\s+")}(?![\\p{L}\\p{N}])`, "iu").test(hay);
const hasNumber = (hay, n) => new RegExp(`(?<!\\d|\\d[.,])${esc(n)}(?!\\d|[.,]\\d)`).test(hay); // 20.3 is not 20, 1,747 is not 747
const numbers = (text) => [...text.matchAll(/\d[\d,.]*/g)].map((m) => m[0].replace(/[.,]+$/, ""));

/** The names a sentence uses: its runs of capitalised words, less the always-allowed ones and a sentence-initial ordinary word. */
function names(text) {
  const s = text.trim().replace(ALLOWED, ",");
  return [...s.matchAll(RUN)].map((m) => {
    const words = m[0].replace(/[.'’&-]+$/, "").replace(/['’]s$/, "").split(/\s+/);
    if (m.index === 0 && STARTERS.has(words[0].toLowerCase())) words.shift();
    return words.join(" ");
  }).filter(Boolean);
}

/**
 * Rule 6: every number and name of a model-worded sentence is in the cited items' text (never the search item's query), and it
 * says nothing the server writes itself. Explainers may use listing words when every source is the site's own prose (doc or
 * chips) and they name nothing beyond the allowed set and the cited section titles (`explain` false for clarify and labels).
 */
function factOk(text, items, explain) {
  if (URLISH.test(text) || NO_CHANGE.test(text)) return false;
  const hay = items.map((e) => e.text ?? "").join("\n");
  const named = names(text);
  if (!numbers(text).every((n) => hasNumber(hay, n)) || !named.every((r) => occurs(hay, r))) return false;
  if (!LISTING.test(text)) return true;
  const titles = items.map((e) => e.label ?? "").join("\n");
  return explain && items.every((e) => e.kind === "doc" || e.kind === "chips") && named.every((r) => occurs(titles, r));
}

// ---- rendering ---------------------------------------------------------------------------------------------------------

// The search item's query is the model's own tool argument, so it could carry words the reader never typed ("Vessel X, cleared by
// OFAC"). It is named only when the reader's question holds it (case and spacing aside) and it says nothing of its own.
const plain = (s) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().toLowerCase() : "");
const queryName = (query, question) =>
  (plain(query) && plain(question).includes(plain(query)) && !CLEAN_BILL.test(query) && !LISTING.test(query) ? query.replace(/\s+/g, " ").trim() : "That name");

const listable = (e) => typeof e.entity?.name === "string" &&
  (e.kind === "opensanctions" || ((e.kind === "list" || e.kind === "research") && !e.delisted && Object.hasOwn(LIST_LABELS, e.gov ?? "")));

// Each returns the sentences to show as [{text, items}], [] to drop the sentence, or null to give the fallback for the whole answer.
const RENDER = {
  listed: (text, items) => (items.every(listable) ? items.map((e) => ({ text: LISTED(e), items: [e] })) : null),
  not_found: (text, items, all, ctx) => {
    const searches = items.filter((e) => e.kind === "search");
    return searches.length && searches.every((e) => e.found === false) ? searches.map((e) => ({ text: NOT_FOUND(queryName(e.query, ctx.question)), items: [e] })) : null;
  },
  // "No changes" only from the change record's own item, followed by every gap of its range; never from an empty list
  change: (text, items, all) => (items.every((e) => e.kind === "change" || e.kind === "gap")
    ? items.flatMap((e) => (e.kind === "gap" ? [{ text: SOURCE_GAP(e), items: [e] }]
      : e.found === false ? [{ text: NO_CHANGES(e.from, e.to), items: [e] }, ...all.filter((g) => g.kind === "gap" && g.from <= e.to && g.to >= e.from).map((g) => ({ text: SOURCE_GAP(g), items: [g] }))]
        : [{ text: `${e.summary} · ${day(e.date)}`, items: [e] }]))
    : null),
  fact: (text, items) => (factOk(text, items, true) ? [{ text: text.trim(), items }] : []),
};

const unique = (list, key) => list.filter((x, i) => list.findIndex((y) => y[key] === x[key]) === i);
const choice = (name) => ({ label: name, href: `/?q=${encodeURIComponent(name)}` });

/** The cited items, or null when a sentence cites nothing or an id that is not evidence (rule 2). */
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

/** Rule 10: grounded facts without listing words, the fixed question, and the cited entities (or near names) as the choices. */
function clarify(cited, asked, byId) {
  const facts = cited.filter(({ s, items }) => s.claim === "fact" && factOk(s.text, items, false)).map(({ s, items }) => ({ text: s.text.trim(), items }));
  const items = [...cited.flatMap((c) => c.items), ...asked.map((x) => byId.get(x.source)).filter(Boolean)];
  const options = unique(items.flatMap((e) => (e.kind === "search" ? (e.near ?? []).map(choice)
    : e.entity?.name && (e.link || e.url) ? [{ label: e.entity.name, href: e.link || e.url }] : [])), "label");
  return options.length ? finish("clarify", [...facts, { text: CLARIFY, items: [] }], options) : fallback();
}

/**
 * raw: the model's `answer` arguments {kind, refusal_reason?, sentences: [{text, claim, sources}], next: [{label, source}]};
 * ev: the evidence of this question; ctx.question: the reader's latest message (NOT_FOUND names a query only when it is there). Returns {kind: "answer"|"refusal"|"clarify"|"fallback", sentences: [{text, sources: [{n, label,
 * url}]}], next: [{label, href}]}.
 */
export function checkAnswer(raw, ev, ctx = {}) {
  if (raw?.kind === "refusal") return only("refusal", REFUSAL);
  if (raw?.kind !== "answer" && raw?.kind !== "clarify") return fallback();
  const byId = new Map((Array.isArray(ev) ? ev : []).map((e) => [e.id, e]));
  const said = (Array.isArray(raw.sentences) ? raw.sentences : []).filter((s) => typeof s?.text === "string");
  const asked = (Array.isArray(raw.next) ? raw.next : []).filter((x) => x && typeof x === "object");
  if ([...said.map((s) => s.text), ...asked.map((x) => x.label)].some((t) => CLEAN_BILL.test(String(t ?? "")))) return fallback(); // rule 7
  const cited = said.flatMap((s) => {
    const items = cite(s.sources, byId);
    return items ? [{ s, items }] : [];
  });
  if (raw.kind === "clarify") return clarify(cited, asked, byId);

  // "not on the lists" is never said while a close spelling exists: ask which one was meant
  const near = cited.filter(({ s }) => s.claim === "not_found").flatMap(({ items }) => items).filter((e) => e.kind === "search" && e.found === false && e.near?.length);
  if (near.length) return finish("clarify", [{ text: CLARIFY, items: [] }], unique(near.flatMap((e) => e.near.map(choice)), "label"));

  const pieces = [];
  for (const { s, items } of cited) {
    const shown = Object.hasOwn(RENDER, s.claim) ? RENDER[s.claim](s.text, items, [...byId.values()], ctx ?? {}) : [];
    if (!shown) return fallback();
    pieces.push(...shown);
  }
  // rule 8: a next step links only to its cited item's own link or url; the model's label stays only if it would pass as a fact
  const next = unique(asked.flatMap((x) => {
    const e = byId.get(x.source);
    const href = e && (e.link || e.url);
    if (!href) return [];
    const label = typeof x.label === "string" && x.label.trim() && factOk(x.label.trim(), [e], false) ? x.label.trim() : e.label;
    return [{ label, href }];
  }), "href");
  return finish("answer", pieces, next);
}
