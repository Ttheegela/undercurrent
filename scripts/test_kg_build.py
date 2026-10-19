import copy
import hashlib
import json
from pathlib import Path

import pytest

import kg_build
from fleet_base import load_kg_base
from kg_build import build_kg

DAY = "2026-10-19"
SAMPLE = json.loads((Path(__file__).parent / "fixtures" / "lobbying_sample.json").read_text(encoding="utf-8"))
ZULU = "co:zulu-ships-management-and-operation-l-l-c"
GENERIC = "co:unlisted-003"
NODE_KEYS = {"id", "t", "n", "L", "g", "s", "lists", "info", "notes", "k", "br", "unverified_person", "hub", "src",
             "live", "nolobby"}
EDGE_KEYS = {"fleet": {"s", "t", "y", "c", "d", "u", "f", "r", "q", "L", "br"},
             "lobby": {"s", "t", "y", "c", "d", "d2", "u", "r", "ids", "a", "q", "pct", "sa", "sub", "L", "br"}}


@pytest.fixture(autouse=True)
def no_config_exclusions(tmp_path, monkeypatch):
    cfg = tmp_path / "clients.json"  # keeps every test off the real data/lobbying-clients.json
    cfg.write_text(json.dumps({"exclude_lobbyists": []}), encoding="utf-8")
    monkeypatch.setattr(kg_build, "CONFIG", cfg)


def fnode(nid, type_, name, **kw):
    return {"id": nid, "type": type_, "name": name, "aliases": [], "programs": ["russia"], "listed": False,
            "listed_by": [], "listing_dates": {}, "program_group": "russia", **kw}


def fedge(s, t, type_, date="2024-09-09", confidence="Documented"):
    return {"source": s, "target": t, "type": type_, "date": date, "confidence": confidence,
            "source_url": "https://example.gov/" + s, "source_file": "UK list", "record": "UK 1", "quote": "q"}


def make_fleet(*extra_nodes, extra_edges=()):
    nodes = [
        fnode("IMO9408695", "ship", "TASSOS", imo="9408695", listed=True, listed_by=["uk", "us"], flag_now="Liberia",
              listing_dates={"uk": "2024-09-26", "us": "2025-07-30"}, ship_type="Crude Oil Tanker"),
        fnode(ZULU, "company", "ZULU SHIPS MANAGEMENT", listed=True, listed_by=["eu"], country="ae",
              listing_dates={"eu": "2025-10-24"}, role="ship manager", name_policy="show"),
        fnode(GENERIC, "company", "REAL NAME LTD", aliases=["REAL NAME"], name_policy="generic",
              generic_name="unlisted Kazakhstan ship manager",
              research_notes=[{"angle": "x", "text": "REAL NAME LTD"}]),
        fnode("IMO9999999", "ship", "LONELY", imo="9999999"),
        fnode("cc:lr", "country", "Liberia"),
        fnode("gov:eu", "government", "EU"),
    ] + list(extra_nodes)
    edges = [
        fedge(ZULU, "IMO9408695", "manages"),
        fedge(GENERIC, "IMO9408695", "manages", confidence="Lead"),
        fedge(ZULU, "gov:eu", "designated_by", date="2025-10-24"),
        fedge("IMO9408695", "cc:lr", "flagged_in"),
    ] + list(extra_edges)
    return {"nodes": nodes, "edges": edges, "meta": {}}


def make_base(nodes=(), edges=(), **kw):
    return {"nodes": list(nodes), "edges": list(edges), "lob_alias": {}, "live_flags": {}, "status": {},
            "meta": {"no_lobbying_found": {"match": [], "names": []}, "live": None}, **kw}


def lobby(**kw):
    return {**copy.deepcopy(SAMPLE), **kw}


def get(kg, nid):
    return next(n for n in kg["nodes"] if n["id"] == nid)


def layer(kg, name):
    return [n for n in kg["nodes"] if n["L"] == name], [e for e in kg["edges"] if e["L"] == name]


def test_nord_stream_lobby_edges_present():
    kg = build_kg(make_fleet(), lobby(), make_base(), None, DAY)
    hired = [e for e in kg["edges"] if e["s"] == "co:nord-stream-2" and e["y"] == "hired"]
    assert len(hired) == 7 and {e["L"] for e in hired} == {"lobby"}
    assert get(kg, "co:nord-stream-2")["L"] == "lobby"
    assert "lf:capitol-counsel" in {e["t"] for e in hired}


def test_lobby_layer_carried_when_lobbying_stale():
    fresh = build_kg(make_fleet(), lobby(), make_base(), None, DAY)
    stale = build_kg(make_fleet(), None, make_base(), fresh, "2026-10-20")
    assert layer(stale, "lobby") == layer(fresh, "lobby")
    assert stale["meta"]["generated"] == "2026-10-20"
    for k in ("lda_filings_kept", "lda_filings_scanned"):
        assert stale["meta"]["counts"][k] == fresh["meta"]["counts"][k]


def test_stale_lobby_layer_is_yesterdays_not_todays_fleet():
    firm = lambda i: {"id": i, "t": "lobbyfirm", "n": i, "L": "lobby", "g": "", "s": "", "lists": [], "info": {},
                      "notes": [], "k": 1}
    prev = {"meta": {"counts": {"lda_filings_kept": 5, "lda_filings_scanned": 9}},
            "nodes": [firm("lf:a"), firm("lf:b"), dict(firm("IMO1"), L="fleet", t="ship")],
            "edges": [{"s": "lf:a", "t": "lf:b", "y": "hired", "c": "D", "d": "2020", "L": "lobby"},
                      {"s": "IMO1", "t": "lf:a", "y": "operates", "c": "D", "L": "fleet"}]}
    kg = build_kg(make_fleet(), None, make_base(), prev, DAY)
    assert layer(kg, "lobby")[1] == [prev["edges"][0]]
    assert {n["id"] for n in layer(kg, "lobby")[0]} == {"lf:a", "lf:b"}
    assert "IMO1" not in {n["id"] for n in kg["nodes"]}
    assert (kg["meta"]["counts"]["lda_filings_kept"], kg["meta"]["counts"]["lda_filings_scanned"]) == (5, 9)


def test_no_lobbying_asset_and_no_previous_graph_is_an_error():
    with pytest.raises(ValueError):
        build_kg(make_fleet(), None, make_base(), None, DAY)


def test_team_and_curated_edges_always_present():
    base = load_kg_base()
    kg = build_kg(make_fleet(), lobby(), base, None, DAY)
    have = {(e["s"], e["t"], e["y"], e["L"]) for e in kg["edges"]}
    assert {e["L"] for e in base["edges"]} == {"team", "curated"} and len(base["edges"]) == 48
    assert all((e["s"], e["t"], e["y"], e["L"]) in have for e in base["edges"])
    ids = {n["id"] for n in kg["nodes"]}
    assert all(e["s"] in ids and e["t"] in ids for e in base["edges"])


def test_generic_fleet_names_hidden():
    kg = build_kg(make_fleet(), lobby(), make_base(), None, DAY)
    n = get(kg, GENERIC)
    assert n["n"] == "unlisted Kazakhstan ship manager"
    assert "aliases" not in n["info"] and n["notes"] == []
    assert "REAL NAME" not in json.dumps(kg)


def test_fleet_layer_from_the_long_form():
    kg = build_kg(make_fleet(), lobby(), make_base(), None, DAY)
    ship, zulu = get(kg, "IMO9408695"), get(kg, ZULU)
    assert (ship["t"], ship["L"], ship["s"], ship["g"]) == ("ship", "fleet", "blocked", "russia")
    assert zulu["lists"] == [["EU", "", "2025-10-24"]]  # dated from its designated_by edge
    assert ship["lists"] == [["UK", "", ""], ["US", "", ""]]  # no such edge: the bare list names
    assert ship["info"]["flag_now"] == "Liberia" and ship["info"]["imo"] == "9408695"
    manages = next(e for e in kg["edges"] if e["s"] == ZULU and e["t"] == "IMO9408695")
    assert (manages["y"], manages["c"], manages["d"], manages["u"], manages["L"]) == (
        "manages", "D", "2024-09-09", "https://example.gov/" + ZULU, "fleet")
    assert next(e for e in kg["edges"] if e["s"] == GENERIC)["c"] == "L"
    assert not {"cc:lr", "gov:eu"} & {n["id"] for n in kg["nodes"]}  # countries, governments and rings are not drawn
    assert not [e for e in kg["edges"] if e["y"] in ("designated_by", "flagged_in")]


def test_orphan_ships_are_dropped_and_counted():
    kg = build_kg(make_fleet(), lobby(), make_base(), None, DAY)
    assert "IMO9999999" not in {n["id"] for n in kg["nodes"]}
    assert kg["meta"]["counts"]["ships_hidden_no_owner_link"] == 1
    c = kg["meta"]["counts"]
    assert c["nodes"] == len(kg["nodes"]) and c["edges"] == len(kg["edges"])
    assert c["by_layer"] == {"fleet": 3, "lobby": 33} and c["by_type"]["ship"] == 1
    assert (get(kg, ZULU)["k"], get(kg, "IMO9408695")["k"]) == (1, 2)


def test_node_and_edge_keys_keep_the_old_shape():
    kg = build_kg(make_fleet(), lobby(), load_kg_base(), None, DAY)
    assert all(set(n) <= NODE_KEYS and {"id", "t", "n", "L", "g", "s", "lists", "info", "notes", "k"} <= set(n)
               for n in kg["nodes"])
    for e in kg["edges"]:
        if e["L"] in EDGE_KEYS:
            assert set(e) <= EDGE_KEYS[e["L"]], e
    lobby_edge = next(e for e in kg["edges"] if e["L"] == "lobby" and e["y"] == "hired")
    assert set(lobby_edge) - {"br"} == EDGE_KEYS["lobby"] - {"br"}


def test_bridge_flags_on_links_between_the_two_sides():
    hire = {"source": ZULU, "target": "lf:capitol-counsel", "type": "hired", "filings": ["f1"], "years": [2020],
            "texts": [], "n_filings": 1, "source_url": "u", "confidence": "Documented"}
    kg = build_kg(make_fleet(), lobby(edges=SAMPLE["edges"] + [hire]), make_base(), None, DAY)
    assert get(kg, ZULU)["br"] and get(kg, "lf:capitol-counsel")["br"]
    assert next(e for e in kg["edges"] if e["s"] == ZULU and e["y"] == "hired")["br"]
    assert "br" not in get(kg, "lf:smw-partners")


def test_lobbying_company_that_is_also_a_fleet_company_bridges_and_stays_fleet():
    asset = lobby()
    asset["nodes"] = asset["nodes"] + [{"id": ZULU, "type": "company", "name": "Zulu (LDA)", "layer": "lobby"}]
    asset["edges"] = asset["edges"] + [{"source": ZULU, "target": "lf:smw-partners", "type": "hired",
                                         "filings": ["f"], "years": [2021], "texts": [], "n_filings": 1,
                                         "source_url": "u", "confidence": "Documented"}]
    kg = build_kg(make_fleet(), asset, make_base(), None, DAY)
    zulu = get(kg, ZULU)
    assert (zulu["L"], zulu["n"], zulu["br"]) == ("fleet", "ZULU SHIPS MANAGEMENT", True)


def test_excluded_lobbyists_never_appear():
    gone = {"Vincent A. Roberti, Sr.", "Walker Roberts"}

    def check(kg):
        assert not gone & {n["n"] for n in kg["nodes"]}
        assert not {"p:vincent-a-roberti-sr", "p:walker-roberts"} & {x for e in kg["edges"] for x in (e["s"], e["t"])}
        assert "Lydia Strunk" in {n["n"] for n in kg["nodes"]}

    # the asset's list matches first and last name, as the filing builder does; the config's list the full name
    namesake = fnode("p:walker-roberts", "person", "W. Roberts")  # same id on the fleet side
    check(build_kg(make_fleet(namesake), lobby(exclude_lobbyists=["Vincent Roberti"]), make_base(), None, DAY,
                   exclude=["WALKER ROBERTS"]))
    # yesterday's layer is filtered too, so a name added to the config leaves the page the same night
    fresh = build_kg(make_fleet(), lobby(), make_base(), None, DAY, exclude=[])
    assert gone <= {n["n"] for n in fresh["nodes"]}
    check(build_kg(make_fleet(), None, make_base(), fresh, DAY, exclude=["Vincent Roberti", "Walker Roberts"]))


def test_config_exclusions_are_read_when_not_passed():
    kg_build.CONFIG.write_text(json.dumps({"exclude_lobbyists": ["Lydia Strunk"]}), encoding="utf-8")
    kg = build_kg(make_fleet(), lobby(), make_base(), None, DAY)
    assert "Lydia Strunk" not in {n["n"] for n in kg["nodes"]}


def test_base_fleet_company_takes_live_names_and_status():
    old = {"id": ZULU, "t": "company", "n": "OLD NAME", "L": "fleet", "g": "other", "s": "", "lists": [], "info": {},
           "notes": [], "k": 99, "br": True, "nolobby": True, "note_from_base": "kept"}
    kg = build_kg(make_fleet(), lobby(), make_base([old]), None, DAY)
    zulu = get(kg, ZULU)
    assert (zulu["n"], zulu["s"], zulu["lists"]) == ("ZULU SHIPS MANAGEMENT", "blocked", [["EU", "", "2025-10-24"]])
    assert zulu["note_from_base"] == "kept"
    assert zulu["k"] == 1 and "br" not in zulu and "nolobby" not in zulu  # derived flags are recomputed, not copied


def test_base_fleet_company_that_the_fleet_graph_made_generic_follows_its_new_id():
    gone = "co:gone-shipping"
    hashed = "co:unlisted-" + hashlib.sha1(gone.encode()).hexdigest()[:8]
    old = {"id": gone, "t": "company", "n": "GONE SHIPPING", "L": "fleet", "g": "russia", "s": "blocked",
           "lists": [["US", "", "2024-01-01"]], "info": {}, "notes": []}
    curated = {"s": gone, "t": "co:nord-stream-2", "y": "owns", "c": "L", "d": "", "u": "", "f": "", "r": "", "q": "",
               "L": "curated", "a": 0, "an": ""}
    fleet = make_fleet(fnode(hashed, "company", "unlisted ship owner", name_policy="generic",
                             generic_name="unlisted ship owner"), extra_edges=[fedge(hashed, "IMO9408695", "owns")])
    kg = build_kg(fleet, lobby(), make_base([old], [curated]), None, DAY)
    assert gone not in {n["id"] for n in kg["nodes"]} and "GONE SHIPPING" not in json.dumps(kg)
    link = next(e for e in kg["edges"] if e["L"] == "curated")
    assert (link["s"], link["t"]) == (hashed, "co:nord-stream-2")


def test_base_company_missing_from_the_fleet_graph_is_kept_as_it_was():
    zara = {"id": "co:zara-shipholding", "t": "company", "n": "ZARA SHIPHOLDING CO", "L": "fleet", "g": "russia",
            "s": "blocked", "lists": [["US SDN", "50524", "RUSSIA-EO14024"]], "info": {}, "notes": []}
    link = {"s": "co:zara-shipholding", "t": "co:nord-stream-2", "y": "linked_to", "c": "D", "d": "", "u": "", "f": "",
            "r": "", "q": "", "L": "curated", "a": 0, "an": ""}
    kg = build_kg(make_fleet(), lobby(), make_base([zara], [link]), None, DAY)
    assert get(kg, "co:zara-shipholding")["lists"] == zara["lists"] and get(kg, "co:zara-shipholding")["br"]


def test_curated_status_of_lobbying_companies_is_kept():
    ssi = {"s": "restricted", "lists": [["US sectoral (SSI)", "17250", "RUSSIA-EO14024"]]}
    status = {"co:nord-stream-2": {"s": "blocked", "lists": [["US SDN", "31926", "PEESA-EO14039"]]}, ZULU: ssi}
    kg = build_kg(make_fleet(), lobby(), make_base(status=status), None, DAY)
    nord = get(kg, "co:nord-stream-2")
    assert (nord["s"], nord["lists"]) == ("blocked", status["co:nord-stream-2"]["lists"])
    # a company that is now also a fleet company: the hand-checked level beats "every listed company is blocked"
    assert (get(kg, ZULU)["s"], get(kg, ZULU)["lists"]) == ("restricted", ssi["lists"])


def test_no_lobbying_marker_and_live_flags():
    seen = {"area": "Gulf of Finland", "at": "2026-09-25T20:11Z"}
    meta = {"no_lobbying_found": {"match": [ZULU, "co:nord-stream-2", "co:missing"], "names": ["Zulu"]},
            "live": {"count": 27, "taken_utc": "2026-09-25T20:11Z"}}
    kg = build_kg(make_fleet(), lobby(), make_base(live_flags={"IMO9408695": seen, "IMO1": seen}, meta=meta), None, DAY)
    assert get(kg, ZULU)["nolobby"] is True
    assert "nolobby" not in get(kg, "co:nord-stream-2")  # filings exist for it now, so the badge would be untrue
    assert get(kg, "IMO9408695")["live"] == seen
    assert kg["meta"]["live"] == meta["live"] and kg["meta"]["no_lobbying_found"] == meta["no_lobbying_found"]


def test_build_is_deterministic_and_leaves_inputs_alone():
    fleet, asset, base = make_fleet(), lobby(), load_kg_base()
    before = copy.deepcopy((fleet, asset, base))
    one = build_kg(fleet, asset, base, None, DAY)
    assert (fleet, asset, base) == before
    assert json.dumps(one, sort_keys=True) == json.dumps(build_kg(fleet, asset, base, None, DAY), sort_keys=True)
