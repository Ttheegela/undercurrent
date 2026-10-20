"""Every figure a page takes from the nightly build (data-stat="kg.nodes") names a key in data/site-stats.json.

The text inside such an element is only a fallback for when the file cannot be read, and the nightly publish may
commit nothing but JSON, so it goes stale on purpose: these tests never compare it with today's value.
"""
import json
import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
STATS = json.loads((ROOT / "data" / "site-stats.json").read_text(encoding="utf-8"))
PAGES = [ROOT / "index.html", *sorted((ROOT / "stories").glob("**/*.html"))]
SCRIPTS = sorted((ROOT / "app").glob("*.js"))   # a card drawn by script carries data-stat too
DATA_STAT = re.compile(r'data-stat="([^"]*)"')
STATS_SCRIPT = re.compile(r'<script type="module" src="([^"]*app/stats\.js)"></script>')
DATE = re.compile(r"\d{4}-\d{2}-\d{2}")


def used(files):
    return [(f.relative_to(ROOT).as_posix(), path) for f in files for path in DATA_STAT.findall(f.read_text(encoding="utf-8"))]


def resolve(path):
    value = STATS
    for key in path.split("."):
        value = value[key]
    return value


FIGURES = used(PAGES + SCRIPTS)


def test_pages_do_carry_figures():
    assert {f for f, _ in FIGURES} >= {"index.html", "stories/about-the-data.html",
                                       "stories/who-lobbies/influence-network/methods.html",
                                       "stories/who-lobbies/influence-network/README.html"}


@pytest.mark.parametrize("file, path", sorted(set(FIGURES)))
def test_every_data_stat_key_exists(file, path):
    try:
        resolve(path)
    except (KeyError, TypeError):
        pytest.fail(f"{file}: data-stat=\"{path}\" is not in data/site-stats.json")


@pytest.mark.parametrize("file, path", sorted(set(FIGURES)))
def test_every_data_stat_value_is_a_number(file, path):
    value = resolve(path)
    if path == "generated":   # the one date: the build day, UTC
        assert isinstance(value, str) and DATE.fullmatch(value), f"{file}: {path} is not a YYYY-MM-DD date"
    else:
        assert isinstance(value, int) and not isinstance(value, bool), f"{file}: {path} is not a whole number"


@pytest.mark.parametrize("page", sorted({f for f, _ in used(PAGES)}))
def test_a_page_with_figures_loads_stats_js(page):
    html = (ROOT / page).read_text(encoding="utf-8")
    srcs = STATS_SCRIPT.findall(html)
    assert len(srcs) == 1, f"{page}: needs one <script type=\"module\" src=\".../app/stats.js\">"
    assert (ROOT / page).parent.joinpath(srcs[0]).resolve() == ROOT / "app" / "stats.js"
