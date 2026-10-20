import copy
import hashlib
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

from fleet_base import load_fleet_base
from fleet_official import freezes
from fleet_merge import apply_naming_policy, compact, edge_id, is_official, load_aliases, merge

ZULU_OFAC = "co:zulu-ships-management-and-operation-l-l-c"
EMPTY = {"nodes": [], "edges": []}
GONE_ID = "co:unlisted-" + hashlib.sha1(b"co:gone-shipping").hexdigest()[:8]  # co:gone-shipping, once generic


def src(angle, url, record="", confidence="Documented", quote="q"):
    return {"url": url, "file": angle + ".csv", "quote": quote, "record": record, "angle": angle,
            "confidence": confidence}


def edge(s, t, type_, date, *sources):
    first = sources[0]
    return {"source": s, "target": t, "type": type_, "date": date, "source_url": first["url"],
            "source_file": first["file"], "quote": first["quote"], "record": first["record"],
            "angle": first["angle"], "confidence": first["confidence"], "sources": list(sources)}


def listed(gov, record, date):
    return edge("co:front", "gov:" + gov, "designated_by", date, src("lists", "https://gov.example/" + gov, record))


def company(nid, name, **kw):
    return {"id": nid, "type": "company", "name": name, **kw}


def base(nodes=(), edges=(), node_fields=None):
    return {"nodes": list(nodes), "edges": list(edges), "node_fields": node_fields or {},
            "meta": {"title": "Shadow Fleet Network", "patterns": []}, "generated": "2026-09-25"}


def run(b, official=EMPTY, aliases=None, eu=None):
    return merge(b, official, aliases={} if aliases is None else aliases, eu_records=eu or [])


def node(graph, nid):
    return next(n for n in graph["nodes"] if n["id"] == nid)


def edges_of(graph, source, type_):
    return {e["target"]: e for e in graph["edges"] if e["source"] == source and e["type"] == type_}


GENERIC = company("co:unlisted-003", "unlisted Kazakhstan ship manager", angle=["ship-histories"], listed_by=[],
                  listed=False, country="kz", name_policy="generic",
                  generic_name="unlisted Kazakhstan ship manager")
MANAGES = edge("co:unlisted-003", "IMO9408695", "manages", "2023-02",
               src("ship-histories", "https://example.org/history", confidence="Lead"))
TASSOS = {"id": "IMO9408695", "type": "ship", "name": "TASSOS", "imo": "9408695", "aliases": ["TASSOS"],
          "programs": ["iran", "russia"], "listed_by": ["uk"], "listing_dates": {"uk": "2026-02-24"}, "listed": True,
          "uk_date": "2026-02-24", "us_date": "2025-07-30"}
TASSOS_UK = edge("IMO9408695", "gov:uk", "designated_by", "2026-02-24",
                 src("lists", "https://search-uk-sanctions-list.service.gov.uk/designations/RUS3483/Ship", "RUS3483"))


def test_research_item_survives_when_official_is_empty():
    b = load_fleet_base()
    g = run(b)
    ids = {n["id"] for n in g["nodes"]}
    published = lambda x: x if x in ids else "co:unlisted-" + hashlib.sha1(x.encode()).hexdigest()[:8]  # noqa: E731
    keys = {(e["source"], e["target"], e["type"]) for e in g["edges"]}
    assert keys == {(published(e["source"]), published(e["target"]), e["type"]) for e in b["edges"]}
    assert all(e["source"] in ids and e["target"] in ids for e in g["edges"])  # list nodes the research cites
    assert {e["layer"] for e in g["edges"]} == {"research"}


def test_official_wins_for_status():
    b = base([company("co:front", "Front Co", angle=["treasury-iran"], listed_by=["us"], listed=True,
                      listing_dates={"us": "2020-01-01"}, first_listed="2020-01-01")])
    official = {"nodes": [company("co:front", "FRONT CO", listed_by=["us", "uk"], listed=True),
                          {"id": "gov:uk", "type": "government", "name": "UK"},
                          {"id": "gov:us", "type": "government", "name": "US"}],
                "edges": [listed("us", "OFAC ent_num 1", "2021-05-05"), listed("uk", "RUS1", "2022-06-06")]}
    front = node(run(b, official), "co:front")
    assert front["listed_by"] == ["uk", "us"] and front["layer"] == "official"
    assert front["listing_dates"] == {"uk": "2022-06-06", "us": "2021-05-05"}
    assert front["first_listed"] == "2021-05-05" and front["angle"] == ["lists", "treasury-iran"]


def test_research_only_node_has_no_list_status():
    frozen = dict(GENERIC, listed_by=["us"], listed=True, listing_dates={"us": "2020-01-01"}, first_listed="2020-01-01")
    n = node(run(base([frozen], [MANAGES])), "co:unlisted-003")  # the 25 Sep copy says US, but no edge supports it
    assert n["listed_by"] == [] and n["listed"] is False and n["listing_dates"] == {} and "first_listed" not in n
    assert n["layer"] == "research"


def test_status_from_official_host_research_designation():
    # Companies and people: a government record cited by research counts (e.g. Moonlight's EU act, Shamkhani's UK entry).
    front = company("co:front", "Front Co", angle=["treasury-iran"], listed_by=[], listed=False)
    person = {"id": "p:named", "type": "person", "name": "NAMED", "angle": ["studies"], "listed_by": []}
    press = edge("co:front", "gov:us", "designated_by", "2024-03-05",
                 src("treasury-iran", "https://home.treasury.gov/news/press-releases/jy2178"))
    blog = edge("co:front", "gov:uk", "designated_by", "2024-01-01", src("studies", "https://example.org/blog"))
    uk_entry = edge("p:named", "gov:uk", "designated_by", "2025-08-21",
                    src("studies", "https://search-uk-sanctions-list.service.gov.uk/designations/IRN0249/Entity"))
    g = run(base([front, person], [press, blog, uk_entry]))
    n = node(g, "co:front")
    assert n["listed_by"] == ["us"] and n["listing_dates"] == {"us": "2024-03-05"} and n["first_listed"] == "2024-03-05"
    assert node(g, "p:named")["listed_by"] == ["uk"]


def test_research_designation_does_not_keep_delisted_ship_listed():
    # Ships: the UK, US and EU vessel feeds are authoritative by IMO, so only the official layer sets status.
    cited = edge("IMO9408695", "gov:uk", "designated_by", "2024-07-31",
                 src("company-anatomy", "https://search-uk-sanctions-list.service.gov.uk/designations/RUS3483/Ship"))
    us = edge("IMO9408695", "gov:us", "designated_by", "2025-07-30",
              src("lists", "https://sanctionssearch.ofac.treas.gov/Details.aspx?id=54815", "OFAC ent_num 54815"))
    g = run(base(edges=[cited]), {"nodes": [TASSOS], "edges": [us]})  # the UK no longer lists TASSOS
    tassos = node(g, "IMO9408695")
    assert tassos["listed_by"] == ["us"] and tassos["listing_dates"] == {"us": "2025-07-30"}
    assert edges_of(g, "IMO9408695", "designated_by")["gov:uk"]["layer"] == "research"  # the citation stays


def test_generic_ids_not_renumbered():
    g = run(base([GENERIC], [MANAGES]), {"nodes": [TASSOS], "edges": [TASSOS_UK]})
    n = node(g, "co:unlisted-003")
    assert n["name_policy"] == "generic" and n["name"] == "unlisted Kazakhstan ship manager"
    assert "IMO9408695" in edges_of(g, "co:unlisted-003", "manages")
    assert apply_naming_policy(copy.deepcopy(g)) == g  # idempotent


def test_generic_stub_id_hides_name():
    gone = dict(MANAGES, source="co:gone-shipping")  # a firm no list holds any more, cited only by research
    b = dict(base([GENERIC], [MANAGES, gone]), known_names={"co:gone-shipping": ["Gone Shipping LLC"]})
    b["meta"]["patterns"] = [{"id": "p", "examples": ["co:gone-shipping", "IMO9408695"]}]
    g = run(b)
    stub = node(g, GONE_ID)
    assert (stub["name_policy"], stub["name"], stub["aliases"]) == ("generic", "unlisted ship manager", [])
    assert "IMO9408695" in edges_of(g, GONE_ID, "manages") and "gone" not in json.dumps(g).lower()
    assert g["meta"]["patterns"][0]["examples"] == [GONE_ID, "IMO9408695"]
    assert all(e["id"] == edge_id(e["source"], e["target"], e["type"]) for e in g["edges"])
    assert node(g, "co:unlisted-003")["name"] == "unlisted Kazakhstan ship manager"  # base generic ids are kept
    assert apply_naming_policy(copy.deepcopy(g)) == g


def test_published_generic_labels_are_kept():
    # co:unlisted-006 was published as "unlisted ship manager"; its only edge left (an incoming sold_to) would make
    # it "unlisted company". The published label stays, and texts already carrying it are not scrubbed again.
    sold = company("co:unlisted-006", "unlisted ship manager", angle=["ship-histories"], name_policy="generic",
                   generic_name="unlisted ship manager")
    sale = edge("IMO9408695", "co:unlisted-006", "sold_to", "2022-01",
                src("ship-histories", "https://example.org/s", confidence="Lead", quote="Sold to [unlisted ship manager]"))
    fields = {"IMO9408695": {"research_notes": [{"angle": "ship-histories", "text": "ISM: [unlisted ship manager]"}]}}
    g = run(base([sold], [sale], fields))
    n = node(g, "co:unlisted-006")
    assert (n["name"], n["generic_name"], n["name_policy"]) == ("unlisted ship manager",) * 2 + ("generic",)
    text = json.dumps(g)
    assert "[[" not in text and text.count("[unlisted ship manager]") == 3


def test_history_names_withheld_unless_the_company_is_shown():
    elevate = edge("co:elevate-marine-management", "IMO9408695", "manages", "2024-01",
                   src("ship-histories", "https://example.org/e", confidence="Lead"))
    front = company("co:front-marine", "FRONT MARINE LIMITED", angle=["studies"], listed_by=[])
    named = edge("co:front-marine", "IMO9408695", "operates", "2025-01", src("studies", "https://www.justice.gov/x"))
    fields = {"IMO9408695": {"history": [{"date": "2024-01", "kind": "manager", "from": "Front Marine Ltd",
                                          "to": "elevate marine management pvt ltd"}]}}
    b = dict(base([front], [elevate, named], fields),
             known_names={"co:elevate-marine-management": ["ELEVATE MARINE MANAGEMENT PRIVATE LIMITED"]})
    h = node(run(b), "IMO9408695")["history"][0]
    assert (h["from"], h["to"]) == ("Front Marine Ltd", "an unlisted company")  # spelling the scrub cannot see


def test_history_keeps_listed_firm_with_dotted_suffix():
    # TASSOS's history spells Zulu "...Sole Proprietorship LLC"; the listed node is "...SOLE PROPRIETORSHIP L.L.C".
    # A generic look-alike that the research still cites cannot hide a firm we show.
    zulu = company(ZULU_OFAC, "THE ZULU SHIPS MANAGEMENT AND OPERATION - SOLE PROPRIETORSHIP L.L.C")
    us = edge(ZULU_OFAC, "gov:us", "designated_by", "2025-07-30",
              src("lists", "https://sanctionssearch.ofac.treas.gov/Details.aspx?id=54895", "OFAC ent_num 54895"))
    twin = edge("co:zulu-twin", "IMO9408695", "manages", "2023-01", src("ship-histories", "https://example.org/z"))
    spelled = "the Zulu Ships Management & Operation - Sole Proprietorship LLC"
    fields = {"IMO9408695": {"history": [{"date": "2023-01", "kind": "manager", "from": "", "to": spelled}]}}
    b = dict(base(edges=[twin], node_fields=fields),
             known_names={"co:zulu-twin": ["ZULU SHIPS MANAGEMENT AND OPERATION LLC"]})
    g = run(b, {"nodes": [TASSOS, zulu], "edges": [TASSOS_UK, us]})
    assert node(g, ZULU_OFAC)["listed_by"] == ["us"]
    assert node(g, "IMO9408695")["history"][0]["to"] == spelled


def test_history_withholds_each_care_of_part_on_its_own():
    gone = edge("co:gone-shipping", "IMO9408695", "manages", "2024-01", src("ship-histories", "https://example.org/g"))
    front = company("co:front-marine", "FRONT MARINE LIMITED", angle=["studies"], listed_by=[])
    named = edge("co:front-marine", "IMO9408695", "operates", "2025-01", src("studies", "https://www.justice.gov/x"))
    fields = {"IMO9408695": {"history": [{"date": "2024-01", "kind": "owner", "from": "Old Owner Inc",
                                          "to": "Gone Shipping Pvt. Ltd c/o Front Marine Ltd"}]}}
    b = dict(base([front], [gone, named], fields), known_names={"co:gone-shipping": ["GONE SHIPPING PRIVATE LIMITED"]})
    h = node(run(b), "IMO9408695")["history"][0]
    assert (h["from"], h["to"]) == ("Old Owner Inc", "an unlisted company c/o Front Marine Ltd")  # unknown firm kept


def test_is_official_matches_the_host():
    assert is_official("https://ofac.treasury.gov/recent-actions/20250101")
    assert is_official("https://sanctionssearch.ofac.treas.gov/Details.aspx?id=1")
    assert is_official("https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=OJ:L_202401746")
    assert not is_official("https://ofac.evil.example/x")
    assert not is_official("https://example.org/?next=https://www.gov.uk/")
    assert not is_official("https://war-sanctions.gur.gov.ua/en") and not is_official("")


def test_a_malformed_url_is_not_official():
    assert not is_official("https://[gov.uk/x") and not is_official("http://[::1")  # (urlsplit raises on these)


def test_generic_stub_scrubs_real_name():
    cited = edge("co:gone-shipping", "IMO9408695", "manages", "2023-02",
                 src("ship-histories", "https://example.org/h", confidence="Lead", quote="Gone Shipping LLC took over"))
    fields = {"IMO9408695": {
        "history": [{"date": "2023-02", "kind": "manager", "from": "Old Mgmt", "to": "GONE SHIPPING LLC"}],
        "research_notes": [{"angle": "ship-histories", "text": "Managed by Gone Shipping LLC since 2023."}]}}
    b = dict(base(edges=[cited], node_fields=fields), known_names={"co:gone-shipping": ["Gone Shipping LLC", "Gone Ship"]})
    b["meta"]["findings"] = [{"angle": "studies", "text": "Gone Ship ran it."}]
    g = run(b)
    gone = node(g, GONE_ID)
    assert (gone["name_policy"], gone["name"], gone["aliases"]) == ("generic", "unlisted ship manager", [])
    text = json.dumps(g).lower()
    assert "gone ship" not in text and text.count("[unlisted ship manager]") == 5  # quote x2, note, history, finding
    assert b["edges"][0]["quote"] == "Gone Shipping LLC took over"  # the base itself is not changed


def test_name_count_includes_ukraine_former_names():
    fields = {"IMO9408695": {"ua_former_names": ["BAY GLOBAL", "Tassos"]}}
    tassos = dict(TASSOS, aliases=["TASSOS"])
    assert node(run(base(node_fields=fields), {"nodes": [tassos], "edges": []}), "IMO9408695")["name_count"] == 2


def test_ukraine_current_name_is_a_name_by_source():
    pawell = {"id": "IMO8315499", "type": "ship", "name": "PAWELL", "imo": "8315499", "aliases": ["PAWELL"],
              "programs": ["iran"], "names_by_source": {"US list": "PAWELL"}}
    fields = {"IMO8315499": {"ua_current_name": "COMETA"}}
    n = node(run(base(node_fields=fields), {"nodes": [pawell], "edges": []}), "IMO8315499")
    assert n["names_by_source"] == {"US list": "PAWELL", "Ukraine database (current)": "COMETA"}
    assert n["aliases"] == ["PAWELL", "COMETA"] and n["name_count"] == 2 and "ua_current_name" not in n


def test_node_fields_reattached():
    fields = {"IMO9408695": {"role": "tanker", "history": [], "ua_former_names": ["BAY GLOBAL"], "name_note": "",
                             "research_notes": [{"angle": "studies", "text": "t"}], "angle": ["studies"]},
              "co:zulu": {"role": "owner/operator (UK list)", "research_notes": [{"angle": "studies", "text": "z"}]}}
    official = {"nodes": [TASSOS, company("co:zulu", "ZULU", role="linked company (OFAC)")], "edges": [TASSOS_UK]}
    g = run(base(node_fields=fields), official)
    tassos, zulu = node(g, "IMO9408695"), node(g, "co:zulu")
    assert tassos["role"] == "tanker" and tassos["ua_former_names"] == ["BAY GLOBAL"]  # no official role
    assert "history" not in tassos and "name_note" not in tassos  # empty values are skipped
    assert tassos["angle"] == ["lists", "studies"] and tassos["layer"] == "official"
    assert zulu["role"] == "linked company (OFAC)" and zulu["research_notes"] == [{"angle": "studies", "text": "z"}]


def test_duplicate_triples_fold_into_one_edge():
    research = [
        edge("IMO9408695", "gov:uk", "designated_by", "2024-07-31", src("company-anatomy", "https://example.org/a")),
        edge("IMO9408695", "gov:uk", "designated_by", "2024-07-01", src("studies", "https://example.org/b")),
        edge("IMO9408695", "co:x", "operates", "2025-01-01", src("studies", "https://example.org/c", confidence="Lead")),
        edge("IMO9408695", "co:x", "operates", "2024-03-01", src("enforcement", "https://example.org/d")),
    ]
    official = {"nodes": [TASSOS], "edges": [TASSOS_UK]}
    g = run(base(edges=research), official)
    uk = [e for e in g["edges"] if e["target"] == "gov:uk"]
    assert len(uk) == 1
    uk = uk[0]
    assert uk["id"] == edge_id("IMO9408695", "gov:uk", "designated_by") and uk["layer"] == "official"
    assert (uk["date"], uk["record"]) == ("2026-02-24", "RUS3483")  # the list owns the listing date
    assert [s["angle"] for s in uk["sources"]] == ["lists", "company-anatomy", "studies"]
    ops = [e for e in g["edges"] if e["type"] == "operates"]
    assert len(ops) == 1 and ops[0]["date"] == "2024-03-01" and ops[0]["confidence"] == "Documented"
    assert ops[0]["layer"] == "research" and len(ops[0]["sources"]) == 2


def test_alias_table_joins_zulu_spellings():
    assert load_aliases()["zulu ships management"] == ZULU_OFAC  # the committed table
    uk_zulu = company("co:zulu-ships-management", "Zulu Ships Management", role="owner/operator (UK list)")
    ofac_zulu = company(ZULU_OFAC, "THE ZULU SHIPS MANAGEMENT AND OPERATION - SOLE PROPRIETORSHIP L.L.C",
                        role="linked company (OFAC)", listed_by=["us"])
    official = {"nodes": [TASSOS, uk_zulu, ofac_zulu, {"id": "gov:us", "type": "government", "name": "US"}],
                "edges": [edge("co:zulu-ships-management", "IMO9408695", "operates", "2026-02-24",
                               src("lists", "https://gov.example/uk", "RUS3483")),
                          edge(ZULU_OFAC, "IMO9408695", "linked_to", "2025-07-30",
                               src("lists", "https://gov.example/us", "OFAC ent_num 54815")),
                          edge(ZULU_OFAC, "gov:us", "designated_by", "2025-07-30",
                               src("lists", "https://gov.example/us", "OFAC ent_num 54895"))]}
    eu = [["Zulu Ships Management", "ZULU SHIPS MANAGEMENT", "Russia/Ukraine", "2026-07-23", "184435", "",
           "https://eur-lex.europa.eu/eli/reg_impl/2026/1843/oj/eng"]]  # the EU lists the UK spelling
    g = run(base(), official, aliases=load_aliases(), eu=eu)
    assert not any(n["id"] == "co:zulu-ships-management" for n in g["nodes"])
    zulu = node(g, ZULU_OFAC)
    assert zulu["name"].startswith("THE ZULU") and "Zulu Ships Management" in zulu["aliases"]
    assert zulu["listed_by"] == ["eu", "us"] and zulu["ship_count"] == 1
    assert set(edges_of(g, ZULU_OFAC, "operates")) == set(edges_of(g, ZULU_OFAC, "linked_to")) == {"IMO9408695"}


def test_eu_financial_sanctions_list_designates_companies_by_exact_name():
    eu = [["JSC SOVCOMFLOT", "SOVCOMFLOT", "Russia/Ukraine", "2024-06-24", "167101", "",
           "https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=OJ:L_202401746"],
          ["Sovcomflot Shipping Services", "SOVCOMFLOT SHIPPING SERVICES", "Russia/Ukraine", "2025-01-01", "9", "", ""]]
    official = {"nodes": [company("co:sovcomflot", "PAO Sovcomflot", listed_by=[])], "edges": []}
    g = run(base(), official, eu=eu)
    scf = node(g, "co:sovcomflot")
    assert scf["listed_by"] == ["eu"] and scf["listing_dates"] == {"eu": "2024-06-24"}
    des = edges_of(g, "co:sovcomflot", "designated_by")
    assert set(des) == {"gov:eu"} and len(des["gov:eu"]["sources"]) == 1  # the near-miss name adds nothing
    assert des["gov:eu"]["source_url"] == eu[0][6]
    assert des["gov:eu"]["source_file"] == "EU financial sanctions list"
    assert des["gov:eu"]["eu_reg"] == "269"  # the financial list freezes assets (Reg. 269/2014 for Russia/Ukraine)
    iran = [["SOVCOMFLOT", "SOVCOMFLOT", "Iran", "2024-06-24", "1", "", ""]]
    assert edges_of(run(base(), official, eu=iran), "co:sovcomflot", "designated_by")["gov:eu"]["eu_reg"] == "Iran"
    assert node(g, "gov:eu")["type"] == "government"


def test_research_designation_citing_833_is_restricted():
    # A research designation has no list row: the instrument its quote cites says whether it freezes assets.
    def cite(nid, gov, quote):
        return edge(nid, gov, "designated_by", "2026-08-13", src("studies", "https://eur-lex.europa.eu/x", quote=quote))

    quotes = {"co:part-c": "Arcadia International FZE 13.8.2026 [added to] Part C (... entities ... significantly "
                           "frustrating the purpose of the prohibitions set out in Articles 3m, 3n and 3s).",
              "co:annex-xiii": "In Annex XIII to Regulation (EU) No 833/2014, an entry for the following entity is inserted",
              "co:freeze": "Entry 979, Council Implementing Regulation (EU) 2026/1843 (implementing Reg 269/2014)",
              "co:unknown": "UKR - 2025/1476 (OJ L202501476) - 2025-07-18"}
    edges = [cite(nid, "gov:eu", q) for nid, q in quotes.items()]
    edges.append(cite("IMO9408695", "gov:uk", "Shipping sanctions: a specified ship is prohibited from entering ports"))
    edges.append(cite("co:mentions", "gov:uk", "involved in a scheme using a specified ship; assets are frozen"))
    g = run(base([company(nid, nid) for nid in [*quotes, "co:mentions"]] + [TASSOS], edges))
    eu = {nid: edges_of(g, nid, "designated_by")["gov:eu"] for nid in quotes}
    assert {nid: e.get("eu_reg") for nid, e in eu.items()} == {
        "co:part-c": "833", "co:annex-xiii": "833", "co:freeze": "269", "co:unknown": None}
    uk_ship = edges_of(g, "IMO9408695", "designated_by")["gov:uk"]
    assert uk_ship["uk_freeze"] is False  # a specified ship
    assert "uk_freeze" not in edges_of(g, "co:mentions", "designated_by")["gov:uk"]  # a company's quote that mentions one
    # 833/2014 and UK ship measures do not freeze assets; everything else keeps its 25 Sep reading
    assert {nid: freezes(e) for nid, e in eu.items()} == {
        "co:part-c": False, "co:annex-xiii": False, "co:freeze": True, "co:unknown": True}
    assert not freezes(uk_ship) and freezes(edges_of(g, "co:mentions", "designated_by")["gov:uk"])


def test_company_added_only_for_the_kg_stays_out_of_the_map_payload():
    lone = company("co:lone", "LONE CO", kg_only=True, listed_by=["us"], listed=True)
    busy = company("co:busy", "BUSY CO", kg_only=True)  # a research edge ties it to a ship: an ordinary node
    owns = edge("co:busy", "IMO9408695", "owns", "2024-01-01", src("studies", "https://example.org/s"))
    lone2 = company("co:lone2", "LONE TWO CO", kg_only=True)  # its country is named by no other node or edge
    official = {"nodes": [TASSOS, lone, lone2, busy], "edges": [
        edge("co:lone2", "cc:zz", "registered_in", "", src("lists", "https://gov.example/us", "OFAC ent_num 3")),
        edge("co:lone", "gov:us", "designated_by", "2024-08-23", src("lists", "https://gov.example/us", "OFAC ent_num 1")),
        edge("co:lone", "cc:in", "registered_in", "", src("lists", "https://gov.example/us", "OFAC ent_num 1")),
        edge("co:busy", "gov:us", "designated_by", "2024-08-23", src("lists", "https://gov.example/us", "OFAC ent_num 2")),
        edge("IMO9408695", "cc:in", "flagged_in", "", src("lists", "https://gov.example/uk", "RUS3483"))]}
    g = run(base(edges=[owns]), official)
    assert {"co:lone", "co:busy"} <= {n["id"] for n in g["nodes"]}  # the long form keeps both for the kg build
    data = compact(g, "2026-10-19")
    ids = {n["id"] for n in data["nodes"]}
    assert not ids & {"co:lone", "co:lone2", "cc:zz"} and {"co:busy", "IMO9408695", "cc:in"} <= ids
    assert not [e for e in data["edges"] if "co:lone" in (e["s"], e["t"])]
    assert data["meta"]["counts"]["companies"] == 1


def test_compact_matches_page_shape():
    g = run(base([GENERIC], [MANAGES]), {"nodes": [TASSOS], "edges": [TASSOS_UK]})
    data = compact(g, "2026-10-19")
    assert list(data) == ["nodes", "edges", "sources", "quotes", "meta"]  # the old inline FLEET_DATA keys
    first = data["edges"][0]
    assert {"s", "t", "y", "src"} <= set(first)
    # no edge id: the e:<12 hex> ids were 40 KB of gzip, and a link is its (s, t, y) anyway (the id is a hash of them)
    assert all(set(e) <= {"s", "t", "y", "d", "c", "src", "n"} for e in data["edges"])
    keys = [(e["s"], e["t"], e["y"]) for e in data["edges"]]
    assert len(keys) == len(set(keys))
    assert data["meta"]["generated"] == "2026-10-19" and data["meta"]["title"] == "Shadow Fleet Network"
    counts = data["meta"]["counts"]
    assert (counts["ships"], counts["edges"], counts["ships_russia_and_iran"]) == (1, 2, 1)
    tassos = next(n for n in data["nodes"] if n["id"] == "IMO9408695")
    assert tassos["program_group"] == "both" and tassos["name_count"] == 1
    assert tassos["gap_days_us_minus_uk"] == -209  # the US listed it 209 days before the UK


RUN_FIXTURES = """
import json, sys
from pathlib import Path
import fleet_official as fo
from fleet_base import load_fleet_base
from fleet_merge import compact, merge
files = {fo.OS_EU_JOURNAL: "os_eu_journal_sample.csv", fo.OS_OFAC: "os_ofac_sample.csv"}
official = fo.build_official(Path(sys.argv[1]), fetch=lambda url: Path("fixtures/fleet", files[url]).read_text())
sys.stdout.write(json.dumps(compact(merge(load_fleet_base(), official), "2026-10-19"), sort_keys=True))
"""


def test_compact_is_deterministic(tmp_path):
    here = Path(__file__).parent
    shutil.copy(here / "fixtures" / "fleet" / "uk_sample.csv", tmp_path / "uk.csv")
    shutil.copy(here / "fixtures" / "fleet" / "csl_sample.csv", tmp_path / "us.csv")
    one, two = (subprocess.run([sys.executable, "-c", RUN_FIXTURES, str(tmp_path)], cwd=here, check=True,
                               capture_output=True, env={**os.environ, "PYTHONHASHSEED": seed}).stdout
                for seed in ("1", "2"))
    assert one == two and b'"IMO9408695"' in one
