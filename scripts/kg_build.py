"""The influence network (window.KG shape) from the live fleet graph, the nightly lobbying asset and the 25 Sep base.

Ported from veil-trace@88dcaa2:research/knowledge-graph/scripts/build_kg.py:78-202: the fleet layer, the lobby layer,
curated bridges, the bridge flag and the orphan-ship drop and count. Node and edge keys are unchanged. What differs:
  * the fleet is merge() output (fleet_merge.py), the lobby layer is build/lobbying.json.gz;
  * the team lobbying nodes ("lob:") and the 30 team and 18 curated edges come from data/kg-base.json, which holds
    them as the original left them: already merged through LOB_ALIAS, typed and hubbed (HUBS, LOB_TYPE), and with
    the "only where no link of ours joins the pair" test applied. So the fleet graph's own "lob:" rows are not read
    (base["lob_alias"] stays in the base for regenerating it);
  * with no lobbying asset, yesterday's lobby layer is carried over from previous_kg.
A fleet node's lists and their dates are merge()'s own (listed_by and listing_dates, fleet_merge._status): the raw
designation edges also hold research designations that no list backs today, and give the "blocked" level only where
they back a government in listed_by.
Hand-checked list status of lobby-side companies lives in base["status"] and is applied last, as the original's curated
status was, but never weaker than the live one: a node shows the stronger of the two levels. Only an asset freeze is
"blocked" (a US SDN entry, a UK row with an asset freeze, an EU Reg. 269/2014 entry); the rest is "restricted", the
page's dashed ring (US SSI and NS-MBS entries, UK specified ships, EU Reg. 833/2014 measures such as the ship listing),
so a ship listed only by the UK or EU is "restricted". The 16 fleet companies in the base are not in base["status"]:
their status is always the live one, and one that today's lists no longer give shows as on no list rather than keep
its 25 Sep status.
"""
from __future__ import annotations

import json
import re
from collections import Counter
from pathlib import Path

from fleet_merge import generic_id
from fleet_official import FREEZES, freezes
from lobbying import exclusion_set, is_excluded
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
LEVELS = ("", "restricted", "blocked")  # a node's status, weakest first
LIST_ORDER = {"ship": ("UK", "US", "EU")}  # the order of a node's lists on 25 Sep; companies and people went US, EU, UK
DEFAULT_LIST_ORDER = ("US", "EU", "UK")
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


def _level(e: dict, ship: bool) -> str:
    """What one designation does to a node: "blocked" if it freezes assets, else "restricted". The edge says which
    (fleet_official.freezes): a US SDN entry, a UK row with an asset freeze, an EU Reg. 269/2014 entry; not a US
    SSI or NS-MBS entry, a UK specified ship, nor an EU Reg. 833/2014 measure. A research designation with no type
    keeps its 25 Sep level; a ship's must say so, since the feeds that list ships type every edge."""
    typed = any(k in e for k in FREEZES)
    return "blocked" if freezes(e) and (typed or not ship) else "restricted"


def _lists(n: dict) -> list:
    """The node's lists as merge() decided them (fleet_merge._status): listed_by and listing_dates, never the raw
    designation edges, which still hold designations that no list backs today."""
    order = LIST_ORDER.get(n["type"], DEFAULT_LIST_ORDER)
    dates = n.get("listing_dates") or {}
    entries = [[GOV_NAMES.get("gov:" + g, g.upper()), "", iso(dates.get(g, ""))] for g in n.get("listed_by") or []]
    return sorted(entries, key=lambda x: order.index(x[0]) if x[0] in order else len(order))


def _fleet_node(n: dict, live: dict) -> dict:
    info = {k: n[k] for k in INFO_KEYS if n.get(k)}
    notes = [r["text"] for r in n.get("research_notes") or []]
    name = n["name"]
    if n.get("name_policy") == "generic":  # unlisted firms known only from non-official sources are not named
        name = n.get("generic_name") or "unlisted company"
        info.pop("aliases", None)
        notes = []
    return {"id": n["id"], "t": n["type"], "n": name, "L": "fleet", "g": n.get("program_group") or "other",
            "s": live.get(n["id"], ""),
            "lists": _lists(n),
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


def _ends(name: str) -> tuple:
    """The first and last word of a normalised name, a Jr/Sr/II suffix left out."""
    words = [w for w in normalize_name(name).split() if w.lower() not in NAME_SUFFIXES]
    return (words[0], words[-1]) if words else ()


def _excluded(lobby: dict | None, exclude: list[str] | None) -> tuple[set[str], set[tuple]]:
    """Lobbyists to leave out, as lobbying.py reads them: the asset's list plus the config's (or `exclude`, when
    given), and the first and last words of each."""
    names = list((lobby or {}).get("exclude_lobbyists") or [])
    names += json.loads(CONFIG.read_text(encoding="utf-8"))["exclude_lobbyists"] if exclude is None else exclude
    full = exclusion_set(names)
    return full, {_ends(x) for x in full}


def _is_excluded(name: str, excluded: tuple[set[str], set[tuple]]) -> bool:
    """lobbying.is_excluded on the full name, or the same first and last word as an excluded name. The node keeps
    only the display name, so "Mary Ann Van Der Berg" must meet the filing builder's "Mary Van Der Berg"; matching
    too many people is the safe side."""
    full, ends = excluded
    return is_excluded(full, name) or _ends(name) in ends


def build_kg(fleet: dict, lobby: dict | None, base: dict, previous_kg: dict | None, generated: str,
             exclude: list[str] | None = None) -> dict:
    """{"meta", "nodes", "edges"} in window.KG shape. `lobby` None means the lobbying asset is unavailable and
    yesterday's lobby layer comes from `previous_kg`. `exclude` replaces the lobbyists listed in
    data/lobbying-clients.json (the asset's own list always applies)."""
    if lobby is None and not previous_kg:
        raise ValueError("no lobbying asset and no previous graph to carry its layer from")
    excluded = _excluded(lobby, exclude)

    # ---- fleet layer -------------------------------------------------------------------------
    by_id = {n["id"]: n for n in fleet["nodes"]}
    live = {}  # node -> its strongest level among the designations that back a government in its listed_by
    for e in fleet["edges"]:
        n = by_id.get(e["source"])
        if e["type"] == "designated_by" and n and e["target"][4:] in (n.get("listed_by") or ()):
            live[n["id"]] = max(live.get(n["id"], ""), _level(e, n["type"] == "ship"), key=LEVELS.index)
    nodes = {n["id"]: _fleet_node(n, live) for n in fleet["nodes"]
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
    # kg-base's lob: nodes and team edges are frozen and already alias-merged, so base["lob_alias"] is not applied here.
    renamed = {n["id"]: generic_id(n["id"]) for n in base["nodes"]
               if n["id"] not in fleet_ids and generic_id(n["id"]) in fleet_ids}  # a fleet firm that turned generic
    for n in base["nodes"]:
        nid = n["id"]
        if nid in renamed:
            continue
        if nid in fleet_ids:  # live names and list status win; the base adds the fields only it has
            nodes[nid] = {**_plain(n), **nodes[nid]}
            if n["info"].get("role"):  # a firm no vessel names has no live role
                nodes[nid]["info"].setdefault("role", n["info"]["role"])
        elif nid not in nodes:
            nodes[nid] = _plain(n)
            if n["L"] == "fleet":  # no ship names it and no list holds it today: 25 Sep's list status is not today's
                nodes[nid].update(s="", lists=[])
    for nid, st in base.get("status", {}).items():  # hand-checked: "restricted" (sectoral) is not "blocked"
        n = nodes.get(nid)
        if n and LEVELS.index(st["s"]) >= LEVELS.index(n["s"]):  # a stronger live listing keeps its own level and lists
            named = {x[0].split()[0] for x in st["lists"]}  # the curated entries describe their governments' listings;
            n.update(s=st["s"], lists=st["lists"] + [x for x in n["lists"] if x[0].split()[0] not in named])  # a new one shows
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
