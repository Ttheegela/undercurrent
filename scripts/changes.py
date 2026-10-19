"""The daily change record: what a night's build added, removed or changed on each graph.

diff() compares yesterday's and today's graph and returns dated Change dicts; summarize() puts one into plain
English; update_record() files a night's changes into the rolling record that the Updates page, the calendar panel and
Ask read (data/changes/changes.json).

  * graph "fleet" is fleet_merge.merge()'s long form, "lobby" is kg_build.build_kg()'s window.KG shape. `prev` must be
    the graph from before `date` (not one already published that day), and `unavailable` holds this night's names only.
  * The fleet layer is reported once, on graph "fleet" (the network's pages use the same ids). Graph "lobby" holds the
    lobbying layer's additions, the level ("status") of the fleet nodes the network draws, and the listings of the
    firms only the network shows (kg_only).
  * A node is "added" or "removed" only when an official node enters or leaves the graph; a research item never is. A
    ship is on the map because a list names it, so its entering or leaving, and any listed_by change of a ship on both
    days (whatever its layer), is a listing. A company or person is on the map only while a listed vessel names it
    (build_official looks up no others), so its entering or leaving the map claims no listing ("New on the map"), and
    its listed_by is compared only when it was looked up on both days (official on both). A link changes only when it
    enters or leaves the graph. Company ids are slugs of the lists' own spellings, so a respelling is a removal and an
    addition; none has happened yet.
  * A lobby node or link is news only when it carries a filing that yesterday's lobby layer (kg `fl`) did not hold and
    that was posted in the last 14 days (kg `fr`): a registrant renamed in the LDA gets new ids for its whole history,
    a link out of yesterday's graph can return, and a filing a partial fetch lost can come back; LDA posts filings late,
    but not months late.
  * Designations, flags and registrations are node facts (listed_by, flag_now), never links.
  * Nothing a failing source could have caused: a government in `unavailable` is left out of every listing, and an
    item only that government supplied is skipped. "lobbying" covers the whole lobby layer, and lobby links and nodes
    are never reported as removed (a missing filing is a fetch gap).
  * Names: a company that is generic today shows its generic name everywhere, and a company changing between its
    real id and its generic id (fleet_merge.generic_id) is the same company, so a naming flip is not a change.
    Lobbyists in exclude_lobbyists (data/lobbying-clients.json, plus `exclude`) are in no change.
  * Identity is the graph's own id or edge key, never an OpenSanctions entity id, so their churn changes nothing.
  * node_type is the graph's type, except that lobby-layer nodes use a display noun ("lobbyist", "lobbying firm",
    "agency"), and an edge's node_type is its link type.
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
SOURCES = ("us", "uk", "eu", "un", "lobbying")  # the names `unavailable` may hold
PRECEDENCE = ("UK", "US", "EU")  # whose name and flag the merged node takes first (fleet_official.build_official)
FLEET_TYPES = ("ship", "company", "person")
LOBBY_EDGES = ("hired", "lobbyist_at", "lobbied", "lobbied_on")  # the lobby links that count as news
LOBBY_NOUN = {"lobbyfirm": "lobbying firm", "government": "agency"}  # kg `t` of a lobby-layer node (a person: see _kg_view)
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

def _node(nid, t, name, *, type_=None, generic=False, official=True, lobby=False, kg_only=False, flag="", govs=(),
          programs=(), status=None) -> dict:
    govs = set(govs) & set(GOVS)
    return {"id": nid, "t": t, "type": type_ or t, "name": name, "generic": generic, "official": official,
            "lobby": lobby, "kg_only": kg_only, "flag": flag or "", "govs": govs, "programs": set(programs or ()),
            "status": status, "desig": {}, "src": None, "origin": set(govs), "fr": set()}


def _edge(eid, s, t, type_, src, origin, official=True, lobby=False, fl=(), fr=()) -> dict:
    """A lobby link's filings, `fl` (None: not known, as in kg.json from before the change record, which held six per
    link) and `fr`, those of them posted in the last 14 days."""
    return {"id": eid, "s": s, "t": t, "type": type_, "src": src, "origin": origin, "official": official, "lobby": lobby,
            "fl": None if fl is None else set(fl), "fr": set(fr)}


def _link(nodes: dict, edges: list) -> None:
    """What an official link tells its two ends: the first source to cite, which governments supplied it, and (a
    lobby link) its recent filings."""
    for e in edges:
        for end in (e["s"], e["t"]):
            nodes[end]["fr"] |= e["fr"]
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
    lobbyists = {e["s"] for e in graph["edges"] if e["L"] == "lobby" and e["y"] == "lobbyist_at"}
    nodes = {}
    for n in graph["nodes"]:
        if n["L"] in ("fleet", "lobby"):
            lobby, info = n["L"] == "lobby", n.get("info") or {}
            noun = ("lobbyist" if n["id"] in lobbyists else "person") if n["t"] == "person" else LOBBY_NOUN.get(n["t"])
            nodes[n["id"]] = _node(n["id"], n["t"], n["n"], type_=noun if lobby else None,
                                   generic=n["id"].startswith("co:unlisted-"), lobby=lobby, kg_only=bool(n.get("kg_only")),
                                   flag=info.get("flag_now"),
                                   govs=() if lobby else {x[0].split()[0].upper() for x in n["lists"]},
                                   programs=info.get("programs"), status=n["s"])
    edges = [_edge(edge_id(e["s"], e["t"], e["y"]), e["s"], e["t"], e["y"], (e.get("u") or "", e.get("f") or LDA_LABEL),
                   _origin(e.get("f")), lobby=True, fl=e.get("fl"), fr=e.get("fr", ()))
             for e in graph["edges"] if e["L"] == "lobby" and e["s"] in nodes and e["t"] in nodes]
    _link(nodes, edges)
    return nodes, edges


def _page(govs) -> tuple[str, str] | None:
    """The page of the first of `govs` whose list we know."""
    return next(((LISTS[g.lower()]["page"], LISTS[g.lower()]["label"] + " sanctions list") for g in govs
                 if g.lower() in LISTS), None)


def _source(n: dict, govs) -> tuple[str, str]:
    """Where to read about a node: its designation by the first of `govs` that has one, else that government's list
    page, else the first official link that names it."""
    return next((n["desig"][g] for g in govs if g in n["desig"]), None) or _page(govs) or n["src"] or ("", "")


def _facts(p: dict, c: dict, down: set) -> dict:
    """What changed in a node's own fields, as {field: (from, to)}. A fact counts only when both days know it (a list
    that starts to give a flag has not re-flagged the ship), and a generic company's name is the policy's, not its own."""
    norm = lambda s: normalize_name(s) or s.casefold().strip()  # noqa: E731
    first = lambda n: next((g for g in PRECEDENCE if g in n["govs"]), None)  # noqa: E731
    out = {}
    # (the name and flag are the first list's: when the list ranking first changed, another's spelling is no rename)
    if first(p) == first(c) and not (p["generic"] or c["generic"]) and norm(p["name"]) != norm(c["name"]):
        out["name"] = p["name"], c["name"]
    if first(p) == first(c) and p["flag"] and c["flag"] and p["flag"] != c["flag"]:
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
    their previous copy ("us", "uk", "eu", "un", "lobbying"; any other name is an error, not a source to ignore).
    `exclude` adds lobbyist names to the config's list."""
    if graph not in GRAPHS:
        raise ValueError("graph must be one of %s, not %r" % (GRAPHS, graph))
    unknown = set(unavailable) - set(SOURCES)
    if unknown:
        raise ValueError("unknown source name(s) %s; expected some of %s" % (sorted(unknown), SOURCES))
    if prev is None:  # the first run is the baseline
        return []
    view, down = (_fleet_view if graph == "fleet" else _kg_view), {x.upper() for x in unavailable} & set(GOVS)
    # exclude_lobbyists as the lobbying asset gives them, which kg_build adds to the config's
    excluded = _excluded({"exclude_lobbyists": exclude or []}, None)
    views = [view(g) for g in (prev, curr)]
    old = {f for e in views[0][1] for f in e["fl"] or ()}  # every filing in yesterday's lobby layer
    blind = any(e["fl"] is None for e in views[0][1])  # ... unless yesterday's graph did not list them: then nothing
    # lobbying can be called new, as a renamed registrant would read as new (this happens once, on the night of the switch)
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
                                                key=lambda x: (not x["official"], x["name"] == x["id"]))  # not a stub

    def put(kind, item, id_, who, type_, src, keys=(), govs=(), **extra):
        if any(cn.get(k) and cn[k]["generic"] for k in keys):  # the record that named a company we no longer name
            src = _page(govs) or ("", "")  # is not cited for it: the list's page is
        out.append({"date": date, "graph": graph, "kind": kind, "item": item, "id": id_, "name": who, "node_type": type_,
                    **extra, "source_url": src[0], "source_label": src[1]})

    def skipped(origin):  # only a source that kept its previous copy supplied it
        return bool(origin) and origin <= down

    for k in sorted(pn.keys() | cn.keys()):
        p, c = pn.get(k), cn.get(k)
        if c and not p and c["official"] and (graph == "fleet" or c["lobby"]) and not skipped(c["origin"]):
            if c["lobby"] and (blind or not c["fr"] - old):
                continue  # a renamed registrant's filings, or a backfill
            govs = sorted(c["govs"] - down) if c["t"] == "ship" else []  # only a ship's arrival is a listing
            put("added", "node", c["id"], pick(k, 1)["name"], c["type"], _source(c, govs), (k,), govs,
                **({"field": "listed_by", "to": govs} if govs else {}))
        elif p and not c and p["official"] and graph == "fleet" and not skipped(p["origin"]):
            govs = sorted(p["govs"] - down) if p["t"] == "ship" else []
            put("removed", "node", p["id"], pick(k, 0)["name"], p["type"], _source(p, govs), (k,), govs,
                **({"field": "listed_by", "from": govs} if govs else {}))
        elif p and c and not (p["lobby"] or c["lobby"]):
            now = pick(k, 1)
            before, after = p["govs"] - down, c["govs"] - down
            # a ship is looked up in the lists whatever its layer; a company only while a listed vessel names it
            listing = (c["t"] == "ship" or (p["official"] and c["official"])) and (
                graph == "fleet" or p["kg_only"] or c["kg_only"])
            if listing and after - before:
                put("changed", "node", c["id"], now["name"], now["type"], _source(c, sorted(after - before)), (k,),
                    sorted(after - before), field="listed_by", to=sorted(after - before))
            if listing and before - after:
                put("changed", "node", c["id"], now["name"], now["type"], _source(p, sorted(before - after)), (k,),
                    sorted(before - after), field="listed_by", **{"from": sorted(before - after)})
            for field, (was, is_) in (_facts(p, c, down) if p["official"] and c["official"] else {}).items():
                if graph == "fleet" or field == "status":  # the network adds only the level
                    put("changed", "node", c["id"], now["name"], now["type"], _source(c, sorted(c["govs"])), (k,),
                        sorted(c["govs"]), field=field, **{"from": was, "to": is_})

    for k in sorted(pe.keys() | ce.keys()):
        p, c = pe.get(k), ce.get(k)
        e, side = (c, 1) if c and not p else (p, 0) if p and not c else (None, 0)
        if e is None or not e["official"] or skipped(e["origin"]):
            continue
        if e["lobby"] and (side == 0 or e["type"] not in LOBBY_EDGES or blind or not e["fr"] - old):
            continue  # a filing is never deleted, only some lobby links are news, and only on a new recent filing
        a, b = pick(e["s"], side), pick(e["t"], side)
        put("added" if side else "removed", "edge", e["id"], f"{a['name']} → {b['name']}", e["type"], e["src"],
            (e["s"], e["t"]), sorted(e["origin"]), endpoints=[a["name"], b["name"]],
            endpoint_ids=[(cn.get(x) or pn[x])["id"] for x in (e["s"], e["t"])])

    for c in out:
        c["summary"] = summarize(c)
    return sorted(out, key=_order)


def _order(c: dict) -> tuple:
    return c["graph"], c["kind"], c["id"], c.get("field", ""), str(c.get("from", "")), str(c.get("to", ""))


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
    if c["graph"] == "fleet":  # a company is on the map while a listed vessel names it, which says nothing of its listing
        return f"{'New on the map' if kind == 'added' else 'No longer on the map'}: {who}"
    return f"New {type_}: {who}"


def update_record(record: dict | None, date: str, changes: list[dict], sources: dict[str, str],
                  keep_days: int = 120) -> dict:
    """File a night in the rolling record: `sources` says which lists were "fresh" or "unavailable" that night. A
    re-run on a day already held adds to it and never wipes it (its own diff may find nothing, against a graph already
    published that day): a change seen again is not doubled (the later run's row wins; a listing and a delisting of one
    node are two), and a source fresh in either run is fresh. Days past `keep_days` go, and `started` is the oldest day
    held, because a day before it cannot be answered."""
    held = (record or {}).get("days", [])
    same = next((d for d in held if d["date"] == date), {"changes": [], "sources": {}})
    rows = {(c["graph"], c["kind"], c["item"], c["id"], c.get("field"), "to" in c): c
            for c in same["changes"] + list(changes)}
    seen = {k: "fresh" if "fresh" in (same["sources"].get(k), sources.get(k)) else "unavailable"
            for k in same["sources"].keys() | sources.keys()}
    today = {"date": date, "sources": seen, "changes": sorted(rows.values(), key=_order)}
    days = [d for d in held if d["date"] != date] + [today]
    days = sorted(days, key=lambda d: d["date"], reverse=True)[:keep_days]
    return {"started": days[-1]["date"], "days": days}
