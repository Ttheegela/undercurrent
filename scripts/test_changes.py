import json
import random

import pytest

import kg_build
from changes import diff, summarize, update_record
from fleet_merge import edge_id, generic_id
from lists import LISTS

DAY = "2026-10-20"
UK_URL = "https://search-uk-sanctions-list.service.gov.uk/designations/RUS3483/Ship"
EU_URL = "https://www.opensanctions.org/entities/NK-k837moN9ssPZedvkRUrexG/"
EU_FILE = "EU Official Journal, via OpenSanctions"
ZULU = "co:zulu-ships-management"
TASSOS = "IMO9408695"
ADISA = "IMO9341279"
REAL = "co:real-ltd"


@pytest.fixture(autouse=True)
def no_config_exclusions(tmp_path, monkeypatch):
    cfg = tmp_path / "clients.json"  # keeps every test off the real data/lobbying-clients.json
    cfg.write_text(json.dumps({"exclude_lobbyists": []}), encoding="utf-8")
    monkeypatch.setattr(kg_build, "CONFIG", cfg)


# ---- the shadow-fleet map: merge()'s long form ----------------------------------------------------

def fnode(nid, type_, name, layer="official", **kw):
    return {"id": nid, "type": type_, "name": name, "layer": layer, "listed_by": [], "programs": [], **kw}


def fedge(s, t, type_, layer="official", url=None, file="UK Sanctions List", **kw):
    src = {"url": url or f"https://example.gov/{s}/{t}/{type_}", "file": file, "quote": "q", "record": "r",
           "angle": "lists", "confidence": "Documented"}
    return {"id": edge_id(s, t, type_), "source": s, "target": t, "type": type_, "layer": layer, "sources": [src], **kw}


def fleet(*parts):
    """Nodes and edges, in any order: a dict with "id" and "type" and no "source" is a node."""
    return {"nodes": [p for p in parts if "source" not in p], "edges": [p for p in parts if "source" in p], "meta": {}}


def ship(nid=TASSOS, name="TASSOS", listed_by=("uk",), **kw):
    return fnode(nid, "ship", name, imo=nid[3:], listed_by=list(listed_by), **kw)


def listing(nid, gov, url=UK_URL, file="UK Sanctions List"):
    return fedge(nid, "gov:" + gov, "designated_by", url=url, file=file)


GOV_NODES = [fnode("gov:" + g, "government", g.upper()) for g in ("eu", "uk", "us")]
ZULU_NODE = fnode(ZULU, "company", "Zulu Ships Management", name_policy="show")


def only(changes):
    assert len(changes) == 1, changes
    return changes[0]


def test_first_run_is_baseline_without_changes():
    g = fleet(ship(), listing(TASSOS, "uk"), *GOV_NODES)
    assert diff(None, g, "fleet", DAY, set()) == []
    assert diff(None, {"meta": {}, "nodes": [], "edges": []}, "lobby", DAY, set()) == []
    record = update_record(None, DAY, [], {"uk": "fresh", "us": "fresh"})
    assert record["started"] == DAY
    assert record["days"] == [{"date": DAY, "sources": {"uk": "fresh", "us": "fresh"}, "changes": []}]


def test_added_and_removed_ship():
    prev = fleet(ship(ADISA, "ADISA", ["eu"]), listing(ADISA, "eu", EU_URL, EU_FILE), *GOV_NODES)
    curr = fleet(ship(), listing(TASSOS, "uk"), *GOV_NODES)
    added, removed = diff(prev, curr, "fleet", DAY, set())  # sorted by (graph, kind, id): added first
    assert (added["kind"], added["item"], added["id"], added["name"], added["node_type"]) == (
        "added", "node", TASSOS, "TASSOS", "ship")
    assert added["summary"] == "UK listed TASSOS (IMO 9408695)"
    assert (added["date"], added["graph"], added["source_url"], added["source_label"]) == (
        DAY, "fleet", UK_URL, "UK Sanctions List")
    assert (removed["kind"], removed["id"]) == ("removed", ADISA)
    assert removed["summary"] == "EU removed ADISA (IMO 9341279)"
    assert (removed["source_url"], removed["source_label"]) == (EU_URL, EU_FILE)  # yesterday's source


def test_new_and_removed_link():
    base = [ship(), ZULU_NODE, listing(TASSOS, "uk"), *GOV_NODES]
    with_link = fleet(*base, fedge(ZULU, TASSOS, "manages", url="https://example.gov/zulu"))
    new = only(diff(fleet(*base), with_link, "fleet", DAY, set()))
    assert (new["kind"], new["item"], new["id"], new["node_type"]) == ("added", "edge", edge_id(ZULU, TASSOS, "manages"),
                                                                       "manages")
    assert new["endpoints"] == ["Zulu Ships Management", "TASSOS"]  # [source, target]
    assert new["summary"] == "New link: TASSOS → Zulu Ships Management (managed by)"
    assert (new["source_url"], new["source_label"]) == ("https://example.gov/zulu", "UK Sanctions List")
    gone = only(diff(with_link, fleet(*base), "fleet", DAY, set()))
    assert (gone["kind"], gone["summary"]) == ("removed", "Link removed: TASSOS → Zulu Ships Management (managed by)")


def test_edge_change_carries_endpoint_ids():
    base = [ship(), ZULU_NODE, listing(TASSOS, "uk"), *GOV_NODES]
    with_link = fleet(*base, fedge(ZULU, TASSOS, "manages"))
    added = only(diff(fleet(*base), with_link, "fleet", DAY, set()))
    assert (added["endpoints"], added["endpoint_ids"]) == (["Zulu Ships Management", "TASSOS"], [ZULU, TASSOS])
    assert only(diff(with_link, fleet(*base), "fleet", DAY, set()))["endpoint_ids"] == [ZULU, TASSOS]
    # a company that is generic today is known by its published id, never the one that spelled its name
    gen = generic_id(REAL)
    shown = fnode(REAL, "company", "Real Ltd", name_policy="show")
    generic = fnode(gen, "company", "unlisted ship manager", name_policy="generic", generic_name="unlisted ship manager")
    prev = fleet(*base, shown, fedge(REAL, TASSOS, "owns", url="https://example.gov/owns"))
    gone = only(diff(prev, fleet(*base, generic), "fleet", DAY, set()))
    assert gone["endpoint_ids"] == [gen, TASSOS] and REAL not in json.dumps(gone)
    new = only(diff(fleet(*base), fleet(*base, generic, fedge(gen, TASSOS, "owns")), "fleet", DAY, set())[1:])
    assert new["endpoint_ids"] == [gen, TASSOS]
    # and on the network, where a lobby link can end on a fleet-layer company
    hired = only(diff(kg(NS2, CAPITOL), kg(NS2 | {"L": "fleet"}, CAPITOL, kedge(NS2["id"], CAPITOL["id"], "hired")),
                      "lobby", DAY, set()))
    assert hired["endpoint_ids"] == [NS2["id"], CAPITOL["id"]]


def test_designations_flags_and_registrations_are_not_links():
    nodes = [ship(), ZULU_NODE, *GOV_NODES, fnode("cc:lr", "country", "Liberia"), listing(TASSOS, "uk")]
    curr = fleet(*nodes, listing(TASSOS, "us"), fedge(TASSOS, "cc:lr", "flagged_in"), fedge(ZULU, "cc:lr", "registered_in"))
    assert diff(fleet(*nodes), curr, "fleet", DAY, set()) == []  # the node's own fields carry these facts


def test_listing_added_to_a_ship():
    prev = fleet(ship(listed_by=["uk"]), listing(TASSOS, "uk"), *GOV_NODES)
    curr = fleet(ship(listed_by=["uk", "us"]), listing(TASSOS, "uk"), listing(TASSOS, "us", "https://ofac/1", "US CSL"),
                 *GOV_NODES)
    c = only(diff(prev, curr, "fleet", DAY, set()))
    assert (c["kind"], c["item"], c["field"], c["to"], c.get("from")) == ("changed", "node", "listed_by", ["US"], None)
    assert c["summary"] == "US listed TASSOS (IMO 9408695)"
    assert (c["source_url"], c["source_label"]) == ("https://ofac/1", "US CSL")
    gone = only(diff(curr, prev, "fleet", DAY, set()))
    assert (gone["field"], gone["from"], gone["summary"]) == ("listed_by", ["US"], "US removed TASSOS (IMO 9408695)")
    assert gone["source_url"] == "https://ofac/1"  # yesterday's source for a removal


def test_flag_change():
    prev = fleet(ship(flag_now="lr"), listing(TASSOS, "uk"), *GOV_NODES)
    curr = fleet(ship(flag_now="cm"), listing(TASSOS, "uk"), *GOV_NODES)
    c = only(diff(prev, curr, "fleet", DAY, set()))
    assert (c["kind"], c["field"], c["from"], c["to"]) == ("changed", "flag_now", "Liberia", "Cameroon")
    assert c["summary"] == "TASSOS changed flag: Liberia → Cameroon"
    assert c["source_url"] == UK_URL  # the ship's own designation
    assert diff(fleet(ship()), curr, "fleet", DAY, set()) == []  # a flag only just given is not a re-flagging


def test_rename_and_programmes():
    prev = fleet(ship(name="OLD STAR", programs=["russia"]), listing(TASSOS, "uk"), *GOV_NODES)
    curr = fleet(ship(name="TASSOS", programs=["iran", "russia"]), listing(TASSOS, "uk"), *GOV_NODES)
    renamed, programmes = diff(prev, curr, "fleet", DAY, set())
    assert renamed["summary"] == "Renamed: OLD STAR → TASSOS (IMO 9408695)"
    assert programmes["summary"] == "TASSOS changed programmes: russia → iran, russia"
    assert diff(fleet(ship(name="TASSOS")), fleet(ship(name="Tassos")), "fleet", DAY, set()) == []  # spelling only
    assert diff(fleet(ship()), fleet(ship(programs=["russia"])), "fleet", DAY, set()) == []  # not known before
    assert diff(fleet(ship(programs=["russia"])), fleet(ship()), "fleet", DAY, set()) == []  # nor after


def test_research_items_never_change():
    prev = fleet(ship(ADISA, "ADISA", layer="research", flag_now="pa"), ZULU_NODE | {"layer": "research"},
                 fedge(ZULU, ADISA, "manages", layer="research"))
    curr = fleet(ship(ADISA, "ADISA", layer="research", flag_now="cm"),
                 ship(layer="research"), fnode("co:new", "company", "New Co", layer="research"),
                 fedge("co:new", TASSOS, "owns", layer="research"))
    assert diff(prev, curr, "fleet", DAY, set()) == []
    assert diff(curr, prev, "fleet", DAY, set()) == []


def test_delisted_ship_that_research_keeps_is_a_listing_change_not_a_removal():
    prev = fleet(ship(ADISA, "ADISA", ["eu"]), listing(ADISA, "eu", EU_URL, EU_FILE), *GOV_NODES)
    stub = fnode(ADISA, "ship", ADISA, layer="research", listed_by=[])  # a cited ship stays as a stub named by its id
    c = only(diff(prev, fleet(stub, *GOV_NODES), "fleet", DAY, set()))
    assert (c["kind"], c["field"], c["name"], c["summary"]) == ("changed", "listed_by", "ADISA",
                                                                 "EU removed ADISA (IMO 9341279)")


def test_research_known_ship_newly_listed_is_reported():
    known = ship(ADISA, "ADISA", [], layer="research")  # on the map since 25 Sep as research, on no list
    prev = fleet(known, ZULU_NODE, fedge(ZULU, ADISA, "owns", layer="research"), *GOV_NODES)
    curr = fleet(ship(ADISA, "ADISA", ["uk"]), ZULU_NODE, fedge(ZULU, ADISA, "owns", layer="research"),
                 listing(ADISA, "uk"), *GOV_NODES)
    c = only(diff(prev, curr, "fleet", DAY, set()))
    assert (c["kind"], c["field"], c["to"], c["summary"]) == ("changed", "listed_by", ["UK"], "UK listed ADISA (IMO 9341279)")
    assert (c["source_url"], c["source_label"]) == (UK_URL, "UK Sanctions List")  # its official designation
    assert diff(prev, curr, "fleet", DAY, {"uk"}) == []  # the UK list failed
    # a node on both days is compared whatever its layer, by the merged listed_by
    both = fleet(fnode("co:acme", "company", "Acme", layer="research", listed_by=["eu"]))
    assert only(diff(fleet(fnode("co:acme", "company", "Acme", layer="research")), both, "fleet", DAY, set()))[
        "summary"] == "EU listed Acme"


def test_research_known_ship_delisted_is_reported():
    known = ship(ADISA, "ADISA", [], layer="research")
    prev = fleet(ship(ADISA, "ADISA", ["uk"]), ZULU_NODE, fedge(ZULU, ADISA, "owns", layer="research"),
                 listing(ADISA, "uk"), *GOV_NODES)
    curr = fleet(known, ZULU_NODE, fedge(ZULU, ADISA, "owns", layer="research"), *GOV_NODES)
    c = only(diff(prev, curr, "fleet", DAY, set()))
    assert (c["kind"], c["field"], c["from"], c["summary"]) == ("changed", "listed_by", ["UK"],
                                                                "UK removed ADISA (IMO 9341279)")
    assert (c["source_url"], c["source_label"]) == (UK_URL, "UK Sanctions List")  # yesterday's designation
    assert diff(prev, curr, "fleet", DAY, {"uk"}) == []


def test_kept_previous_source_records_no_changes():
    uk_only = [ship(ADISA, "ADISA", ["uk"]), listing(ADISA, "uk")]
    both = [ship(listed_by=["uk", "us"]), listing(TASSOS, "uk"), listing(TASSOS, "us", "https://ofac/1", "US CSL")]
    prev = fleet(*uk_only, *both, ZULU_NODE, fedge(ZULU, ADISA, "operates"), *GOV_NODES)
    curr = fleet(ship(listed_by=["us"]), listing(TASSOS, "us", "https://ofac/1", "US CSL"), ZULU_NODE, *GOV_NODES)
    assert diff(prev, curr, "fleet", DAY, {"uk"}) == []  # the UK list failed: nothing it carried was delisted
    summaries = {c["summary"] for c in diff(prev, curr, "fleet", DAY, set())}
    assert summaries == {"UK removed ADISA (IMO 9341279)", "UK removed TASSOS (IMO 9408695)",
                         "Link removed: ADISA → Zulu Ships Management (operated by)"}
    record = update_record(None, DAY, [], {"uk": "unavailable", "us": "fresh"})
    assert record["days"][0]["sources"]["uk"] == "unavailable"


def test_link_from_a_failed_list_is_not_removed():
    link = fedge(ZULU, TASSOS, "linked_to", url="https://ofac/1", file="OFAC SDN list, via OpenSanctions")
    prev = fleet(ship(), ZULU_NODE, link, *GOV_NODES)
    curr = fleet(ship(), ZULU_NODE, *GOV_NODES)
    assert diff(prev, curr, "fleet", DAY, {"us"}) == []
    assert only(diff(prev, curr, "fleet", DAY, {"uk"}))["summary"] == (
        "Link removed: TASSOS → Zulu Ships Management (linked to)")


def test_only_available_governments_are_reported():
    prev = fleet(ship(listed_by=["uk", "us"]), listing(TASSOS, "uk"), listing(TASSOS, "us", "https://ofac/1", "US CSL"),
                 *GOV_NODES)
    gone = fleet(*GOV_NODES)
    assert only(diff(prev, gone, "fleet", DAY, {"uk"}))["summary"] == "US removed TASSOS (IMO 9408695)"
    assert diff(prev, gone, "fleet", DAY, {"uk", "us"}) == []
    assert only(diff(gone, prev, "fleet", DAY, {"uk"}))["summary"] == "US listed TASSOS (IMO 9408695)"


def test_opensanctions_id_churn_is_not_a_change():
    def day(entity):
        record = "OpenSanctions NK-" + entity
        return fleet(ship(ADISA, "ADISA", ["eu"]), ZULU_NODE, *GOV_NODES,
                     fedge(ADISA, "gov:eu", "designated_by", url=f"https://www.opensanctions.org/entities/NK-{entity}/",
                           file=EU_FILE, record=record, quote="Article 3s"),
                     fedge(ZULU, ADISA, "operates", url=f"https://www.opensanctions.org/entities/NK-{entity}/",
                           file=EU_FILE, record=record))
    assert diff(day("abc"), day("xyz"), "fleet", DAY, set()) == []


def test_kg_only_company_is_not_a_fleet_change():
    hidden = fnode("co:zara", "company", "Zara Shipholding", kg_only=True, listed_by=["us"])
    curr = fleet(hidden, fnode("cc:ae", "country", "UAE"), listing("co:zara", "us"),
                 fedge("co:zara", "cc:ae", "registered_in"), *GOV_NODES)
    assert diff(fleet(*GOV_NODES), curr, "fleet", DAY, set()) == []


def test_generic_company_is_named_by_its_generic_name():
    gen = generic_id(REAL)
    node = fnode(gen, "company", "unlisted Kazakhstan ship manager", name_policy="generic",
                 generic_name="unlisted Kazakhstan ship manager")
    base = [ship(), listing(TASSOS, "uk"), *GOV_NODES]
    changes = diff(fleet(*base), fleet(*base, node, fedge(gen, TASSOS, "manages")), "fleet", DAY, set())
    link, added = sorted(changes, key=lambda c: c["item"])
    assert added["summary"] == "New company: unlisted Kazakhstan ship manager"
    assert link["endpoints"] == ["unlisted Kazakhstan ship manager", "TASSOS"]
    assert link["summary"] == "New link: TASSOS → unlisted Kazakhstan ship manager (managed by)"


def test_company_turning_generic_is_not_removed_and_its_old_name_stays_out():
    gen = generic_id(REAL)
    shown = fnode(REAL, "company", "Real Ltd", name_policy="show")  # named by an official record, not listed
    generic = fnode(gen, "company", "unlisted ship manager", name_policy="generic", generic_name="unlisted ship manager")
    base = [ship(), listing(TASSOS, "uk"), *GOV_NODES]
    prev = fleet(*base, shown, fedge(REAL, TASSOS, "manages"))
    # same firm, same link, new id: not a removal plus an addition, and not a rename
    assert diff(prev, fleet(*base, generic, fedge(gen, TASSOS, "manages")), "fleet", DAY, set()) == []
    # its link is gone too: the removal is worded with today's generic name, never the real one
    changes = diff(prev, fleet(*base, generic), "fleet", DAY, set())
    assert "Real Ltd" not in json.dumps(changes)
    assert only(changes)["endpoints"] == ["unlisted ship manager", "TASSOS"]


def test_generic_company_that_gets_named_is_one_listing_change():
    gen = generic_id(REAL)
    generic = fnode(gen, "company", "unlisted ship manager", name_policy="generic", generic_name="unlisted ship manager")
    shown = fnode(REAL, "company", "Real Ltd", name_policy="show", listed_by=["us"])
    base = [ship(), listing(TASSOS, "uk"), *GOV_NODES]
    prev = fleet(*base, generic, fedge(gen, TASSOS, "manages"))
    curr = fleet(*base, shown, listing(REAL, "us", "https://ofac/2", "US CSL"), fedge(REAL, TASSOS, "manages"))
    c = only(diff(prev, curr, "fleet", DAY, set()))
    assert (c["id"], c["summary"], c["source_url"]) == (REAL, "US listed Real Ltd", "https://ofac/2")


def test_source_falls_back_to_the_list_page():
    c = only(diff(fleet(*GOV_NODES), fleet(ship(), *GOV_NODES), "fleet", DAY, set()))
    assert (c["source_url"], c["source_label"]) == (LISTS["uk"]["page"], "United Kingdom sanctions list")


def test_excluded_person_never_appears():
    person = fnode("p:jane-roe", "person", "Jane Roe", listed_by=["us"])
    curr = fleet(ship(), person, fedge("p:jane-roe", TASSOS, "owns"), listing("p:jane-roe", "us"), *GOV_NODES)
    assert "Jane Roe" in json.dumps(diff(fleet(*GOV_NODES), curr, "fleet", DAY, set()))
    kept = diff(fleet(*GOV_NODES), curr, "fleet", DAY, set(), exclude=["Jane Roe"])
    assert [c["id"] for c in kept] == [TASSOS] and "Jane" not in json.dumps(kept)


# ---- the influence network: kg.json ---------------------------------------------------------------

def knode(nid, t, name, L="lobby", s="", lists=(), **info):
    return {"id": nid, "t": t, "n": name, "L": L, "g": "", "s": s, "lists": [list(x) for x in lists], "info": info,
            "notes": []}


def kedge(s, t, y, L="lobby", **kw):
    return {"s": s, "t": t, "y": y, "c": "D", "d": "2025", "u": "https://lda.gov/filings/public/filing/f1/print/",
            "r": "1 filing", "q": "", "L": L, **kw}


def kg(*parts):
    return {"meta": {}, "nodes": [p for p in parts if "id" in p], "edges": [p for p in parts if "id" not in p]}


NS2 = knode("co:nord-stream-2", "company", "Nord Stream 2 AG")
CAPITOL = knode("lf:capitol-counsel", "lobbyfirm", "Capitol Counsel LLC")


def test_new_lobbying_links_and_nodes():
    prev = kg(NS2)
    curr = kg(NS2, CAPITOL, knode("p:john-doe", "person", "John Doe"), knode("bill:eo1", "bill", "EO 14024"),
              knode("gov:us-senate", "government", "US Senate"),
              knode("co:sberbank", "company", "Sberbank", s="restricted", lists=[["US SSI", "", ""]]),  # hand-checked list
              kedge(NS2["id"], CAPITOL["id"], "hired"), kedge("p:john-doe", CAPITOL["id"], "lobbyist_at"),
              kedge(CAPITOL["id"], "bill:eo1", "lobbied_on"), kedge(CAPITOL["id"], "gov:us-senate", "lobbied"),
              kedge("p:john-doe", NS2["id"], "lobbied_for"))  # not one of the four reported types
    changes = diff(prev, curr, "lobby", DAY, set())
    assert {c["summary"] for c in changes} == {
        "Nord Stream 2 AG hired Capitol Counsel LLC", "John Doe is a lobbyist at Capitol Counsel LLC",
        "Capitol Counsel LLC lobbied on EO 14024", "Capitol Counsel LLC lobbied US Senate",
        "New lobbying firm: Capitol Counsel LLC", "New lobbyist: John Doe", "New bill: EO 14024",
        "New agency: US Senate", "New company: Sberbank"}
    hired = next(c for c in changes if c["node_type"] == "hired")
    assert (hired["graph"], hired["kind"], hired["item"], hired["id"]) == (
        "lobby", "added", "edge", edge_id(NS2["id"], CAPITOL["id"], "hired"))
    assert hired["endpoints"] == ["Nord Stream 2 AG", "Capitol Counsel LLC"]
    assert hired["source_url"] == "https://lda.gov/filings/public/filing/f1/print/"
    assert hired["source_label"]


def test_lobby_edges_and_nodes_never_removed():
    prev = kg(NS2, CAPITOL, knode("p:john-doe", "person", "John Doe"), kedge(NS2["id"], CAPITOL["id"], "hired"),
              kedge("p:john-doe", CAPITOL["id"], "lobbyist_at"))
    assert diff(prev, kg(NS2), "lobby", DAY, set()) == []  # a missing filing is a fetch gap


def test_excluded_lobbyist_never_appears(tmp_path, monkeypatch):
    cfg = tmp_path / "clients.json"
    cfg.write_text(json.dumps({"exclude_lobbyists": ["Jane Roe"]}), encoding="utf-8")
    monkeypatch.setattr(kg_build, "CONFIG", cfg)
    curr = kg(NS2, CAPITOL, knode("p:jane-roe", "person", "Jane Roe"), knode("p:rick-lee", "person", "Rick A. Lee"),
              knode("p:john-doe", "person", "John Doe"),
              kedge("p:jane-roe", CAPITOL["id"], "lobbyist_at"), kedge("p:rick-lee", CAPITOL["id"], "lobbyist_at"),
              kedge("p:john-doe", CAPITOL["id"], "lobbyist_at"))
    for extra in (None, ["Rick Lee"]):  # the config's names always apply; `exclude` adds the asset's own
        text = json.dumps(diff(kg(NS2, CAPITOL), curr, "lobby", DAY, set(), exclude=extra))
        assert "Jane" not in text and "jane-roe" not in text and "John Doe" in text
        assert ("Lee" in text) == (extra is None)


def test_lobbying_unavailable_skips_the_lobby_layer_only():
    ship_node = knode(TASSOS, "ship", "TASSOS", L="fleet", s="restricted", lists=[["UK", "", ""]], imo="9408695")
    prev = kg(knode(TASSOS, "ship", "TASSOS", L="fleet", s="blocked", lists=[["UK", "", ""]], imo="9408695"))
    curr = kg(NS2, CAPITOL, ship_node, kedge(NS2["id"], CAPITOL["id"], "hired"))
    assert len(diff(prev, curr, "lobby", DAY, set())) == 4  # two nodes, the link and the ship's new level
    assert [c["id"] for c in diff(prev, curr, "lobby", DAY, {"lobbying"})] == [TASSOS]
    bridge = kg(knode("co:a", "company", "A Ltd", L="fleet"), knode("co:b", "company", "B Ltd", L="fleet"),
                kedge("co:a", "co:b", "hired"))  # a lobby link between two fleet-layer companies is still lobbying
    assert diff(kg(knode("co:a", "company", "A Ltd", L="fleet"), knode("co:b", "company", "B Ltd", L="fleet")),
                bridge, "lobby", DAY, {"lobbying"}) == []


def ship_kg(s="restricted", lists=(("UK", "", "2024-09-26"),), flag="lr", extra=()):
    return kg(knode(TASSOS, "ship", "TASSOS", L="fleet", s=s, lists=lists, imo="9408695", flag_now=flag,
                    programs=["russia"]), knode(ZULU, "company", "Zulu", L="fleet"),
              kedge(ZULU, TASSOS, "manages", L="fleet", u="https://example.gov/z", f="UK Sanctions List"), *extra)


def test_status_changes_on_the_network():
    prev, curr = ship_kg("blocked"), ship_kg("restricted")
    c = only(diff(prev, curr, "lobby", DAY, set()))
    assert (c["graph"], c["kind"], c["field"], c["from"], c["to"]) == ("lobby", "changed", "status", "blocked", "restricted")
    assert c["summary"] == "TASSOS changed status: blocked → restricted"
    assert (c["source_url"], c["source_label"]) == (LISTS["uk"]["page"], "United Kingdom sanctions list")
    # the US list failed: the level it may have set is not today's news
    us_added = ship_kg("blocked", (("UK", "", ""), ("US SDN", "", "")))
    assert only(diff(curr, us_added, "lobby", DAY, set()))["field"] == "status"
    assert diff(curr, us_added, "lobby", DAY, {"us"}) == []


def test_new_listing_appears_once_across_graphs():
    # one night, seen by both graphs: TASSOS gains a US listing, a manager link and a new flag; NEWCOMER is listed
    prev_map = fleet(ship(flag_now="lr"), ZULU_NODE, listing(TASSOS, "uk"), *GOV_NODES)
    curr_map = fleet(ship(listed_by=["uk", "us"], flag_now="cm"), ship("IMO9000001", "NEWCOMER", ["us"]), ZULU_NODE,
                     listing(TASSOS, "uk"), listing(TASSOS, "us", "https://ofac/1", "US CSL"),
                     listing("IMO9000001", "us", "https://ofac/9", "US CSL"), fedge(ZULU, TASSOS, "manages"), *GOV_NODES)
    newcomer = knode("IMO9000001", "ship", "NEWCOMER", L="fleet", lists=[["US", "", ""]], imo="9000001")
    prev_net = ship_kg()
    curr_net = ship_kg(lists=(("UK", "", ""), ("US SDN", "", "")), flag="cm", extra=(
        newcomer, kedge(ZULU, "IMO9000001", "operates", L="fleet")))
    on_map = diff(prev_map, curr_map, "fleet", DAY, set())
    assert {c["summary"] for c in on_map} == {
        "US listed TASSOS (IMO 9408695)", "TASSOS changed flag: Liberia → Cameroon", "US listed NEWCOMER (IMO 9000001)",
        "New link: TASSOS → Zulu Ships Management (managed by)"}
    assert diff(prev_net, curr_net, "lobby", DAY, set()) == []  # the fleet layer is the map's to report
    assert diff(curr_net, prev_net, "lobby", DAY, set()) == []  # nor is a delisting
    # the network keeps only what the map cannot say: the level
    assert [c["summary"] for c in diff(prev_net, ship_kg("blocked", flag="cm", extra=(newcomer,)), "lobby", DAY, set())] == [
        "TASSOS changed status: restricted → blocked"]


def test_network_ignores_team_and_curated_links_and_company_that_changes_sides():
    prev = kg(knode("co:gazprom", "company", "Gazprom", L="lobby"), knode(ZULU, "company", "Zulu", L="fleet"),
              kedge("co:gazprom", ZULU, "linked_to", L="curated"))
    curr = kg(knode("co:gazprom", "company", "Gazprom", L="fleet", lists=[["US", "", ""]]),
              knode(ZULU, "company", "Zulu", L="fleet"), kedge("co:gazprom", ZULU, "linked_to", L="team"))
    assert diff(prev, curr, "lobby", DAY, set()) == []


# ---- summaries and the record ---------------------------------------------------------------------

def change(**kw):
    return {"date": DAY, "graph": "fleet", "kind": "added", "item": "node", "id": TASSOS, "name": "TASSOS",
            "node_type": "ship", "source_url": "", "source_label": "", **kw}


def test_summaries_have_the_fixed_forms():
    assert summarize(change(field="listed_by", to=["UK"])) == "UK listed TASSOS (IMO 9408695)"
    assert summarize(change(kind="removed", id=ADISA, name="ADISA", field="listed_by", **{"from": ["EU"]})) == (
        "EU removed ADISA (IMO 9341279)")
    assert summarize(change(field="listed_by", to=["EU", "UK", "US"])) == "EU, UK and US listed TASSOS (IMO 9408695)"
    assert summarize(change(item="edge", node_type="manages", endpoints=["Zulu Ships Management", "TASSOS"])) == (
        "New link: TASSOS → Zulu Ships Management (managed by)")
    assert summarize(change(kind="changed", field="flag_now", **{"from": "Liberia", "to": "Cameroon"})) == (
        "TASSOS changed flag: Liberia → Cameroon")
    assert summarize(change(graph="lobby", item="edge", node_type="hired",
                            endpoints=["Nord Stream 2 AG", "Capitol Counsel LLC"])) == (
        "Nord Stream 2 AG hired Capitol Counsel LLC")


def test_unknown_graph_is_an_error():
    with pytest.raises(ValueError):
        diff(None, {}, "chat", DAY, set())


def test_changes_are_deterministic():
    prev = fleet(ship(ADISA, "ADISA", ["eu"]), ship(flag_now="lr"), ZULU_NODE, listing(ADISA, "eu", EU_URL, EU_FILE),
                 listing(TASSOS, "uk"), fedge(ZULU, ADISA, "operates"), *GOV_NODES)
    curr = fleet(ship(flag_now="cm", listed_by=["uk", "us"]), ship("IMO9000001", "NEWCOMER", ["us"]), ZULU_NODE,
                 listing(TASSOS, "uk"), listing(TASSOS, "us", "https://ofac/1", "US CSL"),
                 listing("IMO9000001", "us", "https://ofac/9", "US CSL"), fedge(ZULU, TASSOS, "manages"), *GOV_NODES)
    first = diff(prev, curr, "fleet", DAY, set())
    assert len(first) >= 5
    assert json.dumps(first, sort_keys=True) == json.dumps(diff(prev, curr, "fleet", DAY, set()), sort_keys=True)
    keys = [(c["graph"], c["kind"], c["id"]) for c in first]
    assert keys == sorted(keys)
    shuffled = {k: random.Random(1).sample(v, len(v)) if isinstance(v, list) else v for k, v in curr.items()}
    assert diff(prev, shuffled, "fleet", DAY, set()) == first  # input order does not matter


def test_record_trims_and_replaces_same_day():
    record = None
    for day in range(1, 11):
        record = update_record(record, f"2026-10-{day:02d}", [change(summary=str(day))], {"uk": "fresh"}, keep_days=5)
    assert [d["date"] for d in record["days"]] == ["2026-10-10", "2026-10-09", "2026-10-08", "2026-10-07", "2026-10-06"]
    assert record["started"] == "2026-10-06"  # days before the oldest one held cannot be answered
    again = update_record(record, "2026-10-08", [], {"uk": "unavailable"}, keep_days=5)  # a re-run replaces its day
    assert [d["date"] for d in again["days"]] == [d["date"] for d in record["days"]]
    assert next(d for d in again["days"] if d["date"] == "2026-10-08") == {
        "date": "2026-10-08", "sources": {"uk": "unavailable"}, "changes": []}
    assert again["days"][0] == record["days"][0]
    assert record["days"][2]["changes"][0]["summary"] == "8"  # (input record is left as it was)


def test_record_keeps_its_first_day_while_it_fits():
    record = update_record(None, "2026-10-19", [], {})
    record = update_record(record, "2026-10-20", [change(summary="x")], {"uk": "fresh"})
    assert record["started"] == "2026-10-19" and [d["date"] for d in record["days"]] == ["2026-10-20", "2026-10-19"]
    assert update_record(record, "2026-10-19", [], {}) == record  # idempotent
