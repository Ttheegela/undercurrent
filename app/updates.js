// The Updates page: what each night's rebuild added, removed or changed, newest day first, from data/changes/changes.json.
// renderUpdates is a pure function from the record and the filters to escaped HTML; mountUpdates (run when the page has
// #upd-results) loads the record, keeps the filters in the URL (?from=&to=&graph=) and draws.
// Every date is a UTC YYYY-MM-DD string.
import { escapeHtml, formatDate } from "./render.js";
import { changesSince, sourceGaps, sourceLink, SOURCES, KINDS, isDate, addDays } from "./changes.js";

const GRAPHS = { all: ["fleet", "lobby"], fleet: ["fleet"], lobby: ["lobby"] };
const EMPTY = { fleet: "No changes on the lists.", lobby: "No new lobbying filings.", all: "No changes recorded." };
// The page that draws each graph's changes, from stories/updates/.
const SHOW = {
  fleet: ["Show on map", "../shadow-fleet/network/shadow_fleet_map.html", "the map"],
  lobby: ["Show on network", "../who-lobbies/influence-network/index.html", "the network"],
};
const DAY_CAP = 50; // rows shown for a day before "+N more on this day"; a busy day can hold thousands
const DEFAULT_DAYS = 10;
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const obj = (x) => !!x && typeof x === "object";

/** Is this the shape of changes.json (a list of days, each with a list of changes)? */
export const isRecord = (r) => obj(r) && Array.isArray(r.days) && r.days.every((d) => obj(d) && Array.isArray(d.changes) && d.changes.every(obj));

/** ?from=&to=&graph= as { from, to, graph }; anything invalid falls back to the last 10 days ending `today`, all graphs. */
export function parseQuery(search, today) {
  const q = new URLSearchParams(search);
  const date = (key, fallback) => (isDate(q.get(key)) ? q.get(key) : fallback);
  const graph = Object.hasOwn(GRAPHS, q.get("graph")) ? q.get("graph") : "all";
  const to = date("to", today);
  const from = date("from", addDays(to, 1 - DEFAULT_DAYS));
  return from > to ? { from: to, to: from, graph } : { from, to, graph }; // a reversed range is put the right way round
}

// A link carries the change's id and the day it was recorded: the graph page opens its window on that day.
function row(c, day) {
  const kind = Object.hasOwn(KINDS, c.kind) ? c.kind : "changed";
  const [label, page, where] = SHOW[c.graph];
  const what = ["Show", c.name || c.summary, `on ${where}`].filter(Boolean).join(" "); // (the link's name says which item)
  const id = c.id ? `focus=${encodeURIComponent(c.id).replace(/%3A/gi, ":")}&` : "";
  return `<li class="chg-item upd-item" data-kind="${kind}"><span class="chg-kind">${KINDS[kind]}</span><span class="chg-sum">${escapeHtml(c.summary)}</span>`
    + `<span class="upd-links">${sourceLink(c)}<a class="upd-show" href="${escapeHtml(`${page}#${id}since=${day}`)}" aria-label="${escapeHtml(what)}">${label}</a></span></li>`;
}

function renderDay(day, changes, gaps, graph, relevant) {
  const date = escapeHtml(day);
  const rows = changes.map((c) => row(c, day));
  const list = (items) => `<ul class="chg-list">${items.join("")}</ul>`;
  const rest = rows.length - DAY_CAP;
  const blind = gaps.length >= relevant; // every source for this graph was down: what is missing is not "no changes"
  return `<section class="upd-day" aria-labelledby="upd-${date}"><h2 id="upd-${date}"><time datetime="${date}">${escapeHtml(formatDate(day, true))}</time>`
    + `${rows.length ? `<span class="upd-count">${plural(rows.length, "change")}</span>` : ""}</h2>`
    + gaps.map((source) => `<p class="upd-note">${escapeHtml(SOURCES[source][0])} unavailable; showing the previous data.</p>`).join("")
    + (rows.length ? list(rows.slice(0, DAY_CAP)) : blind ? "" : `<p class="upd-empty">${EMPTY[graph]}</p>`)
    + (rest > 0 ? `<details class="upd-more"><summary>+${rest} more on this day</summary>${list(rows.slice(DAY_CAP))}</details>` : "")
    + "</section>";
}

/**
 * The record's days from `from` to `to` (both included), newest first. A day lists its changes to the graph asked for
 * (graph: "all", "fleet" or "lobby") with a link to show each on the page that draws it, a note for every source that
 * was down that night and, with nothing to list, what that means for the graph. Before the first recorded day the page
 * says when daily updates started.
 */
export function renderUpdates(record, { from, to, graph } = {}) {
  const key = Object.hasOwn(GRAPHS, graph) ? graph : "all";
  const graphs = GRAPHS[key];
  const relevant = Object.keys(SOURCES).filter((s) => graphs.includes(SOURCES[s][2])).length; // the sources that feed this graph
  const days = (record?.days ?? []).filter((d) => isDate(d.date) && d.date >= from && d.date <= to).sort((a, b) => (a.date < b.date ? 1 : -1));
  const changes = Object.fromEntries(days.map((d) => [d.date, changesSince(record, graphs, d.date, d.date)])), gaps = {}; // (a day's own changes)
  for (const g of sourceGaps(record, graphs, from, to)) (gaps[g.date] ??= []).push(g.source);

  // `started` is the oldest day held, which moves on once old days are trimmed; `first_run` is the baseline's day (a record from before it has none)
  const started = isDate(record?.started) ? record.started : "";
  const first = isDate(record?.first_run) && record.first_run < started ? record.first_run : started;
  const note = started > from
    ? `<p class="upd-note">Daily updates started on ${escapeHtml(formatDate(first))}.${started > first ? " Older days are no longer kept; the record holds 120 days." : ""}</p>` : "";
  if (!days.length) return `${note}<p class="upd-empty">No daily updates were recorded from ${escapeHtml(formatDate(from))} to ${escapeHtml(formatDate(to))}.</p>`;
  const shown = days.reduce((n, d) => n + changes[d.date].length, 0);
  return `${note}<p class="upd-total">${plural(shown, "change")} over ${plural(days.length, "day")}</p>`
    + days.map((d) => renderDay(d.date, changes[d.date], gaps[d.date] ?? [], key, relevant)).join("");
}

// ---- the page --------------------------------------------------------------------------------------

async function loadRecord() {
  const res = await fetch("../../data/changes/changes.json");
  if (!res.ok) throw new Error(`changes.json ${res.status}`);
  const record = await res.json();
  if (!isRecord(record)) throw new Error("changes.json has the wrong shape");
  return record;
}

export function mountUpdates() {
  const $ = (id) => document.getElementById(id);
  const form = $("upd-filter"), results = $("upd-results"), status = $("upd-status");
  let record = null, latest = "";

  function draw(fixInputs) {
    const q = parseQuery(location.search, latest);
    for (const name of ["from", "to", "graph"]) if (fixInputs || !form.elements[name].value) form.elements[name].value = q[name]; // (never rewrite what is being typed)
    results.innerHTML = renderUpdates(record, q);
    status.textContent = results.querySelector(".upd-total, .upd-empty")?.textContent ?? ""; // (the count, or that the range holds no day)
  }

  async function load(retry) {
    results.innerHTML = '<p class="upd-wait">Loading updates…</p>';
    try {
      record = await loadRecord();
    } catch {
      results.innerHTML = '<p class="upd-fail" role="alert">Updates unavailable right now.</p><button type="button" class="btn" data-retry>Retry</button>';
      if (retry) results.querySelector("[data-retry]").focus();
      return;
    }
    latest = record.days.reduce((m, d) => (isDate(d.date) && d.date > m ? d.date : m), "") || new Date().toISOString().slice(0, 10); // (today when nothing is recorded)
    form.elements.from.min = form.elements.to.min = isDate(record.started) ? record.started : "";
    form.elements.from.max = form.elements.to.max = latest;
    form.hidden = false;
    draw(true);
    if (retry) results.focus();
  }

  form.addEventListener("submit", (e) => e.preventDefault());
  form.addEventListener("change", () => {
    const f = form.elements;
    history.replaceState(null, "", `?${new URLSearchParams({ from: f.from.value, to: f.to.value, graph: f.graph.value })}`);
    draw(false);
  });
  results.addEventListener("click", (e) => { if (e.target.closest("[data-retry]")) load(true); });
  load(false);
}

if (typeof document !== "undefined" && document.getElementById("upd-results")) mountUpdates();
