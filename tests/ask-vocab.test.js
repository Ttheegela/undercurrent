// The closed vocabulary: the topic words Ask may print, from the committed data only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { VOCAB, topicOf, groupLabel, BUCKETS } from "../api/_ask_vocab.js";

const read = (rel) => JSON.parse(readFileSync(rel, "utf8"));
const balanced = (s) => s.split("(").length === s.split(")").length;

test("groupLabel names a group from its key, an empty key is no label, and the map's buckets are no group", () => {
  assert.deepEqual(["dprk", "iran", "terrorism", ""].map(groupLabel), ["North Korea", "Iran", "Terrorism", ""]);
  assert.deepEqual([...BUCKETS].sort(), ["", "both", "other"]);
});

test("topicOf maps labels and aliases and rejects free text", () => {
  assert.deepEqual(topicOf("iran"), { kind: "programme", key: "Iran", label: "Iran" });
  assert.deepEqual(topicOf("Iranian"), topicOf("iran"));
  assert.equal(topicOf("Russia")?.label, "Russia");
  assert.equal(topicOf("  north   KOREAN ")?.label, "North Korea");
  for (const free of ["Iran Air", "hello", "Iranian oil", "", "Ira", null, undefined, 42]) assert.equal(topicOf(free), null, String(free));
});

test("the vocabulary holds every list programme, the map's countries and the groups, each with a printable label", () => {
  const labels = (kind) => new Set(VOCAB.topics.filter((t) => t.kind === kind).map((t) => t.label));
  // every part of every programme string on the four lists (compound US strings split), in any case, but for a part cut short
  for (const id of ["us", "uk", "eu", "un"]) {
    for (const r of read(`data/lists/${id}.json`).records) {
      for (const p of r[2].split(", ").filter((x) => x && balanced(x))) assert.equal(topicOf(p)?.kind, "programme", p);
    }
  }
  assert.deepEqual(topicOf("Entity List (EL)"), { kind: "programme", key: "Entity List (EL)", label: "Entity List (EL)" });
  // a country only the map knows, and one the map names by its code
  assert.deepEqual(topicOf("Panamanian"), { kind: "country", key: "pa", label: "Panama" });
  assert.deepEqual(topicOf("denmark"), { kind: "country", key: "dk", label: "Denmark" });
  // the map's countries, and those of the chips research's firms the map does not name ("Armenian firms")
  const mapCountries = read("stories/shadow-fleet/network/fleet-data.json").nodes.filter((n) => n.id.startsWith("cc:")).map((n) => n.id.slice(3).toLowerCase());
  const firmCountries = read("stories/chips-into-russia/data/listing_lag.json").firms.flatMap((f) => f.countries.map((cc) => cc.toLowerCase()));
  assert.equal(labels("country").size, new Set([...mapCountries, ...firmCountries]).size);
  assert.deepEqual(topicOf("Armenian"), { kind: "country", key: "am", label: "Armenia" });
  // the research map's programme groups and the lobbying graph's, never the buckets "both" and "other"
  assert.deepEqual(topicOf("semiconductors"), { kind: "group", key: "chips", label: "Chips" });
  assert.deepEqual([...labels("group")].sort(), ["China", "Chips", "Iran", "North Korea", "Russia", "Terrorism", "Venezuela"]);
  for (const t of VOCAB.topics) assert.match(t.label, /^\S(.*\S)?$/, JSON.stringify(t));
});

test("review (6): a programme written in two cases is one topic with one label, and a programme cut short is never printed", () => {
  // the UK's "Chemical Weapons" and the EU's "Chemical weapons"
  const chemical = VOCAB.topics.filter((t) => t.kind === "programme" && t.label.toLowerCase() === "chemical weapons");
  assert.equal(chemical.length, 1);
  assert.deepEqual(topicOf("chemical weapons"), topicOf("CHEMICAL WEAPONS"));
  assert.equal(topicOf("Chemical weapons").label, chemical[0].label);
  for (const kind of ["programme", "country", "group"]) {
    const seen = VOCAB.topics.filter((t) => t.kind === kind).map((t) => t.label.toLowerCase());
    assert.equal(new Set(seen).size, seen.length, kind);
  }
  // the UK list's "Counter-Terrorism (International", cut at its comma, is never a topic
  assert.equal(topicOf("Counter-Terrorism (International"), null);
  for (const t of VOCAB.topics) assert.ok(balanced(t.label), t.label);
});

test("one programme topic per country, whatever the lists call it: its spellings are grouped by region code, under the short name", () => {
  for (const w of ["North Korea", "DPRK", "Democratic People's Republic of Korea", "north korean"]) assert.deepEqual(topicOf(w), { kind: "programme", key: "North Korea", label: "North Korea" }, w);
  for (const w of ["Democratic Republic of the Congo", "Congo-Kinshasa"]) assert.deepEqual(topicOf(w), topicOf("DR Congo"), w);
  assert.deepEqual(topicOf("Republic of Belarus"), topicOf("Belarus"));
  assert.deepEqual(topicOf("Republic of Guinea-Bissau"), topicOf("Guinea-Bissau"));
  // neighbours stay apart, and South Korea (in no list's programmes) is never North Korea
  assert.notDeepEqual(topicOf("South Sudan"), topicOf("Sudan"));
  assert.notDeepEqual(topicOf("Guinea"), topicOf("Guinea-Bissau"));
  assert.notEqual(topicOf("South Korea")?.key, "North Korea");
  // the groups the committed lists hold
  const merged = VOCAB.topics.filter((t) => t.kind === "programme" && t.spellings.length > 1).map((t) => [t.region, t.label, [...t.spellings].sort()]);
  assert.deepEqual(merged, [
    ["CD", "DR Congo", ["DR Congo", "Democratic Republic of the Congo"]],
    ["KP", "North Korea", ["Democratic People's Republic of Korea", "North Korea"]],
    ["BY", "Belarus", ["Belarus", "Republic of Belarus"]],
    ["GW", "Guinea-Bissau", ["Guinea-Bissau", "Republic of Guinea-Bissau"]],
  ]);
  // a retired code the region table still names is its successor ("YD" is named "Yemen"); a programme that is no country has none
  assert.equal(topicOf("Yemen") && VOCAB.topics.find((t) => t.kind === "programme" && t.label === "Yemen").region, "YE");
  assert.equal(VOCAB.topics.find((t) => t.kind === "programme" && t.label === "Terrorism").region, undefined);
});

test("fix round 1 (1a): a regime's other spellings are aliases of one topic; a country of the map has its region code", () => {
  const alQaida = { kind: "programme", key: "Al-Qaida", label: "Al-Qaida" };
  for (const w of ["Al-Qaida", "Al-Qaeda", "al qaida", "ISIL", "ISIS", "Da'esh"]) assert.deepEqual(topicOf(w), alQaida, w);
  assert.equal(VOCAB.topics.find((t) => t.kind === "programme" && t.key === "Al-Qaida").region, undefined);
  assert.deepEqual(topicOf("Ukraine"), { kind: "country", key: "ua", label: "Ukraine" });
  assert.equal(VOCAB.topics.find((t) => t.kind === "country" && t.key === "ua").region, "UA");
});
