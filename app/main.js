import { prepareQuery, searchResearch, searchLists, loadJson, LIST_IDS, latestOnly, listStatus } from "./search.js";
import { setupWalkthrough } from "./walkthrough.js";
import {
  renderResearch, renderLists, renderWider, renderEmpty, renderHint, renderLoading, renderLayerError,
  citation, formatUpdated, escapeHtml, CAVEAT,
} from "./render.js";

const $ = (selector) => document.querySelector(selector);
const state = { research: null, researchFailed: false, lists: {}, listsFailed: [], shown: new Map() };
const nextTicket = latestOnly();
let dataReady = null;

async function loadResearch() {
  try {
    const doc = await loadJson("data/research-index.json");
    if (!Array.isArray(doc.entries)) throw new Error("bad research shape");
    state.research = doc.entries;
    state.researchFailed = false;
  } catch {
    state.researchFailed = true;
  }
}

async function loadLists(ids) {
  const failed = await Promise.all(ids.map(async (id) => {
    try {
      const doc = await loadJson(`data/lists/${id}.json`);
      if (!Array.isArray(doc.records)) throw new Error("bad list shape");
      state.lists[id] = doc;
      return null;
    } catch {
      return id;
    }
  }));
  state.listsFailed = failed.filter(Boolean);
}

function loadData() {
  dataReady ??= Promise.all([loadResearch(), loadLists(LIST_IDS)]);
  return dataReady;
}

async function checkWider(text, isLatest) {
  let next;
  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(text)}`, { signal: AbortSignal.timeout(5000) });
    const body = await res.json();
    next = body.enabled === false ? { kind: "link" } : body.error ? { kind: "error" } : { kind: "results", results: body.results || [] };
  } catch {
    next = { kind: "link" };
  }
  const slot = $("#wider");
  if (isLatest() && slot) slot.innerHTML = renderWider(next, text);
}

export async function runSearch(raw) {
  const isLatest = nextTicket();
  const q = prepareQuery(raw);
  const out = $("#results");
  if (q.text.length < 2) {
    out.hidden = true;
    out.innerHTML = "";
    return;
  }
  out.hidden = false;
  if (!q.usable) {
    out.innerHTML = renderHint();
    return;
  }
  if (!state.research && !state.researchFailed) out.innerHTML = renderLoading();
  await loadData();
  if (!isLatest()) return;

  const research = state.research ? searchResearch(state.research, q) : [];
  const lists = searchLists(state.lists, q);
  state.shown = new Map(research.map((e) => [e.id, e]));
  out.innerHTML = [
    state.researchFailed ? renderLayerError("research") : renderResearch(research),
    !research.length && !lists.length && !state.researchFailed && !state.listsFailed.length ? renderEmpty(q.text) : "",
    `<div class="layers">${renderLists(lists, state.listsFailed)}<div id="wider">${renderWider({ kind: "loading" }, q.text)}</div></div>`,
    `<p class="caveat">${escapeHtml(CAVEAT)}</p>`,
  ].join("");
  checkWider(q.text, isLatest);
}

async function showListDate() {
  const slot = $("#lists-date");
  try {
    const status = listStatus(await loadJson("data/lists/meta.json"));
    if (status.stale) {
      slot.innerHTML = `<span class="live-dot" aria-hidden="true"></span><span class="is-stale">Some lists may be out of date</span>`;
      slot.title = status.details.join("\n");
    } else {
      slot.innerHTML = `<span class="live-dot" aria-hidden="true"></span>Official lists updated ${escapeHtml(formatUpdated(status.newest))}`;
    }
  } catch {
    slot.textContent = "List update time unavailable";
  }
}

async function copyCitation(button) {
  const entry = state.shown.get(button.dataset.cite);
  if (!entry) return;
  const label = button.textContent;
  try {
    await navigator.clipboard.writeText(citation(entry, location.href.split("#")[0]));
    button.textContent = "Copied";
  } catch {
    button.textContent = "Copy failed";
  }
  setTimeout(() => { button.textContent = label; }, 2000);
}

function wire() {
  const input = $("#q");
  let timer;
  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => runSearch(input.value), 200);
  });
  $("#search-form").addEventListener("submit", (event) => {
    event.preventDefault();
    clearTimeout(timer);
    runSearch(input.value);
  });
  document.querySelectorAll("[data-example]").forEach((link) => link.addEventListener("click", (event) => {
    event.preventDefault();
    input.value = link.dataset.example;
    runSearch(input.value);
  }));
  document.addEventListener("keydown", (event) => {
    if (event.key === "/" && document.activeElement !== input) {
      event.preventDefault();
      input.focus();
    }
  });
  $("#results").addEventListener("click", async (event) => {
    const cite = event.target.closest("[data-cite]");
    if (cite) return copyCitation(cite);
    const retry = event.target.closest("[data-retry]");
    if (!retry) return;
    if (retry.dataset.retry === "research") await loadResearch();
    else await loadLists(state.listsFailed.length ? state.listsFailed : LIST_IDS);
    runSearch(input.value);
  });
  showListDate();
}

wire();
setupWalkthrough({ runSearch });
