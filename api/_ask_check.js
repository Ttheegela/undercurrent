// Ask's answer renderer. The model writes no words: each sentence of its `answer` call is a claim type and evidence ids (S1, S2, …),
// and a `quote` names one item and the number of one of its quotes. This module writes every sentence itself: listing, age, count,
// none, not-found and change sentences from fixed copy and the cited items, quotes copied verbatim from the cited item. Anything it can't
// build is dropped, and an answer with nothing left is the fallback; an answer of no sentences at all says nothing recorded answers the
// question. Any `text` or label from the model is ignored. No I/O beyond the site's
// own prose vocabulary, read once. The output is plain text plus {label, url} / {label, href} taken from the evidence: the panel escapes it.
import { LIST_LABELS, formatDate, joinAnd } from "../app/render.js";
import { siteVocabulary, LISTING, AUTHORITY, SHIP_TYPES } from "./_ask_tools.js";

// ---- fixed copy (global-constraints.md, verbatim; the range, one-day, OpenSanctions, clarify, before-start, trimmed, not-yet, part-answer and not-advice forms by ruling)

const REFUSAL = "I can only answer questions about what's on Undercurrent: sanctions lists, ship and company connections, lobbying, the semiconductor data, the research and the daily updates. I can't give legal or compliance advice.";
const FALLBACK = "I couldn't check an answer to that against the site's data, so I won't guess. Try the search on the home page.";
// the model looked things up and no record answers the question: said, not the fallback, which means it couldn't be checked
const NOTHING_ANSWERS = "Nothing recorded on this site answers that.";
const CLARIFY = "Which of these did you mean?";
const day = (iso) => formatDate(iso) || iso; // d MMM yyyy; a bare year stays as it is
const NOT_FOUND = (name) => `${name} is not on the lists we check (US, UK, EU, UN, OpenSanctions). Not being found isn't proof.`;
const NO_CHANGES = (from, to) => (from === to ? `No changes were recorded on ${day(from)}.` : `No changes were recorded between ${day(from)} and ${day(to)}.`);
const PARTIAL = "I could only answer part of the question. Ask about each name on its own to check the rest.";
const NOT_ADVICE = "Ask can't give legal or compliance advice. These are records from the site, each with its source.";
const BEFORE_START = (first) => `Daily updates started on ${day(first)}, so there is no record before then.`;
const TRIMMED = (started) => `Days before ${day(started)} are no longer kept.`;
const NOT_YET = "Today's nightly update hasn't run yet.";
// A topic none says what it rests on: the updates whose programme or country could be checked, and how many could not be checked against
// the topic (some carry no programme or country, some carry ones that cannot settle it)
function NONE_INVOLVE(e) {
  const n = e.checked_fleet + e.checked_lobby;
  const when = e.from === e.to ? `on ${day(e.from)}` : `between ${day(e.from)} and ${day(e.to)}`;
  return n === 1 ? `The 1 update recorded ${when} does not involve ${e.topic.label}.` : `None of the ${num(n)} updates recorded ${when} involve ${e.topic.label}.`;
}
const UNCHECKED = (e) => `${e.unchecked === 1 ? "1 update" : `${num(e.unchecked)} updates`} in that period can't be checked against ${e.topic.label}.`;
const SOURCE_GAP = (g) => (g.date || g.from === g.to
  ? `${g.source} was unavailable on ${day(g.date ?? g.from)}, so changes from it that day aren't recorded.`
  : `${g.source} was unavailable from ${day(g.from)} to ${day(g.to)}, so changes from it on those days aren't recorded.`);
const onList = (e) => `the ${LIST_LABELS[e.gov]} list${e.program ? ` under ${e.program}` : ""}`;
function LISTED(e) {
  const since = e.date ? ` since ${day(e.date)}` : "";
  return e.kind === "opensanctions"
    ? `${e.entity.name} appears in OpenSanctions${e.program ? ` as listed by ${e.program}` : ""}${since}.`
    : `${e.entity.name} appears on ${onList(e)}${since}.`;
}
// How long a listing has stood, from its date and today (UTC), with what the date stands for (the item's date_basis). "No listing date"
// only for a record that has none (`undated`). A date after today (bad data), one without its day, or one in a form the tools could
// not read (no `date`, not `undated`) has no age: that is LISTED.
const BASIS = { first_seen_opensanctions: " (first seen on the list via OpenSanctions)", uk_transfer: " (the UK list's transfer date; the listing may be older)" };
function AGE(e, today) {
  if (!e.date) return e.undated ? `The ${LIST_LABELS[e.gov]} list gives no listing date for ${e.entity.name.replace(/\.$/, "")}.` : LISTED(e); // ("Co., Ltd.", one stop)
  const span = calendarSpan(e.date, today);
  if (span === null) return LISTED(e);
  const note = Object.hasOwn(BASIS, e.date_basis) ? BASIS[e.date_basis] : "";
  return span ? `${e.entity.name} has been on ${onList(e)} for ${span} (since ${day(e.date)})${note}.` : `${e.entity.name} was added to ${onList(e)} today${note}.`;
}
/** "5 years 10 months": whole months by the calendar (a month without the date's day ends on its last day, so 29 Feb to 28 Feb is a
 * year), or days under a month; "" for none; null when `from` is after `to` or either is not a whole date. */
function calendarSpan(from, to) {
  const [a, b] = [from, to].map((d) => /^(\d{4})-(\d{2})-(\d{2})$/.exec(d ?? "")?.slice(1).map(Number));
  if (!a || !b || from > to) return null;
  const lastDay = new Date(Date.UTC(b[0], b[1], 0)).getUTCDate();
  const months = (b[0] - a[0]) * 12 + b[1] - a[1] - (b[2] < a[2] && b[2] < lastDay ? 1 : 0);
  const unit = (n, word) => (n ? `${n} ${word}${n === 1 ? "" : "s"}` : "");
  if (!months) return unit((Date.UTC(b[0], b[1] - 1, b[2]) - Date.UTC(a[0], a[1] - 1, a[2])) / 864e5, "day");
  return [unit(Math.floor(months / 12), "year"), unit(months % 12, "month")].filter(Boolean).join(" ");
}
const num = (n) => n.toLocaleString("en-GB");
const SHOWING = (n, total) => `Showing ${num(n)} of ${num(total)}.`;
// A count's sentence, by what it counts (null for a unit it does not know): records on an official list, by ref. A country's records are
// under its programmes ("Iran programmes"), any other topic's under one ("the Terrorism programme"); a none says what it rests on: no
// programme of that name, on the list or on any of the four
const LABELS = Object.values(LIST_LABELS);
const ALL_LISTS = `the ${LABELS.slice(0, -1).join(", ")} or ${LABELS.at(-1)} lists`;
// Ships in the research map, by what its count's filters say they are, from fixed fragments and the vocabulary's labels: "are tankers and
// are under a Russia programme and an Iran programme". A flag is always "by at least one source": the sources can disagree.
const MAP_SHIPS = "ships in Undercurrent's research map";
function shipsThat(f, one) {
  const be = one ? "is" : "are";
  return joinAnd([
    f.ship_type && `${be} ${SHIP_TYPES[f.ship_type][one ? 0 : 1]}`, // (the tool's own table: every type it takes has its words)
    f.programme && `${be} under ${joinAnd(f.programme.map((g) => `${/^[AEIOU]/.test(g.label) ? "an" : "a"} ${g.label} programme`))}`,
    f.listed_by && `${be} listed by the ${LIST_LABELS[f.listed_by]}`,
    f.flag && `${be} recorded as ${f.flag.label}-flagged by at least one source`,
    f.names_changed && `${one ? "has" : "have"} had more than one name`,
  ].filter(Boolean));
}
function COUNT(e) {
  switch (e.unit) {
    case "records": {
      const under = e.topic.region ? `${e.topic.label} programmes` : `the ${e.topic.label} programme`;
      return `${e.n === 1 ? "1 record" : `${num(e.n)} records`} on the ${LIST_LABELS[e.list]} list ${e.n === 1 ? "is" : "are"} under ${under}.`;
    }
    // names changed alone is counted out of every ship in the map
    case "ships": return Object.keys(e.filters).join() === "names_changed"
      ? `${num(e.n)} of the ${num(e.total_ships)} ${MAP_SHIPS} ${shipsThat(e.filters, e.n === 1)}.`
      : `${e.n === 1 ? "1 ship" : `${num(e.n)} ships`} in Undercurrent's research map ${shipsThat(e.filters, e.n === 1)}.`;
    // the chips research's set of firms, from the Treasury releases it reads
    case "firms": return `${e.n === 1 ? "1 firm is" : `${num(e.n)} firms are`} named in Undercurrent's research as shipping chips to Russia.`;
    default: return null;
  }
}
function NONE_MATCHED(e) {
  switch (e.unit) {
    case "records": return `No programme on ${e.list ? `the ${LIST_LABELS[e.list]} list` : ALL_LISTS} is named ${e.topic.label}.`;
    case "ships": return `None of the ${MAP_SHIPS} ${shipsThat(e.filters, false)}.`;
    default: return null;
  }
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
//      registered owner", "technical manager", "all 300 ships" and "Iranian" name nothing, while "gatik" does;
//  (3) it says nothing of its own: no listing, authority or clean-bill word, no "is" or "not" (see CLEAN_BILL);
//  (4) no search of this answer found anything (checked by the renderer: a side search beside a found name never says "not on the lists").
const WORD = /[\p{L}\p{N}]+/gu;
const PLAIN = /^[A-Za-z0-9 .,&'-]+$/;
const IMO = /^(?:IMO\s*)?\d{7}$/i;
// A verdict in the reader's words is never printed, even when the reader typed it as the name ("Zorbex Marine is not sanctioned",
// "OFAC cleared Zorbex", "Zorbex safe to trade"): listing and authority words (the quotes' own), and clean-bill words, which go by shape
// so that a verdict no list names still counts. A name holding one of these words gets the fallback instead (the shapes take 0.07%
// of the listed names more than a word list did, most for "Charitable", "Variable" or "Cable").
const CLEAN_BILL = new RegExp([
  String.raw`\b(?:is|are|was|were|not|no|never|none|nothing|nil|zero)\b|n['’]t\b`, // a predicate or negation makes a span a statement: "isn't", "nothing found"
  String.raw`\b(?:un|non|dis|pre|re)?-?(?:approv|allow|permitt|authori[sz]|licen[cs]|vett|verifi|screen|pass|ok(?:ay)?['’]?|clear|clean|trust|certifi|accredit|validat|endors|pardon|exempt|exonerat|absolv|acquitt)e?d\b|\bscreening\b`, // vetted: "OK'd", "unverified", "pre-approved"
  String.raw`\b\w+(?:able|ible|worthy)\b`, // fit for business: "reliable", "reputable", "permissible", "trustworthy"
  String.raw`\b(?:un|non|in|il|dis)?-?(?:clean|clear(?:s|ance)?|safe(?:ly|r|st)?|risk(?:s|y)?|(?:harm|blame|fault|guilt|risk)less|(?:il)?legal(?:ly)?|legit(?:imate)?|lawful|compliant|innocent|exempt|ok(?:ay)?)\b`,
].join("|"), "i");
const verdict = (span) => LISTING.test(span) || AUTHORITY.test(span) || CLEAN_BILL.test(span);
// Country and nationality words name no ship, firm or person on their own ("Is Iranian oil listed?" searched as "Iranian"): the countries
// in the site's data (the research's flags and countries, the lists' programmes, the chip-trade reporters) word by word, and their
// nationality words
const PLACES = ("afghanistan africa african albania algeria almaty america andorra angola antigua arab arabia argentina armenia aruba australia "
  + "austria azerbaijan bahamas bahrain balkans barbados barbuda belarus belgium belize benin bermuda bhutan bishkek bissau bolivia bosnia "
  + "botswana brazil britain british brunei bulgaria burkina burma burundi cabo cambodia cameroon canada cayman central chile china colombia "
  + "comoros congo cook costa crimea croatia cuba curacao cyprus czechia darussalam denmark djibouti dominica dominican donetsk dubai ecuador "
  + "egypt emirates england estonia eswatini ethiopia european faroe faso fiji finland france french gabon gambia georgia germany ghana great "
  + "greece grenada grenadines guatemala guinea guyana haiti herzegovina holland honduras hong hungary iceland india indonesia iran iraq "
  + "ireland islands israel italy ivoire jamaica japan jordan kaliningrad kazakhstan kenya kingdom kiribati kitts kong korea kosovo kuwait "
  + "kyrgyzstan lanka latvia lebanon leone lesotho leste liberia libya lithuania lucia luhansk luxembourg maarten macao macedonia madagascar "
  + "malawi malaysia maldives mali malta marino marshall mauritania mauritius mexico moldova mongolia montenegro montserrat morocco moscow "
  + "mozambique myanmar namibia nepal netherlands nevis nicaragua niger nigeria north norway oman pakistan palau palestine panama papua "
  + "paraguay peru petersburg philippines poland polynesia portugal principe qatar rica romania russia rwanda saint salvador samoa saudi "
  + "senegal serbia seychelles sierra singapore sint slovakia slovenia somalia south spain states sudan suriname sweden switzerland syria "
  + "taiwan tajikistan tanzania thailand timor tobago togo tome tonga trinidad tunisia turkey turkiye turkmenistan tuvalu uganda ukraine union "
  + "united uruguay uzbekistan vanuatu venezuela verde viet vietnam vincent virgin western yemen zambia zealand zimbabwe "
  + "afghan albanian algerian american andorran angolan argentine argentinian armenian aruban australian austrian azerbaijani azeri bahamian "
  + "bahraini bangladeshi barbadian belarusian belarussian belgian belizean beninese bhutanese bolivian bosnian brazilian bruneian bulgarian "
  + "burmese burundian cambodian cameroonian canadian caymanian chadian chechen chilean chinese colombian comorian congolese crimean croatian "
  + "cuban cypriot czech danish djiboutian dutch ecuadorian egyptian emirati english eritrean estonian ethiopian fijian filipino finnish "
  + "gabonese gambian georgian german ghanaian greek grenadian guatemalan guinean guyanese haitian honduran hungarian icelandic indian "
  + "indonesian iranian iraqi irish israeli italian ivorian jamaican japanese jordanian kazakh kazakhstani kenyan korean kosovar kuwaiti kyrgyz "
  + "laotian latvian lebanese liberian libyan lithuanian luxembourgish malagasy malawian malaysian maldivian malian maltese marshallese "
  + "mauritanian mauritian mexican moldovan mongolian montenegrin moroccan mozambican namibian nepalese nepali nicaraguan nigerian nigerien "
  + "norwegian omani pakistani palauan palestinian panamanian paraguayan persian peruvian polish portuguese qatari romanian russian rwandan "
  + "salvadoran samoan senegalese serbian seychellois singaporean slovak slovakian slovenian somali soviet spanish sudanese surinamese swedish "
  + "swiss syrian taiwanese tajik tanzanian thai togolese tongan trinidadian tunisian turkish turkmen tuvaluan ugandan ukrainian uruguayan "
  + "uzbek vanuatuan venezuelan vietnamese yemeni zambian zimbabwean");
// Words that never name anything on their own, whatever their case: pointing words and generic nouns ("beneficial", "mentioned",
// "mother" and "daughter" are role words the site's prose happens not to use), and the places above.
const COMMON = new Set(("it its they them their this these those he she his her both above below here there such former latter other all the "
  + "a an is are was were be been that any some of on in at to for by with and or who what which whose where when why how does do did "
  + "has have had not no yes still now ever my our your we you me so if as up one ones first second third next last same each every new old name names number "
  + "ship ships vessel vessels tanker tankers boat boats hull hulls company companies firm firms corporation person persons people man woman group groups "
  + "bank banks owner owners manager managers management operator operators shipowner shipowners parent parents subsidiary subsidiaries affiliate affiliates "
  + "sister buyer buyers seller sellers supplier suppliers client clients charterer charterers insurer insurers entity entities beneficial mentioned mother daughter "
  + "list lists listed listing sanction sanctions sanctioned blocked designated frozen restricted crude oil gas cargo fleet fleets shipping trading "
  + "holding holdings international limited services marine maritime energy logistics industries flag flagged registry "
  + "us uk eu un imo ofac sdn treasury ofsi bis commerce opensanctions " + PLACES).split(" "));
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
      return PLAIN.test(span) && !verdict(span) && nameLike(span) ? span : null; // "sanctioned is not on the lists" is never said; "gatik" typed in lower case still is a name
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
  // (an age that cannot be told is the listed sentence, and counts as one)
  age: (items, s, all, ctx) => items.filter((e) => listable(e) && e.kind !== "opensanctions").map((e) => {
    const text = AGE(e, ctx.today ?? new Date().toISOString().slice(0, 10));
    return { text, items: [e], ...(text === LISTED(e) && { claim: "listed" }) };
  }),
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
  // one sentence per cited count item (none matched when it is 0), its sources the item and the examples it gave that are cited with it
  count: (items) => items.filter((e) => e.kind === "count").flatMap((c) => {
    const text = c.n ? COUNT(c) : NONE_MATCHED(c);
    return text ? [{ text, items: [c, ...items.filter((e) => e.result === c.id)] }] : [];
  }),
  // "No changes" only from the change record's own item, followed by every gap of its range; never from an empty list. A range the
  // record cannot speak for is never "no changes": before its first night, trimmed from it, or today before tonight's run.
  change: (items, s, all) => {
    const gaps = (e) => all.filter((g) => g.kind === "gap" && g.from <= e.to && g.to >= e.from).map((g) => ({ text: SOURCE_GAP(g), items: [g] }));
    return items.filter((e) => e.kind === "change" || e.kind === "gap").flatMap((e) => (e.kind === "gap" ? [{ text: SOURCE_GAP(e), items: [e] }]
      : e.before_start ? [{ text: BEFORE_START(e.first_run), items: [e] }]
      : e.trimmed ? [{ text: TRIMMED(e.started), items: [e] }]
      : e.not_yet ? [{ text: NOT_YET, items: [e] }, ...gaps(e)]
      : e.found === false && e.topic ? [{ text: NONE_INVOLVE(e), items: [e] }, ...(e.unchecked ? [{ text: UNCHECKED(e), items: [e] }] : []), ...gaps(e)]
      : e.found === false ? [{ text: NO_CHANGES(e.from, e.to), items: [e] }, ...gaps(e)]
      : [{ text: `${e.summary} · ${day(e.date)}`, items: [e] }]));
  },
  // a none, as its count or change claim writes it: a count of 0, or a topic no checked update involves (with what could not be checked
  // and the gaps). Anything else cited as a none is dropped: a count that found something is never one.
  none_matched: (items, s, all) => [
    ...RENDER.count(items.filter((e) => e.kind === "count" && e.n === 0)),
    ...RENDER.change(items.filter((e) => e.kind === "change" && e.found === false && e.topic), s, all),
  ],
  // one sentence of one item, verbatim. A change or gap item has no quotes: a quote of one alone is its change claim, the fixed copy above
  // (and counts as one towards "Showing N of M")
  quote: (items, s, all) => {
    if (items.length === 1 && (items[0].kind === "change" || items[0].kind === "gap")) return RENDER.change(items, s, all).map((p) => ({ ...p, claim: "change" }));
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

// The claims whose sentences show a search's matches, and so count towards "Showing N of M": listings, the examples cited with a count, and
// the changes of a capped list of updates (only a capped one is linked to a result)
const SHOWS_MATCHES = new Set(["listed", "count", "change"]);
// what a match is counted as: its entity, or a change by its identity in the record (the changes total counts changes, and two can be of one
// ship; one change returned by two changes calls is one)
const matchKey = (e) => (e.kind === "change" ? e.key : e.entity.id);

/**
 * Numbers the sources in order of first citation; one sentence written twice becomes one sentence with both sources. Then, for each
 * search (an item with a `total`), the entities among its matches (the items whose `result` is its id) that SHOWS_MATCHES sentences name:
 * when they are fewer than its total, SHOWING follows the last sentence naming one. A quote, an age or any other sentence never
 * counts. Entities, not items, are counted, so two searches of one ship (its name and its IMO number, or one query run twice) each
 * count a record listed from either search's copy; the same line twice after one sentence is said once. The model never chooses it.
 */
function finish(kind, pieces, next, byId = new Map()) {
  const n = new Map();
  const byText = new Map();
  for (const { text, items, claim } of pieces) {
    if (!byText.has(text)) byText.set(text, { text, sources: [], listed: new Set() });
    const { sources, listed } = byText.get(text);
    for (const e of items) {
      if (!n.has(e.id)) n.set(e.id, n.size + 1);
      if (!sources.some((x) => x.n === n.get(e.id))) sources.push({ n: n.get(e.id), label: e.label, url: e.url });
      if (SHOWS_MATCHES.has(claim) && e.entity) listed.add(matchKey(e));
    }
  }
  const said = [...byText.values()];
  const named = new Set(said.flatMap((x) => [...x.listed]));
  const matches = new Map(); // search -> the entities of its matches
  for (const e of byId.values()) {
    const r = byId.get(e.result);
    if (e.entity && Number.isInteger(r?.total)) matches.set(r, (matches.get(r) ?? new Set()).add(matchKey(e)));
  }
  const lines = said.map(() => new Set()); // after each sentence
  for (const [r, entities] of matches) {
    const shown = [...entities].filter((x) => named.has(x)).length;
    if (shown && shown < r.total) lines[said.findLastIndex((x) => [...x.listed].some((y) => entities.has(y)))].add(SHOWING(shown, r.total));
  }
  const sentences = said.flatMap(({ text, sources }, i) => [{ text, sources }, ...[...lines[i]].map((t) => ({ text: t, sources: [] }))]);
  return sentences.length ? { kind, sentences, next } : fallback();
}

/** The fixed question, with the near names of the cited searches and the cited entities as the choices. */
function clarify(items, ctx) {
  const options = unique(items.flatMap((e) => (e.kind === "search" ? (e.near ?? []).map(choice)
    : e.entity?.name && (e.link || e.url) ? [{ label: e.entity.name, href: e.link || e.url }] : [])), "label");
  return options.length ? finish("clarify", [{ text: CLARIFY, items: [] }, ...notice(ctx)], options) : fallback();
}

/**
 * The model's list, or null when it is none (so an empty list, which says something, is told from a missing or broken one). A model
 * sometimes sends the list as a JSON string ("[{\"claim\":…}]", the second eval run): that string is decoded once, and used only when it
 * holds an array. Only the container's format changes: the sentences in it go through the same checks as ever, so nothing the model
 * wrote is rendered. The caller's object is left as the model sent it.
 */
function listOf(x) {
  if (typeof x === "string") {
    try {
      x = JSON.parse(x);
    } catch {
      return null;
    }
  }
  return Array.isArray(x) ? x : null;
}

/** NOT_ADVICE, as a piece to close an answer or a clarify, when the reader's question asks for advice. */
const notice = (ctx) => (adviceIntent(ctx?.question) ? [{ text: NOT_ADVICE, items: [] }] : []);

/**
 * raw: the model's `answer` arguments {kind, sentences: [{claim, sources, quote?}], next: [{source}]} (anything else in it is ignored;
 * sentences and next may each arrive as a JSON string of that array, see listOf);
 * ev: the evidence of this question; ctx.question: the reader's latest message (NOT_FOUND names a query only when it is there);
 * ctx.toolFailed: a tool call of this question returned an error.
 * Returns {kind: "answer"|"refusal"|"clarify"|"fallback", sentences: [{text, sources: [{n, label, url}]}], next: [{label, href}]}.
 */
export function checkAnswer(raw, ev, ctx) {
  if (raw?.kind === "refusal") return only("refusal", REFUSAL);
  if (raw?.kind !== "answer" && raw?.kind !== "clarify") return fallback();
  const byId = new Map((Array.isArray(ev) ? ev : []).map((e) => [e.id, e]));
  const sentences = listOf(raw.sentences);
  // an answer of no sentences after the tools returned evidence: the model found no record that answers. With no evidence at all
  // nothing was checked (every lookup failed, or none was made), and with a lookup that failed not everything was: the fallback
  if (raw.kind === "answer" && sentences?.length === 0 && byId.size) return ctx?.toolFailed ? fallback() : only("answer", NOTHING_ANSWERS);
  const said = (sentences ?? []).filter((s) => s !== null && typeof s === "object");
  const linked = (listOf(raw.next) ?? []).map((x) => byId.get(x?.source)).filter(Boolean);
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
    pieces.push(...shown.map((p) => ({ ...p, claim: p.claim ?? s.claim })));
  }
  if (state.partial && pieces.length) pieces.push({ text: PARTIAL, items: [] }); // never a lone "part of the question": with nothing else to say it is the fallback
  if (pieces.length) pieces.push(...notice(ctx)); // last, after the part-answer line; an answer with nothing to say is the fallback and carries no notice
  // a next step is the cited item's own label and link (or url)
  const next = unique(linked.filter((e) => e.link || e.url).map((e) => ({ label: e.label, href: e.link || e.url })), "href");
  const out = finish("answer", pieces, next, byId);
  madeFrom.set(out, { pieces, byId });
  return out;
}

// What each answer was written from, so the relevance gate can drop sentences and finish can number and count the rest again
const madeFrom = new WeakMap(); // answer -> {pieces, byId}

/**
 * The answer checkAnswer wrote, keeping of the sentences written from evidence only those whose text `keep` accepts. Fixed copy stays;
 * finish numbers the sources again and rebuilds the "Showing N of M" lines from what is left. With none of them left it is
 * NOTHING_ANSWERS. An answer not written here comes back as it is.
 */
export function keepSentences(answer, keep) {
  const made = madeFrom.get(answer);
  if (!made) return answer;
  const pieces = made.pieces.filter((p) => !p.items.length || keep(p.text));
  return pieces.some((p) => p.items.length) ? finish(answer.kind, pieces, answer.next, made.byId) : only("answer", NOTHING_ANSWERS);
}
