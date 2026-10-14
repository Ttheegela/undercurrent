// Searches a nightly compact OpenSanctions index (CC BY-NC 4.0) held in memory.
// Never returns an error page: on any failure the page falls back to an outbound link.
import { gunzipSync } from "node:zlib";
import { prepareQuery, scoreName, LIMIT } from "../app/search.js";
import { normalizeName } from "../app/normalize.js";

export const INDEX_URL = "https://github.com/Ttheegela/undercurrent/releases/download/data-latest/opensanctions.json.gz";
const REFRESH_MS = 12 * 60 * 60 * 1000;
const LOAD_TIMEOUT_MS = 4000;

let cached = null; // { loadedAt, entities }
let pending = null;

export function resetIndexCache() {
  cached = null;
  pending = null;
}

function json(body, { status = 200, cache = false } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": cache ? "public, s-maxage=21600" : "no-store" },
  });
}

export async function loadIndex(fetchFn = fetch, now = Date.now()) {
  if (cached && now - cached.loadedAt < REFRESH_MS) return cached.entities;
  pending ??= (async () => {
    try {
      const res = await fetchFn(INDEX_URL, { signal: AbortSignal.timeout(LOAD_TIMEOUT_MS) });
      if (!res.ok) throw new Error(`index HTTP ${res.status}`);
      const doc = JSON.parse(gunzipSync(Buffer.from(await res.arrayBuffer())).toString("utf8"));
      if (!Array.isArray(doc.entities)) throw new Error("index has no entities");
      const entities = doc.entities.map(([id, schema, imo, by, names]) => ({ id, schema, imo, by, names, keys: names.map(normalizeName) }));
      cached = { loadedAt: now, entities };
      return entities;
    } finally {
      pending = null;
    }
  })();
  try {
    return await pending;
  } catch (err) {
    if (cached) return cached.entities; // a failed refresh keeps serving the last good index
    throw err;
  }
}

export function searchIndex(entities, raw) {
  const q = prepareQuery(raw);
  if (!q.usable) return [];
  const scored = [];
  for (const e of entities) {
    const s = q.imo ? (e.imo === q.imo ? 3 : 0) : Math.max(0, ...e.keys.map((k) => scoreName(q, k)));
    if (s) scored.push({ s, e });
  }
  scored.sort((a, b) => b.s - a.s || a.e.names[0].length - b.e.names[0].length);
  return scored.slice(0, LIMIT).map(({ e }) => ({
    name: e.names[0],
    schema: e.schema,
    datasets: e.by ? e.by.split(", ") : [],
    url: `https://www.opensanctions.org/entities/${encodeURIComponent(e.id)}/`,
  }));
}

export async function GET(request) {
  const q = (new URL(request.url).searchParams.get("q") || "").trim();
  if (!q || q.length > 200) return json({ error: "bad query" }, { status: 400 });
  let entities;
  try {
    entities = await loadIndex();
  } catch {
    return json({ enabled: false });
  }
  return json({ enabled: true, results: searchIndex(entities, q) }, { cache: true });
}
