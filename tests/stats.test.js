import { test } from "node:test";
import assert from "node:assert/strict";
import { fillStats } from "../app/stats.js";

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
