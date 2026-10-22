// The closed vocabulary of topic words: the only programme, country or group words Ask may print. It is built from the committed data:
// the programmes of the four official lists (a compound one such as "Iran, Weapons proliferation" is two), the research map's countries
// and programme groups, the countries of the chips research's firms, and the lobbying graph's groups. A word is a topic only when it is a topic's label or one of its known aliases,
// whole and in any case: "iran" and "Iranian" are Iran, "Iran Air" is a name and nothing here. The programmes the lists spell differently
// for one country are one topic ("North Korea" and "Democratic People's Republic of Korea"). The map and the graph are 6 MB of JSON, so
// the vocabulary is built once, on first use, never by a cold start that does not need it.
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (rel) => JSON.parse(readFileSync(join(process.cwd(), rel), "utf8"));
const REGIONS = new Intl.DisplayNames("en", { type: "region" });
const SHORT_REGIONS = new Intl.DisplayNames("en", { type: "region", style: "short" });
const GROUP_LABELS = { dprk: "North Korea" };
/** A programme group's label, from its key alone ("dprk" is North Korea): the research tool names the map's groups without the vocabulary. */
export const groupLabel = (g) => GROUP_LABELS[g] ?? g.charAt(0).toUpperCase() + g.slice(1); // ("" is no label)
export const BUCKETS = new Set(["", "both", "other"]); // the research map's groups for a ship in two programmes or none: not topics
// Nationality words and other names, by label. A topic that names no country has only other spellings here ("Al-Qaeda", and ISIL, ISIS
// and Da'esh, which the UK's and the UN's Al-Qaida regimes name with it), so they are matched too; a country's never are
const ALIASES = new Map(("Afghanistan:Afghan;Al-Qaida:Al-Qaeda,Al Qaida,ISIL,ISIS,Da'esh;Antigua and Barbuda:Antiguan;Armenia:Armenian;Aruba:Aruban;Azerbaijan:Azerbaijani;Bahamas:Bahamian;Barbados:Barbadian;"
  + "Belarus:Belarusian,Republic of Belarus;Belize:Belizean;Bosnia and Herzegovina:Bosnian;Bulgaria:Bulgarian;Cambodia:Cambodian;Cameroon:Cameroonian;"
  + "Cayman Islands:Caymanian;Central African Republic:Central African;China:Chinese;Chips:chip,semiconductor,semiconductors;Comoros:Comorian;"
  + "Cuba:Cuban;Cyprus:Cypriot;DR Congo:Congolese,Congo-Kinshasa,Democratic Republic of the Congo;Denmark:Danish;Djibouti:Djiboutian;Estonia:Estonian;Eswatini:Swazi;Finland:Finnish;"
  + "France:French;Gabon:Gabonese;Gambia:Gambian;Georgia:Georgian;Germany:German;Greece:Greek;Guatemala:Guatemalan;Guinea:Guinean;"
  + "Guinea-Bissau:Bissau-Guinean,Republic of Guinea-Bissau;Guyana:Guyanese;Haiti:Haitian;Honduras:Honduran;Hungary:Hungarian;India:Indian;Indonesia:Indonesian;Iran:Iranian;Iraq:Iraqi;"
  + "Italy:Italian;Jamaica:Jamaican;Kazakhstan:Kazakh;Kyrgyzstan:Kyrgyz;Lebanon:Lebanese;Liberia:Liberian;Libya:Libyan;Malaysia:Malaysian;Mali:Malian;"
  + "Malta:Maltese;Marshall Islands:Marshallese;Mauritius:Mauritian;Moldova:Moldovan;Mongolia:Mongolian;Mozambique:Mozambican;"
  + "Myanmar:Burmese,Burma;Netherlands:Dutch;Nicaragua:Nicaraguan;North Korea:North Korean,DPRK,Democratic People's Republic of Korea;Oman:Omani;Palau:Palauan;Panama:Panamanian;"
  + "Romania:Romanian;Russia:Russian,Russian Federation;Seychelles:Seychellois;Sierra Leone:Sierra Leonean;Singapore:Singaporean;"
  + "Somalia:Somali;South Sudan:South Sudanese;Spain:Spanish;Sri Lanka:Sri Lankan;Sudan:Sudanese;Suriname:Surinamese;Syria:Syrian;Taiwan:Taiwanese;"
  + "Tanzania:Tanzanian;Thailand:Thai;Togo:Togolese;Tunisia:Tunisian;Turkey:Turkish,Türkiye;Tuvalu:Tuvaluan;Ukraine:Ukrainian;United Arab Emirates:Emirati;"
  + "United Kingdom:British;United States:American;Vanuatu:Ni-Vanuatu;Venezuela:Venezuelan;Vietnam:Vietnamese;Yemen:Yemeni")
  .split(";").map((pair) => pair.split(":")).map(([label, aliases]) => [label, aliases.split(",")]));
const word = (w) => w.trim().replace(/\s+/g, " ").toLowerCase();
// a country's name as the region table and the lists both write it: "Bosnia & Herzegovina" is "bosnia and herzegovina", "Congo - Kinshasa" "congo-kinshasa"
const plain = (w) => word(w).replace(/\s*&\s*/g, " and ").replace(/\s*-\s*/g, "-");

const balanced = (s) => s.split("(").length === s.split(")").length;

let built = null;
function build() {
  // one programme per spelling in any case, the first one met ("Chemical Weapons", UK, before the EU's "Chemical weapons"); a part cut
  // short at a comma inside brackets ("Counter-Terrorism (International") is not printable, so it is no topic
  const programmes = new Map();
  for (const p of ["us", "uk", "eu", "un"].flatMap((id) => read(`data/lists/${id}.json`).records.flatMap((r) => (r[2] || "").split(", ")))) {
    if (p && balanced(p) && !programmes.has(p.toLowerCase())) programmes.set(p.toLowerCase(), p);
  }
  const fleet = read("stories/shadow-fleet/network/fleet-data.json").nodes;
  // (a country the map names only by its code, "DK", is given its English name)
  const countries = fleet.filter((n) => n.id.startsWith("cc:")).map((n) => [n.id.slice(3), n.name === n.id.slice(3).toUpperCase() ? REGIONS.of(n.name) : n.name]);
  // and the countries of the chips research's firms that the map does not name ("Armenian firms"), by the region table's name
  const named = new Set(countries.map(([cc]) => cc.toLowerCase()));
  for (const cc of new Set(read("stories/chips-into-russia/data/listing_lag.json").firms.flatMap((f) => f.countries))) if (!named.has(cc.toLowerCase())) countries.push([cc.toLowerCase(), REGIONS.of(cc)]);
  const groups = new Set([...fleet.map((n) => n.program_group), ...read("stories/who-lobbies/influence-network/kg.json").nodes.map((n) => n.g)].filter((g) => typeof g === "string" && !BUCKETS.has(g)));
  // the region code of a name: the region table's names (long and short), then every name in an alias-table entry that holds one of them.
  // A code the runtime knows no time zone for is a grouping, not a country: "EU", "EZ", "UN", "QO", "ZZ" (both shapes of the API are
  // read; a runtime with neither keeps every code)
  const codes = new Map();
  for (let i = 0; i < 26 * 26; i++) {
    const code = String.fromCharCode(65 + Math.floor(i / 26), 65 + (i % 26));
    const place = new Intl.Locale("und", { region: code });
    if ((place.getTimeZones?.() ?? place.timeZones)?.length === 0) continue;
    const cc = Intl.getCanonicalLocales(`und-${code}`)[0].slice(4); // a retired code is its successor: YD (named "Yemen") is YE
    for (const name of [REGIONS.of(code), SHORT_REGIONS.of(code)]) if (name !== code && !codes.has(plain(name))) codes.set(plain(name), cc);
  }
  for (const [label, aliases] of ALIASES) {
    const cc = [label, ...aliases].map((w) => codes.get(plain(w))).find(Boolean);
    if (cc) for (const w of [label, ...aliases]) if (!codes.has(plain(w))) codes.set(plain(w), cc);
  }
  // one programme topic per country, whatever the lists call it: spellings with one region code are one topic ("North Korea" and
  // "Democratic People's Republic of Korea" are KP), printed by its shortest spelling, and matched by every one
  const byCountry = new Map();
  for (const p of programmes.values()) {
    const id = codes.get(plain(p)) ?? p.toLowerCase();
    byCountry.set(id, [...(byCountry.get(id) ?? []), p]);
  }
  const programme = (spellings) => {
    const label = spellings.reduce((a, b) => (b.length < a.length ? b : a));
    const aliases = [...new Set([...spellings, ...spellings.flatMap((s) => ALIASES.get(s) ?? [])])].filter((w) => w !== label);
    return { kind: "programme", key: label, label, aliases, spellings, ...(codes.has(plain(label)) && { region: codes.get(plain(label)) }) };
  };
  const topic = (kind, key, label) => ({ kind, key, label, aliases: ALIASES.get(label) ?? [] });
  const topics = [
    ...[...byCountry.values()].map(programme),
    ...countries.map(([cc, name]) => ({ ...topic("country", cc, name), region: cc.toUpperCase() })),
    ...[...groups].map((g) => topic("group", g, groupLabel(g))),
  ];
  // a word shared by several topics ("Iran": the programme, the country and the group) is the first: programme, then country, then group
  const byWord = new Map();
  for (const t of topics) for (const w of [t.label, ...t.aliases].map(word)) if (!byWord.has(w)) byWord.set(w, t);
  return { topics, byWord };
}

/**
 * VOCAB.topics: every topic as {kind: "programme"|"country"|"group", key, label, aliases}, built on first use. A programme also has its
 * `spellings` on the lists. A country, and a programme that names one, has its `region` code.
 */
export const VOCAB = { get topics() { return (built ??= build()).topics; } };

/** The topic a word names, as {kind, key, label}, or null when it is not a topic's label or alias, whole. */
export function topicOf(w) {
  const t = typeof w === "string" ? (built ??= build()).byWord.get(word(w)) : undefined;
  return t ? { kind: t.kind, key: t.key, label: t.label } : null;
}
