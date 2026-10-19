import csv
import shutil
from pathlib import Path

import fleet_official as fo

FIX = Path(__file__).parent / "fixtures" / "fleet"
DOWNLOADS = {fo.OS_EU_JOURNAL: "os_eu_journal_sample.csv", fo.OS_OFAC: "os_ofac_sample.csv"}
ZULU_OFAC = "THE ZULU SHIPS MANAGEMENT AND OPERATION - SOLE PROPRIETORSHIP L.L.C"


def fake_fetch(url):
    return (FIX / DOWNLOADS[url]).read_text(encoding="utf-8")


def build(tmp_path, fetch=fake_fetch, csl_rows=()):
    raw = tmp_path / "fleet-raw"
    raw.mkdir(exist_ok=True)
    shutil.copy(FIX / "uk_sample.csv", raw / "uk.csv")
    shutil.copy(FIX / "csl_sample.csv", raw / "us.csv")
    with open(raw / "us.csv", "a", newline="", encoding="utf-8") as f:
        header = (FIX / "csl_sample.csv").read_text(encoding="utf-8").split("\n", 1)[0].split(",")
        csv.DictWriter(f, fieldnames=header).writerows(csl_rows)
    return fo.build_official(raw, fetch=fetch)


def edges_of(graph, source, type_):
    return {e["target"]: e for e in graph["edges"] if e["source"] == source and e["type"] == type_}


def node(graph, nid):
    return next(n for n in graph["nodes"] if n["id"] == nid)


def test_tassos_designations(tmp_path):
    g = build(tmp_path)
    des = edges_of(g, "IMO9408695", "designated_by")
    assert set(des) == {"gov:uk", "gov:us", "gov:eu"}
    uk, us = des["gov:uk"], des["gov:us"]
    assert uk["source_url"] == "https://search-uk-sanctions-list.service.gov.uk/designations/RUS3483/Ship"
    assert (uk["record"], uk["date"]) == ("RUS3483", "2026-02-24")
    assert us["source_url"] == "https://sanctionssearch.ofac.treas.gov/Details.aspx?id=54815"
    assert us["record"] == "OFAC ent_num 54815"
    assert us["date"] == "2025-07-30" and "via OpenSanctions" in us["source_file"]  # the CSL has no vessel dates
    for e in des.values():
        assert e["confidence"] == "Documented" and e["sources"][0]["angle"] == "lists"
        assert e["sources"][0]["url"] == e["source_url"]
    tassos = node(g, "IMO9408695")
    assert tassos["listed_by"] == ["eu", "uk", "us"] and tassos["listed"] is True
    assert tassos["listing_dates"] == {"eu": "2025-10-24", "uk": "2026-02-24", "us": "2025-07-30"}
    assert tassos["first_listed"] == "2025-07-30" and tassos["flag_us"] == "lr"  # the UK row leaves the flag blank
    assert "cc:lr" in edges_of(g, "IMO9408695", "flagged_in")


def test_linked_to_creates_company_edge(tmp_path):
    g = build(tmp_path)
    cid = fo.co_id(ZULU_OFAC)
    assert cid == "co:zulu-ships-management-and-operation-l-l-c"  # the 25 Sep id, which the research base uses
    linked = edges_of(g, cid, "linked_to")["IMO9408695"]
    assert linked["record"] == "OFAC ent_num 54815" and "Linked To" in linked["quote"]
    zulu = node(g, cid)
    assert zulu["type"] == "company" and zulu["listed_by"] == ["us"] and zulu["country"] == "ae"
    assert edges_of(g, cid, "designated_by")["gov:us"]["source_url"].endswith("?id=54895")
    assert "cc:ae" in edges_of(g, cid, "registered_in")


def test_ids_are_stable_across_runs(tmp_path):
    a, b = build(tmp_path), build(tmp_path)
    assert a == b
    keys = [(e["source"], e["target"], e["type"]) for e in a["edges"]]
    assert keys == sorted(keys) and len(keys) == len(set(keys))
    assert [n["id"] for n in a["nodes"]] == sorted(n["id"] for n in a["nodes"])


def test_no_fuzzy_company_merge(tmp_path):
    # Spelled-out suffixes normalise the same. Dotted "L.L.C." stays in the id exactly as on 25 Sep
    # (veil-trace's line 65 never matched), so the research base's company ids keep resolving.
    assert fo.norm_co("Gulf Star Shipping LLC") == fo.norm_co("Gulf Star Shipping Ltd") == "gulf star shipping"
    assert fo.norm_co("Gulf Star Shipping L.L.C.") == "gulf star shipping l l c"
    assert fo.norm_co("Gulf Star Shipping") != fo.norm_co("Gulf Sun Shipping")
    g = build(tmp_path)
    # UK writes TASSOS's operator as "Zulu Ships Management"; it is not merged into the OFAC record by containment.
    assert "IMO9408695" in edges_of(g, "co:zulu-ships-management", "operates")
    assert "IMO9408695" not in edges_of(g, fo.co_id(ZULU_OFAC), "operates")
    unlisted = node(g, "co:zulu-ships-management")
    assert unlisted["listed_by"] == [] and unlisted["listing_dates"] == {}  # same node shape whether listed or not
    assert all(isinstance(n["listing_dates"], dict) for n in g["nodes"] if n["type"] in ("ship", "company", "person"))


def test_eu_status_source_label(tmp_path):
    eu = edges_of(build(tmp_path), "IMO9408695", "designated_by")["gov:eu"]
    assert "EU Official Journal, via OpenSanctions" in eu["source_file"]
    assert eu["source_url"] == "https://www.opensanctions.org/entities/NK-k837moN9ssPZedvkRUrexG/"
    assert eu["date"] == "2025-10-24"


def test_flags_owners_people_and_uk_entities(tmp_path):
    g = build(tmp_path)
    assert "cc:lr" in edges_of(g, "IMO9292204", "formerly_flagged_in")  # UK "Previous flags"
    assert "IMO9292204" in edges_of(g, "co:scf-management-services-dubai", "formerly_operated")
    assert "cc:pw" in edges_of(g, "IMO9255880", "formerly_flagged_in")  # CSL "Former Vessel Flag"
    assert "IMO9569671" in edges_of(g, "co:nitc", "owns")
    artemov = node(g, "p:artemov-viktor-sergiyovich")  # OFAC "Linked To" an individual
    assert artemov["type"] == "person" and artemov["listed_by"] == ["us"]
    assert "IMO9255880" in edges_of(g, artemov["id"], "linked_to")
    one_moon = edges_of(g, "co:one-moon-marine-services-l-l-c", "designated_by")["gov:uk"]
    assert one_moon["source_url"] == "https://search-uk-sanctions-list.service.gov.uk/designations/RUS2151/Entity"
    assert not any(n.get("name") == "DILBAR" for n in g["nodes"])  # yachts are skipped


def test_treasury_entry_wins_over_other_csl_lists(tmp_path):
    # The CSL holds BIS's Entity List row "Trans-Flot JSC" before OFAC's TRANS-FLOT JSC (ent_num 21110).
    g = build(tmp_path)
    assert "IMO9690224" in edges_of(g, "co:trans-flot", "linked_to")
    des = edges_of(g, "co:trans-flot", "designated_by")
    assert set(des) == {"gov:us"}
    us = des["gov:us"]
    assert us["source_url"] == "https://sanctionssearch.ofac.treas.gov/Details.aspx?id=21110"
    assert us["record"] == "OFAC ent_num 21110" and len(us["sources"]) == 1


def test_opensanctions_csv_with_bom(tmp_path):
    assert build(tmp_path, fetch=lambda url: "﻿" + fake_fetch(url)) == build(tmp_path)


def test_only_treasury_individuals_become_people(tmp_path):
    # BIS's Denied Persons List also holds individuals; one named like a UK operator must not turn it into a person.
    dpl = {"source": "Denied Persons List (DPL) - Bureau of Industry and Security", "type": "Individual",
           "name": "ZULU SHIPS MANAGEMENT"}
    assert node(build(tmp_path, csl_rows=[dpl]), "co:zulu-ships-management")["type"] == "company"


def test_uk_ship_names_written_with_their_imo():
    # The UK list writes some ships' primary names as "IMO 9243320 ('YEHOPE')": the name is the quoted part.
    assert fo.uk_ship_name("IMO 9243320 ('YEHOPE')") == "YEHOPE"
    assert fo.uk_ship_name("IMO 9331048 (CHAIVO)") == fo.uk_ship_name('IMO 9331048 ("CHAIVO")') == "CHAIVO"
    assert fo.uk_ship_name(" PRIMORYE ") == "PRIMORYE"
    text = (FIX / "uk_sample.csv").read_text(encoding="utf-8").replace(",RUS3483,,,TASSOS,", ",RUS3483,,,IMO 9408695 ('TASSOS'),")
    nodes, _ = fo.parse_uk(text)
    tassos = next(n for n in nodes if n["id"] == "IMO9408695")
    assert (tassos["name"], tassos["aliases"], tassos["names_by_source"]) == ("TASSOS", ["TASSOS"], {"UK list": "TASSOS"})
