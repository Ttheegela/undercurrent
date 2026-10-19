"""The influence network (window.KG shape) from the live fleet graph, the nightly lobbying asset and the 25 Sep base.

Ported from veil-trace@88dcaa2:research/knowledge-graph/scripts/build_kg.py:78-202: the fleet layer, the lobby layer,
curated bridges, the bridge flag and the orphan-ship drop and count. Node and edge keys are unchanged. What differs:
  * the fleet is merge() output (fleet_merge.py), the lobby layer is build/lobbying.json.gz;
  * the team lobbying nodes ("lob:") and the 30 team and 18 curated edges come from data/kg-base.json, which holds
    them as the original left them: already merged through LOB_ALIAS, typed and hubbed (HUBS, LOB_TYPE), and with
    the "only where no link of ours joins the pair" test applied. So the fleet graph's own "lob:" rows are not read
    (base["lob_alias"] stays in the base for regenerating it);
  * with no lobbying asset, yesterday's lobby layer is carried over from previous_kg.
Hand-checked list status of lobby-side companies lives in base["status"] and is applied last, as the original's curated
status was. The 16 fleet companies in the base are not in it: their status is always the live one.
"""
from __future__ import annotations

import hashlib
import json
import re
from collections import Counter, defaultdict
from pathlib import Path

from normalize import normalize_name

ROOT = Path(__file__).resolve().parent.parent
CONFIG = ROOT / "data" / "lobbying-clients.json"

DROP_EDGE_TYPES = {"designated_by", "flagged_in", "formerly_flagged_in", "registered_in"}
CONF = {"Documented": "D", "Reported": "R", "Lead": "L", "D": "D", "L": "L", "R": "R"}
GOV_NAMES = {"gov:us": "US", "gov:uk": "UK", "gov:eu": "EU", "gov:ca": "Canada", "gov:au": "Australia",
             "gov:ch": "Switzerland", "gov:nz": "New Zealand"}
INFO_KEYS = ("imo", "aliases", "role", "ship_type", "year_built", "flag_now", "flags_before", "country", "named_by",
             "programs", "first_listed")
LOBBY_INFO_KEYS = ("role", "country", "title", "covered_positions", "lda_names")
DERIVED = ("k", "br", "nolobby")  # worked out afresh on every build, never copied from a base or yesterday's graph
NAME_SUFFIXES = {"jr", "sr", "ii", "iii", "iv"}
GENERATED_FROM = ["UK, US and EU sanctions lists and OpenSanctions (nightly)", "US Senate lobbying disclosures (LDA)",
                  "hand-checked links and 25 Sep 2026 research (data/kg-base.json)"]


def iso(d: str) -> str:
    """Dates arrive as YYYY-MM-DD, YYYY or DD/MM/YYYY; return YYYY-MM-DD / YYYY-MM / YYYY or ''."""
    d = (d or "").strip()
    m = re.fullmatch(r"(\d{2})/(\d{2})/(\d{4})", d)
    if m:
        return "%s-%s-%s" % (m.group(3), m.group(2), m.group(1))
    return d if re.match(r"\d{4}", d) else ""


def _generic_id(nid: str) -> str:
    """The id fleet_merge._rename_generic gives a company that has turned generic."""
    return "co:unlisted-" + hashlib.sha1(nid.encode()).hexdigest()[:8]


def _fleet_node(n: dict, listed_dates: dict) -> dict:
    lb = n.get("listed_by") or []
    info = {k: n[k] for k in INFO_KEYS if n.get(k)}
    notes = [r["text"] for r in n.get("research_notes") or []]
    name = n["name"]
    if n.get("name_policy") == "generic":  # unlisted firms known only from non-official sources are not named
        name = n.get("generic_name") or "unlisted company"
        info.pop("aliases", None)
        notes = []
    return {"id": n["id"], "t": n["type"], "n": name, "L": "fleet", "g": n.get("program_group") or "other",
            "s": "blocked" if n.get("listed") or lb else "",
            "lists": [[k.upper() if len(k) == 2 else k, "", v] for k, v in listed_dates.get(n["id"], {}).items()]
                     or [[x.upper(), "", ""] for x in lb],
            "info": info, "notes": notes[:3],
            "unverified_person": n["type"] == "person" and not (n.get("named_by") or n.get("listed"))}


def _fleet_edge(e: dict) -> dict:
    return {"s": e["source"], "t": e["target"], "y": e["type"], "c": CONF.get(e.get("confidence"), "D"),
            "d": iso(e.get("date", "")), "u": e.get("source_url", ""), "f": e.get("source_file", ""),
            "r": e.get("record", ""), "q": (e.get("quote") or "")[:240], "L": "fleet"}


def _lobby_node(n: dict) -> dict:
    return {"id": n["id"], "t": n["type"], "n": n["name"], "L": "lobby", "g": n.get("group", ""), "s": "",
            "lists": [], "info": {k: n[k] for k in LOBBY_INFO_KEYS if n.get(k)}, "notes": []}


def _lobby_edge(e: dict) -> dict:
    yrs = e.get("years") or []
    return {"s": e["source"], "t": e["target"], "y": e["type"], "c": "D",
            "d": "%s" % yrs[0] if yrs else "", "d2": "%s" % yrs[-1] if yrs else "",
            "u": e["source_url"], "r": "%d filing%s" % (e["n_filings"], "" if e["n_filings"] == 1 else "s"),
            "ids": e["filings"][:6], "a": e.get("amount", 0), "q": " | ".join(e.get("texts", []))[:300],
            "pct": e.get("ownership_pct", ""), "sa": e.get("sub_amount", 0), "sub": e.get("subcontract", False),
            "L": "lobby"}


def _plain(item: dict, keys=DERIVED) -> dict:
    return {k: v for k, v in item.items() if k not in keys}


def _excluded(lobby: dict | None, exclude: list[str] | None) -> set[str]:
    """Normalised names of lobbyists to leave out: the asset's list plus the config's (or `exclude`, when given)."""
    names = list((lobby or {}).get("exclude_lobbyists") or [])
    names += json.loads(CONFIG.read_text(encoding="utf-8"))["exclude_lobbyists"] if exclude is None else exclude
    return {normalize_name(x) for x in names} - {""}


def _is_excluded(name: str, excluded: set[str]) -> bool:
    """The filing builder matches the full name and first + last name; the node keeps only the full name, so first
    + last is its first and last word without a Jr/Sr/II suffix (a two-word first name or surname is missed)."""
    words = [w for w in name.split() if w.strip(".,").lower() not in NAME_SUFFIXES]
    short = " ".join(words[:1] + words[-1:] if len(words) > 1 else words)
    return bool({normalize_name(name), normalize_name(short)} & excluded)


def build_kg(fleet: dict, lobby: dict | None, base: dict, previous_kg: dict | None, generated: str,
             exclude: list[str] | None = None) -> dict:
    """{"meta", "nodes", "edges"} in window.KG shape. `lobby` None means the lobbying asset is unavailable and
    yesterday's lobby layer comes from `previous_kg`. `exclude` replaces the lobbyists listed in
    data/lobbying-clients.json (the asset's own list always applies)."""
    if lobby is None and not previous_kg:
        raise ValueError("no lobbying asset and no previous graph to carry its layer from")
    excluded = _excluded(lobby, exclude)

    # ---- fleet layer -------------------------------------------------------------------------
    listed_dates = defaultdict(dict)  # node -> {gov name: date}
    for e in fleet["edges"]:
        if e["type"] == "designated_by" and e["target"] in GOV_NAMES:
            listed_dates[e["source"]].setdefault(GOV_NAMES[e["target"]], iso(e.get("date", "")))
    nodes = {n["id"]: _fleet_node(n, listed_dates) for n in fleet["nodes"]
             if n["type"] not in ("country", "government") and not n["id"].startswith("lob:")}
    fleet_ids = set(nodes)
    edges = [_fleet_edge(e) for e in fleet["edges"]
             if e["type"] not in DROP_EDGE_TYPES and e["source"] in nodes and e["target"] in nodes]

    # ---- lobby layer: today's asset, or yesterday's layer ---------------------------------------
    if lobby is not None:
        lobby_nodes = [_lobby_node(n) for n in lobby["nodes"]]
        lobby_edges = [_lobby_edge(e) for e in lobby["edges"]]
        filings = lobby["filings_scanned"], lobby["filings_kept"]
    else:
        lobby_nodes = [_plain(n) for n in previous_kg["nodes"] if n["L"] == "lobby"]
        lobby_edges = [_plain(e, ("br",)) for e in previous_kg["edges"] if e["L"] == "lobby"]
        counts = previous_kg["meta"]["counts"]
        filings = counts["lda_filings_scanned"], counts["lda_filings_kept"]
    people = {n["id"] for n in lobby_nodes if n["t"] == "person" and _is_excluded(n["n"], excluded)}
    for n in lobby_nodes:
        if n["id"] in people:
            continue
        if n["id"] in nodes:  # the same company is on the fleet side: it bridges the two sides
            nodes[n["id"]]["br"] = True
        else:
            nodes[n["id"]] = n

    # ---- base: team lobbying nodes, curated bridges, and what only the 25 Sep research holds -------------
    renamed = {n["id"]: _generic_id(n["id"]) for n in base["nodes"]
               if n["id"] not in fleet_ids and _generic_id(n["id"]) in fleet_ids}  # a fleet firm that turned generic
    for n in base["nodes"]:
        nid = n["id"]
        if nid in renamed:
            continue
        if nid in fleet_ids:  # live names and list status win; the base adds the fields only it has
            nodes[nid] = {**_plain(n), **nodes[nid]}
        elif nid not in nodes:
            nodes[nid] = _plain(n)
    for nid, st in base.get("status", {}).items():  # hand-checked: "restricted" (sectoral) is not "blocked"
        if nid in nodes:
            nodes[nid].update(s=st["s"], lists=st["lists"])
    for nid, seen in base["live_flags"].items():
        if nid in nodes:
            nodes[nid]["live"] = seen
    edges += [e for e in lobby_edges if not {e["s"], e["t"]} & people and e["s"] in nodes and e["t"] in nodes]
    for kind in ("curated", "team"):
        for e in base["edges"]:
            if e["L"] == kind:
                e = dict(_plain(e, ("br",)), s=renamed.get(e["s"], e["s"]), t=renamed.get(e["t"], e["t"]))
                if e["s"] not in nodes or e["t"] not in nodes:
                    raise ValueError("base edge points at unknown node %s -> %s" % (e["s"], e["t"]))
                edges.append(e)

    # A bridge is any link with one end on the lobbying side and the other in the fleet.
    for e in edges:
        if {nodes[e["s"]]["L"], nodes[e["t"]]["L"]} == {"lobby", "fleet"}:
            e["br"] = True
            nodes[e["s"]]["br"] = nodes[e["t"]]["br"] = True
    filed = {x for e in edges if e["L"] == "lobby" for x in (e["s"], e["t"])}
    for nid in base["meta"]["no_lobbying_found"]["match"]:
        if nid in nodes and nid not in filed:  # a filing found since 25 Sep makes the badge untrue
            nodes[nid]["nolobby"] = True

    # Hide nodes with no remaining links (ships whose owner/operator no list names): count the ships.
    deg = Counter(x for e in edges for x in (e["s"], e["t"]))
    orphans = [nid for nid in nodes if not deg[nid]]
    orphan_ships = sum(1 for nid in orphans if nodes[nid]["t"] == "ship")
    for nid in orphans:
        del nodes[nid]
    for nid, n in nodes.items():
        n["k"] = deg[nid]

    meta = {
        "generated": generated,
        "generated_from": GENERATED_FROM,
        "counts": {"nodes": len(nodes), "edges": len(edges), "by_type": dict(Counter(n["t"] for n in nodes.values())),
                   "by_layer": dict(Counter(n["L"] for n in nodes.values())),
                   "edge_types": dict(Counter(e["y"] for e in edges)),
                   "lead_edges": sum(1 for e in edges if e["c"] == "L"),
                   "ships_hidden_no_owner_link": orphan_ships,
                   "lda_filings_scanned": filings[0], "lda_filings_kept": filings[1]},
        "no_lobbying_found": base["meta"]["no_lobbying_found"],
        "live": base["meta"]["live"],
    }
    return {"meta": meta, "nodes": list(nodes.values()), "edges": edges}
