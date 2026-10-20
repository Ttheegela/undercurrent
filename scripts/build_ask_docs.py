"""Build data/ask-docs.json: the explainer and methods pages, split into sections for Ask's site_docs tool.

A section runs from an h1, h2 or h3 to the next one (an h2 with h3s under it keeps only the text before the first h3).
The text under a page's h1 is its lead: the updates page has no other static text, since the rest renders from
data/changes/changes.json at runtime. A section's url is its page plus #<id>: the heading's own id, else the id of
the <section> it opens (how-sanctions-work/index.html), else a slug of the heading text. A slug is only a name, not
an anchor on the page: build_docs.py's notes pages put no ids on headings. Text is whitespace-normalised plain text.

Left out: script, style, nav, header, footer, noscript, hidden and aria-hidden elements, the footnote numbers (sup) and
the text labels inside diagrams (svg <text>; the diagrams' <title>/<desc> stay), and #upd-results, which the updates
page fills at runtime. A count the nightly build changes (<span data-stat="kg.nodes">3,235</span>) becomes the token
{{stat:kg.nodes}}, which site_docs fills from data/site-stats.json, so the index does not change when the figures do.
"""
from __future__ import annotations

import json
import re
import sys
from html.parser import HTMLParser
from pathlib import Path

import build_docs

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "ask-docs.json"
PAGES = [
    "stories/how-sanctions-work/index.html",
    "stories/about-the-data.html",
    "stories/who-lobbies/influence-network/methods.html",
    "stories/updates/index.html",
]
HEADINGS = {"h1", "h2", "h3"}
SKIP = {"script", "style", "nav", "header", "footer", "noscript", "sup", "text"}
RUNTIME_IDS = {"upd-results"}
VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"}
# Anything else ends a word: <p>a</p><p>b</p> is "a b", but <b>a</b>, is "a,".
INLINE = {"a", "abbr", "b", "cite", "code", "em", "i", "mark", "q", "small", "span", "strong", "sub", "time", "u", "tspan"}


class Parser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.stack: list[tuple[str, bool, str | None]] = []   # open (tag, skipped, id) triples
        self.ids: set[str] = set()                # every id on the page
        self.claimed: set[str] = set()            # <section> ids already given to a heading
        self.found: list[list] = []               # [heading id, title parts, text parts] per heading
        self.parts: list[str] | None = None       # the open heading's title, else the open section's text
        self.heading: str | None = None

    @property
    def skipping(self) -> bool:
        return any(skipped for _, skipped, _ in self.stack)

    def add(self, text: str) -> None:
        if self.parts is not None and not self.skipping:
            self.parts.append(text)

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if a.get("id"):
            self.ids.add(a["id"])
        skipped = False
        if not self.skipping:
            if "data-stat" in a:   # the figure is the fallback text inside the span; the token replaces it
                self.add("{{stat:%s}}" % a["data-stat"])
                skipped = True
            else:
                skipped = tag in SKIP or "hidden" in a or a.get("aria-hidden") == "true" or a.get("id") in RUNTIME_IDS
            if not skipped and tag in HEADINGS:
                parent = self.stack[-1] if self.stack else ("", False, None)
                own = a.get("id")
                if not own and parent[0] == "section" and parent[2] and parent[2] not in self.claimed:
                    own = parent[2]   # the first heading in <section id="x"> is reached by #x
                    self.claimed.add(own)
                self.found.append([own, [], []])
                self.parts, self.heading = self.found[-1][1], tag
            elif not skipped and tag not in INLINE:
                self.add(" ")
        if tag not in VOID:
            self.stack.append((tag, skipped, a.get("id")))

    def handle_endtag(self, tag):
        names = [name for name, _, _ in self.stack]
        if tag in VOID or tag not in names:
            return
        del self.stack[len(names) - names[::-1].index(tag) - 1:]   # also closes tags left open, like <li>
        if self.heading and self.heading not in [name for name, _, _ in self.stack]:
            self.heading, self.parts = None, self.found[-1][2]
        if tag not in INLINE:
            self.add(" ")

    def handle_data(self, data):
        self.add(data)


def slug(title: str) -> str:
    return re.sub(r"[\W_]+", "-", title.lower()).strip("-") or "section"


def sections_of(html: str, page: str) -> list[dict]:
    parser = Parser()
    parser.feed(html)
    parser.close()
    out, used = [], set()
    for heading_id, title, text in parser.found:
        title, text = " ".join("".join(title).split()), " ".join("".join(text).split())
        if not (title and text):
            continue
        base = anchor = heading_id or slug(title)
        n = 1
        while anchor in used or (not heading_id and anchor in parser.ids):   # a slug must not shadow another element's id
            n += 1
            anchor = f"{base}-{n}"
        used.add(anchor)
        url = f"{page}#{anchor}"
        out.append({"id": url, "page": page, "url": url, "title": title, "text": text})
    return out


def pages() -> list[str]:
    notes = (md.with_suffix(".html").relative_to(ROOT).as_posix() for md in build_docs.sources())
    return sorted({*PAGES, *notes})


def build() -> dict:
    return {"sections": [s for page in pages() for s in sections_of((ROOT / page).read_text(encoding="utf-8"), page)]}


def dumps(doc: dict) -> str:
    return json.dumps(doc, sort_keys=True, ensure_ascii=False, separators=(",", ":")) + "\n"


def main() -> int:
    doc = build()
    OUT.write_text(dumps(doc), encoding="utf-8", newline="\n")
    counts: dict[str, int] = {}
    for s in doc["sections"]:
        counts[s["page"]] = counts.get(s["page"], 0) + 1
    for page, n in counts.items():
        print(f"{n:3d} {page}")
    print(f"wrote {len(doc['sections'])} sections to {OUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
