import json
import re

import pytest

import build_docs as b

DOCS = b.sources()


def html_of(base, md):
    return "".join(b.Converter(base).blocks(md.splitlines()))


@pytest.mark.parametrize("md", DOCS, ids=lambda p: str(p.relative_to(b.ROOT)))
def test_page_is_up_to_date(md):
    page = md.with_suffix(".html")
    assert page.exists() and page.read_text(encoding="utf-8") == b.render(md), \
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
