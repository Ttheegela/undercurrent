import json

import build_ask_docs as b
import build_docs


def sections(html, page="page.html"):
    return b.sections_of(html, page)


def test_sections_have_title_url_and_text():
    html = ('<main><h2 id="first-id">First</h2><p>One <b>bold</b> two.</p>'
            '<h2 id="second">Second</h2><ul><li>a</li><li>b</li></ul></main>')
    assert sections(html) == [
        {"id": "page.html#first-id", "page": "page.html", "url": "page.html#first-id", "title": "First", "text": "One bold two."},
        {"id": "page.html#second", "page": "page.html", "url": "page.html#second", "title": "Second", "text": "a b"},
    ]


def test_h3_ends_the_h2_section_and_empty_sections_are_dropped():
    html = "<h1>Page</h1><h2>A</h2><h3>A1</h3><p>one</p><h3>A2</h3><p>two</p><h2>B</h2><p>three</p>"
    assert [(s["title"], s["text"]) for s in sections(html)] == [("A1", "one"), ("A2", "two"), ("B", "three")]


def test_text_under_h1_is_a_section():
    assert [(s["title"], s["text"]) for s in sections("<h1>Updates</h1><p>Every night.</p>")] == [("Updates", "Every night.")]


def test_blocks_do_not_glue_words_together():
    html = "<h2>T</h2><p>one</p><p>two<br>three</p><table><tr><td>four</td><td>five</td></tr></table>"
    assert sections(html)[0]["text"] == "one two three four five"


def test_heading_without_id_gets_slug():
    html = ("<h2>How it works: 50%</h2><p>a</p><h2>Same</h2><p>b</p><h2>Same</h2><p>c</p>"
            '<h2>Foo</h2><p>d</p><p id="foo">x</p><h2 id="kept">Other title</h2><p>e</p>')
    anchors = [s["url"].split("#")[1] for s in sections(html)]
    assert anchors == ["how-it-works-50", "same", "same-2", "foo-2", "kept"]  # foo-2: a non-heading id foo exists


def test_first_heading_in_a_section_with_an_id_uses_that_id():
    html = ('<section id="how"><h2>How</h2><p>a</p><h3>Sub</h3><p>b</p></section>'
            '<section><h2>Plain</h2><p>c</p></section><section id="own"><h2 id="mine">Mine</h2><p>d</p></section>')
    assert [s["url"].split("#")[1] for s in sections(html)] == ["how", "sub", "plain", "mine"]


def test_slug_is_the_same_on_every_run_and_never_empty():
    html = "<h2>???</h2><p>a</p>"
    assert sections(html) == sections(html)
    assert sections(html)[0]["url"] == "page.html#section"


def test_data_stat_becomes_token():
    html = ('<h2>The <span data-stat="fleet.ships">1,747</span> ships</h2>'
            '<p>We hold <span data-stat="kg.nodes">3,235</span> nodes, of which <b><span data-stat="kg.ships">1,573</span></b> are ships.</p>')
    [s] = sections(html)
    assert s["title"] == "The {{stat:fleet.ships}} ships"
    assert s["text"] == "We hold {{stat:kg.nodes}} nodes, of which {{stat:kg.ships}} are ships."
    assert "1,747" not in s["title"] and "3,235" not in s["text"]
    assert s["url"] == "page.html#the-stat-fleet-ships-ships"  # the slug does not move when the nightly figure does


def test_script_and_nav_text_skipped():
    html = ("<header><h2>Header heading</h2>head</header><nav><ul><li>Nav link<li>Unclosed nav item</ul></nav>"
            "<h2>Real</h2><p>kept</p>"
            "<script>var x = '<p>script text</p>';</script><style>.a { color: red }</style>"
            "<p hidden>hidden text</p><div aria-hidden=\"true\"><h2>Hidden heading</h2>aria text</div>"
            '<p aria-hidden="false">shown</p>'
            '<p>fact.<sup><a href="#s1">1</a></sup> More.</p>'
            "<noscript>needs javascript</noscript>"
            '<svg><title>Diagram</title><desc>A bank refuses.</desc><text>Company A</text></svg>'
            '<div id="upd-results"><p>Loading updates…</p></div>'
            "<footer>foot text</footer>")
    [s] = sections(html)
    assert s["title"] == "Real"
    assert s["text"] == "kept shown fact. More. Diagram A bank refuses."


def test_every_page_is_indexed_with_unique_urls():
    doc = b.build()
    urls = [s["url"] for s in doc["sections"]]
    assert len(urls) == len(set(urls))
    by_page = {}
    for s in doc["sections"]:
        by_page.setdefault(s["page"], []).append(s)
    wanted = {"stories/how-sanctions-work/index.html", "stories/about-the-data.html",
              "stories/who-lobbies/influence-network/methods.html", "stories/updates/index.html"}
    wanted |= {md.with_suffix(".html").relative_to(build_docs.ROOT).as_posix() for md in build_docs.sources()}
    assert set(by_page) == wanted
    assert list(by_page) == sorted(by_page)                   # sorted by page, in page order
    assert all(s["text"] and s["title"] for s in doc["sections"])
    assert not any("Loading updates" in s["text"] for s in by_page["stories/updates/index.html"])


def test_committed_index_is_fresh():
    assert b.OUT.read_text(encoding="utf-8") == b.dumps(b.build()), \
        "data/ask-docs.json is out of date: run python scripts/build_ask_docs.py"
    assert json.loads(b.OUT.read_text(encoding="utf-8"))["sections"]
