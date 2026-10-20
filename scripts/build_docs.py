"""Turn the Markdown notes under stories/ into HTML pages in the site's design.

Writes <name>.html next to every stories/**/*.md, using the same shell as the
other story pages. The .md files stay the source; run this after editing one
(scripts/test_build_docs.py fails if a page is out of date).

Only the Markdown the notes use is supported: headings, paragraphs, lists
(nested), tables, code spans and blocks, links, bold, italic, blockquotes and
horizontal rules. All text is HTML-escaped before any markup is added.

Every h2 and h3 gets an id, a slug of its Markdown text ("## Part 1. Who lobbies" is id="part-1-who-lobbies", a repeat
gets -2, -3, ...), so a link to a section lands on it.

A count the nightly build changes is written {{stat:kg.nodes}} (a dotted path into data/site-stats.json). It becomes
<span data-stat="kg.nodes">3,235</span>: the figure as of this run is the fallback text, and app/stats.js, which a
page with such a span loads, replaces it with the latest nightly figure.
"""
from __future__ import annotations

import html
import json
import re
import sys
from pathlib import Path
from string import Template
from urllib.parse import urljoin, urlparse

ROOT = Path(__file__).resolve().parent.parent
STORIES = ROOT / "stories"
STATS_FILE = ROOT / "data" / "site-stats.json"

FENCE = re.compile(r"^\s*```")
HEAD = re.compile(r"^(#{1,6})\s+(.+?)\s*#*\s*$")
HR = re.compile(r"^\s*([-*_])(\s*\1){2,}\s*$")
ITEM = re.compile(r"^(\s*)([-*+]|\d{1,9}[.)])\s+(\S.*)$")
TABLE_SEP = re.compile(r"^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$")
URL = re.compile(r"https?://(?:(?!&lt;|&gt;|&quot;|&#x27;)[^\s\x00\x01*])+")
LINK = re.compile(r"\[((?:[^\[\]]|\[[^\]]*\])*)\]\(([^()\s]*)\)")
CODE = re.compile(r"(`+)(.+?)(?<!`)\1(?!`)")
BOLD = re.compile(r"\*\*(?=\S)(.+?)(?<=\S)\*\*", re.S)
ITALIC = re.compile(r"(?<![\w*])\*(?=[^\s*])(.+?)(?<=[^\s*])\*(?![\w*])", re.S)
HOLD = re.compile(r"\x00(\d+)\x01")
STAT = re.compile(r"\{\{stat:([A-Za-z0-9_.]+)\}\}")


def slug(text: str) -> str:
    """Heading text -> an id. Made from the Markdown, not the HTML, so a {{stat:...}} figure does not move it."""
    return re.sub(r"[\W_]+", "-", LINK.sub(r"\1", text).lower()).strip("-") or "section"


def esc(text: str) -> str:
    return html.escape(text, quote=True)


def stat_span(path: str) -> str:
    """{{stat:kg.nodes}}: the figure from site-stats.json as of this run, as the fallback text of a span stats.js fills."""
    value = json.loads(STATS_FILE.read_text(encoding="utf-8"))
    for key in path.split("."):
        value = value.get(key) if isinstance(value, dict) else None
    if isinstance(value, bool) or not isinstance(value, (int, str)):
        raise ValueError(f"{{{{stat:{path}}}}} is not a figure in {STATS_FILE.name}")
    return f'<span data-stat="{esc(path)}">{esc(f"{value:,}" if isinstance(value, int) else value)}</span>'


def indent(line: str) -> int:
    return len(line) - len(line.lstrip(" "))


def split_row(line: str) -> list[str]:
    """'| a | `b|c` |' -> ['a', '`b|c`']: pipes inside code spans do not split."""
    cells, cur, in_code = [], "", False
    for ch in line.strip().strip("|"):
        if ch == "`":
            in_code = not in_code
        if ch == "|" and not in_code:
            cells.append(cur.strip())
            cur = ""
        else:
            cur += ch
    return cells + [cur.strip()]


def is_table_start(lines: list[str], i: int) -> bool:
    return (lines[i].lstrip().startswith("|") and i + 1 < len(lines)
            and "|" in lines[i + 1] and bool(TABLE_SEP.match(lines[i + 1])))


class Converter:
    def __init__(self, base: Path):
        self.base = base          # folder of the .md file, to check relative links
        self.title = ""
        self.tables = 0
        self.ids: set[str] = set()   # heading ids so far, to keep them unique

    # ---- inline -------------------------------------------------------

    def href(self, raw: str) -> str | None:
        """Same rule as safeUrl in app/render.js: http, https or relative only.
        Links to .md files point at their .html page. A relative link to
        something that is not on the site (a file from the original repo)
        returns None, and the caller shows its text without a link."""
        if urlparse(urljoin("https://undercurrent.invalid/", raw)).scheme not in ("http", "https"):
            return None
        parts = urlparse(raw)
        if parts.scheme or parts.netloc or not parts.path:   # absolute, or just "#section"
            return raw
        if not (self.base / parts.path).exists():
            return None
        if parts.path.endswith(".md"):
            return parts._replace(path=parts.path[:-3] + ".html").geturl()
        return raw

    def inline(self, text: str) -> str:
        held: list[str] = []

        def hold(markup: str) -> str:
            held.append(markup)
            return f"\x00{len(held) - 1}\x01"

        def emph(s: str) -> str:
            return ITALIC.sub(r"<em>\1</em>", BOLD.sub(r"<strong>\1</strong>", s))

        def link(m: re.Match) -> str:
            inner = emph(m[1])
            target = self.href(html.unescape(m[2]))
            return inner if target is None else hold(f'<a href="{esc(target)}">{inner}</a>')

        def bare(m: re.Match) -> str:
            url = m[0]
            while url[-1] in ".,;:!?" or (url[-1] == ")" and url.count(")") > url.count("(")):
                url = url[:-1]
            if m.string.startswith("&lt;", m.end()):   # a template such as .../<id>
                return m[0]
            return hold(f'<a href="{esc(html.unescape(url))}">{url}</a>') + m[0][len(url):]

        s = esc(text.replace("\x00", "").replace("\x01", ""))
        s = CODE.sub(lambda m: hold(f"<code>{m[2]}</code>"), s)
        s = STAT.sub(lambda m: hold(stat_span(m[1])), s)
        s = LINK.sub(link, s)
        s = emph(URL.sub(bare, s))
        while "\x00" in s:
            s = HOLD.sub(lambda m: held[int(m[1])], s)
        return s

    # ---- blocks -------------------------------------------------------

    def heading_id(self, level: int, text: str) -> str:
        if level not in (2, 3):
            return ""
        base = anchor = slug(text)
        n = 1
        while anchor in self.ids:
            n += 1
            anchor = f"{base}-{n}"
        self.ids.add(anchor)
        return f' id="{anchor}"'

    def interrupts(self, lines: list[str], i: int) -> bool:
        """Does this line end a paragraph?"""
        line = lines[i]
        item = ITEM.match(line)
        return bool(FENCE.match(line) or HEAD.match(line) or HR.match(line) or line.lstrip().startswith(">")
                    or is_table_start(lines, i) or (item and (item[2][0] in "-*+" or item[2][:-1] == "1")))

    def blocks(self, lines: list[str], tight: bool = False) -> list[str]:
        out, i = [], 0
        while i < len(lines):
            line = lines[i]
            if not line.strip():
                i += 1
            elif FENCE.match(line):
                j = i + 1
                while j < len(lines) and not FENCE.match(lines[j]):
                    j += 1
                code = esc("\n".join(lines[i + 1:j]))
                out.append(f'<pre tabindex="0"><code>{code}</code></pre>')
                i = j + 1
            elif HEAD.match(line):
                level, text = HEAD.match(line).groups()
                if len(level) == 1 and not self.title:
                    self.title = text
                else:
                    out.append(f"<h{len(level)}{self.heading_id(len(level), text)}>{self.inline(text)}</h{len(level)}>")
                i += 1
            elif HR.match(line):
                out.append("<hr>")
                i += 1
            elif is_table_start(lines, i):
                i = self.table(lines, i, out)
            elif line.lstrip().startswith(">"):
                j = i
                while j < len(lines) and lines[j].lstrip().startswith(">"):
                    j += 1
                quote = [re.sub(r"^\s*>\s?", "", q) for q in lines[i:j]]
                out.append("<blockquote>" + "".join(self.blocks(quote)) + "</blockquote>")
                i = j
            elif ITEM.match(line):
                i = self.list(lines, i, out)
            else:
                j = i + 1
                while j < len(lines) and lines[j].strip() and not self.interrupts(lines, j):
                    j += 1
                text = self.inline("\n".join(p.strip() for p in lines[i:j]))
                out.append(text if tight else f"<p>{text}</p>")
                i = j
        return out

    def table(self, lines: list[str], i: int, out: list[str]) -> int:
        head = split_row(lines[i])
        j = i + 2
        rows = []
        while j < len(lines) and lines[j].lstrip().startswith("|"):
            rows.append((split_row(lines[j]) + [""] * len(head))[:len(head)])
            j += 1
        self.tables += 1
        thead = ""
        if any(head):   # a header row of empty cells is left out
            thead = "<thead><tr>" + "".join(f'<th scope="col">{self.inline(c)}</th>' for c in head) + "</tr></thead>"
        body = "".join("<tr>" + "".join(f"<td>{self.inline(c)}</td>" for c in r) + "</tr>" for r in rows)
        out.append(f'<div class="tablebox" role="region" aria-label="Table {self.tables}" tabindex="0">'
                   f'<table class="c{min(len(head), 4)}">{thead}<tbody>{body}</tbody></table></div>')
        return j

    def list(self, lines: list[str], i: int, out: list[str]) -> int:
        first = ITEM.match(lines[i])
        base, ordered = len(first[1]), first[2][0].isdigit()
        items, loose = [], False
        while True:
            m = ITEM.match(lines[i])
            content = m.start(3)
            body, j = [m[3]], i + 1
            while j < len(lines):
                line = lines[j]
                if not line.strip():
                    k = j
                    while k < len(lines) and not lines[k].strip():
                        k += 1
                    if k < len(lines) and indent(lines[k]) >= content:
                        body += [""] * (k - j)
                        j = k
                        continue
                    break
                nested = ITEM.match(line)
                if indent(line) >= content:
                    body.append(line[content:])
                elif nested and indent(line) <= base:
                    break
                elif nested:   # indented, but less than the item text: still nested
                    body.append(line.lstrip())
                elif body[-1].strip() and not self.interrupts(lines, j):   # wrapped line
                    body.append(line.lstrip())
                else:
                    break
                j += 1
            item_loose = "" in body
            loose = loose or item_loose
            items.append((body, item_loose))
            k = j
            while k < len(lines) and not lines[k].strip():
                k += 1
            nxt = ITEM.match(lines[k]) if k < len(lines) else None
            if nxt and len(nxt[1]) == base and nxt[2][0].isdigit() == ordered:
                loose = loose or k > j
                i = k
                continue
            i = j
            break
        tag = "ol" if ordered else "ul"
        start = int(first[2][:-1]) if ordered else 1
        attr = f' start="{start}"' if start != 1 else ""
        lis = "".join("<li>" + "".join(self.blocks(b, tight=not loose)) + "</li>" for b, _ in items)
        out.append(f"<{tag}{attr}>{lis}</{tag}>")
        return i


# ---- page -------------------------------------------------------------

PAGE = Template("""<!DOCTYPE html>
<!-- Generated by scripts/build_docs.py from $source. Edit the .md and run: python scripts/build_docs.py -->
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>$plain_title · Undercurrent</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Schibsted+Grotesk:wght@400;500;700;800&family=Source+Serif+4:opsz,wght@8..60,400;8..60,500&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="${root}app/style.css">$stats
<style>
  /* Research notes rendered from Markdown · main site tokens only (app/style.css) */
  .hero { padding-block: var(--space-2xl) var(--space-xl); }
  .hero h1 { font-size: var(--text-3xl); line-height: 1.04; max-width: 24ch; }
  .doc { padding-bottom: var(--space-3xl); }
  .doc > * { max-width: 46rem; }
  .doc > .tablebox { max-width: none; }
  .doc h2 { font-weight: 700; font-size: var(--text-lg); margin: var(--space-2xl) 0 var(--space-sm); padding-top: var(--space-sm); border-top: 2px solid var(--color-ink); }
  .doc h3 { font-weight: 700; font-size: var(--text-lg); margin: var(--space-xl) 0 var(--space-sm); }
  .doc h4, .doc h5, .doc h6 { font-weight: 700; font-size: var(--text-base); margin: var(--space-lg) 0 var(--space-xs); }
  .doc > :first-child { margin-top: 0; }
  .doc p, .doc li { font-family: var(--font-serif); font-size: var(--text-lg); line-height: 1.6; color: var(--color-ink); }
  .doc p { margin: 0 0 var(--space-md); }
  .doc ul, .doc ol { margin: 0 0 var(--space-md); padding-left: 1.2em; }
  .doc li { margin-bottom: var(--space-xs); }
  .doc li > ul, .doc li > ol { margin: var(--space-xs) 0 0; }
  .doc li::marker { color: var(--color-accent); }
  .doc strong { font-weight: 700; }
  .doc a { text-decoration-color: var(--color-accent); overflow-wrap: anywhere; }
  .doc code { font-family: var(--font-mono); font-size: 0.8em; background: var(--color-paper-2); border: var(--rule-hair) solid var(--color-rule); border-radius: 3px; padding: 0.05em 0.35em; overflow-wrap: anywhere; }
  .doc pre { margin: 0 0 var(--space-lg); padding: var(--space-md); background: var(--color-paper-2); border: var(--rule-hair) solid var(--color-rule); border-radius: var(--radius-sm); overflow-x: auto; }
  .doc pre code { background: none; border: 0; padding: 0; font-size: var(--text-sm); line-height: 1.6; white-space: pre; overflow-wrap: normal; }
  .doc blockquote { margin: 0 0 var(--space-md); padding-left: var(--space-md); border-left: 2px solid var(--color-accent); color: var(--color-muted); }
  .doc hr { border: 0; margin: 0; }   /* the notes put one before each h2, which already has a rule */

  /* Tables scroll inside their own box on narrow screens */
  .tablebox { overflow-x: auto; margin: 0 0 var(--space-lg); }
  .tablebox:focus-visible { outline: 2px solid var(--color-focus); outline-offset: 2px; }
  .doc table { width: 100%; border-collapse: collapse; font-size: var(--text-sm); line-height: 1.45; }
  .doc table.c3 { min-width: 36rem; }
  .doc table.c4 { min-width: 48rem; }
  .doc th { text-align: left; vertical-align: bottom; font-weight: 500; color: var(--color-neutral); padding: 0 var(--space-md) var(--space-xs) 0; font-family: var(--font-mono); font-size: var(--text-2xs); text-transform: uppercase; letter-spacing: 0.08em; }
  .doc td { vertical-align: top; padding: var(--space-sm) var(--space-md) var(--space-sm) 0; border-top: var(--rule-hair) solid var(--color-rule); }
  .doc td code { overflow-wrap: break-word; }
</style>
</head>
<body>
<header class="wrap top">
  <a class="brand" href="$root"><span class="brand-mark" aria-hidden="true"></span>Undercurrent</a>
  <nav aria-label="Primary"><ul>
    <li><a href="${root}#research">Research</a></li>
    <li><a href="${root}stories/about-the-data.html">About the data</a></li>
  </ul></nav>
  <nav class="nav-graphs" aria-label="Graphs"><ul>
    <li><a href="${root}stories/shadow-fleet/network/shadow_fleet_map.html">Shadow fleet map</a></li>
    <li><a href="${root}stories/who-lobbies/influence-network/index.html">Influence network</a></li>
    <li><a href="${root}stories/updates/index.html">Updates</a></li>
  </ul></nav>
</header>
<main class="wrap">
<section class="hero">
  <p class="label">Research notes</p>
  <h1>$h1</h1>
</section>
<div class="doc">
$body
</div>
</main>

<footer class="wrap foot">
  <span>Undercurrent</span>
  <span>Research by the VeilTrace team, Trace the Unseen, 25 Sep 2026</span>
  <a href="${root}stories/about-the-data.html">About the data</a>
  <a href="${root}stories/sources/METHODS_LOG.html">Methods</a>
  <a href="https://github.com/Ttheegela/veil-trace">Original research repo</a>
  <span>Not legal advice</span>
</footer>
</body>
</html>
""")


def render(md: Path) -> str:
    conv = Converter(md.parent)
    body = "\n".join(conv.blocks(md.read_text(encoding="utf-8").splitlines()))
    lead, sep, rest = conv.title.partition(": ")   # "Method: following hulls" -> muted second half
    h1 = conv.inline(lead + ":") + f" <span>{conv.inline(rest)}</span>" if sep else conv.inline(lead)
    depth = len(md.parent.relative_to(ROOT).parts)
    root = "../" * depth or "./"
    stats = f'\n<script type="module" src="{root}app/stats.js"></script>' if 'data-stat="' in body else ""
    return PAGE.substitute(
        source=md.name, plain_title=esc(re.sub(r"[`*]", "", conv.title)), h1=h1, body=body,
        root=root, stats=stats)


def sources() -> list[Path]:
    return sorted(STORIES.glob("**/*.md"))


def main() -> int:
    for md in sources():
        md.with_suffix(".html").write_text(render(md), encoding="utf-8", newline="\n")
        print(f"wrote {md.with_suffix('.html').relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
