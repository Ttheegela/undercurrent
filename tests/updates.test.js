import { test } from "node:test";
import assert from "node:assert/strict";
import { renderUpdates, parseQuery, isRecord } from "../app/updates.js";

// Shaped like data/changes/changes.json: newest day first, each Change as scripts/changes.py writes it.
const FRESH = { us: "fresh", uk: "fresh", eu: "fresh", un: "fresh", lobbying: "fresh" };
const ship = (o = {}) => ({
  date: "2026-10-21", graph: "fleet", kind: "added", item: "node", id: "IMO9408695", name: "TASSOS", node_type: "ship",
  summary: "UK listed TASSOS (IMO 9408695)", source_url: "https://search-uk-sanctions-list.service.gov.uk/x", source_label: "UK Sanctions List", ...o,
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
    { date: "2026-10-21", sources: { ...FRESH, eu: "unavailable", lobbying: "unavailable" }, changes: [ship(), ship({ kind: "removed", id: "IMO9341279", name: "ADISA", summary: "EU removed ADISA (IMO 9341279)" })] },
    { date: "2026-10-20", sources: FRESH, changes: [] },
  ],
};
const ALL = { from: "2026-10-20", to: "2026-10-23", graph: "all" };
const rows = (html) => (html.match(/<li class="chg-item/g) || []).length;
const heads = (html) => [...html.matchAll(/<time datetime="([^"]+)"/g)].map((m) => m[1]);

test("renderUpdates groups by day newest first", () => {
  const html = renderUpdates(RECORD, ALL);
  assert.deepEqual(heads(html), ["2026-10-23", "2026-10-22", "2026-10-21", "2026-10-20"]);
  const day = (d) => html.slice(html.indexOf(`<time datetime="${d}"`)).split("</section>")[0];
  assert.ok(day("2026-10-22").includes("New lobbying firm: Acme Lobbying LLC") && !day("2026-10-22").includes("TASSOS"));
  assert.ok(day("2026-10-21").includes("UK listed TASSOS") && day("2026-10-21").includes("EU removed ADISA"));
  assert.match(day("2026-10-21"), /2 changes/);
  // the order of the record does not matter
  const shuffled = { ...RECORD, days: [...RECORD.days].reverse() };
  assert.deepEqual(heads(renderUpdates(shuffled, ALL)), ["2026-10-23", "2026-10-22", "2026-10-21", "2026-10-20"]);
});

test("renderUpdates keeps to the dates asked for and to the graph asked for", () => {
  assert.deepEqual(heads(renderUpdates(RECORD, { ...ALL, from: "2026-10-21", to: "2026-10-22" })), ["2026-10-22", "2026-10-21"]);
  const fleet = renderUpdates(RECORD, { ...ALL, graph: "fleet" });
  assert.equal(rows(fleet), 2);
  assert.ok(!fleet.includes("Acme Lobbying"));
  const lobby = renderUpdates(RECORD, { ...ALL, graph: "lobby" });
  assert.equal(rows(lobby), 1);
  assert.ok(!lobby.includes("TASSOS"));
  assert.equal(rows(renderUpdates(RECORD, ALL)), 3);
  assert.equal(rows(renderUpdates(RECORD, { ...ALL, graph: "nonsense" })), 3); // an unknown graph is "all"
});

test("renderUpdates shows unavailable source note", () => {
  const html = renderUpdates(RECORD, ALL);
  assert.ok(html.includes("UK list unavailable; showing the previous data."), html);
  assert.ok(html.includes("EU lists unavailable; showing the previous data."));
  assert.ok(html.includes("US lobbying filings unavailable; showing the previous data."));
  // only the sources that feed the graph being shown
  const fleet = renderUpdates(RECORD, { ...ALL, graph: "fleet" });
  assert.ok(fleet.includes("UK list unavailable") && fleet.includes("EU lists unavailable") && !fleet.includes("lobbying filings unavailable"));
  const lobby = renderUpdates(RECORD, { ...ALL, graph: "lobby" });
  assert.ok(lobby.includes("US lobbying filings unavailable") && !lobby.includes("UK list unavailable") && !lobby.includes("EU lists unavailable"));
  // the note sits in the day it belongs to
  const day = (h, d) => h.slice(h.indexOf(`<time datetime="${d}"`)).split("</section>")[0];
  assert.ok(day(html, "2026-10-23").includes("UK list unavailable") && !day(html, "2026-10-22").includes("unavailable"));
});

test("renderUpdates says what an empty day means for the graph shown", () => {
  const empty = { started: "2026-10-20", days: [{ date: "2026-10-20", sources: FRESH, changes: [] }] };
  const w = { from: "2026-10-20", to: "2026-10-20" };
  assert.ok(renderUpdates(empty, { ...w, graph: "fleet" }).includes("No changes on the lists."));
  assert.ok(renderUpdates(empty, { ...w, graph: "lobby" }).includes("No new lobbying filings."));
  assert.ok(renderUpdates(empty, { ...w, graph: "all" }).includes("No changes recorded."));
  // a day with changes only on the other graph is empty for this one
  const html = renderUpdates(RECORD, { ...ALL, graph: "lobby" });
  assert.ok(html.slice(html.indexOf('datetime="2026-10-21"')).split("</section>")[0].includes("No new lobbying filings."));
});

test("renderUpdates links each change to the graph that shows it, with focus and since", () => {
  const html = renderUpdates(RECORD, ALL);
  assert.ok(html.includes('href="../shadow-fleet/network/shadow_fleet_map.html#focus=IMO9408695&amp;since=2026-10-21"'), html);
  assert.ok(html.includes('href="../who-lobbies/influence-network/index.html#focus=co:acme-lobbying&amp;since=2026-10-22"'), html);
  assert.equal((html.match(/>Show on map</g) || []).length, 2);
  assert.equal((html.match(/>Show on network</g) || []).length, 1);
  // an id is encoded so it cannot end the fragment's pair or the attribute
  const odd = { started: "2026-10-20", days: [{ date: "2026-10-20", sources: FRESH, changes: [ship({ id: 'p:a&b=c"d #e' })] }] };
  const link = renderUpdates(odd, { ...ALL, to: "2026-10-20" }).match(/href="([^"]*shadow_fleet_map[^"]*)"/)[1];
  assert.equal(link, "../shadow-fleet/network/shadow_fleet_map.html#focus=p:a%26b%3Dc%22d%20%23e&amp;since=2026-10-20");
  // a link to an edge carries the edge's id, as the pages look it up in the record
  const edge = { started: "2026-10-20", days: [{ date: "2026-10-20", sources: FRESH, changes: [ship({ item: "edge", id: "e:0123456789ab" })] }] };
  assert.ok(renderUpdates(edge, { ...ALL, to: "2026-10-20" }).includes("#focus=e:0123456789ab&amp;since=2026-10-20"));
});

test("renderUpdates links each change's source through safeUrl", () => {
  const html = renderUpdates(RECORD, ALL);
  assert.ok(html.includes('href="https://search-uk-sanctions-list.service.gov.uk/x" target="_blank" rel="noopener noreferrer">UK Sanctions List</a>'));
  const bad = { started: "2026-10-20", days: [{ date: "2026-10-20", sources: FRESH, changes: [ship({ source_url: "javascript:alert(1)" })] }] };
  const out = renderUpdates(bad, { ...ALL, to: "2026-10-20" });
  assert.ok(!out.includes("javascript:") && !out.includes('href="#"'), out);
  assert.ok(out.includes("UK Sanctions List")); // the label stays, as text
});

test("renderUpdates escapes names and uses safeUrl", () => {
  const evil = "<img src=x onerror=alert(1)>";
  const hostile = {
    started: "2026-10-20",
    days: [
      { date: "2026-10-20", sources: FRESH, changes: [ship({ name: evil, summary: `${evil} "listed" & 'more'`, source_label: evil, source_url: "https://example.org/?a=1&b=<2>", id: evil, kind: evil })] },
      { date: evil, sources: FRESH, changes: [ship()] }, // a day that is not a date is not shown
    ],
  };
  const html = renderUpdates(hostile, { ...ALL, to: "2026-10-20" });
  assert.ok(!html.includes("<img"), html);
  assert.ok(html.includes("&lt;img src=x onerror=alert(1)&gt; &quot;listed&quot; &amp; &#39;more&#39;"), html);
  assert.ok(html.includes('href="https://example.org/?a=1&amp;b=&lt;2&gt;"'), html);
  assert.ok(!/href="[^"]*<img/.test(html));
  assert.deepEqual(heads(html), ["2026-10-20"]);
  assert.match(html, /data-kind="changed"/); // an unknown kind reads as a change
});

test("renderUpdates shows when daily updates started, only when the window reaches before it", () => {
  assert.ok(renderUpdates(RECORD, { ...ALL, from: "2026-10-10" }).includes("Daily updates started on 20 Oct 2026."));
  assert.ok(!renderUpdates(RECORD, { ...ALL, from: "2026-10-20" }).includes("Daily updates started"));
  assert.ok(!renderUpdates(RECORD, { ...ALL, from: "2026-10-21" }).includes("Daily updates started"));
  // the note comes before the first day
  const html = renderUpdates(RECORD, { ...ALL, from: "2026-10-10" });
  assert.ok(html.indexOf("Daily updates started") < html.indexOf("<time"));
});

test("renderUpdates caps a busy day and keeps the rest one click away", () => {
  const many = Array.from({ length: 2000 }, (_, i) => ship({ id: `IMO${1000000 + i}`, name: `SHIP ${i}`, summary: `US listed SHIP ${i}` }));
  const busy = { started: "2026-10-20", days: [{ date: "2026-10-20", sources: FRESH, changes: many }] };
  const html = renderUpdates(busy, { ...ALL, to: "2026-10-20" });
  assert.ok(html.includes("+1950 more on this day"), html.slice(0, 300));
  assert.match(html, /2000 changes/);
  assert.equal(rows(html), 2000); // all are there, behind <details>
  const [shown] = html.split("<details");
  assert.equal(rows(shown), 50);
  assert.ok(html.includes("<summary>+1950 more on this day</summary>"));
  // a day at the cap has no "more" line
  const fifty = { started: "2026-10-20", days: [{ date: "2026-10-20", sources: FRESH, changes: many.slice(0, 50) }] };
  assert.ok(!renderUpdates(fifty, { ...ALL, to: "2026-10-20" }).includes("more on this day"));
});

test("renderUpdates says plainly when no day was recorded in the range", () => {
  const html = renderUpdates(RECORD, { ...ALL, from: "2026-01-01", to: "2026-01-05" });
  assert.ok(html.includes("No daily updates were recorded from 1 Jan 2026 to 5 Jan 2026."), html);
  assert.ok(!html.includes("No changes"));
  assert.ok(renderUpdates({ started: "2026-10-20", days: [] }, ALL).includes("No daily updates were recorded"));
  assert.ok(renderUpdates(null, ALL).includes("No daily updates were recorded"));
});

test("isRecord accepts only the record's shape", () => {
  assert.equal(isRecord(RECORD), true);
  assert.equal(isRecord({ started: "2026-10-20", days: [] }), true);
  for (const bad of [null, undefined, 7, "x", [], {}, { days: {} }, { days: [null] }, { days: [{ changes: "x" }] }, { days: [{ date: "2026-10-20", changes: [7] }] }]) {
    assert.equal(isRecord(bad), false, JSON.stringify(bad));
  }
});

test("parseQuery validates the dates and the graph and falls back to the last 10 days", () => {
  const TODAY = "2026-10-20";
  assert.deepEqual(parseQuery("", TODAY), { from: "2026-10-11", to: "2026-10-20", graph: "all" });
  assert.deepEqual(parseQuery("?from=2026-10-01&to=2026-10-05&graph=lobby", TODAY), { from: "2026-10-01", to: "2026-10-05", graph: "lobby" });
  assert.deepEqual(parseQuery("?graph=fleet", TODAY), { from: "2026-10-11", to: "2026-10-20", graph: "fleet" });
  // invalid values, one by one
  for (const q of ["?from=2026-02-30", "?from=26-10-01", "?from=2026-10-1", "?from=<script>", "?from=", "?from=2026-13-01", "?from=2026-10-01T00:00"]) {
    assert.equal(parseQuery(q, TODAY).from, "2026-10-11", q);
  }
  assert.equal(parseQuery("?to=nope", TODAY).to, "2026-10-20");
  for (const q of ["?graph=evil", "?graph=", "?graph=ALL", "?graph=__proto__", "?graph=toString"]) assert.equal(parseQuery(q, TODAY).graph, "all", q);
  // the default start follows a given end
  assert.deepEqual(parseQuery("?to=2026-09-30", TODAY), { from: "2026-09-21", to: "2026-09-30", graph: "all" });
  // a reversed range is put the right way round
  assert.deepEqual(parseQuery("?from=2026-10-19&to=2026-10-10", TODAY), { from: "2026-10-10", to: "2026-10-19", graph: "all" });
  // the first of a repeated parameter wins; unrelated parameters are ignored
  assert.equal(parseQuery("?graph=lobby&graph=fleet&x=1", TODAY).graph, "lobby");
});
