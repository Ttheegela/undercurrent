import { test, before, after, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TOOLS, runTool, resetAskCache } from "../api/_ask_tools.js";
import { INDEX_URL, resetIndexCache } from "../api/search.js";
import { CONNECTIONS_URL, LOBBYING_URL, resetConnectionsCache } from "../api/connections.js";
import { normalizeName } from "../app/normalize.js";

// ---- a small site on disk: the tools read it from process.cwd() ---------------------------------------------------

const rec = (name, program, date, ref, imo = "", url = "") => [name, normalizeName(name), program, date, ref, imo, url]; // the stored key is the normalised name, as in the real lists
const LISTS = {
  us: [
    rec("TASSOS", "Iran", "", "54815", "9408695"),
    rec("TASSOS STAR", "Iran", "2025-07-30", "54816", "1111111"),
    rec("A & C International Trade, Inc.", "ITAR Debarred (DTC)", "", "1d0250ee07264881a780d52291d13f77"),
    rec("ATLAS SHIP MANAGEMENT", "Terrorism, Iran", "", "29853"),
    rec("SOVCOMFLOT", "Russia", "2024-02-20", "SCF1"),
    rec("Tasson", "Entity List (EL)", "2010-01-01", "T1"),
    rec("ALI", "Iran", "", "A1"),
    rec("Shipping Ltd", "Russia", "", "SH1"),
    rec("Ship Management Ltd", "Russia", "", "SM1"),
    rec("ARES SHIPPING LIMITED", "Iran", "", "AR1"),
    rec("ABGO TRADING LIMITED", "Iran", "", "AB1"),
    rec("AREN SHIP MANAGEMENT", "Iran", "", "53099", "6088476"),
    ...Array.from({ length: 8 }, (_, i) => rec(`QUARTZ ${i}`, "Russia", "2024-01-0" + (i + 1), `Q${i}`)),
  ],
  uk: [rec("TASSOS", "Russia", "2026-02-24", "RUS3483", "9408695"), rec("Orion Ship Management", "Russia", "2025-03-03", "RUS777"), ...Array.from({ length: 8 }, (_, i) => rec(`QUARTZ UK ${i}`, "Russia", "2024-02-0" + (i + 1), `QU${i}`))],
  eu: [rec("Zulu Ships Management", "Russia", "2025-10-24", "EU-9", "", "https://eur-lex.europa.eu/example")],
  un: [rec("Unrelated Group", "Somalia", "2010-01-01", "SOe.001")],
};
const META = { lists: Object.fromEntries(["us", "uk", "eu", "un"].map((id) => [id, { label: id, status: "fresh", updated_at: "2026-10-20T15:57:29Z", record_count: 1 }])) };

const entry = (o) => ({ kind: "Oil Tanker", imo: null, flag: null, manager: null, country: null, role: null, listings: [], events: [], facts: [], names: [], flags: [], sources: [], story: { label: "Open on the shadow-fleet map", url: "stories/shadow-fleet/network/shadow_fleet_map.html" }, ...o, keys: o.keys ?? [o.name.toUpperCase()] });
const RESEARCH = [
  entry({
    id: "IMO9408695", name: "TASSOS", imo: "9408695", flag: "Liberia", manager: "THE ZULU SHIPS MANAGEMENT AND OPERATION - SOLE PROPRIETORSHIP L.L.C",
    role: "tanker (both UK Russia list and US Iran-programme list)",
    listings: [{ by: "United States", date: "2025-07-30", program: "Iran", ref: 1 }, { by: "European Union", date: "2025-10-24", program: "Russia", ref: 2 }, { by: "United Kingdom", date: "2026-02-24", program: "Russia", ref: 3 }],
    facts: [{ text: "Listed by the United States on 30 July 2025 (Iran), the European Union on 24 October 2025 (Russia) and the United Kingdom on 24 February 2026 (Russia).", refs: [1, 2, 3] }, { text: "9 September 2024: Managed by the Zulu Ships Management & Operation - Sole Proprietorship LLC.", refs: [4] }, { text: "Has also sailed as Bay Global and Front Balder.", refs: [4] }],
    names: [{ name: "TASSOS", current: true }, { name: "Bay Global", current: false }], flags: ["Liberia", "Panama"],
    sources: [{ n: 1, label: "US Treasury OFAC sanctions list entry", url: "https://sanctionssearch.ofac.treas.gov/Details.aspx?id=54815" }, { n: 2, label: "EU Official Journal (EUR-Lex)", url: "https://eur-lex.europa.eu/eli/reg/2014/833/oj" }, { n: 3, label: "UK Sanctions List entry", url: "https://search-uk-sanctions-list.service.gov.uk/?searchValue=RUS3483" }],
  }),
  entry({
    id: "IMO1111111", name: "TASSOS STAR", imo: "1111111", flag: "Panama",
    listings: [{ by: "United States", date: "2025-07-30", program: "Iran", ref: 1 }],
    facts: [{ text: "Listed by the United States on 30 July 2025 (Iran).", refs: [1] }],
    sources: [{ n: 1, label: "US Treasury OFAC sanctions list entry", url: "https://sanctionssearch.ofac.treas.gov/Details.aspx?id=54816" }],
  }),
  entry({
    id: "org:rusal", name: "United Company RUSAL", kind: "Company", country: "Russia", story: { label: "Open the lobbying network", url: "stories/who-lobbies/clean-names-graph/index.html" },
    listings: [{ by: "US Treasury sanctions list", date: "2018-04-06 (delisted 2019-01)", program: "", ref: 1 }],
    facts: [{ text: "Appears on the US Treasury list from 2018; removed in 2019.", refs: [1] }],
    sources: [{ n: 1, label: "US Treasury press release", url: "https://home.treasury.gov/news/press-releases/sm0000" }],
  }),
  entry({
    id: "org:lukoil", name: "PAO LUKOIL", kind: "Company", story: { label: "Open the lobbying network", url: "stories/who-lobbies/clean-names-graph/index.html" },
    listings: [{ by: "EU and UK sanctions lists", date: "2025", program: "", ref: 1 }],
    facts: [{ text: "On the EU and UK lists from 2025.", refs: [1] }], sources: [{ n: 1, label: "Findings", url: "stories/who-lobbies/FINDINGS.html" }],
  }),
  entry({
    id: "co:zed", name: "ZED HOLDING", kind: "Company", listings: [{ by: "United States", date: "2024-01-01", program: "Iran", ref: 1 }],
    facts: [{ text: "Listed by the United States on 1 January 2024 (Iran).", refs: [1] }], sources: [{ n: 1, label: "OFAC", url: "https://sanctionssearch.ofac.treas.gov/Details.aspx?id=2" }],
  }),
  entry({
    id: "co:smic", name: "SMIC", kind: "Company", listings: [{ by: "US export-control Entity List", date: "2020-12", program: "", ref: 1 }],
    facts: [{ text: "On the US Entity List from December 2020.", refs: [1] }], sources: [{ n: 1, label: "Federal Register", url: "https://www.federalregister.gov/s" }],
  }),
  entry({
    id: "co:magnolia", name: "MAGNOLIA", kind: "Company", listings: [{ by: "United States", date: "", program: "Iran", ref: 1 }],
    facts: [{ text: "Listed by the United States (Iran).", refs: [1] }], sources: [{ n: 1, label: "OFAC", url: "https://sanctionssearch.ofac.treas.gov/Details.aspx?id=1" }],
  }),
  entry({
    id: "co:proto", name: "PROTOTYPE HOLDINGS", kind: "Company", listings: [{ by: "constructor", date: "2020-01-01", program: "toString", ref: 1 }],
    facts: [{ text: "A listing whose list is named like an Object property.", refs: [1] }], sources: [{ n: 1, label: "Findings", url: "https://example.org/p" }],
  }),
  entry({
    id: "co:hikvision", name: "Hikvision", kind: "Company", story: { label: "Open the lobbying network", url: "stories/who-lobbies/clean-names-graph/index.html" },
    listings: [{ by: "US export-control Entity List", date: "2019-10-09", program: "", ref: 1 }],
    facts: [{ text: "On the US Entity List since 9 October 2019.", refs: [1] }],
    sources: [{ n: 1, label: "Federal Register", url: "https://www.federalregister.gov/x" }],
  }),
  entry({
    id: "co:bucket", name: "Bucket Trader", kind: "Company", listings: [{ by: "European Union", date: "2026-07-23", program: "Both", ref: 1 }, { by: "United Kingdom", date: "2026-07-24", program: "Other", ref: 1 }],
    facts: [{ text: "Listed by the European Union on 23 July 2026 (Both).", refs: [1] }], sources: [{ n: 1, label: "EU Official Journal", url: "https://eur-lex.europa.eu/x" }],
  }),
  entry({ id: "co:orion", name: "Orion Ship Management Partners", kind: "Company", keys: ["ORION SHIP MANAGEMENT PARTNERS", "HIDDEN FORMER MGMT SHIP"] }),
  entry({ id: "co:unlisted-777", name: "unlisted ship manager", kind: "Company", keys: ["UNLISTED SHIP MANAGER"] }),
  ...Array.from({ length: 7 }, (_, i) => entry({ id: `co:pearl${i}`, name: `Pearl Ship Management ${i}`, kind: "Company" })),
  entry({ id: "co:unlisted", name: "Nobody Holdings", kind: "Company", facts: [{ text: "Linked to 2 ships in our research.", refs: [1] }], sources: [{ n: 1, label: "Findings", url: "https://example.org/f" }] }),
  ...Array.from({ length: 5 }, (_, i) => entry({ id: `IMO70000${i}`, name: `AMBER ${i}`, listings: [], sources: [] })),
];

const ship = (n, date, o = {}) => ({ date, graph: "fleet", kind: "added", item: "node", id: `IMO${1000000 + n}`, name: `SHIP ${n}`, node_type: "ship", summary: `New on the map: SHIP ${n}`, source_url: "https://example.org/list", source_label: "UK Sanctions List", ...o });
const lobbyEdge = (n, date) => ({ date, graph: "lobby", kind: "added", item: "edge", id: `e:${n}`, name: "NVIDIA → H.R.8800", node_type: "lobbied_on", endpoints: ["NVIDIA", "H.R.8800"], endpoint_ids: ["co:nvidia", "bill:hr8800"], summary: "NVIDIA lobbied on H.R.8800", source_url: "https://lda.gov/filings/public/filing/x/print/", source_label: "US Senate lobbying disclosure (LDA)" });
const FRESH = { us: "fresh", uk: "fresh", eu: "fresh", un: "fresh", lobbying: "fresh" };
const CHANGES = {
  started: "2026-10-12", first_run: "2026-10-12",
  days: [
    { date: "2026-10-19", sources: FRESH, changes: Array.from({ length: 35 }, (_, i) => ship(i, "2026-10-19")) },
    { date: "2026-10-18", sources: { ...FRESH, us: "unavailable", un: "unavailable" }, changes: [lobbyEdge(1, "2026-10-18"), lobbyEdge(2, "2026-10-18")] },
    { date: "2026-10-17", sources: { ...FRESH, lobbying: "unavailable" }, changes: [ship(99, "2026-10-17", { kind: "changed", field: "listed_by", from: ["UK"], to: ["UK", "EU"], id: "IMO1000099", name: "TASSOS", summary: "EU listed TASSOS (IMO 9408695)" })] },
    { date: "2026-10-13", sources: FRESH, changes: [] },
    { date: "2026-10-12", sources: FRESH, changes: [] },
  ],
};
const STATS = { fleet: { ships: 1747, companies: 1037 }, generated: "2026-10-20", opensanctions_sources: 95 };
const section = (id, title, text, page = "stories/about-the-data.html") => ({ id: `${page}#${id}`, page, title, text, url: `/${page}#${id}` });
const DOCS = {
  sections: [
    section("graphs", "How the graphs rebuild", "The graphs now show {{stat:fleet.ships}} ships and {{stat:fleet.companies}} companies, rebuilt every night from the lists. Last build: {{stat:generated}}. Unknown: {{stat:nope.nothing}}."),
    section("reproduce", "Reproduce", "Rebuild the graphs: run the build. " + "graphs rebuild ".repeat(40), "stories/shadow-fleet/network/METHOD.html"),
    section("matching", "How matching works", "Names are compared after removing accents and punctuation. A seven-digit number is treated as an IMO number."),
    section("lanterns", "Lantern facts", `Overview. The U.S. Treasury acted on 1 May. ${Array.from({ length: 25 }, (_, i) => `Lantern fact ${i + 1} is recorded here.`).join(" ")}`),
    // the real findings' shape: listings that name an entity (or point at one) beside a sentence that doesn't
    section("rusal", "Rusal's removal from the US list", "6 April 2018: OFAC listed Oleg Deripaska, En+, Rusal and EuroSibEnergo. Deripaska himself stayed on the US list, and the EU added him on 8 April 2022. The US listed it in July 2023. 19 December 2018 OFAC told Congress it would remove the companies. Contested: Treasury negotiated the deal, and the vote split largely along party lines.", "stories/who-lobbies/FINDINGS.html"),
    section("tools", "The main tools", "Asset freeze (also called blocking). \"An asset freeze means nobody may pay a blocked person.\" Names are compared after removing endings such as LLC or OOO. Companies owned by a listed party can be blocked without being named. Hollow shapes run listed ships but are on no list themselves.", "stories/how-sanctions-work/index.html"),
  ],
};
const CHIPS = {
  "summary.json": { median_months: 20.3, n: 25 },
  "listing_lag.json": {
    firms: [
      { ofac_id: "1", name: "Milur Electronics", countries: ["AM"], founded: "2022-08-01", listed: "2023-02-14", months: 6.1, bis: null, reason: "Armenia-based affiliate set up to order microchips", release: "jy1102", on_current_list: true },
      { ofac_id: "2", name: "Allparts Trading", countries: ["AE"], founded: "2022-10-01", listed: "2024-10-30", months: 24.9, bis: { date: "2023-04-12", name: "Allparts Trading", federal_register: "88 FR 23332" }, reason: "shipped electronic integrated circuits", release: "jy2700", on_current_list: true },
      { ofac_id: "3", name: "Old Electronics", countries: ["IN"], founded: "2008-01-04", listed: "2024-10-30", months: 201.8, bis: null, reason: "used to procure microelectronics", release: "jy2700", on_current_list: true },
      { ofac_id: "4", name: "Undated Logistics", countries: ["CN"], founded: null, listed: "2024-10-30", months: null, bis: null, reason: "shipped components", release: "jy2700", on_current_list: true },
    ],
    releases: {
      jy1102: { date: "2022-11-14", title: "Treasury Sanctions Global Russian Military Supply Chain", url: "https://home.treasury.gov/news/press-releases/jy1102" },
      jy2700: { date: "2024-10-30", title: "Treasury Takes Aim at Third-Country Sanctions Evaders", url: "https://home.treasury.gov/news/press-releases/jy2700" },
    },
    summary: { curated_new: { n: 25, median_months: 20.3, p25_months: 16.1, p75_months: 25.8 }, curated_total: 64, curated_without_founding_date: 4, curated_founded_before_invasion: 35, wider_base: { n: 129, median_months: 18.2, p25_months: 12.3, p75_months: 23.6 } },
    definition: "months = (OFAC listing date - OFAC 'Organization Established Date') / 30.44 days",
    ofac_date_of_issue: "2026-10-15", retrieved: "2026-10-20",
  },
  "routes.json": {
    hs: "8542", years: [2024, 2025], retrieved: "2026-10-20",
    senders: [{ iso3: "HKG", name: "China, Hong Kong SAR", group: "hk-china", usd: [172030748, 189901921] }, { iso3: "NLD", name: "Netherlands", group: "other", usd: [4075, 0] }],
    all_reporters_usd: [299964286, 260143627], reporters_with_row: [18, 11], russia_imports_usd: [null, null],
    eu27_exports_eur: { RU: [109625, 28501], KZ: [6100375, 6596420] },
  },
  "coverage.json": { years: [2024, 2025], retrieved: "2026-10-20", names: { DEU: "Germany", NLD: "Netherlands", FRA: "France" }, by_year: { 2024: { row: ["NLD"], none: ["DEU"] }, 2025: { row: [], none: ["DEU", "NLD"] } } },
};

const write = (root, rel, value) => {
  mkdirSync(join(root, rel, ".."), { recursive: true });
  writeFileSync(join(root, rel), JSON.stringify(value));
};
function buildSite(root) {
  for (const [id, records] of Object.entries(LISTS)) write(root, `data/lists/${id}.json`, { list: id, records });
  write(root, "data/lists/meta.json", META);
  write(root, "data/research-index.json", { entries: RESEARCH });
  write(root, "data/changes/changes.json", CHANGES);
  write(root, "data/site-stats.json", STATS);
  write(root, "data/ask-docs.json", DOCS);
  for (const [file, doc] of Object.entries(CHIPS)) write(root, `stories/chips-into-russia/data/${file}`, doc);
}

// ---- release assets, stubbed -------------------------------------------------------------------------------------

const osIndex = {
  updated_at: "2026-10-20T04:00:00Z",
  entities: [
    ["NK-k837moN9ssPZedvkRUrexG", "Vessel", "9408695", "Canada, EU, UK, Switzerland, US", ["TASSOS"]],
    ["NK-x1", "Vessel", "1111111", "US", ["TASSOS STAR"]],
    ["NK-x2", "Company", "", "EU", ["Sovcomflot PJSC", "SCF Group"]],
    ["NK-orion", "Company", "", "EU", ["Orion Ship Management Holdings"]],
    ["NK-ua", "Company", "", "Ukraine War and Sanctions", ["Orion Ship Management Group"]], // a guard: GUR's database alone is not a listing (its title; no such value in the real index)
    ["NK-ua2", "Company", "", "Ukraine GUR war-sanctions database", ["Orion Ship Management Syndicate"]],
    ["NK-nsdc", "Person", "", "Ukraine", ["CHANTURIA IRAKLI", "Chanturiia Irakli"]], // real shape: Ukraine's own sanctions carry the label "Ukraine"
    ["NK-meti", "Organization", "", "Japan METI End User List", ["Kuroda Precision Works"]], // real shape: an entry with no programme id carries its dataset's title
    ["NK-multi", "Company", "", "Australia, Canada, EU, UK, New Zealand, Switzerland, Ukraine, US", ["Baltic Carrier Works"]],
  ],
};
const T = "NK-k837moN9ssPZedvkRUrexG";
const graphDoc = {
  updated_at: "2026-10-14T04:00:00Z",
  entities: [
    [T, "Vessel", ["TASSOS", "Tassos"], "9408695", ["US", "UK"]],
    ["Z", "Organization", ["Zulu Ships Management"], "", ["US", "UK"]],
    ["H", "Person", ["Hossein Shamkhani"], "", ["US"]],
    ["SOV1", "Company", ["SOVCOMFLOT"], "", ["US"]],
    ["SOV2", "Company", ["SOVCOMFLOT"], "", ["UK"]],
    ...Array.from({ length: 8 }, (_, i) => [`S${i}`, "Vessel", [`SHIP ${i}`], "", ["US"]]),
  ],
  links: [
    [T, "Z", "Ownership", "Property in the interest of", ["US", "UK"]],
    ...Array.from({ length: 8 }, (_, i) => [`S${i}`, "Z", "Ownership", "Property in the interest of", ["US"]]),
    ["Z", "H", "UnknownLink", "Providing support to", ["US"]],
    ["SOV2", "Z", "UnknownLink", "Linked to", ["UK"]],
  ],
};
const lobbyDoc = {
  updated_at: "2026-10-14T04:00:00Z", filings_kept: 3, filings_scanned: 3, exclude_lobbyists: ["Hidden Person"],
  nodes: [
    { id: "co:nord-stream-2", type: "company", name: "Nord Stream 2 AG", lda_names: ["NORD STREAM 2 AG"] },
    { id: "lf:capitol-counsel", type: "lobbyfirm", name: "Capitol Counsel LLC" },
    { id: "p:jane-example", type: "person", name: "Jane Example", covered_positions: ["Legislative Assistant, Sen. Smith"] },
    { id: "p:hidden-person", type: "person", name: "Hidden Person" },
    { id: "gov:us-senate", type: "government", name: "US Senate" },
    { id: "bill:s722", type: "bill", name: "S.722", title: "S.722 Countering Iran's Destabilizing Activities Act (2017)" },
    { id: "co:gazprom", type: "company", name: "Gazprom" },
  ],
  edges: [
    { source: "co:nord-stream-2", target: "lf:capitol-counsel", type: "hired", n_filings: 12, amount: 1230000, years: [2017, 2022], source_url: "https://lda.gov/filings/public/filing/u1/print/" },
    { source: "p:jane-example", target: "lf:capitol-counsel", type: "lobbyist_at", n_filings: 4, years: [2017, 2018], source_url: "https://lda.gov/x" },
    { source: "p:jane-example", target: "co:nord-stream-2", type: "lobbied_for", n_filings: 4, years: [2017, 2018], source_url: "https://lda.gov/x" },
    { source: "p:hidden-person", target: "co:nord-stream-2", type: "lobbied_for", n_filings: 1, years: [2018, 2018], source_url: "https://lda.gov/x" },
    { source: "p:jane-example", target: "gov:us-senate", type: "formerly_served_in", n_filings: 4, years: [2017, 2018], source_url: "https://lda.gov/x" },
    { source: "lf:capitol-counsel", target: "gov:us-senate", type: "lobbied", client: "co:nord-stream-2", n_filings: 9, years: [2017, 2022], source_url: "https://lda.gov/x" },
    { source: "lf:capitol-counsel", target: "bill:s722", type: "lobbied_on", client: "co:nord-stream-2", n_filings: 5, years: [2017, 2018], source_url: "https://lda.gov/x" },
    { source: "co:gazprom", target: "co:nord-stream-2", type: "foreign_entity_of", n_filings: 3, texts: ["50% of NS2 operating budget"], ownership_pct: "50", years: [2017, 2019], source_url: "https://lda.gov/y" },
  ],
  bridges: {
    links: [{ from: "Gazprom", relation: "owns", to: "Gazprom Neft", grade: "documented", date: "2014-09-12", source_url: "https://home.treasury.gov/news/press-releases/jl2629" }],
    no_lobbying_found: ["Sovcomflot", "Zulu Ships Management"],
  },
};
const realFetch = globalThis.fetch;
function serve({ os = osIndex, graph = graphDoc, lobby = lobbyDoc } = {}) {
  const docs = { [INDEX_URL]: os, [CONNECTIONS_URL]: graph, [LOBBYING_URL]: lobby };
  globalThis.fetch = async (url) => {
    const doc = docs[url];
    return doc ? new Response(gzipSync(JSON.stringify(doc))) : new Response("no", { status: 404 });
  };
}

// ---- harness ---------------------------------------------------------------------------------------------------

const TODAY = { today: "2026-10-20" };
const home = process.cwd();
let root;
let ev;
const run = (name, args, ctx = TODAY) => runTool(name, args, ev, ctx);
const ofKind = (kind) => ev.filter((e) => e.kind === kind);

before(() => {
  root = mkdtempSync(join(tmpdir(), "ask-tools-"));
  buildSite(root);
  process.chdir(root);
});
after(() => {
  process.chdir(home);
  rmSync(root, { recursive: true, force: true });
});
beforeEach(() => {
  ev = [];
  resetAskCache();
  resetIndexCache();
  resetConnectionsCache();
  serve();
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

// ---- check_lists -----------------------------------------------------------------------------------------------

test("check_lists finds TASSOS on UK and US with evidence ids S1…", async () => {
  const out = await run("check_lists", { query: "TASSOS" });
  assert.deepEqual(ev.map((e) => e.id), ev.map((_, i) => `S${i + 1}`));
  assert.deepEqual(out.items.map((i) => i.id), ev.map((e) => e.id));
  assert.equal(ev[0].kind, "search");
  assert.deepEqual([ev[0].query, ev[0].found], ["TASSOS", true]);
  const us = ofKind("list").find((e) => e.gov === "us" && e.entity.name === "TASSOS");
  const uk = ofKind("list").find((e) => e.gov === "uk" && e.entity.name === "TASSOS");
  assert.ok(us && uk);
  assert.equal(us.program, "Iran");
  assert.equal(us.date, undefined); // the US record carries no date
  assert.equal(uk.program, "Russia");
  assert.equal(uk.date, "2026-02-24");
  assert.equal(uk.entity.imo, "9408695");
  // the record's own identity and both date forms are in the text the model may repeat
  assert.match(uk.text, /RUS3483/);
  assert.match(uk.text, /24 Feb 2026/);
  assert.match(uk.text, /2026-02-24/);
  assert.match(uk.text, /United Kingdom/);
  assert.match(us.text, /54815/);
  assert.match(us.text, /no listing date/i);
  assert.match(uk.url, /RUS3483/);
  assert.match(us.url, /Details\.aspx\?id=54815/);
});

test("check_lists unknown name gives one search item with found:false", async () => {
  const out = await run("check_lists", { query: "Gatik Ship Management" });
  assert.equal(ev.length, 1);
  assert.equal(ev[0].kind, "search");
  assert.equal(ev[0].found, false);
  assert.equal(ev[0].query, "Gatik Ship Management");
  assert.doesNotMatch(ev[0].text, /Gatik/); // the reader's words stay in `query`
  assert.equal(out.found, false);
  assert.deepEqual(ev[0].near, []); // ATLAS SHIP MANAGEMENT shares two words but GATIK is not a spelling of ATLAS
  assert.equal("near" in out.items[0], false);
});

test("check_lists returns near names for an abbreviated query", async () => {
  const out = await run("check_lists", { query: "Orion Ship Mgmt" });
  assert.equal(ev.length, 1); // near names are never evidence items
  assert.equal(ev[0].found, false);
  // research, official list and OpenSanctions, shortest first; the entry known only from Ukraine's database is not offered
  assert.deepEqual(ev[0].near, ["Orion Ship Management", "Orion Ship Management Holdings", "Orion Ship Management Partners"]);
  assert.deepEqual(out.items[0].near, ev[0].near);
  // the names are in the field only, so no sentence can cite them as a fact
  assert.doesNotMatch(ev[0].text, /Management/);
  assert.match(ev[0].text, /not matches/);
  // a misspelling of a word in a longer name finds the same names
  ev = [];
  await run("check_lists", { query: "Orion Ship Managment" });
  assert.equal(ev[0].near.length, 3);
  assert.equal(ev[0].near[0], "Orion Ship Management");
});

test("check_lists: near names are the published name, never the alias that matched", async () => {
  await run("check_lists", { query: "Hidden Former Mgmt Shp" });
  assert.deepEqual(ev[0].near, ["Orion Ship Management Partners"]);
  assert.doesNotMatch(ev[0].near.join(" "), /hidden|former/i); // the alias the words matched on stays out
});

test("check_lists: near never offers a generic-company placeholder, and holds at most 5", async () => {
  await run("check_lists", { query: "Unlisted Ship Mgr" }); // would be two words plus an abbreviation of "unlisted ship manager"
  assert.deepEqual([ev[0].found, ev[0].near], [false, []]);
  ev = [];
  await run("check_lists", { query: "Pearl Ship Mgmt" });
  assert.equal(ev[0].near.length, 5);
  assert.ok(ev[0].near.every((n) => /^Pearl Ship Management \d$/.test(n)));
});

test("near is empty for a nonsense name, and for a strong match", async () => {
  await run("check_lists", { query: "Qwxzv Plmk" });
  assert.deepEqual([ev[0].found, ev[0].near], [false, []]);
  ev = [];
  await run("check_lists", { query: "Atlas Ship Management" });
  assert.deepEqual([ev[0].found, ev[0].near], [true, []]);
});

test("check_lists: a research entry no government lists is context, not a listing", async () => {
  await run("check_lists", { query: "Nobody Holdings" });
  assert.deepEqual(ev.map((e) => [e.kind, e.found, e.gov]), [["search", false, undefined], ["research", undefined, undefined]]);
  assert.match(ev[0].text, /None of them is a current government listing/);
  assert.match(ev[1].text, /Not listed by a government in our research/);
});

test("check_lists cites only strong matches: a query sharing just generic words with other names finds nothing", async () => {
  await run("check_lists", { query: "Gatik Ship Management" }); // two of three words match ATLAS SHIP MANAGEMENT and AREN SHIP MANAGEMENT
  assert.deepEqual(ev.map((e) => [e.kind, e.found]), [["search", false]]);
  ev = [];
  await run("check_lists", { query: "Atlas Ship Management" });
  assert.deepEqual(ev.map((e) => e.kind), ["search", "list"]);
  assert.match(ev[1].text, /Match: exact name/);
});

test("check_lists keeps TASSOS and TASSOS STAR as separate entities", async () => {
  await run("check_lists", { query: "TASSOS" });
  for (const kind of ["research", "list", "opensanctions"]) {
    const names = new Set(ofKind(kind).map((e) => e.entity.name));
    assert.ok(names.has("TASSOS") && names.has("TASSOS STAR"), `${kind}: ${[...names]}`);
  }
  const ids = ofKind("research").filter((e) => e.entity.name.startsWith("TASSOS")).map((e) => e.entity.id);
  assert.ok(ids.includes("IMO9408695") && ids.includes("IMO1111111"));
  // a hit's text names its own entity, and never the other one
  for (const e of ev.filter((x) => x.entity?.name === "TASSOS" && x.kind !== "search")) assert.doesNotMatch(e.text, /TASSOS STAR/);
  // the near match says so
  assert.match(ofKind("list").find((e) => e.entity.name === "TASSOS STAR").text, /not the exact name/);
  assert.match(ofKind("list").find((e) => e.gov === "uk").text, /exact name/);
});

test("check_lists: one research item per listing, with the listing's own government, programme and date", async () => {
  await run("check_lists", { query: "IMO 9408695" });
  const rs = ofKind("research");
  assert.deepEqual(rs.map((e) => [e.gov, e.program, e.date]), [["us", "Iran", "2025-07-30"], ["eu", "Russia", "2025-10-24"], ["uk", "Russia", "2026-02-24"]]);
  const eu = rs[1];
  assert.equal(eu.entity.id, "IMO9408695");
  assert.match(eu.text, /Manager: THE ZULU SHIPS MANAGEMENT/);
  assert.match(eu.text, /Managed by the Zulu Ships Management/);
  assert.match(eu.text, /Bay Global/);
  assert.match(eu.text, /24 Oct 2025/);
  assert.match(eu.url, /eur-lex/);
  assert.equal(eu.link, "/stories/shadow-fleet/network/shadow_fleet_map.html#focus=IMO9408695");
});

test("check_lists: a listing that names two governments carries no gov, but is a current listing", async () => {
  await run("check_lists", { query: "LUKOIL" });
  const rs = ofKind("research");
  assert.equal(rs.length, 1);
  assert.equal(rs[0].gov, undefined);
  assert.equal(rs[0].date, "2025");
  assert.equal(ev[0].found, true);
  assert.match(rs[0].text, /in 2025/);
});

test("check_lists: a delisted-only research listing is context and never makes found true (I5)", async () => {
  await run("check_lists", { query: "Rusal" });
  assert.equal(ev[0].found, false);
  assert.match(ev[0].text, /None of them is a current government listing/);
  const rs = ofKind("research");
  assert.equal(rs.length, 1);
  assert.equal(rs[0].delisted, true);
  assert.equal(rs[0].gov, undefined);
  assert.equal(rs[0].date, undefined);
  assert.match(rs[0].text, /delisted 2019-01/);
  assert.match(rs[0].text, /not a current listing/);
  assert.doesNotMatch(rs[0].text, /listed by/i); // nothing in it reads as "is listed by"
  assert.deepEqual(ev[0].near, []);
});

test("check_lists: the research index's Both and Other are not programmes and are not passed on as one", async () => {
  await run("check_lists", { query: "Bucket Trader" });
  const rs = ofKind("research");
  assert.deepEqual(rs.map((e) => [e.gov, e.program, e.date]), [["eu", undefined, "2026-07-23"], ["uk", undefined, "2026-07-24"]]);
  assert.doesNotMatch(rs.map((e) => e.text).join(" ").replace(/Listed by the European Union on 23 July 2026 \(Both\)\./g, ""), /\b(Both|Other) /);
  assert.match(rs[0].text, /This item: listed by the European Union on 23 Jul 2026 \(2026-07-23\)\./);
});

test("check_lists: a non-sanctions programme is kept verbatim and never called a sanction", async () => {
  await run("check_lists", { query: "A C International Trade" });
  const itar = ofKind("list")[0];
  assert.equal(itar.program, "ITAR Debarred (DTC)");
  assert.equal(itar.gov, "us");
  assert.doesNotMatch(itar.text, /sanction/i);
  await run("check_lists", { query: "Hikvision" });
  const el = ofKind("research").at(-1);
  assert.equal(el.gov, "us");
  assert.match(el.program, /US export-control Entity List/);
  assert.doesNotMatch(el.text, /sanction/i);
});

test("check_lists caps hits: 3 research entries, 5 per list, 3 OpenSanctions", async () => {
  await run("check_lists", { query: "AMBER" });
  assert.equal(new Set(ofKind("research").map((e) => e.entity.id)).size, 3);
  await run("check_lists", { query: "QUARTZ" });
  assert.equal(ofKind("list").filter((e) => e.gov === "us").length, 5);
  assert.equal(ofKind("list").filter((e) => e.gov === "uk").length, 5);
});

test("check_lists: OpenSanctions hits carry the entry, who lists it, and its page", async () => {
  await run("check_lists", { query: "Sovcomflot" });
  const os = ofKind("opensanctions");
  assert.equal(os.length, 1);
  assert.equal(os[0].entity.name, "Sovcomflot PJSC");
  assert.equal(os[0].gov, undefined);
  assert.equal(os[0].program, "EU");
  assert.equal(os[0].url, "https://www.opensanctions.org/entities/NK-x2/");
  assert.match(os[0].text, /SCF Group/);
  await run("check_lists", { query: "9408695" });
  assert.equal(ofKind("opensanctions").at(-1).entity.imo, "9408695");
  assert.equal(ofKind("opensanctions").at(-1).program, "Canada, EU, UK, Switzerland, US");
});

test("check_lists: OpenSanctions down is said, and is never read as 'not found'", async () => {
  serve({ os: { updated_at: "x" } }); // an index with no entities fails to load
  const out = await run("check_lists", { query: "TASSOS" });
  assert.equal(ev[0].found, true);
  assert.match(ev[0].text, /OpenSanctions could not be checked/);
  assert.ok(out.items.length > 1);
  ev = [];
  const none = await run("check_lists", { query: "Gatik Ship Management" });
  assert.match(none.error, /OpenSanctions/);
  assert.equal(ev.length, 0);
});

test("check_lists: the search item says when each official list was downloaded", async () => {
  await run("check_lists", { query: "TASSOS" });
  assert.match(ev[0].text, /20 Oct 2026/);
  assert.match(ev[0].text, /2026-10-20/);
});

// ---- changes ---------------------------------------------------------------------------------------------------

test("changes clamps to started and caps at 30 with total", async () => {
  // a range that starts before the first run and ends after it is clamped to the record, not "before the start"
  const out = await run("changes", { since: "2026-01-01", until: "2030-01-01" });
  assert.ok(ev.every((e) => e.before_start === undefined));
  assert.equal(out.from, "2026-10-12");
  assert.equal(out.to, "2026-10-20");
  assert.equal(out.total, 38);
  assert.equal(out.shown, 30);
  const changes = ofKind("change");
  assert.equal(changes.length, 30);
  assert.ok(changes.every((e) => e.date === "2026-10-19")); // newest day first
  assert.match(changes[0].text, /38 changes/);
  assert.match(changes[0].text, /12 Oct 2026/);
  assert.match(changes[0].summary, /New on the map: SHIP/);
  assert.equal(changes[0].link, "/stories/shadow-fleet/network/shadow_fleet_map.html#focus=IMO1000000&since=2026-10-19");
  assert.match(changes[0].text, /19 Oct 2026/);
  assert.match(changes[0].text, /2026-10-19/);
});

test("changes adds a gap item for each unavailable source-day in range", async () => {
  await run("changes", { since: "2026-10-17", until: "2026-10-19", graph: "fleet" });
  const gaps = ofKind("gap");
  assert.deepEqual(gaps.map((g) => [g.source, g.date]).sort(), [["The UN list", "2026-10-18"], ["The US list", "2026-10-18"]]);
  assert.match(gaps[0].text, /was unavailable on 18 Oct 2026 \(2026-10-18\)/);
  assert.match(gaps[0].url, /^\/stories\/updates\/index\.html\?from=2026-10-18&to=2026-10-18&graph=fleet$/);
  // the lobbying outage on the 17th is not the fleet graph's, but is the lobby graph's
  ev = [];
  await run("changes", { since: "2026-10-17", until: "2026-10-19", graph: "lobby" });
  assert.deepEqual(ofKind("gap").map((g) => [g.source, g.date]), [["The US lobbying data", "2026-10-17"]]);
  assert.equal(ofKind("change").length, 2);
  assert.equal(ofKind("change")[0].link, "/stories/who-lobbies/influence-network/index.html#focus=e:1&since=2026-10-18");
  // outside the range: no gaps
  ev = [];
  await run("changes", { since: "2026-10-19", until: "2026-10-19" });
  assert.equal(ofKind("gap").length, 0);
});

test("changes: an empty range is one change item that says so, with the range, plus any gaps", async () => {
  const out = await run("changes", { since: "2026-10-12", until: "2026-10-13" });
  assert.equal(out.total, 0);
  assert.equal(ev.length, 1);
  assert.deepEqual([ev[0].kind, ev[0].found, ev[0].from, ev[0].to], ["change", false, "2026-10-12", "2026-10-13"]);
  assert.match(ev[0].text, /No changes were recorded between 12 Oct 2026 and 13 Oct 2026/);
  ev = [];
  // a filter that leaves nothing, in a range that does hold changes, is not "no changes were recorded": only the gaps are reported
  const scoped = await run("changes", { since: "2026-10-18", until: "2026-10-18", graph: "fleet", query: "no such ship" });
  assert.deepEqual(ev.map((e) => e.kind), ["gap", "gap"]);
  assert.deepEqual([scoped.total, scoped.range_total], [0, 2]);
  ev = [];
  await run("changes", { since: "2026-10-12", until: "2026-10-13", graph: "lobby", query: "nobody" }); // the whole range is empty
  assert.deepEqual(ev.map((e) => [e.kind, e.found]), [["change", false]]);
});

test("changes: a range wholly before the first run is one before_start item, never 'no changes'", async () => {
  const out = await run("changes", { since: "2025-01-01", until: "2025-02-01" });
  assert.deepEqual([out.total, out.from, out.to], [0, "2025-01-01", "2025-02-01"]);
  assert.equal(ev.length, 1);
  const { kind, found, before_start: before, from, to, first_run: first } = ev[0];
  assert.deepEqual({ kind, found, before, from, to, first }, { kind: "change", found: false, before: true, from: "2025-01-01", to: "2025-02-01", first: "2026-10-12" });
  assert.match(ev[0].text, /^Daily updates started on 12 Oct 2026 \(2026-10-12\), so there is no record before then\./);
  assert.doesNotMatch(ev[0].text, /No changes were recorded/);
  assert.deepEqual(ev[0].quotes, []);
  // the day before the first run is still before it; the first run's own day is in the record
  ev = [];
  await run("changes", { since: "2026-10-01", until: "2026-10-11" });
  assert.equal(ev[0].before_start, true);
  ev = [];
  await run("changes", { since: "2026-10-01", until: "2026-10-12" });
  assert.deepEqual(ev.map((e) => [e.kind, e.found, e.before_start, e.from, e.to]), [["change", false, undefined, "2026-10-12", "2026-10-12"]]);
});

test("changes: query and graph narrow the list; a changed field is spelled out", async () => {
  const out = await run("changes", { since: "2026-10-12", query: "tassos" });
  assert.equal(out.total, 1);
  const c = ofKind("change")[0];
  assert.equal(c.entity.name, "TASSOS");
  assert.match(c.text, /EU listed TASSOS \(IMO 9408695\)/);
  assert.match(c.text, /Field listed_by: from UK to UK, EU/);
  assert.equal(c.url, "https://example.org/list");
  ev = [];
  assert.equal((await run("changes", { since: "2026-10-12", graph: "lobby" })).total, 2);
});

test("changes: an unsafe source url is replaced, never passed on", async () => {
  write(root, "data/changes/changes.json", { ...CHANGES, days: [{ date: "2026-10-19", sources: FRESH, changes: [ship(1, "2026-10-19", { source_url: "javascript:alert(1)" })] }] });
  try {
    resetAskCache();
    await run("changes", { since: "2026-10-12" });
    assert.match(ev[0].url, /^\/stories\/updates\/index\.html/);
  } finally {
    write(root, "data/changes/changes.json", CHANGES);
  }
});

// ---- connections -----------------------------------------------------------------------------------------------

test("connections honours exclude_lobbyists", async () => {
  await run("connections", { query: "Nord Stream 2 AG" });
  const all = JSON.stringify(ev);
  assert.doesNotMatch(all, /Hidden Person/);
  assert.match(all, /Jane Example/);
  const lobby = ofKind("lobbying");
  assert.ok(lobby.length >= 3);
  assert.match(lobby[0].text, /Capitol Counsel LLC/);
  assert.match(lobby[0].text, /12 filings/);
  assert.match(lobby[0].text, /\$1,230,000/);
  assert.match(lobby.map((e) => e.text).join(" "), /Gazprom/);
  assert.match(lobby.map((e) => e.text).join(" "), /Gazprom Neft/);
  assert.equal(lobby[0].entity.name, "Nord Stream 2 AG");
  assert.equal(lobby[0].link, "/stories/who-lobbies/influence-network/index.html#focus=co:nord-stream-2");
  assert.match(lobby[0].url, /^https:\/\/lda\.gov\//);
  // a lobbyist is never looked up as a client
  ev = [];
  await run("connections", { query: "Hidden Person" });
  assert.equal(ev.filter((e) => e.kind === "lobbying" && e.found !== false).length, 0);
});

test("connections: a ship's sanctions links name both ends, with the direction and who records them", async () => {
  const out = await run("connections", { query: "IMO 9408695" });
  const conn = ofKind("connection");
  assert.equal(conn[0].entity.name, "TASSOS");
  assert.equal(conn[0].entity.imo, "9408695");
  assert.equal(conn[0].url, `https://www.opensanctions.org/entities/${T}/`);
  assert.match(conn[0].text, /US, UK/);
  assert.equal(conn[0].link, "/stories/shadow-fleet/network/shadow_fleet_map.html#focus=IMO9408695");
  const zulu = conn.find((e) => /Property in the interest of/.test(e.text));
  assert.match(zulu.text, /TASSOS.*Property in the interest of.*Zulu Ships Management/);
  assert.match(zulu.text, /SHIP 0/); // the other ships the same company is linked to
  assert.match(zulu.text, /Hossein Shamkhani/);
  assert.equal(out.sanctions.matched, true);
});

test("connections: names shared by several entities are said, and an unknown name is a found:false item", async () => {
  await run("connections", { query: "Sovcomflot" });
  const head = ofKind("connection")[0];
  assert.match(head.text, /1 other entit/);
  ev = [];
  await run("connections", { query: "Acme Widgets" });
  const none = ofKind("connection")[0];
  assert.equal(none.found, false);
  assert.doesNotMatch(JSON.stringify(ev), /Acme Widgets/); // the reader's words are not evidence
  assert.match(none.text, /exact/i);
  // lobbying: tracked-and-empty differs from not tracked
  const lob = ofKind("lobbying");
  assert.equal(lob[0].found, false);
  assert.match(lob[0].text, /not one of the clients/);
  ev = [];
  await run("connections", { query: "Zulu Ships Management" });
  assert.match(ofKind("lobbying")[0].text, /found none|no filings/i);
});

test("connections: each asset fails alone", async () => {
  serve({ graph: { updated_at: "x" } });
  let out = await run("connections", { query: "Nord Stream 2 AG" });
  assert.equal(out.sanctions.available, false);
  assert.ok(ofKind("lobbying").length >= 1);
  resetConnectionsCache();
  globalThis.fetch = async () => new Response("no", { status: 404 });
  ev = [];
  out = await run("connections", { query: "Nord Stream 2 AG" });
  assert.match(out.error, /unavailable/);
  assert.equal(ev.length, 0);
});

// ---- chips -----------------------------------------------------------------------------------------------------

test("chips summary carries the median, its spread, the set and how months are counted", async () => {
  await run("chips", { topic: "summary" });
  assert.equal(ev.length, 1);
  assert.equal(ev[0].kind, "chips");
  for (const needle of ["20.3 months", "25 firms", "16.1", "25.8", "64 firms", "129", "18.2", "30.44", "15 Oct 2026", "2026-10-15", "14 Nov 2022", "30 Oct 2024"]) assert.ok(ev[0].text.includes(needle), needle);
  assert.match(ev[0].url, /^\/stories\/chips-into-russia\/FINDINGS\.html#2-how-long/);
});

test("chips listing_lag lists the firms founded after the invasion, shortest first, with an earlier Entity List date", async () => {
  await run("chips", { topic: "listing_lag" });
  const table = ev.find((e) => /Milur Electronics/.test(e.text));
  assert.ok(table);
  assert.ok(table.text.indexOf("Milur Electronics") < table.text.indexOf("Allparts Trading"));
  assert.match(table.text, /Armenia/);
  assert.match(table.text, /6\.1 months/);
  assert.match(table.text, /12 Apr 2023/);
  assert.match(table.text, /88 FR 23332/);
  assert.doesNotMatch(table.text, /Old Electronics|Undated Logistics/);
});

test("chips firms: one item per Treasury release, each with its page and the reasons", async () => {
  await run("chips", { topic: "firms" });
  assert.equal(ev.length, 2);
  const jy2700 = ev.find((e) => /jy2700/.test(e.text));
  assert.equal(jy2700.url, "https://home.treasury.gov/news/press-releases/jy2700");
  assert.match(jy2700.text, /30 Oct 2024/);
  assert.match(jy2700.text, /Allparts Trading \(United Arab Emirates\): shipped electronic integrated circuits/);
  assert.match(jy2700.text, /Undated Logistics \(China\)/);
});

test("chips routes and coverage: the figures, as the site states them", async () => {
  await run("chips", { topic: "routes" });
  const all = ev.map((e) => e.text).join("\n");
  assert.match(ev[2].text, /to each partner country[^]*To Kazakhstan: /);
  for (const needle of ["2024 $300M", "2025 $260M", "China, Hong Kong SAR", "$172M", "$4,075", "Netherlands", "EUR", "Kazakhstan", "18", "11"]) assert.ok(all.includes(needle), needle);
  ev = [];
  await run("chips", { topic: "coverage" });
  const cov = ev.map((e) => e.text).join("\n");
  assert.match(cov, /of the 3 countries that reported at least once: 2024: 1 reported a chip export row to Russia, 1 reported trade but no chip row, 1 did not report; 2025: 0 reported a chip export row to Russia, 2 reported trade but no chip row, 1 did not report/);
  assert.match(cov, /2024: Netherlands/);
  assert.match(cov, /not proof of zero trade/);
});

// ---- site_docs -------------------------------------------------------------------------------------------------

test("site_docs fills stat tokens from site-stats", async () => {
  await run("site_docs", { query: "how do the graphs rebuild" });
  const doc = ev[0];
  assert.equal(doc.kind, "doc");
  assert.match(doc.text, /1,747 ships and 1,037 companies/);
  assert.match(doc.text, /20 Oct 2026 \(2026-10-20\)/);
  assert.doesNotMatch(doc.text, /\{\{/);
  assert.doesNotMatch(doc.text, /nope/);
  assert.equal(doc.url, "/stories/about-the-data.html#graphs");
  assert.equal(doc.label, "How the graphs rebuild");
});

test("site_docs ranks explainer sections above maintainer notes", async () => {
  await run("site_docs", { query: "rebuild the graphs" });
  assert.deepEqual(ev.map((e) => e.label), ["How the graphs rebuild", "Reproduce"]);
  ev = [];
  await run("site_docs", { query: "how does matching work" });
  assert.equal(ev[0].label, "How matching works");
  ev = [];
  const out = await run("site_docs", { query: "zebra giraffe" });
  assert.deepEqual([ev.length, out.items.length], [0, 0]);
});

// ---- fix round 1: the review's findings --------------------------------------------------------------------------

test("C1: a listed ship asked with extra words in the query is never 'not found'", async () => {
  const forms = [
    "TASSOS (IMO 9408695)", "TASSOS IMO 9408695", "IMO: 9408695", "IMO no. 9408695", "imo 9408695", "TASSOS - IMO 9408695", "9408695",
    "MV TASSOS", "M/V TASSOS", "M.V. TASSOS", "M/T TASSOS", "TASSOS tanker", "the TASSOS vessel", "tanker TASSOS (oil tanker)",
  ];
  for (const query of forms) {
    ev = [];
    const out = await run("check_lists", { query });
    assert.equal(ev[0].found, true, query);
    assert.equal(out.found, true, query);
    const uk = ofKind("list").find((e) => e.gov === "uk" && e.entity.name === "TASSOS");
    assert.ok(uk, query);
    assert.match(uk.text, /Match: (IMO number|exact name)/, query);
    assert.ok(ofKind("research").some((e) => e.entity.id === "IMO9408695" && e.gov === "uk"), query);
  }
  // a short ship name keeps its match once the hull prefix is ignored
  ev = [];
  await run("check_lists", { query: "MV ALI" });
  assert.equal(ev[0].found, true);
  assert.equal(ofKind("list")[0].entity.name, "ALI");
});

test("C1: two IMO numbers in one query find both ships, and the words left over search nothing", async () => {
  await run("check_lists", { query: "IMO 9408695 and 1111111" });
  assert.equal(ev[0].found, true);
  const imos = new Set(ev.slice(1).map((e) => e.entity.imo));
  assert.deepEqual([...imos].sort(), ["1111111", "9408695"]);
});

test("C1: a listed company asked with a word added is offered as a near name, so 'not found' is never said", async () => {
  for (const query of ["Sovcomflot Group", "Sovcomflot Shipping"]) {
    ev = [];
    await run("check_lists", { query });
    assert.equal(ev[0].found, false, query);
    assert.ok(ev[0].near.some((n) => /^sovcomflot/i.test(n)), `${query}: ${ev[0].near}`);
    assert.equal(ev.length, 1, query); // offered, not cited
  }
});

test("C1: a one-word generic or very short name inside the query is not offered", async () => {
  for (const query of ["Atlantic Shipping", "Baba Ali Express"]) { // "Shipping Ltd" and "ALI" are listed
    ev = [];
    await run("check_lists", { query });
    assert.deepEqual([ev[0].found, ev[0].near], [false, []], query);
  }
});

test("C1 residual: a multi-word listed name made of short or generic words is offered when the query adds a word", async () => {
  for (const query of ["ARES SHIPPING LIMITED Group", "ABGO TRADING LIMITED Group", "ZED HOLDING Group", "Ares Shipping Co. LLC Group"]) {
    ev = [];
    await run("check_lists", { query });
    assert.equal(ev[0].found, false, query);
    assert.equal(ev.length, 1, query); // offered, not cited
    assert.ok(ev[0].near.length >= 1 && /^(ARES SHIPPING|ABGO TRADING|ZED HOLDING)/i.test(ev[0].near[0]), `${query}: ${ev[0].near}`);
  }
  // and the listed name itself is found as before
  ev = [];
  await run("check_lists", { query: "ARES SHIPPING LIMITED" });
  assert.equal(ev[0].found, true);
});

test("C1 residual: names made only of generic words, and one generic word, still offer nothing", async () => {
  for (const query of ["Shipping Group", "Ship Management Group", "Trading Group"]) { // "Shipping Ltd" and "Ship Management Ltd" are listed
    ev = [];
    await run("check_lists", { query });
    assert.deepEqual([ev[0].found, ev[0].near], [false, []], query);
  }
  ev = [];
  await run("check_lists", { query: "Sovcomflot Group" }); // a one-word name still needs 5+ letters
  assert.deepEqual(ev[0].near, ["SOVCOMFLOT"]);
});

test("C1: connections also finds the IMO or the bare name inside the query", async () => {
  for (const query of ["TASSOS (IMO 9408695)", "IMO: 9408695", "MV TASSOS"]) {
    ev = [];
    const out = await run("connections", { query });
    assert.equal(out.sanctions.matched, true, query);
    assert.equal(ofKind("connection")[0].entity.name, "TASSOS", query);
  }
});

test("I1: the reader's own words are never in an evidence text or label", async () => {
  const typed = "Jane Doe paid Wagner Group 5,000,000 dollars";
  await run("check_lists", { query: typed });
  assert.equal(ev[0].query, typed); // only the search item's field
  await run("changes", { since: "2026-10-12", query: "zebra quux" });
  await run("connections", { query: "Hidden Person" });
  await run("connections", { query: "Zebra Quux Holdings" });
  await run("site_docs", { query: "zebra quux matching" });
  for (const e of ev) {
    const shown = `${e.text} ${e.label}`;
    assert.doesNotMatch(shown, /Jane Doe|Wagner|5,000,000|zebra|quux|Hidden Person/i, e.id);
    if (e.kind !== "search") assert.equal(e.query, undefined, e.id);
  }
});

test("I2: gaps are merged into per-source runs, and none is dropped (36 down source-days)", async () => {
  const days = Array.from({ length: 9 }, (_, i) => ({ date: `2026-10-${String(12 + i).padStart(2, "0")}`, sources: { ...FRESH, us: "unavailable", uk: "unavailable", eu: "unavailable", un: "unavailable" }, changes: [] }));
  write(root, "data/changes/changes.json", { ...CHANGES, days: days.reverse() });
  try {
    resetAskCache();
    const out = await run("changes", { since: "2026-10-12", until: "2026-10-20" });
    const gaps = ofKind("gap");
    assert.deepEqual(gaps.map((g) => g.source).sort(), ["The EU list", "The UK list", "The UN list", "The US list"]);
    for (const g of gaps) {
      assert.deepEqual([g.from, g.to, g.date], ["2026-10-12", "2026-10-20", undefined]);
      assert.match(g.text, /^The (EU|UK|UN|US) list was unavailable from 12 Oct 2026 \(2026-10-12\) to 20 Oct 2026 \(2026-10-20\), so changes from it on those days aren't recorded\.$/);
      assert.equal(g.url, "/stories/updates/index.html?from=2026-10-12&to=2026-10-20&graph=fleet");
    }
    assert.deepEqual([out.gaps, out.gap_days], [4, 36]);
    assert.match(ev[0].text, /No changes were recorded between 12 Oct 2026 and 20 Oct 2026/); // and the empty item is still first
  } finally {
    write(root, "data/changes/changes.json", CHANGES);
  }
});

test("I2: a single down day keeps its date; two outages with a good night between are two runs", async () => {
  const day = (date, down) => ({ date, sources: { ...FRESH, ...Object.fromEntries(down.map((s) => [s, "unavailable"])) }, changes: [] });
  write(root, "data/changes/changes.json", { ...CHANGES, days: [day("2026-10-16", ["us"]), day("2026-10-15", []), day("2026-10-14", ["us", "eu"]), day("2026-10-13", ["us"]), day("2026-10-12", [])] });
  try {
    resetAskCache();
    await run("changes", { since: "2026-10-12", until: "2026-10-16" });
    const key = (g) => `${g.source} ${g.from} ${g.to} ${g.date}`;
    assert.deepEqual(ofKind("gap").map(key).sort(), [
      "The EU list 2026-10-14 2026-10-14 2026-10-14", "The US list 2026-10-13 2026-10-14 undefined", "The US list 2026-10-16 2026-10-16 2026-10-16",
    ]);
    assert.match(ofKind("gap").find((g) => g.date === "2026-10-16").text, /was unavailable on 16 Oct 2026 \(2026-10-16\), so changes from it that day aren't recorded\./);
  } finally {
    write(root, "data/changes/changes.json", CHANGES);
  }
});

test("I3: graph, tool and topic names are looked up without the prototype chain", async () => {
  for (const graph of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
    assert.match((await run("changes", { since: "2026-10-12", graph })).error, /graph must be/, graph);
  }
  for (const [name, args] of [["constructor", {}], ["__proto__", {}], ["toString", {}], ["chips", { topic: "constructor" }], ["chips", { topic: "__proto__" }]]) {
    assert.equal(typeof (await run(name, args)).error, "string", name);
  }
  assert.equal(ev.length, 0);
  // a list named like an Object property in the data is not the United States
  await run("check_lists", { query: "Prototype Holdings" });
  const r = ofKind("research")[0];
  assert.equal(r.gov, undefined);
  assert.match(r.text, /listed by constructor under toString on 1 Jan 2020/);
});

test("I4: the start of a word is not a strong match: it is a near name, and no note claims otherwise", async () => {
  await run("check_lists", { query: "TASS" });
  assert.deepEqual(ev.map((e) => [e.kind, e.found]), [["search", false]]);
  assert.ok(ev[0].near.includes("TASSOS") && ev[0].near.includes("Tasson"), ev[0].near.join("|"));
  ev = [];
  await run("check_lists", { query: "Sovcom" });
  assert.deepEqual(ev.map((e) => [e.kind, e.found]), [["search", false]]);
  assert.ok(ev[0].near.some((n) => /^sovcomflot/i.test(n)));
  // the whole word still is
  ev = [];
  await run("check_lists", { query: "Tasson" });
  assert.deepEqual(ev.map((e) => e.kind), ["search", "list"]);
  assert.match(ev[1].text, /Match: exact name/);
});

test("OpenSanctions authorities: real shapes. Ukraine's own sanctions and a dataset title are listings, verbatim; GUR's database alone is not", async () => {
  await run("check_lists", { query: "Chanturia Irakli" });
  let os = ofKind("opensanctions");
  assert.equal(ev[0].found, true);
  assert.deepEqual([os[0].entity.name, os[0].program, os[0].gov], ["CHANTURIA IRAKLI", "Ukraine", undefined]);
  assert.match(os[0].text, /Listed by, per OpenSanctions: Ukraine\./);
  ev = [];
  await run("check_lists", { query: "Kuroda Precision Works" });
  os = ofKind("opensanctions");
  assert.equal(ev[0].found, true);
  assert.equal(os[0].program, "Japan METI End User List");
  ev = [];
  await run("check_lists", { query: "Baltic Carrier Works" });
  assert.equal(ofKind("opensanctions")[0].program, "Australia, Canada, EU, UK, New Zealand, Switzerland, Ukraine, US");
  // the guard: an entry whose only authority is GUR's database is neither cited nor counted nor offered
  ev = [];
  await run("check_lists", { query: "Orion Ship Management Group" });
  assert.equal(ev[0].found, false);
  assert.equal(ofKind("opensanctions").length, 0);
  assert.ok(!ev[0].near.some((n) => /Group$/.test(n)));
  ev = [];
  await run("check_lists", { query: "Orion Ship Management Syndicate" }); // the other spelling of the guard
  assert.deepEqual([ev[0].found, ofKind("opensanctions").length], [false, 0]);
});

test("minors: an empty date keeps the government, a year or month reads 'in', a relative source url is made absolute, research items say how they matched", async () => {
  await run("check_lists", { query: "Magnolia" });
  let r = ofKind("research")[0];
  assert.deepEqual([r.gov, r.program, r.date], ["us", "Iran", undefined]);
  assert.match(r.text, /listed by the United States under Iran, no date recorded/);
  assert.match(r.text, /Match: exact name/);
  ev = [];
  await run("check_lists", { query: "SMIC" });
  assert.match(ofKind("research")[0].text, /in Dec 2020 \(2020-12\)/);
  ev = [];
  await run("check_lists", { query: "LUKOIL" });
  r = ofKind("research")[0];
  assert.equal(r.url, "/stories/who-lobbies/FINDINGS.html");
});

test("M7: nights absent from the record are gap runs by 'The nightly update', and never read as 'no changes'", async () => {
  const day = (date, changes = []) => ({ date, sources: FRESH, changes });
  // the nightly run skipped the 13th and 14th, and has not run since the 16th; today is the 20th, whose run may be still to come
  write(root, "data/changes/changes.json", { ...CHANGES, days: [day("2026-10-16", [ship(1, "2026-10-16")]), day("2026-10-15"), day("2026-10-12")] });
  try {
    resetAskCache();
    const out = await run("changes", { since: "2026-10-12", until: "2026-10-20" });
    const gaps = ofKind("gap");
    assert.deepEqual(gaps.map((g) => [g.source, g.from, g.to, g.date]), [["The nightly update", "2026-10-17", "2026-10-19", undefined], ["The nightly update", "2026-10-13", "2026-10-14", undefined]]);
    assert.equal(gaps[1].text, "The nightly update was unavailable from 13 Oct 2026 (2026-10-13) to 14 Oct 2026 (2026-10-14), so changes from it on those days aren't recorded.");
    assert.equal(gaps[0].url, "/stories/updates/index.html?from=2026-10-17&to=2026-10-19&graph=all");
    assert.deepEqual([out.gaps, out.missing_nights, out.gap_days, out.total], [2, 5, 0, 1]);
    // a graph filter does not hide a night that did not run
    ev = [];
    await run("changes", { since: "2026-10-12", until: "2026-10-20", graph: "lobby" });
    assert.deepEqual(ofKind("gap").map((g) => g.source), ["The nightly update", "The nightly update"]);
    // one missing night keeps the single-day wording and a date
    ev = [];
    await run("changes", { since: "2026-10-14", until: "2026-10-16" });
    assert.deepEqual(ofKind("gap").map((g) => [g.from, g.to, g.date]), [["2026-10-14", "2026-10-14", "2026-10-14"]]);
    assert.match(ofKind("gap")[0].text, /^The nightly update was unavailable on 14 Oct 2026 \(2026-10-14\), so changes from it that day aren't recorded\.$/);
    // a range with nothing in it and a night missing says the night is missing, not that there were no changes
    ev = [];
    const empty = await run("changes", { since: "2026-10-13", until: "2026-10-14" });
    assert.deepEqual(ev.map((e) => [e.kind, e.found, e.source]), [["gap", undefined, "The nightly update"]]);
    assert.deepEqual([empty.total, empty.missing_nights], [0, 2]);
    // and when every night in the range is held, it is "no changes" as before
    ev = [];
    await run("changes", { since: "2026-10-15", until: "2026-10-15" });
    assert.deepEqual(ev.map((e) => [e.kind, e.found]), [["change", false]]);
    // the nights after the latest one held are missing too, up to yesterday: a stalled job is not "no changes"
    ev = [];
    const stalled = await run("changes", { since: "2026-10-17", until: "2026-10-20" });
    assert.deepEqual(ev.map((e) => [e.kind, e.found, e.from, e.to]), [["gap", undefined, "2026-10-17", "2026-10-19"]]);
    assert.deepEqual([stalled.total, stalled.missing_nights], [0, 3]);
    assert.doesNotMatch(JSON.stringify(ev), /No changes were recorded/);
    ev = [];
    const week = await run("changes", { since: "2026-10-13" }); // "what changed this week", with a change on the 16th
    assert.equal(week.total, 1);
    assert.deepEqual(ofKind("gap").map((g) => [g.from, g.to]), [["2026-10-17", "2026-10-19"], ["2026-10-13", "2026-10-14"]]);
    // today itself is never flagged, and before its run it is simply not there yet
    ev = [];
    await run("changes", { since: "2026-10-20", until: "2026-10-20" });
    assert.deepEqual(ev.map((e) => [e.kind, e.found]), [["change", false]]);
    // with today as the 17th, the 17th is not flagged but the stretch up to it is
    ev = [];
    await run("changes", { since: "2026-10-12", until: "2026-10-20" }, { today: "2026-10-17" });
    assert.deepEqual(ofKind("gap").map((g) => [g.from, g.to]), [["2026-10-13", "2026-10-14"]]);
  } finally {
    write(root, "data/changes/changes.json", CHANGES);
  }
});

// ---- arguments, tool list, invariants --------------------------------------------------------------------------

test("bad args (bad date, query over 200 chars, unknown topic) return {error} and add no evidence", async () => {
  const bad = [
    ["check_lists", {}], ["check_lists", { query: "x" }], ["check_lists", { query: "a".repeat(201) }], ["check_lists", { query: 5 }], ["check_lists", { query: "Совкомфлот" }],
    ["connections", { query: "" }], ["connections", { query: "b".repeat(201) }],
    ["changes", {}], ["changes", { since: "2026-13-45" }], ["changes", { since: "yesterday" }], ["changes", { since: "2026-10-12", until: "2026-02-30" }],
    ["changes", { since: "2026-10-19", until: "2026-10-12" }], ["changes", { since: "2026-10-12", graph: "both" }], ["changes", { since: "2030-01-01" }], ["changes", { since: "2026-10-12", query: "q".repeat(201) }],
    ["chips", { topic: "bogus" }], ["chips", {}], ["site_docs", { query: "z".repeat(201) }], ["site_docs", { query: " " }],
    ["nope", {}], ["answer", {}], ["constructor", {}],
  ];
  for (const [name, args] of bad) {
    const out = await run(name, args);
    assert.equal(typeof out.error, "string", `${name} ${JSON.stringify(args).slice(0, 40)}`);
  }
  assert.equal((await run("check_lists", null)).error !== undefined, true);
  assert.equal(ev.length, 0);
});

test("TOOLS are OpenAI function definitions for the six tools", () => {
  assert.deepEqual(TOOLS.map((t) => t.function.name), ["check_lists", "connections", "changes", "chips", "site_docs", "answer"]);
  for (const t of TOOLS) {
    assert.equal(t.type, "function");
    assert.equal(t.function.parameters.type, "object");
    assert.ok(t.function.description.length > 20);
  }
  const by = Object.fromEntries(TOOLS.map((t) => [t.function.name, t.function.parameters]));
  assert.deepEqual(by.chips.properties.topic.enum, ["summary", "routes", "coverage", "listing_lag", "firms"]);
  assert.deepEqual(by.changes.required, ["since"]);
  assert.match(TOOLS[0].function.description, /bare name|bare IMO/);
  assert.deepEqual(by.changes.properties.graph.enum, ["fleet", "lobby"]);
  assert.deepEqual(by.answer.properties.kind.enum, ["answer", "refusal", "clarify"]);
  assert.deepEqual(by.answer.properties.refusal_reason.enum, ["off_topic", "legal_advice", "opinion", "injection"]);
  const s = by.answer.properties.sentences.items;
  assert.deepEqual(s.properties.claim.enum, ["listed", "not_found", "change", "quote"]);
  assert.equal(s.properties.sources.type, "array");
  assert.equal(s.properties.quote.type, "integer");
  assert.deepEqual(s.required, ["claim", "sources"]);
  assert.deepEqual(by.answer.required, ["kind", "sentences"]);
  // the model writes no words: no text in a sentence, no label in a next step
  assert.equal(s.properties.text, undefined);
  assert.deepEqual(Object.keys(by.answer.properties.next.items.properties), ["source"]);
  assert.deepEqual(by.answer.properties.next.items.required, ["source"]);
});

test("every item from every tool has an id in order, a text, a label and a safe url", async () => {
  await run("check_lists", { query: "TASSOS" });
  await run("connections", { query: "IMO 9408695" });
  await run("connections", { query: "Nord Stream 2 AG" });
  await run("changes", { since: "2026-10-12" });
  for (const topic of ["summary", "routes", "coverage", "listing_lag", "firms"]) await run("chips", { topic });
  await run("site_docs", { query: "matching" });
  const KINDS = new Set(["search", "list", "research", "opensanctions", "connection", "lobbying", "change", "gap", "chips", "doc"]);
  assert.ok(ev.length > 40);
  ev.forEach((e, i) => {
    assert.equal(e.id, `S${i + 1}`);
    assert.ok(KINDS.has(e.kind), e.kind);
    assert.ok(typeof e.text === "string" && e.text.length > 10, e.id);
    assert.ok(typeof e.label === "string" && e.label.length > 2, e.id);
    assert.match(e.url, /^(https?:\/\/|\/(?!\/))/, e.id);
    if (e.link) assert.match(e.link, /^\/(?!\/)/, e.id);
    assert.doesNotMatch(e.text, /undefined|NaN|\[object/, `${e.id}: ${e.text}`);
    assert.doesNotMatch(e.label, /undefined|NaN|\[object/, e.id);
  });
  // what the model is given is the id, kind and text (plus found), or the quotes in place of a text they cover; never the urls
  const seen = (await run("site_docs", { query: "matching" })).items[0];
  assert.deepEqual(Object.keys(seen).sort(), ["id", "kind", "quotes"]);
});

// ---- quotes: the only sentences the model can put in an answer --------------------------------------------------------

const QUOTED = new Set(["doc", "chips", "connection", "lobbying"]);
async function everyTool() {
  await run("check_lists", { query: "TASSOS" });
  await run("check_lists", { query: "United Company RUSAL" });
  await run("check_lists", { query: "Gatik Ship Management" });
  await run("connections", { query: "IMO 9408695" });
  await run("connections", { query: "Nord Stream 2 AG" });
  await run("changes", { since: "2026-10-12" });
  for (const topic of ["summary", "routes", "coverage", "listing_lag", "firms"]) await run("chips", { topic });
  await run("site_docs", { query: "graphs rebuild" });
  await run("site_docs", { query: "lantern facts" });
}

test("quotes: sentences of doc, chips, connection and lobbying text; none for lists, searches, changes and gaps", async () => {
  await everyTool();
  const kinds = new Set(ev.map((e) => e.kind));
  for (const k of ["search", "list", "opensanctions", "research", "connection", "lobbying", "change", "gap", "chips", "doc"]) assert.ok(kinds.has(k), k);
  // every kind that quotes has items with quotes (an item can have none: a table whose every row names a listed firm)
  for (const k of QUOTED) assert.ok(ev.some((e) => e.kind === k && e.quotes.length > 0), k);
  // an always-allowed name is not a listing word: "OpenSanctions" holds "sanction", but this sentence is about connections
  assert.match(ev.find((e) => e.kind === "connection" && /connections data/.test(e.text)).quotes[0], /^OpenSanctions connections data: TASSOS \(Vessel, IMO 9408695\)/);
  for (const e of ev) {
    assert.ok(Array.isArray(e.quotes), e.id);
    if (["list", "opensanctions", "search", "change", "gap"].includes(e.kind)) assert.deepEqual(e.quotes, [], `${e.id} ${e.kind}`);
    assert.ok(e.quotes.length <= (["doc", "chips"].includes(e.kind) ? 20 : 12), e.id);
    let at = -1;
    for (const q of e.quotes) {
      assert.match(q, /^\S.*[.!?]["”’)]*$/s, `${e.id}: ${q}`); // a whole sentence, trimmed, ending as one
      assert.ok(q.split(/\s+/).length >= 2, q);
      assert.doesNotMatch(q, /\{\{|figure unavailable|undefined|NaN/, q);
      const pos = e.text.indexOf(q.replace(/\.$/, ""), at + 1); // in the item's own text, in reading order
      assert.ok(pos > at, `${e.id}: ${q}`);
      at = pos;
    }
  }
});

test("quotes: a doc's sentences are filled, whole across initialisms, at most 20, headings left out", async () => {
  await run("site_docs", { query: "how do the graphs rebuild" });
  assert.match(ev[0].quotes[0], /^The graphs now show 1,747 ships and 1,037 companies, rebuilt every night from the lists\.$/);
  ev = [];
  await run("site_docs", { query: "lantern facts" });
  const doc = ev.find((e) => e.label === "Lantern facts");
  assert.equal(doc.quotes.length, 20); // doc and chips items quote up to 20, the rest up to 12
  assert.equal(doc.quotes[0], "The U.S. Treasury acted on 1 May."); // not "The U.S." and "Treasury acted on 1 May."
  assert.equal(doc.quotes[19], "Lantern fact 19 is recorded here.");
  assert.ok(!doc.quotes.includes("Overview."));
});

test("quotes: a chips table row is a sentence, its lead-in line is not", async () => {
  await run("chips", { topic: "coverage" });
  const table = ev.find((e) => /one year per line/.test(e.text));
  assert.deepEqual(table.quotes, ["2024: Netherlands.", "2025: none."]);
});

test("quote naming an entity with listing language is not offered", async () => {
  await run("site_docs", { query: "Rusal removal from the US list" });
  const rusal = ev.find((e) => e.label === "Rusal's removal from the US list");
  assert.match(rusal.text, /OFAC listed Oleg Deripaska, En\+, Rusal/); // still in the text the model reads
  // the listing of Rusal, Deripaska's (a name at the start of a sentence is still a name), "listed it" (an entity named elsewhere),
  // and a removal beside a name ("remove" is listing language as much as "removed")
  assert.deepEqual(rusal.quotes, ["Contested: Treasury negotiated the deal, and the vote split largely along party lines."]);
  ev = [];
  // chips: every row of the post-invasion table names a firm beside "listed", and a press release's title names its targets
  await run("chips", { topic: "listing_lag" });
  assert.deepEqual(ev.find((e) => /shortest first/.test(e.text)).quotes, []);
  ev = [];
  await run("chips", { topic: "firms" });
  for (const release of ev) {
    assert.ok(release.quotes.length > 0, release.label);
    assert.ok(release.quotes.every((q) => !/Treasury (Sanctions|Takes Aim)/.test(q)), release.label);
  }
  // the summary names no firm: its sentences are offered, listing words and all
  ev = [];
  await run("chips", { topic: "summary" });
  assert.match(ev[0].quotes[0], /^Time to list new chip suppliers \(US Treasury OFAC\): the median is 20\.3 months/);
});

test("explainer sentence with listing language and no entity is offered", async () => {
  await run("site_docs", { query: "main tools asset freeze" });
  assert.deepEqual(ev.find((e) => e.label === "The main tools").quotes, [
    "Asset freeze (also called blocking).",
    '"An asset freeze means nobody may pay a blocked person."', // the opening word may follow a quotation mark
    "Names are compared after removing endings such as LLC or OOO.", // "removing" is not a removal from a list
    "Companies owned by a listed party can be blocked without being named.",
    "Hollow shapes run listed ships but are on no list themselves.", // "Hollow" opens the sentence; the site never uses it as a name
  ]);
});

test("quotes: a research item quotes its facts, never a listing, the authority behind one, or the match", async () => {
  await run("check_lists", { query: "TASSOS" });
  const r = ev.find((e) => e.kind === "research" && e.entity.name === "TASSOS");
  assert.deepEqual(r.quotes, [
    "TASSOS (Oil Tanker, IMO 9408695, flag Liberia) in Undercurrent's research.",
    "Manager: THE ZULU SHIPS MANAGEMENT AND OPERATION - SOLE PROPRIETORSHIP L.L.C.",
    "Other names: Bay Global.",
    "Flags flown: Liberia, Panama.",
    "9 September 2024: Managed by the Zulu Ships Management & Operation - Sole Proprietorship LLC.",
    "Has also sailed as Bay Global and Front Balder.",
  ]);
  // every research item of the entry quotes the same facts
  for (const e of ev.filter((x) => x.kind === "research" && x.entity.name === "TASSOS")) assert.deepEqual(e.quotes, r.quotes);
  ev = [];
  await run("check_lists", { query: "United Company RUSAL" });
  const rusal = ev.find((e) => e.kind === "research");
  assert.match(rusal.text, /Appears on the US Treasury list from 2018; removed in 2019\./);
  assert.deepEqual(rusal.quotes, ["United Company RUSAL (Company) in Undercurrent's research.", "Country: Russia."]);
});

test("quotes: the model sees them numbered from 0, beside the text only where they don't cover it", async () => {
  const out = await run("check_lists", { query: "TASSOS" });
  const shown = (kind) => out.items.find((i) => i.kind === kind);
  assert.equal(shown("research").quotes[1], "[1] Manager: THE ZULU SHIPS MANAGEMENT AND OPERATION - SOLE PROPRIETORSHIP L.L.C.");
  assert.equal(typeof shown("research").text, "string");
  assert.equal("quotes" in shown("list"), false);
  assert.equal("quotes" in shown("search"), false);
  const docs = await run("site_docs", { query: "how does matching work" });
  assert.deepEqual(docs.items[0].quotes, ["[0] Names are compared after removing accents and punctuation.", "[1] A seven-digit number is treated as an IMO number."]);
  assert.equal("text" in docs.items[0], false);
});

test("a data file that cannot be read gives an error, not a throw, and no evidence", async () => {
  writeFileSync(join(root, "data/changes/changes.json"), "{ not json");
  try {
    resetAskCache();
    const out = await run("changes", { since: "2026-10-12" });
    assert.equal(typeof out.error, "string");
    assert.equal(ev.length, 0);
  } finally {
    write(root, "data/changes/changes.json", CHANGES);
  }
});

test("vercel.json ships the data files and allows 30 seconds for api/ask.js", () => {
  const cfg = JSON.parse(readFileSync(join(home, "vercel.json"), "utf8")).functions["api/ask.js"];
  assert.equal(cfg.maxDuration, 30);
  assert.equal(cfg.includeFiles, "{data/lists/*.json,data/research-index.json,data/changes/changes.json,data/site-stats.json,data/ask-docs.json,stories/chips-into-russia/data/*.json}");
});
