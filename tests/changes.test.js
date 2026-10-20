import { test } from "node:test";
import assert from "node:assert/strict";
import {
  changesSince, daysWithChanges, presetSince, sourceGaps, gapText, renderChangeList, renderCalendar, moveDay, mountChangesPanel,
} from "../app/changes.js";

// Shaped like data/changes/changes.json: newest day first, each Change as scripts/changes.py writes it.
const FRESH = { us: "fresh", uk: "fresh", eu: "fresh", un: "fresh", lobbying: "fresh" };
const UK_URL = "https://search-uk-sanctions-list.service.gov.uk/designations/RUS3483/Ship";
const ship = (o = {}) => ({
  date: "2026-10-21", graph: "fleet", kind: "added", item: "node", id: "IMO9408695", name: "TASSOS", node_type: "ship",
  field: "listed_by", to: ["UK"], summary: "UK listed TASSOS (IMO 9408695)", source_url: UK_URL, source_label: "UK Sanctions List", ...o,
});
const link = (o = {}) => ({
  date: "2026-10-21", graph: "fleet", kind: "added", item: "edge", id: "e:0123456789ab", name: "Zulu Ships Management → TASSOS",
  node_type: "manages", endpoints: ["Zulu Ships Management", "TASSOS"], endpoint_ids: ["co:zulu-ships-management", "IMO9408695"],
  summary: "New link: TASSOS → Zulu Ships Management (managed by)", source_url: "https://example.gov/zulu", source_label: "UK Sanctions List", ...o,
});
const firm = (o = {}) => ({
  date: "2026-10-22", graph: "lobby", kind: "added", item: "node", id: "co:acme-lobbying", name: "Acme Lobbying LLC", node_type: "lobbying firm",
  summary: "New lobbying firm: Acme Lobbying LLC", source_url: "https://lda.senate.gov/filings/1", source_label: "US Senate lobbying disclosure (LDA)", ...o,
});
const RECORD = {
  started: "2026-10-20",
  days: [
    { date: "2026-10-23", sources: { ...FRESH, uk: "unavailable" }, changes: [] },
    { date: "2026-10-22", sources: FRESH, changes: [firm()] },
    { date: "2026-10-21", sources: { ...FRESH, eu: "unavailable", lobbying: "unavailable" }, changes: [ship(), link(), ship({ kind: "removed", id: "IMO9341279", name: "ADISA", summary: "EU removed ADISA (IMO 9341279)" })] },
    { date: "2026-10-20", sources: FRESH, changes: [] },
  ],
};
const ids = (changes) => changes.map((c) => c.id);

test("the module imports in Node and exports the panel", () => {
  assert.equal(typeof mountChangesPanel, "function");
});

test("changesSince handles empty and out-of-range", () => {
  assert.deepEqual(changesSince(null, "fleet", "2026-10-12", "2026-10-23"), []);
  assert.deepEqual(changesSince({ started: "2026-10-20", days: [] }, "fleet", "2026-10-12", "2026-10-23"), []);
  assert.deepEqual(changesSince(RECORD, "fleet", "2026-10-24", "2026-10-23"), []); // since after today
  const early = changesSince(RECORD, "fleet", "2025-01-01", "2026-10-23"); // before started: treated as started
  assert.deepEqual(early, changesSince(RECORD, "fleet", "2026-10-20", "2026-10-23"));
  assert.equal(early.length, 3);
});

test("changesSince is newest first, includes the since day, stops at today and filters by graph", () => {
  const both = changesSince(RECORD, ["fleet", "lobby"], "2026-10-21", "2026-10-23");
  assert.deepEqual(ids(both), ["co:acme-lobbying", "IMO9408695", "e:0123456789ab", "IMO9341279"]);
  assert.deepEqual(ids(changesSince(RECORD, "fleet", "2026-10-22", "2026-10-23")), []); // 22 Oct holds only a lobby change
  assert.deepEqual(ids(changesSince(RECORD, "lobby", "2026-10-21", "2026-10-23")), ["co:acme-lobbying"]);
  assert.deepEqual(ids(changesSince(RECORD, "fleet", "2026-10-21", "2026-10-21")), ["IMO9408695", "e:0123456789ab", "IMO9341279"]);
  assert.deepEqual(changesSince(RECORD, "fleet", "2026-10-21", "2026-10-20"), []); // today before since
});

test("changesSince takes one graph or an array of graphs", () => {
  assert.equal(changesSince(RECORD, "fleet", "2026-10-20", "2026-10-23").length, 3);
  assert.equal(changesSince(RECORD, ["fleet"], "2026-10-20", "2026-10-23").length, 3);
  assert.equal(changesSince(RECORD, ["fleet", "lobby"], "2026-10-20", "2026-10-23").length, 4);
  assert.equal(changesSince(RECORD, [], "2026-10-20", "2026-10-23").length, 0);
});

test("daysWithChanges marks only days with changes for the graph", () => {
  assert.deepEqual([...daysWithChanges(RECORD, "fleet")], ["2026-10-21"]);
  assert.deepEqual([...daysWithChanges(RECORD, "lobby")], ["2026-10-22"]);
  assert.deepEqual([...daysWithChanges(RECORD, ["fleet", "lobby"])].sort(), ["2026-10-21", "2026-10-22"]);
  assert.equal(daysWithChanges(null, "fleet").size, 0);
});

test("presetSince counts calendar days in UTC", () => {
  assert.equal(presetSince("7d", "2026-10-19"), "2026-10-12");
  assert.equal(presetSince("yesterday", "2026-10-19"), "2026-10-18");
  assert.equal(presetSince("10d", "2026-10-19"), "2026-10-09");
  assert.equal(presetSince("10d", "2027-01-03"), "2026-12-24"); // year boundary
  assert.equal(presetSince("yesterday", "2028-03-01"), "2028-02-29"); // leap day
  assert.equal(presetSince("7d", "2026-03-30"), "2026-03-23"); // across the US and EU clock changes
  assert.throws(() => presetSince("30d", "2026-10-19"), /preset/);
});

test("sourceGaps lists unavailable sources inside the window, newest day first", () => {
  const both = ["fleet", "lobby"];
  assert.deepEqual(sourceGaps(RECORD, both, "2026-10-20", "2026-10-23"), [
    { source: "uk", date: "2026-10-23" },
    { source: "eu", date: "2026-10-21" },
    { source: "lobbying", date: "2026-10-21" },
  ]);
  assert.deepEqual(sourceGaps(RECORD, both, "2026-10-22", "2026-10-23"), [{ source: "uk", date: "2026-10-23" }]);
  assert.deepEqual(sourceGaps(RECORD, both, "2026-10-22", "2026-10-22"), []);
  assert.deepEqual(sourceGaps(RECORD, both, "2025-01-01", "2026-10-20"), []); // clamped to started; 20 Oct was fine
  assert.deepEqual(sourceGaps(RECORD, both, "2026-10-24", "2026-10-23"), []);
  assert.deepEqual(sourceGaps(null, both, "2026-10-20", "2026-10-23"), []);
});

test("sourceGaps is per graph: the map has no lobbying gap, the network has both kinds", () => {
  const all = [{ source: "uk", date: "2026-10-23" }, { source: "eu", date: "2026-10-21" }];
  assert.deepEqual(sourceGaps(RECORD, "fleet", "2026-10-20", "2026-10-23"), all); // the lists, never lobbying
  assert.deepEqual(sourceGaps(RECORD, ["fleet"], "2026-10-20", "2026-10-23"), all);
  assert.deepEqual(sourceGaps(RECORD, "lobby", "2026-10-20", "2026-10-23"), [{ source: "lobbying", date: "2026-10-21" }]);
  assert.deepEqual(sourceGaps(RECORD, ["fleet", "lobby"], "2026-10-20", "2026-10-23").map((g) => g.source), ["uk", "eu", "lobbying"]);
  assert.deepEqual(sourceGaps(RECORD, [], "2026-10-20", "2026-10-23"), []);
});

test("gapText names the source and the day", () => {
  assert.equal(gapText({ source: "uk", date: "2026-10-23" }), "UK list was unavailable on 23 Oct, so changes from it that day aren't recorded.");
  assert.equal(gapText({ source: "us", date: "2026-11-02" }), "US lists were unavailable on 2 Nov, so changes from it that day aren't recorded.");
  assert.match(gapText({ source: "eu", date: "2026-10-21" }), /^EU lists were unavailable on 21 Oct/);
  assert.match(gapText({ source: "un", date: "2026-10-21" }), /^UN list was unavailable on 21 Oct/);
  assert.match(gapText({ source: "lobbying", date: "2026-10-21" }), /^US lobbying filings were unavailable on 21 Oct/);
});

test("renderChangeList escapes names, summaries, labels and urls", () => {
  const hostile = "<img src=x onerror=alert(1)>";
  const html = renderChangeList([ship({ name: hostile, summary: `${hostile} listed`, source_label: hostile, source_url: "javascript:alert(1)" })]);
  assert.ok(!html.includes("<img"), html);
  assert.ok(html.includes("&lt;img"), html);
  assert.ok(html.includes('href="#"'), html); // safeUrl turns a script url into #
  assert.ok(!html.includes("javascript:"), html);
  const quoted = renderChangeList([ship({ source_url: 'https://example.gov/a"onmouseover="x' })]);
  assert.ok(!quoted.includes('"onmouseover'), quoted);
});

test("renderChangeList shows kind, summary, date and a source link; no link for no url", () => {
  const html = renderChangeList([ship(), ship({ kind: "removed", source_url: "" })]);
  assert.match(html, /data-kind="added"/);
  assert.match(html, /data-kind="removed"/);
  assert.match(html, /UK listed TASSOS \(IMO 9408695\)/);
  assert.match(html, /21 Oct/);
  assert.match(html, /<a class="chg-src" href="https:\/\/search-uk-sanctions-list[^"]*"/);
  assert.equal(html.match(/<a /g).length, 1); // the second change has no url, so only its label as text
  assert.equal(renderChangeList([]), "");
});

test("renderChangeList caps at 50", () => {
  const many = Array.from({ length: 200 }, (_, i) => ship({ id: `IMO${1000000 + i}`, summary: `change ${i}` }));
  const html = renderChangeList(many);
  assert.equal(html.match(/<li /g).length, 50);
  assert.ok(html.includes("+150 more"), html);
  assert.ok(html.includes("see all on the Updates page"), html);
  assert.ok(html.includes("change 49") && !html.includes("change 50"), html);
  const linked = renderChangeList(many, { limit: 10, updatesHref: "../../updates/index.html" });
  assert.equal(linked.match(/<li /g).length, 10);
  assert.match(linked, /<a class="chg-all" href="\.\.\/\.\.\/updates\/index\.html">\+190 more · see all on the Updates page<\/a>/);
  assert.ok(!renderChangeList(many.slice(0, 50)).includes("more"));
});

test("renderChangeList indexes rows into the list it was given", () => {
  const html = renderChangeList([ship(), link()]);
  assert.match(html, /data-i="0"/);
  assert.match(html, /data-i="1"/);
});

const CAL = { min: "2026-10-20", max: "2026-10-23", since: "2026-10-21", cursor: "2026-10-21", marked: new Set(["2026-10-21"]) };

test("renderCalendar disables days before started and after today", () => {
  const html = renderCalendar("2026-10-01", CAL);
  const state = (d) => new RegExp(`<button[^>]*data-date="${d}"[^>]*>`).exec(html)[0];
  for (const d of ["2026-10-01", "2026-10-19", "2026-10-24", "2026-10-31"]) assert.match(state(d), /\bdisabled\b/, d);
  for (const d of ["2026-10-20", "2026-10-21", "2026-10-23"]) assert.doesNotMatch(state(d), /\bdisabled\b/, d);
  assert.equal(html.match(/data-date=/g).length, 31);
});

test("renderCalendar is a Monday-first grid of buttons with a dot, selection and one tab stop", () => {
  const html = renderCalendar("2026-10-01", CAL);
  assert.match(html, /^<div role="grid" aria-label="October 2026"/);
  assert.equal(html.match(/role="columnheader"/g).length, 7);
  assert.match(html, /aria-label="Monday">Mo</);
  assert.equal(html.match(/role="row"/g).length, 6); // header + 5 weeks (1 Oct 2026 is a Thursday)
  // 1 Oct 2026 is a Thursday: three empty cells come first
  assert.match(html, /role="row"><div role="gridcell"><\/div><div role="gridcell"><\/div><div role="gridcell"><\/div><div role="gridcell" aria-selected="false"><button[^>]*data-date="2026-10-01"/);
  assert.equal(html.match(/class="chg-dot"/g).length, 1);
  assert.match(/<button[^>]*data-date="2026-10-21"[^>]*>(.*?)<\/button>/.exec(html)[0], /chg-dot/);
  assert.match(/<button[^>]*data-date="2026-10-21"[^>]*>/.exec(html)[0], /aria-label="21 October 2026, has changes"/);
  assert.match(/<button[^>]*data-date="2026-10-22"[^>]*>/.exec(html)[0], /aria-label="22 October 2026"/);
  assert.match(/<button[^>]*data-date="2026-10-21"[^>]*>/.exec(html)[0], /aria-pressed="true"/);
  assert.match(/<button[^>]*data-date="2026-10-22"[^>]*>/.exec(html)[0], /aria-pressed="false"/);
  assert.equal(html.match(/aria-selected="true"/g).length, 1);
  assert.equal(html.match(/tabindex="0"/g).length, 1);
  assert.match(/<button[^>]*data-date="2026-10-21"[^>]*>/.exec(html)[0], /tabindex="0"/);
});

test("renderCalendar handles other months, a short month and a Sunday start", () => {
  assert.equal(renderCalendar("2026-02-01", { ...CAL, min: "2026-01-01", max: "2026-12-31" }).match(/data-date=/g).length, 28);
  assert.equal(renderCalendar("2028-02-01", { ...CAL, min: "2028-01-01", max: "2028-12-31" }).match(/data-date=/g).length, 29);
  const nov = renderCalendar("2026-11-01", { ...CAL, min: "2026-10-01", max: "2026-12-31", cursor: "2026-11-02" }); // 1 Nov 2026 is a Sunday
  assert.match(nov, /role="row">(<div role="gridcell"><\/div>){6}<div role="gridcell"[^>]*><button[^>]*data-date="2026-11-01"/);
  assert.equal(nov.match(/aria-selected="true"/g), null); // the selected day is in October
});

test("moveDay moves by day and week, Home/End go to the week's edges, all clamped", () => {
  const lim = ["2026-10-01", "2026-10-31"];
  const to = (d, k) => moveDay(d, k, ...lim);
  assert.equal(to("2026-10-14", "ArrowRight"), "2026-10-15");
  assert.equal(to("2026-10-14", "ArrowLeft"), "2026-10-13");
  assert.equal(to("2026-10-14", "ArrowDown"), "2026-10-21");
  assert.equal(to("2026-10-14", "ArrowUp"), "2026-10-07");
  assert.equal(to("2026-10-14", "Home"), "2026-10-12"); // Wednesday -> Monday
  assert.equal(to("2026-10-14", "End"), "2026-10-18"); // -> Sunday
  assert.equal(to("2026-10-12", "Home"), "2026-10-12");
  assert.equal(to("2026-10-18", "End"), "2026-10-18");
  assert.equal(to("2026-10-18", "Home"), "2026-10-12");
  assert.equal(to("2026-10-31", "ArrowRight"), "2026-10-31"); // stops at today
  assert.equal(to("2026-10-01", "ArrowLeft"), "2026-10-01"); // stops at started
  assert.equal(to("2026-10-28", "ArrowDown"), "2026-10-31");
  assert.equal(to("2026-10-03", "Home"), "2026-10-01"); // week starts before started
  assert.equal(moveDay("2026-10-31", "ArrowRight", "2026-10-01", "2026-11-30"), "2026-11-01"); // across months
  assert.equal(to("2026-10-14", "PageDown"), null);
  assert.equal(to("2026-10-14", "a"), null);
});

// A root with just enough of the DOM for mountChangesPanel to render into: every selector gets one inert element.
function stubRoot() {
  const part = () => ({ hidden: true, textContent: "", innerHTML: "", dataset: {}, classList: { toggle() {} }, setAttribute() {}, focus() {} });
  const parts = new Map();
  return {
    classList: { add() {}, remove() {} }, innerHTML: "", textContent: "", addEventListener() {}, removeEventListener() {},
    querySelector: (sel) => (parts.has(sel) ? parts : parts.set(sel, part())).get(sel), querySelectorAll: () => [],
  };
}
const tick = () => new Promise((resolve) => setTimeout(resolve));

test("mountChangesPanel calls onWindow after it returns, so the callback can use the handle", async () => {
  const seen = [];
  let panel;
  panel = mountChangesPanel(stubRoot(), { record: RECORD, graph: "fleet", onWindow: (since, changes) => seen.push([since, changes.length, typeof panel.setSince]) });
  assert.deepEqual(seen, []); // not during the call
  await tick();
  assert.deepEqual(seen, [["2026-10-20", 3, "function"]]); // 7 days back from 23 Oct, clamped to the record start
});

test("a setSince straight after mount still ends with the latest window; destroy cancels the first call", async () => {
  const seen = [];
  const panel = mountChangesPanel(stubRoot(), { record: RECORD, graph: "fleet", onWindow: (since) => seen.push(since) });
  panel.setSince("2026-10-21");
  await tick();
  assert.equal(seen.at(-1), "2026-10-21");
  const quiet = [];
  mountChangesPanel(stubRoot(), { record: RECORD, graph: "fleet", onWindow: (since) => quiet.push(since) }).destroy();
  await tick();
  assert.deepEqual(quiet, []);
});
