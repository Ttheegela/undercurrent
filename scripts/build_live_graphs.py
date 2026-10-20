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
    OpenSanctions downloads (the OFAC dates, the EU journal's ships) arrive with rows in them. Otherwise the fleet
    files stay as they are, the failed sources are "unavailable" that day, and the network's lobbying layer may still
    update. The same holds when the build is rejected:
      - the official links of one source family (UK list, US screening list, OFAC and the EU journal via OpenSanctions,
        EU financial list) are down by more than 20% on yesterday's, or (a family of under FAMILY_MIN links) down to
        none: that family's government is unavailable, and the reason names the family and its counts;
      - the official links as a whole are down by more than 20%, TASSOS has no official link to Zulu, or the build
        crashes: then all three lists are unavailable.
    Exit code 1 whenever the fleet was not rebuilt.
  * With no earlier fleet graph there is nothing to keep, so a night like that writes nothing and exits 1.
  * Lobbying is unavailable when data/lobbying-meta.json is not fresh, the asset is missing or it cannot be used: the
    network carries yesterday's lobby layer. With the map kept, the network is rebuilt only if the meta file still
    holds the firms the map leaves out; without them it is kept too.
  * The diff treats tonight's unavailable sources and the previous run's as down (data/live-graphs-meta.json keeps
    them), so the night a source comes back reports nothing it supplied. A re-run on the same day diffs against that
    day's earlier graph and its changes are added to the day.
Every output is first written in full to a .tmp file, then the files are renamed into place with nothing between:
fleet-data, nodes, edges, kg, site-stats, then changes.json, then the meta file. The record is never ahead of the graphs
it describes, so a run that dies part-way loses that night's rows (or, before any graph file is renamed, finds the same
changes again next time and files them once) but never files a change under two days.
"""
from __future__ import annotations

import gzip
import json
import os
import re
import sys
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

from build_official_lists import SHRINK_LIMIT
from changes import SOURCES, diff, update_record
from fleet_base import kg_extra_companies, load_fleet_base, load_kg_base
from fleet_merge import EU_FILE as EU_FSF_FILE
from fleet_merge import _map_graph, compact, load_aliases, load_eu_records, merge
from fleet_official import (CSL_FILE, CSL_OS_DATE_FILE, EU_FILE, OFAC_OS_FILE, OS_EU_JOURNAL, OS_OFAC, UK_FILE,
                            _csv, build_official, fetch_text)
from kg_build import build_kg

ROOT = Path(__file__).resolve().parent.parent
FLEET_SOURCES = ("uk", "us", "eu")  # the lists the map is built from (the UN list feeds neither graph)
SAMPLE_IMO, SAMPLE_PARTNER = "IMO9408695", "zulu"  # TASSOS must keep its link to Zulu Ships Management
DEFAULT_OPENSANCTIONS_SOURCES = 95  # data sets OpenSanctions combines, when its meta does not say
FAMILY_MIN = 100  # a family with fewer links yesterday is too small for a percentage to mean much: only zero rejects
# The official links by where their sources come from: (the source files they cite, the government to mark when the
# family shrinks). One download that comes back short must not read as delistings, however small a part of the map.
FAMILIES = {"UK list": ({UK_FILE}, "uk"),
            "US consolidated screening list": ({CSL_FILE, CSL_OS_DATE_FILE}, "us"),
            "OFAC list via OpenSanctions": ({OFAC_OS_FILE}, "us"),
            "EU journal via OpenSanctions": ({EU_FILE}, "eu"),
            "EU financial sanctions list": ({EU_FSF_FILE}, "eu")}


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


def _publish(outputs: list) -> None:
    """Write every (path, data) in full to path.tmp, then rename them into place in order, with no work between."""
    staged = []
    for path, data in outputs:
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_name(path.name + ".tmp")
        tmp.write_text(json.dumps(data, sort_keys=True, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
        staged.append((tmp, path))
    for tmp, path in staged:
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
    """The 25 Sep network (window.KG = {...};), whose lobby layer the first run carries when lobbying is unavailable.
    kg_data.js is gone from the repo (the network fetches kg.json, which is committed), so None is the usual answer."""
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


def _family_counts(graph: dict) -> dict[str, int]:
    """Official links on the map, by the source family their sources cite (a link can be in more than one)."""
    counts = dict.fromkeys(FAMILIES, 0)
    for e in _map_graph(graph)["edges"]:
        if e.get("layer") == "official":
            files = {s.get("file") for s in e["sources"]}
            for family, (cited, _) in FAMILIES.items():
                counts[family] += bool(files & cited)
    return counts


def _rejected(merged: dict, prev: dict | None) -> tuple[str, set] | None:
    """(why, the governments to mark unavailable) when tonight's fleet graph must not replace yesterday's."""
    if prev:
        before, after = _family_counts(prev), _family_counts(merged)
        shrunk = [f for f in FAMILIES if before[f] and (after[f] == 0 if before[f] < FAMILY_MIN
                                                        else after[f] < SHRINK_LIMIT * before[f])]
        if shrunk:
            return ("; ".join(f"{f}: official links shrank from {before[f]} yesterday to {after[f]} today"
                              for f in shrunk), {FAMILIES[f][1] for f in shrunk})
    count = lambda g: sum(1 for e in _map_graph(g)["edges"] if e.get("layer") == "official")  # noqa: E731
    was, now = (count(prev) if prev else 0), count(merged)
    if was and now < SHRINK_LIMIT * was:
        return f"official fleet links shrank from {was} yesterday to {now} today", set(FLEET_SOURCES)
    names = {n["id"]: n["name"] for n in merged["nodes"]}
    partners = [e["target"] if e["source"] == SAMPLE_IMO else e["source"] for e in merged["edges"]
                if SAMPLE_IMO in (e["source"], e["target"]) and e.get("layer") == "official"]
    if not any(SAMPLE_PARTNER in names.get(p, "").lower() for p in partners):
        return (f"sample check failed: {SAMPLE_IMO} (TASSOS) has no official link to {SAMPLE_PARTNER.capitalize()}",
                set(FLEET_SOURCES))
    return None


def _fleet(paths: Paths, fetch, stale: set, prev: dict | None) -> tuple[dict | None, set, list]:
    """(tonight's merged graph, set(), []) or (None, the sources that kept it from being built, why)."""
    down, problems = set(stale), [f"{g.upper()} list is not fresh (kept its previous copy)" for g in sorted(stale)]
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
        return None, down, problems
    texts = {}
    for url, gov in ((OS_OFAC, "us"), (OS_EU_JOURNAL, "eu")):  # (the OFAC dates and companies; the EU journal's ships)
        try:
            texts[url] = fetch(url)
            if not _csv(texts[url]):
                raise ValueError("no rows")
        except Exception as exc:  # noqa: BLE001 - any failure of one download is that list's alone
            down.add(gov)
            problems.append(f"OpenSanctions download for the {gov.upper()} list failed ({type(exc).__name__}: {exc})")
    if down:
        return None, down, problems
    try:
        base = load_fleet_base(paths.fleet_base)
        extra = kg_extra_companies(load_kg_base(paths.kg_base), base)
        official = build_official(paths.raw, fetch=texts.__getitem__, extra_companies=extra)
        merged = merge(base, official, aliases=load_aliases(paths.aliases), eu_records=eu_records)
    except Exception as exc:  # noqa: BLE001 - a list in a shape we do not read; the site keeps yesterday's map
        return None, set(FLEET_SOURCES), [f"fleet build crashed ({type(exc).__name__}: {exc})"]
    if rejected := _rejected(merged, prev):
        return None, rejected[1], [rejected[0]]
    return merged, set(), []


# The base's own note on the 25 Sep downloads ("... report of 21 Sep 2026 ... downloaded 25 Sep 2026"): the map shows
# tonight's sources in its place.
RESEARCH_DOWNLOAD = re.compile(r"downloaded \d+ \w+ 2026")
COVERAGE_LISTS = (("uk", "the UK Sanctions List"), ("us", "the US Consolidated Screening List"),
                  ("eu", "the EU financial-sanctions file"))


def _coverage(date: str, lists: dict, base: list) -> list:
    """The map's "What the data covers": the lists this build used, each as of its last update, then the base's research
    notes that still hold."""
    named = [name + (f" (updated {day})" if (day := str((lists.get(gov) or {}).get("updated_at") or "")[:10]) else "")
             for gov, name in COVERAGE_LISTS]
    used = ", ".join(named[:-1]) + " and " + named[-1]
    return [f"Ships and companies are rebuilt every night from the official lists. The build of {date} used {used}, with "
            "the EU Official Journal ship list and the OFAC listing dates read from OpenSanctions exports. "
            "All are joined by IMO number.",
            *(c for c in base if not RESEARCH_DOWNLOAD.search(c))]


def _stats(date: str, payload: dict, kg: dict, lists: dict, opensanctions: dict) -> dict:
    counts, kc = payload["meta"]["counts"], kg["meta"]["counts"]
    by = lambda layer, type_: sum(1 for n in kg["nodes"] if n["L"] == layer and n["t"] == type_)  # noqa: E731
    sure = Counter(e["c"] for e in kg["edges"])  # D documented, R reported, L lead
    sources = opensanctions.get("sources")
    return {"generated": date,
            "fleet": {k: counts[k] for k in ("ships", "companies", "people", "countries", "edges", "lead_edges")},
            "kg": {"nodes": kc["nodes"], "edges": kc["edges"], "lead_edges": kc["lead_edges"],
                   "ships": kc["by_type"].get("ship", 0), "companies": kc["by_type"].get("company", 0),
                   "lobbyists": by("lobby", "person"), "lobby_firms": by("lobby", "lobbyfirm"),
                   "filings_kept": kc["lda_filings_kept"], "filings_scanned": kc["lda_filings_scanned"],
                   "documented_edges": sure["D"], "reported_edges": sure["R"], "bills": kc["by_type"].get("bill", 0),
                   "lobbyists_with_posts": len({e["s"] for e in kg["edges"] if e["y"] == "formerly_served_in"}),
                   "ships_hidden": kc["ships_hidden_no_owner_link"]},
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

    merged, down, problems = _fleet(paths, fetch, stale & set(FLEET_SOURCES), prev_fleet)
    if merged is None and prev_fleet is None:
        print("live graphs: no earlier graph to keep and the fleet could not be built; nothing written - "
              + "; ".join(problems))
        return 1
    lobby = _lobbying(paths)
    if merged is None and "kg_only" not in last:
        lobby = None  # the meta file lost the firms only the network draws: it cannot be rebuilt around the old map

    kg = None  # tonight's network: with the fleet kept it is rebuilt around yesterday's fleet, for the lobbying layer
    if merged is not None or lobby is not None:
        fleet = prev_fleet if merged is None else merged
        base, before = load_kg_base(paths.kg_base), prev_kg or _legacy_kg(paths)
        if lobby is not None or before:  # (lobbying down with no earlier network to carry its layer from: no network tonight)
            try:
                kg = build_kg(fleet, lobby, base, before, date, exclude=exclude)
            except Exception as exc:  # noqa: BLE001 - an asset that is not what it says it is: lobbying fails alone
                if lobby is None:
                    raise
                print(f"live graphs: lobbying asset unusable ({type(exc).__name__}: {exc}); carrying the lobby layer")
                lobby = None
                kg = build_kg(fleet, None, base, before, date, exclude=exclude) if before else None
    today_down = down | stale | ({"lobbying"} if lobby is None else set())

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
    if merged is not None:
        payload["meta"]["coverage"] = _coverage(date, lists, payload["meta"].get("coverage", []))
    hidden = last.get("kg_only") or {"nodes": [], "edges": []}
    if merged is not None:  # what the map leaves out; the network draws it, and a night that keeps the map needs it
        on_map = {n["id"] for n in shown["nodes"]}, {e["id"] for e in shown["edges"]}
        hidden = {"nodes": [n for n in merged["nodes"] if n["id"] not in on_map[0]],
                  "edges": [e for e in merged["edges"] if e["id"] not in on_map[1]]}
    meta = {"label": "Live graphs", "checked_at": now, "status": "fresh" if merged is not None else "kept-previous",
            **({"error": "; ".join(problems)} if merged is None else {}),
            "updated_at": now if merged is not None else last.get("updated_at"),  # (when the map was last rebuilt)
            "record_count": len(payload["edges"]), "unavailable": sorted(today_down), "kg_only": hidden}

    _publish(([(paths.fleet_data, payload), (paths.nodes, shown["nodes"]), (paths.edges, shown["edges"])]
              if merged is not None else [])
             + ([(paths.kg, kg), (paths.stats, _stats(date, payload, kg, lists, _read(paths.opensanctions_meta) or {}))]
                if kg is not None else [])
             + [(paths.changes, record), (paths.meta, meta)])
    print(f"live graphs: fleet {'rebuilt' if merged is not None else 'kept previous'} ({len(payload['edges'])} links), "
          f"network {'rebuilt' if kg is not None else 'kept previous'}, {len(changes)} changes"
          + (f"; unavailable: {', '.join(sorted(today_down))}" if today_down else "")
          + (f" - {'; '.join(problems)}" if problems else ""))
    return 0 if merged is not None else 1


if __name__ == "__main__":
    sys.exit(build())
