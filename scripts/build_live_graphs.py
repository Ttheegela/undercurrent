"""Nightly: rebuild the shadow-fleet map and the influence network, file the day's changes, write the site figures.

Runs the pieces in order: fleet_official.build_official (the lists, with the companies the network asks about),
fleet_merge.merge and compact, kg_build.build_kg, changes.diff and update_record. Writes, all as plain .json:
  stories/shadow-fleet/network/fleet-data.json   the map's payload (compact)
  stories/shadow-fleet/network/nodes.json, edges.json   the same graph in long form (build_research_index reads them)
  stories/who-lobbies/influence-network/kg.json  the network
  data/changes/changes.json                      the rolling change record
  data/site-stats.json                           the counts the pages show
  data/live-graphs-meta.json                     the run's status, like the other data/*-meta.json, with the sources
                                                 unavailable that night and the firms only the network draws
The first run (no fleet-data.json) is the baseline: no changes, and the record starts that day.

A source that fails alone keeps yesterday's copy and produces no changes:
  * The fleet is rebuilt only when the UK, US and EU lists are all fresh, build/raw/{uk,us}.csv are there and both
    OpenSanctions downloads (the OFAC dates, the EU journal's ships) arrive. Otherwise the fleet files stay as they
    are, the failed sources are "unavailable" that day, and the network's lobbying layer may still update. The same
    holds when the build is rejected: official fleet links down by more than 20%, TASSOS without its link to Zulu, or a
    crash (then all three lists are unavailable). Exit code 1 whenever the fleet was not rebuilt.
  * With no earlier fleet graph there is nothing to keep, so a night like that writes nothing and exits 1.
  * Lobbying is unavailable when data/lobbying-meta.json is not fresh or the asset is missing: the network carries
    yesterday's lobby layer.
  * The diff treats tonight's unavailable sources and the previous run's as down (data/live-graphs-meta.json keeps
    them), so the night a source comes back reports nothing it supplied. A re-run on the same day diffs against that
    day's earlier graph and its changes are added to the day.
Files are written one at a time, the change record first and the meta file last, so an interrupted run is simply
redone: its changes are seen again and not doubled.
"""
from __future__ import annotations

import gzip
import json
import os
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from build_official_lists import SHRINK_LIMIT
from changes import SOURCES, diff, update_record
from fleet_base import kg_extra_companies, load_fleet_base, load_kg_base
from fleet_merge import _map_graph, compact, load_aliases, load_eu_records, merge
from fleet_official import OS_EU_JOURNAL, OS_OFAC, build_official, fetch_text
from kg_build import build_kg

ROOT = Path(__file__).resolve().parent.parent
FLEET_SOURCES = ("uk", "us", "eu")  # the lists the map is built from (the UN list feeds neither graph)
SAMPLE_IMO, SAMPLE_PARTNER = "IMO9408695", "zulu"  # TASSOS must keep its link to Zulu Ships Management
DEFAULT_OPENSANCTIONS_SOURCES = 95  # data sets OpenSanctions combines, when its meta does not say


@dataclass(frozen=True)
class Paths:
    lists: Path
    raw: Path
    lobbying: Path
    lobbying_meta: Path
    opensanctions_meta: Path
    config: Path
    fleet_base: Path
    kg_base: Path
    aliases: Path
    fleet_data: Path
    nodes: Path
    edges: Path
    kg: Path
    kg_js: Path
    changes: Path
    stats: Path
    meta: Path

    @classmethod
    def under(cls, root: Path) -> "Paths":
        data, fleet = root / "data", root / "stories" / "shadow-fleet" / "network"
        network = root / "stories" / "who-lobbies" / "influence-network"
        return cls(lists=data / "lists", raw=root / "build" / "raw", lobbying=root / "build" / "lobbying.json.gz",
                   lobbying_meta=data / "lobbying-meta.json", opensanctions_meta=data / "opensanctions-meta.json",
                   config=data / "lobbying-clients.json", fleet_base=data / "fleet-base.json",
                   kg_base=data / "kg-base.json", aliases=data / "fleet-company-aliases.json",
                   fleet_data=fleet / "fleet-data.json", nodes=fleet / "nodes.json", edges=fleet / "edges.json",
                   kg=network / "kg.json", kg_js=network / "kg_data.js", changes=data / "changes" / "changes.json",
                   stats=data / "site-stats.json", meta=data / "live-graphs-meta.json")


DEFAULT_PATHS = Paths.under(ROOT)


def _read(path: Path):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _write(path: Path, data) -> None:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(data, sort_keys=True, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    os.replace(tmp, path)


def _previous_fleet(paths: Paths, last: dict) -> dict | None:
    """Yesterday's merged graph, long form, as this build wrote it: nodes.json and edges.json (less the firms only
    the network shows, which the meta file holds). None on the first run; fleet-data.json is the mark of a graph this
    build wrote, as nodes.json and edges.json also exist from the 25 Sep research."""
    nodes, edges = _read(paths.nodes), _read(paths.edges)
    if not isinstance(_read(paths.fleet_data), dict) or not isinstance(nodes, list) or not isinstance(edges, list):
        return None
    hidden = last.get("kg_only") or {}  # (put back in merge()'s order, so the network built around it is the same)
    return {"nodes": sorted(nodes + hidden.get("nodes", []), key=lambda n: n["id"]),
            "edges": sorted(edges + hidden.get("edges", []), key=lambda e: (e["source"], e["target"], e["type"])),
            "meta": {}}


def _legacy_kg(paths: Paths) -> dict | None:
    """The 25 Sep network (window.KG = {...};), whose lobby layer the first run carries when lobbying is unavailable."""
    try:
        return json.loads(paths.kg_js.read_text(encoding="utf-8").strip().split("=", 1)[1].removesuffix(";"))
    except (OSError, IndexError, ValueError):
        return None


def _lobbying(paths: Paths) -> dict | None:
    """Tonight's lobbying asset, or None when it is not fresh or not there."""
    if (_read(paths.lobbying_meta) or {}).get("status") != "fresh" or not paths.lobbying.is_file():
        return None
    try:
        return json.loads(gzip.decompress(paths.lobbying.read_bytes()))
    except (OSError, EOFError, ValueError):
        return None


def _rejected(merged: dict, prev: dict | None) -> str | None:
    """Why tonight's fleet graph must not replace yesterday's, if it must not."""
    count = lambda g: sum(1 for e in _map_graph(g)["edges"] if e.get("layer") == "official")  # noqa: E731
    was, now = (count(prev) if prev else 0), count(merged)
    if was and now < SHRINK_LIMIT * was:
        return f"official fleet links shrank from {was} to {now}"
    names = {n["id"]: n["name"] for n in merged["nodes"]}
    partners = [e["target"] if e["source"] == SAMPLE_IMO else e["source"]
                for e in merged["edges"] if SAMPLE_IMO in (e["source"], e["target"])]
    if not any(SAMPLE_PARTNER in names.get(p, "").lower() for p in partners):
        return f"sample check failed: {SAMPLE_IMO} (TASSOS) has no link to {SAMPLE_PARTNER.capitalize()}"
    return None


def _fleet(paths: Paths, fetch, stale: set, prev: dict | None, problems: list) -> tuple[dict | None, set]:
    """(tonight's merged graph, set()) or (None, the sources that kept it from being built); `problems` says why."""
    down = set(stale)
    problems += [f"{g.upper()} list is not fresh (kept its previous copy)" for g in sorted(stale)]
    for g in ("uk", "us"):
        if not (paths.raw / f"{g}.csv").is_file():
            down.add(g)
            problems.append(f"{g.upper()} download missing (build/raw/{g}.csv)")
    try:
        eu_records = load_eu_records(paths.lists / "eu.json")
    except (OSError, ValueError, KeyError):
        down.add("eu")
        problems.append("EU list file unreadable")
    if down:
        return None, down
    texts = {}
    for url, gov in ((OS_OFAC, "us"), (OS_EU_JOURNAL, "eu")):  # (the OFAC dates and companies; the EU journal's ships)
        try:
            texts[url] = fetch(url)
        except Exception as exc:  # noqa: BLE001 - any failure of one download is that list's alone
            down.add(gov)
            problems.append(f"OpenSanctions download for the {gov.upper()} list failed ({type(exc).__name__}: {exc})")
    if down:
        return None, down
    try:
        base = load_fleet_base(paths.fleet_base)
        extra = kg_extra_companies(load_kg_base(paths.kg_base), base)
        official = build_official(paths.raw, fetch=texts.__getitem__, extra_companies=extra)
        merged = merge(base, official, aliases=load_aliases(paths.aliases), eu_records=eu_records)
    except Exception as exc:  # noqa: BLE001 - a list in a shape we do not read; the site keeps yesterday's map
        problems.append(f"fleet build crashed ({type(exc).__name__}: {exc})")
        return None, set(FLEET_SOURCES)
    if reason := _rejected(merged, prev):
        problems.append(reason)
        return None, set(FLEET_SOURCES)
    return merged, set()


def _stats(date: str, payload: dict, kg: dict, lists: dict, opensanctions: dict) -> dict:
    counts, kc = payload["meta"]["counts"], kg["meta"]["counts"]
    by = lambda layer, type_: sum(1 for n in kg["nodes"] if n["L"] == layer and n["t"] == type_)  # noqa: E731
    sources = opensanctions.get("sources")
    return {"generated": date,
            "fleet": {k: counts[k] for k in ("ships", "companies", "people", "countries", "edges", "lead_edges")},
            "kg": {"nodes": kc["nodes"], "edges": kc["edges"], "lead_edges": kc["lead_edges"],
                   "ships": kc["by_type"].get("ship", 0), "companies": kc["by_type"].get("company", 0),
                   "lobbyists": by("lobby", "person"), "lobby_firms": by("lobby", "lobbyfirm"),
                   "filings_kept": kc["lda_filings_kept"], "filings_scanned": kc["lda_filings_scanned"]},
            "lists": {g: lists.get(g, {}).get("record_count", 0) for g in ("us", "uk", "eu", "un")},
            "opensanctions_sources": sources if isinstance(sources, int) else DEFAULT_OPENSANCTIONS_SOURCES}


def build(now: str | None = None, fetch=fetch_text, paths: Paths = DEFAULT_PATHS) -> int:
    now = now or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    date = now[:10]
    last = _read(paths.meta) or {}
    prev_fleet, prev_kg = _previous_fleet(paths, last), _read(paths.kg)
    exclude = (_read(paths.config) or {}).get("exclude_lobbyists", [])
    lists = (_read(paths.lists / "meta.json") or {}).get("lists", {})
    stale = {g for g in ("us", "uk", "eu", "un") if lists.get(g, {}).get("status") != "fresh"}

    problems: list[str] = []
    merged, down = _fleet(paths, fetch, stale & set(FLEET_SOURCES), prev_fleet, problems)
    if merged is None and prev_fleet is None:
        print("live graphs: no earlier graph to keep and the fleet could not be built; nothing written - "
              + "; ".join(problems))
        return 1
    lobby = _lobbying(paths)
    today_down = down | stale | ({"lobbying"} if lobby is None else set())

    kg = None  # tonight's network: with the fleet kept it is rebuilt around yesterday's fleet, for the lobbying layer
    if merged is not None or lobby is not None:
        kg = build_kg(prev_fleet if merged is None else merged, lobby, load_kg_base(paths.kg_base),
                      prev_kg or _legacy_kg(paths), date, exclude=exclude)

    unavailable = (today_down | set(last.get("unavailable", []))) & set(SOURCES)
    asset_excluded = (lobby or {}).get("exclude_lobbyists", []) + exclude
    changes = []
    if merged is not None and prev_fleet is not None:
        changes += diff(prev_fleet, merged, "fleet", date, unavailable, asset_excluded)
    if kg is not None and prev_kg is not None:
        changes += diff(prev_kg, kg, "lobby", date, unavailable, asset_excluded)
    record = update_record(_read(paths.changes), date, changes,
                           {s: "unavailable" if s in today_down else "fresh" for s in SOURCES})

    shown = _map_graph(merged) if merged is not None else None
    payload = compact(merged, date) if merged is not None else _read(paths.fleet_data)
    hidden = last.get("kg_only") or {"nodes": [], "edges": []}
    if merged is not None:  # what the map leaves out; the network still draws it, so a night that keeps the map needs it
        on_map = {n["id"] for n in shown["nodes"]}, {e["id"] for e in shown["edges"]}
        hidden = {"nodes": [n for n in merged["nodes"] if n["id"] not in on_map[0]],
                  "edges": [e for e in merged["edges"] if e["id"] not in on_map[1]]}

    _write(paths.changes, record)
    if kg is not None:
        _write(paths.kg, kg)
    if merged is not None:
        _write(paths.nodes, shown["nodes"])
        _write(paths.edges, shown["edges"])
        _write(paths.fleet_data, payload)
    if kg is not None:
        _write(paths.stats, _stats(date, payload, kg, lists, _read(paths.opensanctions_meta) or {}))
    _write(paths.meta, {"label": "Live graphs", "checked_at": now,
                        "status": "fresh" if merged is not None else "kept-previous",
                        **({"error": "; ".join(problems)} if merged is None else {}),
                        "updated_at": now if kg is not None else last.get("updated_at"),
                        "record_count": len(payload["edges"]), "unavailable": sorted(today_down), "kg_only": hidden})
    print(f"live graphs: fleet {'rebuilt' if merged is not None else 'kept previous'} ({len(payload['edges'])} links), "
          f"network {'rebuilt' if kg is not None else 'kept previous'}, {len(changes)} changes"
          + (f"; unavailable: {', '.join(sorted(today_down))}" if today_down else "")
          + (f" - {'; '.join(problems)}" if problems else ""))
    return 0 if merged is not None else 1


if __name__ == "__main__":
    sys.exit(build())
