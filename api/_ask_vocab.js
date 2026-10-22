// The closed vocabulary of topic words: the only programme, country or group words Ask may print. It is built from the committed data:
// the programmes of the four official lists (a compound one such as "Iran, Weapons proliferation" is two), the research map's countries
// and programme groups, and the lobbying graph's groups. A word is a topic only when it is a topic's label or one of its known aliases,
// whole and in any case: "iran" and "Iranian" are Iran, "Iran Air" is a name and nothing here. The map and the graph are 6 MB of JSON, so
// the vocabulary is built once, on first use, never by a cold start that does not need it.
import { readFileSync } from "node:fs";
import { join } from "node:path";

const read = (rel) => JSON.parse(readFileSync(join(process.cwd(), rel), "utf8"));
const REGIONS = new Intl.DisplayNames("en", { type: "region" });
const GROUP_LABELS = { dprk: "North Korea" };
const BUCKETS = new Set(["", "both", "other"]); // the research map's groups for a ship in two programmes or none: not topics
// Nationality words and other names, by label
const ALIASES = new Map(("Afghanistan:Afghan;Antigua and Barbuda:Antiguan;Aruba:Aruban;Azerbaijan:Azerbaijani;Bahamas:Bahamian;Barbados:Barbadian;"
  + "Belarus:Belarusian;Belize:Belizean;Bosnia and Herzegovina:Bosnian;Bulgaria:Bulgarian;Cambodia:Cambodian;Cameroon:Cameroonian;"
  + "Cayman Islands:Caymanian;Central African Republic:Central African;China:Chinese;Chips:chip,semiconductor,semiconductors;Comoros:Comorian;"
  + "Cuba:Cuban;Cyprus:Cypriot;DR Congo:Congolese;Denmark:Danish;Djibouti:Djiboutian;Estonia:Estonian;Eswatini:Swazi;Finland:Finnish;"
  + "France:French;Gabon:Gabonese;Gambia:Gambian;Georgia:Georgian;Germany:German;Greece:Greek;Guatemala:Guatemalan;Guinea:Guinean;"
  + "Guinea-Bissau:Bissau-Guinean;Guyana:Guyanese;Haiti:Haitian;Honduras:Honduran;India:Indian;Indonesia:Indonesian;Iran:Iranian;Iraq:Iraqi;"
  + "Italy:Italian;Jamaica:Jamaican;Kazakhstan:Kazakh;Lebanon:Lebanese;Liberia:Liberian;Libya:Libyan;Malaysia:Malaysian;Mali:Malian;"
  + "Malta:Maltese;Marshall Islands:Marshallese;Mauritius:Mauritian;Moldova:Moldovan;Mongolia:Mongolian;Mozambique:Mozambican;"
  + "Myanmar:Burmese,Burma;Netherlands:Dutch;Nicaragua:Nicaraguan;North Korea:North Korean,DPRK;Oman:Omani;Palau:Palauan;Panama:Panamanian;"
  + "Romania:Romanian;Russia:Russian,Russian Federation;Seychelles:Seychellois;Sierra Leone:Sierra Leonean;Singapore:Singaporean;"
  + "Somalia:Somali;South Sudan:South Sudanese;Spain:Spanish;Sri Lanka:Sri Lankan;Sudan:Sudanese;Suriname:Surinamese;Syria:Syrian;"
  + "Tanzania:Tanzanian;Togo:Togolese;Tunisia:Tunisian;Turkey:Turkish,Türkiye;Tuvalu:Tuvaluan;Ukraine:Ukrainian;United Arab Emirates:Emirati;"
  + "United Kingdom:British;United States:American;Vanuatu:Ni-Vanuatu;Venezuela:Venezuelan;Vietnam:Vietnamese;Yemen:Yemeni")
  .split(";").map((pair) => pair.split(":")).map(([label, aliases]) => [label, aliases.split(",")]));
const word = (w) => w.trim().replace(/\s+/g, " ").toLowerCase();

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
  const groups = new Set([...fleet.map((n) => n.program_group), ...read("stories/who-lobbies/influence-network/kg.json").nodes.map((n) => n.g)].filter((g) => typeof g === "string" && !BUCKETS.has(g)));
  const topic = (kind, key, label) => ({ kind, key, label, aliases: ALIASES.get(label) ?? [] });
  const topics = [
    ...[...programmes.values()].map((p) => topic("programme", p, p)),
    ...countries.map(([cc, name]) => topic("country", cc, name)),
    ...[...groups].map((g) => topic("group", g, GROUP_LABELS[g] ?? g[0].toUpperCase() + g.slice(1))),
  ];
  // a word shared by several topics ("Iran": the programme, the country and the group) is the first: programme, then country, then group
  const byWord = new Map();
  for (const t of topics) for (const w of [t.label, ...t.aliases].map(word)) if (!byWord.has(w)) byWord.set(w, t);
  return { topics, byWord };
}

/** VOCAB.topics: every topic as {kind: "programme"|"country"|"group", key, label, aliases}, built on first use. */
export const VOCAB = { get topics() { return (built ??= build()).topics; } };

/** The topic a word names, as {kind, key, label}, or null when it is not a topic's label or alias, whole. */
export function topicOf(w) {
  const t = typeof w === "string" ? (built ??= build()).byWord.get(word(w)) : undefined;
  return t ? { kind: t.kind, key: t.key, label: t.label } : null;
}
