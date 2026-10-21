import json
import re

import pytest

import build_docs as b

DOCS = b.sources()


def html_of(base, md):
    return "".join(b.Converter(base).blocks(md.splitlines()))


def without_fallbacks(html):
    """The text inside a data-stat span is a fallback the nightly run need not regenerate: leave it out of comparisons."""
    return re.sub(r'(<span data-stat="[^"]*">)[^<]*', r"\1", html)


@pytest.mark.parametrize("md", DOCS, ids=lambda p: str(p.relative_to(b.ROOT)))
def test_page_is_up_to_date(md):
    page = md.with_suffix(".html")
    assert page.exists() and without_fallbacks(page.read_text(encoding="utf-8")) == without_fallbacks(b.render(md)), \
        f"{page.relative_to(b.ROOT)} is out of date: run python scripts/build_docs.py"


def test_every_doc_has_a_permanent_redirect():
    redirects = {r["source"]: r for r in json.loads((b.ROOT / "vercel.json").read_text())["redirects"]}
    assert DOCS
    for md in DOCS:
        path = "/" + md.relative_to(b.ROOT).as_posix()
        assert redirects[path]["destination"] == path[:-3] + ".html" and redirects[path]["permanent"] is True


def test_nothing_links_to_a_markdown_file():
    pages = [b.ROOT / "index.html", *b.STORIES.glob("**/*.html")]
    for page in pages:
        assert not re.search(r'href="[^"]*\.md(#[^"]*)?"', page.read_text(encoding="utf-8")), page
    assert not re.search(r'"url": ?"[^"]*\.md"', (b.ROOT / "data" / "research-index.json").read_text())


def test_text_is_escaped_and_unsafe_links_dropped(tmp_path):
    out = html_of(tmp_path, '<script>x</script> & "q" [a](javascript:alert) [b](data:text/html,hi) '
                            "[c](https://e.org/?a=1&b=2) see https://e.org/x/<id>.")
    assert "<script>" not in out and "&lt;script&gt;" in out
    assert out.count("<a ") == 1 and '<a href="https://e.org/?a=1&amp;b=2">c</a>' in out
    assert "javascript:" not in out and "data:" not in out
    assert "https://e.org/x/&lt;id&gt;." in out   # a template, not a link


def test_markdown_links_point_at_html_and_dead_links_become_text(tmp_path):
    (tmp_path / "a.md").write_text("x")
    (tmp_path / "sub").mkdir()
    out = html_of(tmp_path, "[A](a.md#top) [dir](sub/) [gone](../nope/) [bare](#here)")
    assert 'href="a.html#top"' in out and 'href="sub/"' in out and 'href="#here"' in out
    assert "nope" not in out.replace("gone", "") and "<a>" not in out


def test_blocks(tmp_path):
    assert html_of(tmp_path, "**Key**\n- a\n  - b\n- *see **c** now*\n\n1. x\n   wrapped\n2. y") == (
        "<p><strong>Key</strong></p><ul><li>a<ul><li>b</li></ul></li>"
        "<li><em>see <strong>c</strong> now</em></li></ul><ol><li>x\nwrapped</li><li>y</li></ol>")
    table = html_of(tmp_path, "| | |\n|---|---|\n| 1 | `x|y` <z> |")
    assert "<thead>" not in table and "<td>1</td><td><code>x|y</code> &lt;z&gt;</td>" in table
    assert 'class="tablebox"' in table and 'tabindex="0"' in table
    assert html_of(tmp_path, "```\n<b>&\n```\n---") == '<pre tabindex="0"><code>&lt;b&gt;&amp;</code></pre><hr>'


def test_h2_and_h3_get_stable_unique_ids(tmp_path, monkeypatch):
    stats = tmp_path / "site-stats.json"
    stats.write_text('{"kg": {"nodes": 3235}}', encoding="utf-8")
    monkeypatch.setattr(b, "STATS_FILE", stats)
    out = html_of(tmp_path, "# Title\n\n## One: 50%\n\n### Sub\n\n## Sub\n\n#### Deep\n\n## ???\n\n## One: 50%\n\n"
                            "## **Bold** [link](https://e.org/x) end\n\n## {{stat:kg.nodes}} nodes")
    assert re.findall(r"<h([2-4])( id=\"[^\"]*\")?>", out) == [
        ("2", ' id="one-50"'), ("3", ' id="sub"'), ("2", ' id="sub-2"'), ("4", ""), ("2", ' id="section"'),
        ("2", ' id="one-50-2"'), ("2", ' id="bold-link-end"'), ("2", ' id="stat-kg-nodes-nodes"')]


def test_generated_headings_carry_unique_ids():
    for md in DOCS:
        page = md.with_suffix(".html").read_text(encoding="utf-8")
        tags = re.findall(r"<h[23]\b[^>]*>", page)
        ids = [re.search(r'(?<![\w-])id="([^"]+)"', tag) for tag in tags]
        assert tags and all(ids), md
        everything = re.findall(r'(?<![\w-])id="([^"]*)"', page)   # no heading id may repeat any other id on the page
        assert len(set(everything)) == len(everything) and {i[1] for i in ids} <= set(everything), md


def test_stat_token_becomes_a_span_with_the_current_figure_as_fallback(tmp_path, monkeypatch):
    stats = tmp_path / "site-stats.json"
    stats.write_text('{"generated": "2026-10-20", "kg": {"nodes": 3235}}', encoding="utf-8")
    monkeypatch.setattr(b, "STATS_FILE", stats)
    out = html_of(tmp_path, "**{{stat:kg.nodes}}** nodes, built {{stat:generated}}; in code `{{stat:kg.nodes}}`.")
    assert '<strong><span data-stat="kg.nodes">3,235</span></strong> nodes' in out
    assert 'built <span data-stat="generated">2026-10-20</span>;' in out
    assert "<code>{{stat:kg.nodes}}</code>" in out
    assert html_of(tmp_path, "```\n{{stat:kg.nodes}}\n```") == '<pre tabindex="0"><code>{{stat:kg.nodes}}</code></pre>'


@pytest.mark.parametrize("path", ["kg.nope", "kg", "nope", "kg.nodes.deeper"])
def test_stat_token_that_names_no_figure_stops_the_build(tmp_path, monkeypatch, path):
    stats = tmp_path / "site-stats.json"
    stats.write_text('{"kg": {"nodes": 3235}}', encoding="utf-8")
    monkeypatch.setattr(b, "STATS_FILE", stats)
    with pytest.raises(ValueError, match=re.escape("{{stat:" + path + "}}")):
        html_of(tmp_path, f"x {{{{stat:{path}}}}}")


def test_a_note_with_a_figure_loads_stats_js_and_one_without_does_not():
    with_figures = b.STORIES / "who-lobbies" / "influence-network" / "README.md"
    assert '<script type="module" src="../../../app/stats.js"></script>' in b.render(with_figures)
    assert "stats.js" not in b.render(b.STORIES / "shadow-fleet" / "FINDINGS.md")
