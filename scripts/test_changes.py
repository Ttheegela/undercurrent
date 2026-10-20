import csv
import io
import json
import random
import shutil
from pathlib import Path

import pytest

import fleet_official as fo
import kg_build
from changes import diff, summarize, update_record
from fleet_merge import compact, edge_id, generic_id, merge
from kg_build import build_kg
from lists import LISTS

FIX = Path(__file__).parent / "fixtures" / "fleet"
DOWNLOADS = {fo.OS_EU_JOURNAL: "os_eu_journal_sample.csv", fo.OS_OFAC: "os_ofac_sample.csv"}

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


def map_on(tmp_path, night, drop=(), research=(), known=None):
    """A night's merged long form, through the real build_official and merge, on a night when the US list no longer
    carries the rows named in `drop` (vessels, here)."""
    raw = tmp_path / night
    raw.mkdir()
    shutil.copy(FIX / "uk_sample.csv", raw / "uk.csv")
    rows = list(csv.DictReader(io.StringIO((FIX / "csl_sample.csv").read_text(encoding="utf-8-sig"))))
    with open(raw / "us.csv", "w", newline="", encoding="utf-8") as f:
        out = csv.DictWriter(f, fieldnames=list(rows[0]))
        out.writeheader()
        out.writerows(r for r in rows if r["name"] not in drop)
    official = fo.build_official(raw, fetch=lambda url: (FIX / DOWNLOADS[url]).read_text(encoding="utf-8"))
    base = {"nodes": [], "edges": list(research), "node_fields": {}, "meta": {}, "generated": "2026-09-25",
            "known_names": known or {}}
    return merge(base, official, aliases={}, eu_records=[])


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


def payload_ready(graph):
    """The long form as merge() leaves it for compact(): every link has its confidence."""
    return dict(graph, edges=[{"confidence": "Documented", **e} for e in graph["edges"]])


def test_page_finds_a_changed_link_by_its_ends():
    """The map's payload has no edge ids, so the page matches a change's link on (endpoint_ids[0], endpoint_ids[1], node_type)
    against the payload's (s, t, y)."""
    base = [ship(), ZULU_NODE, listing(TASSOS, "uk"), *GOV_NODES]
    now = fleet(*base, fedge(ZULU, TASSOS, "manages"))
    added = only(diff(fleet(*base), now, "fleet", DAY, set()))
    links = [(e["s"], e["t"], e["y"]) for e in compact(payload_ready(now), DAY)["edges"]]
    assert (*added["endpoint_ids"], added["node_type"]) in links and len(links) == len(set(links))
    # a company that is generic today: the payload and the change both carry the published id
    gen = generic_id(REAL)
    generic = fnode(gen, "company", "unlisted ship manager", name_policy="generic", generic_name="unlisted ship manager")
    now = fleet(*base, generic, fedge(gen, TASSOS, "owns"))
    new = only([c for c in diff(fleet(*base), now, "fleet", DAY, set()) if c["item"] == "edge"])
    assert (*new["endpoint_ids"], new["node_type"]) in [(e["s"], e["t"], e["y"]) for e in compact(payload_ready(now), DAY)["edges"]]


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
    # the record that named the company is not cited for a company we no longer name: the list's page is
    assert (gone["source_url"], gone["source_label"]) == (LISTS["uk"]["page"], "United Kingdom sanctions list")
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


def test_cosmetic_respelling_is_not_a_rename():
    def company(name):
        return fleet(fnode("co:orchid-shipmanagement", "company", name, name_policy="show", listed_by=["us"]),
                     listing("co:orchid-shipmanagement", "us"), *GOV_NODES)
    # whichever vessel record names a company decides how it is spelled: a vessel leaving can flip it
    assert diff(company("Orchid Ship management LLC-FZ"), company("Orchid Shipmanagement LLC-FZ"), "fleet", DAY,
                set()) == []
    assert diff(company("Orchid Shipmanagement Ltd"), company("Orchid Shipmanagement Limited"), "fleet", DAY, set()) == []
    assert diff(company("Fleet Tanqo Pvt Ltd"), company("FLEET TANQO PRIVATE LIMITED"), "fleet", DAY, set()) == []
    assert diff(company("Orchid Maritime Sdn Bhd"), company("Orchid Maritime"), "fleet", DAY, set()) == []
    assert diff(fleet(ship(name="OCEAN 28")), fleet(ship(name="Ocean-28")), "fleet", DAY, set()) == []
    assert only(diff(company("Orchid Ship management LLC-FZ"), company("Orchid Maritime LLC-FZ"), "fleet", DAY, set()))[
        "summary"] == "Renamed: Orchid Ship management LLC-FZ → Orchid Maritime LLC-FZ"


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


def test_company_leaving_map_is_not_a_delisting(tmp_path):
    # TRANS-FLOT JSC (on the US list) and ARTEMOV (a listed person) are on the map only while a listed vessel names them
    today = map_on(tmp_path, "today")
    gone = diff(today, map_on(tmp_path, "tomorrow", drop={"MARSHAL ZHUKOV", "ZEPHYR I"}), "fleet", DAY, set())
    summaries = {c["summary"] for c in gone}
    assert {"US removed MARSHAL ZHUKOV (IMO 9690224)", "US removed ZEPHYR I (IMO 9255880)"} <= summaries  # real delistings
    assert {"No longer on the map: TRANS-FLOT JSC", "No longer on the map: ARTEMOV, Viktor Sergiyovich"} <= summaries
    assert not [c for c in gone if c["id"] in ("co:trans-flot", "p:artemov-viktor-sergiyovich") and "field" in c]
    assert not [x for x in summaries if "removed TRANS-FLOT" in x or "removed ARTEMOV" in x]


def test_company_joining_map_is_not_a_listing(tmp_path):
    # the other way round (Gazprom and Novatek on 25 Sep): the lists did not change, a vessel just names the firm now
    before = map_on(tmp_path, "before", drop={"MARSHAL ZHUKOV", "ZEPHYR I"})
    came = diff(before, map_on(tmp_path, "after"), "fleet", DAY, set())
    summaries = {c["summary"] for c in came}
    assert {"US listed MARSHAL ZHUKOV (IMO 9690224)", "New on the map: TRANS-FLOT JSC"} <= summaries
    assert not [x for x in summaries if "listed TRANS-FLOT" in x or "listed ARTEMOV" in x]
    new = next(c for c in came if c["id"] == "co:trans-flot")
    assert (new["kind"], "field" in new, new["source_url"]) == ("added", False, new["source_url"]) and new["source_url"]


def kept_by_research():
    """A research link that keeps TRANS-FLOT JSC on the map after the vessel that names it is gone: (links, names)."""
    cite = {"url": "https://home.treasury.gov/news/x", "file": "study.csv", "quote": "q", "record": "",
            "angle": "studies", "confidence": "Documented"}
    held = {"source": "co:trans-flot", "target": "co:sovfracht", "type": "controls", "date": "", "source_url": cite["url"],
            "source_file": cite["file"], "quote": "q", "record": "", "angle": "studies", "confidence": "Documented",
            "sources": [cite]}
    return [held], {"co:trans-flot": ["TRANS-FLOT JSC"]}


def test_research_company_no_longer_looked_up_is_not_a_delisting(tmp_path):
    # research keeps TRANS-FLOT JSC on the map once the vessel is gone, but nothing looks it up in the lists any more
    held, known = kept_by_research()
    today = map_on(tmp_path, "today", research=held, known=known)
    tomorrow = map_on(tmp_path, "tomorrow", drop={"MARSHAL ZHUKOV"}, research=held, known=known)
    assert next(n for n in tomorrow["nodes"] if n["id"] == "co:trans-flot")["layer"] == "research"
    gone = diff(today, tomorrow, "fleet", DAY, set())
    assert "US removed MARSHAL ZHUKOV (IMO 9690224)" in {c["summary"] for c in gone}
    assert not [c for c in gone if c["item"] == "node" and c["id"] == "co:trans-flot"]
    assert not [c for c in gone if "TRANS-FLOT" in c["summary"] and "removed" in c["summary"] and c["item"] == "node"]


def test_research_known_ship_newly_listed_is_reported():
    known = ship(ADISA, "ADISA", [], layer="research")  # on the map since 25 Sep as research, on no list
    prev = fleet(known, ZULU_NODE, fedge(ZULU, ADISA, "owns", layer="research"), *GOV_NODES)
    curr = fleet(ship(ADISA, "ADISA", ["uk"]), ZULU_NODE, fedge(ZULU, ADISA, "owns", layer="research"),
                 listing(ADISA, "uk"), *GOV_NODES)
    c = only(diff(prev, curr, "fleet", DAY, set()))
    assert (c["kind"], c["field"], c["to"], c["summary"]) == ("changed", "listed_by", ["UK"],
                                                              "UK listed ADISA (IMO 9341279)")
    assert (c["source_url"], c["source_label"]) == (UK_URL, "UK Sanctions List")  # its official designation
    assert diff(prev, curr, "fleet", DAY, {"uk"}) == []  # the UK list failed
    # a ship on both days is compared whatever its layer, by the merged listed_by
    both = fleet(ship(ADISA, "ADISA", ["eu"], layer="research"))
    assert only(diff(fleet(ship(ADISA, "ADISA", [], layer="research")), both, "fleet", DAY, set()))[
        "summary"] == "EU listed ADISA (IMO 9341279)"
    # a company is not: it is looked up in the lists only while it is official
    acme = fnode("co:acme", "company", "Acme", layer="research")
    assert diff(fleet(acme), fleet(dict(acme, listed_by=["eu"])), "fleet", DAY, set()) == []


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
    assert added["summary"] == "New on the map: unlisted Kazakhstan ship manager"
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


def test_fallback_to_another_list_is_not_a_rename():
    # UK and US drop TANI and the EU record, which names it differently, becomes the name we show
    prev = fleet(ship("IMO9417464", "TANI", ["eu", "uk", "us"], flag_now="lr"), *GOV_NODES)
    curr = fleet(ship("IMO9417464", "ANIKA", ["eu"], flag_now="pa"), *GOV_NODES)
    assert only(diff(prev, curr, "fleet", DAY, set()))["summary"] == "UK and US removed ANIKA (IMO 9417464)"
    # a rename on a night the lists that rank first did not change is still a rename
    prev = fleet(ship("IMO9417464", "TANI", ["eu", "uk"]), *GOV_NODES)
    curr = fleet(ship("IMO9417464", "ANIKA", ["eu", "uk", "us"]), *GOV_NODES)
    assert "Renamed: TANI → ANIKA (IMO 9417464)" in {c["summary"] for c in diff(prev, curr, "fleet", DAY, set())}


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


def kedge(s, t, y, L="lobby", fl=None, fr=None, **kw):
    """A link's filings (`fl`) and those of them posted in the last 14 days (`fr`, all of them unless a test says)."""
    fl = fl or [edge_id(s, t, y)[2:10]]  # a filing of its own, unless the test says which
    fr = fl if fr is None else fr
    return {"s": s, "t": t, "y": y, "c": "D", "d": "2025", "u": "https://lda.gov/filings/public/filing/f1/print/",
            "r": "1 filing", "q": "", "L": L, **({"fl": fl, **({"fr": fr} if fr else {})} if L == "lobby" else {}), **kw}


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
              kedge("co:sberbank", CAPITOL["id"], "hired"),
              kedge(CAPITOL["id"], "bill:eo1", "lobbied_on"), kedge(CAPITOL["id"], "gov:us-senate", "lobbied"),
              kedge("p:john-doe", NS2["id"], "lobbied_for"))  # not one of the four reported types
    changes = diff(prev, curr, "lobby", DAY, set())
    assert {c["summary"] for c in changes} == {
        "Nord Stream 2 AG hired Capitol Counsel LLC", "John Doe is a lobbyist at Capitol Counsel LLC",
        "Capitol Counsel LLC lobbied on EO 14024", "Capitol Counsel LLC lobbied US Senate",
        "New lobbying firm: Capitol Counsel LLC", "New lobbyist: John Doe", "New bill: EO 14024",
        "New agency: US Senate", "New company: Sberbank", "Sberbank hired Capitol Counsel LLC"}
    # a US list outage says nothing of lobbying: the hand-checked US list entry on Sberbank is not its source
    assert {c["summary"] for c in diff(prev, curr, "lobby", DAY, {"us"})} == {c["summary"] for c in changes}
    hired = next(c for c in changes if c["id"] == edge_id(NS2["id"], CAPITOL["id"], "hired"))
    assert (hired["graph"], hired["kind"], hired["item"], hired["node_type"]) == ("lobby", "added", "edge", "hired")
    assert hired["endpoints"] == ["Nord Stream 2 AG", "Capitol Counsel LLC"]
    assert hired["source_url"] == "https://lda.gov/filings/public/filing/f1/print/"
    assert hired["source_label"]


def test_lda_registrant_rename_is_not_new_lobbying():
    def firm(fid, name, extra=()):
        return kg(NS2, knode(fid, "lobbyfirm", name), knode("p:john-doe", "person", "John Doe"),
                  kedge(NS2["id"], fid, "hired", fl=["aaaa1111", "bbbb2222", *extra]),
                  kedge("p:john-doe", fid, "lobbyist_at", fl=["aaaa1111"]))
    prev = firm("lf:miller-chevalier-chtd", "Miller & Chevalier Chtd")
    curr = firm("lf:miller-chevalier-chartered", "Miller & Chevalier Chartered")
    assert diff(prev, curr, "lobby", DAY, set()) == []  # the same filings under the firm's new name
    again = firm("lf:miller-chevalier-chartered", "Miller & Chevalier Chartered", extra=["cccc3333"])
    summaries = {c["summary"] for c in diff(prev, again, "lobby", DAY, set())}
    assert "Nord Stream 2 AG hired Miller & Chevalier Chartered" in summaries  # a filing nobody had seen is news
    assert not [x for x in summaries if "lobbyist" in x]  # its only filing is an old one


def test_returning_lobby_link_is_not_new():
    john = knode("p:john-doe", "person", "John Doe")
    prev = kg(NS2, CAPITOL, john, kedge("p:john-doe", CAPITOL["id"], "lobbyist_at", fl=["aaaa1111"]))
    back = kg(NS2, CAPITOL, john, kedge("p:john-doe", CAPITOL["id"], "lobbyist_at", fl=["aaaa1111"]),
              kedge(NS2["id"], CAPITOL["id"], "hired", fl=["aaaa1111"]))  # the link was out of yesterday's graph
    assert diff(prev, back, "lobby", DAY, set()) == []
    new = kg(NS2, CAPITOL, john, kedge("p:john-doe", CAPITOL["id"], "lobbyist_at", fl=["aaaa1111"]),
             kedge(NS2["id"], CAPITOL["id"], "hired", fl=["aaaa1111", "cccc3333"]))
    assert [c["summary"] for c in diff(prev, new, "lobby", DAY, set())] == ["Nord Stream 2 AG hired Capitol Counsel LLC"]


def test_returning_old_filing_is_not_new():
    john = knode("p:john-doe", "person", "John Doe")
    jane = knode("p:jane-roe", "person", "Jane Roe")
    prev = kg(NS2, CAPITOL, john, kedge("p:john-doe", CAPITOL["id"], "lobbyist_at", fl=["aaaa1111"]))
    # a filing posted 60 days ago is in today's graph and was not in yesterday's (a partial fetch yesterday, or a backfill):
    # its link, and a lobbyist who is only in it, are not news. The older filing on the link was there before anyway.
    back = kg(NS2, CAPITOL, john, jane, kedge("p:john-doe", CAPITOL["id"], "lobbyist_at", fl=["aaaa1111"]),
              kedge(NS2["id"], CAPITOL["id"], "hired", fl=["aaaa1111", "dddd4444"], fr=[]),
              kedge("p:jane-roe", CAPITOL["id"], "lobbyist_at", fl=["dddd4444"], fr=[]))
    assert diff(prev, back, "lobby", DAY, set()) == []


def test_new_recent_filing_is_new():
    john = knode("p:john-doe", "person", "John Doe")
    jane = knode("p:jane-roe", "person", "Jane Roe")
    prev = kg(NS2, CAPITOL, john, kedge("p:john-doe", CAPITOL["id"], "lobbyist_at", fl=["aaaa1111"]))
    now = kg(NS2, CAPITOL, john, jane, kedge("p:john-doe", CAPITOL["id"], "lobbyist_at", fl=["aaaa1111"]),
             kedge(NS2["id"], CAPITOL["id"], "hired", fl=["aaaa1111", "dddd4444"], fr=["dddd4444"]),  # posted 3 days ago
             kedge("p:jane-roe", CAPITOL["id"], "lobbyist_at", fl=["dddd4444"], fr=["dddd4444"]))
    assert {c["summary"] for c in diff(prev, now, "lobby", DAY, set())} == {
        "Nord Stream 2 AG hired Capitol Counsel LLC", "Jane Roe is a lobbyist at Capitol Counsel LLC",
        "New lobbyist: Jane Roe"}


def test_yesterday_without_filing_ids_cannot_say_what_lobbying_is_new():
    old = kedge(NS2["id"], CAPITOL["id"], "hired")
    del old["fl"]  # kg.json from before the change record: the first six filing ids of a link, not all of them
    prev = kg(NS2, CAPITOL, old, knode(TASSOS, "ship", "TASSOS", L="fleet", s="blocked", lists=[["US", "", ""]]))
    curr = kg(NS2, CAPITOL, knode("p:john-doe", "person", "John Doe"), kedge(NS2["id"], CAPITOL["id"], "hired"),
              kedge("p:john-doe", CAPITOL["id"], "lobbyist_at"),
              knode(TASSOS, "ship", "TASSOS", L="fleet", s="restricted", lists=[["US", "", ""]]))
    # a renamed registrant would read as new, so nothing is called new that night; the level still is reported
    assert [c["summary"] for c in diff(prev, curr, "lobby", DAY, set())] == ["TASSOS changed status: blocked → restricted"]


def test_client_person_is_not_called_a_lobbyist():
    curr = kg(NS2, CAPITOL, knode("p:oleg", "person", "Oleg Deripaska"), knode("p:john-doe", "person", "John Doe"),
              kedge("p:oleg", CAPITOL["id"], "hired"), kedge("p:john-doe", CAPITOL["id"], "lobbyist_at"))
    summaries = {c["summary"] for c in diff(kg(NS2), curr, "lobby", DAY, set())}
    assert {"New person: Oleg Deripaska", "New lobbyist: John Doe"} <= summaries


def test_kg_only_firm_listing_is_reported_on_the_network():
    def net(*governments, kg_only=True, level="blocked"):
        zara = knode("co:zara", "company", "Zara Shipholding", L="fleet", s=level, lists=[[g, "", ""] for g in governments])
        return kg(zara | ({"kg_only": True} if kg_only else {}))
    c = only(diff(net("US"), net("US", "UK"), "lobby", DAY, set()))
    assert (c["graph"], c["field"], c["to"], c["summary"]) == ("lobby", "listed_by", ["UK"], "UK listed Zara Shipholding")
    assert only(diff(net("US", "UK"), net("US"), "lobby", DAY, set()))["summary"] == "UK removed Zara Shipholding"
    assert diff(net("US"), net("US", "UK"), "lobby", DAY, {"uk"}) == []
    assert diff(net("US", kg_only=False), net("US", "UK", kg_only=False), "lobby", DAY, set()) == []  # the map's to report


def network_of(fleet_graph):
    asset = {"nodes": [], "edges": [], "filings_scanned": 0, "filings_kept": 0}
    base = {"nodes": [], "edges": [], "lob_alias": {}, "live_flags": {}, "status": {},
            "meta": {"no_lobbying_found": {"match": [], "names": []}, "live": None}}
    return build_kg(fleet_graph, asset, base, None, DAY)


def test_network_page_finds_a_changed_link_by_its_ends(tmp_path):
    """The network's payload has no edge ids, so the page matches a change's link on (endpoint_ids[0], endpoint_ids[1],
    node_type) against a link's (s, t, y): in the fleet layer (a change on graph "fleet") and the lobby layer (graph "lobby")."""
    sample = json.loads((FIX.parent / "lobbying_sample.json").read_text(encoding="utf-8"))
    hired = next(e for e in sample["edges"] if e["type"] == "hired")
    new = set(hired["filings"])  # filings yesterday's layer did not hold, posted since: their links are news
    yesterday = {**sample, "edges": [e for e in sample["edges"] if not new & set(e["filings"])]}
    today = {**sample, "filing_posted": {f: "2026-10-18" for f in new}}
    base = {"nodes": [], "edges": [], "lob_alias": {}, "live_flags": {}, "status": {},
            "meta": {"no_lobbying_found": {"match": [], "names": []}, "live": None}}
    before, after = map_on(tmp_path, "before", drop={"MARSHAL ZHUKOV", "ZEPHYR I"}), map_on(tmp_path, "after")
    kg0 = build_kg(before, yesterday, base, None, "2026-10-19")
    kg1 = build_kg(after, today, base, kg0, DAY)
    links = {(e["s"], e["t"], e["y"]) for e in kg1["edges"]}
    for graph, was, now in (("fleet", before, after), ("lobby", kg0, kg1), ("fleet", after, before)):  # (the last: links that left)
        found = [c for c in diff(was, now, graph, DAY, set()) if c["item"] == "edge"]
        assert found, graph  # each case has a link to find
        assert all((*c["endpoint_ids"], c["node_type"]) in links for c in found), (graph, [c["summary"] for c in found])


def test_network_status_ignores_company_no_longer_looked_up(tmp_path):
    # the vessel that named TRANS-FLOT JSC drops out; research keeps the company, but nothing looks it up, so the
    # network's level for it falls to none though the US list still holds it
    held, known = kept_by_research()
    today = network_of(map_on(tmp_path, "today", research=held, known=known))
    tomorrow = network_of(map_on(tmp_path, "tomorrow", drop={"MARSHAL ZHUKOV"}, research=held, known=known))
    was, now = (next(n for n in g["nodes"] if n["id"] == "co:trans-flot") for g in (today, tomorrow))
    assert (was["s"], now["s"], was.get("lk"), now.get("lk")) == ("blocked", "", 1, None)
    assert not [c for c in diff(today, tomorrow, "lobby", DAY, set()) if c["id"] == "co:trans-flot"]
    assert not [c for c in diff(tomorrow, today, "lobby", DAY, set()) if c["id"] == "co:trans-flot"]  # nor the way back


def test_network_status_reports_looked_up_company_level_change():
    def firm(level):
        return kg({**knode("co:gazprom", "company", "Gazprom", L="fleet", s=level, lists=[["US", "", ""]]), "lk": 1})
    c = only(diff(firm("restricted"), firm("blocked"), "lobby", DAY, set()))  # SSI to SDN, looked up on both days
    assert (c["field"], c["from"], c["to"], c["summary"]) == ("status", "restricted", "blocked",
                                                              "Gazprom changed status: restricted → blocked")
    once = kg(knode("co:gazprom", "company", "Gazprom", L="fleet", s="restricted", lists=[["US", "", ""]]))
    assert diff(once, firm("blocked"), "lobby", DAY, set()) == []  # looked up only one day: nothing says the level moved
    def zara(level):
        return kg({**knode("co:zara", "company", "Zara Shipholding", L="fleet", s=level), "kg_only": True})
    assert only(diff(zara("blocked"), zara("restricted"), "lobby", DAY, set()))["summary"] == (
        "Zara Shipholding changed status: blocked → restricted")  # looked up for the network every night


def test_network_level_row_uses_the_ships_name():
    named = kg(knode(TASSOS, "ship", "TASSOS", L="fleet", s="blocked", lists=[["US", "", ""]]))
    bare = kg(knode(TASSOS, "ship", TASSOS, L="fleet", s="", lists=[]))  # delisted: only a research edge keeps it
    assert only(diff(named, bare, "lobby", DAY, set()))["summary"] == "TASSOS changed status: blocked → none"


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


def test_unknown_unavailable_name_raises():
    with pytest.raises(ValueError, match="eu_journal"):
        diff(fleet(), fleet(), "fleet", DAY, {"uk", "eu_journal"})
    with pytest.raises(ValueError):
        diff(None, {}, "lobby", DAY, {"UK"})  # the baseline night is checked too, and the names are the lowercase ones
    assert diff(fleet(), fleet(), "fleet", DAY, {"us", "uk", "eu", "un", "lobbying"}) == []


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


def test_record_trims_old_days():
    record = None
    for day in range(1, 11):
        record = update_record(record, f"2026-10-{day:02d}", [change(summary=str(day))], {"uk": "fresh"}, keep_days=5)
    assert [d["date"] for d in record["days"]] == ["2026-10-10", "2026-10-09", "2026-10-08", "2026-10-07", "2026-10-06"]
    assert record["started"] == "2026-10-06"  # days before the oldest one held cannot be answered
    assert record["days"][2]["changes"][0]["summary"] == "8"
    before = json.dumps(record, sort_keys=True)
    update_record(record, "2026-10-08", [change(summary="again", id=ADISA)], {"uk": "fresh"}, keep_days=5)
    assert json.dumps(record, sort_keys=True) == before  # (the input record is left as it was)


def test_same_day_rerun_keeps_first_runs_changes():
    first = [change(summary="a", id="IMO1"), change(summary="b", id="IMO2", field="listed_by", to=["UK"]),
             change(summary="c", id="IMO2", field="listed_by", **{"from": ["EU"]})]
    record = update_record(None, DAY, first, {"uk": "fresh", "us": "unavailable"})
    # the re-run's prev is the graph already published today, so it finds nothing: it must not wipe the day
    again = update_record(record, DAY, [], {"uk": "fresh", "us": "fresh"})
    assert [c["summary"] for c in again["days"][0]["changes"]] == ["a", "b", "c"]
    assert again["days"][0]["sources"] == {"uk": "fresh", "us": "fresh"}  # a source that was fresh in either run was
    kept = update_record(record, DAY, [], {"uk": "unavailable"})
    assert kept["days"][0]["sources"] == {"uk": "fresh", "us": "unavailable"}
    assert update_record(record, DAY, first, {"uk": "fresh", "us": "unavailable"}) == record  # identical runs: same record
    # the same change again is not doubled (the later run's row wins); a listing and a delisting of one node both stay
    later = update_record(record, DAY, [change(summary="a2", id="IMO1"), change(summary="d", id="IMO3")], {})
    assert [c["summary"] for c in later["days"][0]["changes"]] == ["a2", "b", "c", "d"]  # (in the diff's order)


def test_same_day_two_renames_of_one_node_keep_both_rows():
    # (a second run diffs against the first run's graph: TASSOS renamed twice in one day, and a ship delisted by two
    # governments in two runs, are four changes, not two)
    first = [change(kind="changed", field="name", **{"from": "A", "to": "B"}),
             change(kind="changed", field="listed_by", **{"from": ["EU"]})]
    second = [change(kind="changed", field="name", **{"from": "B", "to": "C"}),
              change(kind="changed", field="listed_by", **{"from": ["UK"]})]
    record = update_record(update_record(None, DAY, first, {}), DAY, second, {})
    rows = record["days"][0]["changes"]
    assert sorted(str(c.get("from")) + ">" + str(c.get("to", "")) for c in rows) == ["A>B", "B>C", "['EU']>", "['UK']>"]
    assert update_record(record, DAY, first + second, {}) == record  # ... and seeing them again doubles nothing


def test_sources_of_a_day_are_in_a_fixed_order():
    names = ["us", "uk", "eu", "un", "lobbying"]  # (a set's order would depend on the hash seed)
    first = update_record(None, DAY, [], {k: "fresh" for k in names})["days"][0]["sources"]
    again = update_record(update_record(None, DAY, [], {"un": "fresh"}), DAY, [], {k: "fresh" for k in names})
    assert list(first) == sorted(names) == list(again["days"][0]["sources"])


def test_record_keeps_its_first_day_while_it_fits():
    record = update_record(None, "2026-10-19", [], {})
    record = update_record(record, "2026-10-20", [change(summary="x")], {"uk": "fresh"})
    assert record["started"] == "2026-10-19" and [d["date"] for d in record["days"]] == ["2026-10-20", "2026-10-19"]
    assert update_record(record, "2026-10-19", [], {}) == record  # idempotent


def test_record_remembers_its_first_run_after_old_days_go():
    record = None
    for day in range(1, 11):
        record = update_record(record, f"2026-10-{day:02d}", [], {}, keep_days=5)
    assert record["started"] == "2026-10-06"  # the oldest day held moves on ...
    assert record["first_run"] == "2026-10-01"  # ... the baseline's day does not
    assert update_record(record, "2026-10-10", [], {}, keep_days=5) == record  # a re-run changes neither


def test_a_record_from_before_first_run_takes_its_started_day():
    old = {"started": "2026-10-06", "days": [{"date": "2026-10-06", "sources": {}, "changes": []}]}
    assert update_record(old, "2026-10-07", [], {})["first_run"] == "2026-10-06"
    assert update_record(None, "2026-10-19", [], {})["first_run"] == "2026-10-19"
