from fleet_base import LOB_ALIAS, kg_extra_companies, load_fleet_base, load_kg_base, split_fleet, split_kg

META = {
    "findings": [{"id": "f1"}], "patterns": [{"id": "p1"}], "study_counts": {"a": 1}, "title": "T",
    "subtitle": "S", "credits": ["C"], "coverage": {"x": 1}, "generated": "2026-09-25", "counts": {"nodes": 9},
    "angles": ["studies"], "verified_angles": ["studies"],
}


def src(angle, url="https://example.org/a"):
    return {"url": url, "file": angle + ".csv", "quote": angle + " quote", "record": "", "angle": angle,
            "confidence": "Documented"}


def edge(eid, *sources):
    first = sources[0]
    return {"id": eid, "source": "IMO9408695", "target": "gov:uk", "type": "designated_by", "date": "2024-07-31",
            "source_url": first["url"], "source_file": first["file"], "quote": first["quote"],
            "confidence": "Documented", "record": first["record"], "angle": first["angle"], "regime": "Russia",
            "sources": list(sources)}


EDGES = [
    edge("e1", src("lists")),
    edge("e2", src("lists")),
    edge("e3", src("lists")),
    edge("e4", src("company-anatomy")),
    edge("e5", src("lists"), src("treasury-iran", "https://example.org/t")),
]

NODES = [
    {"id": "IMO9408695", "type": "ship", "name": "TASSOS", "listed_by": ["uk", "us"], "programs": ["russia"],
     "angle": ["lists", "company-anatomy"], "role": "tanker", "ua_former_names": ["Bay Global"],
     "ua_flag_countries": ["lr"], "history": [{"date": "2023-02", "kind": "owner"}],
     "research_notes": [{"angle": "company-anatomy", "text": "note"}],
     "sources": [{"label": "Ukraine database", "url": "https://www.opensanctions.org/datasets/ua_war_sanctions/"}],
     "names_by_source": {"UK list": "TASSOS", "Ukraine database (current)": "BAY GLOBAL"}},
    {"id": "IMO1021570", "type": "ship", "name": "OCEAN 28", "listed_by": ["us"], "angle": ["lists"]},
    {"id": "co:unlisted-003", "type": "company", "name": "unlisted Kazakhstan ship manager",
     "angle": ["ship-histories"], "listed_by": [], "name_policy": "generic",
     "generic_name": "unlisted Kazakhstan ship manager"},
    {"id": "co:erst-group", "type": "company", "name": "Erst Group", "listed_by": ["uk"], "angle": ["lists"],
     "name_policy": "generic", "generic_name": "unlisted UK ship manager", "name_note": "n"},
]


def test_lists_only_edges_leave_the_base():
    base = split_fleet(NODES, EDGES, META)
    assert [e["id"] for e in base["edges"]] == ["e4", "e5"]
    mixed = base["edges"][1]
    assert mixed["sources"] == [src("treasury-iran", "https://example.org/t")]
    assert (mixed["angle"], mixed["source_url"]) == ("treasury-iran", "https://example.org/t")
    assert EDGES[4]["sources"][0]["angle"] == "lists"  # the input is not changed


def test_research_fields_kept_for_list_nodes():
    base = split_fleet(NODES, EDGES, META)
    fields = base["node_fields"]["IMO9408695"]
    assert fields["research_notes"] == NODES[0]["research_notes"] and fields["sources"] == NODES[0]["sources"]
    assert fields["angle"] == ["company-anatomy"]
    assert fields["ua_current_name"] == "BAY GLOBAL" and "names_by_source" not in fields
    assert "listed_by" not in fields and "programs" not in fields
    assert "IMO1021570" not in base["node_fields"]  # nothing to keep
    assert [n["id"] for n in base["nodes"]] == ["co:unlisted-003"]
    assert base["generated"] == "2026-09-25"
    assert base["meta"] == {k: META[k] for k in
                            ("findings", "patterns", "study_counts", "title", "subtitle", "credits", "coverage",
                             "angles", "verified_angles")}


def test_known_names_for_list_companies_the_research_cites():
    zulu = {"id": "co:zulu", "type": "company", "name": "ZULU LLC", "aliases": ["Zulu", "ZULU LLC"], "angle": ["lists"]}
    quiet = {"id": "co:quiet", "type": "company", "name": "Quiet Ltd", "angle": ["lists"]}
    cited = dict(edge("e6", src("ship-histories")), source="co:zulu", target="IMO9408695", type="manages")
    base = split_fleet(NODES + [zulu, quiet], EDGES + [cited], META)
    assert base["known_names"] == {"co:zulu": ["ZULU LLC", "Zulu"]}  # research-only and uncited firms are left out


def test_generic_companies_stay_generic():
    base = split_fleet(NODES, EDGES, META)
    node = base["nodes"][0]
    assert node["name_policy"] == "generic" and node["generic_name"] == "unlisted Kazakhstan ship manager"
    fields = base["node_fields"]["co:erst-group"]
    assert fields["name_policy"] == "generic" and fields["generic_name"] == "unlisted UK ship manager"


def test_kg_base_keeps_team_and_curated_only():
    def e(s, t, level):
        return {"s": s, "t": t, "y": "hired", "c": "D", "d": "", "u": "", "r": "", "q": "", "L": level}

    kg = {
        "meta": {"no_lobbying_found": {"names": ["X"]}, "live": {"count": 1}, "counts": {}},
        "nodes": [{"id": i, "t": "company", "n": i, "L": "lobby", "s": "", "lists": []} for i in "abcdef"]
        + [{"id": "ship", "t": "ship", "n": "S", "L": "fleet", "s": "", "lists": [],
            "live": {"area": "Baltic", "at": "2026-09-25T20:11Z"}}],
        "edges": [e("a", "b", "fleet"), e("b", "c", "lobby"), e("c", "d", "team"), e("e", "f", "curated")],
    }
    base = split_kg(kg)
    assert [x["L"] for x in base["edges"]] == ["team", "curated"]
    assert [n["id"] for n in base["nodes"]] == ["c", "d", "e", "f"]
    assert base["meta"] == {"no_lobbying_found": {"names": ["X"]}, "live": {"count": 1}}
    assert base["live_flags"] == {"ship": {"area": "Baltic", "at": "2026-09-25T20:11Z"}}
    assert base["lob_alias"] == LOB_ALIAS and LOB_ALIAS["lob:huawei"] == "co:huawei"


def test_kg_base_keeps_curated_status_of_lobby_side_companies():
    def n(i, layer, s="", lists=()):
        return {"id": i, "t": "company", "n": i, "L": layer, "s": s, "lists": [list(x) for x in lists]}

    kg = {
        "meta": {"no_lobbying_found": {}, "live": None},
        "nodes": [n("co:nord-stream-2", "lobby", "blocked", [("US SDN", "31926", "PEESA-EO14039")]),
                  n("co:plain", "lobby"), n("co:ship-owner", "fleet", "blocked", [("US", "", "2025-01-10")])],
        "edges": [],
    }
    assert split_kg(kg)["status"] == {"co:nord-stream-2": {"s": "blocked", "lists": [["US SDN", "31926", "PEESA-EO14039"]]}}


def test_kg_extra_companies_are_the_kg_fleet_companies_the_fleet_base_lacks():
    kg_base = load_kg_base()
    every = kg_extra_companies(kg_base)
    assert every["co:zara-shipholding"] == "ZARA SHIPHOLDING CO" and len(every) == 16
    # Gazprom Neft and the rest are research nodes of the map already; only the two Arctic LNG 2 firms are new to it
    assert kg_extra_companies(kg_base, load_fleet_base()) == {
        "co:zara-shipholding": "ZARA SHIPHOLDING CO",
        "co:skyhart-management-services": "SKYHART MANAGEMENT SERVICES PRIVATE LIMITED"}

