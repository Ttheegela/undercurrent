import copy
import hashlib
import json
from pathlib import Path

import pytest

import kg_build
from fleet_base import load_kg_base
from fleet_merge import compact, merge
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


def fedge(s, t, type_, date="2024-09-09", confidence="Documented", **kw):
    return {"source": s, "target": t, "type": type_, "date": date, "confidence": confidence,
            "source_url": "https://example.gov/" + s, "source_file": "UK list", "record": "UK 1", "quote": "q", **kw}


def listed_by(*govs, **dates):
    return {"listed": True, "listed_by": sorted(govs), "listing_dates": dates}


def make_fleet(*extra_nodes, extra_edges=()):
    nodes = [
        fnode("IMO9408695", "ship", "TASSOS", imo="9408695", flag_now="Liberia", ship_type="Crude Oil Tanker",
              **listed_by("uk", "us", uk="2024-09-26", us="2025-07-30")),
        fnode(ZULU, "company", "ZULU SHIPS MANAGEMENT", country="ae", role="ship manager", name_policy="show",
              **listed_by("eu", eu="2025-10-24")),
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
        fedge("IMO9408695", "gov:uk", "designated_by", date="2024-09-26", uk_freeze=False),
        fedge("IMO9408695", "gov:us", "designated_by", date="2025-07-30", us_list="SDN"),
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
    assert zulu["lists"] == [["EU", "", "2025-10-24"]]  # dated by its listing_dates
    assert ship["lists"] == [["UK", "", "2024-09-26"], ["US", "", "2025-07-30"]]  # dates from listing_dates
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


def test_excluded_lobbyist_with_two_word_surname_is_dropped():
    # LDA gives first "Mary", middle "Ann", last "Van Der Berg": the filing builder's first + last name is "Mary Van Der
    # Berg", but the node reads "Mary Ann Van Der Berg", whose first and last words alone ("Mary Berg") match nothing.
    person = {"id": "p:mary-ann-van-der-berg", "type": "person", "name": "Mary Ann Van Der Berg", "layer": "lobby"}
    link = {"source": person["id"], "target": "lf:capitol-counsel", "type": "lobbyist_at", "filings": ["f"],
            "years": [2021], "texts": [], "n_filings": 1, "source_url": "u", "confidence": "Documented"}
    asset = lobby(nodes=SAMPLE["nodes"] + [person], edges=SAMPLE["edges"] + [link])

    def build(exclude):
        return build_kg(make_fleet(), asset, make_base(), None, DAY, exclude=exclude)

    assert person["id"] in {n["id"] for n in build([])["nodes"]}
    for entry in ("Mary Van Der Berg", "MARY ANN VAN DER BERG", "Mary Berg"):  # over-excluding is the safe direction
        kg = build([entry])
        assert person["id"] not in {x for e in kg["edges"] for x in (e["s"], e["t"])} | {n["id"] for n in kg["nodes"]}
    assert "Lydia Strunk" in {n["n"] for n in build(["Mary Van Der Berg"])["nodes"]}


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


def test_base_fleet_company_keeps_its_description_when_the_live_node_has_none():
    # a company no vessel names (Zara Shipholding) has no live role; the base's line about it stays
    old = {"id": ZULU, "t": "company", "n": "OLD", "L": "fleet", "g": "russia", "s": "", "lists": [], "notes": [],
           "info": {"role": "shipping company linked by OFAC to Arctic LNG 2", "country": "IN"}}
    zulu = get(build_kg(make_fleet(), lobby(), make_base([old]), None, DAY), ZULU)
    assert zulu["info"]["role"] == "ship manager"  # a live role still wins
    live = make_fleet()
    live["nodes"][1] = {k: v for k, v in live["nodes"][1].items() if k != "role"}
    zulu = get(build_kg(live, lobby(), make_base([old]), None, DAY), ZULU)
    assert zulu["info"] == {"role": old["info"]["role"], "country": "ae", "programs": ["russia"]}


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


def test_base_fleet_company_absent_live_has_no_frozen_status():
    zara = {"id": "co:zara-shipholding", "t": "company", "n": "ZARA SHIPHOLDING CO", "L": "fleet", "g": "russia",
            "s": "blocked", "lists": [["US SDN", "50524", "RUSSIA-EO14024"]], "info": {"role": "kept"}, "notes": []}
    link = {"s": "co:zara-shipholding", "t": "co:nord-stream-2", "y": "linked_to", "c": "D", "d": "", "u": "", "f": "",
            "r": "", "q": "", "L": "curated", "a": 0, "an": ""}
    kg = build_kg(make_fleet(), lobby(), make_base([zara], [link]), None, DAY)
    node = get(kg, "co:zara-shipholding")  # the node stays, so the curated edge resolves, but 25 Sep's list status goes
    assert (node["s"], node["lists"], node["info"]) == ("", [], zara["info"]) and node["br"]
    assert zara["s"] == "blocked"  # the base itself is untouched


def test_curated_status_of_lobbying_companies_is_kept():
    status = {"co:nord-stream-2": {"s": "blocked", "lists": [["US SDN", "31926", "PEESA-EO14039"]]},
              "co:base-only": {"s": "blocked", "lists": [["US SDN", "1", "RUSSIA-EO14024"], ["UK", "RUS1", "2022-03-01"]]}}
    # kg-base keeps the same status on the base node of a company the asset does not hold: it must not show twice
    only = {"id": "co:base-only", "t": "company", "n": "Base Only", "L": "lobby", "g": "", "info": {}, "notes": [],
            **status["co:base-only"]}
    link = {"s": "co:base-only", "t": "co:nord-stream-2", "y": "owns", "c": "L", "d": "", "u": "", "f": "", "r": "",
            "q": "", "L": "curated", "a": 0, "an": ""}
    kg = build_kg(make_fleet(), lobby(), make_base([only], [link], status=status), None, DAY)
    nord = get(kg, "co:nord-stream-2")
    assert (nord["s"], nord["lists"]) == ("blocked", status["co:nord-stream-2"]["lists"])
    assert get(kg, "co:base-only")["lists"] == status["co:base-only"]["lists"]


SSI_GAZPROM = {"s": "restricted", "lists": [["US sectoral (SSI) and menu-based (NS-MBS)", "17250", "RUSSIA-EO14024"]]}


def test_sectoral_only_listing_is_not_blocked():
    # Gazprom, Novatek: on the US CSL as sectoral or menu-based entries, which limit dealings without freezing assets.
    def company(nid, name):
        govs = ("uk", "us") if nid == "co:both" else ("us",)
        return fnode(nid, "company", name, **listed_by(*govs, us="2014-09-12"))

    sectoral = [fedge("co:gazprom", "gov:us", "designated_by", us_list="NS-MBS List"),
                fedge("co:novatek", "gov:us", "designated_by", us_list="SSI"),
                fedge("co:frozen", "gov:us", "designated_by", us_list="SDN"),
                fedge("co:both", "gov:uk", "designated_by"),  # the UK asset freeze outranks the US sectoral entry,
                fedge("co:both", "gov:us", "designated_by", us_list="SSI")]  # whichever edge comes last
    fleet = make_fleet(*[company(i, i) for i in ("co:gazprom", "co:novatek", "co:frozen", "co:both")], extra_edges=sectoral
                       + [fedge(i, "IMO9408695", "owns") for i in ("co:gazprom", "co:novatek", "co:frozen", "co:both")])
    kg = build_kg(fleet, lobby(), make_base(), None, DAY)
    assert [get(kg, i)["s"] for i in ("co:gazprom", "co:novatek", "co:frozen", "co:both")] == [
        "restricted", "restricted", "blocked", "blocked"]
    assert get(kg, "IMO9408695")["s"] == "blocked"  # a UK specified ship, and a US SDN entry
    assert get(kg, "co:gazprom")["lists"] == [["US", "", "2014-09-12"]]  # the date is the list's, from listing_dates


def test_uk_or_eu_only_ship_is_restricted():
    # A UK specified ship and an EU Annex XLII listing are shipping measures, not asset freezes; a US SDN entry is one.
    ships = {"IMO1000001": [("gov:uk", {"uk_freeze": False})], "IMO1000002": [("gov:eu", {"eu_reg": "833"})],
             "IMO1000003": [("gov:uk", {"uk_freeze": False}), ("gov:eu", {"eu_reg": "833"})],
             "IMO1000004": [("gov:uk", {"uk_freeze": False}), ("gov:us", {"us_list": "SDN"})],
             "IMO1000005": [("gov:eu", {})]}  # an EU ship listing of another programme: no type, so nothing says freeze
    nodes = [fnode(i, "ship", i, imo=i[3:], **listed_by(*(g[4:] for g, _ in es))) for i, es in ships.items()]
    edges = [fedge(i, gov, "designated_by", **kw) for i, es in ships.items() for gov, kw in es]
    edges += [fedge(ZULU, i, "manages") for i in ships]
    kg = build_kg(make_fleet(*nodes, extra_edges=edges), lobby(), make_base(), None, DAY)
    assert [get(kg, i)["s"] for i in ships] == ["restricted", "restricted", "restricted", "blocked", "restricted"]


def test_uk_row_without_asset_freeze_is_restricted():
    def company(nid):
        return fnode(nid, "company", nid, **listed_by("uk" if "uk" in nid else "eu"))

    ids = ("co:uk-freeze", "co:uk-no-freeze", "co:eu-269", "co:eu-833")
    designations = [fedge("co:uk-freeze", "gov:uk", "designated_by", uk_freeze=True),
                    fedge("co:uk-no-freeze", "gov:uk", "designated_by", uk_freeze=False),
                    fedge("co:eu-269", "gov:eu", "designated_by", eu_reg="269"),
                    fedge("co:eu-833", "gov:eu", "designated_by", eu_reg="833")]
    edges = designations + [fedge(i, "IMO9408695", "owns") for i in ids]
    kg = build_kg(make_fleet(*map(company, ids), extra_edges=edges), lobby(), make_base(), None, DAY)
    assert [get(kg, i)["s"] for i in ids] == ["blocked", "restricted", "blocked", "restricted"]


def test_curated_level_upgraded_by_live_blocking_listing():
    frozen = {"s": "blocked", "lists": [["US SDN", "1", "RUSSIA-EO14024"]]}
    status = {"co:gazprom": SSI_GAZPROM, "co:novatek": SSI_GAZPROM, "co:frozen": frozen}
    gaz = fnode("co:gazprom", "company", "PJSC GAZPROM", **listed_by("us", us="2024-09-09"))
    nov = fnode("co:novatek", "company", "Novatek", **listed_by("us", us="2024-09-09"))
    froz = fnode("co:frozen", "company", "Frozen", **listed_by("us", us="2024-09-09"))
    edges = [fedge("co:gazprom", "gov:us", "designated_by", us_list="NS-MBS List"),  # still sectoral: curated stands
             fedge("co:novatek", "gov:us", "designated_by", us_list="SDN"),  # SDN-listed since: blocked, live lists
             fedge("co:frozen", "gov:us", "designated_by", us_list="SSI")]  # curated blocked is not weakened
    edges += [fedge(i, "IMO9408695", "owns") for i in ("co:gazprom", "co:novatek", "co:frozen")]
    kg = build_kg(make_fleet(gaz, nov, froz, extra_edges=edges), lobby(), make_base(status=status), None, DAY)
    assert (get(kg, "co:gazprom")["s"], get(kg, "co:gazprom")["lists"]) == ("restricted", SSI_GAZPROM["lists"])
    assert (get(kg, "co:novatek")["s"], get(kg, "co:novatek")["lists"]) == ("blocked", [["US", "", "2024-09-09"]])
    assert (get(kg, "co:frozen")["s"], get(kg, "co:frozen")["lists"]) == ("blocked", frozen["lists"])


def test_curated_lists_keep_live_listings_of_other_governments():
    # the curated level wins a tie, but a new listing by a government the curated entries do not name still shows
    status = {"co:novatek": SSI_GAZPROM}
    nov = fnode("co:novatek", "company", "Novatek", **listed_by("eu", "us", eu="2026-10-01", us="2014-09-12"))
    edges = [fedge("co:novatek", "gov:us", "designated_by", us_list="SSI"),
             fedge("co:novatek", "gov:eu", "designated_by", eu_reg="833"),
             fedge("co:novatek", "IMO9408695", "owns")]
    kg = build_kg(make_fleet(nov, extra_edges=edges), lobby(), make_base(status=status), None, DAY)
    novatek = get(kg, "co:novatek")
    assert novatek["s"] == "restricted"
    assert novatek["lists"] == SSI_GAZPROM["lists"] + [["EU", "", "2026-10-01"]]  # the US entry is the curated one


def test_curated_entries_drop_when_live_listing_ends():
    # a curated entry is the hand-checked detail of a listing; once the government no longer lists the fleet node, it goes
    status = {"co:gazprom": SSI_GAZPROM, "co:gazpromneft": SSI_GAZPROM,
              "co:nord-stream-2": {"s": "blocked", "lists": [["US SDN", "1", "PEESA"]]}}
    delisted = fnode("co:gazprom", "company", "PJSC GAZPROM")  # no longer on the US list
    eu_only = fnode("co:gazpromneft", "company", "Gazprom Neft", **listed_by("eu", eu="2026-10-01"))
    edges = [fedge("co:gazprom", "IMO9408695", "owns"), fedge("co:gazpromneft", "IMO9408695", "owns"),
             fedge("co:gazpromneft", "gov:eu", "designated_by", eu_reg="833")]
    kg = build_kg(make_fleet(delisted, eu_only, extra_edges=edges), lobby(), make_base(status=status), None, DAY)
    assert (get(kg, "co:gazprom")["s"], get(kg, "co:gazprom")["lists"]) == ("", [])
    assert (get(kg, "co:gazpromneft")["s"], get(kg, "co:gazpromneft")["lists"]) == ("restricted", [["EU", "", "2026-10-01"]])
    # a company with no fleet node keeps its curated entries
    assert get(kg, "co:nord-stream-2")["lists"] == status["co:nord-stream-2"]["lists"]


def test_lists_keep_the_25_sep_order():
    # ships were UK, US, EU; companies and people US, EU, UK. Listed by edge order (the long form is sorted) it was EU, UK, US.
    def desig(nid):
        return [fedge(nid, "gov:" + g, "designated_by", date=d) for g, d in (("eu", "2025-01-01"), ("uk", "2024-02-02"),
                                                                              ("us", "2023-03-03"))]

    dates = {"eu": "2025-01-01", "uk": "2024-02-02", "us": "2023-03-03"}
    firm = fnode("co:firm", "company", "Firm", **listed_by("eu", "uk", "us", **dates))
    ship = fnode("IMO1000009", "ship", "SHIP", imo="1000009", **listed_by("eu", "uk", "us", **dates))
    edges = desig("co:firm") + desig("IMO1000009") + [fedge("co:firm", "IMO1000009", "owns")]
    kg = build_kg(make_fleet(firm, ship, extra_edges=edges), lobby(), make_base(), None, DAY)
    assert [x[0] for x in get(kg, "IMO1000009")["lists"]] == ["UK", "US", "EU"]
    assert [x[0] for x in get(kg, "co:firm")["lists"]] == ["US", "EU", "UK"]
    assert get(kg, "co:firm")["lists"][0] == ["US", "", "2023-03-03"]


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


def research(url, quote="q", angle="studies", record=""):
    return {"url": url, "file": angle + ".csv", "quote": quote, "record": record, "angle": angle,
            "confidence": "Documented"}


def mship(nid):
    return {"id": nid, "type": "ship", "name": nid, "imo": nid[3:], "aliases": [], "programs": ["russia"],
            "angle": ["lists"]}


def mcompany(nid):
    return {"id": nid, "type": "company", "name": nid.upper(), "aliases": [], "programs": ["russia"], "angle": ["lists"]}


def medge(s, t, type_, date, source, **kw):
    return {"source": s, "target": t, "type": type_, "date": date, "source_url": source["url"],
            "source_file": source["file"], "quote": source["quote"], "record": source["record"],
            "angle": source["angle"], "confidence": "Documented", "sources": [source], **kw}


GOV_UK = "https://search-uk-sanctions-list.service.gov.uk/designations/RUS1/Ship"
GOV_EU = "https://eur-lex.europa.eu/eli/reg_impl/2026/1/oj/eng"
GOV_US = "https://sanctionssearch.ofac.treas.gov/Details.aspx?id=1"


def merged(official_nodes, official_edges, research_edges=()):
    """merge() of an official layer over a research base: the long form build_kg reads."""
    base = {"nodes": [], "edges": list(research_edges), "node_fields": {}, "meta": {}, "generated": "2026-09-25"}
    return merge(base, {"nodes": official_nodes, "edges": official_edges}, aliases={}, eu_records=[])


def test_ship_listed_only_by_us_shows_only_us():
    # The UK and EU designations are 25 Sep research that the feeds no longer back: merge() leaves them out of
    # listed_by, and so must the network page.
    ops = medge("co:ops", "IMO2000001", "operates", "2025-07-30", research(GOV_US, angle="lists"))
    us = medge("IMO2000001", "gov:us", "designated_by", "2025-07-30", research(GOV_US, angle="lists"), us_list="SDN")
    frozen = [medge("IMO2000001", "gov:uk", "designated_by", "2024-07-31", research(GOV_UK)),
              medge("IMO2000001", "gov:eu", "designated_by", "2024-08-01", research(GOV_EU))]
    fleet = merged([mship("IMO2000001"), mcompany("co:ops")], [ops, us], frozen)
    assert next(n for n in fleet["nodes"] if n["id"] == "IMO2000001")["listed_by"] == ["us"]
    ship = get(build_kg(fleet, lobby(), make_base(), None, DAY), "IMO2000001")
    assert (ship["s"], ship["lists"]) == ("blocked", [["US", "", "2025-07-30"]])


def test_delisted_ship_with_research_designation_is_not_listed_on_network():
    ops = [medge(c, "IMO2000002", "operates", "2025-07-30", research(GOV_US, angle="lists"))
           for c in ("co:ops", "co:cited", "co:blog")]
    research_edges = [  # no list holds the ship any more; a company's official-host citation still counts
        medge("IMO2000002", "gov:uk", "designated_by", "2024-07-31", research(GOV_UK)),
        medge("IMO2000002", "gov:eu", "designated_by", "2024-08-01", research(GOV_EU)),
        medge("co:cited", "gov:us", "designated_by", "2024-03-05", research(GOV_US)),
        medge("co:blog", "gov:us", "designated_by", "2024-03-05", research("https://example.org/blog"))]
    nodes = [mship("IMO2000002"), mcompany("co:ops"), mcompany("co:cited"), mcompany("co:blog")]
    fleet = merged(nodes, ops, research_edges)
    assert next(n for n in fleet["nodes"] if n["id"] == "IMO2000002")["listed"] is False
    kg = build_kg(fleet, lobby(), make_base(), None, DAY)
    assert (get(kg, "IMO2000002")["s"], get(kg, "IMO2000002")["lists"]) == ("", [])
    assert (get(kg, "co:cited")["s"], get(kg, "co:cited")["lists"]) == ("blocked", [["US", "", "2024-03-05"]])
    assert (get(kg, "co:blog")["s"], get(kg, "co:blog")["lists"]) == ("", [])


def test_extra_company_is_blocked_on_the_network_and_out_of_the_map_payload():
    zara = dict(mcompany("co:zara-shipholding"), name="ZARA SHIPHOLDING CO", kg_only=True)
    sdn = medge("co:zara-shipholding", "gov:us", "designated_by", "2024-08-23", research(GOV_US, angle="lists"),
                us_list="SDN")
    where = medge("co:zara-shipholding", "cc:ae", "registered_in", "", research(GOV_US, angle="lists"))
    fleet = merged([zara], [sdn, where])
    old = {"id": "co:zara-shipholding", "t": "company", "n": "ZARA SHIPHOLDING CO", "L": "fleet", "g": "russia",
           "s": "blocked", "lists": [["US SDN", "50524", "RUSSIA-EO14024"]], "info": {}, "notes": []}
    arctic = {"id": "co:arctic-lng-2", "t": "company", "n": "Arctic LNG 2", "L": "lobby", "g": "russia", "s": "",
              "lists": [], "info": {}, "notes": []}
    link = {"s": "co:zara-shipholding", "t": "co:arctic-lng-2", "y": "linked_to", "c": "D", "d": "", "u": "", "f": "",
            "r": "", "q": "", "L": "curated", "a": 0, "an": ""}
    kg = build_kg(fleet, lobby(), make_base([old, arctic], [link]), None, DAY)
    assert (get(kg, "co:zara-shipholding")["s"], get(kg, "co:zara-shipholding")["lists"]) == (
        "blocked", [["US", "", "2024-08-23"]])
    ids = {n["id"] for n in compact(fleet, DAY)["nodes"]}
    assert not ids & {"co:zara-shipholding", "cc:ae"}
