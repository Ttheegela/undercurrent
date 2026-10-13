"""Build data/research-index.json from the research data under stories/.

One entry per ship, company and person in the shadow-fleet network, per
chip-route company, and per listed company or intermediary in the lobbying
graph. Every fact carries numbered source references.
"""
from __future__ import annotations

import json
import re
import sys
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse

from normalize import normalize_name

ROOT = Path(__file__).resolve().parent.parent
FLEET_DIR = ROOT / "stories" / "shadow-fleet" / "network"
CHIPS_FILE = ROOT / "stories" / "chips-into-russia" / "viz" / "listing_lag.json"
LOBBY_FILE = ROOT / "stories" / "who-lobbies" / "clean-names-graph" / "nodes.json"
OUT = ROOT / "data" / "research-index.json"

FLEET_STORY = {"label": "Open on the shadow-fleet map", "url": "stories/shadow-fleet/network/shadow_fleet_map.html"}
CHIPS_STORY = {"label": "Open the chip-routes timeline", "url": "stories/chips-into-russia/viz/listing_lag.html"}
LOBBY_STORY = {"label": "Open the lobbying network", "url": "stories/who-lobbies/clean-names-graph/index.html"}
FLEET_FINDINGS = ("stories/shadow-fleet/FINDINGS.md", "VeilTrace shadow-fleet findings")
CHIPS_FINDINGS = ("stories/chips-into-russia/FINDINGS.md", "VeilTrace chip-route findings")
LOBBY_FINDINGS = ("stories/who-lobbies/FINDINGS.md", "VeilTrace lobbying findings")

GOVERNMENTS = {"gov:us": "United States", "gov:eu": "European Union", "gov:uk": "United Kingdom"}
SOURCE_LABELS = {
    "sanctionslist.ofac.treas.gov": "US Treasury OFAC sanctions list",
    "www.trade.gov": "US Consolidated Screening List",
    "home.treasury.gov": "US Treasury press release",
    "eur-lex.europa.eu": "EU Official Journal (EUR-Lex)",
    "www.gov.uk": "UK Sanctions List",
    "war-sanctions.gur.gov.ua": "Ukraine GUR war-sanctions database (a party to the war; not a sanctions list)",
}
SHIP_KINDS = {"ship", "company", "person"}


def fmt_date(value: str) -> str:
    """'2025-07-30' -> '30 July 2025'; '2023-02' -> 'February 2023'; anything else unchanged."""
    for fmt in ("%Y-%m-%d", "%Y-%m"):
        try:
            d = datetime.strptime(value, fmt)
        except (ValueError, TypeError):
            continue
        return f"{d.day} {d:%B %Y}" if fmt == "%Y-%m-%d" else f"{d:%B %Y}"
    return value or ""


def tidy(text: str) -> str:
    """'[unlisted ship manager] (Liberia)' -> 'an unlisted ship manager (Liberia)'."""
    text = (text or "").strip()
    match = re.match(r"^\[([^\]]+)\]\s*(.*)$", text)
    if not match:
        return text
    inner, rest = match.group(1), match.group(2)
    article = "an" if inner[:1].lower() in "aeiou" else "a"
    return f"{article} {inner}" + (f" {rest}" if rest else "")


def join_and(items: list[str]) -> str:
    return items[0] if len(items) == 1 else ", ".join(items[:-1]) + " and " + items[-1]


class Sources:
    """Numbered, de-duplicated sources for one entry."""

    def __init__(self) -> None:
        self.items: list[dict] = []

    def ref(self, url: str | None, label: str | None = None) -> int | None:
        if not url:
            return None
        for item in self.items:
            if item["url"] == url:
                return item["n"]
        n = len(self.items) + 1
        host = urlparse(url).netloc
        self.items.append({"n": n, "label": label or SOURCE_LABELS.get(host, host or url), "url": url})
        return n


def fact(text: str, refs: list, sources: Sources, fallback: tuple[str, str]) -> dict:
    clean = sorted({r for r in refs if r})
    return {"text": text, "refs": clean or [sources.ref(*fallback)]}


def program_of(edge: dict, node: dict) -> str:
    regime = (edge.get("regime") or "").strip()
    if regime and regime.lower() != "other":
        return {"dprk": "North Korea"}.get(regime.lower(), regime.split(" (")[0])
    quote = (edge.get("quote") or "").upper()
    for key, label in (("IRAN", "Iran"), ("RUSSIA", "Russia"), ("UKRAINE", "Russia"), ("DPRK", "North Korea"), ("SYRIA", "Syria")):
        if key in quote:
            return label
    return (node.get("program_group") or "").replace("_", " ").title()


def listing_sentence(listings: list[dict]) -> str:
    parts = []
    for l in listings:
        part = f"the {l['by']}" if l["by"] in GOVERNMENTS.values() else l["by"]
        if l["date"]:
            part += f" on {fmt_date(l['date'])}"
        if l["program"]:
            part += f" ({l['program']})"
        parts.append(part)
    return "Listed by " + join_and(parts) + "."


def keys_for(*names) -> list[str]:
    out: list[str] = []
    for name in names:
        key = normalize_name(name)
        if key and key not in out:
            out.append(key)
    return out


def history_text(item: dict) -> str | None:
    to, frm = tidy(item.get("to", "")), tidy(item.get("from", ""))
    if item["kind"] == "owner":
        return f"Sold by {frm} to {to}" if frm else f"Owned by {to}"
    if item["kind"] == "manager":
        return f"Managed by {to}"
    return None  # ism_manager repeats the manager line


def fleet_entry(node: dict, out_edges: list, in_edges: list, by_id: dict, countries: dict) -> dict:
    src = Sources()
    listings, seen = [], set()
    designations = [e for e in out_edges if e["type"] == "designated_by" and e["target"] in GOVERNMENTS]
    for e in sorted(designations, key=lambda e: e.get("date") or "9999"):
        by = GOVERNMENTS[e["target"]]
        if by in seen:
            continue
        seen.add(by)
        listings.append({"by": by, "date": e.get("date") or "", "program": program_of(e, node), "ref": src.ref(e.get("source_url"))})
    facts = [fact(listing_sentence(listings), [l["ref"] for l in listings], src, FLEET_FINDINGS)] if listings else []
    for l in listings:
        l["ref"] = l["ref"] or facts[0]["refs"][0]

    events = [{"date": l["date"], "kind": "listing", "text": f"{l['by']} lists it" + (f" ({l['program']})" if l["program"] else "")}
              for l in listings if l["date"]]
    for item in node.get("history", []):
        text = history_text(item)
        if not text:
            continue
        events.append({"date": item["date"], "kind": "ownership" if item["kind"] == "owner" else "management", "text": text})
        facts.append(fact(f"{fmt_date(item['date'])}: {text}.", [src.ref(item.get("source_url"))], src, FLEET_FINDINGS))
    events.sort(key=lambda ev: ev["date"])

    managers = sorted((e for e in in_edges if e["type"] in ("manages", "operates") and e.get("confidence") == "Documented"),
                      key=lambda e: e.get("date") or "")
    manager = by_id.get(managers[-1]["source"], {}).get("name") if managers else None

    current = node["name"]
    former = []
    for name in node.get("ua_former_names") or []:
        if normalize_name(name) not in keys_for(current, *former):
            former.append(name)
    if node["type"] == "ship" and former:
        ua_pages = [h["source_url"] for h in node.get("history", [])
                    if h.get("source_url") and urlparse(h["source_url"]).netloc == "war-sanctions.gur.gov.ua"]
        ua = ua_pages[0] if ua_pages else (node.get("sources") or [{}])[0].get("url")
        facts.append(fact("Has also sailed as " + join_and(former) + ".", [src.ref(ua)], src, FLEET_FINDINGS))
    aliases = [a for a in node.get("aliases", []) if normalize_name(a) not in keys_for(current, *former)]
    names = [{"name": current, "current": True}] + [{"name": n, "current": False} for n in former + aliases]
    names = [n for i, n in enumerate(names) if normalize_name(n["name"]) not in keys_for(*(m["name"] for m in names[:i]))]

    if node["type"] != "ship" and node.get("ship_count"):
        facts.append(fact(f"Linked to {node['ship_count']} ships in our research.", [src.ref(*FLEET_FINDINGS)], src, FLEET_FINDINGS))
    if not facts:
        facts.append(fact(f"Appears in our shadow-fleet research{(' as ' + node['role']) if node.get('role') else ''}.",
                          [src.ref(*FLEET_FINDINGS)], src, FLEET_FINDINGS))

    flag_codes = [c for c in [node.get("flag_now"), node.get("flag_us"), *(node.get("ua_flag_countries") or [])] if c]
    flags = []
    for code in flag_codes:
        name = countries.get(code.lower())
        if name and name not in flags:
            flags.append(name)
    kind = (node.get("ship_type") or "Ship") if node["type"] == "ship" else node["type"].capitalize()
    return {
        "id": node["id"], "kind": kind, "name": current,
        "keys": keys_for(current, *node.get("aliases", []), *former),
        "imo": node.get("imo"), "flag": flags[0] if node["type"] == "ship" and flags else None,
        "manager": manager, "country": countries.get((node.get("country") or "").lower()) or node.get("country"),
        "role": node.get("role"), "listings": listings, "events": events, "facts": facts,
        "names": names, "flags": flags if node["type"] == "ship" else [],
        "story": FLEET_STORY, "sources": src.items,
    }


def fleet_entries(nodes: list, edges: list) -> list[dict]:
    by_id = {n["id"]: n for n in nodes}
    countries = {n["country"].lower(): n["name"] for n in nodes if n["type"] == "country" and n.get("country")}
    out_e: dict[str, list] = {}
    in_e: dict[str, list] = {}
    for e in edges:
        out_e.setdefault(e["source"], []).append(e)
        in_e.setdefault(e["target"], []).append(e)
    return [fleet_entry(n, out_e.get(n["id"], []), in_e.get(n["id"], []), by_id, countries)
            for n in nodes if n["type"] in SHIP_KINDS]


def chip_entries(doc: dict) -> list[dict]:
    out = []
    for c in doc["companies"]:
        src = Sources()
        story_ref = src.ref(*CHIPS_FINDINGS)
        sayari = src.ref(c.get("sayari_entity_url"), "Sayari entity record (account required)")
        first_listing = c.get("first_listing") or {}
        first_suspicious = c.get("first_suspicious") or {}
        listings = []
        if first_listing.get("authority"):
            listings.append({"by": first_listing["authority"], "date": first_listing.get("date") or "", "program": "Russia", "ref": story_ref})
        facts = [fact((c.get("role") or "Company on a chip route into Russia").rstrip(".") + ".", [story_ref, sayari], src, CHIPS_FINDINGS)]
        events = []
        if first_suspicious.get("date"):
            facts.append(fact(f"First looked suspicious on {fmt_date(first_suspicious['date'])}: {first_suspicious.get('basis', '')}.", [story_ref], src, CHIPS_FINDINGS))
            events.append({"date": first_suspicious["date"], "kind": "suspicion", "text": "First looked suspicious"})
        if first_listing.get("date"):
            lag = f", at least {c['lag_months_at_least']} months later" if c.get("lag_months_at_least") else ""
            facts.append(fact(f"First listed on {fmt_date(first_listing['date'])} by {first_listing['authority']}{lag}.", [story_ref], src, CHIPS_FINDINGS))
            events.append({"date": first_listing["date"], "kind": "listing", "text": f"{first_listing['authority']} lists it"})
        out.append({
            "id": f"chip:{c['id']}", "kind": "Company", "name": c["name"], "keys": keys_for(c["name"]),
            "imo": None, "flag": None, "manager": None, "country": c.get("place"), "role": "Chip-route company",
            "listings": listings, "events": sorted(events, key=lambda ev: ev["date"]), "facts": facts,
            "names": [{"name": c["name"], "current": True}], "flags": [], "story": CHIPS_STORY, "sources": src.items,
        })
    return out


LIST_NAMES = {
    "US OFAC SDN": "US Treasury sanctions list",
    "US BIS Entity List": "US export-control Entity List",
    "US NS-CMIC (EO13959)": "US list of Chinese military companies",
    "UK Sanctions List": "UK sanctions list",
    "US OFAC Russia programs (EO13662/EO14024)": "US Treasury Russia sanctions",
    "EU sanctions": "EU sanctions list",
    "US OFAC SSI (sectoral, EO13662)": "US Treasury sectoral sanctions on Russia",
    "US-OFAC SSI List (Directive 2)": "US Treasury sectoral sanctions on Russia",
    "EU/UK sanctions": "EU and UK sanctions lists",
}


def list_name(label: str) -> str:
    return LIST_NAMES.get(label) or re.sub(r"\s*\([^)]*\)", "", label).strip()


def lobby_entries(nodes: list) -> list[dict]:
    out = []
    for n in nodes:
        if n["type"] not in ("listed_entity", "intermediary"):
            continue
        src = Sources()
        ref = src.ref(*LOBBY_FINDINGS)
        listings = [{"by": list_name(l["list"]), "date": l["date"] if re.match(r"^\d{4}", l.get("date") or "") else "", "program": "", "ref": ref}
                    for l in n.get("listed", [])]
        if listings:
            facts = [fact(f"On the {l['by']}" + (f" since {fmt_date(l['date'])}" if l["date"] else "") + ".", [ref], src, LOBBY_FINDINGS)
                     for l in listings]
        else:
            facts = [fact("Appears in our lobbying research as a client or intermediary; not on a sanctions list in our data.", [ref], src, LOBBY_FINDINGS)]
        names = [{"name": n["label"], "current": True}] + [{"name": a, "current": False} for a in n.get("aliases", []) if a != n["label"]]
        out.append({
            "id": n["id"], "kind": "Company", "name": n["label"], "keys": keys_for(n["label"], *n.get("aliases", [])),
            "imo": None, "flag": None, "manager": None, "country": n.get("country"),
            "role": "Listed company in lobbying filings" if listings else "Lobbying client or intermediary",
            "listings": listings,
            "events": [{"date": l["date"], "kind": "listing", "text": f"{l['by']} lists it"} for l in listings if l["date"]],
            "facts": facts, "names": names, "flags": [], "story": LOBBY_STORY, "sources": src.items,
        })
    return out


def build() -> list[dict]:
    nodes = json.loads((FLEET_DIR / "nodes.json").read_text(encoding="utf-8"))
    edges = json.loads((FLEET_DIR / "edges.json").read_text(encoding="utf-8"))
    entries = fleet_entries(nodes, edges)
    entries += chip_entries(json.loads(CHIPS_FILE.read_text(encoding="utf-8")))
    entries += lobby_entries(json.loads(LOBBY_FILE.read_text(encoding="utf-8")))
    return [e for e in entries if e["keys"]]


def main() -> int:
    entries = build()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"entries": entries}, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"wrote {len(entries)} entries to {OUT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
