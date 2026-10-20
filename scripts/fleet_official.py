"""Rebuild the shadow-fleet graph's official layer from the official lists each night.

Ships, companies, people, designations, flags and owner/operator/linked-to links, ported from
veil-trace@88dcaa2:tools/fleet/network/build_base.py (official-data parts only):
  UK list ships (:114-168); US Consolidated Screening List Treasury vessels (:195-251) with OFAC listing
  dates via OpenSanctions (:181-192); EU Official Journal ships via OpenSanctions (:253-270); company
  listings and registration countries (:300-339, without the EU FSF lookup); people named by OFAC (:383-401).
Not ported, on purpose: the fuzzy name-containment merge (:350-381) and the country-from-name guess (:340-348).
Every edge is Documented: it is what the list says. Inputs: build/raw/uk.csv and build/raw/us.csv (written by
build_official_lists.py) and the two OpenSanctions dataset CSVs downloaded here.
"""
from __future__ import annotations

import csv
import io
import re
from datetime import datetime
from pathlib import Path

from build_official_lists import fetch
from specific_sources import OFAC_ENTRY, UK_ENTRY

OS_EU_JOURNAL = "https://data.opensanctions.org/datasets/latest/eu_journal_sanctions/targets.simple.csv"
OS_OFAC = "https://data.opensanctions.org/datasets/latest/us_ofac_sdn/targets.simple.csv"
OS_ENTITY = "https://www.opensanctions.org/entities/{}/"

UK_FILE = "UK Sanctions List"
CSL_FILE = "US Consolidated Screening List"
CSL_OS_DATE_FILE = "US Consolidated Screening List; listing date via OpenSanctions"
OFAC_OS_FILE = "OFAC SDN list, via OpenSanctions"
EU_FILE = "EU Official Journal, via OpenSanctions"
OS_DATE_NOTE = "date = first seen on the OFAC list, via OpenSanctions"
GOVS = {"gov:us": "United States (sanctioning government)", "gov:uk": "United Kingdom (sanctioning government)",
        "gov:eu": "European Union (sanctioning body)"}


def fetch_text(url: str) -> str:
    return fetch(url).decode("utf-8")


# ---- verbatim from build_base.py:21-56 (country names seen in the lists -> ISO2) ----
COUNTRY_ISO = {}
def iso(name):
    if not name: return ''
    n = name.strip().lower()
    return COUNTRY_ISO.get(n, '')

CT = """af Afghanistan|al Albania|dz Algeria|ao Angola|ag Antigua and Barbuda|ar Argentina|am Armenia|au Australia|at Austria|az Azerbaijan|bs Bahamas|bh Bahrain|bd Bangladesh|bb Barbados|by Belarus|be Belgium|bz Belize|bj Benin|bo Bolivia|ba Bosnia and Herzegovina|br Brazil|bn Brunei|bg Bulgaria|kh Cambodia|cm Cameroon|ca Canada|cv Cape Verde|cl Chile|cn China|co Colombia|km Comoros|cg Congo|ck Cook Islands|cr Costa Rica|hr Croatia|cu Cuba|cw Curacao|cy Cyprus|cz Czech Republic|dk Denmark|dj Djibouti|dm Dominica|do Dominican Republic|ec Ecuador|eg Egypt|gq Equatorial Guinea|er Eritrea|ee Estonia|sz Eswatini|et Ethiopia|fj Fiji|fi Finland|fr France|ga Gabon|gm Gambia|ge Georgia|de Germany|gh Ghana|gr Greece|gd Grenada|gt Guatemala|gn Guinea|gw Guinea-Bissau|gy Guyana|ht Haiti|hn Honduras|hk Hong Kong|hu Hungary|is Iceland|in India|id Indonesia|ir Iran|iq Iraq|ie Ireland|im Isle of Man|il Israel|it Italy|ci Ivory Coast|jm Jamaica|jp Japan|jo Jordan|kz Kazakhstan|ke Kenya|ki Kiribati|kp North Korea|kr South Korea|kw Kuwait|kg Kyrgyzstan|la Laos|lv Latvia|lb Lebanon|lr Liberia|ly Libya|lt Lithuania|lu Luxembourg|mo Macau|mg Madagascar|mw Malawi|my Malaysia|mv Maldives|ml Mali|mt Malta|mh Marshall Islands|mr Mauritania|mu Mauritius|mx Mexico|md Moldova|mc Monaco|mn Mongolia|me Montenegro|ma Morocco|mz Mozambique|mm Myanmar|na Namibia|nr Nauru|np Nepal|nl Netherlands|nz New Zealand|ni Nicaragua|ng Nigeria|no Norway|om Oman|pk Pakistan|pw Palau|ps Palestine|pa Panama|pg Papua New Guinea|py Paraguay|pe Peru|ph Philippines|pl Poland|pt Portugal|qa Qatar|ro Romania|ru Russia|rw Rwanda|kn Saint Kitts and Nevis|lc Saint Lucia|vc Saint Vincent and the Grenadines|ws Samoa|sm San Marino|st Sao Tome and Principe|sa Saudi Arabia|sn Senegal|rs Serbia|sc Seychelles|sl Sierra Leone|sg Singapore|sk Slovakia|si Slovenia|sb Solomon Islands|so Somalia|za South Africa|es Spain|lk Sri Lanka|sd Sudan|sr Suriname|se Sweden|ch Switzerland|sy Syria|tw Taiwan|tj Tajikistan|tz Tanzania|th Thailand|tg Togo|to Tonga|tt Trinidad and Tobago|tn Tunisia|tr Turkey|tm Turkmenistan|tv Tuvalu|ug Uganda|ua Ukraine|ae United Arab Emirates|gb United Kingdom|us United States|uy Uruguay|uz Uzbekistan|vu Vanuatu|ve Venezuela|vn Vietnam|vg British Virgin Islands|ye Yemen|zm Zambia|zw Zimbabwe|aw Aruba|bm Bermuda|ky Cayman Islands|gi Gibraltar|sx Sint Maarten|tl Timor-Leste|bq Bonaire|mk North Macedonia|xk Kosovo|lr Liberia"""
CNAME = {}
for part in CT.split('|'):
    code, name = part.split(' ', 1)
    CNAME[code] = name
    COUNTRY_ISO[name.lower()] = code
for alias, code in {'uae': 'ae', 'u.a.e.': 'ae', 'russian federation': 'ru', 'republic of cameroon': 'cm', 'iran (islamic republic of)': 'ir',
                    'turkiye': 'tr', 'türkiye': 'tr', 'hong kong sar': 'hk', 'china, hong kong': 'hk', 'st kitts and nevis': 'kn',
                    'st vincent and the grenadines': 'vc', 'saint vincent and grenadines': 'vc', 'sao tome & principe': 'st',
                    'são tomé and príncipe': 'st', 'cote d\'ivoire': 'ci', 'côte d\'ivoire': 'ci', 'korea, north': 'kp',
                    'democratic people\'s republic of korea': 'kp', 'republic of the marshall islands': 'mh', 'marshall islands (the)': 'mh',
                    'the gambia': 'gm', 'swaziland': 'sz', 'kingdom of eswatini': 'sz', 'burma': 'mm', 'viet nam': 'vn',
                    'united kingdom of great britain and northern ireland': 'gb', 'uk': 'gb', 'united states of america': 'us', 'usa': 'us',
                    'bvi': 'vg', 'virgin islands, british': 'vg', 'unknown': '', 'none identified': '', 'false flag': ''}.items():
    COUNTRY_ISO[alias] = code

def isos(text):
    """Split a flag field like 'Panama, Liberia' or 'Comoros; Gabon' into ISO codes, keeping unknown text."""
    out = []
    for p in re.split(r'[;,/]|\band\b', text or ''):
        p = p.strip().strip('.').strip()
        if not p: continue
        c = iso(p)
        if not c:
            # tolerate 'Cameroon (false flag)' style
            m = re.match(r'([A-Za-z \'\-]+)', p)
            c = iso(m.group(1).strip()) if m else ''
        out.append(c or 'raw:' + p)
    return out

# ---- verbatim from build_base.py:58-72. Its line 65 held literal backspaces where \b was meant, so it never
# matched; it is left out, which keeps every company id exactly as on 25 Sep (e.g. "...-l-l-c").
SUFFIX = r'\b(public joint stock|joint stock|pjsc|ojsc|cjsc|pao|insurance company|l\.?l\.?c|llc|ltd|limited|inc|corp|corporation|co|company|dmcc|fze|fzco|fz-llc|fzllc|fz|pte|pvt|private|sa|s\.a|smc|sole proprietorship|jsc|ooo|llp|gmbh|bv|s\.r\.l|srl|sdn bhd|opc|the)\b'
def norm_co(name):
    n = name.lower()
    n = re.sub(r'\(.*?\)', ' ', n)
    n = n.replace('&', ' and ')
    n = re.sub(r'[^a-z0-9 \-]', ' ', n)
    n = n.replace('-', ' ')
    n = re.sub(SUFFIX, ' ', n)
    n = re.sub(r'\b(ship ?management|shipmanagement)\b', 'shipmanagement', n)
    n = re.sub(r'\s+', ' ', n).strip()
    return n

def co_id(name):
    return 'co:' + norm_co(name).replace(' ', '-')

# ---- verbatim from build_base.py:74-83, 131-135, 171-179 ----
def imo7(s):
    m = re.search(r'(\d{7})', s or '')
    return m.group(1) if m else ''

def ddmmyyyy(s):
    s = (s or '').strip()
    try:
        return datetime.strptime(s, '%d/%m/%Y').date().isoformat()
    except ValueError:
        return ''

def split_ops(text):
    text = (text or '').strip()
    if not text: return []
    parts = re.split(r';|\n| / |\bformerly\b', text)
    return [p.strip().strip(',').strip() for p in parts if len(p.strip()) > 2]

def prog_class(text):
    t = text.upper()
    if 'IRAN' in t or 'IFSR' in t or '13846' in t or '13902' in t or '13599' in t: base = 'iran'
    elif 'RUSSIA' in t or '14024' in t or 'UKRAINE' in t or '14071' in t: base = 'russia'
    elif 'TERR' in t or 'SDGT' in t or '13224' in t: base = 'terrorism'
    elif 'VENEZUELA' in t or '13850' in t or '13884' in t: base = 'venezuela'
    elif 'DPRK' in t or 'KOREA' in t: base = 'dprk'
    else: base = 'other'
    return base


def csl_list(source: str) -> str:
    """The short list name in a CSL source label: "Sectoral Sanctions Identifications List (SSI) - Treasury Department"
    is "SSI"; the SDN list is "SDN". Only the SDN list freezes assets: SSI, NS-MBS, CMIC and the rest limit dealings."""
    m = re.search(r"\(([^)]+)\)", source)
    return m.group(1) if m else source


# Which designation types freeze assets: an edge's own type field, by the government that made it. The kg page shows
# "blocked" for a freeze and "restricted" for the rest (US SSI, NS-MBS and the like; UK ship and non-freeze rows; EU
# Reg. 833/2014 measures such as the Annex XLII ship listing). Reg. 269/2014 and the EU financial list freeze assets.
FREEZES = {"us_list": lambda v: v == "SDN", "uk_freeze": bool, "eu_reg": lambda v: v != "833"}


def freezes(edge: dict) -> bool:
    """Does this designation freeze assets? One that carries no type is taken to."""
    return all(test(edge[k]) for k, test in FREEZES.items() if k in edge)


class _Graph:
    """Nodes merge like build_base.node(): list fields are unioned, other fields keep their first value.
    Edges fold by (source, target, type): sources are unioned and the earliest date is kept."""

    LISTS = ("aliases", "programs", "flags_before")

    def __init__(self) -> None:
        self.nodes: dict[str, dict] = {}
        self.edges: dict[tuple, dict] = {}

    def node(self, nid: str, **kw) -> dict:
        n = self.nodes.setdefault(nid, {"id": nid})
        for k, v in kw.items():
            if v in (None, "", [], {}):
                continue
            if k in self.LISTS:
                cur = n.setdefault(k, [])
                for x in v if isinstance(v, list) else [v]:
                    if x and x not in cur:
                        cur.append(x)
            elif isinstance(v, dict):
                for kk, vv in v.items():
                    n.setdefault(k, {}).setdefault(kk, vv)
            elif not n.get(k):
                n[k] = v
        return n

    def edge(self, s, t, type_, date, url, file, quote, record, **extra) -> None:
        src = {"url": url, "file": file, "quote": quote, "record": record, "angle": "lists", "confidence": "Documented"}
        self.fold({"source": s, "target": t, "type": type_, "date": date, "source_url": url, "source_file": file,
                   "quote": quote, "record": record, "angle": "lists", "confidence": "Documented", **extra,
                   "sources": [src]})

    def fold(self, e: dict) -> None:
        cur = self.edges.setdefault((e["source"], e["target"], e["type"]), e)
        if cur is e:
            return
        cur["sources"] += [s for s in e["sources"] if s not in cur["sources"]]
        if e["date"] and (not cur["date"] or e["date"] < cur["date"]):
            cur["date"] = e["date"]
        for k, test in FREEZES.items():  # an entity on both the SSI and the SDN list is on the SDN list
            if k in e and (k not in cur or (test(e[k]) and not test(cur[k]))):
                cur[k] = e[k]

    def country(self, code: str) -> bool:
        if not code or code.startswith("raw:"):
            return False
        self.node("cc:" + code, type="country", name=CNAME.get(code, code.upper()), country=code)
        return True

    def add(self, nodes: list[dict], edges: list[dict]) -> None:
        for n in nodes:
            self.node(n["id"], **{k: v for k, v in n.items() if k != "id"})
        for e in edges:
            self.fold(e)

    def parts(self) -> tuple[list[dict], list[dict]]:
        return list(self.nodes.values()), list(self.edges.values())

    def finish(self) -> dict:
        """List status from the designations (veil-trace merge.py:181-192), then a stable order."""
        listable = [n for n in self.nodes.values() if n.get("type") in ("ship", "company", "person")]
        for n in listable:
            n["listed_by"], n["listing_dates"] = [], {}
        for e in self.edges.values():
            if e["type"] == "designated_by":
                n, gov = self.nodes[e["source"]], e["target"][4:]
                n["listed_by"].append(gov)
                if e["date"]:
                    n["listing_dates"][gov] = e["date"]
        for n in listable:
            n["listed_by"].sort()
            n["listed"] = bool(n["listed_by"])
            if n["listing_dates"]:
                n["first_listed"] = min(n["listing_dates"].values())
        return {"nodes": [self.nodes[k] for k in sorted(self.nodes)],
                "edges": [self.edges[k] for k in sorted(self.edges)]}


def _csv(text: str) -> list[dict]:
    return list(csv.DictReader(io.StringIO(text.lstrip("﻿"))))


def _uk_rows(text: str) -> list[dict]:
    text = text.lstrip("﻿")
    if text.startswith("Report Date"):  # the UK file opens with a one-line banner
        text = text.split("\n", 1)[1]
    return _csv(text)


def uk_ship_name(text: str) -> str:
    """The UK list writes some ships' names as "IMO 9243320 ('YEHOPE')" or "IMO 9331048 (CHAIVO)": keep the name."""
    m = re.fullmatch(r"""IMO\s*\d{7}\s*\(\s*['"]?(.+?)['"]?\s*\)""", text.strip())
    return m.group(1) if m else text.strip()


def parse_uk(text: str) -> tuple[list[dict], list[dict]]:
    """UK list ships under the Russia regime, with flags and owner/operators (build_base.py:124-168)."""
    g = _Graph()
    ships: dict[str, list[dict]] = {}
    for r in _uk_rows(text):
        im = imo7(r["IMO number"])
        if im and "Russia" in r["Regime Name"]:
            ships.setdefault(im, []).append(r)
    for im, rs in ships.items():
        prim = next((r for r in rs if r["Name type"].lower().startswith("primary")), rs[0])
        sid, uid, name = "IMO" + im, prim["Unique ID"], uk_ship_name(prim["Name 6"])
        url = UK_ENTRY.format(uid, "Ship")
        d = ddmmyyyy(prim["Date Designated"])
        n = g.node(sid, type="ship", name=name, imo=im, aliases=[uk_ship_name(r["Name 6"]) for r in rs if r["Name 6"].strip()],
                   ship_type=prim["Type of ship"].strip(), year_built=prim["Year Built"].strip(),
                   tonnage=prim["Tonnage of ship"].strip(), programs="russia", uk_id=uid, uk_name=name,
                   names_by_source={"UK list": name}, uk_date=d)
        g.edge(sid, "gov:uk", "designated_by", d, url, UK_FILE, (prim["Other Information"] or "")[:160], uid, regime="Russia",
               uk_freeze="Asset freeze" in prim["Sanctions Imposed"])
        cur = prim["Current believed flag of ship"].strip()
        for c in isos(cur):
            if g.country(c):
                g.edge(sid, "cc:" + c, "flagged_in", "", url, UK_FILE, "Current believed flag of ship: " + cur, uid)
                n["flag_now"] = c
        for c in isos(prim["Previous flags"]):
            if g.country(c):
                g.edge(sid, "cc:" + c, "formerly_flagged_in", "", url, UK_FILE,
                       "Previous flags: " + prim["Previous flags"].strip()[:120], uid)
                g.node(sid, flags_before=c)
        for column, type_, date, role, label in (
                ("Current owner/operator (s)", "operates", d, "owner/operator (UK list)", "current"),
                ("Previous owner/operator (s)", "formerly_operated", "", "former owner/operator (UK list)", "previous")):
            for op in split_ops(prim[column]):
                cid = co_id(op)
                if cid == "co:":
                    continue
                g.node(cid, type="company", name=re.sub(r"\s+", " ", op), role=role)
                g.edge(cid, sid, type_, date, url, UK_FILE, f"UK list, {label} owner/operator: " + op[:100], uid)
    return g.parts()


def parse_os_ofac_dates(text: str) -> dict[str, str]:
    """IMO -> the date OpenSanctions first saw the vessel on the OFAC SDN list (build_base.py:181-188)."""
    out = {}
    for r in _csv(text):
        if r["schema"] == "Vessel" and (m := re.search(r"IMO(\d{7})", r["identifiers"])):
            out[m.group(1)] = r["first_seen"][:10]
    return out


def parse_csl(text: str, first_seen: dict[str, str] | None = None) -> tuple[list[dict], list[dict]]:
    """CSL Treasury vessels in the Iran, Russia, terrorism and Venezuela programmes (build_base.py:203-251).
    The CSL carries no dates on vessel rows, so the US date is OpenSanctions' first_seen, labelled as such."""
    first_seen = first_seen or {}
    g = _Graph()
    for r in _csv(text):
        if r["type"] != "Vessel" or "Treasury" not in r["source"]:
            continue
        m = re.search(r"IMO (\d{7})", r["ids"])
        if not m:
            continue
        im = m.group(1)
        pc = prog_class(r["programs"] + " " + r["remarks"])
        if pc not in ("iran", "russia", "terrorism", "venezuela") or re.search(r"yacht|passenger", r["vessel_type"], re.I):
            continue
        sid, name, ent = "IMO" + im, r["name"].strip(), r["entity_number"]
        url, rec = OFAC_ENTRY.format(ent), "OFAC ent_num " + ent
        usd = r["start_date"] or first_seen.get(im, "")
        alts = [a.strip() for a in r["alt_names"].split(";") if a.strip()]
        mmsi = re.search(r"MMSI, (\d{9})", r["ids"])
        n = g.node(sid, type="ship", name=name, imo=im, aliases=[name] + alts, ship_type=r["vessel_type"], programs=pc,
                   tonnage=r["gross_tonnage"], names_by_source={"US list": name}, us_date=usd,
                   us_programs=r["programs"], mmsi_us=mmsi.group(1) if mmsi else "")
        via_os = {"date_note": OS_DATE_NOTE} if usd and not r["start_date"] else {}
        g.edge(sid, "gov:us", "designated_by", usd, url, CSL_OS_DATE_FILE if via_os else CSL_FILE,
               "Programmes: " + r["programs"], rec, program=pc, us_list=csl_list(r["source"]), **via_os)
        fl = r["vessel_flag"].strip()
        for c in isos(fl):
            if g.country(c):
                g.edge(sid, "cc:" + c, "flagged_in", "", url, CSL_FILE, "OFAC vessel flag: " + fl, rec)
                n.setdefault("flag_us", c)
        for ff in re.findall(r"Former Vessel Flag, ([^;]+)", r["ids"]):
            for c in isos(ff):
                if g.country(c):
                    g.edge(sid, "cc:" + c, "formerly_flagged_in", "", url, CSL_FILE, "OFAC: Former Vessel Flag, " + ff.strip(), rec)
                    g.node(sid, flags_before=c)
        links = [(lt.strip(), "linked_to", "linked company (OFAC)", "OFAC vessel entry: (Linked To: {})")
                 for lt in re.findall(r"Linked To: ([^)]+)\)", r["remarks"])]
        if r["vessel_owner"].strip():
            links.append((r["vessel_owner"].strip(), "owns", "registered owner (OFAC)", "OFAC vessel owner: {}"))
        for co, type_, role, quote in links:
            cid = co_id(co)
            if cid == "co:":
                continue
            g.node(cid, type="company", name=co, role=role)
            g.edge(cid, sid, type_, usd, url, CSL_FILE, quote.format(co), rec)
    return g.parts()


def parse_os_eu_journal(text: str) -> tuple[list[dict], list[dict]]:
    """EU port-ban ships from OpenSanctions' copy of the EU Official Journal (build_base.py:253-270)."""
    g = _Graph()
    for r in _csv(text):
        if r["schema"] != "Vessel":
            continue
        m = re.search(r"IMO(\d{7})", r["identifiers"])
        if not m:
            continue
        im = m.group(1)
        sid, name = "IMO" + im, r["name"].strip()
        pc = "russia" if "RUS" in r["program_ids"] or "UKR" in r["program_ids"] else prog_class(r["program_ids"] + " " + r["sanctions"])
        dm = re.findall(r"(\d{4}-\d{2}-\d{2})", r["sanctions"])
        d = min(dm) if dm else ""
        g.node(sid, type="ship", name=name, imo=im, aliases=[name] + [a for a in r["aliases"].split(";") if a.strip()],
               programs=pc, names_by_source={"EU list": name}, eu_date=d)
        reason = re.sub(r"\s*-\s*\d{4}-\d{2}-\d{2}$", "", r["sanctions"].split(";")[0])
        g.edge(sid, "gov:eu", "designated_by", d, OS_ENTITY.format(r["id"]), EU_FILE, reason[:200], "OpenSanctions " + r["id"],
               regime="Russia (Reg. 833/2014 ship list)" if pc == "russia" else pc,
               **({"eu_reg": "833"} if pc == "russia" else {}))  # another programme's ships: no type to read
    return g.parts()


def _company_listings_and_people(g: _Graph, uk_text: str, csl_text: str, ofac_text: str) -> None:
    """Listings and registration countries for the companies the ships name, by exact normalised name
    (build_base.py:117-122, 189-201, 300-339 without EU FSF or name-based countries), then the names that
    the lists hold as individuals become people (build_base.py:383-401)."""
    uk_entities = {}
    for r in _uk_rows(uk_text):
        if r["Designation Type"] == "Entity" and "Russia" in r["Regime Name"]:
            nm = " ".join(x for x in [r["Name 6"]] + [r[f"Name {i}"] for i in range(1, 6)] if x.strip()).strip()
            uk_entities.setdefault(norm_co(nm), r)
    csl = _csv(csl_text)
    csl_ent = {}  # OFAC (Treasury) rows only: another list's row of the same name must not mask the OFAC entry
    treasury = [r for r in csl if r["type"] != "Vessel" and "Treasury" in r["source"]]
    for r in sorted(treasury, key=lambda r: csl_list(r["source"]) != "SDN"):  # an entity on SSI and SDN is on the SDN list
        for nm in [r["name"]] + r["alt_names"].split(";"):
            if nm.strip():
                csl_ent.setdefault(norm_co(nm), r)
    us_orgs, sdn_people = {}, {}
    for r in _csv(ofac_text):
        names = [nm for nm in [r["name"]] + r["aliases"].split(";") if nm.strip()]
        if r["schema"] in ("Organization", "Company", "LegalEntity"):
            for nm in names:
                us_orgs.setdefault(norm_co(nm), r)
        elif r["schema"] == "Person":
            for nm in names:
                sdn_people.setdefault(norm_co(nm), r)

    for nid, n in list(g.nodes.items()):
        if n.get("type") != "company" or not (key := norm_co(n["name"])):
            continue
        r, c2 = us_orgs.get(key), csl_ent.get(key)
        if r:
            pc, date = prog_class(r["sanctions"] + " " + r["program_ids"]), r["first_seen"][:10]
            # the OFAC entry when the CSL holds the same name, else the OpenSanctions page
            url, rec = ((OFAC_ENTRY.format(c2["entity_number"]), "OFAC ent_num " + c2["entity_number"]) if c2
                        else (OS_ENTITY.format(r["id"]), "OpenSanctions " + r["id"]))
            g.node(nid, programs=pc, us_date=date, address_us=r["addresses"][:200])
            g.edge(nid, "gov:us", "designated_by", date, url, OFAC_OS_FILE, (r["sanctions"] or "")[:160], rec,
                   program=pc, date_note=OS_DATE_NOTE, us_list="SDN")
            for c in [x for x in r["countries"].split(";") if x]:
                if g.country(c):
                    g.edge(nid, "cc:" + c, "registered_in", "", url, OFAC_OS_FILE, "OFAC country: " + CNAME.get(c, c), rec)
                    g.node(nid, country=c)
        elif c2:
            pc = prog_class(c2["programs"])
            g.node(nid, programs=pc, us_date=c2["start_date"])
            g.edge(nid, "gov:us", "designated_by", c2["start_date"], OFAC_ENTRY.format(c2["entity_number"]), CSL_FILE,
                   "Programmes: " + c2["programs"], "OFAC ent_num " + c2["entity_number"], program=pc,
                   us_list=csl_list(c2["source"]))
        if r := uk_entities.get(key):
            d = ddmmyyyy(r["Date Designated"])
            g.node(nid, uk_date=d)
            g.edge(nid, "gov:uk", "designated_by", d, UK_ENTRY.format(r["Unique ID"], "Entity"), UK_FILE,
                   (r["UK Statement of Reasons"] or r["Other Information"])[:200], r["Unique ID"],
                   uk_freeze="Asset freeze" in r["Sanctions Imposed"])

    csl_people = {norm_co(r["name"]) for r in csl if r["type"] == "Individual" and "Treasury" in r["source"]}
    ren = {}
    for nid, n in list(g.nodes.items()):
        k = norm_co(n["name"]) if n.get("type") == "company" else ""
        if k and (k in csl_people or (k in sdn_people and k not in us_orgs)):
            pid = "p:" + k.replace(" ", "-")
            g.nodes[pid] = dict(g.nodes.pop(nid), id=pid, type="person", named_by="OFAC SDN list",
                                role="individual named by OFAC as linked to listed vessels")
            ren[nid] = pid
    edges, g.edges = list(g.edges.values()), {}
    for e in edges:
        e["source"], e["target"] = ren.get(e["source"], e["source"]), ren.get(e["target"], e["target"])
        g.fold(e)


def build_official(raw_dir: Path, fetch=fetch_text, extra_companies: dict[str, str] | None = None) -> dict:
    """The official layer as {"nodes": [...], "edges": [...]} in the long nodes.json/edges.json shape.
    `extra_companies` ({id: name}) are looked up in the lists like the companies the vessels name, for the kg page's
    sake (see fleet_base.kg_extra_companies). One that no vessel names becomes a node flagged kg_only."""
    raw_dir = Path(raw_dir)
    uk = (raw_dir / "uk.csv").read_text(encoding="utf-8-sig")
    us = (raw_dir / "us.csv").read_text(encoding="utf-8-sig")
    ofac, eu = fetch(OS_OFAC), fetch(OS_EU_JOURNAL)
    g = _Graph()
    for gid, name in GOVS.items():
        g.node(gid, type="government", name=name)
    for part in (parse_uk(uk), parse_csl(us, parse_os_ofac_dates(ofac)), parse_os_eu_journal(eu)):
        g.add(*part)
    for cid, name in (extra_companies or {}).items():
        if cid not in g.nodes:
            g.node(cid, type="company", name=name, kg_only=True)
    _company_listings_and_people(g, uk, us, ofac)
    return g.finish()
