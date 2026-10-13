import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { GET } from "../api/search.js";

const realFetch = globalThis.fetch;
let calls;
const req = (q) => new Request(`https://undercurrent.test/api/search${q === undefined ? "" : `?q=${encodeURIComponent(q)}`}`);

beforeEach(() => {
  calls = [];
  process.env.OPENSANCTIONS_API_KEY = "test-key";
});
afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.OPENSANCTIONS_API_KEY;
});

test("rejects empty and overlong queries without calling upstream", async () => {
  globalThis.fetch = async () => { throw new Error("should not be called"); };
  for (const q of [undefined, "", "   ", "x".repeat(201)]) assert.equal((await GET(req(q))).status, 400);
});

test("no key: enabled false", async () => {
  delete process.env.OPENSANCTIONS_API_KEY;
  const res = await GET(req("TASSOS"));
  assert.deepEqual(await res.json(), { enabled: false });
});

test("forwards only q and limit with the key, trims results, caches", async () => {
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ results: [{ id: "abc", caption: "TASSOS", schema: "Vessel", datasets: ["us_ofac_sdn"], properties: { secret: 1 } }] }));
  };
  const res = await GET(new Request("https://undercurrent.test/api/search?q=TASSOS&evil=1"));
  assert.equal(res.headers.get("cache-control"), "public, s-maxage=86400");
  assert.deepEqual(await res.json(), { enabled: true, results: [{ name: "TASSOS", schema: "Vessel", datasets: ["us_ofac_sdn"], url: "https://www.opensanctions.org/entities/abc/" }] });
  const sent = new URL(calls[0].url);
  assert.deepEqual([...sent.searchParams.keys()].sort(), ["limit", "q"]);
  assert.equal(calls[0].init.headers.Authorization, "ApiKey test-key");
});

test("upstream error or timeout: enabled true, error true, not cached", async () => {
  globalThis.fetch = async () => new Response("down", { status: 503 });
  let res = await GET(req("TASSOS"));
  assert.deepEqual(await res.json(), { enabled: true, error: true });
  assert.equal(res.headers.get("cache-control"), "no-store");
  globalThis.fetch = async () => { throw new DOMException("timeout", "TimeoutError"); };
  res = await GET(req("TASSOS"));
  assert.deepEqual(await res.json(), { enabled: true, error: true });
});
