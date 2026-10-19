"""Merge the fixed 25 Sep research base with the nightly official layer into the shadow-fleet map payload.

Ported from veil-trace@88dcaa2:tools/fleet/network/merge.py: listing status (:181-192, official edges only),
the naming policy (:194-224; generic ids come from the base and are never renumbered), ship and company facts
(:273-296), counts and the compact page payload (:306-355). gap_days_us_minus_uk is build_base.py:409-418.
Before merging, official company ids go through data/fleet-company-aliases.json (fleet_aliases.py) and companies
on the EU financial sanctions list (data/lists/eu.json, exact normalised name) get their EU designation.
"""
from __future__ import annotations

import hashlib
import json
from collections import defaultdict
from datetime import date
from pathlib import Path

from fleet_official import CNAME, GOVS, _Graph, norm_co

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"

STATUS = ("listed_by", "listing_dates", "first_listed", "listed")
EU_FILE = "EU financial sanctions list"
EU_PAGE = "https://data.europa.eu/data/datasets/consolidated-list-of-persons-groups-and-entities-subject-to-eu-financial-sanctions"
OFFICIAL_HOSTS = ("treasury.gov", "ofac", "gov.uk", "europa.eu", "justice.gov", "federalregister.gov", "state.gov",
                  "uscourts.gov", "courtlistener", "lda.senate.gov", "fara.gov", "consilium", "eur-lex", "bis.gov",
                  "trade.gov", "imo.org", "gc.ca", "dfat.gov.au")
ROLE_WORDS = {"manages": "ship manager", "operates": "ship operator", "owns": "ship owner",
              "linked_to": "company linked to listed ships", "formerly_operated": "former ship operator",
              "insured_by": "insurer"}
FLEET_ROLES = {"owns", "manages", "operates", "linked_to", "formerly_operated", "sister_shell_of",
               "transferred_cargo_with", "carried_cargo_for", "controls", "director_of", "insured_by", "sold_to"}
SHIP_LINKS = ("operates", "manages", "owns", "linked_to", "formerly_operated")
ID_TYPES = (("IMO", "ship"), ("p:", "person"), ("cc:", "country"), ("gov:", "government"))
NAME_NOTE = "Not itself on a sanctions list we hold. Named by an official record in the role shown."
KEEP = ("id", "type", "name", "aliases", "imo", "programs", "program_group", "listed_by", "listed", "first_listed",
        "listing_dates", "country", "role", "ship_type", "year_built", "flag_now", "flags_before", "flag_us", "mmsi_us",
        "names_by_source", "ua_former_names", "ship_count", "name_count", "flag_count", "name_policy", "generic_name",
        "name_note", "history", "research_notes", "merge_notes", "address_us", "sources", "gap_days_us_minus_uk",
        "uk_id", "angle", "country_basis")


def edge_id(source: str, target: str, type_: str) -> str:
    return "e:" + hashlib.sha1(f"{source}|{target}|{type_}".encode()).hexdigest()[:12]


def load_aliases(path: Path = DATA / "fleet-company-aliases.json") -> dict[str, str]:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def load_eu_records(path: Path = DATA / "lists" / "eu.json") -> list[list[str]]:
    return json.loads(Path(path).read_text(encoding="utf-8"))["records"]


def _official(official: dict, aliases: dict[str, str], eu_records: list[list[str]]) -> dict:
    """Official layer with alias-table ids, EU financial-list company designations and fresh listing status."""
    ren = {"co:" + key.replace(" ", "-"): cid for key, cid in aliases.items()}
    g = _Graph()
    bare = [{k: v for k, v in n.items() if k not in STATUS} for n in official["nodes"]]
    g.add([n for n in bare if n["id"] not in ren]  # a firm's own record first, so it keeps its name
          + [dict(n, id=ren[n["id"]], aliases=[n["name"]] + n.get("aliases", [])) for n in bare if n["id"] in ren],
          [dict(e, source=ren.get(e["source"], e["source"]), target=ren.get(e["target"], e["target"]),
                sources=list(e["sources"])) for e in official["edges"]])
    eu = defaultdict(list)
    for r in eu_records:  # [name, normalised name, programme, date, ref, imo, url]
        eu[norm_co(r[0])].append(r)
    for nid, n in list(g.nodes.items()):
        if n.get("type") != "company":
            continue
        keys = sorted({norm_co(x) for x in [n["name"]] + n.get("aliases", [])})  # aliases: alias-table spellings only
        for r in [r for key in keys for r in eu.get(key, [])]:
            g.node("gov:eu", type="government", name=GOVS["gov:eu"])
            g.edge(nid, "gov:eu", "designated_by", r[3], r[6] or EU_PAGE, EU_FILE, "Programme: " + r[2], "EU id " + r[4])
    return g.finish()


def _fold(into: dict, e: dict, layer: str) -> None:
    """One edge per (source, target, type): sources unioned, the earliest date kept (the list's own date for a
    designation), Documented when any source is."""
    key = (e["source"], e["target"], e["type"])
    cur = into.get(key)
    if cur is None:
        into[key] = dict(e, sources=list(e["sources"]), layer=layer)
        return
    cur["sources"] += [s for s in e["sources"] if s not in cur["sources"]]
    list_date = cur["layer"] == "official" and cur["type"] == "designated_by" and cur["date"]
    if e["date"] and not list_date and (not cur["date"] or e["date"] < cur["date"]):
        cur["date"] = e["date"]
        cur.pop("date_note", None)
        if e.get("date_note"):
            cur["date_note"] = e["date_note"]
    if any(s["confidence"] == "Documented" for s in cur["sources"]):
        cur["confidence"] = "Documented"


def _stub(nid: str) -> dict:
    """A node a research edge cites that the official layer no longer holds, e.g. a ship that left the lists."""
    type_ = next((t for prefix, t in ID_TYPES if nid.startswith(prefix)), "company")
    name = {"ship": nid, "country": CNAME.get(nid[3:], nid), "government": GOVS.get(nid, nid)}.get(
        type_, nid.split(":", 1)[-1].replace("-", " ").upper())
    return {"id": nid, "type": type_, "name": name, "angle": [], "layer": "research"}


def _group(programs: set[str]) -> str:
    if "both" in programs or {"russia", "iran"} <= programs:
        return "both"
    return "russia" if "russia" in programs else "iran" if "iran" in programs else min(programs, default="other")


def _facts(nodes: dict, edges: list[dict]) -> None:
    """merge.py:273-296 and build_base.py:409-418."""
    for nid, n in nodes.items():
        if n["type"] != "ship":
            continue
        if not n.get("imo") and nid.startswith("IMO"):
            n["imo"] = nid[3:]
        n["name_count"] = len({a.strip().upper() for a in n["aliases"] if a.strip()} | {n["name"].upper()})
        flags = set(n.get("flags_before") or []) | set(n.get("ua_flag_countries") or [])
        n["flag_count"] = len(flags | {n["flag_now"]} if n.get("flag_now") else flags)
        n["program_group"] = _group(set(n["programs"]))
        if n.get("uk_date") and n.get("us_date") and "iran" in n["programs"]:
            n["gap_days_us_minus_uk"] = (date.fromisoformat(n["us_date"]) - date.fromisoformat(n["uk_date"])).days
    ships_of = defaultdict(set)
    for e in edges:
        if e["type"] in SHIP_LINKS and nodes[e["target"]]["type"] == "ship":
            ships_of[e["source"]].add(e["target"])
    for nid, n in nodes.items():
        if n["type"] in ("company", "person"):
            n["program_group"] = _group({nodes[s]["program_group"] for s in ships_of[nid]} | set(n["programs"]))
            n["ship_count"] = len(ships_of[nid])


def merge(base: dict, official: dict, aliases: dict[str, str] | None = None,
          eu_records: list[list[str]] | None = None) -> dict:
    """Long-form {"nodes", "edges", "meta"}: the official layer owns list status; research rides along."""
    official = _official(official, load_aliases() if aliases is None else aliases,
                         load_eu_records() if eu_records is None else eu_records)
    nodes = {n["id"]: dict(n, angle=["lists"], layer="official") for n in official["nodes"]}
    for n in base["nodes"]:
        cur = nodes.get(n["id"])
        if cur is None:
            nodes[n["id"]] = dict(n, layer="research")
        else:
            rest = {k: v for k, v in n.items() if k not in STATUS}
            nodes[n["id"]] = {**rest, **cur, "angle": cur["angle"] + [a for a in n["angle"] if a not in cur["angle"]]}
    edges = {}
    for e in official["edges"]:
        _fold(edges, e, "official")
    for e in base["edges"]:
        _fold(edges, e, "research")
    for e in edges.values():
        for x in (e["source"], e["target"]):
            nodes.setdefault(x, _stub(x))
    for nid, fields in base["node_fields"].items():
        n = nodes.get(nid)
        if n is None:  # a list node that left the lists and that no research edge cites
            continue
        for k, v in fields.items():
            if v in ("", [], {}):
                continue
            if k == "angle":
                n["angle"] = n["angle"] + [a for a in v if a not in n["angle"]]
            else:
                n.setdefault(k, v)  # an official role wins over the research one
    for n in nodes.values():
        for k in ("listed_by", "programs", "aliases"):
            n.setdefault(k, [])
        n["listed"] = bool(n["listed_by"])
    edge_list = [dict(edges[k], id=edge_id(*k)) for k in sorted(edges)]
    _facts(nodes, edge_list)
    graph = {"nodes": [nodes[k] for k in sorted(nodes)], "edges": edge_list, "meta": base["meta"]}
    return apply_naming_policy(graph)


def is_official(url: str) -> bool:
    return any(h in (url or "").lower() for h in OFFICIAL_HOSTS)


def apply_naming_policy(graph: dict) -> dict:
    """An unlisted company keeps its name only when an official record names it in its fleet role (merge.py:194-224).
    Generic companies show their generic name and no aliases; their ids come from the base and are kept."""
    roles, fleet_actor, official_named = defaultdict(set), set(), set()
    for e in graph["edges"]:
        ends = {e["source"], e["target"]}
        if e["type"] in ROLE_WORDS:
            roles[e["source"]].add(ROLE_WORDS[e["type"]])
        if e["type"] in FLEET_ROLES:
            fleet_actor.add(e["source"])
        if e["source"].startswith("IMO") or e["target"].startswith("IMO"):
            fleet_actor |= ends
        if any(is_official(s["url"]) or s["angle"] == "lists" for s in e["sources"]):
            official_named |= ends
    for n in graph["nodes"]:
        if n["type"] != "company":
            continue
        named = n["listed"] or n.get("lobbying_graph") or n["id"] not in fleet_actor
        noted = not named and n["id"] in official_named
        n["name_policy"] = "show" if named or noted else "generic"
        if noted:
            n["name_note"] = NAME_NOTE
        elif n.get("name_note") == NAME_NOTE:
            del n["name_note"]
        c = CNAME.get(n.get("country", ""), "")
        n["generic_name"] = ("unlisted " + (c + " " if c else "") + min(roles[n["id"]], default="company")).strip()
        if n["name_policy"] == "generic":
            n["name"], n["aliases"] = n["generic_name"], []
    return graph


def compact(graph: dict, generated: str) -> dict:
    """The page's FLEET_DATA: a [url, file] source table, a quote table and short edge keys (merge.py:306-355)."""
    sources, quotes, sidx, qidx = [], [], {}, {}

    def ref(table, index, key):
        if key not in index:
            index[key] = len(table)
            table.append(list(key) if isinstance(key, tuple) else key)
        return index[key]

    edges = [{"i": e["id"], "s": e["source"], "t": e["target"], "y": e["type"], "d": e.get("date", ""),
              "c": "D" if e["confidence"] == "Documented" else "L",
              "src": [[ref(sources, sidx, (x["url"] or "", x["file"] or "")), ref(quotes, qidx, (x["quote"] or "")[:300]),
                       x.get("record", ""), x.get("angle", ""), "D" if x.get("confidence") == "Documented" else "L"]
                      for x in e["sources"]],
              **({"n": e["date_note"]} if e.get("date_note") else {})} for e in graph["edges"]]
    nodes = [{k: n[k] for k in KEEP if n.get(k) not in (None, "", [], {})} for n in graph["nodes"]]
    count = lambda t: sum(1 for n in graph["nodes"] if n["type"] == t)  # noqa: E731
    meta = {**graph.get("meta", {}), "generated": generated, "counts": {
        "ships": count("ship"), "companies": count("company"), "people": count("person"),
        "countries": count("country"), "edges": len(edges),
        "documented_edges": sum(1 for e in edges if e["c"] == "D"), "lead_edges": sum(1 for e in edges if e["c"] == "L"),
        "ships_russia_and_iran": sum(1 for n in graph["nodes"] if n["type"] == "ship" and n.get("program_group") == "both"),
    }}
    return {"nodes": nodes, "edges": edges, "sources": sources, "quotes": quotes, "meta": meta}
