import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { GET, loadIndex, resetIndexCache } from "../api/search.js";

const realFetch = globalThis.fetch;
let calls;
const req = (q) => new Request(`https://undercurrent.test/api/search${q === undefined ? "" : `?q=${encodeURIComponent(q)}`}`);

const TASSOS = ["NK-k837moN9ssPZedvkRUrexG", "Vessel", "9408695", "Canada, EU, UK, Switzerland, US", ["TASSOS"]];
const entities = [
  TASSOS,
  ["NK-x1", "Vessel", "1111111", "US", ["TASSOS STAR"]],
  ["NK-x2", "Company", "", "EU", ["Sovcomflot PJSC", "SCF Group"]],
];
const indexBytes = (doc = { updated_at: "2026-10-14T04:00:00Z", entities }) => gzipSync(JSON.stringify(doc));
const serve = (bytes = indexBytes()) => {
  globalThis.fetch = async () => {
    calls++;
    return new Response(bytes, { status: 200 });
  };
};

beforeEach(() => {
  calls = 0;
  resetIndexCache();
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

test("rejects empty, blank and overlong queries without fetching", async () => {
  serve();
  for (const q of [undefined, "", "   ", "x".repeat(201)]) assert.equal((await GET(req(q))).status, 400);
  assert.equal(calls, 0);
});

test("name search returns ranked results with the page's shape", async () => {
  serve();
  const res = await GET(req("TASSOS"));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "public, s-maxage=21600");
  const body = await res.json();
  assert.equal(body.enabled, true);
  assert.deepEqual(body.results[0], {
    name: "TASSOS",
    schema: "Vessel",
    datasets: ["Canada", "EU", "UK", "Switzerland", "US"],
    url: "https://www.opensanctions.org/entities/NK-k837moN9ssPZedvkRUrexG/",
  });
  assert.equal(body.results[1].name, "TASSOS STAR");
});

test("IMO query matches only that vessel; alias matches show the primary name", async () => {
  serve();
  const imo = await (await GET(req("IMO 9408695"))).json();
  assert.equal(imo.results.length, 1);
  assert.equal(imo.results[0].name, "TASSOS");
  const alias = await (await GET(req("SCF Group"))).json();
  assert.equal(alias.results[0].name, "Sovcomflot PJSC");
});

test("failed download: enabled false, not cached", async () => {
  globalThis.fetch = async () => new Response("nope", { status: 404 });
  const res = await GET(req("TASSOS"));
  assert.deepEqual(await res.json(), { enabled: false });
  assert.equal(res.headers.get("cache-control"), "no-store");
});

test("index without entities: enabled false", async () => {
  serve(indexBytes({ updated_at: "x" }));
  assert.deepEqual(await (await GET(req("TASSOS"))).json(), { enabled: false });
});

test("loads once, refreshes after 12 hours, keeps the old index when a refresh fails", async () => {
  serve();
  await GET(req("TASSOS"));
  await GET(req("TASSOS"));
  assert.equal(calls, 1);

  resetIndexCache();
  calls = 0;
  const t0 = Date.now();
  const ok = async () => {
    calls++;
    return new Response(indexBytes(), { status: 200 });
  };
  const first = await loadIndex(ok, t0);
  await loadIndex(ok, t0 + 13 * 3600 * 1000);
  assert.equal(calls, 2);
  const failing = async () => {
    calls++;
    return new Response("down", { status: 500 });
  };
  const again = await loadIndex(failing, t0 + 26 * 3600 * 1000);
  assert.equal(calls, 3);
  assert.equal(again.length, first.length);
});

test("a name in another script finds nothing", async () => {
  serve();
  assert.deepEqual(await (await GET(req("Совкомфлот"))).json(), { enabled: true, results: [] });
});
