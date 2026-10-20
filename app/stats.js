// The counts a page states that the nightly build changes. An element marked data-stat="kg.nodes" (a dotted path into
// data/site-stats.json) is filled with that figure; the text written in the HTML is only a fallback for when the file
// cannot be read, so it may be a few nights old. Loaded by the pages that carry such elements, as a module script.
const STATS_URL = "/data/site-stats.json";

// Own properties only: a path such as "constructor" or "__proto__.x" finds nothing.
function lookup(stats, path) {
  let value = stats;
  for (const key of path.split(".")) {
    if (value === null || typeof value !== "object" || !Object.hasOwn(value, key)) return undefined;
    value = value[key];
  }
  return value;
}

/** Fills each [data-stat] under root from stats and returns how many it filled. Numbers read "3,183"; the build date
 *  (a string) is written as it is. Anything else, or an unknown path, keeps the element's fallback text. */
export function fillStats(root = document, stats) {
  let filled = 0;
  for (const el of root.querySelectorAll("[data-stat]")) {
    const value = lookup(stats, el.dataset.stat);
    if (typeof value === "number" && Number.isFinite(value)) el.textContent = value.toLocaleString("en-GB");
    else if (typeof value === "string") el.textContent = value;
    else continue;
    filled++;
  }
  return filled;
}

let loading;

/** Fetches the stats once (a failure is remembered, and changes nothing) and fills everything under root. */
export function loadAndFill(root = document) {
  loading ??= fetch(STATS_URL).then((res) => (res.ok ? res.json() : null)).catch(() => null);
  return loading.then((stats) => (stats ? fillStats(root, stats) : 0));
}

if (typeof document !== "undefined") loadAndFill();
