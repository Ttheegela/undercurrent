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
import { checkAnswer } from "../api/_ask_check.js";
import { formatDate } from "../app/render.js";
import { groundingProblems } from "../scripts/ask-oracle.mjs";

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
    ...Array.from({ length: 12 }, (_, i) => rec(`ZINNIA ${i}`, "Russia", "", `Z${i}`)), // more than the site's search returns for one list (10)
    rec("Oddly Dated Trading", "Iran", "8/11/2015", "OD1"), // a date in a form the tools don't read
    rec("IRAN AIR", "Entity List (EL)", "2008-01-01", "IA1"), // a name holding a programme word, under another programme
    rec("CAATSA EXAMPLE TRADING", "CAATSA - IRAN", "", "CA1"), // a programme holding Iran as a whole word
    rec("PERSIA LINE TRADING", "Iranian Transactions Regulations", "", "IT1"), // and one holding it inside a word only
    // a word in names: ELECTRONIC and ELECTRONICS are one word; ELECTRONICA and MICROELECTRONICS are other words
    rec("Kestrel Electronic Trading", "Entity List (EL)", "2024-03-01", "EL2"),
    rec("Volta Electronics Co., Ltd.", "Entity List (EL)", "2025-10-09", "EL1"),
    rec("Brightway Holdings", "Military End User (MEU) List", "", "BW1"), rec("Brightway Electronics", "Military End User (MEU) List", "", "BW1"), // the word in an alias row only
    rec("Kestrel Electronic Trading Co.", "Entity List (EL)", "2024-03-01", "EL2"), // a second row of one record
    rec("Electronica Supply", "Entity List (EL)", "2025-01-01", "EA1"), rec("Nova Microelectronics", "Entity List (EL)", "2025-02-01", "NM1"),
    // the fold's edges: a name and its word plus S that are two names (HAMA, HAMAS; NEW, NEWS), a plural (BANKS) and a longer word (BANKING)
    rec("Hama Al Rashid", "Entity List (EL)", "2020-01-01", "HM1"), rec("Hamas Relief Front", "Entity List (EL)", "2021-01-01", "HS1"),
    rec("New Star Trading", "Entity List (EL)", "", "NS1"), rec("Daily News Agency", "Entity List (EL)", "", "DN1"),
    rec("Lion Banks Group", "Entity List (EL)", "", "BK1"), rec("Banking Partners", "Entity List (EL)", "", "BK2"),
  ],
  uk: [
    rec("TASSOS", "Russia", "2026-02-24", "RUS3483", "9408695"), rec("Orion Ship Management", "Russia", "2025-03-03", "RUS777"), ...Array.from({ length: 8 }, (_, i) => rec(`QUARTZ UK ${i}`, "Russia", "2024-02-0" + (i + 1), `QU${i}`)),
    rec("Navumau", "Republic of Belarus", "2020-12-31", "BEL0001"), // the UK list's post-Brexit transfer date
    rec("Marlowe Holdings", "European Union", "", "EUP1"), // a programme named for a grouping the region table also names
    rec("Orbit Electronics Ltd", "Cyber", "2023-05-19", "CYB0001"),
  ],
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
    facts: [{ text: "Listed by the United States on 30 July 2025 (Iran), the European Union on 24 October 2025 (Russia) and the United Kingdom on 24 February 2026 (Russia).", refs: [1, 2, 3] }, { text: "1 June 2025: Named in an OFAC press release.", refs: [1] }, { text: "Currently sailing under the Liberian flag.", refs: [1] }, { text: "Appears on the Equasis register from 2019.", refs: [1] }, { text: "9 September 2024: Managed by the Zulu Ships Management & Operation - Sole Proprietorship LLC.", refs: [4] }, { text: "Has also sailed as Bay Global and Front Balder.", refs: [4] }],
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
    // round 4: a fact that points elsewhere, beside names and a flag code written in capitals (HE, IT) that are not pronouns
    id: "IMO7654321", name: "SI HE", imo: "7654321", flag: "Panama", flags: ["Panama", "IT"],
    listings: [{ by: "United States", date: "2024-05-05", program: "Iran", ref: 1 }], names: [{ name: "SI HE", current: true }, { name: "FEI YUN HE", current: false }],
    facts: [{ text: "Listed by the United States on 5 May 2024 (Iran).", refs: [1] }, { text: "It was carrying about 800,000 barrels of Russian crude in June 2026.", refs: [1] }, { text: "Has also sailed as FEI YUN HE.", refs: [1] }, { text: "Latvia froze accounts of SI HE in 2023.", refs: [1] }],
    sources: [{ n: 1, label: "US Treasury OFAC sanctions list entry", url: "https://sanctionssearch.ofac.treas.gov/Details.aspx?id=7" }],
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
  entry({ id: "co:unlisted-solo", name: "unlisted", kind: "Company", keys: ["UNLISTED"] }), // a placeholder of one word
  ...Array.from({ length: 7 }, (_, i) => entry({ id: `co:pearl${i}`, name: `Pearl Ship Management ${i}`, kind: "Company" })),
  entry({ id: "co:unlisted", name: "Nobody Holdings", kind: "Company", facts: [{ text: "Linked to 2 ships in our research.", refs: [1] }], sources: [{ n: 1, label: "Findings", url: "https://example.org/f" }] }),
  ...Array.from({ length: 5 }, (_, i) => entry({ id: `IMO70000${i}`, name: `AMBER ${i}`, listings: [], sources: [] })),
];

// The research map: four ships with an IMO id (three of them in the research above) and one without, and their flags from each source
// a ship's flags are read from: a flagged_in link, the US list's flag, the UK's flag now. A former flag is no flag. No country here is a
// programme of the lists, and none is Panama (an unknown programme word above)
const hull = (imo, o) => ({ id: `IMO${imo}`, type: "ship", imo, listed: true, programs: [], listed_by: [], name_count: 1, ...o });
const FLEET = {
  nodes: [
    { id: "cc:lr", type: "country", name: "Liberia" }, { id: "cc:km", type: "country", name: "Comoros" }, { id: "cc:sl", type: "country", name: "Sierra Leone" },
    hull("9408695", { name: "TASSOS", program_group: "both", programs: ["russia", "iran"], listed_by: ["us", "eu", "uk"], ship_type: "Crude Oil Tanker", name_count: 3, flag_now: "km" }),
    hull("1111111", { name: "TASSOS STAR", program_group: "iran", programs: ["iran"], listed_by: ["us"], ship_type: "Oil Tanker", flag_us: "lr" }),
    hull("7654321", { name: "SI HE", program_group: "iran", programs: ["iran"], listed_by: ["us"], ship_type: "General Cargo", name_count: 2, flag_now: "lr" }),
    hull("700000", { name: "AMBER 0", program_group: "russia", programs: ["russia"], listed_by: ["uk"] }), // in the research, with no listing to show
    { id: "ship:nameless", type: "ship", name: "NAMELESS", program_group: "russia", programs: ["russia"], listed_by: ["uk"], name_count: 2 },
    { id: "gov:us", type: "government", name: "United States (sanctioning government)" },
    { id: "co:al-kina-commercial-broker", type: "company", name: "Al Kina Commercial Broker LLC", program_group: "other", country: "AE" }, // the real node's shape
  ],
  edges: [{ s: "IMO9408695", t: "cc:lr", y: "flagged_in" }, { s: "IMO7654321", t: "cc:sl", y: "formerly_flagged_in" }],
};

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
    section("graphs", "How the graphs rebuild", "The graphs now show {{stat:fleet.ships}} ships and {{stat:fleet.companies}} companies, rebuilt every night from official sources. Last build: {{stat:generated}}. Unknown: {{stat:nope.nothing}}."),
    section("reproduce", "Reproduce", "Rebuild the graphs: run the build. " + "graphs rebuild ".repeat(40), "stories/shadow-fleet/network/METHOD.html"),
    section("matching", "How matching works", "Names are compared after removing accents and punctuation. A seven-digit number is treated as an IMO number."),
    section("lanterns", "Lantern facts", `Overview. The U.S. Treasury acted on 1 May. ${Array.from({ length: 25 }, (_, i) => `Lantern fact ${i + 1} is recorded in the log.`).join(" ")}`),
    // the real findings' shape: listings that name an entity (or point at one) beside a sentence that doesn't
    section("rusal", "Rusal's removal from the US list", "6 April 2018: OFAC listed Oleg Deripaska, En+, Rusal and EuroSibEnergo. Deripaska himself stayed on the US list, and the EU added him on 8 April 2022. The US listed it in July 2023. 19 December 2018 OFAC told Congress it would remove the companies. Contested: Treasury negotiated the deal, and the vote split largely along party lines.", "stories/who-lobbies/FINDINGS.html"),
    section("listings", "Listing sentences", "All three are fully blocked (as of 25 September 2026). The company is not on the UK or EU list by name. YEHOPE was listed by the EU first and by the US 5 days later. MISHELL is on the US list only. Titan-Micro listed by the US Treasury. A sanction is a government rule that says: do not do business with a named person, company or country. Nobody may pay, hold or move money for a blocked person. Each of them faces fines if they get it wrong. Both were designated in May. In May all 3 were blocked. Under the rules all three were blocked. No manager of the 42 is UK-listed as a company; the UK lists the ships only. No sanctions wording found in the filings we read."),
    section("files", "Files", "index.html: the interactive page. nodes.json holds every organisation, with its source."),
    section("shelf", "2. What's on the shelf (Materials)", "Every page opens in a browser without a server."),
    section("notes", "Field notes", "Written for teammates. Some listed ships are sailing right now. A wave of agents is on these now. The data is currently refreshed nightly. At present the map holds every ship. At the moment nothing is pending. Our team checked every name. Every figure is checked twice."),
    section("abbrev", "Abbreviations", "Rep. Jane Doe of St. Petersburg met Acme Co. Ltd. staff on No. 5 street. Mr. Lee, Ms. Kim and Dr. Park met Boribo PTE. LTD. and Hapuka Inc. staff, e.g. at lunch, i.e. at noon, with Sen. Roe and the U.K. and U.S. delegations. (A bracketed aside follows.) then a lower-case fragment follows."),
    section("tools", "The main tools", "Asset freeze (also called blocking). Nobody may pay, hold or move the target's money or property. \"An asset freeze means nobody may pay a blocked person.\" Names are compared after removing endings such as LLC or OOO. Companies owned by a listed party can be blocked without being named (section 2). Secondary sanctions (pressure on outsiders). Hollow shapes run listed ships but are on no list themselves. In the US, any company owned 50% or more in total by listed parties is blocked automatically, even through a chain of other companies.", "stories/how-sanctions-work/index.html"),
    // round 4: the final check's pointing sentences (real wording), beside self-contained ones
    section("pointing", "Pointing sentences", "The other lists still update. Every figure here comes from free official sources and is rebuilt nightly by a script. The ships, companies, lobbying reports and counts above are rebuilt every night from the official lists. It was carrying about 800,000 barrels of Russian crude with no recognised Western insurance. These tankers move oil through ship-to-ship transfers to non-US buyers. Treasury says these ships carried more than 20 cargoes of Russian petroleum products in 2025. Its parent En+ paid Mercury Public Affairs $108,500 a month. There are 1,724 ships in the research. Such firms rarely sign a form under a name of their own. The former paid the fees and the latter signed the forms. Both were founded in May 2022. He paid the fees from 2019 to 2022. The manager of the hull is a one-ship company. The shipowner is a one-ship company in Dubai. The parent paid the fees for both. Owners of the two were named in May. Banks, exporters, shippers and insurers do the actual stopping. A seven-digit number is treated as an IMO number by the search. Nobody may pay, hold or move money for a blocked person. Official example: the US Treasury's own entry for RM Design and Development (Kyrgyzstan) says the firm was established on 17 March 2022. Among the 64 firms, 4 have no founding date in the OFAC entry (Abhar Technologies, Innovio Ventures). The act that froze the shipping firms is cited as Implementing Regulation 2026/1843 on the EUR-Lex page we read and as 2026/1845 in the OpenSanctions EU export. The UK entry still shows the old names. Until then, trading is easy. The registered owners of a hull pay the fees. The other hull was renamed in 2024. Fees were paid through the Nickles Group in 2019."),
    // final wave: a heading glued to the sentence after it (the page's "1 · The machine", one- or two-word terms before their
    // definition), beside sentences that only look like it
    section("glued", "Glued headings", "1 · The machine A sanction is a rule that says do not trade. Companies The shipper, the buyer and any middlemen. Routes Which countries the paperwork says the goods left. Reported From an official filing we saw summarised. Ownership Who owns whom, and by how much. Rating: works · works with care · weak. Ships and companies share names in the records. A buyer can be a company or a person on paper."),
    section("examples", "Examples and places", "Shell firms often register in hubs such as Dubai and Hong Kong. Such firms rarely sign a lobbying form in person. There are 1,724 ships in the research. In 2025, there were 12 renamings in the fleet. Ships flagged there are often old. The hull was renamed there in 2024. Is there a record for every hull in our research?"),
    section("limits", "Known limits", "Undercurrent's copy of the lists records no country, so Ask cannot say where a firm is based."),
    section("fragments", "Fragments","12 ships of the fleet were renamed in 2025. Anglo Premier Shipping Pte. Ltd. owns the hull and nothing else. Ltd. is the ending of most names in the data. S.A. is the ending of Spanish names in the data. LIMITED, CONCEPTO SCREEN SAL and TALAQI GROUP FOR TRADE LLC share a director. FIORA, UK-flagged 9 May 2025, appears under a newer name. Four words do not. Five words make a sentence. 2025/933, 20 May 2025). /../tools/fleet/ run steps 1 to 4 on public files. # Method How (tools / recipe) is a heading glued to a line. \"Quoted sentences start with a mark and are not offered.\" Yes, a sentence may open with a short word and a comma."),
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
  "coverage.json": { years: [2024, 2025], retrieved: "2026-10-20", names: { DEU: "Germany", NLD: "Netherlands", FRA: "France", ESP: "Spain", ITA: "Italy", BEL: "Belgium" }, by_year: { 2024: { row: ["NLD", "FRA", "ESP", "ITA", "BEL"], none: ["DEU"] }, 2025: { row: [], none: ["DEU", "NLD"] } } },
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
  // the topic vocabulary also reads the map and the lobbying graph: here the lists' programmes, the map's three countries and its groups
  write(root, "stories/shadow-fleet/network/fleet-data.json", FLEET);
  write(root, "stories/who-lobbies/influence-network/kg.json", { nodes: [] });
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
    // the compact index keeps CSV quoting on names that hold a quote or a comma
    ["NK-csv1", "Company", "", "US", ['"Limited Liability Company ""Quenzel"""']],
    ["NK-csv2", "Company", "", "EU", ['"Joint-Stock Company ""Zorvex"""', '"Zorvex, JSC"']],
    ["NK-csv3", "Organization", "", "US", ['"Odd "name" Works"']], // wrapped in quotes but not CSV: left as it is
    ["NK-csv4", "Organization", "", "US", ['Brigades al-Qodsx"']],
    ["NK-ks", "Company", "", "US", ["Kestrelon"]], // single-word names, for the one-edit near names
    ["NK-gur", "Company", "", "Ukraine GUR war-sanctions database", ["Kestrelgur"]],
  ],
};
const T = "NK-k837moN9ssPZedvkRUrexG";
const graphDoc = {
  updated_at: "2026-10-14T04:00:00Z",
  entities: [
    [T, "Vessel", ["TASSOS", "Tassos"], "9408695", ["US", "UK"]],
    ["Z", "Organization", ["Zulu Ships Management"], "", ["US", "UK"]],
    ["H", "Person", ["Hossein Shamkhani"], "", ["US"]],
    ["HAP", "Organization", ["Hapuka Marine LTD."], "6467751", ["US", "France"]],
    ["APS", "Organization", ["Anglo Premier Shipping Pte. Ltd."], "6482241", ["US"]], // the final check's "Ltd. (Organization, IMO 6482241)." fragment
    ["SOV1", "Company", ["SOVCOMFLOT"], "", ["US"]],
    ["SOV2", "Company", ["SOVCOMFLOT"], "", ["UK"]],
    ...Array.from({ length: 8 }, (_, i) => [`S${i}`, "Vessel", [`SHIP ${i}`], "", ["US"]]),
  ],
  links: [
    [T, "Z", "Ownership", "Property in the interest of", ["US", "UK"]],
    ...Array.from({ length: 8 }, (_, i) => [`S${i}`, "Z", "Ownership", "Property in the interest of", ["US"]]),
    ["Z", "H", "UnknownLink", "Providing support to", ["US"]],
    ["SOV2", "Z", "UnknownLink", "Linked to", ["UK"]],
    ["APS", "SOV1", "Ownership", "Owned by", ["US"]],
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
    // round 4: a client and a foreign entity whose names are generic starters, so "Sanctions is recorded … behind Banks." reads as generic
    { id: "co:banks", type: "company", name: "Banks", lda_names: ["BANKS"] },
    { id: "co:sanctions", type: "company", name: "Sanctions" },
  ],
  edges: [
    { source: "co:sanctions", target: "co:banks", type: "foreign_entity_of", n_filings: 1, texts: [], years: [2020, 2020], source_url: "https://lda.gov/z" },
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

test("fix round 0 (4): CSV quoting is removed from OpenSanctions names, in items, labels, other names and near names", async () => {
  const out = await run("check_lists", { query: "Quenzel" });
  const os = ofKind("opensanctions")[0];
  assert.equal(os.entity.name, 'Limited Liability Company "Quenzel"');
  assert.equal(os.label, 'OpenSanctions · Limited Liability Company "Quenzel"');
  assert.match(os.text, /OpenSanctions entry: Limited Liability Company "Quenzel" \(Company/);
  assert.equal(out.items.find((i) => i.kind === "opensanctions").text.includes('""'), false);
  // another name of the same entry (it holds a comma), and the near-name path
  ev = [];
  await run("check_lists", { query: "Zorvex JSC" });
  assert.equal(ofKind("opensanctions")[0].entity.name, 'Joint-Stock Company "Zorvex"');
  assert.match(ofKind("opensanctions")[0].text, /Also recorded as: Zorvex, JSC\./);
  ev = [];
  await run("check_lists", { query: "Joint Stock Zorvx" });
  assert.deepEqual(ev[0].near, ['Joint-Stock Company "Zorvex"']);
  assert.equal(JSON.stringify(ev).includes('\\"\\"'), false); // (a doubled quote inside a JSON string)
  // a name wrapped in quotes that is not CSV, and one with a lone quote at its end, are left alone
  ev = [];
  await run("check_lists", { query: "Odd Works" });
  assert.equal(ofKind("opensanctions")[0].entity.name, '"Odd "name" Works"');
  ev = [];
  await run("check_lists", { query: "Brigades al-Qodsx" });
  assert.equal(ofKind("opensanctions")[0].entity.name, 'Brigades al-Qodsx"');
});

test("fix round 0 (4): a one-word query of five letters or more, one edit from a one-word listed name, has that name as a near name", async () => {
  const near = async (query) => {
    ev = [];
    await run("check_lists", { query });
    return [ev[0].found, ev[0].near, ev.length];
  };
  // a swap, an insertion, a deletion and a substitution, in the lists, the research and OpenSanctions
  assert.deepEqual(await near("TASOSS"), [false, ["TASSOS"], 1]); // two letters swapped
  assert.deepEqual(await near("TASSOSS"), [false, ["TASSOS"], 1]);
  assert.deepEqual(await near("TASOS"), [false, ["TASSOS"], 1]);
  assert.deepEqual(await near("tassas"), [false, ["TASSOS"], 1]);
  assert.deepEqual(await near("Tassan"), [false, ["Tasson"], 1]); // an official list record
  assert.deepEqual(await near("Magnolya"), [false, ["MAGNOLIA"], 1]); // a research entry
  assert.deepEqual(await near("Kestrelan"), [false, ["Kestrelon"], 1]); // an OpenSanctions entry
  assert.deepEqual(await near("TASOSS Ltd"), [false, ["TASSOS"], 1]); // legal suffixes are not words
  // two edits, a name under five letters, an exact match, GUR's database alone, and a query of two words offer nothing new
  assert.deepEqual((await near("TAXXOS"))[1], []);
  assert.deepEqual((await near("TASO"))[1], []); // four letters
  assert.deepEqual((await near("SMIK"))[1], []); // four letters, one edit from the research entry SMIC
  assert.deepEqual((await near("SMICS")).slice(0, 2), [false, ["SMIC"]]); // five letters may be one edit from a shorter name
  assert.deepEqual((await near("Unlistd"))[1], []); // a placeholder that stands for a withheld name is never offered
  assert.deepEqual((await near("Kestrelgar"))[1], []); // the only name one edit away is GUR's war-sanctions database
  assert.deepEqual((await near("Zephyr")).slice(0, 2), [false, []]);
  assert.deepEqual((await near("TASSOS")).slice(0, 2), [true, []]);
  // the near name is never evidence, and nothing of it is in the text
  ev = [];
  await run("check_lists", { query: "TASOSS" });
  assert.doesNotMatch(ev[0].text, /TASSOS/);
  assert.match(ev[0].text, /Names similar to the query exist/);
});

test("fix round 1 (I2): the one-edit check also reads the name left once hull and noise words are dropped", async () => {
  const near = async (query) => {
    ev = [];
    await run("check_lists", { query });
    return [ev[0].found, ev[0].near, ev.length];
  };
  for (const query of ["MV TASOSS", "M/V TASOSS", "TASOSS tanker", "the TASOSS", "tanker TASOSS vessel"]) {
    assert.deepEqual(await near(query), [false, ["TASSOS"], 1], query);
  }
  assert.deepEqual(await near("MV Sovcomflt"), [false, ["SOVCOMFLOT"], 1]);
  assert.deepEqual(await near("MV Magnolya"), [false, ["MAGNOLIA"], 1]);
  assert.deepEqual((await near("MV Zephyr"))[1], []); // a hull word alone adds no name
  assert.deepEqual((await near("MV TAXXOS"))[1], []); // two edits, with or without the hull word
  // the same name reached through two readings of the query is offered once
  assert.deepEqual((await near("TASOSS vessel"))[1], ["TASSOS"]);
  // and an IMO number inside the query is still an exact find, not a near name
  assert.deepEqual((await near("TASOSS (IMO 9408695)")).slice(0, 2), [true, []]);
});

test("fix round 0 (4): the one-edit check looks at names of nearly the same length only, and stays quick", async () => {
  // a few thousand one-word names, found by length: the check must not read every name for every query
  const names = Array.from({ length: 4000 }, (_, i) => `Zq${i.toString(36).padStart(5, "q")}x`);
  write(root, "data/research-index.json", { entries: [...RESEARCH, ...names.map((name) => ({ ...RESEARCH[4], id: `big:${name}`, name, keys: [name.toUpperCase()], listings: [] }))] });
  resetAskCache();
  ev = [];
  const t0 = performance.now();
  for (let i = 0; i < 20; i++) await run("check_lists", { query: `Qqqqqq${i}` });
  assert.ok(performance.now() - t0 < 2000, `${Math.round(performance.now() - t0)} ms for 20 searches`);
  write(root, "data/research-index.json", { entries: RESEARCH });
  resetAskCache();
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
  assert.match(eu.text, /Manager of TASSOS: THE ZULU SHIPS MANAGEMENT/);
  assert.match(eu.text, /TASSOS managed by the Zulu Ships Management/);
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

test("check_lists counts every strong match, past the search's own limit, and says how many it shows", async () => {
  await run("check_lists", { query: "ZINNIA" });
  assert.deepEqual([ev[0].kind, ev[0].shown, ev[0].total], ["search", 5, 12]); // the site's search returns 10 names per list
  assert.deepEqual(ev.slice(1).map((e) => [e.kind, e.result]), Array.from({ length: 5 }, () => ["list", ev[0].id]));
  ev = [];
  await run("check_lists", { query: "QUARTZ" });
  assert.deepEqual([ev[0].shown, ev[0].total], [10, 16]); // 5 of 8 on each of two lists
  ev = [];
  await run("check_lists", { query: "TASSOS" });
  assert.deepEqual([ev[0].shown, ev[0].total], [7, 7]); // nothing held back
  assert.ok(ev.slice(1).every((e) => e.result === "S1"));
});

test("list and research items say what their date stands for: the list's own, OpenSanctions' first sighting, or the UK's transfer date", async () => {
  await run("check_lists", { query: "IMO 9408695" });
  // the US research date cites an OFAC list entry, which carries no date: it is the day OpenSanctions first saw it there
  assert.deepEqual(ofKind("research").map((e) => [e.gov, e.date_basis]), [["us", "first_seen_opensanctions"], ["eu", "list"], ["uk", "list"]]);
  assert.equal(ofKind("list").find((e) => e.gov === "uk").date_basis, "list");
  assert.equal("date_basis" in ofKind("list").find((e) => e.gov === "us"), false); // no date, no basis
  for (const e of ofKind("opensanctions")) assert.equal("date_basis" in e, false);
  ev = [];
  await run("check_lists", { query: "Navumau" });
  assert.deepEqual(ofKind("list").map((e) => [e.date, e.date_basis]), [["2020-12-31", "uk_transfer"]]);
  ev = [];
  await run("check_lists", { query: "Hikvision" }); // an Entity List date from the Federal Register is the list's own
  assert.deepEqual(ofKind("research").map((e) => [e.date, e.date_basis]), [["2019-10-09", "list"]]);
});

test("review (3): a record with no date at all is undated; one whose date is in another form is neither dated nor undated", async () => {
  await run("check_lists", { query: "IMO 9408695" });
  const [us, uk] = ["us", "uk"].map((gov) => ofKind("list").find((e) => e.gov === gov));
  assert.deepEqual([us.date, us.undated, uk.date, uk.undated], [undefined, true, "2026-02-24", undefined]);
  ev = [];
  await run("check_lists", { query: "Oddly Dated Trading" });
  assert.deepEqual(ofKind("list").map((e) => [e.date, e.undated]), [[undefined, undefined]]);
  assert.match(ofKind("list")[0].text, /8\/11\/2015/); // the model still sees it
  ev = [];
  await run("check_lists", { query: "MAGNOLIA" }); // a research listing with no date
  assert.deepEqual(ofKind("research").map((e) => [e.date, e.undated]), [[undefined, true]]);
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

// ---- check_lists by programme ------------------------------------------------------------------------------------

const underIran = (id) => LISTS[id].filter((r) => /(?<![\p{L}\p{N}])iran(?![\p{L}\p{N}])/iu.test(r[2]));
const unnumbered = (items) => items.map((e) => ({ ...e, id: undefined, result: undefined }));

test("programme counts each list's records under it by ref, with up to 5 examples linked to the count; no list given, only lists that have some", async () => {
  const out = await run("check_lists", { programme: "Iran" });
  const n = new Set(underIran("us").map((r) => r[4])).size; // "Terrorism, Iran" is under Iran; the UK, EU and UN fixtures have none
  assert.equal(n, 9);
  const [count, ...examples] = ev;
  assert.deepEqual({ ...count, text: undefined }, {
    id: "S1", kind: "count", unit: "records", list: "us", topic: { label: "Iran", region: "IR" }, n, shown: 5, total: n,
    text: undefined, label: "United States list · records under Iran programmes", url: "https://www.trade.gov/consolidated-screening-list", quotes: [],
  });
  assert.match(count.text, /^United States list: 9 records under Iran programmes/);
  assert.deepEqual(examples.map((e) => [e.kind, e.gov, e.result]), Array.from({ length: 5 }, () => ["list", "us", "S1"]));
  assert.deepEqual(examples.map((e) => e.entity.name), underIran("us").slice(0, 5).map((r) => r[0])); // the first, in the list's order
  for (const e of examples) assert.doesNotMatch(e.text, /Match:/); // an example matched no name
  assert.deepEqual(out.items.map((i) => i.id), ev.map((e) => e.id));
  // an alias of the programme, in any case, is the same count; one list given is that list alone, even with none under it
  for (const programme of ["IRANIAN", "iran"]) {
    ev = [];
    await run("check_lists", { programme });
    assert.deepEqual([ev[0].topic, ev[0].n, ev.length], [{ label: "Iran", region: "IR" }, n, 6], programme);
  }
  ev = [];
  await run("check_lists", { programme: "Russia", list: "uk" });
  assert.deepEqual(ev.map((e) => [e.kind, e.list ?? e.gov]), [["count", "uk"], ...Array.from({ length: 5 }, () => ["list", "uk"])]);
  assert.deepEqual([ev[0].n, ev[0].shown, ev[0].total], [10, 5, 10]);
  ev = [];
  await run("check_lists", { programme: "Iran", list: "uk" });
  assert.deepEqual(ev.map((e) => [e.kind, e.list, e.n, e.shown, e.total]), [["count", "uk", 0, 0, 0]]);
  // no list given: five examples in all, the first record of each list with some, then the next ones from the US list on
  ev = [];
  await run("check_lists", { programme: "Russia" }); // three lists hold Russia records, the UN fixture none
  assert.deepEqual(ofKind("count").map((e) => [e.list, e.n, e.shown]), [["us", 23, 3], ["uk", 10, 1], ["eu", 1, 1]]);
  assert.deepEqual(ofKind("count").map((c) => ev.filter((e) => e.result === c.id).map((e) => e.entity.name)), [
    ["SOVCOMFLOT", "Shipping Ltd", "Ship Management Ltd"], ["TASSOS"], ["Zulu Ships Management"],
  ]);
  assert.equal(ofKind("list").length, 5);
});

test("a programme matches a whole word of a record's programme, in any case: CAATSA - IRAN is under Iran, Iranian Transactions … is not", async () => {
  await run("check_lists", { programme: "Iran", list: "us" });
  const refs = (part) => new Set(LISTS.us.filter((r) => r[2].split(", ").some((p) => part.test(p))).map((r) => r[4])).size;
  assert.deepEqual([refs(/^iran$/i), refs(/iran/i), ev[0].n], [8, 10, 9]); // the parts that are Iran, CAATSA - IRAN too, never Iranian …
  // each is also a programme of its own
  for (const programme of ["CAATSA - IRAN", "iranian transactions regulations"]) {
    ev = [];
    await run("check_lists", { programme });
    assert.deepEqual(ofKind("count").map((e) => [e.list, e.n]), [["us", 1]], programme);
  }
});

test("programme filter never matches names: IRAN AIR, on the Entity List, is no Iran record, and a name search beside it is unchanged", async () => {
  await run("check_lists", { programme: "Iran", list: "us" });
  const alone = unnumbered(ev);
  assert.equal(alone[0].n, 9);
  assert.ok(!alone.some((e) => e.entity?.name === "IRAN AIR"));
  ev = [];
  await run("check_lists", { query: "Iran Air" });
  const named = unnumbered(ev);
  assert.deepEqual(named.map((e) => [e.kind, e.entity?.name, e.program]), [["search", undefined, undefined], ["list", "IRAN AIR", "Entity List (EL)"]]);
  // both at once: the name search exactly as on its own, then the count exactly as on its own
  ev = [];
  const out = await run("check_lists", { query: "Iran Air", programme: "Iran", list: "us" });
  assert.deepEqual(unnumbered(ev), [...named, ...alone]);
  assert.deepEqual(ev.map((e) => e.result), [undefined, "S1", undefined, ...Array.from({ length: 5 }, () => "S3")]);
  assert.deepEqual([out.query, out.found, out.items.length], ["Iran Air", true, 8]);
});

test("fix round 1 (3): a grouping the region table names is no country: a programme named European Union has no region; Iran has IR", async () => {
  await run("check_lists", { programme: "European Union", list: "uk" });
  assert.deepEqual([ev[0].kind, ev[0].n, ev[0].topic], ["count", 1, { label: "European Union" }]);
  assert.equal(ev[0].label, "United Kingdom list · records under the European Union programme");
  ev = [];
  await run("check_lists", { programme: "Iran", list: "us" });
  assert.deepEqual(ev[0].topic, { label: "Iran", region: "IR" });
});

test("an unknown programme word returns a search item found:false, never a count, and never repeats the word", async () => {
  // free text, a country no list has a programme for, a programme word inside a name, and a phrase holding one
  for (const programme of ["Gatik", "Panama", "Iran Air", "Iranian oil"]) {
    ev = [];
    const out = await run("check_lists", { programme });
    assert.deepEqual(ev.map((e) => [e.kind, e.found, e.shown, e.total]), [["search", false, 0, 0]], programme);
    assert.equal(ev[0].query, undefined); // so no "… is not on the lists" can be built from it
    assert.ok(!ev[0].text.includes(programme) && !ev[0].label.includes(programme), programme);
    assert.deepEqual(out.items.map((i) => [i.kind, i.found]), [["search", false]]);
  }
});

// ---- check_lists by a word in names ------------------------------------------------------------------------------

test("word counts each list's records with the word in a name, by ref, folding a trailing S; whole words only; examples newest first, linked to the count", async () => {
  const out = await run("check_lists", { word: "electronics" });
  // US: Volta, Kestrel (two rows) and Brightway (by its alias); never Electronica or Microelectronics. UK: Orbit. EU and UN: none, so no count
  assert.deepEqual(ofKind("count").map((e) => [e.list, e.n, e.shown, e.total]), [["us", 3, 3, 3], ["uk", 1, 1, 1]]);
  const [us] = ev;
  assert.deepEqual({ ...us, text: undefined }, {
    id: "S1", kind: "count", unit: "name_word", list: "us", forms: ["ELECTRONIC", "ELECTRONICS"], n: 3, shown: 3, total: 3,
    text: undefined, label: "United States list · records by a word in their names", url: "https://www.trade.gov/consolidated-screening-list", quotes: [],
  });
  assert.match(us.text, /^United States list: 3 records have the word ELECTRONIC or ELECTRONICS in a name/);
  // newest listing date first, undated last; the example is the row that holds the word
  assert.deepEqual(ev.filter((e) => e.result === "S1").map((e) => [e.kind, e.entity.name, e.date]), [
    ["list", "Volta Electronics Co., Ltd.", "2025-10-09"], ["list", "Kestrel Electronic Trading", "2024-03-01"], ["list", "Brightway Electronics", undefined],
  ]);
  assert.deepEqual(ev.filter((e) => e.result === ev[4].id).map((e) => e.entity.name), ["Orbit Electronics Ltd"]);
  assert.deepEqual(out.items.map((i) => i.id), ev.map((e) => e.id));
  // the singular, any case, is the same search
  for (const word of ["electronic", "ELECTRONIC", " Electronics "]) {
    ev = [];
    await run("check_lists", { word });
    assert.deepEqual(ofKind("count").map((e) => [e.list, e.n, e.forms]), [["us", 3, ["ELECTRONIC", "ELECTRONICS"]], ["uk", 1, ["ELECTRONIC", "ELECTRONICS"]]], word);
  }
  // a whole word: ELECTRONICA is its own word
  ev = [];
  await run("check_lists", { word: "electronica" });
  assert.deepEqual(ofKind("count").map((e) => [e.list, e.n, e.forms]), [["us", 1, ["ELECTRONICA"]]]);
});

test("word with a list: that list's count alone, even of none, and the forms are the words found on any list", async () => {
  await run("check_lists", { word: "electronics", list: "uk" });
  assert.deepEqual(ev.map((e) => [e.kind, e.list ?? e.gov, e.n]), [["count", "uk", 1], ["list", "uk", undefined]]);
  ev = [];
  await run("check_lists", { word: "electronics", list: "eu" });
  assert.deepEqual(ev.map((e) => [e.kind, e.list, e.n, e.shown, e.total, e.forms]), [["count", "eu", 0, 0, 0, ["ELECTRONIC", "ELECTRONICS"]]]);
});

test("the fold: one trailing S, from five letters up and never after A, I, U or S: BANKS is BANK, HAMAS is not HAMA, NEWS is not NEW", async () => {
  const counted = async (word) => {
    ev = [];
    await run("check_lists", { word, list: "us" });
    return [ev[0].n, ev[0].forms];
  };
  assert.deepEqual(await counted("bank"), [1, ["BANKS"]]); // never BANKING
  assert.deepEqual(await counted("banks"), [1, ["BANKS"]]);
  assert.deepEqual(await counted("hamas"), [1, ["HAMAS"]]);
  assert.deepEqual(await counted("hama"), [1, ["HAMA"]]);
  assert.deepEqual(await counted("news"), [1, ["NEWS"]]);
  assert.deepEqual(await counted("new"), [1, ["NEW"]]);
});

test("word on no list: one count of none with no forms, and the word is never repeated", async () => {
  for (const [word, list] of [["Zorbex"], ["zorbexes"], ["Zorbex", "uk"]]) {
    ev = [];
    await run("check_lists", { word, list });
    assert.deepEqual(ev.map((e) => [e.kind, e.unit, e.list, e.n, e.forms]), [["count", "name_word", undefined, 0, []]], word);
    assert.ok(!/zorbex/i.test(ev[0].text + ev[0].label), word);
    assert.match(ev[0].text, /give query to check one name/);
  }
});

test("word must be one word of 3 to 30 letters, not a legal form or a function word, and never with programme; a failed call adds no evidence", async () => {
  for (const word of ["china electronics", "Ltd", "the", "AND", "ab", "12345", "7654321", "x".repeat(31), "", 42]) {
    ev = [];
    const out = await run("check_lists", { word });
    assert.equal(typeof out.error, "string", JSON.stringify(word));
    assert.deepEqual(ev, [], JSON.stringify(word));
  }
  ev = [];
  assert.match((await run("check_lists", { word: "bank", programme: "Iran" })).error, /programme or word/);
  assert.match((await run("check_lists", { word: "bank", list: "xx" })).error, /list must be/);
  assert.deepEqual(ev, []);
});

test("word with query: the name search exactly as on its own, then the word count exactly as on its own", async () => {
  await run("check_lists", { word: "electronics", list: "us" });
  const alone = unnumbered(ev);
  ev = [];
  await run("check_lists", { query: "TASSOS" });
  const named = unnumbered(ev);
  ev = [];
  const out = await run("check_lists", { query: "TASSOS", word: "electronics", list: "us" });
  assert.deepEqual(unnumbered(ev), [...named, ...alone]);
  assert.equal(out.query, "TASSOS");
});

// ---- research: the research map's ships --------------------------------------------------------------------------

const research = async (args) => {
  ev = [];
  const out = await run("research", args);
  assert.equal(out.error, undefined, JSON.stringify(args));
  return { out, count: ev[0], examples: ev.slice(1) };
};

test("research counts the map's ships under a flag from every source: a flagged_in link, the US list's flag, the UK's flag now; never a former flag", async () => {
  const counts = {};
  for (const flag of ["Liberia", "Liberian", "Comoros", "Sierra Leone"]) counts[flag] = (await research({ flag })).count.n;
  assert.deepEqual(counts, { Liberia: 3, Liberian: 3, Comoros: 1, "Sierra Leone": 0 });
  // TASSOS has two current flags (a link to Liberia, Comoros as the UK's flag now): it counts once under each
  const names = async (flag) => (await research({ flag })).examples.map((e) => e.entity.name);
  assert.deepEqual(await names("Liberia"), ["TASSOS", "TASSOS STAR", "SI HE"]);
  assert.deepEqual(await names("Comoros"), ["TASSOS"]);
  const { count } = await research({ flag: "liberian" });
  assert.deepEqual(count.filters, { flag: { region: "LR", label: "Liberia" } });
  assert.match(count.text, /: 3 of its 4 ships match all of: recorded as Liberia-flagged by at least one source\. Each ship is counted once\. A ship's flags are every flag/);
});

test("research: programme is the map's programme groups (an array is an AND), narrowed by ship_type, listed_by and names_changed", async () => {
  const sizes = async (args) => {
    const { out, count, examples } = await research(args);
    return [count.n, out.total, out.shown, examples.length];
  };
  assert.deepEqual(await sizes({ programme: "Iran" }), [3, 3, 3, 3]);
  assert.deepEqual(await sizes({ programme: ["Russia", "Iran"] }), [1, 1, 1, 1]);
  assert.deepEqual(await sizes({ programme: ["Iranian", "IRAN"] }), [3, 3, 3, 3]); // one group, named twice
  assert.deepEqual((await research({ programme: ["Iranian", "IRAN"] })).count.filters, { programme: [{ key: "iran", label: "Iran" }] });
  assert.deepEqual(await sizes({ ship_type: "Tankers" }), [2, 2, 2, 2]); // a crude oil tanker and an oil tanker
  assert.deepEqual(await sizes({ names_changed: true }), [2, 2, 2, 2]); // the ship with no IMO id is no ship of the map
  assert.deepEqual(await sizes({ listed_by: "uk" }), [2, 2, 1, 1]); // AMBER 0 has no listing to show as an example
  // the whole count item, once: the filters in the vocabulary's words, the totals, and one example, its EU listing, linked to it
  const { out, count, examples } = await research({ programme: ["Russia", "Iranian"], ship_type: "tanker", listed_by: "eu" });
  assert.deepEqual({ ...count, text: undefined, label: undefined }, {
    id: "S1", kind: "count", unit: "ships",
    filters: { ship_type: "tanker", programme: [{ key: "russia", label: "Russia" }, { key: "iran", label: "Iran" }], listed_by: "eu" },
    n: 1, total_ships: 4, shown: 1, total: 1, text: undefined, label: undefined, url: "/stories/shadow-fleet/network/shadow_fleet_map.html", quotes: [],
  });
  assert.match(count.text, /^Undercurrent's research map: 1 of its 4 ships match all of: whose recorded type contains "tanker"; in the map's Russia programme group and its Iran programme group; listed by the European Union\. /);
  assert.equal(count.label, "Undercurrent's research map · ships"); // the criteria are the text's: a label of every filter ran to 245 characters
  assert.deepEqual(examples.map((e) => [e.kind, e.entity.id, e.gov, e.program, e.date, e.result]), [["research", "IMO9408695", "eu", "Russia", "2025-10-24", "S1"]]);
  assert.deepEqual([out.shown, out.total, out.items.map((i) => i.id)], [1, 1, ["S1", "S2"]]);
});

// ---- changes ---------------------------------------------------------------------------------------------------

test("changes clamps to started and caps at 30 with total", async () => {
  // a range that starts before the first run and ends after it is clamped to the record, not "before the start"
  const out = await run("changes", { since: "2026-01-01", until: "2030-01-01" });
  assert.ok(ev.every((e) => e.before_start === undefined));
  assert.equal(out.from, "2026-10-12");
  assert.equal(out.to, "2026-10-19"); // the latest night the record holds (today's run is not in it)
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
  // every source's outage, whatever the graph: the lobbying outage on the 17th too
  assert.deepEqual(gaps.map((g) => [g.source, g.date]).sort(), [["The UN list", "2026-10-18"], ["The US list", "2026-10-18"], ["The US lobbying data", "2026-10-17"]]);
  const us = gaps.find((g) => g.source === "The US list");
  assert.match(us.text, /was unavailable on 18 Oct 2026 \(2026-10-18\)/);
  assert.match(us.url, /^\/stories\/updates\/index\.html\?from=2026-10-18&to=2026-10-18&graph=fleet$/);
  ev = [];
  await run("changes", { since: "2026-10-17", until: "2026-10-19", graph: "lobby" });
  assert.deepEqual(ofKind("gap").map((g) => [g.source, g.date]).sort(), [["The UN list", "2026-10-18"], ["The US list", "2026-10-18"], ["The US lobbying data", "2026-10-17"]]);
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

test("fix round 0 (4): an empty single day reads 'on' in its text and its source label, a range 'between … and …'", async () => {
  await run("changes", { since: "2026-10-12", until: "2026-10-12" });
  assert.equal(ev.length, 1);
  assert.deepEqual([ev[0].found, ev[0].from, ev[0].to], [false, "2026-10-12", "2026-10-12"]);
  assert.match(ev[0].text, /^No changes were recorded on 12 Oct 2026 \(2026-10-12\)\./);
  assert.equal(ev[0].label, "No changes on 12 Oct 2026");
  ev = [];
  await run("changes", { since: "2026-10-12", until: "2026-10-13" });
  assert.equal(ev[0].label, "No changes 12 Oct 2026 to 13 Oct 2026");
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

test("a capped changes result is one result: its first change carries shown and total, and every change shown links to it", async () => {
  await run("changes", { since: "2026-10-12" });
  const changes = ofKind("change");
  assert.deepEqual([changes.length, changes[0].shown, changes[0].total], [30, 30, 38]);
  assert.ok(changes.every((c) => c.result === changes[0].id));
  // not capped: no result to link to, so no "Showing N of M"
  ev = [];
  await run("changes", { since: "2026-10-12", graph: "lobby" });
  assert.ok(ofKind("change").every((c) => c.result === undefined && c.total === undefined));
});

// ---- changes by topic --------------------------------------------------------------------------------------------
// A record of updates whose programme and country come from a join: AMBER 0 (Russia, no flag) and TASSOS STAR (Iran, a Liberian flag
// from the US list) are ships of the map; Rus Client is in the lobbying graph's russia group; the bill H.R.1 is in no graph, so nothing
// says what it bears on, and an edge between it and Rus Client can't be checked whole.
const lobbyChange = (o) => ({ date: "2026-10-19", graph: "lobby", kind: "added", item: "node", source_url: "https://lda.gov/filings/public/filing/y/print/", source_label: "US Senate lobbying disclosure (LDA)", ...o });
const TOPIC_RECORD = {
  started: "2026-10-12", first_run: "2026-10-12",
  days: [
    {
      date: "2026-10-19", sources: FRESH, changes: [
        ship(0, "2026-10-19", { id: "IMO700000", name: "AMBER 0", summary: "New on the map: AMBER 0" }),
        lobbyChange({ id: "co:rus-client", name: "Rus Client", node_type: "company", summary: "New client: Rus Client" }),
        lobbyChange({ id: "bill:hr1", name: "H.R.1", node_type: "bill", summary: "New bill: H.R.1" }),
        lobbyChange({ item: "edge", id: "e:rus-hr1", name: "Rus Client → H.R.1", node_type: "lobbied_on", endpoints: ["Rus Client", "H.R.1"], endpoint_ids: ["co:rus-client", "bill:hr1"], summary: "Rus Client lobbied on H.R.1" }),
      ],
    },
    { date: "2026-10-18", sources: FRESH, changes: [ship(1, "2026-10-18", { id: "IMO1111111", name: "TASSOS STAR", summary: "New on the map: TASSOS STAR" })] },
  ],
};
const TOPIC_KG = { nodes: [{ id: "co:rus-client", L: "lobby", g: "russia", n: "Rus Client", t: "company" }, { id: "gov:us-senate", L: "lobby", g: "", n: "US Senate", t: "government" }] };
async function withTopicRecord(fn, record = TOPIC_RECORD) {
  write(root, "data/changes/changes.json", record);
  write(root, "stories/who-lobbies/influence-network/kg.json", TOPIC_KG);
  resetAskCache();
  try {
    await fn();
  } finally {
    write(root, "data/changes/changes.json", CHANGES);
    write(root, "stories/who-lobbies/influence-network/kg.json", { nodes: [] });
    resetAskCache();
  }
}
const topicRun = async (args) => {
  ev = [];
  const out = await run("changes", { since: "2026-10-18", until: "2026-10-19", ...args });
  assert.equal(out.error, undefined, JSON.stringify(args));
  return { out, names: ofKind("change").filter((c) => c.entity).map((c) => c.entity.name) };
};

test("topic filter matches fleet changes by programme", () => withTopicRecord(async () => {
  for (const topic of ["Iran", "Iranian", "IRAN"]) {
    const { out, names } = await topicRun({ topic });
    assert.deepEqual([out.total, out.range_total, names], [1, 5, ["TASSOS STAR"]], topic);
  }
  assert.deepEqual((await topicRun({ topic: "Iran", graph: "fleet" })).names, ["TASSOS STAR"]);
  // the change says what it was filtered by, in the vocabulary's word, and never the word asked
  const { out } = await topicRun({ topic: "iranian" });
  assert.match(ofKind("change")[0].text, /\(2026-10-18 to 2026-10-19\) involving Iran: 1 change recorded\./);
  assert.ok(!JSON.stringify(ev).includes("iranian") && !JSON.stringify(out).includes("iranian"));
  // and by flags: TASSOS STAR is Liberian on the US list
  assert.deepEqual((await topicRun({ topic: "Liberia" })).names, ["TASSOS STAR"]);
}));

test("topic filter matches lobby changes by kg group", () => withTopicRecord(async () => {
  // Rus Client, and the edge from it: a change involves a topic when any node it involves carries it
  assert.deepEqual((await topicRun({ topic: "Russia", graph: "lobby" })).names, ["Rus Client", "Rus Client → H.R.1"]);
  assert.deepEqual((await topicRun({ topic: "Russian" })).names, ["AMBER 0", "Rus Client", "Rus Client → H.R.1"]);
}));

test("nothing matching says none of the checked updates and counts the unchecked", () => withTopicRecord(async () => {
  // the 19th: AMBER 0 (Russia) and Rus Client (russia group) are checked; H.R.1 and the edge to it are not
  const { out, names } = await topicRun({ since: "2026-10-19", topic: "Iran" });
  assert.deepEqual([out.total, names], [0, []]);
  assert.deepEqual(ev.map((e) => [e.kind, e.found]), [["change", false]]);
  const { topic, checked_fleet: fleet, checked_lobby: lobby, unchecked, from, to } = ev[0];
  assert.deepEqual({ topic, fleet, lobby, unchecked, from, to }, { topic: { label: "Iran" }, fleet: 1, lobby: 1, unchecked: 2, from: "2026-10-19", to: "2026-10-19" });
  assert.match(ev[0].text, /^On 19 Oct 2026 \(2026-10-19\): none of the 2 updates whose programme or country could be checked involve Iran \(1 on the shadow-fleet map, 1 in the lobbying network\)\. 2 updates in that period can't be checked against Iran\.$/);
  assert.equal(ev[0].label, "Updates involving Iran on 19 Oct 2026: none");
  // a country is told only by a country: a flag, or a company's country. AMBER 0 has no flag and the lobbying graph gives none here
  await topicRun({ topic: "Comoros" });
  assert.deepEqual([ev[0].checked_fleet, ev[0].checked_lobby, ev[0].unchecked], [1, 0, 4]);
  // a topic that matches in the range is no none, even when the graph or the words asked leave nothing
  for (const args of [{ topic: "Iran", graph: "lobby" }, { topic: "Russia", query: "star" }]) {
    const { out: o } = await topicRun(args);
    assert.deepEqual([o.total, ev.length], [0, 0], JSON.stringify(args));
  }
  // what the record says first still comes first: a range before the first run, or today before tonight's run
  ev = [];
  await run("changes", { since: "2025-01-01", until: "2025-02-01", topic: "Iran" });
  assert.deepEqual(ev.map((e) => [e.found, e.before_start, e.topic]), [[false, true, undefined]]);
  ev = [];
  await run("changes", { since: "2026-10-20", topic: "Iran" });
  assert.deepEqual(ev.map((e) => [e.found, e.not_yet, e.topic]), [[false, true, undefined]]);
  // a whole range with no change at all is "no changes", which says more
  write(root, "data/changes/changes.json", { ...TOPIC_RECORD, days: [{ date: "2026-10-19", sources: FRESH, changes: [] }, { date: "2026-10-18", sources: FRESH, changes: [] }] });
  resetAskCache();
  await topicRun({ topic: "Iran" });
  assert.deepEqual(ev.map((e) => [e.found, e.topic]), [[false, undefined]]);
  assert.match(ev[0].text, /^No changes were recorded between/);
}));

test("free-text query still works and is unaffected by topic", () => withTopicRecord(async () => {
  const words = async (args) => (await topicRun(args)).names;
  assert.deepEqual(await words({ query: "star" }), ["TASSOS STAR"]);
  assert.deepEqual(await words({ query: "client" }), ["Rus Client", "Rus Client → H.R.1"]);
  assert.deepEqual(await words({ query: "star", topic: "Iran" }), ["TASSOS STAR"]);
  assert.deepEqual(await words({ query: "client", topic: "Russia" }), ["Rus Client", "Rus Client → H.R.1"]);
  assert.deepEqual(await words({ query: "client", topic: "Iran" }), []);
  // no topic: the same items as before topics existed, nothing said of a topic
  await topicRun({ query: "client" });
  assert.ok(ev.every((e) => e.topic === undefined && !/involving/.test(e.text)));
}));

test("topic: a word that is no topic, or a topic the updates can't be checked against, is an error, never a none", () => withTopicRecord(async () => {
  // Terrorism is a programme of the lists, but here no graph groups by it and it is no country; Somalia (the UN's) and Republic of Belarus
  // (the UK's) are programmes that name a country, which no group tells and a country alone can't settle (fix round 1 (2))
  for (const topic of ["Gatik", "Iran Air", "Terrorism", "Somalia", "Republic of Belarus", "", 7, ["Iran"]]) {
    ev = [];
    const out = await run("changes", { since: "2026-10-18", topic });
    assert.match(out.error ?? "", /^topic must be/, String(topic));
    assert.equal(ev.length, 0);
  }
}));

// A government is no party to an update: the US designating AMBER 0 (Russia) is decided by AMBER 0, Rus Client lobbying the US Senate by
// Rus Client, and the US Senate on its own (an update of governments only) can't be checked
const GOV_RECORD = {
  started: "2026-10-12", first_run: "2026-10-12",
  days: [{
    date: "2026-10-19", sources: FRESH, changes: [
      ship(0, "2026-10-19", { item: "edge", id: "e:amber-us", name: "AMBER 0 → United States (sanctioning government)", node_type: "designated_by", endpoints: ["AMBER 0", "United States (sanctioning government)"], endpoint_ids: ["IMO700000", "gov:us"], summary: "The US designated AMBER 0" }),
      lobbyChange({ item: "edge", id: "e:rus-senate", name: "Rus Client → US Senate", node_type: "lobbied", endpoints: ["Rus Client", "US Senate"], endpoint_ids: ["co:rus-client", "gov:us-senate"], summary: "Rus Client lobbied US Senate" }),
      lobbyChange({ id: "gov:us-senate", name: "US Senate", node_type: "agency", summary: "New agency: US Senate" }),
    ],
  }],
};

test("fix (government ends): a designation is decided by its ship; an update of governments only is unchecked", () => withTopicRecord(async () => {
  // Iran: the Russia-programme ship's designation is checked and not matching, and counted in "None of the N updates …"
  await topicRun({ since: "2026-10-19", topic: "Iran" });
  assert.deepEqual(ev.map((e) => [e.kind, e.found, e.checked_fleet, e.checked_lobby, e.unchecked]), [["change", false, 1, 1, 1]]);
  const out = checkAnswer({ kind: "answer", sentences: [{ claim: "change", sources: [ev[0].id] }] }, ev, {});
  assert.deepEqual(out.sentences.map((s) => s.text), ["None of the 2 updates recorded on 19 Oct 2026 involve Iran.", "1 update in that period can't be checked against Iran."]);
  assert.deepEqual(groundingProblems("Any Iran-related updates?", ev, out), []);
  // Russia: the same designation, and the lobbying of the Senate, involve it
  assert.deepEqual((await topicRun({ since: "2026-10-19", topic: "Russia" })).names, ["AMBER 0 → United States (sanctioning government)", "Rus Client → US Senate"]);
}, GOV_RECORD));

// ---- fix round 1 -------------------------------------------------------------------------------------------------
// one change on the 19th, in a record otherwise like TOPIC_RECORD's
const oneChange = (change) => ({ started: "2026-10-12", first_run: "2026-10-12", days: [{ date: "2026-10-19", sources: FRESH, changes: [change] }] });
const amberChange = (o) => ship(0, "2026-10-19", { kind: "changed", id: "IMO700000", name: "AMBER 0", ...o }); // AMBER 0: Russia today, no flag
const bearsOn = async (topic) => {
  const { out, names } = await topicRun({ since: "2026-10-19", topic });
  const none = ev.find((e) => e.topic);
  return none ? [none.checked_fleet + none.checked_lobby, none.unchecked] : [out.total, names];
};

test("fix round 1 (1): a programmes change is judged by what it was and became, not by today's node alone", () => withTopicRecord(async () => {
  // AMBER 0 left the Iran programme: today's node is Russia only, but the update involves Iran
  assert.deepEqual(await bearsOn("Iran"), [1, ["AMBER 0"]]);
  assert.deepEqual(await bearsOn("Russia"), [1, ["AMBER 0"]]);
}, oneChange(amberChange({ field: "programs", from: ["iran", "russia"], to: ["russia"], summary: "AMBER 0 changed programmes: iran, russia → russia" }))));

test("fix round 1 (1): a flag change is judged by the flag it left and the one it took", () => withTopicRecord(async () => {
  assert.deepEqual(await bearsOn("Iran"), [1, ["AMBER 0"]]); // the flag it left (the map gives AMBER 0 none today)
  assert.deepEqual(await bearsOn("Comoros"), [1, ["AMBER 0"]]); // the flag it took
  assert.deepEqual(await bearsOn("Liberia"), [0, 1]); // neither: but today's node gives no country to check, so it is not counted
}, oneChange(amberChange({ field: "flag_now", from: "Iran", to: "Comoros", summary: "AMBER 0 changed flag: Iran → Comoros" }))));

test("fix round 1 (1): a list's removal is unchecked unless today's node carries the topic: what it lost is gone from the node", () => withTopicRecord(async () => {
  assert.deepEqual(await bearsOn("Iran"), [0, 1]);
  assert.deepEqual(await bearsOn("Russia"), [1, ["AMBER 0"]]);
}, oneChange(amberChange({ field: "listed_by", from: ["US"], summary: "US removed AMBER 0" }))));

test("fix round 1 (2): a programme topic needs a known programme group; a country settles only a topic that is just a country", () => withTopicRecord(async () => {
  // the map's "other" group with a country (the real Al Kina Commercial Broker LLC): no programme to check Iran or Russia against
  assert.deepEqual(await bearsOn("Iran"), [0, 1]);
  assert.deepEqual(await bearsOn("Russia"), [0, 1]);
  // Comoros is only a country: its country, the UAE, settles it
  assert.deepEqual(await bearsOn("Comoros"), [1, 0]);
}, oneChange({ date: "2026-10-19", graph: "fleet", kind: "added", item: "node", id: "co:al-kina-commercial-broker", name: "Al Kina Commercial Broker LLC", node_type: "company", summary: "New on the map: Al Kina Commercial Broker LLC", source_url: "https://example.org/list", source_label: "UK Sanctions List" })));

test("fix round 1 (3): a range with no recorded night is the gap alone, with a topic or without", () => withTopicRecord(async () => {
  for (const topic of ["Iran", undefined]) {
    ev = [];
    const out = await run("changes", { since: "2026-10-15", until: "2026-10-16", topic });
    assert.equal(out.error, undefined);
    assert.deepEqual(ev.map((e) => [e.kind, e.source, e.from, e.to]), [["gap", "The nightly update", "2026-10-15", "2026-10-16"]], String(topic));
  }
}));

test("fix round 1 (4): a change is one change in every changes call: a plain capped call and a topic call share its line", () => withTopicRecord(async () => {
  // the 19th: TASSOS STAR and SI HE (both Iran) changed, then 33 ships the map does not hold
  await run("changes", { since: "2026-10-19", until: "2026-10-19" });
  await run("changes", { since: "2026-10-19", until: "2026-10-19", topic: "Iran" });
  const [plain, topical] = [ev.filter((e) => e.kind === "change" && !/involving/.test(e.text)), ev.filter((e) => e.kind === "change" && /involving/.test(e.text))];
  assert.deepEqual([plain.length, plain[0].total, topical.length, topical[0].total], [30, 35, 2, undefined]);
  const line = (c) => `${c.summary} · ${formatDate(c.date)}`;
  const say = (...ids) => {
    const out = checkAnswer({ kind: "answer", sentences: [{ claim: "change", sources: ids }] }, ev, {});
    assert.deepEqual(groundingProblems("What changed on the Iran ships?", ev, out), [], out.sentences.map((s) => s.text).join(" | "));
    return out.sentences.map((s) => s.text);
  };
  // TASSOS STAR from the plain call, SI HE from the topic call: two of the plain call's 35, one line
  assert.deepEqual(say(plain[0].id, topical[1].id), [line(plain[0]), line(plain[1]), "Showing 2 of 35 updates."]);
  // one change from both calls is one sentence, counted once
  assert.deepEqual(say(plain[1].id, topical[1].id), [line(plain[1]), "Showing 1 of 35 updates."]);
}, {
  started: "2026-10-12", first_run: "2026-10-12",
  days: [{
    date: "2026-10-19", sources: FRESH, changes: [
      ship(1, "2026-10-19", { kind: "changed", id: "IMO1111111", name: "TASSOS STAR", field: "listed_by", to: ["EU"], summary: "EU listed TASSOS STAR (IMO 1111111)" }),
      ship(2, "2026-10-19", { kind: "changed", id: "IMO7654321", name: "SI HE", field: "listed_by", to: ["EU"], summary: "EU listed SI HE (IMO 7654321)" }),
      ...Array.from({ length: 33 }, (_, i) => ship(100 + i, "2026-10-19")),
    ],
  }],
}));

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

test("connections: a ship's sanctions links name both ends, with the direction, and never the governments behind them", async () => {
  const out = await run("connections", { query: "IMO 9408695" });
  const conn = ofKind("connection");
  assert.equal(conn[0].entity.name, "TASSOS");
  assert.equal(conn[0].entity.imo, "9408695");
  assert.equal(conn[0].url, `https://www.opensanctions.org/entities/${T}/`);
  assert.doesNotMatch(conn[0].text, /US|UK|recorded under/); // whether a party is listed is check_lists' answer, not the connections'
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

test("chips firms: the count, then one item per firm, newest release first, each with its countries, release and page", async () => {
  const out = await run("chips", { topic: "firms" });
  assert.deepEqual(ev.map((e) => e.kind), ["count", "chips_firm", "chips_firm", "chips_firm", "chips_firm"]);
  const [c, ...firms] = ev;
  assert.deepEqual([c.n, c.shown, c.total, out.shown, out.total], [4, 4, 4, 4, 4]);
  assert.deepEqual(firms.map((e) => [e.entity.name, e.countries, e.date]), [
    ["Allparts Trading", ["United Arab Emirates"], "2024-10-30"], ["Old Electronics", ["India"], "2024-10-30"], ["Undated Logistics", ["China"], "2024-10-30"], ["Milur Electronics", ["Armenia"], "2022-11-14"],
  ]);
  for (const e of firms) assert.deepEqual([e.result, e.quotes], [c.id, []], e.label); // examples of the count, and no quote: the server writes their sentence
  assert.equal(firms[0].url, "https://home.treasury.gov/news/press-releases/jy2700");
  assert.equal(firms[0].label, "US Treasury press release jy2700, 30 Oct 2024 · Allparts Trading");
  assert.match(firms[0].text, /^Allparts Trading \(United Arab Emirates\) in Undercurrent's research: named by US Treasury press release jy2700, 30 Oct 2024 \(2024-10-30\)/);
  assert.match(firms[0].text, /shipped electronic integrated circuits/);
});

test("chips firms by country: a nationality word or a country keeps the firms based there; none is a count of 0; a word that is no country fails", async () => {
  await run("chips", { topic: "firms", country: "Chinese" });
  assert.deepEqual(ev.map((e) => e.entity?.name ?? e.kind), ["count", "Undated Logistics"]);
  assert.deepEqual([ev[0].n, ev[0].total, ev[0].country], [1, 1, { region: "CN", label: "China" }]);
  assert.match(ev[0].text, /; 1 of them is based in China\./);
  ev = [];
  await run("chips", { topic: "firms", country: "Armenian" }); // a country only the chips research names is in the vocabulary too
  assert.deepEqual(ev.map((e) => e.entity?.name ?? e.kind), ["count", "Milur Electronics"]);
  ev = [];
  await run("chips", { topic: "firms", country: "Russia" }); // a country no firm of the research is based in
  assert.deepEqual([ev.length, ev[0].n, ev[0].total, ev[0].country.label], [1, 0, 0, "Russia"]);
  ev = [];
  assert.match((await run("chips", { topic: "firms", country: "Atlantis" })).error, /country/);
  assert.match((await run("chips", { topic: "routes", country: "China" })).error, /country/);
  assert.equal(ev.length, 0);
  // an empty or null country is no filter, on any topic
  await run("chips", { topic: "routes", country: "" });
  await run("chips", { topic: "firms", country: null });
  assert.deepEqual(ev.filter((e) => e.kind === "count").map((e) => [e.n, e.country]), [[4, undefined]]);
});

test("chips firms: a firm two releases name is one firm, dated by the earliest release with that release's page", async () => {
  const lag = CHIPS["listing_lag.json"];
  const again = { ...lag.firms[1], release: "jy1102" }; // Allparts Trading: jy2700 (30 Oct 2024) and, here, jy1102 (14 Nov 2022) too
  write(root, "stories/chips-into-russia/data/listing_lag.json", { ...lag, firms: [...lag.firms, again] });
  resetAskCache();
  try {
    await run("chips", { topic: "firms" });
    const allparts = ev.filter((e) => e.entity?.name === "Allparts Trading");
    assert.equal(allparts.length, 1);
    assert.deepEqual([allparts[0].date, allparts[0].url], ["2022-11-14", "https://home.treasury.gov/news/press-releases/jy1102"]);
  } finally {
    write(root, "stories/chips-into-russia/data/listing_lag.json", lag);
    resetAskCache();
  }
});

test("chips firms count", async () => {
  await run("chips", { topic: "firms" });
  const [c] = ev;
  const n = CHIPS["listing_lag.json"].firms.length; // the research's firm set: each named by one of the releases
  assert.deepEqual([c.kind, c.unit, c.n], ["count", "firms", n]);
  assert.equal(c.url, "/stories/chips-into-russia/FINDINGS.html#2-how-long-the-us-took-to-list-new-chip-suppliers");
  assert.equal(c.total, n); // the firms follow as its examples, so a capped list says "Showing N of M"
  const out = checkAnswer({ kind: "answer", sentences: [{ claim: "count", sources: [c.id] }], next: [] }, ev, {});
  assert.deepEqual(out.sentences, [{ text: `${n} firms are named in Undercurrent's research as shipping chips to Russia.`, sources: [{ n: 1, label: c.label, url: c.url }] }]);
  assert.deepEqual(groundingProblems("How many firms has the US Treasury named for sending chips to Russia?", ev, out), []);
  // one firm is singular; the oracle catches another number
  const one = [{ ...c, n: 1 }];
  const single = checkAnswer({ kind: "answer", sentences: [{ claim: "count", sources: [c.id] }], next: [] }, one, {});
  assert.deepEqual(single.sentences.map((s) => s.text), ["1 firm is named in Undercurrent's research as shipping chips to Russia."]);
  assert.deepEqual(groundingProblems("", one, single), []);
  assert.equal(groundingProblems("", ev, { ...out, sentences: [{ ...out.sentences[0], text: `${n + 1} firms are named in Undercurrent's research as shipping chips to Russia.` }] }).length, 1);
});

test("chips firms count counts a firm by its OFAC id: one named by two releases is one firm", async () => {
  const lag = CHIPS["listing_lag.json"];
  const again = { ...lag.firms[1], release: "jy1102" }; // Allparts Trading, named by the earlier release too
  write(root, "stories/chips-into-russia/data/listing_lag.json", { ...lag, firms: [...lag.firms, again] });
  resetAskCache();
  try {
    await run("chips", { topic: "firms" });
    assert.deepEqual([ev[0].unit, ev[0].n], ["firms", lag.firms.length]);
  } finally {
    write(root, "stories/chips-into-russia/data/listing_lag.json", lag);
    resetAskCache();
  }
});

test("chips routes and coverage: the figures, as the site states them", async () => {
  await run("chips", { topic: "routes" });
  const all = ev.map((e) => e.text).join("\n");
  assert.match(ev[2].text, /to each partner country[^]*To Kazakhstan: /);
  for (const needle of ["2024 $300M", "2025 $260M", "China, Hong Kong SAR", "$172M", "$4,075", "Netherlands", "EUR", "Kazakhstan", "18", "11"]) assert.ok(all.includes(needle), needle);
  ev = [];
  await run("chips", { topic: "coverage" });
  const cov = ev.map((e) => e.text).join("\n");
  assert.match(cov, /of the 6 countries that reported at least once: 2024: 5 reported a chip export row to Russia, 1 reported trade but no chip row, 0 did not report; 2025: 0 reported a chip export row to Russia, 2 reported trade but no chip row, 4 did not report/);
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

test("site_docs reads can't as cannot, with either apostrophe, and finds the section that says what cannot be done", async () => {
  for (const query of ["What can't it do?", "What can’t it do?"]) {
    ev = [];
    await run("site_docs", { query });
    assert.equal(ev[0]?.label, "Known limits", query);
  }
});

test("a ship in the research with no manager says so, as a quote; a ship with one and a company do not", async () => {
  await run("check_lists", { query: "TASSOS STAR" });
  const star = ev.find((e) => e.kind === "research" && e.entity.name === "TASSOS STAR");
  assert.ok(star.quotes.includes("Undercurrent's research records no manager for TASSOS STAR."), star.quotes.join(" | "));
  const none = (e) => e.quotes.some((q) => q.includes("records no manager"));
  ev = [];
  await run("check_lists", { query: "TASSOS" });
  assert.ok(!none(ev.find((e) => e.kind === "research" && e.entity.name === "TASSOS")));
  ev = [];
  await run("check_lists", { query: "ZED HOLDING" });
  assert.ok(!none(ev.find((e) => e.kind === "research")));
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
    // the nights after the latest one held are missing too, up to yesterday: a stalled job is not "no changes" (and today's run,
    // after them, has not happened yet)
    ev = [];
    const stalled = await run("changes", { since: "2026-10-17", until: "2026-10-20" });
    assert.deepEqual(ev.map((e) => [e.kind, e.found, e.not_yet, e.from, e.to]), [["change", false, true, "2026-10-17", "2026-10-20"], ["gap", undefined, undefined, "2026-10-17", "2026-10-19"]]);
    assert.deepEqual([stalled.total, stalled.missing_nights], [0, 3]);
    assert.doesNotMatch(JSON.stringify(ev), /No changes were recorded/);
    ev = [];
    const week = await run("changes", { since: "2026-10-13" }); // "what changed this week", with a change on the 16th
    assert.equal(week.total, 1);
    assert.deepEqual(ofKind("gap").map((g) => [g.from, g.to]), [["2026-10-17", "2026-10-19"], ["2026-10-13", "2026-10-14"]]);
    // today itself is never flagged as a gap: before its run it is "not yet" (final review, Important 2)
    ev = [];
    await run("changes", { since: "2026-10-20", until: "2026-10-20" });
    assert.deepEqual(ev.map((e) => [e.kind, e.found, e.not_yet]), [["change", false, true]]);
    // with today as the 17th, the 17th is not flagged but the stretch up to it is
    ev = [];
    await run("changes", { since: "2026-10-12", until: "2026-10-20" }, { today: "2026-10-17" });
    assert.deepEqual(ofKind("gap").map((g) => [g.from, g.to]), [["2026-10-13", "2026-10-14"]]);
  } finally {
    write(root, "data/changes/changes.json", CHANGES);
  }
});

test("final wave (2): before tonight's run, a range after the latest night held ending today is 'not yet', never 'no changes'", async () => {
  const day = (date, changes = []) => ({ date, sources: FRESH, changes });
  // the reviewer's 05:35 UTC case: the record's last night is 20 Oct, today is 21 Oct, and its run has not happened
  write(root, "data/changes/changes.json", { ...CHANGES, days: [day("2026-10-20"), day("2026-10-19", [ship(1, "2026-10-19")]), day("2026-10-18"), day("2026-10-17")] });
  const at = { today: "2026-10-21" };
  try {
    resetAskCache();
    // "What changed today?"
    const today = await run("changes", { since: "2026-10-21", until: "2026-10-21" }, at);
    assert.deepEqual(ev.map((e) => [e.kind, e.found, e.not_yet, e.from, e.to]), [["change", false, true, "2026-10-21", "2026-10-21"]]);
    assert.match(ev[0].text, /^Today's nightly update hasn't run yet/);
    assert.doesNotMatch(JSON.stringify(ev), /No changes were recorded/);
    assert.deepEqual([today.total, today.gaps, today.missing_nights], [0, 0, 0]);
    // an `until` past today is today
    ev = [];
    await run("changes", { since: "2026-10-21", until: "2027-01-01" }, at);
    assert.deepEqual(ev.map((e) => [e.kind, e.not_yet]), [["change", true]]);
    // a quiet night held, then today: "no changes" covers the night held only, never today
    ev = [];
    const quiet = await run("changes", { since: "2026-10-20" }, at);
    assert.deepEqual(ev.map((e) => [e.kind, e.found, e.not_yet, e.from, e.to]), [["change", false, undefined, "2026-10-20", "2026-10-20"]]);
    assert.match(ev[0].text, /^No changes were recorded on 20 Oct 2026 \(2026-10-20\)\./);
    assert.equal(ev[0].label, "No changes on 20 Oct 2026");
    assert.deepEqual([quiet.from, quiet.to], ["2026-10-20", "2026-10-20"]);
    // a week with a change: the range it reports ends on the latest night held
    ev = [];
    const week = await run("changes", { since: "2026-10-17" }, at);
    assert.deepEqual([week.from, week.to, week.total], ["2026-10-17", "2026-10-20", 1]);
    assert.match(ofKind("change")[0].text, /Between 17 Oct 2026 and 20 Oct 2026 \(2026-10-17 to 2026-10-20\): 1 change recorded/);
    // once tonight's run is in, today is in the record like any other night
    write(root, "data/changes/changes.json", { ...CHANGES, days: [day("2026-10-21"), day("2026-10-20")] });
    resetAskCache();
    ev = [];
    await run("changes", { since: "2026-10-21", until: "2026-10-21" }, at);
    assert.deepEqual(ev.map((e) => [e.kind, e.found, e.not_yet, e.from, e.to]), [["change", false, undefined, "2026-10-21", "2026-10-21"]]);
    // earlier missing nights stay gap runs, beside "not yet"
    write(root, "data/changes/changes.json", { ...CHANGES, days: [day("2026-10-17")] });
    resetAskCache();
    ev = [];
    const stalled = await run("changes", { since: "2026-10-18" }, at);
    assert.deepEqual(ev.map((e) => [e.kind, e.found, e.not_yet, e.source, e.from, e.to]), [["change", false, true, undefined, "2026-10-18", "2026-10-21"], ["gap", undefined, undefined, "The nightly update", "2026-10-18", "2026-10-20"]]);
    assert.deepEqual([stalled.total, stalled.missing_nights], [0, 3]);
    // a range after the latest night that ends before today is only its gap, as before
    ev = [];
    await run("changes", { since: "2026-10-18", until: "2026-10-19" }, at);
    assert.deepEqual(ev.map((e) => [e.kind, e.source, e.from, e.to]), [["gap", "The nightly update", "2026-10-18", "2026-10-19"]]);
    // no night held at all: today is "not yet" too
    write(root, "data/changes/changes.json", { ...CHANGES, days: [] });
    resetAskCache();
    ev = [];
    await run("changes", { since: "2026-10-21" }, at);
    assert.deepEqual(ev.map((e) => [e.kind, e.not_yet]).slice(0, 1), [["change", true]]);
  } finally {
    write(root, "data/changes/changes.json", CHANGES);
  }
});

test("final wave (4): a range after the first run but wholly before the oldest night kept says the days are no longer kept", async () => {
  // nights older than 120 days are trimmed: the record keeps 12 Oct on, its first run was 1 Jun
  write(root, "data/changes/changes.json", { ...CHANGES, first_run: "2026-06-01" });
  try {
    resetAskCache();
    const out = await run("changes", { since: "2026-07-01", until: "2026-07-31" });
    assert.deepEqual(ev.map((e) => [e.kind, e.found, e.trimmed, e.from, e.to, e.started]), [["change", false, true, "2026-07-01", "2026-07-31", "2026-10-12"]]);
    assert.match(ev[0].text, /^Days before 12 Oct 2026 \(2026-10-12\) are no longer kept/);
    assert.doesNotMatch(JSON.stringify(ev), /No changes were recorded/);
    assert.deepEqual(ev[0].quotes, []);
    assert.deepEqual([out.total, out.from, out.to], [0, "2026-07-01", "2026-07-31"]);
    // a range from before the first run to a trimmed day: none of it is kept
    ev = [];
    await run("changes", { since: "2026-05-01", until: "2026-10-11" });
    assert.deepEqual(ev.map((e) => [e.kind, e.trimmed]), [["change", true]]);
    // a range ending on the oldest night kept is in the record
    ev = [];
    await run("changes", { since: "2026-07-01", until: "2026-10-12" });
    assert.deepEqual(ev.map((e) => [e.kind, e.found, e.trimmed, e.from, e.to]), [["change", false, undefined, "2026-10-12", "2026-10-12"]]);
    // a range wholly before the first run is still "before the start"
    ev = [];
    await run("changes", { since: "2026-01-01", until: "2026-05-31" });
    assert.deepEqual(ev.map((e) => [e.kind, e.before_start, e.trimmed]), [["change", true, undefined]]);
  } finally {
    write(root, "data/changes/changes.json", CHANGES);
  }
});

test("final wave (3): a research fact that opens on its verb is given its entity's name, so no research quote lacks its subject", async () => {
  await run("check_lists", { query: "TASSOS" });
  await run("check_lists", { query: "SI HE" });
  await run("check_lists", { query: "Nobody Holdings" });
  const nobody = ev.find((e) => e.kind === "research" && e.entity.name === "Nobody Holdings");
  assert.deepEqual(nobody.quotes, ["Nobody Holdings linked to 2 ships in our research."]);
  await everyTool();
  const research = ev.filter((e) => e.kind === "research");
  assert.ok(research.length >= 8);
  for (const e of research) for (const q of e.quotes) assert.ok(q.includes(e.entity.name), `${e.entity.name}: ${q}`);
  // a fact with a subject of its own is left as it is
  const si = ev.find((e) => e.kind === "research" && e.entity.name === "SI HE");
  assert.match(si.text, /Latvia froze accounts of SI HE in 2023\./);
});

test("final wave (12): headings and glued one- or two-word header lines are never quotes; they stay in the text", async () => {
  await run("site_docs", { query: "glued headings" });
  const doc = ev.find((e) => e.label === "Glued headings");
  for (const s of ["1 · The machine A sanction", "Companies The shipper", "Routes Which countries", "Reported From an official filing", "Ownership Who owns whom", "Rating: works · works with care"]) {
    assert.ok(doc.text.includes(s), `in the text: ${s}`);
    assert.ok(!doc.quotes.some((q) => q.includes(s)), `quotable: ${s}`);
  }
  // a chapter label is cut off, and its sentence kept
  assert.deepEqual(doc.quotes, ["A sanction is a rule that says do not trade.", "Ships and companies share names in the records.", "A buyer can be a company or a person on paper."]);
  // the head lines of research, connection and lobbying items are their headings: text only
  ev = [];
  await everyTool();
  const heads = [
    [ev.find((e) => e.kind === "research" && e.entity.name === "TASSOS"), "TASSOS (Oil Tanker, IMO 9408695, flag Liberia) in Undercurrent's research."],
    [ev.find((e) => e.kind === "connection" && /connections data for TASSOS/.test(e.text)), "OpenSanctions connections data for TASSOS (Vessel, IMO 9408695)."],
    [ev.find((e) => e.kind === "lobbying" && /Lobbying firms hired/.test(e.text)), "Nord Stream 2 AG in US lobbying filings (LDA; data as of 14 Oct 2026 (2026-10-14))."],
  ];
  for (const [e, head] of heads) {
    assert.ok(e.text.startsWith(head), `${e.label}: ${e.text.slice(0, 90)}`);
    assert.ok(!e.quotes.includes(head), `${e.label}: the head line is quotable`);
  }
  assert.ok(heads[2][0].quotes.some((q) => q.startsWith("Lobbying firms hired by Nord Stream 2 AG: Capitol Counsel LLC")), heads[2][0].quotes.join(" | "));
});

test("final wave (5): 'such as' and an existential 'there is/are' point nowhere; 'such <noun>' and 'there' as a place still do", async () => {
  await run("site_docs", { query: "examples and places" });
  const doc = ev.find((e) => e.label === "Examples and places");
  assert.deepEqual(doc.quotes, [
    "Shell firms often register in hubs such as Dubai and Hong Kong.",
    "There are 1,724 ships in the research.",
    "In 2025, there were 12 renamings in the fleet.",
    "Is there a record for every hull in our research?",
  ]);
  for (const s of ["Such firms rarely sign", "Ships flagged there are often old.", "The hull was renamed there in 2024."]) {
    assert.ok(doc.text.includes(s), `in the text: ${s}`);
    assert.ok(!doc.quotes.some((q) => q.includes(s)), `quotable: ${s}`);
  }
});

// ---- arguments, tool list, invariants --------------------------------------------------------------------------

test("bad args (bad date, query over 200 chars, unknown topic) return {error} and add no evidence", async () => {
  const bad = [
    ["check_lists", {}], ["check_lists", { query: "x" }], ["check_lists", { query: "a".repeat(201) }], ["check_lists", { query: 5 }], ["check_lists", { query: "Совкомфлот" }],
    ["check_lists", { programme: "x" }], ["check_lists", { programme: 5 }], ["check_lists", { programme: "Iran", list: "fr" }], ["check_lists", { list: "us" }], ["check_lists", { programme: "Iran", query: "x" }],
    ["connections", { query: "" }], ["connections", { query: "b".repeat(201) }],
    ["changes", {}], ["changes", { since: "2026-13-45" }], ["changes", { since: "yesterday" }], ["changes", { since: "2026-10-12", until: "2026-02-30" }],
    ["changes", { since: "2026-10-19", until: "2026-10-12" }], ["changes", { since: "2026-10-12", graph: "both" }], ["changes", { since: "2030-01-01" }], ["changes", { since: "2026-10-12", query: "q".repeat(201) }],
    ["chips", { topic: "bogus" }], ["chips", {}], ["site_docs", { query: "z".repeat(201) }], ["site_docs", { query: " " }],
    // no filter; the UN list, which the map does not hold; a type, programme or flag outside the closed sets (a programme of the lists
    // that is no group of the map, Somalia, included: a none for it would not be true)
    ["research", {}], ["research", { names_changed: false }], ["research", { programme: [] }], ["research", { listed_by: "un" }], ["research", { listed_by: "fr" }],
    ["research", { ship_type: "submarine" }], ["research", { programme: "Gatik" }], ["research", { programme: "Somalia" }], ["research", { programme: ["Iran", 5] }],
    ["research", { flag: "Terrorism" }], ["research", { flag: "Gatik" }], ["research", { flag: 5 }],
    ["nope", {}], ["answer", {}], ["constructor", {}],
  ];
  for (const [name, args] of bad) {
    const out = await run(name, args);
    assert.equal(typeof out.error, "string", `${name} ${JSON.stringify(args).slice(0, 40)}`);
  }
  assert.equal((await run("check_lists", null)).error !== undefined, true);
  assert.equal(ev.length, 0);
});

test("TOOLS are OpenAI function definitions for the seven tools", () => {
  assert.deepEqual(TOOLS.map((t) => t.function.name), ["check_lists", "connections", "changes", "chips", "site_docs", "research", "answer"]);
  for (const t of TOOLS) {
    assert.equal(t.type, "function");
    assert.equal(t.function.parameters.type, "object");
    assert.ok(t.function.description.length > 20);
  }
  const by = Object.fromEntries(TOOLS.map((t) => [t.function.name, t.function.parameters]));
  assert.deepEqual(by.chips.properties.topic.enum, ["summary", "routes", "coverage", "listing_lag", "firms"]);
  assert.deepEqual(by.changes.required, ["since"]);
  assert.match(TOOLS[0].function.description, /bare name|bare IMO/);
  assert.deepEqual(Object.keys(by.check_lists.properties), ["query", "programme", "word", "list"]);
  assert.deepEqual(by.check_lists.properties.list.enum, ["us", "uk", "eu", "un"]);
  assert.deepEqual(by.check_lists.required, []); // a query, a programme or a word, or a query with one of them
  assert.deepEqual(by.changes.properties.graph.enum, ["fleet", "lobby"]);
  assert.deepEqual(Object.keys(by.research.properties), ["programme", "listed_by", "flag", "ship_type", "names_changed"]);
  assert.deepEqual([by.research.properties.programme.type, by.research.properties.names_changed.type, by.research.required], ["array", "boolean", []]);
  assert.deepEqual(by.research.properties.listed_by.enum, ["us", "uk", "eu"]);
  assert.deepEqual(by.research.properties.ship_type.enum, ["tanker", "cargo", "container", "bulk carrier", "tug"]);
  assert.deepEqual(by.answer.properties.kind.enum, ["answer", "refusal", "clarify"]);
  assert.deepEqual(Object.keys(by.answer.properties), ["kind", "sentences", "next"]); // no refusal_reason: nothing reads it (final wave)
  const s = by.answer.properties.sentences.items;
  assert.deepEqual(s.properties.claim.enum, ["listed", "age", "count", "none_matched", "not_found", "change", "named", "quote"]);
  assert.equal(s.properties.sources.type, "array");
  assert.equal(s.properties.quote.type, "integer");
  assert.deepEqual(s.required, ["claim", "sources"]);
  assert.deepEqual(by.answer.required, ["kind", "sentences"]);
  // the model writes no words: no text in a sentence, no label in a next step
  assert.equal(s.properties.text, undefined);
  assert.deepEqual(Object.keys(by.answer.properties.next.items.properties), ["source"]);
  assert.deepEqual(by.answer.properties.next.items.required, ["source"]);
});

test("the answer tool's claim enum includes count, age and none_matched", () => {
  const answerTool = TOOLS.find((t) => t.function.name === "answer").function;
  const claim = answerTool.parameters.properties.sentences.items.properties.claim;
  assert.match(claim.description, /^One name from the list, never a sentence/); // a model once wrote its own sentences here
  for (const name of ["count", "age", "none_matched"]) {
    assert.ok(claim.enum.includes(name), name);
    assert.match(answerTool.description, new RegExp(`\\b${name}: `), name);
    assert.match(claim.description, new RegExp(`\\b${name}\\b`), name);
  }
  // an answer with no sentences is how the model says nothing answers
  assert.match(answerTool.description, /no sentences/);
  // the research tool names the map's own programme groups, read from the map (this site's map has two), and the updates' topic
  // filter says what it returns when nothing matches
  const by = Object.fromEntries(TOOLS.map((t) => [t.function.name, t.function]));
  assert.match(by.research.parameters.properties.programme.description, /: Russia and Iran\.$/);
  assert.doesNotMatch(by.research.parameters.properties.programme.description, /Venezuela|Terrorism|North Korea/);
  assert.match(by.changes.description, /topic[^.]*none item[^.]*checked[^.]*not/i);
});

test("every item from every tool has an id in order, a text, a label and a safe url", async () => {
  await run("check_lists", { query: "TASSOS" });
  await run("check_lists", { programme: "Russia" });
  await run("check_lists", { programme: "Gatik" });
  await run("connections", { query: "IMO 9408695" });
  await run("connections", { query: "Nord Stream 2 AG" });
  await run("changes", { since: "2026-10-12" });
  for (const topic of ["summary", "routes", "coverage", "listing_lag", "firms"]) await run("chips", { topic });
  await run("site_docs", { query: "matching" });
  const KINDS = new Set(["search", "list", "research", "opensanctions", "connection", "lobbying", "change", "gap", "chips", "chips_firm", "doc", "count"]);
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
  assert.match(ev.find((e) => e.kind === "connection" && /records the relationship: "TASSOS"/.test(e.text)).quotes[0], /^OpenSanctions records the relationship: "TASSOS"/);
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
  assert.match(ev[0].quotes[0], /^The graphs now show 1,747 ships and 1,037 companies, rebuilt every night from official sources\.$/);
  ev = [];
  await run("site_docs", { query: "lantern facts" });
  const doc = ev.find((e) => e.label === "Lantern facts");
  assert.equal(doc.quotes.length, 20); // doc and chips items quote up to 20, the rest up to 12
  assert.equal(doc.quotes[0], "The U.S. Treasury acted on 1 May."); // not "The U.S." and "Treasury acted on 1 May."
  assert.equal(doc.quotes[19], "Lantern fact 19 is recorded in the log.");
  assert.ok(!doc.quotes.includes("Overview."));
});

test("quotes: a chips table row of five or more words is a sentence; a short row and the lead-in line are not", async () => {
  await run("chips", { topic: "coverage" });
  const table = ev.find((e) => /one year per line/.test(e.text));
  assert.match(table.text, /\n2025: none\.?$/);
  assert.deepEqual(table.quotes, ["2024: Netherlands; France; Spain; Italy; Belgium."]);
});

test("quote naming an entity with listing language is not offered", async () => {
  await run("site_docs", { query: "Rusal removal from the US list" });
  const rusal = ev.find((e) => e.label === "Rusal's removal from the US list");
  assert.match(rusal.text, /OFAC listed Oleg Deripaska, En\+, Rusal/); // still in the text the model reads
  // the listing of Rusal, Deripaska's (a name at the start of a sentence is still a name), "listed it" (an entity named elsewhere),
  // a removal beside a name ("remove" is listing language as much as "removed"), and "Contested: Treasury negotiated the deal …"
  // (an authority word counts as listing language, and "Contested" is not a generic starter)
  assert.deepEqual(rusal.quotes, []);
  ev = [];
  // chips: every row of the post-invasion table names a firm beside "listed", and a press release's title names its targets
  await run("chips", { topic: "listing_lag" });
  assert.deepEqual(ev.find((e) => /shortest first/.test(e.text)).quotes, []);
  ev = [];
  await run("chips", { topic: "firms" });
  assert.ok(ev.length >= 3);
  // the count and each firm: claims the server writes (count, named), never a quote
  for (const e of ev) assert.deepEqual(e.quotes, [], e.label);
  // the summary's headline names no firm, opens with "The" and points at nothing, so the starter question's answer is quotable
  ev = [];
  await run("chips", { topic: "summary" });
  assert.equal(ev[0].quotes[0], "The median time to list a new chip supplier (US Treasury OFAC) is 20.3 months from founding to OFAC listing, across 25 firms founded after 24 February 2022 (the middle half took 16.1 to 25.8 months).");
});

test("explainer sentence with listing language and no entity is offered", async () => {
  await run("site_docs", { query: "main tools asset freeze" });
  const tools = ev.find((e) => e.label === "The main tools");
  assert.match(tools.text, /^Asset freeze \(also called blocking\)\. Nobody may pay, hold or move the target's money or property\./);
  assert.deepEqual(tools.quotes, [
    // not offered: "Asset freeze (also called blocking)." and "Secondary sanctions (pressure on outsiders)." (two words and a
    // bracketed gloss: a label for whatever came before), "Nobody may pay, hold or move the target's money or property." (the target is named elsewhere),
    // '"An asset freeze means …' (opens with a quotation mark), "Hollow shapes …" (not a starter). "… such as LLC or OOO." is offered:
    // "such as" points nowhere (final wave)
    "Names are compared after removing endings such as LLC or OOO.",
    "Companies owned by a listed party can be blocked without being named (section 2).",
    "In the US, any company owned 50% or more in total by listed parties is blocked automatically, even through a chain of other companies.",
  ]);
});

// ---- fix round 2: the re-review's findings -------------------------------------------------------------------------

test("a listing sentence is quotable only with generic capitalised words and nothing pointing elsewhere", async () => {
  await run("site_docs", { query: "listing sentences" });
  const doc = ev.find((e) => e.label === "Listing sentences");
  // "All three are fully blocked", "The company is not on the UK or EU list by name.", "YEHOPE was listed by the EU first…",
  // "MISHELL is on the US list only.", "Titan-Micro listed by the US Treasury.", "Each of them …", "Both were designated …",
  // "In May all 3 were blocked.", "Under the rules all three were blocked.", "No manager of the 42 is UK-listed …" (the 42 is
  // a set named elsewhere) and "No sanctions wording found …" (never quotable): not offered
  assert.deepEqual(doc.quotes, [
    "A sanction is a government rule that says: do not do business with a named person, company or country.",
    "Nobody may pay, hold or move money for a blocked person.",
  ]);
});

test("the Hytera combination: lobbyists named in filings, then 'All three are fully blocked', cannot be rendered", async () => {
  await run("connections", { query: "Nord Stream 2 AG" });
  await run("site_docs", { query: "listing sentences" });
  const lobbyists = ev.find((e) => e.kind === "lobbying" && /Lobbyists named in the filings/.test(e.text));
  assert.ok(lobbyists.quotes.some((q) => q.startsWith("Lobbyists named in the filings for Nord Stream 2 AG")));
  assert.ok(ev.every((e) => e.quotes.every((q) => !/All three are fully blocked/.test(q))));
});

// ---- fix round 4: the final check's findings ------------------------------------------------------------------------

const WHOLE = /^[\p{Lu}\p{N}].*[.!?]["”’')\]]*$/su;
const TAIL = /^(?:Ltd|LTD|Limited|LIMITED|Co|Corp|Inc|LLC|L\.L\.C|S\.A|SA|SAL|Pte|PTE|GmbH|AG|PJSC|JSC|OOO|PLC)\.?(?:[\s,;:)]|$)/;
const POINTING = /\b(?:it|its|they|them|their|this|these|those|he|she|his|her|both|above|below|here|there|such|former|latter|then)\b|\bthe other\b|\b(?:all|the)\s+(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\b|\b[Tt]he(?:\s+[\p{L}\p{N}'’-]+){0,2}\s+(?:target|shipowner|parent|tanker|firm|company|ship|vessel|owner|manager|operator|name|entry|list|bank|group|entity|person)s?\b|\b[Tt]he(?:\s+[\p{L}\p{N}'’-]+){0,2}\s+(?:companies|entries|entities|people)\b/u;
const caps = (q) => q.replace(/(?<![\p{L}\p{N}])\p{Lu}{2,}(?![\p{L}\p{N}])/gu, " ");
const NOT_POINTING = /\bsuch as\b|(?<=^\s*|[,;:]\s*|\b(?:and|but|or|so|because|if|when|while|although|though|since|that|as)\s+)there(?=\s+(?:is|are|was|were)\b)|(?<=^\s*(?:is|are|was|were)\s+)there\b/gi; // final wave

test("round 4 (b): no quote, in any item, carries a pointing word", async () => {
  await run("site_docs", { query: "pointing sentences" });
  const doc = ev.find((e) => e.label === "Pointing sentences");
  assert.ok(doc.text.split(". ").length >= 20);
  // self-contained sentences stay; "Owners of the two were named in May." ("the two") and every pointing sentence go
  assert.deepEqual(doc.quotes, [
    "There are 1,724 ships in the research.", // an existential "there" points nowhere (final wave)
    "Banks, exporters, shippers and insurers do the actual stopping.",
    "A seven-digit number is treated as an IMO number by the search.",
    "Nobody may pay, hold or move money for a blocked person.",
    "Fees were paid through the Nickles Group in 2019.", // "the Nickles Group" is a name: a capitalised noun is not the generic one
  ]);
  for (const s of ["The other lists still update.", "Every figure here comes", "counts above are rebuilt", "It was carrying about 800,000 barrels", "These tankers move oil", "Treasury says these ships carried", "Its parent En+ paid", "Such firms rarely sign", "The former paid", "Both were founded", "He paid the fees", "The manager of the hull", "The shipowner is a one-ship", "The parent paid", "Owners of the two", "Official example: the US Treasury's own entry for RM Design", "4 have no founding date in the OFAC entry",
    // round 5: "froze" is listing language and "the shipping firms" points (NC1); "The UK entry … the old names", "Until then" and "The registered owners" point
    "The act that froze the shipping firms", "The UK entry still shows the old names.", "Until then, trading is easy.", "The registered owners of a hull pay the fees.", "The other hull was renamed in 2024."]) {
    assert.ok(doc.text.includes(s), `in the text: ${s}`);
    assert.ok(!doc.quotes.some((q) => q.includes(s)), `quotable: ${s}`);
  }
  // and in every item of every tool, on the fixture site
  await everyTool();
  await run("connections", { query: "IMO 6482241" });
  await run("site_docs", { query: "main tools asset freeze" });
  for (const e of ev) for (const q of e.quotes) assert.doesNotMatch(caps(q).replace(NOT_POINTING, " "), POINTING, `${e.id} ${e.label}: ${q}`);
  // the routes caveat is still offered, worded without "These"
  const routes = ev.find((e) => e.kind === "chips" && /declared exports to Russia/.test(e.label));
  assert.ok(routes.quotes.includes("Comtrade figures are declarations, not traced shipments, and fewer countries have reported the most recent years, so the latest totals are incomplete."), routes.quotes.join(" | "));
});

test("round 4 (c): a quote is a whole sentence of five or more words that opens with a capital or a digit, never a name's tail or a cut list", async () => {
  await run("site_docs", { query: "fragments" });
  const doc = ev.find((e) => e.label === "Fragments");
  assert.deepEqual(doc.quotes, [
    "12 ships of the fleet were renamed in 2025.",
    "Anglo Premier Shipping Pte. Ltd. owns the hull and nothing else.", // "Pte." does not end a sentence
    "Five words make a sentence.",
    "Yes, a sentence may open with a short word and a comma.", // not a cut list: a short word, not a name in capitals
  ]);
  for (const s of ["Ltd. is the ending", "S.A. is the ending", "LIMITED, CONCEPTO SCREEN SAL", "FIORA, UK-flagged", "Four words do not.", "2025/933, 20 May 2025).", "/../tools/fleet/ run steps", "# Method How", '"Quoted sentences start with a mark']) {
    assert.ok(doc.text.includes(s), `in the text: ${s}`);
    assert.ok(!doc.quotes.some((q) => q.includes(s)), `quotable: ${s}`);
  }
  // the rule holds for every quote of every tool
  await everyTool();
  await run("connections", { query: "IMO 6482241" });
  for (const e of ev) for (const q of e.quotes) {
    assert.match(q, WHOLE, `${e.id} ${e.label}: ${q}`);
    assert.ok(q.split(/\s+/).length >= 5, `${e.id} ${e.label}: ${q}`);
    assert.doesNotMatch(q, TAIL, `${e.id} ${e.label}: ${q}`);
    assert.doesNotMatch(q, /^[\p{Lu}\p{N}][\p{Lu}\p{N}./-]{2,},/u, `${e.id} ${e.label}: ${q}`);
  }
});

test("round 4 (c): connection and lobbying quotes are the sentences the tool built, never a re-split of its text", async () => {
  await run("connections", { query: "IMO 6482241" });
  const head = ev.find((e) => e.kind === "connection" && e.entity?.name === "Anglo Premier Shipping Pte. Ltd.");
  assert.equal(head.text, "OpenSanctions connections data for Anglo Premier Shipping Pte. Ltd. (Organization, IMO 6482241). Direct links recorded for Anglo Premier Shipping Pte. Ltd.: 1.");
  assert.deepEqual(head.quotes, ["Direct links recorded for Anglo Premier Shipping Pte. Ltd.: 1."]); // (the head line is a heading: text only)
  const link = ev.find((e) => e.kind === "connection" && /Owned by/.test(e.text));
  assert.equal(link.text, 'OpenSanctions records the relationship: "Anglo Premier Shipping Pte. Ltd." — Owned by — "SOVCOMFLOT". Type of SOVCOMFLOT: Company.');
  assert.deepEqual(link.quotes, ['OpenSanctions records the relationship: "Anglo Premier Shipping Pte. Ltd." — Owned by — "SOVCOMFLOT".']); // "Type of SOVCOMFLOT: Company." is four words
  ev = [];
  await run("connections", { query: "Nord Stream 2 AG" });
  const lobbyists = ev.find((e) => e.kind === "lobbying" && /Lobbyists named/.test(e.text));
  // one sentence, whole, with the posts in brackets ("past", since "former" points elsewhere)
  assert.deepEqual(lobbyists.quotes, [
    "Lobbyists named in the filings for Nord Stream 2 AG: Jane Example at Capitol Counsel LLC (past posts: Legislative Assistant, Sen. Smith) (formerly served in US Senate).",
    "Government bodies Nord Stream 2 AG's lobbyists formerly served in: US Senate (1).",
  ]);
  assert.doesNotMatch(lobbyists.text, /former posts/);
  ev = [];
  await run("connections", { query: "Acme Widgets" });
  const none = ev.find((e) => e.kind === "connection");
  assert.deepEqual(none.quotes, ["No exact match by name or IMO number exists in the OpenSanctions connections data."]); // "Matching there is exact …" points
});

test("minors (2): every connection and lobbying quote names its subject, verbatim from its own item", async () => {
  await everyTool();
  await run("connections", { query: "Zulu Ships Management" });
  await run("connections", { query: "IMO 6467751" });
  const items = ev.filter((e) => (e.kind === "connection" || e.kind === "lobbying") && e.entity);
  const quotes = items.flatMap((e) => e.quotes);
  assert.ok(quotes.length > 6, quotes.join(" | "));
  for (const e of items) for (const q of e.quotes) {
    assert.ok(e.text.includes(q), `${e.label}: ${q}`);
    if (!q.startsWith("Documented link: ")) assert.ok(q.includes(e.entity.name), `${e.label}: ${q}`); // a documented link names its own two parties
  }
  // the re-review's subjectless lines
  for (const q of ["Direct links recorded for TASSOS: 1.", "Direct links recorded for Hapuka Marine LTD.: none.", "Government bodies Nord Stream 2 AG's lobbyists formerly served in: US Senate (1).",
    "Bills Nord Stream 2 AG's lobbying firms lobbied on, by filings: S.722 Countering Iran's Destabilizing Activities Act (2017) (5)."]) {
    assert.ok(quotes.includes(q), `${q} in ${quotes.join(" | ")}`);
  }
  assert.ok(quotes.some((q) => /^Direct links recorded for Zulu Ships Management: \d+, the first \d+ shown\.$/.test(q)), quotes.join(" | "));
  assert.ok(quotes.some((q) => q.startsWith("Lobbying firms hired by Nord Stream 2 AG: Capitol Counsel LLC")), quotes.join(" | "));
  assert.ok(!quotes.some((q) => /^(?:Lobbying firms hired:|Bills lobbied on|Government bodies the lobbyists|No direct links|\d+ direct links?\b)/.test(q)), quotes.join(" | "));
});

test("round 4 (a): a listing-language quote only from a doc or chips item, generic throughout; an authority word counts as listing language", async () => {
  await run("site_docs", { query: "lantern facts" });
  assert.equal(ev.find((e) => e.label === "Lantern facts").quotes[0], "The U.S. Treasury acted on 1 May."); // U.S. and Treasury are allowed names
  ev = [];
  await run("site_docs", { query: "listing sentences" });
  assert.ok(ev.find((e) => e.label === "Listing sentences").quotes.includes("A sanction is a government rule that says: do not do business with a named person, company or country."));
  // research, connection and lobbying items: none at all
  await everyTool();
  const LISTING = /\b(?:\w*sanction\w*|\w*list\w*|designat\w*|target(?:s|ed|ing)?|freez\w*|frozen|blocked|penalis\w*|penaliz\w*|penalt\w*|embargo\w*|prohibit\w*|(?:de)?barred|restrict\w*|ban(?:s|ned)?|fine[sd]?|punish\w*|remov(?:e[sd]?|als?)|lift(?:s|ed)?|revok\w*)\b|\bappear(?:s|ed|ing)?\s+on\b|\b(?:OFAC|SDN|Treasury|OFSI|BIS|Commerce|Entity List)\b/i;
  const ALLOWED = /\b(?:OpenSanctions|Undercurrent)\b/g;
  let seen = 0;
  for (const e of ev.filter((x) => ["research", "connection", "lobbying"].includes(x.kind))) for (const q of e.quotes) {
    seen++;
    assert.doesNotMatch(q.replace(ALLOWED, ","), LISTING, `${e.id} ${e.label}: ${q}`);
  }
  assert.ok(seen > 10);
});

test("round 4 (b): a research fact that points elsewhere is not quoted; a name or flag code written in capitals is not a pronoun", async () => {
  await run("check_lists", { query: "SI HE" });
  const r = ev.find((e) => e.kind === "research" && e.entity.name === "SI HE");
  assert.match(r.text, /It was carrying about 800,000 barrels of Russian crude in June 2026\./);
  assert.deepEqual(r.quotes, [
    "Undercurrent's research records no manager for SI HE.",
    "Other names of SI HE: FEI YUN HE.",
    "Flags flown by SI HE: Panama, IT.",
    "SI HE has also sailed as FEI YUN HE.",
    // "Latvia froze accounts of SI HE in 2023." is not offered: "froze" is listing language (round 5, NC1)
  ]);
  assert.match(r.text, /Latvia froze accounts of SI HE in 2023\./);
});

test("round 4 (a): a listing-language sentence made only of generic words is still not quoted from a lobbying item", async () => {
  await run("connections", { query: "Banks" });
  const parent = ev.find((e) => e.kind === "lobbying" && /foreign entity behind/.test(e.text));
  assert.equal(parent.text, "Sanctions is recorded in the filings as a foreign entity behind Banks."); // every capitalised word is a generic starter
  assert.deepEqual(parent.quotes, []);
  const firms = ev.find((e) => e.kind === "lobbying" && /in US lobbying filings/.test(e.text));
  assert.deepEqual(firms.quotes, []); // the head line is a heading (final wave), and "… recorded for it …" points
});

test("round 4: research profile lines name their subject, so none borrows one from the sentence before", async () => {
  await run("check_lists", { query: "TASSOS" });
  const r = ev.find((e) => e.kind === "research" && e.entity.name === "TASSOS");
  assert.match(r.text, /Manager of TASSOS: THE ZULU SHIPS MANAGEMENT AND OPERATION - SOLE PROPRIETORSHIP L\.L\.C\. Role of TASSOS: tanker \(both UK Russia list and US Iran-programme list\)\. Other names of TASSOS: Bay Global\. Flags flown by TASSOS: Liberia, Panama\./);
  assert.ok(r.quotes.includes("Manager of TASSOS: THE ZULU SHIPS MANAGEMENT AND OPERATION - SOLE PROPRIETORSHIP L.L.C."));
  ev = [];
  await run("check_lists", { query: "United Company RUSAL" });
  assert.ok(ev.find((e) => e.kind === "research").quotes.includes("Country of United Company RUSAL: Russia."));
});

test("team wording, present-tense currency wording and maintainer notes are never quotable", async () => {
  await run("site_docs", { query: "field notes" });
  assert.deepEqual(ev.find((e) => e.label === "Field notes").quotes, ["Every figure is checked twice."]);
  // every sentence of a maintainer-note section ("Files", "Reproduce", build or run steps), even one that would pass alone
  ev = [];
  await run("site_docs", { query: "rebuild the graphs" });
  const reproduce = ev.find((e) => e.label === "Reproduce");
  assert.match(reproduce.text, /^Rebuild the graphs: run the build\./);
  assert.deepEqual(reproduce.quotes, []);
  ev = [];
  await run("site_docs", { query: "files nodes organisation" });
  assert.deepEqual(ev.find((e) => e.label === "Files").quotes, []);
  ev = [];
  await run("site_docs", { query: "shelf materials browser server" });
  assert.deepEqual(ev.find((e) => e.label === "2. What's on the shelf (Materials)").quotes, []); // a sentence that would pass alone
  // and in research: "Currently sailing under the Liberian flag." is not offered
  ev = [];
  await run("check_lists", { query: "TASSOS" });
  const r = ev.find((e) => e.kind === "research" && e.entity.name === "TASSOS");
  assert.match(r.text, /Currently sailing under the Liberian flag\./);
  assert.ok(!r.quotes.some((q) => /Currently/.test(q)));
});

test("connection evidence states relationships only and never names a government", async () => {
  await run("connections", { query: "IMO 9408695" });
  await run("connections", { query: "Zulu Ships Management" });
  await run("connections", { query: "IMO 6467751" });
  const conn = ofKind("connection");
  assert.ok(conn.length > 3);
  for (const e of conn) {
    for (const t of [e.text, ...e.quotes]) assert.doesNotMatch(t, /recorded under|\b(?:US|UK|EU|UN|France|United States|United Kingdom|European Union|United Nations)\b/, t);
  }
  assert.match(conn.find((e) => e.entity?.name === "TASSOS").text, /^OpenSanctions connections data for TASSOS \(Vessel, IMO 9408695\)\. Direct links recorded for TASSOS: 1\.$/);
});

test("sentences don't break after common abbreviations, and a fragment is not a quote", async () => {
  await run("site_docs", { query: "abbreviations aside fragment" });
  assert.deepEqual(ev.find((e) => e.label === "Abbreviations").quotes, [
    "Rep. Jane Doe of St. Petersburg met Acme Co. Ltd. staff on No. 5 street.",
    "Mr. Lee, Ms. Kim and Dr. Park met Boribo PTE. LTD. and Hapuka Inc. staff, e.g. at lunch, i.e. at noon, with Sen. Roe and the U.K. and U.S. delegations.",
  ]);
  // the reviewer's "(Organization, IMO 6467751)…": a name ending in "LTD." stays whole
  ev = [];
  await run("connections", { query: "IMO 6467751" });
  const head = ev.find((e) => e.kind === "connection");
  assert.ok(head.text.startsWith("OpenSanctions connections data for Hapuka Marine LTD. (Organization, IMO 6467751). "), head.text);
  assert.deepEqual(head.quotes, ["Direct links recorded for Hapuka Marine LTD.: none."]); // (the head line is a heading: text only)
  assert.ok(ev.every((e) => e.quotes.every((q) => !/^[\p{Ll}(]/u.test(q))));
});

test("research quotes leave out a fact naming the authority, and one that 'appears on' something", async () => {
  await run("check_lists", { query: "TASSOS" });
  const r = ev.find((e) => e.kind === "research" && e.entity.name === "TASSOS");
  assert.match(r.text, /Named in an OFAC press release/);
  assert.match(r.text, /TASSOS appears on the Equasis register/);
  assert.ok(r.quotes.every((q) => !/OFAC|Equasis/.test(q)), r.quotes.join(" | "));
});

test("changes: gaps of every source are reported whatever the graph filter", async () => {
  const day = (date, sources = FRESH) => ({ date, sources, changes: [] });
  const nights = (down) => ({ ...CHANGES, days: ["2026-10-16", "2026-10-15", "2026-10-14", "2026-10-13", "2026-10-12"].map((d) => day(d, d === "2026-10-14" ? { ...FRESH, ...down } : FRESH)) });
  try {
    // the reviewer's case: graph=fleet on a night when only lobbying was down, nothing changed anywhere
    write(root, "data/changes/changes.json", nights({ lobbying: "unavailable" }));
    resetAskCache();
    await run("changes", { since: "2026-10-14", until: "2026-10-14", graph: "fleet" });
    assert.deepEqual(ev.map((e) => [e.kind, e.found, e.source]), [["change", false, undefined], ["gap", undefined, "The US lobbying data"]]);
    // and graph=lobby on a night when the UK list was down: the network's listing statuses come from the lists
    write(root, "data/changes/changes.json", nights({ uk: "unavailable" }));
    resetAskCache();
    ev = [];
    await run("changes", { since: "2026-10-14", until: "2026-10-14", graph: "lobby" });
    assert.deepEqual(ev.map((e) => [e.kind, e.found, e.source]), [["change", false, undefined], ["gap", undefined, "The UK list"]]);
  } finally {
    write(root, "data/changes/changes.json", CHANGES);
  }
});

test("changes: missing nights are counted from the first run, not from the first night held", async () => {
  try {
    // no night held at all
    write(root, "data/changes/changes.json", { ...CHANGES, days: [] });
    resetAskCache();
    await run("changes", { since: "2026-10-13", until: "2026-10-15" });
    assert.deepEqual(ev.map((e) => [e.kind, e.found, e.source, e.from, e.to]), [["gap", undefined, "The nightly update", "2026-10-13", "2026-10-15"]]);
    // the record started on the 12th but the first night it holds is the 16th
    write(root, "data/changes/changes.json", { ...CHANGES, days: ["2026-10-19", "2026-10-18", "2026-10-17", "2026-10-16"].map((date) => ({ date, sources: FRESH, changes: [] })) });
    resetAskCache();
    ev = [];
    await run("changes", { since: "2026-10-12", until: "2026-10-14" });
    assert.deepEqual(ev.map((e) => [e.kind, e.found, e.source, e.from, e.to]), [["gap", undefined, "The nightly update", "2026-10-12", "2026-10-14"]]);
    assert.doesNotMatch(JSON.stringify(ev), /No changes were recorded/);
  } finally {
    write(root, "data/changes/changes.json", CHANGES);
  }
});

test("quotes: a research item quotes its facts, never a listing, the authority behind one, or the match", async () => {
  await run("check_lists", { query: "TASSOS" });
  const r = ev.find((e) => e.kind === "research" && e.entity.name === "TASSOS");
  // (the head line "TASSOS (Oil Tanker, …) in Undercurrent's research." is in the text, never a quote; each fact names its subject)
  assert.deepEqual(r.quotes, [
    "Manager of TASSOS: THE ZULU SHIPS MANAGEMENT AND OPERATION - SOLE PROPRIETORSHIP L.L.C.",
    "Other names of TASSOS: Bay Global.",
    "Flags flown by TASSOS: Liberia, Panama.",
    "9 September 2024: TASSOS managed by the Zulu Ships Management & Operation - Sole Proprietorship LLC.",
    "TASSOS has also sailed as Bay Global and Front Balder.",
  ]);
  assert.match(r.text, /^TASSOS \(Oil Tanker, IMO 9408695, flag Liberia\) in Undercurrent's research\./);
  // every research item of the entry quotes the same facts
  for (const e of ev.filter((x) => x.kind === "research" && x.entity.name === "TASSOS")) assert.deepEqual(e.quotes, r.quotes);
  ev = [];
  await run("check_lists", { query: "United Company RUSAL" });
  const rusal = ev.find((e) => e.kind === "research");
  assert.match(rusal.text, /United Company RUSAL appears on the US Treasury list from 2018; removed in 2019\./);
  assert.deepEqual(rusal.quotes, ["Country of United Company RUSAL: Russia."]);
});

test("quotes: the model sees them numbered from 0, beside the text only where they don't cover it", async () => {
  const out = await run("check_lists", { query: "TASSOS" });
  const shown = (kind) => out.items.find((i) => i.kind === kind);
  assert.equal(shown("research").quotes[0], "[0] Manager of TASSOS: THE ZULU SHIPS MANAGEMENT AND OPERATION - SOLE PROPRIETORSHIP L.L.C.");
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
  assert.equal(cfg.includeFiles, "{data/lists/*.json,data/research-index.json,data/changes/changes.json,data/site-stats.json,data/ask-docs.json,stories/chips-into-russia/data/*.json,stories/shadow-fleet/network/fleet-data.json,stories/who-lobbies/influence-network/kg.json}");
});
