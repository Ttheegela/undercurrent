import csv
import io
import shutil
from pathlib import Path

import fleet_official as fo

FIX = Path(__file__).parent / "fixtures" / "fleet"
DOWNLOADS = {fo.OS_EU_JOURNAL: "os_eu_journal_sample.csv", fo.OS_OFAC: "os_ofac_sample.csv"}
ZULU_OFAC = "THE ZULU SHIPS MANAGEMENT AND OPERATION - SOLE PROPRIETORSHIP L.L.C"


def fake_fetch(url):
    return (FIX / DOWNLOADS[url]).read_text(encoding="utf-8")


def build(tmp_path, fetch=fake_fetch, csl_rows=(), uk_rows=(), **official_args):
    raw = tmp_path / "fleet-raw"
    raw.mkdir(exist_ok=True)
    shutil.copy(FIX / "uk_sample.csv", raw / "uk.csv")
    shutil.copy(FIX / "csl_sample.csv", raw / "us.csv")
    with open(raw / "us.csv", "a", newline="", encoding="utf-8") as f:
        header = (FIX / "csl_sample.csv").read_text(encoding="utf-8").split("\n", 1)[0].split(",")
        csv.DictWriter(f, fieldnames=header).writerows(csl_rows)
    with open(raw / "uk.csv", "a", newline="", encoding="utf-8") as f:
        header = (FIX / "uk_sample.csv").read_text(encoding="utf-8").split("\n")[1].split(",")
        csv.DictWriter(f, fieldnames=header).writerows(uk_rows)
    return fo.build_official(raw, fetch=fetch, **official_args)


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


def csl_entity(source, name, ent, programs):
    return {"source": source, "type": "Entity", "name": name, "entity_number": ent, "programs": programs}


SSI = "Sectoral Sanctions Identifications List (SSI) - Treasury Department"
SDN = "Specially Designated Nationals (SDN) - Treasury Department"


def test_us_designation_says_which_list_it_is_on(tmp_path):
    # The kg page shows "blocked" only for SDN entries; sectoral and menu-based lists limit dealings, they do not freeze.
    rows = [csl_entity(SSI, "Boribo Shipping Corp", "1001", "UKRAINE-EO13662"),
            csl_entity("Non-SDN Menu-Based Sanctions List (NS-MBS List) - Treasury Department", "Zulu Ships Management",
                       "1002", "RUSSIA-EO14024"),
            csl_entity(SSI, "NS Laguna Shipping Inc", "1003", "UKRAINE-EO13662"),  # SSI first, SDN second, as the CSL has it
            csl_entity(SDN, "NS Laguna Shipping Inc", "1003", "UKRAINE-EO13662")]
    g = build(tmp_path, csl_rows=rows)
    us_list = lambda nid: edges_of(g, nid, "designated_by")["gov:us"].get("us_list")  # noqa: E731
    assert us_list("co:boribo-shipping") == "SSI"
    assert us_list("co:zulu-ships-management") == "NS-MBS List"
    assert us_list("co:ns-laguna-shipping") == "SDN"
    assert us_list("co:nitc") == "SDN"  # OpenSanctions' copy of the SDN list
    assert us_list("p:artemov-viktor-sergiyovich") == "SDN"


def test_each_designation_says_whether_it_freezes_assets(tmp_path):
    # Only an asset freeze is "blocked" on the kg page: the UK row's own "Sanctions Imposed", the EU list, the US list.
    unfrozen = {"Unique ID": "RUS9001", "Name 6": "Boribo Shipping Corp", "Designation Type": "Entity",
                "Regime Name": "The Russia (Sanctions) (EU Exit) Regulations 2019", "Date Designated": "01/02/2025",
                "Sanctions Imposed": "Trust Services Sanctions|Transport sanctions"}
    g = build(tmp_path, uk_rows=[unfrozen])
    des = lambda nid, gov: edges_of(g, nid, "designated_by")[gov]  # noqa: E731
    assert des("IMO9408695", "gov:uk")["uk_freeze"] is False  # a specified ship
    assert des("IMO9408695", "gov:eu")["eu_reg"] == "833"  # an Annex XLII ship listing of Reg. 833/2014
    assert des("IMO9408695", "gov:us")["us_list"] == "SDN"
    assert des("co:one-moon-marine-services-l-l-c", "gov:uk")["uk_freeze"] is True  # "Asset freeze" in its row
    assert des("co:boribo-shipping", "gov:uk")["uk_freeze"] is False


def test_folded_designations_keep_the_strongest_type():
    def folded(*edges):
        g = fo._Graph()
        for e in edges:
            g.fold({"source": "co:a", "target": "gov:x", "type": "designated_by", "date": "", "sources": [], **e})
        return next(iter(g.edges.values()))

    for order in (1, -1):  # whichever edge arrives first
        assert folded(*[{"us_list": "SSI"}, {"us_list": "SDN"}][::order])["us_list"] == "SDN"
        assert folded(*[{"uk_freeze": False}, {"uk_freeze": True}][::order])["uk_freeze"] is True
        assert folded(*[{"eu_reg": "833"}, {"eu_reg": "269"}][::order])["eu_reg"] == "269"


def test_extra_company_gets_live_sdn_status(tmp_path):
    # Zara Shipholding is on the SDN list, but no vessel names it: the kg base asks for it by name.
    extra = {"co:zara-shipholding": "ZARA SHIPHOLDING CO", "co:nitc": "NITC"}
    row = csl_entity(SDN, "ZARA SHIPHOLDING CO", "50524", "RUSSIA-EO14024")
    g = build(tmp_path, csl_rows=[row], extra_companies=extra)
    zara = node(g, "co:zara-shipholding")
    assert (zara["name"], zara["listed_by"], zara["kg_only"]) == ("ZARA SHIPHOLDING CO", ["us"], True)
    us = edges_of(g, "co:zara-shipholding", "designated_by")["gov:us"]
    assert (us["us_list"], us["record"]) == ("SDN", "OFAC ent_num 50524")
    assert "kg_only" not in node(g, "co:nitc")  # a vessel names it: an ordinary node, as before


def test_eu_ship_listing_is_833_only_for_the_russia_programme(tmp_path):
    # OpenSanctions' EU journal also holds other programmes' ships; only Russia's are Annex XLII (Reg. 833/2014).
    def fetch(url):
        text = fake_fetch(url)
        if url != fo.OS_EU_JOURNAL:
            return text
        rows = list(csv.DictReader(io.StringIO(text)))
        for r in rows:
            if r["name"] == "LEVEL":
                r["program_ids"], r["sanctions"] = "EU-PRK", "Article 1: vessel of another programme - 2024-01-01"
        out = io.StringIO()
        writer = csv.DictWriter(out, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)
        return out.getvalue()

    g = build(tmp_path, fetch=fetch)
    des = lambda nid: edges_of(g, nid, "designated_by")["gov:eu"]  # noqa: E731
    assert des("IMO9408695")["eu_reg"] == "833"
    assert "eu_reg" not in des("IMO9339325")
