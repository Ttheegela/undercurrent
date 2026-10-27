import json
from html.parser import HTMLParser

import build_ask_docs as b
import build_docs


def sections(html, page="page.html"):
    return b.sections_of(html, page)


def test_sections_have_title_url_and_text():
    html = ('<main><h2 id="first-id">First</h2><p>One <b>bold</b> two.</p>'
            '<h2 id="second">Second</h2><ul><li>a</li><li>b</li></ul></main>')
    assert sections(html) == [
        {"id": "page.html#first-id", "page": "page.html", "url": "/page.html#first-id", "title": "First", "text": "One bold two."},
        {"id": "page.html#second", "page": "page.html", "url": "/page.html#second", "title": "Second", "text": "a b"},
    ]


def test_h3_ends_the_h2_section_and_empty_sections_are_dropped():
    html = "<h1>Page</h1><h2>A</h2><h3>A1</h3><p>one</p><h3>A2</h3><p>two</p><h2>B</h2><p>three</p>"
    assert [(s["title"], s["text"]) for s in sections(html)] == [("A1", "one"), ("A2", "two"), ("B", "three")]


def test_text_under_h1_is_a_section():
    assert [(s["title"], s["text"]) for s in sections("<h1>Updates</h1><p>Every night.</p>")] == [("Updates", "Every night.")]


def test_blocks_do_not_glue_words_together():
    html = "<h2>T</h2><p>one</p><p>two<br>three</p><table><tr><td>four</td><td>five</td></tr></table>"
    assert sections(html)[0]["text"] == "one two three four five"


def test_a_bold_only_paragraph_with_no_stop_leads_into_the_next_sentence():
    # how-sanctions-work's <p><strong>What the data can't see</strong></p>: flattened, it ran into the next sentence
    html = ("<h2>Methods</h2><p>Checked.</p><p><strong>What the data can't see</strong></p><ul><li>Cash deals.</li></ul>"
            "<p><b>Fact (act text).</b></p><p><strong>Sources:</strong></p><p>More.</p>")
    assert sections(html)[0]["text"] == "Checked. What the data can't see: Cash deals. Fact (act text). Sources: More."


def test_neighbouring_elements_do_not_glue_words_together():
    html = ('<h2>T</h2><div class="stats"><div class="stat"><b data-stat="kg.ships">1,573</b><span>sanctioned ships</span></div>'
            '<div class="stat"><b>14</b><span>records</span></div></div>'   # methods.html stat tiles
            '<div class="conf"><div><b><svg width="30"><line x1="0"/></svg>Documented</b>An official record. '
            '<span data-stat="kg.documented_edges">3,719</span> lines.</div>'
            "<div><b>Reported</b>From a filing.</div></div>")                  # methods.html confidence labels
    assert sections(html)[0]["text"] == (
        "{{stat:kg.ships}} sanctioned ships 14 records Documented An official record. {{stat:kg.documented_edges}} lines. "
        "Reported From a filing.")


def test_punctuation_next_to_an_element_stays_attached():
    html = '<h2>T</h2><p>a (<b>bold</b>), <i>it</i>. Cost: $<span>5</span>, <a href="#">up 3</a>%; don<b>\'t</b> -<b>x</b></p>'
    assert sections(html)[0]["text"] == "a (bold), it. Cost: $5, up 3%; don't -x"


def test_text_before_a_sections_first_h2_belongs_to_that_section():
    html = ('<section class="hero"><p class="label">Research notes</p><h1>Page</h1></section>'
            '<section><p class="label">1 · One</p><h2>One</h2><p>a</p></section>'
            '<section id="two"><p class="label">2 · Two</p><h2>Two</h2><p>b</p><h3>Sub</h3><p>c</p></section>'
            "<section><p>pre</p><div><h3>Three</h3><p>d</p></div></section>")
    assert [(s["title"], s["text"]) for s in sections(html)] == [
        ("One", "1 · One a"), ("Two", "2 · Two b"), ("Sub", "c"), ("Three", "pre d")]   # the h1's label is not carried


def test_heading_without_id_gets_a_slug_id_but_a_bare_url():
    html = ("<h2>How it works: 50%</h2><p>a</p><h2>Same</h2><p>b</p><h2>Same</h2><p>c</p>"
            '<h2>Foo</h2><p>d</p><p id="foo">x</p><h2 id="kept">Other title</h2><p>e</p>')
    found = sections(html)
    # foo-2: a non-heading id foo exists. The slug names the section; it is not an anchor, so the url has none.
    assert [s["id"].split("#")[1] for s in found] == ["how-it-works-50", "same", "same-2", "foo-2", "kept"]
    assert [s["url"] for s in found] == ["/page.html"] * 4 + ["/page.html#kept"]


def test_a_repeated_heading_id_is_only_an_anchor_once():
    found = sections('<h2 id="a">x</h2><p>1</p><h2 id="a">y</h2><p>2</p>')
    assert [s["id"] for s in found] == ["page.html#a", "page.html#a-2"]
    assert [s["url"] for s in found] == ["/page.html#a", "/page.html"]


def test_first_heading_in_a_section_with_an_id_uses_that_id():
    html = ('<section id="how"><h2>How</h2><p>a</p><h3>Sub</h3><p>b</p></section>'
            '<section><h2>Plain</h2><p>c</p></section><section id="own"><h2 id="mine">Mine</h2><p>d</p></section>')
    found = sections(html)
    assert [s["id"].split("#")[1] for s in found] == ["how", "sub", "plain", "mine"]
    assert [s["url"] for s in found] == ["/page.html#how", "/page.html", "/page.html", "/page.html#mine"]


def test_slug_is_the_same_on_every_run_and_never_empty():
    html = "<h2>???</h2><p>a</p>"
    assert sections(html) == sections(html)
    assert sections(html)[0]["id"] == "page.html#section"


def test_data_stat_becomes_token():
    html = ('<h2>The <span data-stat="fleet.ships">1,747</span> ships</h2>'
            '<p>We hold <span data-stat="kg.nodes">3,235</span> nodes, of which <b><span data-stat="kg.ships">1,573</span></b> are ships.</p>')
    [s] = sections(html)
    assert s["title"] == "The {{stat:fleet.ships}} ships"
    assert s["text"] == "We hold {{stat:kg.nodes}} nodes, of which {{stat:kg.ships}} are ships."
    assert "1,747" not in s["title"] and "3,235" not in s["text"]
    assert s["id"] == "page.html#the-stat-fleet-ships-ships"  # the slug does not move when the nightly figure does


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


def test_every_page_is_indexed_with_unique_ids():
    doc = b.build()
    ids = [s["id"] for s in doc["sections"]]
    assert len(ids) == len(set(ids))
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


class Targets(HTMLParser):
    """id -> the text of the h1-h3 that has that id, or of the first h1-h3 inside the <section> that has it.
    Any other element with an id (a footnote, an svg marker) is not a target."""

    def __init__(self):
        super().__init__()
        self.target, self.waiting, self.ids, self.heading = {}, [], [], None

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if a.get("id"):
            self.ids.append(a["id"])
        if tag == "section" and a.get("id"):
            self.waiting.append(a["id"])
        if tag in ("h1", "h2", "h3"):
            self.heading = (tag, self.waiting + ([a["id"]] if a.get("id") else []), [])
            self.waiting = []

    def handle_data(self, data):
        if self.heading:
            self.heading[2].append(data)

    def handle_endtag(self, tag):
        if self.heading and tag == self.heading[0]:
            for i in self.heading[1]:
                self.target[i] = " ".join("".join(self.heading[2]).split())
            self.heading = None


def test_every_url_fragment_is_a_heading_or_its_section_on_its_page():
    doc = b.build()
    notes = {md.with_suffix(".html").relative_to(build_docs.ROOT).as_posix() for md in build_docs.sources()}
    for page in {s["page"] for s in doc["sections"]}:
        on_page = [s for s in doc["sections"] if s["page"] == page]
        targets = Targets()
        targets.feed((build_docs.ROOT / page).read_text(encoding="utf-8"))
        assert len(targets.ids) == len(set(targets.ids)), page
        for s in on_page:
            path, _, fragment = s["url"].partition("#")
            assert path == "/" + page
            if fragment:
                assert fragment in targets.target, f"{s['url']} is not a heading or the section of one"
                if "{{stat:" not in s["title"]:
                    assert targets.target[fragment] == s["title"], s["url"]
        if page in notes:   # build_docs puts an id on every h2/h3, so only the h1 lead can have a bare url
            bare = [s for s in on_page if "#" not in s["url"]]
            assert bare in ([], on_page[:1])


def test_committed_index_is_fresh():
    assert b.OUT.read_text(encoding="utf-8") == b.dumps(b.build()), \
        "data/ask-docs.json is out of date: run python scripts/build_ask_docs.py"
    assert json.loads(b.OUT.read_text(encoding="utf-8"))["sections"]
