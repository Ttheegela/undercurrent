import csv
import gzip
import json
import os
import shutil
from dataclasses import replace
from pathlib import Path

import pytest

import build_live_graphs as blg
import fleet_merge as fm
import fleet_official as fo
import kg_build
from build_live_graphs import Paths

HERE = Path(__file__).parent
FIX = HERE / "fixtures" / "fleet"
REAL = HERE.parent / "data"
DOWNLOADS = {fo.OS_EU_JOURNAL: "os_eu_journal_sample.csv", fo.OS_OFAC: "os_ofac_sample.csv"}
DAY1, DAY2, DAY3, DAY4 = ("2026-10-%02dT04:00:00Z" % d for d in (19, 20, 21, 22))
FLEET_FILES = ("fleet_data", "nodes", "edges")
CSL_HEADER = (FIX / "csl_sample.csv").read_text(encoding="utf-8").split("\n", 1)[0].split(",")


def fake_fetch(url):
    return (FIX / DOWNLOADS[url]).read_text(encoding="utf-8")


def fail_on(*urls):
    def fetch(url):
        if url in urls:
            raise OSError("connection reset")
        return fake_fetch(url)
    return fetch


def make_paths(root: Path) -> Paths:
    """A repo layout under `root`; the research bases are the real ones."""
    return replace(Paths.under(root), fleet_base=REAL / "fleet-base.json", kg_base=REAL / "kg-base.json",
                   aliases=REAL / "fleet-company-aliases.json")


def seed(paths: Paths) -> None:
    """Fresh inputs, as the nightly lists, lobbying and OpenSanctions steps leave them."""
    paths.raw.mkdir(parents=True)
    shutil.copy(FIX / "uk_sample.csv", paths.raw / "uk.csv")
    shutil.copy(FIX / "csl_sample.csv", paths.raw / "us.csv")
    paths.lists.mkdir(parents=True)
    meta = {g: {"status": "fresh", "record_count": n} for g, n in (("us", 55000), ("uk", 12000), ("eu", 24000), ("un", 3700))}
    (paths.lists / "meta.json").write_text(json.dumps({"lists": meta}), encoding="utf-8")
    (paths.lists / "eu.json").write_text(json.dumps({"list": "eu", "records": []}), encoding="utf-8")
    sample = json.loads((HERE / "fixtures" / "lobbying_sample.json").read_text(encoding="utf-8"))
    paths.lobbying.write_bytes(gzip.compress(json.dumps(sample).encode("utf-8")))
    paths.lobbying_meta.write_text(json.dumps({"status": "fresh"}), encoding="utf-8")
    paths.opensanctions_meta.write_text(json.dumps({"status": "fresh", "record_count": 67000}), encoding="utf-8")
    paths.config.write_text(json.dumps({"exclude_lobbyists": []}), encoding="utf-8")


def files(root: Path) -> set:
    return {p.relative_to(root) for p in root.rglob("*") if p.is_file()}


def load(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


@pytest.fixture(autouse=True)
def no_config_exclusions(tmp_path, monkeypatch):
    cfg = tmp_path / "clients.json"  # keeps diff() off the real data/lobbying-clients.json
    cfg.write_text(json.dumps({"exclude_lobbyists": []}), encoding="utf-8")
    monkeypatch.setattr(kg_build, "CONFIG", cfg)


@pytest.fixture(scope="module")
def baseline(tmp_path_factory):
    """The first night's run, done once: (the repo root, the files it wrote)."""
    root = tmp_path_factory.mktemp("baseline")
    paths = make_paths(root)
    seed(paths)
    before = files(root)
    with pytest.MonkeyPatch.context() as mp:
        cfg = root / "clients.json"
        cfg.write_text(json.dumps({"exclude_lobbyists": []}), encoding="utf-8")
        mp.setattr(kg_build, "CONFIG", cfg)
        assert blg.build(DAY1, fake_fetch, paths) == 0
    return root, files(root) - before - {Path("clients.json")}


@pytest.fixture
def world(baseline, tmp_path):
    """A copy of the repo after the first night: (its paths)."""
    root = tmp_path / "repo"
    shutil.copytree(baseline[0], root)
    return make_paths(root)


def record_day(paths, date):
    return next(d for d in load(paths.changes)["days"] if d["date"] == date)


def set_list(paths, gov, status):
    meta = load(paths.lists / "meta.json")
    meta["lists"][gov]["status"] = status
    (paths.lists / "meta.json").write_text(json.dumps(meta), encoding="utf-8")


def fleet_bytes(paths):
    return {name: getattr(paths, name).read_bytes() for name in FLEET_FILES}


def add_vessel(paths, imo, name):
    row = {"_id": imo, "source": "Specially Designated Nationals (SDN) - Treasury Department", "entity_number": imo,
           "type": "Vessel", "programs": "RUSSIA-EO14024", "name": name, "vessel_type": "Crude Oil Tanker",
           "vessel_flag": "Liberia", "ids": f"Vessel Registration Identification, IMO {imo}"}
    with open(paths.raw / "us.csv", "a", newline="", encoding="utf-8") as f:
        csv.DictWriter(f, fieldnames=CSL_HEADER).writerow(row)


# ---- the first (baseline) night ---------------------------------------------------------------------

def test_fresh_run_writes_all_outputs(baseline):
    root, written = baseline
    paths = make_paths(root)
    assert written == {Path(p) for p in (
        "stories/shadow-fleet/network/fleet-data.json", "stories/shadow-fleet/network/nodes.json",
        "stories/shadow-fleet/network/edges.json", "stories/who-lobbies/influence-network/kg.json",
        "data/changes/changes.json", "data/site-stats.json", "data/live-graphs-meta.json")}
    payload, nodes, edges = load(paths.fleet_data), load(paths.nodes), load(paths.edges)
    assert payload["meta"]["generated"] == "2026-10-19" and len(payload["edges"]) == len(edges)
    assert any(n["id"] == "IMO9408695" for n in nodes) and not any(n.get("kg_only") for n in nodes)
    kg = load(paths.kg)
    assert kg["meta"]["generated"] == "2026-10-19" and {n["L"] for n in kg["nodes"]} == {"fleet", "lobby"}
    # the baseline day: nothing is new, and the record starts today
    record = load(paths.changes)
    assert record["started"] == "2026-10-19" and len(record["days"]) == 1
    assert record["days"][0]["changes"] == []
    assert record["days"][0]["sources"] == {s: "fresh" for s in ("eu", "lobbying", "uk", "un", "us")}
    meta = load(paths.meta)
    assert (meta["status"], meta["updated_at"], meta["unavailable"]) == ("fresh", DAY1, [])
    assert meta["record_count"] == len(payload["edges"]) and "error" not in meta
    assert meta["kg_only"]["nodes"] and all(n["kg_only"] for n in meta["kg_only"]["nodes"])


def test_stats_match_payload(baseline):
    paths = make_paths(baseline[0])
    stats, payload, kg = load(paths.stats), load(paths.fleet_data), load(paths.kg)
    ships = sum(1 for n in payload["nodes"] if n["type"] == "ship")
    assert stats["generated"] == "2026-10-19" and stats["fleet"]["ships"] == ships > 0
    assert stats["fleet"] == {k: payload["meta"]["counts"][k]
                              for k in ("ships", "companies", "people", "countries", "edges", "lead_edges")}
    assert stats["fleet"]["companies"] == sum(1 for n in payload["nodes"] if n["type"] == "company")  # (no kg_only firm)
    kind = lambda layer, t: sum(1 for n in kg["nodes"] if (n["L"], n["t"]) == (layer, t))  # noqa: E731
    assert stats["kg"] == {
        "nodes": len(kg["nodes"]), "edges": len(kg["edges"]), "lead_edges": sum(1 for e in kg["edges"] if e["c"] == "L"),
        "ships": sum(1 for n in kg["nodes"] if n["t"] == "ship"), "companies": sum(1 for n in kg["nodes"] if n["t"] == "company"),
        "lobbyists": kind("lobby", "person"), "lobby_firms": kind("lobby", "lobbyfirm"),
        "filings_kept": kg["meta"]["counts"]["lda_filings_kept"], "filings_scanned": kg["meta"]["counts"]["lda_filings_scanned"]}
    assert stats["lists"] == {"us": 55000, "uk": 12000, "eu": 24000, "un": 3700}
    assert stats["opensanctions_sources"] == 95


def test_outputs_are_plain_json_paths(baseline):
    root, written = baseline
    assert written and all(p.suffix == ".json" for p in written)
    assert not [p for p in files(root) if p.suffix == ".tmp"]  # (written through a temp file, renamed into place)


def test_first_run_with_a_stale_source_writes_nothing(tmp_path, capsys):
    paths = make_paths(tmp_path / "repo")
    seed(paths)
    set_list(paths, "uk", "kept-previous")
    before = files(tmp_path / "repo")
    assert blg.build(DAY1, fake_fetch, paths) == 1  # no earlier map to keep, so no baseline from partial data
    assert files(tmp_path / "repo") == before
    assert "nothing written" in capsys.readouterr().out


# ---- a source fails alone ---------------------------------------------------------------------------

def test_stale_input_keeps_previous_graphs(world):
    before, kg_before = fleet_bytes(world), load(world.kg)
    set_list(world, "uk", "kept-previous")
    sample = json.loads(gzip.decompress(world.lobbying.read_bytes()))
    sample["filings_scanned"] += 7  # lobbying is fresh: the network's lobby layer still updates
    world.lobbying.write_bytes(gzip.compress(json.dumps(sample).encode("utf-8")))
    assert blg.build(DAY2, fake_fetch, world) == 1
    assert fleet_bytes(world) == before  # byte-identical
    day = record_day(world, "2026-10-20")
    assert day["sources"] == {"eu": "fresh", "lobbying": "fresh", "uk": "unavailable", "un": "fresh", "us": "fresh"}
    assert [c for c in day["changes"] if c["graph"] == "fleet"] == []
    meta = load(world.meta)
    assert meta["status"] == "kept-previous" and "UK list" in meta["error"] and meta["unavailable"] == ["uk"]
    assert (meta["checked_at"], meta["updated_at"]) == (DAY2, DAY1)  # (updated_at: when the map was last rebuilt)
    assert meta["record_count"] == len(load(world.fleet_data)["edges"])
    kg = load(world.kg)  # rebuilt around yesterday's map, including the firms the map leaves out
    assert kg["meta"]["counts"]["lda_filings_scanned"] == kg_before["meta"]["counts"]["lda_filings_scanned"] + 7
    assert kg["nodes"] == kg_before["nodes"] and kg["edges"] == kg_before["edges"]
    assert kg["meta"]["generated"] == "2026-10-20"


def test_missing_raw_file_keeps_the_fleet(world):
    before = fleet_bytes(world)
    (world.raw / "uk.csv").unlink()
    assert blg.build(DAY2, fake_fetch, world) == 1
    assert fleet_bytes(world) == before and record_day(world, "2026-10-20")["sources"]["uk"] == "unavailable"


@pytest.mark.parametrize("url,gov", [(fo.OS_EU_JOURNAL, "eu"), (fo.OS_OFAC, "us")])
def test_failed_opensanctions_download_marks_its_list(world, url, gov):
    before = fleet_bytes(world)
    assert blg.build(DAY2, fail_on(url), world) == 1
    assert fleet_bytes(world) == before
    sources = record_day(world, "2026-10-20")["sources"]
    assert {g for g, s in sources.items() if s == "unavailable"} == {gov}
    assert load(world.meta)["unavailable"] == [gov] and "OpenSanctions" in load(world.meta)["error"]


def test_shrink_guard_rejects(world):
    edges = load(world.edges)  # yesterday's map held far more official links than tonight's
    official = next(e for e in edges if e["layer"] == "official")
    other = [dict(official["sources"][0], file="some other record")]  # (no source family shrinks, only the whole)
    edges += [dict(official, id="e:fake%d" % i, sources=other) for i in range(len(edges))]
    world.edges.write_text(json.dumps(edges), encoding="utf-8")
    before = fleet_bytes(world)
    assert blg.build(DAY2, fake_fetch, world) == 1
    assert fleet_bytes(world) == before
    meta = load(world.meta)
    assert meta["status"] == "kept-previous" and "shrank" in meta["error"]
    assert meta["unavailable"] == ["eu", "uk", "us"]  # (no new list data reached the map)
    assert [c for c in record_day(world, "2026-10-20")["changes"] if c["graph"] == "fleet"] == []


def test_missing_sample_rejects(world, monkeypatch):
    before = fleet_bytes(world)
    monkeypatch.setattr(blg, "SAMPLE_PARTNER", "no such firm")
    assert blg.build(DAY2, fake_fetch, world) == 1
    assert fleet_bytes(world) == before
    assert "sample check failed" in load(world.meta)["error"]


def test_lobbying_unavailable_carries_the_lobby_layer(world):
    kg_before = load(world.kg)
    (world.lobbying_meta).write_text(json.dumps({"status": "kept-previous"}), encoding="utf-8")
    world.lobbying.unlink()
    assert blg.build(DAY2, fake_fetch, world) == 0  # the fleet was rebuilt; lobbying has its own failure line
    kg = load(world.kg)
    lobby = lambda g: ([n for n in g["nodes"] if n["L"] == "lobby"], [e for e in g["edges"] if e["L"] == "lobby"])  # noqa: E731
    assert lobby(kg) == lobby(kg_before) and kg["meta"]["generated"] == "2026-10-20"
    assert record_day(world, "2026-10-20")["sources"]["lobbying"] == "unavailable"
    assert [c for c in record_day(world, "2026-10-20")["changes"] if c["graph"] == "lobby"] == []


def test_both_graphs_kept_when_nothing_can_update(world):
    names = ("fleet_data", "nodes", "edges", "kg", "stats")
    before = {p: getattr(world, p).read_bytes() for p in names}
    set_list(world, "us", "kept-previous")
    world.lobbying_meta.write_text(json.dumps({"status": "kept-previous"}), encoding="utf-8")
    assert blg.build(DAY2, fake_fetch, world) == 1
    assert {p: getattr(world, p).read_bytes() for p in names} == before  # (no stats claim of a new build either)
    day = record_day(world, "2026-10-20")
    assert day["changes"] == [] and day["sources"]["us"] == day["sources"]["lobbying"] == "unavailable"


def test_unavailable_sources_carry_to_the_next_run(world, monkeypatch):
    calls = []
    real = blg.diff
    monkeypatch.setattr(blg, "diff", lambda prev, curr, graph, date, unavailable, exclude=None: (
        calls.append((graph, date, set(unavailable))), real(prev, curr, graph, date, unavailable, exclude))[1])
    set_list(world, "uk", "kept-previous")
    blg.build(DAY2, fake_fetch, world)
    assert calls == [("lobby", "2026-10-20", {"uk"})]  # the map was kept: only the network is compared
    set_list(world, "uk", "fresh")
    assert blg.build(DAY3, fake_fetch, world) == 0  # uk is back, but nothing it supplied is news tonight
    assert calls[1:] == [("fleet", "2026-10-21", {"uk"}), ("lobby", "2026-10-21", {"uk"})]
    assert load(world.meta)["unavailable"] == []  # (tonight's own set; the carry lasts one run)
    assert blg.build(DAY4, fake_fetch, world) == 0
    assert calls[3:] == [("fleet", "2026-10-22", set()), ("lobby", "2026-10-22", set())]


def test_first_run_without_lobbying_carries_the_25_sep_layer(world):
    kg = load(world.kg)  # stands in for the 25 Sep kg_data.js; the first run has no kg.json yet
    world.kg_js.write_text("window.KG=" + json.dumps(kg) + ";", encoding="utf-8")
    for name in ("fleet_data", "nodes", "edges", "kg", "changes", "stats", "meta"):
        getattr(world, name).unlink()
    world.lobbying_meta.write_text(json.dumps({"status": "kept-previous"}), encoding="utf-8")
    world.lobbying.unlink()
    assert blg.build(DAY2, fake_fetch, world) == 0
    lobby = lambda g: [e for e in g["edges"] if e["L"] == "lobby"]  # noqa: E731
    assert lobby(load(world.kg)) == lobby(kg) != []
    record = load(world.changes)  # a baseline: the first night has no yesterday
    assert record["started"] == "2026-10-20" and record["days"][0]["changes"] == []
    assert record["days"][0]["sources"]["lobbying"] == "unavailable"


# ---- each source fails alone: a short or empty download, a family of links that shrinks ---------------

def header_only(url):
    return fake_fetch(url).split("\n", 1)[0] + "\n"


def test_header_only_eu_journal_keeps_previous_and_marks_eu_unavailable(world):
    before = fleet_bytes(world)
    fetch = lambda url: header_only(url) if url == fo.OS_EU_JOURNAL else fake_fetch(url)  # noqa: E731
    assert blg.build(DAY2, fetch, world) == 1  # (without this, every EU journal ship reads as delisted)
    assert fleet_bytes(world) == before
    sources = record_day(world, "2026-10-20")["sources"]
    assert {g for g, s in sources.items() if s == "unavailable"} == {"eu"}
    assert "EU" in load(world.meta)["error"] and "no rows" in load(world.meta)["error"]
    assert [c for c in record_day(world, "2026-10-20")["changes"] if c["graph"] == "fleet"] == []


def test_empty_opensanctions_download_keeps_previous_and_marks_its_list(world):
    before = fleet_bytes(world)
    assert blg.build(DAY2, lambda url: "" if url == fo.OS_OFAC else fake_fetch(url), world) == 1
    assert fleet_bytes(world) == before and load(world.meta)["unavailable"] == ["us"]


def test_links_are_counted_by_the_file_their_sources_cite():
    def link(*files, layer="official"):
        return {"layer": layer, "source": "a", "target": "b", "type": "operates",
                "sources": [{"file": f} for f in files]}
    graph = {"nodes": [], "edges": [
        link(fo.UK_FILE), link(fo.UK_FILE, fo.OFAC_OS_FILE), link(fo.CSL_FILE), link(fo.CSL_OS_DATE_FILE),
        link(fo.EU_FILE), link(fm.EU_FILE), link(fo.UK_FILE, layer="research"), link("some research file")]}
    assert blg._family_counts(graph) == {
        "UK list": 2, "US consolidated screening list": 2, "OFAC list via OpenSanctions": 1,
        "EU journal via OpenSanctions": 1, "EU financial sanctions list": 1}


def inflate(paths, family, extra):
    """Make yesterday's map hold `extra` more official links of one family (clones of one that is there)."""
    files = blg.FAMILIES[family][0]
    edges = load(paths.edges)
    clone = next(e for e in edges if e["layer"] == "official" and files & {s["file"] for s in e["sources"]})
    edges += [dict(clone, id="e:fake%d" % i) for i in range(extra)]
    paths.edges.write_text(json.dumps(edges), encoding="utf-8")
    return blg._family_counts({"nodes": [], "edges": edges})[family] - extra


@pytest.mark.parametrize("family", ["UK list", "US consolidated screening list", "OFAC list via OpenSanctions",
                                    "EU journal via OpenSanctions"])
def test_family_shrink_over_20_percent_rejects(world, family):
    held = inflate(world, family, extra=0)  # tonight's count
    inflate(world, family, extra=max(held // 4 + 1, blg.FAMILY_MIN))  # yesterday's: a large family, tonight's under 80%
    before = fleet_bytes(world)
    assert blg.build(DAY2, fake_fetch, world) == 1
    assert fleet_bytes(world) == before
    meta = load(world.meta)
    assert meta["status"] == "kept-previous" and f"{family}: official links shrank from {held + max(held // 4 + 1, blg.FAMILY_MIN)}" \
        f" yesterday to {held} today" in meta["error"]
    assert meta["unavailable"] == [blg.FAMILIES[family][1]]  # (only that list's government)
    assert [c for c in record_day(world, "2026-10-20")["changes"] if c["graph"] == "fleet"] == []


def many_vessels(paths, n):
    for i in range(n):
        add_vessel(paths, "93%05d" % i, "SHIP %d" % i)


def test_family_shrink_under_20_percent_passes(world):
    family = "US consolidated screening list"
    many_vessels(world, 100)  # a night on which the family grows to 100 links or more ...
    assert blg.build(DAY2, fake_fetch, world) == 0
    held = blg._family_counts({"nodes": [], "edges": load(world.edges)})[family]
    assert held >= blg.FAMILY_MIN
    inflate(world, family, extra=held // 4)  # ... and yesterday's was a quarter more, so tonight's is exactly 80%
    assert blg.build(DAY3, fake_fetch, world) == 0
    assert load(world.meta)["status"] == "fresh" and load(world.meta)["unavailable"] == []


def test_family_shrink_just_over_20_percent_rejects_a_large_family(world):
    family = "US consolidated screening list"
    many_vessels(world, 100)
    assert blg.build(DAY2, fake_fetch, world) == 0
    held = blg._family_counts({"nodes": [], "edges": load(world.edges)})[family]
    inflate(world, family, extra=held // 4 + 1)
    assert blg.build(DAY3, fake_fetch, world) == 1
    assert load(world.meta)["unavailable"] == ["us"]


def test_small_family_drop_of_five_passes(world):
    family = "EU journal via OpenSanctions"  # a few links: a percentage means little
    held = inflate(world, family, extra=0)
    assert held < blg.FAMILY_MIN
    inflate(world, family, extra=5)  # yesterday's map held five more than tonight's
    assert blg.build(DAY2, fake_fetch, world) == 0
    assert load(world.meta)["status"] == "fresh" and load(world.meta)["unavailable"] == []


def test_small_family_to_zero_rejects(world):
    before = fleet_bytes(world)
    no_ships = lambda url: (fake_fetch(url).replace(",Vessel,", ",Company,")  # noqa: E731
                            if url == fo.OS_EU_JOURNAL else fake_fetch(url))
    assert blg.build(DAY2, no_ships, world) == 1  # (rows, but none a ship: the journal's links are all gone)
    assert fleet_bytes(world) == before
    meta = load(world.meta)
    assert "EU journal via OpenSanctions: official links shrank from 4 yesterday to 0 today" in meta["error"]
    assert meta["unavailable"] == ["eu"]


def test_sample_needs_an_official_link():
    def graph(layer):
        return {"nodes": [{"id": "IMO9408695", "name": "TASSOS"}, {"id": "co:z", "name": "Zulu Ships Management"}],
                "edges": [{"id": "e:1", "source": "co:z", "target": "IMO9408695", "type": "manages", "layer": layer,
                           "sources": []}]}
    assert blg._rejected(graph("official"), None) is None
    reason, down = blg._rejected(graph("research"), None)  # (a research link survives even if the lists are misread)
    assert "sample check failed" in reason and down == {"uk", "us", "eu"}


def test_unreadable_eu_list_keeps_the_fleet(world):
    before = fleet_bytes(world)
    (world.lists / "eu.json").write_text("not json", encoding="utf-8")
    assert blg.build(DAY2, fake_fetch, world) == 1
    assert fleet_bytes(world) == before and load(world.meta)["unavailable"] == ["eu"]


def test_crash_while_building_keeps_the_fleet(world, monkeypatch):
    before = fleet_bytes(world)

    def broken(*args, **kwargs):
        raise KeyError("schema")

    monkeypatch.setattr(blg, "merge", broken)
    assert blg.build(DAY2, fake_fetch, world) == 1
    assert fleet_bytes(world) == before
    meta = load(world.meta)
    assert "crashed" in meta["error"] and meta["unavailable"] == ["eu", "uk", "us"]


def test_malformed_lobbying_asset_does_not_take_the_map_down(world):
    kg_before = load(world.kg)
    world.lobbying.write_bytes(gzip.compress(b'{"filings": 3}'))  # (the meta says fresh, the asset is something else)
    assert blg.build(DAY2, fake_fetch, world) == 0
    kg = load(world.kg)
    assert [e for e in kg["edges"] if e["L"] == "lobby"] == [e for e in kg_before["edges"] if e["L"] == "lobby"]
    assert record_day(world, "2026-10-20")["sources"]["lobbying"] == "unavailable"


def test_network_is_kept_when_the_stored_firms_are_lost(world):
    meta = load(world.meta)
    del meta["kg_only"]  # (the meta file was lost): the network cannot be rebuilt around a map without them
    world.meta.write_text(json.dumps(meta), encoding="utf-8")
    kg_before = world.kg.read_bytes()
    set_list(world, "uk", "kept-previous")
    assert blg.build(DAY2, fake_fetch, world) == 1
    assert world.kg.read_bytes() == kg_before
    assert record_day(world, "2026-10-20")["sources"]["lobbying"] == "unavailable"


# ---- an interrupted run ------------------------------------------------------------------------------

@pytest.mark.parametrize("crash_at", range(1, 8))
def test_interrupted_run_never_files_a_change_twice(world, monkeypatch, crash_at):
    # The seven files are renamed into place one after another; the run dies at the crash_at'th rename.
    add_vessel(world, "9111111", "FIRST LIGHT")
    root, real, renamed = str(world.meta.parents[1]), os.replace, []

    def flaky(src, dst):
        if str(dst).startswith(root):
            renamed.append(Path(dst).name)
            if len(renamed) == crash_at:
                raise OSError("killed")
        real(src, dst)

    with monkeypatch.context() as m:
        m.setattr(blg.os, "replace", flaky)
        with pytest.raises(OSError):
            blg.build(DAY2, fake_fetch, world)
    days = lambda: load(world.changes)["days"]  # noqa: E731
    filed = lambda: [d["date"] for d in days() for c in d["changes"] if "FIRST LIGHT" in c["summary"]]  # noqa: E731
    if filed():  # the record is never ahead of the graphs it describes
        assert "IMO9111111" in {n["id"] for n in load(world.nodes)}
        assert "IMO9111111" in {n["id"] for n in load(world.fleet_data)["nodes"]}
        assert load(world.kg)["meta"]["generated"] == "2026-10-20"
    assert blg.build(DAY3, fake_fetch, world) == 0  # the next night
    assert len(filed()) <= 1  # a night's news may be lost, but is never filed under two days


# ---- re-runs and the record --------------------------------------------------------------------------

def test_same_day_rerun_adds_to_the_day(world):
    add_vessel(world, "9111111", "FIRST LIGHT")
    assert blg.build("2026-10-19T12:00:00Z", fake_fetch, world) == 0  # diffed against this morning's graph
    day = record_day(world, "2026-10-19")
    assert [c["summary"] for c in day["changes"]] == ["US listed FIRST LIGHT (IMO 9111111)"]
    add_vessel(world, "9222222", "SECOND WIND")
    assert blg.build("2026-10-19T18:00:00Z", fake_fetch, world) == 0
    assert blg.build("2026-10-19T19:00:00Z", fake_fetch, world) == 0  # nothing new: the day is left as it was
    record = load(world.changes)
    assert record["started"] == "2026-10-19" and len(record["days"]) == 1
    assert sorted(c["summary"] for c in record["days"][0]["changes"]) == [
        "US listed FIRST LIGHT (IMO 9111111)", "US listed SECOND WIND (IMO 9222222)"]


def test_next_day_diffs_against_yesterdays_graph(world):
    add_vessel(world, "9111111", "FIRST LIGHT")
    assert blg.build(DAY2, fake_fetch, world) == 0
    record = load(world.changes)
    assert [d["date"] for d in record["days"]] == ["2026-10-20", "2026-10-19"] and record["started"] == "2026-10-19"
    assert [c["summary"] for c in record["days"][0]["changes"]] == ["US listed FIRST LIGHT (IMO 9111111)"]
    assert record["days"][1]["changes"] == []
