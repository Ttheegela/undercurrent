"""Split the frozen 25 September graph files into fixed research bases.

The nightly builder rebuilds everything the official lists, OpenSanctions and the lobbying filings can
supply; what only research can supply lives here, in data/fleet-base.json and data/kg-base.json.
Run `python scripts/fleet_base.py` once to write both. It reads the story files as they were at SEP25, so a
rerun after the nightly build has rewritten them still sees the 25 Sep snapshot.
"""
from __future__ import annotations

import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
GENERATED = "2026-09-25"
SEP25 = "ad46320"  # the merge-base on main; its story files are the 25 Sep snapshot
UA_CURRENT = "Ukraine database (current)"

NODE_RESEARCH_FIELDS = (
    "research_notes", "history", "ua_former_names", "ua_flag_countries",
    "name_policy", "generic_name", "name_note", "role", "sources",
)
FLEET_META_KEYS = ("findings", "patterns", "study_counts", "title", "subtitle", "credits", "coverage",
                   "angles", "verified_angles")
# What an edge repeats at its top level from its first source (source key -> edge key).
EDGE_FROM_SOURCE = {"url": "source_url", "file": "source_file", "quote": "quote", "record": "record",
                    "angle": "angle", "confidence": "confidence"}

# Copied from veil-trace@88dcaa2:research/knowledge-graph/scripts/build_kg.py:43-58 (checked by hand 2026-09-25).
LOB_ALIAS = {
    "lob:akin_gump": "lf:akin-gump-strauss-hauer-feld", "lob:arctic_lng_2": "co:arctic-lng-2", "lob:avoq": "lf:avoq",
    "lob:capitol_counsel": "lf:capitol-counsel", "lob:cetc": "co:cetc", "lob:dci_group": "lf:dci-group",
    "lob:dji": "co:sz-dji-technology", "lob:dji_technology_inc": "co:dji", "lob:elevation_association": "lf:elevation-association",
    "lob:en_plus": "co:en-plus-group", "lob:futurewei": "co:huawei", "lob:gazprom": "co:gazprom",
    "lob:hikvision": "co:hangzhou-hikvision", "lob:hikvision_usa": "co:hikvision-usa", "lob:huawei": "co:huawei",
    "lob:huawei_technologies_usa": "co:huawei", "lob:liberty_gov_affairs": "lf:liberty-government-affairs",
    "lob:madison_group": "lf:madison-group", "lob:manatos_manatos": "lf:manatos-manatos",
    "lob:mercury_public_affairs": "lf:mercury-public-affairs", "lob:nord_stream_2": "co:nord-stream-2",
    "lob:novatek": "co:novatek", "lob:podesta_group": "lf:podesta-group", "lob:qorvis_geopols": "lf:qorvis-holding-geopols",
    "lob:roberti_global": "lf:roberti-global-fka-roberti-white", "lob:russian_federation": "gov:russia",
    "lob:russia_finance_ministry": "gov:russia", "lob:sberbank": "co:sberbank", "lob:sberbank_cib_usa": "co:sberbank-cib-usa",
    "lob:scarinci_hollenbeck": "lf:scarinci-hollenbeck", "lob:sidley_austin": "lf:sidley-austin", "lob:smic": "co:smic",
    "lob:squire_patton_boggs": "lf:squire-patton-boggs", "lob:union_oil_gas_ru": "co:union-oil-gas-producers-russia",
    "lob:uscbc": "org:uscbc", "lob:vtb_bank": "co:vtb-bank",
}


def _research_edge(edge: dict) -> dict | None:
    kept = [s for s in edge["sources"] if s["angle"] != "lists"]
    if not kept:
        return None
    out = dict(edge, sources=kept)
    if len(kept) < len(edge["sources"]):  # mixed edge: its top-level evidence must not point at the list any more
        out.update({edge_key: kept[0][source_key] for source_key, edge_key in EDGE_FROM_SOURCE.items()})
    return out


def split_fleet(nodes: list[dict], edges: list[dict], meta: dict) -> dict:
    base_edges = [e for e in map(_research_edge, edges) if e]
    cited = {x for e in base_edges for x in (e["source"], e["target"])}
    node_fields, known_names = {}, {}
    for node in nodes:
        if "lists" not in node["angle"]:
            continue
        fields = {k: node[k] for k in NODE_RESEARCH_FIELDS if k in node}
        if ua := node.get("names_by_source", {}).get(UA_CURRENT):
            fields["ua_current_name"] = ua
        if node["type"] == "company" and node["id"] in cited:  # names to scrub should the firm turn generic
            known_names[node["id"]] = list(dict.fromkeys([node["name"]] + node.get("aliases", [])))
        angle = [a for a in node["angle"] if a != "lists"]
        if angle:
            fields["angle"] = angle
        if fields:
            node_fields[node["id"]] = fields
    return {
        "nodes": [n for n in nodes if "lists" not in n["angle"]],
        "edges": base_edges,
        "node_fields": node_fields,
        "known_names": known_names,
        "meta": {k: meta[k] for k in FLEET_META_KEYS},
        "generated": GENERATED,
    }


def split_kg(kg: dict) -> dict:
    edges = [e for e in kg["edges"] if e["L"] in ("team", "curated")]
    ends = {e["s"] for e in edges} | {e["t"] for e in edges}
    return {
        "nodes": [n for n in kg["nodes"] if n["id"] in ends],
        "edges": edges,
        "lob_alias": dict(LOB_ALIAS),
        # the 25 Sep AIS sightings sit on fleet ships, which are rarely edge endpoints, so they are kept by id
        "live_flags": {n["id"]: n["live"] for n in kg["nodes"] if "live" in n},
        # hand-checked list status of lobby-side companies (Nord Stream 2, Huawei ...); most are not edge endpoints
        "status": {n["id"]: {"s": n["s"], "lists": n["lists"]} for n in kg["nodes"]
                   if n["L"] == "lobby" and (n["s"] or n["lists"])},
        "meta": {"no_lobbying_found": kg["meta"]["no_lobbying_found"], "live": kg["meta"]["live"]},
    }


def load_fleet_base(path: Path = DATA / "fleet-base.json") -> dict:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def load_kg_base(path: Path = DATA / "kg-base.json") -> dict:
    return json.loads(Path(path).read_text(encoding="utf-8"))


def kg_extra_companies(kg_base: dict, fleet_base: dict | None = None) -> dict[str, str]:
    """{id: name} of the fleet companies the kg base holds that the fleet base does not know: pass to
    fleet_official.build_official so each is looked up in today's lists even when no vessel names it (Zara Shipholding
    and Skyhart are linked to Arctic LNG 2, not to a ship). The fleet base's own companies are left alone, so the
    map's payload does not change."""
    fleet_base = fleet_base or {"nodes": [], "edges": [], "node_fields": {}}
    known = {n["id"] for n in fleet_base["nodes"]} | set(fleet_base["node_fields"])
    known |= {x for e in fleet_base["edges"] for x in (e["source"], e["target"])}
    return {n["id"]: n["n"] for n in kg_base["nodes"] if n["L"] == "fleet" and n["t"] == "company" and n["id"] not in known}


def sep25_text(path: str) -> str:
    """A repo file as it was at SEP25; fails rather than read anything newer."""
    return subprocess.run(["git", "-C", str(ROOT), "show", f"{SEP25}:{path}"], check=True, capture_output=True,
                          text=True, encoding="utf-8").stdout


def _write(path: Path, data: dict) -> None:
    path.write_text(json.dumps(data, sort_keys=True, indent=0, ensure_ascii=False) + "\n", encoding="utf-8")


if __name__ == "__main__":
    load = lambda name: json.loads(sep25_text("stories/shadow-fleet/network/" + name))  # noqa: E731
    fleet = split_fleet(load("nodes.json"), load("edges.json"), load("meta.json"))
    js = sep25_text("stories/who-lobbies/influence-network/kg_data.js")
    kg = split_kg(json.loads(js.strip().removeprefix("window.KG=").removesuffix(";")))
    DATA.mkdir(exist_ok=True)
    _write(DATA / "fleet-base.json", fleet)
    _write(DATA / "kg-base.json", kg)
    print(f"fleet base: {len(fleet['nodes'])} nodes, {len(fleet['edges'])} edges, "
          f"{len(fleet['node_fields'])} list nodes with research fields")
    print(f"kg base: {len(kg['nodes'])} nodes, {len(kg['edges'])} edges, "
          f"{len(kg['live_flags'])} live flags, {len(kg['lob_alias'])} lob aliases, {len(kg['status'])} curated statuses")
