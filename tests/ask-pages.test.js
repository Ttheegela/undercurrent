// Ask is on every reader-facing page: the stylesheet and the loader (which adds the button only when Ask is switched on), each once.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { gzipSync, brotliCompressSync } from "node:zlib";

const ROOT = new URL("../", import.meta.url);
const PAGES = execFileSync("git", ["ls-files", "*.html"], { cwd: ROOT, encoding: "utf8" }).split("\n").filter((f) => f && !f.startsWith("docs/"));
const CSS = /<link rel="stylesheet" href="\/app\/ask\.css">/g;
const JS = /<script type="module" src="\/app\/ask\.js"><\/script>/g;
const count = (re, s) => (s.match(re) || []).length;

test("every reader-facing page includes ask.css and ask.js", () => {
  assert.ok(PAGES.length >= 20, `${PAGES.length} pages`);
  for (const page of PAGES) {
    const html = readFileSync(new URL(page, ROOT), "utf8");
    assert.equal(count(CSS, html), 1, `${page}: ask.css`);
    assert.equal(count(JS, html), 1, `${page}: ask.js`);
    assert.ok(html.indexOf("/app/ask.css") < html.indexOf("</head>") && html.indexOf("/app/ask.js") < html.indexOf("</head>"), `${page}: in the head`);
  }
});

test("the notes template in build_docs.py carries both tags, so a regenerated page keeps them", () => {
  const py = readFileSync(new URL("scripts/build_docs.py", ROOT), "utf8");
  assert.equal(count(CSS, py), 1);
  assert.equal(count(JS, py), 1);
});

test("a page carries only the button's stylesheet: the panel's loads with the panel", () => {
  const button = readFileSync(new URL("app/ask.css", ROOT), "utf8");
  assert.ok(brotliCompressSync(button).length < 450, `${brotliCompressSync(button).length} bytes brotli`);
  assert.doesNotMatch(button, /\.ask-panel|\.ask-msg|\.ask-form/);
  assert.match(readFileSync(new URL("app/ask-panel.css", ROOT), "utf8"), /\.ask-panel/);
  assert.match(readFileSync(new URL("app/ask-panel.js", ROOT), "utf8"), /\/app\/ask-panel\.css/);
});

test("the loader stays tiny and loads the panel only when asked", () => {
  const loader = readFileSync(new URL("app/ask.js", ROOT), "utf8");
  assert.ok(gzipSync(loader).length < 700, `${gzipSync(loader).length} bytes gzipped`);
  assert.ok(!/^\s*import\s/m.test(loader), "no static import: the panel loads on the first click");
  assert.match(loader, /import\(["']\/app\/ask-panel\.js["']\)/);
  assert.match(loader, /enabled/);
  assert.match(loader, /public/);
  assert.ok(statSync(new URL("app/ask-panel.js", ROOT)).size > 0);
});

test("the stylesheet and the panel add no inline style and no storage", () => {
  const css = readFileSync(new URL("app/ask.css", ROOT), "utf8") + readFileSync(new URL("app/ask-panel.css", ROOT), "utf8");
  const js = readFileSync(new URL("app/ask-panel.js", ROOT), "utf8") + readFileSync(new URL("app/ask.js", ROOT), "utf8");
  assert.doesNotMatch(js, /<style|\.style\.cssText|setAttribute\(["']style|style=/);
  assert.doesNotMatch(js, /localStorage|sessionStorage|indexedDB|document\.cookie/);
  assert.doesNotMatch(js, /console\.\w+\(/, "no message text in a console call");
  assert.doesNotMatch(css, /#[0-9a-fA-F]{3,8}\b|rgb\(|oklch\(/, "the site's tokens only, no colour of its own");
});

test("the panel and the about page name TypeSafe", () => {
  // About the data says what Ask does with a question: the model (OpenRouter), the relevance check (TypeSafe), no training, nothing stored
  const html = readFileSync(new URL("stories/about-the-data.html", ROOT), "utf8");
  const privacy = "Ask, the chat panel, sends your question and data from this site to an AI model (Claude Haiku 5.5, through OpenRouter). The sentences of its answer then go, with your question, to a relevance check (TypeSafe), which removes any that don't bear on the question. Under their terms, neither OpenRouter nor TypeSafe uses what it is sent for training. Undercurrent stores no conversation: there are no accounts, the conversation lives only in your browser tab and is gone when you close the panel, and the server logs no message text.";
  assert.ok(html.includes(`<p>${privacy}</p>`));
  assert.ok(html.includes('id="ask"'), "the panel links to it");
  // the panel's own line (the smoke test sees it rendered)
  const panel = readFileSync(new URL("app/ask-panel.js", ROOT), "utf8");
  assert.ok(panel.includes("Your question and data from this site go to an AI model and a relevance checker (TypeSafe). The conversation isn't stored."));
});
