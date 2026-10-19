"""The daily change record: what a night's build added, removed or changed on each graph.

diff() compares yesterday's and today's graph and returns dated Change dicts; summarize() puts one into plain
English; update_record() files a night's changes into the rolling record that the Updates page, the calendar panel and
Ask read (data/changes/changes.json).

  * graph "fleet" is fleet_merge.merge()'s long form, "lobby" is kg_build.build_kg()'s window.KG shape.
  * The fleet layer is reported once, on graph "fleet" (the network's pages use the same ids). Graph "lobby" holds the
    lobbying layer's additions and the level ("status") of the fleet nodes the network draws.
  * A node is "added" or "removed" only when an official node enters or leaves the graph; a research item never is. A
    delisted ship that a research edge keeps on the map stays, and its listing change is a "changed" row: listed_by is
    compared for every node on both days, whatever its layer. A link changes only when it enters or leaves the graph.
  * Designations, flags and registrations are node facts (listed_by, flag_now), never links.
  * Nothing a failing source could have caused: a government in `unavailable` is left out of every listing, and an
    item only that government supplied is skipped. "lobbying" covers the whole lobby layer, and lobby links and nodes
    are never reported as removed (a missing filing is a fetch gap).
  * Names: a company that is generic today shows its generic name everywhere, and a company changing between its
    real id and its generic id (fleet_merge.generic_id) is the same company, so a naming flip is not a change.
    Lobbyists in exclude_lobbyists (data/lobbying-clients.json, plus `exclude`) are in no change.
  * Identity is the graph's own id or edge key, never an OpenSanctions entity id, so their churn changes nothing.
"""
from __future__ import annotations

import re

from fleet_merge import _map_graph, edge_id, generic_id
from fleet_official import CNAME
from kg_build import _excluded, _is_excluded
from lists import LISTS
from normalize import normalize_name

GRAPHS = ("fleet", "lobby")
GOVS = ("EU", "UK", "UN", "US")
FLEET_TYPES = ("ship", "company", "person")
LOBBY_EDGES = ("hired", "lobbyist_at", "lobbied", "lobbied_on")  # the lobby links that count as news
LOBBY_NOUN = {"person": "lobbyist", "lobbyfirm": "lobbying firm", "government": "agency"}  # kg `t` of a lobby-layer node
LDA_LABEL = "US Senate lobbying disclosure (LDA)"
# edge type -> (label, flipped): a flipped link reads "target → source (label)", e.g. a manager's `manages` edge as
# "TASSOS → Zulu (managed by)". The lobby types read "source label target" instead.
LINKS = {"manages": ("managed by", True), "owns": ("owned by", True), "operates": ("operated by", True),
         "formerly_operated": ("formerly operated by", True), "linked_to": ("linked to", True),
         "controls": ("controlled by", True), "hired": ("hired", False), "lobbied": ("lobbied", False),
         "lobbied_on": ("lobbied on", False), "lobbyist_at": ("is a lobbyist at", False)}
FIELDS = {"flag_now": "flag", "programs": "programmes", "status": "status"}
ORIGIN = re.compile(r"(UK|US|EU|UN|OFAC)\b")  # how the lists label their own records ("UK Sanctions List", "OFAC SDN ...")


def _origin(*labels) -> set:
    return {"US" if m.group(1) == "OFAC" else m.group(1) for x in labels if (m := ORIGIN.match(x or ""))}


# ---- one shape for both graphs ----------------------------------------------------------------------

def _node(nid, t, name, *, type_=None, generic=False, official=True, lobby=False, flag="", govs=(), programs=(),
          status=None) -> dict:
    govs = set(govs) & set(GOVS)
    return {"id": nid, "t": t, "type": type_ or t, "name": name, "generic": generic, "official": official,
            "lobby": lobby, "flag": flag or "", "govs": govs, "programs": set(programs or ()), "status": status,
            "desig": {}, "src": None, "origin": set(govs)}


def _edge(eid, s, t, type_, src, origin, official=True, lobby=False) -> dict:
    return {"id": eid, "s": s, "t": t, "type": type_, "src": src, "origin": origin, "official": official, "lobby": lobby}


def _link(nodes: dict, edges: list) -> None:
    """What an official link tells its two ends: the first source to cite, and which governments supplied it."""
    for e in edges:
        for end in (e["s"], e["t"]):
            if e["official"]:
                nodes[end]["src"] = nodes[end]["src"] or e["src"]
                nodes[end]["origin"] |= e["origin"]


def _fleet_view(graph: dict) -> tuple[dict, list]:
    """The map's ships, companies and people and the links between them. A company only the network asked for
    (kg_only) is not on the map, so it is not in the record either."""
    graph = _map_graph(graph)
    nodes = {n["id"]: _node(n["id"], n["type"], n["name"], generic=n.get("name_policy") == "generic",
                            official=n.get("layer") == "official", flag=n.get("flag_now"),
                            govs={g.upper() for g in n.get("listed_by") or ()}, programs=n.get("programs"))
             for n in graph["nodes"] if n["type"] in FLEET_TYPES}
    edges = []
    for e in sorted(graph["edges"], key=lambda e: e["layer"] != "official"):  # the list's own record is cited first
        first = (e.get("sources") or [{}])[0]
        src = (first.get("url") or e.get("source_url") or "", first.get("file") or e.get("source_file") or "")
        if e["type"] == "designated_by" and e["target"].startswith("gov:") and e["source"] in nodes:
            nodes[e["source"]]["desig"].setdefault(e["target"][4:].upper(), src)
        elif e["source"] in nodes and e["target"] in nodes:  # not a flag, a registration or a government
            edges.append(_edge(e["id"], e["source"], e["target"], e["type"], src,
                               _origin(*(x.get("file") for x in e.get("sources") or [])), e["layer"] == "official"))
    _link(nodes, edges)
    return nodes, edges


def _kg_view(graph: dict) -> tuple[dict, list]:
    """The network's nodes (the fleet layer for its level and as link ends) and its lobby links; the base's team and
    curated links are fixed and left out, and the fleet layer's links are the map's to report."""
    nodes = {}
    for n in graph["nodes"]:
        if n["L"] in ("fleet", "lobby"):
            lobby, info = n["L"] == "lobby", n.get("info") or {}
            nodes[n["id"]] = _node(n["id"], n["t"], n["n"], type_=LOBBY_NOUN.get(n["t"]) if lobby else None,
                                   generic=n["id"].startswith("co:unlisted-"), lobby=lobby, flag=info.get("flag_now"),
                                   govs=() if lobby else {x[0].split()[0].upper() for x in n["lists"]},
                                   programs=info.get("programs"), status=n["s"])
    edges = [_edge(edge_id(e["s"], e["t"], e["y"]), e["s"], e["t"], e["y"], (e.get("u") or "", e.get("f") or LDA_LABEL),
                   _origin(e.get("f")), lobby=True)
             for e in graph["edges"] if e["L"] == "lobby" and e["s"] in nodes and e["t"] in nodes]
    _link(nodes, edges)
    return nodes, edges


def _source(n: dict, govs) -> tuple[str, str]:
    """Where to read about a node: its designation by the first of `govs` that has one, else that government's list
    page, else the first official link that names it."""
    for g in govs:
        if g in n["desig"]:
            return n["desig"][g]
    for g in govs:
        if g.lower() in LISTS:
            return LISTS[g.lower()]["page"], LISTS[g.lower()]["label"] + " sanctions list"
    return n["src"] or ("", "")


def _facts(p: dict, c: dict, down: set) -> dict:
    """What changed in a node's own fields, as {field: (from, to)}. A fact counts only when both days know it (a list
    that starts to give a flag has not re-flagged the ship), and a generic company's name is the policy's, not its own."""
    norm = lambda s: normalize_name(s) or s.casefold().strip()  # noqa: E731
    out = {}
    if not (p["generic"] or c["generic"]) and norm(p["name"]) != norm(c["name"]):
        out["name"] = p["name"], c["name"]
    if p["flag"] and c["flag"] and p["flag"] != c["flag"]:
        out["flag_now"] = CNAME.get(p["flag"], p["flag"]), CNAME.get(c["flag"], c["flag"])
    if p["programs"] and c["programs"] and p["programs"] != c["programs"]:
        out["programs"] = sorted(p["programs"]), sorted(c["programs"])
    if None not in (p["status"], c["status"]) and p["status"] != c["status"] and not (p["govs"] | c["govs"]) & down:
        out["status"] = p["status"], c["status"]  # (a failed list may have set either level)
    return out


# ---- diff --------------------------------------------------------------------------------------------

def diff(prev: dict | None, curr: dict, graph: str, date: str, unavailable: set[str],
         exclude: list[str] | None = None) -> list[dict]:
    """Today's changes to `graph` ("fleet" or "lobby") against yesterday's. `unavailable` holds the sources that kept
    their previous copy ("us", "uk", "eu", "un", "lobbying"). `exclude` adds lobbyist names to the config's list."""
    if graph not in GRAPHS:
        raise ValueError("graph must be one of %s, not %r" % (GRAPHS, graph))
    if prev is None:  # the first run is the baseline
        return []
    view, down = (_fleet_view if graph == "fleet" else _kg_view), {x.upper() for x in unavailable} & set(GOVS)
    excluded = _excluded({"exclude_lobbyists": exclude or []}, None)
    views = [view(g) for g in (prev, curr)]
    ids = {i for nodes, _ in views for i in nodes}
    # a company turned generic (or named) has a new id but is the same company
    canon = {generic_id(i): i for i in ids if i.startswith("co:") and not i.startswith("co:unlisted-")}
    key = lambda i: canon.get(i, i)  # noqa: E731
    sides = []
    for nodes, edges in views:  # lobbyists to leave out and, when lobbying kept its copy, the whole lobby layer
        drop = {i for i, n in nodes.items() if (n["t"] == "person" and _is_excluded(n["name"], excluded))
                or ("lobbying" in unavailable and n["lobby"])}
        sides.append(({key(i): n for i, n in nodes.items() if i not in drop},
                      {(key(e["s"]), key(e["t"]), e["type"]): dict(e, s=key(e["s"]), t=key(e["t"])) for e in edges
                       if not {e["s"], e["t"]} & drop and not ("lobbying" in unavailable and e["lobby"])}))
    (pn, pe), (cn, ce) = sides
    out = []

    def pick(k, today):
        """The node as shown: today's, or yesterday's when today's is only a research stub (named by its id). A
        company that is generic today is generic in every change."""
        c, p = cn.get(k), pn.get(k)
        return c if c and c["generic"] else min([x for x in ((c, p) if today else (p, c)) if x],
                                                key=lambda x: not x["official"])

    def put(kind, item, id_, who, type_, src, **extra):
        out.append({"date": date, "graph": graph, "kind": kind, "item": item, "id": id_, "name": who, "node_type": type_,
                    **extra, "source_url": src[0], "source_label": src[1]})

    def skipped(origin):  # only a source that kept its previous copy supplied it
        return bool(origin) and origin <= down

    for k in sorted(pn.keys() | cn.keys()):
        p, c = pn.get(k), cn.get(k)
        if c and not p and c["official"] and (graph == "fleet" or c["lobby"]):
            govs = sorted(c["govs"] - down)
            if not skipped(c["origin"]):
                put("added", "node", c["id"], pick(k, 1)["name"], c["type"], _source(c, govs or sorted(c["govs"])),
                    **({"field": "listed_by", "to": govs} if govs else {}))
        elif p and not c and p["official"] and graph == "fleet":
            govs = sorted(p["govs"] - down)
            if not skipped(p["origin"]):
                put("removed", "node", p["id"], pick(k, 0)["name"], p["type"], _source(p, govs or sorted(p["govs"])),
                    **({"field": "listed_by", "from": govs} if govs else {}))
        elif p and c and not (p["lobby"] or c["lobby"]):
            now = pick(k, 1)
            before, after = p["govs"] - down, c["govs"] - down
            if graph == "fleet" and after - before:
                put("changed", "node", c["id"], now["name"], now["type"], _source(c, sorted(after - before)),
                    field="listed_by", to=sorted(after - before))
            if graph == "fleet" and before - after:
                put("changed", "node", c["id"], now["name"], now["type"], _source(p, sorted(before - after)),
                    field="listed_by", **{"from": sorted(before - after)})
            for field, (was, is_) in (_facts(p, c, down) if p["official"] and c["official"] else {}).items():
                if graph == "fleet" or field == "status":  # the network adds only the level
                    put("changed", "node", c["id"], now["name"], now["type"], _source(c, sorted(c["govs"])),
                        field=field, **{"from": was, "to": is_})

    for k in sorted(pe.keys() | ce.keys()):
        p, c = pe.get(k), ce.get(k)
        e, side = (c, 1) if c and not p else (p, 0) if p and not c else (None, 0)
        if e is None or not e["official"] or skipped(e["origin"]):
            continue
        if e["lobby"] and (side == 0 or e["type"] not in LOBBY_EDGES):
            continue  # a filing is never deleted, and only some lobby links are news
        a, b = pick(e["s"], side), pick(e["t"], side)
        put("added" if side else "removed", "edge", e["id"], f"{a['name']} → {b['name']}", e["type"], e["src"],
            endpoints=[a["name"], b["name"]], endpoint_ids=[(cn.get(x) or pn[x])["id"] for x in (e["s"], e["t"])])

    for c in out:
        c["summary"] = summarize(c)
    return sorted(out, key=lambda c: (c["graph"], c["kind"], c["id"], c.get("field", ""), str(c.get("from", "")),
                                      str(c.get("to", ""))))


def _join(items: list) -> str:
    return items[0] if len(items) == 1 else ", ".join(items[:-1]) + " and " + items[-1]


def _show(value) -> str:
    return ", ".join(value) if isinstance(value, list) else value or "none"


def summarize(c: dict) -> str:
    """One change in plain English."""
    kind, type_, field = c["kind"], c["node_type"], c.get("field")
    if c["item"] == "edge":
        a, b = c["endpoints"]
        label, flipped = LINKS.get(type_) or (type_.replace("_", " "), False)
        if type_ in LOBBY_EDGES:
            return f"{a} {label} {b}"
        a, b = (b, a) if flipped else (a, b)
        return f"{'New link' if kind == 'added' else 'Link removed'}: {a} → {b} ({label})"
    imo = f" (IMO {c['id'][3:]})" if type_ == "ship" and c["id"].startswith("IMO") else ""
    who = c["name"] + imo
    if field == "listed_by":
        return f"{_join(c['to'])} listed {who}" if c.get("to") else f"{_join(c['from'])} removed {who}"
    if field == "name":
        return f"Renamed: {c['from']} → {c['to']}{imo}"
    if field:
        return f"{c['name']} changed {FIELDS[field]}: {_show(c['from'])} → {_show(c['to'])}"
    return f"{'New' if kind == 'added' else 'Removed'} {type_}: {who}"


def update_record(record: dict | None, date: str, changes: list[dict], sources: dict[str, str],
                  keep_days: int = 120) -> dict:
    """File a night in the rolling record: `sources` says which lists were "fresh" or "unavailable" that night. A
    re-run replaces its own day. Days past `keep_days` go, and `started` is the oldest day held, because a day before
    it cannot be answered."""
    days = [d for d in (record or {}).get("days", []) if d["date"] != date]
    days.append({"date": date, "sources": dict(sources), "changes": list(changes)})
    days = sorted(days, key=lambda d: d["date"], reverse=True)[:keep_days]
    return {"started": days[-1]["date"], "days": days}
