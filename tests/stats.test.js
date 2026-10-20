import { test } from "node:test";
import assert from "node:assert/strict";
import { fillStats, loadAndFill } from "../app/stats.js";

// A page is anything with querySelectorAll; an element is { dataset.stat, textContent } (the text is the fallback).
const el = (stat, text = "fallback") => ({ dataset: { stat }, textContent: text });
const page = (...els) => ({ querySelectorAll: (selector) => (selector === "[data-stat]" ? els : []) });
// Shaped like data/site-stats.json.
const STATS = { generated: "2026-10-20", fleet: { ships: 1747 }, kg: { nodes: 3183, filings_kept: 1499 }, opensanctions_sources: 95 };

test("fillStats fills known paths and leaves unknown", () => {
  const known = el("kg.filings_kept");
  const unknown = el("kg.nope", "1,513");
  const wrongShape = el("kg", "keep me");
  const nested = el("fleet.ships.deeper", "keep me too");
  assert.equal(fillStats(page(known, unknown, wrongShape, nested), STATS), 1);
  assert.equal(known.textContent, "1,499");
  assert.deepEqual([unknown.textContent, wrongShape.textContent, nested.textContent], ["1,513", "keep me", "keep me too"]);
});

test("fillStats formats 3183 as 3,183", () => {
  const nodes = el("kg.nodes");
  const sources = el("opensanctions_sources");
  assert.equal(fillStats(page(nodes, sources), STATS), 2);
  assert.equal(nodes.textContent, "3,183");
  assert.equal(sources.textContent, "95");
});

test("fillStats writes the build date as it is, and never reads inherited keys", () => {
  const date = el("generated");
  const inherited = el("constructor", "keep");
  const proto = el("__proto__.toString", "keep");
  assert.equal(fillStats(page(date, inherited, proto), STATS), 1);
  assert.equal(date.textContent, "2026-10-20");
  assert.deepEqual([inherited.textContent, proto.textContent], ["keep", "keep"]);
});

test("fillStats does nothing without usable stats", () => {
  for (const stats of [undefined, null, "text", 5, []]) {
    const e = el("kg.nodes", "3,235");
    assert.equal(fillStats(page(e), stats), 0);
    assert.equal(e.textContent, "3,235");
  }
});

test("fillStats ignores a value that is not a number or a string", () => {
  const e = el("kg.nodes", "3,235");
  assert.equal(fillStats(page(e), { kg: { nodes: NaN } }), 0);
  assert.equal(fillStats(page(e), { kg: { nodes: null } }), 0);
  assert.equal(fillStats(page(e), { kg: { nodes: { x: 1 } } }), 0);
  assert.equal(e.textContent, "3,235");
});

test("loadAndFill retries after a failed fetch, then fetches once", async () => {
  const real = globalThis.fetch;
  const replies = [async () => { throw new TypeError("offline"); }, async () => ({ ok: false }),
    async () => ({ ok: true, json: async () => { throw new SyntaxError("not json"); } }), async () => ({ ok: true, json: async () => STATS })];
  let calls = 0;
  globalThis.fetch = (url) => { assert.equal(url, "/data/site-stats.json"); return replies[calls++](); };
  try {
    for (let i = 0; i < 3; i++) {
      const e = el("kg.nodes", "3,235");
      assert.equal(await loadAndFill(page(e)), 0);   // each failure changes nothing...
      assert.equal(e.textContent, "3,235");
    }
    assert.equal(calls, 3);                          // ...and the next call asks again
    const filled = el("kg.nodes", "3,235");
    assert.equal(await loadAndFill(page(filled)), 1);
    assert.equal(filled.textContent, "3,183");
    const later = el("fleet.ships", "1,747");
    assert.equal(await loadAndFill(page(later)), 1);   // a later call (the Wider check note) reuses what was fetched
    assert.equal(later.textContent, "1,747");
    assert.equal(calls, 4);
  } finally {
    globalThis.fetch = real;
  }
});
