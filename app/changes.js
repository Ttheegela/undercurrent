// "Show changes since": the shared front end for data/changes/changes.json (written nightly by scripts/changes.py).
// The record is { started, days: [{ date, sources: { us|uk|eu|un|lobbying: "fresh"|"unavailable" }, changes: [Change] }] },
// newest day first. The two graph pages mount the panel (mountChangesPanel); the Updates page reuses renderChangeList.
// Every date is a UTC YYYY-MM-DD string. Arithmetic goes through Date.UTC and toISOString, never local-time Date methods.
import { escapeHtml, safeUrl, formatDate } from "./render.js";

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const KEYS = new Set(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown", "Escape", "Enter", " "]);
const DAY_MS = 864e5;
const pad = (n) => String(n).padStart(2, "0");
const utc = (s) => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d); };
const toISO = (ms) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (s, n) => toISO(utc(s) + n * DAY_MS);
const weekday = (s) => (new Date(utc(s)).getUTCDay() + 6) % 7; // 0 = Monday: weeks run Monday to Sunday
const dMon = (s) => formatDate(s).slice(0, -5); // "23 Oct"
export const isDate = (s) => typeof s === "string" && ISO.test(s) && toISO(utc(s)) === s; // a day that exists: not 2026-11-31

/** The same day of the month n months on, or the month's last day when it is shorter. */
function shiftMonth(s, n) {
  const [y, m, d] = s.split("-").map(Number);
  const t = y * 12 + m - 1 + n, ny = Math.floor(t / 12), nm = (t % 12) + 1;
  return `${ny}-${pad(nm)}-${pad(Math.min(d, new Date(Date.UTC(ny, nm, 0)).getUTCDate()))}`;
}

const PRESETS = { yesterday: ["Yesterday", 1], "7d": ["7 days", 7], "10d": ["10 days", 10] };
// The five sources a night's build can find unavailable: how a note names each, and the graph it feeds (the lists feed
// the fleet layer, which the network shows too under "fleet"; lobbying feeds only the lobby layer).
export const SOURCES = {
  uk: ["UK list", "was", "fleet"], us: ["US lists", "were", "fleet"], eu: ["EU lists", "were", "fleet"], un: ["UN list", "was", "fleet"],
  lobbying: ["US lobbying filings", "were", "lobby"],
};
export const KINDS = { added: "New", removed: "Removed", changed: "Changed" };

export function presetSince(preset, todayISO) {
  if (!Object.hasOwn(PRESETS, preset)) throw new Error(`unknown preset: ${preset}`);
  return addDays(todayISO, -PRESETS[preset][1]);
}

/** The record's days from `sinceISO` (clamped up to `started`) to `todayISO`, both included, newest first. */
function windowDays(record, sinceISO, todayISO) {
  const from = record?.started > sinceISO ? record.started : sinceISO;
  return (record?.days ?? []).filter((d) => d.date >= from && d.date <= todayISO).sort((a, b) => (a.date < b.date ? 1 : -1));
}

const inGraph = (graph) => { const wanted = [].concat(graph); return (c) => wanted.includes(c.graph); }; // one graph or an array

/** Changes to `graph` (a name or an array of names) from `sinceISO` to `todayISO`, newest day first. */
export function changesSince(record, graph, sinceISO, todayISO) {
  const keep = inGraph(graph);
  return windowDays(record, sinceISO, todayISO).flatMap((d) => d.changes.filter(keep));
}

export function daysWithChanges(record, graph) {
  const keep = inGraph(graph);
  return new Set((record?.days ?? []).filter((d) => d.changes.some(keep)).map((d) => d.date));
}

/**
 * The sources feeding `graph` (a name or an array) that a night's build could not read inside the window: a change from
 * one of them is missing, not absent. "fleet" is the lists (us, uk, eu, un), "lobby" is lobbying.
 */
export function sourceGaps(record, graph, sinceISO, todayISO) {
  const graphs = [].concat(graph);
  return windowDays(record, sinceISO, todayISO).flatMap((d) =>
    Object.keys(SOURCES).filter((s) => graphs.includes(SOURCES[s][2]) && d.sources?.[s] === "unavailable").map((source) => ({ source, date: d.date })));
}

export function gapText({ source, date }) {
  const [name, verb] = SOURCES[source];
  return `${name} ${verb} unavailable on ${dMon(date)}, so changes from it that day aren't recorded.`;
}

/** A change's source as a link (only to http(s)), or as plain text when its url is missing or unsafe; "" with no label either. */
export function sourceLink(c) {
  const href = c.source_url && safeUrl(c.source_url); // "#" is what safeUrl answers for a url it rejects: no link then
  return href && href !== "#"
    ? `<a class="chg-src" href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${escapeHtml(c.source_label || "Source")}</a>`
    : c.source_label ? `<span class="chg-src">${escapeHtml(c.source_label)}</span>` : "";
}

function changeItem(c, i) {
  const kind = Object.hasOwn(KINDS, c.kind) ? c.kind : "changed";
  // data-i is the change's index in the list given, for a click handler to look it up
  return `<li class="chg-item" data-kind="${kind}"><button type="button" class="chg-pick" data-i="${i}"><span class="chg-kind">${KINDS[kind]}</span><span class="chg-sum">${escapeHtml(c.summary)}</span><span class="chg-date">${escapeHtml(dMon(c.date))}</span></button>${sourceLink(c)}</li>`;
}

/** The changes as an escaped list: the first `limit`, then a line saying how many more the Updates page holds. */
export function renderChangeList(changes, { limit = 50, updatesHref } = {}) {
  if (!changes.length) return "";
  const rest = changes.length - Math.min(limit, changes.length);
  const text = `+${rest} more · see all on the Updates page`;
  const more = rest > 0 ? `<p class="chg-more">${updatesHref ? `<a class="chg-all" href="${escapeHtml(safeUrl(updatesHref))}">${text}</a>` : text}</p>` : "";
  return `<ul class="chg-list">${changes.slice(0, limit).map(changeItem).join("")}</ul>${more}`;
}

const EMPTY = '<div role="gridcell"></div>';
const DOW = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/**
 * One month as a grid of day buttons, Monday first. Days before `min` and after `max` are disabled, a day in `marked`
 * (a Set) gets a dot, `since` is the pressed day, and `cursor` is the one tab stop.
 */
export function renderCalendar(viewISO, { min, max, since, cursor, marked }) {
  const [y, m] = viewISO.split("-").map(Number), ym = `${y}-${pad(m)}`;
  const cells = Array(weekday(`${ym}-01`)).fill(EMPTY);
  for (let d = 1, last = new Date(Date.UTC(y, m, 0)).getUTCDate(); d <= last; d++) {
    const date = `${ym}-${pad(d)}`, on = date === since, dot = marked.has(date);
    cells.push(`<div role="gridcell" aria-selected="${on}"><button type="button" class="chg-day" data-date="${date}" tabindex="${date === cursor ? 0 : -1}" aria-pressed="${on}" aria-label="${formatDate(date, true)}${dot ? ", has changes" : ""}"${date < min || date > max ? " disabled" : ""}>${d}${dot ? '<i class="chg-dot" aria-hidden="true"></i>' : ""}</button></div>`);
  }
  while (cells.length % 7) cells.push(EMPTY);
  const rows = [];
  for (let i = 0; i < cells.length; i += 7) rows.push(`<div role="row">${cells.slice(i, i + 7).join("")}</div>`);
  const head = DOW.map((n) => `<span role="columnheader" class="chg-dow" aria-label="${n}">${n.slice(0, 2)}</span>`).join("");
  return `<div role="grid" aria-label="${formatDate(ym, true)}"><div role="row">${head}</div>${rows.join("")}</div>`;
}

/** Where an arrow key, Home or End takes the focus from `date`, kept inside min..max; null for any other key. */
export function moveDay(date, key, min, max) {
  const dow = weekday(date);
  const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7, Home: -dow, End: 6 - dow }[key];
  if (typeof step !== "number") return null;
  const to = addDays(date, step);
  return to < min ? min : to > max ? max : to;
}

let uid = 0;

/**
 * Mounts the panel in `root`: preset buttons, a "Pick a day" calendar, a heading, the change list and notes on sources
 * that were down. "Today" is the latest day in the record, or `today` when there is no record.
 * It starts on the 7 days preset. onWindow(sinceISO, changes) is called in a microtask after this call returns (so it can
 * use the returned handle), then each time the window changes; onSelect(change) runs when a row is clicked or Enter is
 * pressed on it. `graph` is one graph name or an array.
 */
export function mountChangesPanel(root, { record, graph, today, limit = 50, updatesHref, onWindow, onSelect } = {}) {
  const id = `chg-${++uid}`;
  const todayISO = (record?.days ?? []).reduce((m, d) => (d.date > m ? d.date : m), "") || today || toISO(Date.now());
  const min = record?.started || todayISO; // the first day with a record; earlier days are disabled
  const marked = daysWithChanges(record, graph);
  const clamp = (d) => (d < min ? min : d > todayISO ? todayISO : d);
  let since, preset, cursor, open = false, destroyed = false, pending = false, changes = [];

  root.classList.add("chg");
  root.innerHTML = `
    <p class="label" id="${id}-label">Show changes since</p>
    <div class="chg-presets" role="group" aria-labelledby="${id}-label">
      ${Object.entries(PRESETS).map(([key, [label]]) => `<button type="button" class="btn chg-btn" data-preset="${key}" aria-pressed="false">${label}</button>`).join("")}
      <button type="button" class="btn chg-btn" data-pick aria-expanded="false" aria-controls="${id}-cal">Pick a day</button>
    </div>
    <div class="chg-cal" id="${id}-cal" hidden>
      <div class="chg-cal-head">
        <button type="button" class="btn btn-ghost chg-nav" data-nav="-1" aria-label="Previous month">‹</button>
        <span class="chg-month" aria-live="polite"></span>
        <button type="button" class="btn btn-ghost chg-nav" data-nav="1" aria-label="Next month">›</button>
      </div>
      <div class="chg-grid"></div>
    </div>
    <h3 class="chg-title" aria-live="polite"></h3>
    <div class="chg-body"></div>
    <ul class="chg-notes"></ul>`;
  const $ = (sel) => root.querySelector(sel);
  const [cal, month, grid, title, body, notes, toggle, prev, next] =
    [".chg-cal", ".chg-month", ".chg-grid", ".chg-title", ".chg-body", ".chg-notes", "[data-pick]", '[data-nav="-1"]', '[data-nav="1"]'].map($);

  function paintCalendar() {
    cal.hidden = !open;
    toggle.setAttribute("aria-expanded", String(open));
    toggle.classList.toggle("is-on", !preset);
    if (!open) return;
    const ym = cursor.slice(0, 7); // the month shown is the cursor's
    const label = formatDate(ym, true);
    if (month.textContent !== label) month.textContent = label; // a live region: written only when the month changes
    prev.disabled = ym <= min.slice(0, 7);
    next.disabled = ym >= todayISO.slice(0, 7);
    grid.innerHTML = renderCalendar(`${ym}-01`, { min, max: todayISO, since, cursor, marked });
  }

  function setWindow(date, name = null, defer = false) {
    since = clamp(date);
    preset = name;
    cursor = since;
    changes = changesSince(record, graph, since, todayISO);
    const n = changes.length;
    title.textContent = `Since ${dMon(since)} · ${n} change${n === 1 ? "" : "s"}`;
    body.innerHTML = n ? renderChangeList(changes, { limit, updatesHref }) : `<p class="chg-empty">No changes since ${escapeHtml(formatDate(since))}.</p>`;
    const lines = sourceGaps(record, graph, since, todayISO).map(gapText);
    if (record?.started && preset && presetSince(preset, todayISO) < min) lines.unshift(`Changes are recorded from ${formatDate(min)}.`);
    notes.innerHTML = lines.map((t) => `<li>${escapeHtml(t)}</li>`).join("");
    root.querySelectorAll("[data-preset]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.preset === preset)));
    paintCalendar();
    const notify = () => { if (!destroyed) onWindow?.(since, changes); };
    pending = defer;
    if (!defer) notify();
    else queueMicrotask(() => { if (pending) { pending = false; notify(); } }); // a window set before it runs takes its place
  }

  const focusCursor = () => grid.querySelector('[tabindex="0"]')?.focus();

  function onClick(e) {
    const b = e.target.closest("button");
    if (!b || !root.contains(b)) return;
    if (b.dataset.preset) setWindow(presetSince(b.dataset.preset, todayISO), b.dataset.preset);
    else if (b.hasAttribute("data-pick")) { open = !open; cursor = since; paintCalendar(); }
    else if (b.dataset.nav) { cursor = clamp(shiftMonth(cursor, Number(b.dataset.nav))); paintCalendar(); if (b.disabled) focusCursor(); }
    else if (b.dataset.date) { open = false; setWindow(b.dataset.date); toggle.focus(); }
    else if (b.dataset.i) onSelect?.(changes[Number(b.dataset.i)]);
  }

  function onKey(e) {
    if (KEYS.has(e.key)) e.stopPropagation(); // from any control here: the host page steps its story and clears focus on these keys
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === "Escape" && open) { open = false; paintCalendar(); toggle.focus(); return; }
    const day = e.target.closest(".chg-day");
    const to = day && moveDay(day.dataset.date, e.key, min, todayISO);
    if (!to) return;
    e.preventDefault();
    cursor = to;
    paintCalendar();
    focusCursor();
  }

  root.addEventListener("click", onClick);
  root.addEventListener("keydown", onKey);
  setWindow(presetSince("7d", todayISO), "7d", true);

  return {
    setSince(date) {
      if (isDate(date)) setWindow(date, Object.keys(PRESETS).find((p) => presetSince(p, todayISO) === date) ?? null);
    },
    destroy() {
      destroyed = true;
      pending = false;
      root.removeEventListener("click", onClick);
      root.removeEventListener("keydown", onKey);
      root.classList.remove("chg");
      root.textContent = "";
    },
  };
}
