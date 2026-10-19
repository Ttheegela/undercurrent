"""One-off: write data/fleet-company-aliases.json, the fixed company alias table the fleet merge applies.

On 25 Sep a fuzzy name merge (not ported) put a few official spellings of one firm on one node, e.g. the UK
list's "Zulu Ships Management" on OFAC's "THE ZULU SHIPS MANAGEMENT AND OPERATION - SOLE PROPRIETORSHIP L.L.C".
The live builder never guesses. Instead each company the official layer builds today under an id the 25 Sep
graph did not have is looked up by its exact normalised name among the 25 Sep companies' names and aliases;
a single hit maps that norm_co key to the 25 Sep co: id. Lobbying-graph (lob:) and generic nodes are not targets.
It reads nodes.json as it was at fleet_base.SEP25 (the 25 Sep snapshot), never the live file the nightly build
rewrites, so a rerun cannot derive the table from the wrong graph. Run with build/raw in place:
    python scripts/fleet_aliases.py
"""
from __future__ import annotations

import json
from collections import defaultdict
from pathlib import Path

from fleet_base import sep25_text
from fleet_official import build_official, norm_co

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "fleet-company-aliases.json"


def derive(sep25_nodes: list[dict], official_nodes: list[dict]) -> dict[str, str]:
    known = {n["id"] for n in sep25_nodes}
    holders = defaultdict(set)
    for n in sep25_nodes:
        if n["id"].startswith("co:") and n.get("name_policy") != "generic":
            for name in [n["name"]] + n.get("aliases", []):
                if key := norm_co(name):
                    holders[key].add(n["id"])
    table = {}
    for n in official_nodes:
        if n["id"].startswith("co:") and n["id"] not in known:
            key = norm_co(n["name"])
            hits = holders.get(key, set())
            if len(hits) == 1:
                table[key] = next(iter(hits))
            elif hits:
                print(f"skipped, more than one 25 Sep company: {key!r} -> {sorted(hits)}")
    return dict(sorted(table.items()))


if __name__ == "__main__":
    sep25 = json.loads(sep25_text("stories/shadow-fleet/network/nodes.json"))
    table = derive(sep25, build_official(ROOT / "build" / "raw")["nodes"])
    OUT.write_text(json.dumps(table, indent=1, sort_keys=True, ensure_ascii=False) + "\n", encoding="utf-8")
    for key, cid in table.items():
        print(f"{key!r} -> {cid}")
    print(f"{len(table)} aliases written to {OUT.relative_to(ROOT)}")
