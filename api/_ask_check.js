// Ask's answer renderer. The model writes no words: each sentence of its `answer` call is a claim type and evidence ids (S1, S2, …),
// and a `quote` names one item and the number of one of its quotes. This module writes every sentence itself: listing, not-found
// and change sentences from fixed copy and the cited items, quotes copied verbatim from the cited item. Anything it can't build is
// dropped, and an answer with nothing left is the fallback. Any `text` or label from the model is ignored. No I/O beyond the site's
// own prose vocabulary, read once. The output is plain text plus {label, url} / {label, href} taken from the evidence: the panel escapes it.
import { LIST_LABELS, formatDate } from "../app/render.js";
import { siteVocabulary } from "./_ask_tools.js";

// ---- fixed copy (global-constraints.md, verbatim; the range, one-day, OpenSanctions, clarify, before-start, part-answer and not-advice forms by ruling) -------

const REFUSAL = "I can only answer questions about what's on Undercurrent: sanctions lists, ship and company connections, lobbying, the semiconductor data, the research and the daily updates. I can't give legal or compliance advice.";
const FALLBACK = "I couldn't check an answer to that against the site's data, so I won't guess. Try the search on the home page.";
const CLARIFY = "Which of these did you mean?";
const day = (iso) => formatDate(iso) || iso; // d MMM yyyy; a bare year stays as it is
const NOT_FOUND = (name) => `${name} is not on the lists we check (US, UK, EU, UN, OpenSanctions). Not being found isn't proof.`;
const NO_CHANGES = (from, to) => (from === to ? `No changes were recorded on ${day(from)}.` : `No changes were recorded between ${day(from)} and ${day(to)}.`);
const PARTIAL = "I could only answer part of the question. Ask about each name on its own to check the rest.";
const NOT_ADVICE = "Ask can't give legal or compliance advice. These are records from the site, each with its source.";
const BEFORE_START = (first) => `Daily updates started on ${day(first)}, so there is no record before then.`;
const SOURCE_GAP = (g) => (g.date || g.from === g.to
  ? `${g.source} was unavailable on ${day(g.date ?? g.from)}, so changes from it that day aren't recorded.`
  : `${g.source} was unavailable from ${day(g.from)} to ${day(g.to)}, so changes from it on those days aren't recorded.`);
function LISTED(e) {
  const since = e.date ? ` since ${day(e.date)}` : "";
  return e.kind === "opensanctions"
    ? `${e.entity.name} appears in OpenSanctions${e.program ? ` as listed by ${e.program}` : ""}${since}.`
    : `${e.entity.name} appears on the ${LIST_LABELS[e.gov]} list${e.program ? ` under ${e.program}` : ""}${since}.`;
}

// ---- the notice on advice-shaped questions -----------------------------------------------------------------------------------
// Ask cannot give advice: no model word is ever shown, only records and their sources. A question that asks for it ("Should I buy oil
// from this ship?") still gets the model's answer, and that answer ends with NOT_ADVICE so the records are not read as a verdict. The
// net is wide on purpose (a notice on an ordinary question does no harm): a modal or advice word, or a rating word such as legal, safe or
// wise, within eight words of a business verb. Letters are folded first: width forms, format characters (as a gap and as nothing),
// look-alike Cyrillic letters and spaced-out letters ("S h o u l d").
const CUES = new Set(("should can could would may might must shall need needs allowed permitted legal illegal lawful safe unsafe risk risky ok okay fine wise "
  + "advisable acceptable advice advise advised advising recommend recommends recommended recommending whether").split(" "));
const BUSINESS = /^(?:trad(?:e|es|ed|ing)|buy\w*|bought|purchas\w*|sell\w*|sold|insur\w*|charter\w*|pay\w*|paid|ship\w*|work\w*|deal\w*|business|invest\w*|hir(?:e|es|ed|ing)|us(?:e|es|ed|ing)|tak(?:e|es|ing)|took|import\w*|export\w*|contract\w*|sign\w*|accept\w*)$/;
const LOOKALIKES = { "\u0430": "a", "\u0435": "e", "\u043e": "o", "\u0440": "p", "\u0441": "c", "\u0445": "x", "\u0443": "y", "\u0456": "i" };
const wordsOf = (text) => text.toLowerCase().replace(/[\u0430\u0435\u043e\u0440\u0441\u0445\u0443\u0456]/g, (c) => LOOKALIKES[c])
  .replace(/\b(?:[a-z]\s){3,}[a-z]\b/g, (run) => run.replace(/\s/g, "").replace(/(?<=....)i$/, " i")).match(/[a-z]+/g) ?? []; // ("s h o u l d i" is "should i")
function adviceIn(text) {
  const words = wordsOf(text);
  const cue = (i) => CUES.has(words[i]) || (words[i] === "have" && words[i + 1] === "to") || (words[i] === "yes" && words[i + 1] === "or" && words[i + 2] === "no");
  if (words.some((w, i) => (w === "legal" || w === "compliance") && words[i + 1] === "advice")) return true;
  const cues = words.flatMap((w, i) => (cue(i) ? [i] : []));
  return words.some((w, j) => BUSINESS.test(w) && cues.some((i) => i !== j && Math.abs(i - j) <= 8));
}
/** True when the reader's message looks like a request for advice on doing business (a wide net: see above). */
export function adviceIntent(question) {
  if (typeof question !== "string") return false;
  const text = question.normalize("NFKC");
  return adviceIn(text.replace(/[\p{Cf}\p{M}]/gu, "")) || adviceIn(text.replace(/[\p{Cf}]/gu, " "));
}

const only = (kind, text, next = []) => ({ kind, sentences: [{ text, sources: [] }], next });
const fallback = () => only("fallback", FALLBACK, [{ label: "Search", href: "/" }]);

// ---- rendering ---------------------------------------------------------------------------------------------------------

const listable = (e) => typeof e.entity?.name === "string" &&
  (e.kind === "opensanctions" || ((e.kind === "list" || e.kind === "research") && !e.delisted && Object.hasOwn(LIST_LABELS, e.gov ?? "")));

// The query is the model's own tool argument, so NOT_FOUND names it only when the reader typed it: its words, whole and in order,
// in the reader's question (case, spacing and punctuation aside; "SSOS" is not in "Is TASSOS sanctioned?"). Before the match the
// question is NFKC-normalised and stripped of format and combining characters and U+FEFF (then of control characters), so "TAS\u00ADSOS"
// (a soft hyphen) and "TAS\u034FSOS" (a combining joiner) are TASSOS and never the halves "TAS SOS". What is printed is the reader's own
// span of that cleaned question, and only when all of these hold:
//  (1) it is plain ASCII: letters, digits, spaces and . , & ' - (a Cyrillic or Greek lookalike such as "ТАSSOS" is never printed as
//      if it were the Latin name the search could not find);
//  (2) it is a seven-digit IMO number, or holds a word of four or more letters outside COMMON and the site's own prose, so "the
//      registered owner", "technical manager" and "all 300 ships" name nothing, while "gatik" does;
//  (3) no search of this answer found anything (checked by the renderer: a side search beside a found name never says "not on the lists").
const WORD = /[\p{L}\p{N}]+/gu;
const PLAIN = /^[A-Za-z0-9 .,&'-]+$/;
const IMO = /^(?:IMO\s*)?\d{7}$/i;
// Words that never name anything on their own, whatever their case: pointing words and generic nouns ("beneficial", "mentioned",
// "mother" and "daughter" are role words the site's prose happens not to use).
const COMMON = new Set(("it its they them their this these those he she his her both above below here there such former latter other all the "
  + "a an is are was were be been that any some of on in at to for by with and or who what which whose where when why how does do did "
  + "has have had not no yes still now ever my our your we you me so if as up one ones first second third next last same each every new old name names number "
  + "ship ships vessel vessels tanker tankers boat boats hull hulls company companies firm firms corporation person persons people man woman group groups "
  + "bank banks owner owners manager managers management operator operators shipowner shipowners parent parents subsidiary subsidiaries affiliate affiliates "
  + "sister buyer buyers seller sellers supplier suppliers client clients charterer charterers insurer insurers entity entities beneficial mentioned mother daughter "
  + "list lists listed listing sanction sanctions sanctioned blocked designated frozen restricted crude oil gas cargo fleet fleets shipping trading "
  + "holding holdings international limited services marine maritime energy logistics industries flag flagged registry "
  + "us uk eu un imo ofac sdn treasury ofsi bis commerce opensanctions").split(" "));
function nameLike(span) {
  if (IMO.test(span)) return true;
  const prose = siteVocabulary();
  return (span.match(/(?<![A-Za-z0-9])[A-Za-z]{4,}(?![A-Za-z0-9])/g) ?? []).some((w) => !COMMON.has(w.toLowerCase()) && !prose.has(w.toLowerCase()));
}
function typedSpan(query, question) {
  if (typeof query !== "string" || typeof question !== "string") return null;
  const clean = question.normalize("NFKC").replace(/[\p{Cf}\p{M}\uFEFF]/gu, "").replace(/\s+/g, " ").replace(/\p{Cc}/gu, "");
  const want = (query.match(WORD) ?? []).map((w) => w.toLowerCase());
  const words = [...clean.matchAll(WORD)];
  for (let i = 0; want.length && i + want.length <= words.length; i++) {
    if (!want.every((w, j) => words[i + j][0].toLowerCase() === w)) continue;
    const last = words[i + want.length - 1];
    const span = clean.slice(words[i].index, last.index + last[0].length).trim();
    try {
      return PLAIN.test(span) && nameLike(span) ? span : null; // "sanctioned is not on the lists" is never said; "gatik" typed in lower case still is a name
    } catch {
      return null; // no prose vocabulary to hand: never "not on the lists"
    }
  }
  return null;
}

// Each returns the sentences to show as [{text, items}], [] to drop the sentence, or null to give the fallback for the whole answer.
// `listed` and `change` write the items they can and leave the others out; only a claim with none left is dropped.
const RENDER = {
  listed: (items) => items.filter(listable).map((e) => ({ text: LISTED(e), items: [e] })),
  not_found: (items, s, all, ctx, state) => {
    const searches = items.filter((e) => e.kind === "search");
    if (!searches.length || !searches.every((e) => e.found === false)) return null;
    if (all.some((e) => e.kind === "search" && e.found === true)) {
      // a name was found in this answer: no "not on the lists" beside it. A real name typed by the reader that goes unanswered is said so.
      if (searches.some((e) => typedSpan(e.query, ctx.question))) state.partial = true;
      return [];
    }
    return searches.flatMap((e) => {
      const span = typedSpan(e.query, ctx.question);
      return span ? [{ text: NOT_FOUND(span), items: [e] }] : [];
    });
  },
  // "No changes" only from the change record's own item, followed by every gap of its range; never from an empty list
  change: (items, s, all) => items.filter((e) => e.kind === "change" || e.kind === "gap").flatMap((e) => (e.kind === "gap" ? [{ text: SOURCE_GAP(e), items: [e] }]
    : e.before_start ? [{ text: BEFORE_START(e.first_run), items: [e] }] // a range wholly before the record: never "no changes"
    : e.found === false ? [{ text: NO_CHANGES(e.from, e.to), items: [e] }, ...all.filter((g) => g.kind === "gap" && g.from <= e.to && g.to >= e.from).map((g) => ({ text: SOURCE_GAP(g), items: [g] }))]
      : [{ text: `${e.summary} · ${day(e.date)}`, items: [e] }])),
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
function clarify(items, ctx) {
  const options = unique(items.flatMap((e) => (e.kind === "search" ? (e.near ?? []).map(choice)
    : e.entity?.name && (e.link || e.url) ? [{ label: e.entity.name, href: e.link || e.url }] : [])), "label");
  return options.length ? finish("clarify", [{ text: CLARIFY, items: [] }, ...notice(ctx)], options) : fallback();
}

/** NOT_ADVICE, as a piece to close an answer or a clarify, when the reader's question asks for advice. */
const notice = (ctx) => (adviceIntent(ctx?.question) ? [{ text: NOT_ADVICE, items: [] }] : []);

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
  if (raw.kind === "clarify") return clarify([...cited.flatMap((c) => c.items), ...linked], ctx);

  // "not on the lists" is never said while a close spelling exists: ask which one was meant
  const near = cited.filter(({ s }) => s.claim === "not_found").flatMap(({ items }) => items).filter((e) => e.kind === "search" && e.found === false && e.near?.length);
  if (near.length) return finish("clarify", [{ text: CLARIFY, items: [] }, ...notice(ctx)], unique(near.flatMap((e) => e.near.map(choice)), "label"));

  const all = [...byId.values()];
  const pieces = [];
  const state = { partial: false };
  for (const { s, items } of cited) {
    const shown = typeof s.claim === "string" && Object.hasOwn(RENDER, s.claim) ? RENDER[s.claim](items, s, all, ctx ?? {}, state) : [];
    if (!shown) return fallback();
    pieces.push(...shown);
  }
  if (state.partial && pieces.length) pieces.push({ text: PARTIAL, items: [] }); // never a lone "part of the question": with nothing else to say it is the fallback
  if (pieces.length) pieces.push(...notice(ctx)); // last, after the part-answer line; an answer with nothing to say is the fallback and carries no notice
  // a next step is the cited item's own label and link (or url)
  const next = unique(linked.filter((e) => e.link || e.url).map((e) => ({ label: e.label, href: e.link || e.url })), "href");
  return finish("answer", pieces, next);
}
