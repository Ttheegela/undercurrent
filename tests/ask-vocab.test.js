// The closed vocabulary: the topic words Ask may print, from the committed data only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { VOCAB, topicOf } from "../api/_ask_vocab.js";

const read = (rel) => JSON.parse(readFileSync(rel, "utf8"));

test("topicOf maps labels and aliases and rejects free text", () => {
  assert.deepEqual(topicOf("iran"), { kind: "programme", key: "Iran", label: "Iran" });
  assert.deepEqual(topicOf("Iranian"), topicOf("iran"));
  assert.equal(topicOf("Russia")?.label, "Russia");
  assert.equal(topicOf("  north   KOREAN ")?.label, "North Korea");
  for (const free of ["Iran Air", "hello", "Iranian oil", "", "Ira", null, undefined, 42]) assert.equal(topicOf(free), null, String(free));
});

test("the vocabulary holds every list programme, the map's countries and the groups, each with a printable label", () => {
  const labels = (kind) => new Set(VOCAB.topics.filter((t) => t.kind === kind).map((t) => t.label));
  // every part of every programme string on the four lists, the 184 compound US strings among them
  const us = new Set(read("data/lists/us.json").records.map((r) => r[2]));
  assert.equal(us.size, 184);
  const programmes = labels("programme");
  for (const id of ["us", "uk", "eu", "un"]) for (const r of read(`data/lists/${id}.json`).records) for (const p of r[2].split(", ").filter(Boolean)) assert.ok(programmes.has(p), p);
  assert.deepEqual(topicOf("Entity List (EL)"), { kind: "programme", key: "Entity List (EL)", label: "Entity List (EL)" });
  // a country only the map knows, and one the map names by its code
  assert.deepEqual(topicOf("Panamanian"), { kind: "country", key: "pa", label: "Panama" });
  assert.deepEqual(topicOf("denmark"), { kind: "country", key: "dk", label: "Denmark" });
  assert.equal(labels("country").size, read("stories/shadow-fleet/network/fleet-data.json").nodes.filter((n) => n.id.startsWith("cc:")).length);
  // the research map's programme groups and the lobbying graph's, never the buckets "both" and "other"
  assert.deepEqual(topicOf("semiconductors"), { kind: "group", key: "chips", label: "Chips" });
  assert.deepEqual([...labels("group")].sort(), ["China", "Chips", "Iran", "North Korea", "Russia", "Terrorism", "Venezuela"]);
  for (const t of VOCAB.topics) assert.match(t.label, /^\S(.*\S)?$/, JSON.stringify(t));
});
