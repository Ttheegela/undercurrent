import { test } from "node:test";
import assert from "node:assert/strict";
import { STEPS, availableSteps } from "../app/walkthrough.js";

test("five steps in page order", () => {
  assert.deepEqual(STEPS.map((s) => s.target), ["#q", '[data-walk="chips"]', '[data-walk="timeline"]', '[data-walk="names"]', '[data-walk="sources"]']);
});

test("steps whose target is missing are skipped", () => {
  const present = new Set(["#q", '[data-walk="sources"]']);
  const doc = { querySelector: (sel) => (present.has(sel) ? {} : null) };
  assert.deepEqual(availableSteps(STEPS, doc).map((s) => s.target), ["#q", '[data-walk="sources"]']);
});
