# Undercurrent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Undercurrent, a static one-page sanctions lookup for journalists: search a ship, IMO number, company or person across our research and the US, UK, EU and UN sanctions lists, with sourced dossiers, a guided walkthrough, four research stories, a nightly list refresh that can't publish bad data, and an optional live OpenSanctions check.

**Architecture:** Plain HTML/CSS/ES-module JavaScript served as static files by Vercel; no framework and no build step for the site. Python (standard library only) builds two kinds of data file: `data/research-index.json` (once, from the copied research) and `data/lists/*.json` (nightly, from the four official downloads). One Vercel Function (`api/search.js`) proxies OpenSanctions. GitHub Actions runs tests on every change and the nightly refresh.

**Tech Stack:** Python 3.12 (stdlib; pytest for tests), Node 22 (built-in `node:test`), Playwright 1.48.2 (smoke test only), Vercel (static + one Node function), GitHub Actions.

**Spec:** `docs/specs/2026-10-13-undercurrent-design.md`. Visual reference: `docs/design/mockup-dark.html`.

## Global Constraints

- Repo root: `~/Desktop/portfolio/projects/undercurrent` (already a git repo on `main` with the spec, the mockup and a `.gitignore`). All paths below are relative to it.
- Old research repo (read only, never modified): `/Users/taruntheegela/Desktop/portfolio/projects/veil-trace`, pinned at commit `88dcaa2`.
- The site has no runtime dependencies and no build step. `package.json` exists only for test tooling and `"type": "module"`.
- Python build scripts use the standard library only. Python dev dependency: `pytest==8.3.3`.
- All colours and fonts in `app/style.css` come from the token block on `:root` (Hallmark rule). Fonts: Schibsted Grotesk, Source Serif 4, JetBrains Mono. Accent `oklch(68% 0.19 32)` is used only for government listings, the primary walkthrough button and focus rings. No italic headings.
- Plain words on screen: "Listed by the United States", not "SDN / EO14024"; program codes appear only inside sources.
- Every fact shown has at least one numbered source. Every result set ends with the caveat: "A name match is a possible match, not proof. Ships and companies share names; check the numbered source before you publish. This site describes documented conduct and makes no legal findings."
- Any text or URL that came from a data file is escaped before it reaches `innerHTML`; any URL from data goes through `safeUrl` (http, https or relative only).
- No horizontal scroll at 320, 375, 414, 768 or 1280 px.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Task 14 creates outside resources (GitHub repo, Vercel project). Every step there needs the owner's explicit yes first.

## Review Focus

1. **Queries that normalise to nothing** (Cyrillic "Совкомфлот", "LLC", "..."): the page must say "Type the name in Latin letters, or use the IMO number", never match everything. Pinned in Task 7 (`prepareQuery`) and Task 12 (Playwright).
2. **IMO typed in other shapes** ("IMO 9408695", "imo9408695", " 9408695 "): must land on the same ship. Pinned in Task 1 (`parse_imo`/`parseImo`) and Task 7 (`searchResearch`).
3. **Very common words** ("SHIPPING", "TRADING"): at most 10 results per layer, exact and all-word matches first, no freeze. Pinned in Task 7 (ranking order and limit).
4. **Fast typing with a slow OpenSanctions answer**: an older answer must never overwrite a newer search. Pinned in Task 7 (`latestOnly`) and used in Task 9.
5. **Hostile or odd characters in list data** (`<script>`, `"`, `javascript:` URLs in names or links): shown as text, links neutralised. Pinned in Task 8 (`escapeHtml`, `safeUrl`, dossier render test).

---

## File map

| Path | Responsibility |
|---|---|
| `scripts/normalize.py` | Name normalisation and IMO parsing (Python side) |
| `scripts/normalize_cases.json` | Shared cases both normalisers must pass |
| `scripts/lists.py` | Parsers for the four official lists + plain program names |
| `scripts/build_official_lists.py` | Nightly: download, validate, keep-previous, write `data/lists/` |
| `scripts/smoke_lists.py` | Post-build check that every data file loads and finds known names |
| `scripts/build_research_index.py` | One-off: research data under `stories/` to `data/research-index.json` |
| `scripts/fixtures/` | Small real samples of each official list |
| `scripts/test_*.py` | pytest |
| `app/normalize.js` | Name normalisation and IMO parsing (browser side) |
| `app/search.js` | Data loading, query preparation, ranking, staleness, latest-only guard |
| `app/render.js` | HTML for dossiers, lists table, wider check, states; citation text |
| `app/main.js` | Wires the page: input, loading, rendering, retry, copy citation, list date |
| `app/walkthrough.js` | Five-step guided tour |
| `app/style.css` | Tokens and styles (from the mockup plus result states) |
| `index.html` | The one page |
| `api/search.js` | OpenSanctions proxy (Vercel Function) |
| `stories/…` | Research pages copied from the old repo, plus `about-the-data.html` |
| `tests/*.test.js` | node:test unit tests |
| `tests/smoke.spec.js`, `playwright.config.js` | Playwright smoke test |
| `.github/workflows/check.yml`, `update-lists.yml` | CI and nightly refresh |
| `vercel.json`, `.vercelignore`, `README.md`, `LICENSE` | Hosting and docs |

---

### Task 1: Scaffold and shared normalisation

**Files:**
- Create: `package.json`, `requirements-dev.txt`, `LICENSE`
- Modify: `.gitignore`
- Create: `scripts/normalize.py`, `scripts/normalize_cases.json`, `scripts/test_normalize.py`
- Create: `app/normalize.js`, `tests/normalize.test.js`

**Interfaces:**
- Produces (Python): `normalize_name(name: str) -> str`, `parse_imo(text: str) -> str | None`, `LEGAL_SUFFIXES: frozenset[str]`
- Produces (JS): `normalizeName(name: string): string`, `parseImo(text: string): string | null`, `LEGAL_SUFFIXES: Set<string>`

- [ ] **Step 1: Scaffold files**

`package.json`:
```json
{
  "name": "undercurrent",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test \"tests/**/*.test.js\"",
    "smoke": "playwright test"
  },
  "devDependencies": {
    "@playwright/test": "1.48.2"
  }
}
```

`requirements-dev.txt`:
```
pytest==8.3.3
```

`.gitignore` (replace contents):
```
.superpowers/
.DS_Store
node_modules/
test-results/
playwright-report/
__pycache__/
.pytest_cache/
*.tmp
.vercel
```

`LICENSE`: the standard MIT licence text with the line `Copyright (c) 2026 Tarun Theegela`.

Run: `npm install`
Expected: creates `package-lock.json` and `node_modules/`, exit 0.

Run: `python3 -m pip install -r requirements-dev.txt`
Expected: pytest installed.

- [ ] **Step 2: Write the shared cases**

`scripts/normalize_cases.json`:
```json
{
  "names": [
    {"in": "TASSOS", "out": "TASSOS"},
    {"in": "Sovcomflot PJSC", "out": "SOVCOMFLOT"},
    {"in": "  Hongkong Yaqing Shipping Co., Limited ", "out": "HONGKONG YAQING SHIPPING"},
    {"in": "OOO \"Elem Group\"", "out": "ELEM GROUP"},
    {"in": "Müller GmbH & Co. KG", "out": "MULLER"},
    {"in": "Al-Tikriti", "out": "AL TIKRITI"},
    {"in": "Société Générale S.A.", "out": "SOCIETE GENERALE S A"},
    {"in": "Ya Qing Hai Yang", "out": "YA QING HAI YANG"},
    {"in": "Совкомфлот", "out": ""},
    {"in": "LLC", "out": ""},
    {"in": "...", "out": ""},
    {"in": "", "out": ""}
  ],
  "imos": [
    {"in": "9408695", "out": "9408695"},
    {"in": " 9408695 ", "out": "9408695"},
    {"in": "IMO 9408695", "out": "9408695"},
    {"in": "imo9408695", "out": "9408695"},
    {"in": "940869", "out": null},
    {"in": "94086951", "out": null},
    {"in": "TASSOS", "out": null}
  ]
}
```

- [ ] **Step 3: Write the failing tests**

`scripts/test_normalize.py`:
```python
import json
from pathlib import Path

import pytest

from normalize import normalize_name, parse_imo

CASES = json.loads((Path(__file__).parent / "normalize_cases.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("case", CASES["names"], ids=lambda c: c["in"] or "<empty>")
def test_normalize_name(case):
    assert normalize_name(case["in"]) == case["out"]


@pytest.mark.parametrize("case", CASES["imos"], ids=lambda c: c["in"])
def test_parse_imo(case):
    assert parse_imo(case["in"]) == case["out"]
```

`tests/normalize.test.js`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeName, parseImo } from "../app/normalize.js";

const cases = JSON.parse(readFileSync(new URL("../scripts/normalize_cases.json", import.meta.url), "utf8"));

test("normalizeName matches the shared cases", () => {
  for (const c of cases.names) assert.equal(normalizeName(c.in), c.out, `input: ${JSON.stringify(c.in)}`);
});

test("parseImo matches the shared cases", () => {
  for (const c of cases.imos) assert.equal(parseImo(c.in), c.out, `input: ${JSON.stringify(c.in)}`);
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `python3 -m pytest -q scripts/test_normalize.py`
Expected: FAIL, `ModuleNotFoundError: No module named 'normalize'`.

Run: `npm test`
Expected: FAIL, cannot find module `app/normalize.js`.

- [ ] **Step 5: Implement**

`scripts/normalize.py`:
```python
"""Name normalisation shared by every build script. Mirrors app/normalize.js;
both must pass scripts/normalize_cases.json."""
from __future__ import annotations

import re
import unicodedata

# Legal-form suffixes dropped during normalisation (whole tokens only).
LEGAL_SUFFIXES = frozenset({
    "LLC", "LTD", "LIMITED", "INC", "INCORPORATED", "CORP", "CORPORATION",
    "CO", "COMPANY", "PLC", "GMBH", "SA", "SAS", "SARL", "SRL", "SPA",
    "BV", "NV", "AG", "KG", "OY", "AB", "AS", "PTY", "PJSC", "JSC",
    "OJSC", "PAO", "ZAO", "OOO", "OAO", "PC", "LP", "LLP", "SDN", "BHD",
    "KFT", "DOO", "EOOD", "AD", "SP", "ZOO", "TOO",
})

_PUNCT_RE = re.compile(r"[^A-Z0-9_\s]")
_IMO_RE = re.compile(r"^\s*(?:IMO\s*)?(\d{7})\s*$", re.IGNORECASE)


def normalize_name(name: str) -> str:
    """Case-fold, strip accents and non-Latin characters, punctuation and legal suffixes."""
    if not name:
        return ""
    text = unicodedata.normalize("NFKD", name)
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = text.encode("ascii", "ignore").decode("ascii").upper()
    text = _PUNCT_RE.sub(" ", text)
    return " ".join(t for t in text.split() if t not in LEGAL_SUFFIXES)


def parse_imo(text: str) -> str | None:
    """'9408695', 'IMO 9408695', 'imo9408695' -> '9408695'; anything else -> None."""
    match = _IMO_RE.match(text or "")
    return match.group(1) if match else None
```

`app/normalize.js`:
```js
// Mirrors scripts/normalize.py; both must pass scripts/normalize_cases.json.
export const LEGAL_SUFFIXES = new Set([
  "LLC", "LTD", "LIMITED", "INC", "INCORPORATED", "CORP", "CORPORATION",
  "CO", "COMPANY", "PLC", "GMBH", "SA", "SAS", "SARL", "SRL", "SPA",
  "BV", "NV", "AG", "KG", "OY", "AB", "AS", "PTY", "PJSC", "JSC",
  "OJSC", "PAO", "ZAO", "OOO", "OAO", "PC", "LP", "LLP", "SDN", "BHD",
  "KFT", "DOO", "EOOD", "AD", "SP", "ZOO", "TOO",
]);

export function normalizeName(name) {
  if (!name) return "";
  return name
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\x00-\x7F]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9_\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t && !LEGAL_SUFFIXES.has(t))
    .join(" ");
}

export function parseImo(text) {
  const match = /^\s*(?:IMO\s*)?(\d{7})\s*$/i.exec(text || "");
  return match ? match[1] : null;
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `python3 -m pytest -q scripts/test_normalize.py && npm test`
Expected: all pass (19 pytest cases, 2 node tests).

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json requirements-dev.txt LICENSE .gitignore scripts/normalize.py scripts/normalize_cases.json scripts/test_normalize.py app/normalize.js tests/normalize.test.js
git commit -m "feat: shared name normalisation for Python and JS

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Official list parsers and fixtures

**Files:**
- Create: `scripts/lists.py`, `scripts/test_lists.py`
- Create: `scripts/fixtures/us.csv`, `scripts/fixtures/uk.csv`, `scripts/fixtures/eu.csv`, `scripts/fixtures/un.xml` (generated in Step 1)

**Interfaces:**
- Consumes: `normalize_name` (Task 1)
- Produces: `LISTS: dict[str, {"label","download","page"}]` keyed `us|uk|eu|un`; `PARSERS: dict[str, Callable[[bytes], list[list[str]]]]`; `plain_program(raw: str, list_id: str) -> str`. A record is `[name, normalised_name, program, date, ref, imo, url]` (7 strings; `date` is `YYYY-MM-DD` or `""`; `imo` 7 digits or `""`; `url` per-record link or `""`).

Facts confirmed on 2026-10-13 against the live files (so tests can be exact):
- US Consolidated Screening List CSV has TASSOS: `_id` 54815, `programs` `IRAN-EO13902`, `start_date` empty, `ids` contains `IMO 9408695`.
- UK list: first line `Report Date: …`, header on line 2. TASSOS: `Unique ID` RUS3483, `Regime Name` "The Russia (Sanctions) (EU Exit) Regulations 2019", `Date Designated` 24/02/2026, `IMO number` IMO9408695. `Name type` values mix case ("Primary name", "Primary Name").
- EU file is `;`-separated, one row per name × address × other detail. Entity 13 is "Saddam Hussein Al-Tikriti", programme `IRQ`. EU ship port bans (where TASSOS is listed) are **not** in this file.
- UN XML: first individual "ERIC BADEGE", list type `DRC`, listed 2012-12-31.

- [ ] **Step 1: Generate fixtures from the live files**

```bash
RAW=$(mktemp -d)
curl -sSL -m 280 -A "Mozilla/5.0" -o "$RAW/us.csv" https://data.trade.gov/downloadable_consolidated_screening_list/v1/consolidated.csv
curl -sSL -m 280 -A "Mozilla/5.0" -o "$RAW/uk.csv" https://sanctionslist.fcdo.gov.uk/docs/UK-Sanctions-List.csv
curl -sSL -m 280 -A "Mozilla/5.0" -o "$RAW/un.xml" https://scsanctions.un.org/resources/xml/en/consolidated.xml
curl -sSL -m 280 -A "Mozilla/5.0" -o "$RAW/eu.csv" "https://webgate.ec.europa.eu/fsd/fsf/public/files/csvFullSanctionsList_1_1/content?token=dG9rZW4tMjAxNw"
mkdir -p scripts/fixtures
python3 -I - "$RAW" scripts/fixtures <<'EOF'
import csv, sys, xml.etree.ElementTree as ET
csv.field_size_limit(2**31 - 1)
src, dst = sys.argv[1], sys.argv[2]

with open(f"{src}/us.csv", encoding="utf-8-sig", newline="") as f:
    r = csv.DictReader(f); rows = list(r); fields = r.fieldnames
pick = [x for x in rows if x["name"] == "TASSOS"][:1] + [x for x in rows if x["alt_names"]][:1] + rows[:3]
with open(f"{dst}/us.csv", "w", newline="", encoding="utf-8") as f:
    w = csv.DictWriter(f, fields); w.writeheader(); w.writerows(pick)

with open(f"{src}/uk.csv", encoding="utf-8-sig", newline="") as f:
    banner = f.readline(); r = csv.DictReader(f); rows = list(r); fields = r.fieldnames
pick = [x for x in rows if x["Name 6"] == "TASSOS"] + rows[:3]
with open(f"{dst}/uk.csv", "w", newline="", encoding="utf-8") as f:
    f.write(banner); w = csv.DictWriter(f, fields); w.writeheader(); w.writerows(pick)

with open(f"{src}/eu.csv", encoding="utf-8-sig", newline="") as f:
    r = csv.DictReader(f, delimiter=";"); rows = list(r); fields = r.fieldnames
pick = [x for x in rows if x["Entity_LogicalId"] == "13"] + rows[:3]
with open(f"{dst}/eu.csv", "w", newline="", encoding="utf-8") as f:
    w = csv.DictWriter(f, fields, delimiter=";"); w.writeheader(); w.writerows(pick)

root = ET.parse(f"{src}/un.xml").getroot()
for group_tag, child_tag in (("INDIVIDUALS", "INDIVIDUAL"), ("ENTITIES", "ENTITY")):
    group = root.find(group_tag)
    for extra in group.findall(child_tag)[2:]:
        group.remove(extra)
ET.ElementTree(root).write(f"{dst}/un.xml", encoding="utf-8", xml_declaration=True)
EOF
ls -la scripts/fixtures
rm -rf "$RAW"
```
Expected: four files, each under 100 KB.

- [ ] **Step 2: Write the failing tests**

`scripts/test_lists.py`:
```python
from collections import Counter
from pathlib import Path

import pytest

from lists import LISTS, PARSERS, plain_program

FIX = Path(__file__).parent / "fixtures"
FILES = {"us": "us.csv", "uk": "uk.csv", "eu": "eu.csv", "un": "un.xml"}


def load(list_id):
    return PARSERS[list_id]((FIX / FILES[list_id]).read_bytes())


def only(records, name):
    found = [r for r in records if r[0] == name]
    assert found, f"{name} not found"
    return found[0]


def test_every_record_has_seven_fields_and_a_normalised_name():
    for list_id in LISTS:
        for record in load(list_id):
            assert len(record) == 7
            assert record[1]


def test_us_tassos():
    r = only(load("us"), "TASSOS")
    assert r[1:] == ["TASSOS", "Iran", "", "54815", "9408695", ""]


def test_us_alt_names_become_their_own_records():
    refs = Counter(r[4] for r in load("us"))
    assert max(refs.values()) >= 2


def test_uk_tassos():
    r = only(load("uk"), "TASSOS")
    assert r[1:] == ["TASSOS", "Russia", "2026-02-24", "RUS3483", "9408695", ""]


def test_uk_without_banner_line_is_rejected():
    raw = (FIX / "uk.csv").read_bytes().split(b"\n", 1)[1]
    with pytest.raises(ValueError, match="Report Date"):
        PARSERS["uk"](raw)


def test_eu_entity_13():
    r = only(load("eu"), "Saddam Hussein Al-Tikriti")
    assert r[1] == "SADDAM HUSSEIN AL TIKRITI"
    assert r[2] == "Iraq"
    assert r[4] == "13"
    assert r[6].startswith("http")


def test_eu_rows_are_deduplicated_per_entity_and_name():
    keys = [(r[4], r[1]) for r in load("eu")]
    assert len(keys) == len(set(keys))


def test_un_first_individual():
    r = only(load("un"), "ERIC BADEGE")
    assert r[2] == "DR Congo"
    assert r[3] == "2012-12-31"


def test_missing_column_is_rejected():
    raw = (FIX / "us.csv").read_bytes().replace(b"alt_names", b"other_names", 1)
    with pytest.raises(ValueError, match="missing columns"):
        PARSERS["us"](raw)


def test_garbage_xml_is_rejected():
    with pytest.raises(ValueError):
        PARSERS["un"](b"<html>Service unavailable</html>")


@pytest.mark.parametrize("raw,list_id,expected", [
    ("IRAN-EO13902", "us", "Iran"),
    ("RUSSIA-EO14024; UKRAINE-EO13662", "us", "Russia, Russia/Ukraine"),
    ("SDGT", "us", "Terrorism"),
    ("XYZ-NEW", "us", "XYZ-NEW"),
    ("IRQ", "eu", "Iraq"),
    ("UKR", "eu", "Russia/Ukraine"),
    ("DRC", "un", "DR Congo"),
    ("Taliban", "un", "Taliban"),
])
def test_plain_program(raw, list_id, expected):
    assert plain_program(raw, list_id) == expected
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `python3 -m pytest -q scripts/test_lists.py`
Expected: FAIL, `ModuleNotFoundError: No module named 'lists'`.

- [ ] **Step 4: Implement**

`scripts/lists.py`:
```python
"""Parsers for the four official sanctions lists.

Each parser takes the raw downloaded bytes and returns records
    [name, normalised name, program, date (YYYY-MM-DD or ""), ref, imo or "", url or ""]
and raises ValueError when the file does not have the expected shape.
"""
from __future__ import annotations

import csv
import io
import re
import xml.etree.ElementTree as ET
from datetime import datetime

from normalize import normalize_name

csv.field_size_limit(2**31 - 1)

LISTS = {
    "us": {
        "label": "United States",
        "download": "https://data.trade.gov/downloadable_consolidated_screening_list/v1/consolidated.csv",
        "page": "https://www.trade.gov/consolidated-screening-list",
    },
    "uk": {
        "label": "United Kingdom",
        "download": "https://sanctionslist.fcdo.gov.uk/docs/UK-Sanctions-List.csv",
        "page": "https://www.gov.uk/government/publications/the-uk-sanctions-list",
    },
    "eu": {
        "label": "European Union",
        "download": "https://webgate.ec.europa.eu/fsd/fsf/public/files/csvFullSanctionsList_1_1/content?token=dG9rZW4tMjAxNw",
        "page": "https://data.europa.eu/data/datasets/consolidated-list-of-persons-groups-and-entities-subject-to-eu-financial-sanctions",
    },
    "un": {
        "label": "United Nations",
        "download": "https://scsanctions.un.org/resources/xml/en/consolidated.xml",
        "page": "https://main.un.org/securitycouncil/en/content/un-sc-consolidated-list",
    },
}

_US_PREFIXES = [
    ("RUSSIA", "Russia"), ("UKRAINE", "Russia/Ukraine"), ("BELARUS", "Belarus"),
    ("IRAN", "Iran"), ("IRGC", "Iran"), ("IFSR", "Iran"),
    ("DPRK", "North Korea"), ("NKOREA", "North Korea"),
    ("SYRIA", "Syria"), ("PAARSSR", "Syria"), ("VENEZUELA", "Venezuela"),
    ("CUBA", "Cuba"), ("BURMA", "Myanmar"), ("SDGT", "Terrorism"), ("FTO", "Terrorism"),
    ("SDNTK", "Narcotics"), ("ILLICIT-DRUGS", "Narcotics"), ("TCO", "Organised crime"),
    ("NPWMD", "Weapons proliferation"), ("GLOMAG", "Human rights and corruption"),
    ("CYBER", "Cyber"), ("BALKANS", "Western Balkans"),
]
_EU_CODES = {
    "UKR": "Russia/Ukraine", "RUS": "Russia", "RUSDA": "Russia", "BLR": "Belarus",
    "IRN": "Iran", "IRQ": "Iraq", "SYR": "Syria", "PRK": "North Korea",
    "AFG": "Afghanistan", "TAQA": "Terrorism", "EUAQ": "Terrorism", "TERR": "Terrorism",
    "HAM": "Terrorism", "HR": "Human rights", "COD": "DR Congo", "MMR": "Myanmar",
    "SOM": "Somalia", "CYB": "Cyber", "LBY": "Libya", "CAF": "Central African Republic",
    "VEN": "Venezuela", "CHEM": "Chemical weapons", "MDA": "Moldova", "NIC": "Nicaragua",
    "TUN": "Tunisia", "YEM": "Yemen", "SDN": "Sudan", "SDNZ": "Sudan", "SSD": "South Sudan",
    "HTI": "Haiti", "GTM": "Guatemala", "MLI": "Mali", "GIN": "Guinea",
}
_UN_TYPES = {
    "DRC": "DR Congo", "CAR": "Central African Republic", "DPRK": "North Korea",
    "GB": "Guinea-Bissau", "SouthSudan": "South Sudan",
}
_IMO_RE = re.compile(r"IMO\s*(\d{7})", re.IGNORECASE)
_UK_REGIME_RE = re.compile(r"^The (.+?)(?: \(Sanctions\)| Sanctions)")


def plain_program(raw: str, list_id: str) -> str:
    """Turn a list's program code into plain words; unknown codes pass through."""
    raw = (raw or "").strip()
    if list_id == "eu":
        return _EU_CODES.get(raw, raw)
    if list_id == "un":
        return _UN_TYPES.get(raw, raw)
    if list_id == "us":
        labels: list[str] = []
        for code in (c.strip().upper() for c in raw.split(";")):
            if not code:
                continue
            label = next((name for prefix, name in _US_PREFIXES if code.startswith(prefix)), code)
            if label not in labels:
                labels.append(label)
        return ", ".join(labels)
    return raw


def _imo(text: str) -> str:
    match = _IMO_RE.search(text or "")
    return match.group(1) if match else ""


def _record(name: str, program: str, date: str, ref: str, imo: str = "", url: str = "") -> list[str]:
    return [name, normalize_name(name), program, date, ref, imo, url]


def _require(fields, required: list[str], list_id: str) -> None:
    missing = [f for f in required if f not in (fields or [])]
    if missing:
        raise ValueError(f"{list_id}: missing columns {missing}")


def _dedupe(records: list[list[str]]) -> list[list[str]]:
    """Drop records whose name normalises to nothing, and repeats of (ref, name)."""
    seen: set[tuple[str, str]] = set()
    out = []
    for record in records:
        key = (record[4], record[1])
        if record[1] and key not in seen:
            seen.add(key)
            out.append(record)
    return out


def parse_us(data: bytes) -> list[list[str]]:
    reader = csv.DictReader(io.StringIO(data.decode("utf-8-sig")))
    _require(reader.fieldnames, ["_id", "source", "name", "programs", "start_date", "alt_names", "ids"], "us")
    out = []
    for row in reader:
        name = (row["name"] or "").strip()
        if not name:
            continue
        program = plain_program(row["programs"], "us") or (row["source"] or "").split(" - ")[0].strip()
        date = (row["start_date"] or "").strip()[:10]
        imo = _imo(row["ids"])
        names = [name] + [alt.strip() for alt in (row["alt_names"] or "").split(";")]
        out += [_record(n, program, date, row["_id"], imo) for n in names if n]
    return _dedupe(out)


def _dmy(text: str) -> str:
    try:
        return datetime.strptime(text.strip(), "%d/%m/%Y").strftime("%Y-%m-%d")
    except ValueError:
        return ""


def parse_uk(data: bytes) -> list[list[str]]:
    text = data.decode("utf-8-sig")
    banner, _, body = text.partition("\n")
    if not banner.startswith("Report Date"):
        raise ValueError("uk: first line is not the 'Report Date' banner")
    reader = csv.DictReader(io.StringIO(body))
    _require(reader.fieldnames, ["Unique ID", "Name 6", "Regime Name", "Date Designated", "IMO number"], "uk")
    out = []
    for row in reader:
        name = (row["Name 6"] or "").strip()
        if not name:
            continue
        regime = (row["Regime Name"] or "").strip()
        match = _UK_REGIME_RE.match(regime)
        program = match.group(1) if match else regime
        out.append(_record(name, program, _dmy(row["Date Designated"] or ""), row["Unique ID"], _imo(row["IMO number"])))
    return _dedupe(out)


def parse_eu(data: bytes) -> list[list[str]]:
    reader = csv.DictReader(io.StringIO(data.decode("utf-8-sig")), delimiter=";")
    required = ["Entity_LogicalId", "Entity_DesignationDate", "Entity_Regulation_Programme",
                "Entity_Regulation_PublicationUrl", "NameAlias_WholeName"]
    _require(reader.fieldnames, required, "eu")
    out = []
    for row in reader:
        name = (row["NameAlias_WholeName"] or "").strip()
        if not name:
            continue
        url = (row["Entity_Regulation_PublicationUrl"] or "").strip()
        out.append(_record(
            name,
            plain_program(row["Entity_Regulation_Programme"], "eu"),
            (row["Entity_DesignationDate"] or "").strip()[:10],
            row["Entity_LogicalId"],
            url=url if url.startswith("http") else "",
        ))
    return _dedupe(out)


def parse_un(data: bytes) -> list[list[str]]:
    try:
        root = ET.fromstring(data)
    except ET.ParseError as exc:
        raise ValueError(f"un: not XML ({exc})") from exc
    if root.tag != "CONSOLIDATED_LIST" or (root.find("INDIVIDUALS") is None and root.find("ENTITIES") is None):
        raise ValueError("un: not a UN consolidated list")
    out = []
    groups = (
        ("ENTITIES", "ENTITY", "ENTITY_ALIAS", ("FIRST_NAME",)),
        ("INDIVIDUALS", "INDIVIDUAL", "INDIVIDUAL_ALIAS", ("FIRST_NAME", "SECOND_NAME", "THIRD_NAME", "FOURTH_NAME")),
    )
    for group_tag, item_tag, alias_tag, name_tags in groups:
        group = root.find(group_tag)
        if group is None:
            continue
        for item in group.findall(item_tag):
            name = " ".join((item.findtext(t) or "").strip() for t in name_tags if (item.findtext(t) or "").strip())
            if not name:
                continue
            program = plain_program(item.findtext("UN_LIST_TYPE") or "", "un")
            date = (item.findtext("LISTED_ON") or "").strip()[:10]
            ref = (item.findtext("REFERENCE_NUMBER") or "").strip()
            out.append(_record(name, program, date, ref))
            for alias in item.findall(alias_tag):
                alias_name = (alias.findtext("ALIAS_NAME") or "").strip()
                if alias_name:
                    out.append(_record(alias_name, program, date, ref))
    return _dedupe(out)


PARSERS = {"us": parse_us, "uk": parse_uk, "eu": parse_eu, "un": parse_un}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `python3 -m pytest -q scripts`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add scripts/lists.py scripts/test_lists.py scripts/fixtures
git commit -m "feat: parsers for US, UK, EU and UN sanctions lists

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Nightly list builder with keep-previous

**Files:**
- Create: `scripts/build_official_lists.py`, `scripts/test_build_official_lists.py`

**Interfaces:**
- Consumes: `LISTS`, `PARSERS` (Task 2)
- Produces: `main(fetch_fn=fetch, out_dir=OUT_DIR, now=None) -> int` (0 all fresh, 1 any failed). Files: `data/lists/<id>.json` = `{"list": id, "records": [...]}` (no timestamps, so unchanged data gives a byte-identical file), and `data/lists/meta.json`:
  ```json
  {"lists": {"us": {"label": "United States", "source_url": "https://…", "checked_at": "2026-10-13T04:00:00Z",
                    "status": "fresh", "updated_at": "2026-10-13T04:00:00Z", "record_count": 26000}, …}}
  ```
  On failure: `status` is `"kept-previous"`, `updated_at` is the last fresh time (or `null`), plus `"error": "<Type>: <message>"`.

- [ ] **Step 1: Write the failing tests**

`scripts/test_build_official_lists.py`:
```python
import json
from pathlib import Path

import build_official_lists as b

FIX = Path(__file__).parent / "fixtures"
FILES = {"us": "us.csv", "uk": "uk.csv", "eu": "eu.csv", "un": "un.xml"}
DAY1 = "2026-10-12T04:00:00Z"
DAY2 = "2026-10-13T04:00:00Z"


def fixture_fetch(url):
    for list_id, meta in b.LISTS.items():
        if meta["download"] == url:
            return (FIX / FILES[list_id]).read_bytes()
    raise AssertionError(f"unexpected url {url}")


def read_meta(out):
    return json.loads((out / "meta.json").read_text())["lists"]


def test_all_lists_fresh(tmp_path):
    assert b.main(fixture_fetch, tmp_path, DAY1) == 0
    meta = read_meta(tmp_path)
    assert {m["status"] for m in meta.values()} == {"fresh"}
    assert meta["uk"]["updated_at"] == DAY1
    us = json.loads((tmp_path / "us.json").read_text())
    assert any(r[0] == "TASSOS" for r in us["records"])


def test_unchanged_data_leaves_list_file_identical(tmp_path):
    b.main(fixture_fetch, tmp_path, DAY1)
    before = (tmp_path / "eu.json").read_bytes()
    b.main(fixture_fetch, tmp_path, DAY2)
    assert (tmp_path / "eu.json").read_bytes() == before
    assert read_meta(tmp_path)["eu"]["checked_at"] == DAY2


def test_failed_download_keeps_previous_and_others_still_update(tmp_path):
    b.main(fixture_fetch, tmp_path, DAY1)
    before = (tmp_path / "uk.json").read_text()

    def broken(url):
        if url == b.LISTS["uk"]["download"]:
            raise OSError("timed out")
        return fixture_fetch(url)

    assert b.main(broken, tmp_path, DAY2) == 1
    meta = read_meta(tmp_path)
    assert meta["uk"]["status"] == "kept-previous"
    assert meta["uk"]["updated_at"] == DAY1
    assert "timed out" in meta["uk"]["error"]
    assert (tmp_path / "uk.json").read_text() == before
    assert meta["us"]["status"] == "fresh" and meta["us"]["updated_at"] == DAY2


def test_shrunken_list_is_rejected(tmp_path):
    b.main(fixture_fetch, tmp_path, DAY1)
    path = tmp_path / "un.json"
    doc = json.loads(path.read_text())
    doc["records"] = doc["records"] * 10
    path.write_text(json.dumps(doc))
    assert b.main(fixture_fetch, tmp_path, DAY2) == 1
    meta = read_meta(tmp_path)["un"]
    assert meta["status"] == "kept-previous"
    assert "shrank" in meta["error"]
    assert len(json.loads(path.read_text())["records"]) == len(doc["records"])


def test_wrong_shape_with_no_previous_file(tmp_path):
    def bad(url):
        if url == b.LISTS["us"]["download"]:
            return b"<html>maintenance</html>"
        return fixture_fetch(url)

    assert b.main(bad, tmp_path, DAY1) == 1
    meta = read_meta(tmp_path)["us"]
    assert meta["status"] == "kept-previous"
    assert meta["updated_at"] is None
    assert meta["record_count"] == 0
    assert not (tmp_path / "us.json").exists()
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m pytest -q scripts/test_build_official_lists.py`
Expected: FAIL, `ModuleNotFoundError: No module named 'build_official_lists'`.

- [ ] **Step 3: Implement**

`scripts/build_official_lists.py`:
```python
"""Download the four official lists and write data/lists/<id>.json plus meta.json.

A list that fails (download error, wrong shape, empty, or more than 20% smaller
than the committed copy) keeps its previous file and is marked "kept-previous".
Exits 1 when any list failed so the nightly workflow can open an issue.
"""
from __future__ import annotations

import json
import os
import sys
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from lists import LISTS, PARSERS

ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "data" / "lists"
SHRINK_LIMIT = 0.8
USER_AGENT = "Undercurrent/1.0 (+https://github.com/Ttheegela/undercurrent)"


def fetch(url: str) -> bytes:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=300) as response:
        return response.read()


def _write_atomic(path: Path, text: str) -> None:
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(text, encoding="utf-8")
    os.replace(tmp, path)


def build_one(list_id: str, fetch_fn, out_dir: Path, now: str, previous_meta: dict) -> dict:
    path = out_dir / f"{list_id}.json"
    prev_records = json.loads(path.read_text(encoding="utf-8"))["records"] if path.exists() else None
    base = {"label": LISTS[list_id]["label"], "source_url": LISTS[list_id]["page"], "checked_at": now}
    try:
        records = PARSERS[list_id](fetch_fn(LISTS[list_id]["download"]))
        if not records:
            raise ValueError("no records")
        if prev_records and len(records) < SHRINK_LIMIT * len(prev_records):
            raise ValueError(f"shrank from {len(prev_records)} to {len(records)} records")
    except Exception as exc:  # any failure keeps yesterday's file for this list only
        return {
            **base,
            "status": "kept-previous",
            "error": f"{type(exc).__name__}: {exc}",
            "updated_at": previous_meta.get(list_id, {}).get("updated_at"),
            "record_count": len(prev_records or []),
        }
    text = json.dumps({"list": list_id, "records": records}, ensure_ascii=False, separators=(",", ":"))
    if not path.exists() or path.read_text(encoding="utf-8") != text:
        _write_atomic(path, text)
    return {**base, "status": "fresh", "updated_at": now, "record_count": len(records)}


def main(fetch_fn=fetch, out_dir: Path = OUT_DIR, now: str | None = None) -> int:
    now = now or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    meta_path = out_dir / "meta.json"
    previous = json.loads(meta_path.read_text(encoding="utf-8"))["lists"] if meta_path.exists() else {}
    lists = {list_id: build_one(list_id, fetch_fn, out_dir, now, previous) for list_id in LISTS}
    _write_atomic(meta_path, json.dumps({"lists": lists}, indent=2) + "\n")
    for list_id, meta in lists.items():
        detail = f" - {meta['error']}" if meta.get("error") else ""
        print(f"{list_id}: {meta['status']} ({meta['record_count']} records){detail}")
    return 1 if any(m["status"] != "fresh" for m in lists.values()) else 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m pytest -q scripts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add scripts/build_official_lists.py scripts/test_build_official_lists.py
git commit -m "feat: nightly list builder that keeps the previous copy on failure

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Copy the research stories

**Files:**
- Create: `stories/how-sanctions-work/`, `stories/shadow-fleet/`, `stories/chips-into-russia/`, `stories/who-lobbies/`, `stories/sources/`
- Create: `stories/about-the-data.html`

**Interfaces:**
- Produces (paths later tasks rely on):
  - `stories/how-sanctions-work/index.html`
  - `stories/shadow-fleet/network/shadow_fleet_map.html`, `stories/shadow-fleet/network/nodes.json`, `stories/shadow-fleet/network/edges.json`, `stories/shadow-fleet/FINDINGS.md`
  - `stories/chips-into-russia/viz/index.html`, `stories/chips-into-russia/viz/listing_lag.html`, `stories/chips-into-russia/viz/listing_lag.json`, `stories/chips-into-russia/FINDINGS.md`
  - `stories/who-lobbies/influence-network/index.html`, `stories/who-lobbies/clean-names-graph/index.html`, `stories/who-lobbies/clean-names-graph/nodes.json`, `stories/who-lobbies/FINDINGS.md`
  - `stories/sources/RESEARCH_AND_SOURCES.md`, `stories/sources/METHODS_LOG.md`
  - `stories/about-the-data.html`

- [ ] **Step 1: Extract from the pinned commit**

```bash
OLD=/Users/taruntheegela/Desktop/portfolio/projects/veil-trace
TMP=$(mktemp -d)
git -C "$OLD" archive 88dcaa2 -- docs/sanctions-explained research/shadow-fleet research/russia-ukraine/viz research/russia-ukraine/FINDINGS.md research/knowledge-graph research/lobbying docs/RESEARCH_AND_SOURCES.md docs/METHODS_LOG.md | tar -x -C "$TMP"
mkdir -p stories/who-lobbies stories/chips-into-russia stories/sources
cp -R "$TMP/docs/sanctions-explained" stories/how-sanctions-work
cp -R "$TMP/research/shadow-fleet" stories/shadow-fleet
cp -R "$TMP/research/russia-ukraine/viz" stories/chips-into-russia/viz
cp "$TMP/research/russia-ukraine/FINDINGS.md" stories/chips-into-russia/FINDINGS.md
cp -R "$TMP/research/knowledge-graph" stories/who-lobbies/influence-network
cp -R "$TMP/research/lobbying/clean-names-graph" stories/who-lobbies/clean-names-graph
cp "$TMP/research/lobbying/FINDINGS.md" stories/who-lobbies/FINDINGS.md
cp "$TMP/docs/RESEARCH_AND_SOURCES.md" "$TMP/docs/METHODS_LOG.md" stories/sources/
rm -rf stories/who-lobbies/influence-network/scripts stories/chips-into-russia/viz/extract_*.py
rm -rf "$TMP"
find stories -name '*.py' -o -name '__pycache__'
```
Expected: the last command prints nothing.

- [ ] **Step 2: Confirm no page links outside its own folder**

Run: `grep -rnoE "(href|src)=.(\.\./|/research|/docs|/demo|/tools)[^\"' >]*" stories --include='*.html'`
Expected: no output. (Checked against the old repo on 2026-10-13; if anything prints, rewrite that link to its new `stories/…` path before continuing.)

- [ ] **Step 3: Add a "back to Undercurrent" link to every story page**

```bash
python3 - $(find stories -name '*.html') <<'EOF'
import pathlib, re, sys
LINK = ('<a href="/" style="position:fixed;top:12px;left:12px;z-index:9999;'
        'font:500 13px/1 system-ui,sans-serif;color:#e8eaf0;background:#141821;'
        'border:1px solid #2c3240;border-radius:4px;padding:8px 10px;text-decoration:none">'
        '&larr; Undercurrent</a>')
for name in sys.argv[1:]:
    path = pathlib.Path(name)
    text = path.read_text(encoding="utf-8")
    new = re.sub(r"(<body[^>]*>)", lambda m: m.group(1) + LINK, text, count=1)
    assert new != text, f"no <body> tag in {name}"
    path.write_text(new, encoding="utf-8")
    print("linked", name)
EOF
```
Expected: one `linked …` line per story page, no assertion error.

- [ ] **Step 4: Write `stories/about-the-data.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>About the data · Undercurrent</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Schibsted+Grotesk:wght@400;500;700;800&family=Source+Serif+4:opsz,wght@8..60,400;8..60,500&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="../app/style.css">
<style>
  .doc { max-width: 46rem; padding-block: var(--space-2xl) var(--space-4xl); }
  .doc h1 { font-weight: 800; font-size: var(--text-3xl); letter-spacing: -0.03em; line-height: 1; margin: var(--space-xs) 0 var(--space-xl); }
  .doc h2 { font-weight: 700; font-size: var(--text-lg); margin: var(--space-2xl) 0 var(--space-sm); padding-top: var(--space-sm); border-top: 2px solid var(--color-ink); }
  .doc p, .doc li { font-family: var(--font-serif); font-size: var(--text-lg); line-height: 1.6; color: var(--color-ink); }
  .doc ul { padding-left: 1.2em; }
</style>
</head>
<body>
<header class="wrap top">
  <a class="brand" href="../"><span class="brand-mark" aria-hidden="true"></span>Undercurrent</a>
  <nav aria-label="Primary"><ul><li><a href="../#research">Research</a></li><li><a href="../">Search</a></li></ul></nav>
</header>
<main class="wrap doc">
  <p class="label">About the data</p>
  <h1>What we check, and what a match means</h1>

  <h2>What we check</h2>
  <ul>
    <li><strong>Our research</strong>: 1,724 ships, 1,024 companies and 25 people in the shadow-fleet network, 8 chip-route companies and the listed companies and intermediaries in our lobbying research. A snapshot from the VeilTrace build day, 25 September 2026.</li>
    <li><strong>United States</strong>: the Consolidated Screening List, which includes the Treasury's OFAC sanctions list and Commerce export-control lists.</li>
    <li><strong>United Kingdom</strong>: the UK Sanctions List.</li>
    <li><strong>European Union</strong>: the consolidated list of persons, groups and entities subject to EU financial sanctions.</li>
    <li><strong>United Nations</strong>: the Security Council consolidated list.</li>
    <li><strong>OpenSanctions</strong>, when switched on: other countries' lists, politically exposed people and related companies. CC BY-NC 4.0.</li>
  </ul>

  <h2>How matching works</h2>
  <p>Names are compared after removing accents, punctuation and company endings such as LLC, Ltd or OOO, so small spelling differences still match. A seven-digit number, with or without "IMO" in front, is treated as a ship's IMO number and matched exactly. Names written only in non-Latin script cannot be matched; type them in Latin letters.</p>

  <h2>What a match means</h2>
  <p>A name match is a possible match, not proof. Ships and companies share names. Open the numbered source before you publish. This site describes documented conduct and makes no legal findings. It is not legal advice.</p>

  <h2>Known limits</h2>
  <ul>
    <li>EU bans on individual ships sit in an annex to Regulation 833/2014, not in the EU financial sanctions file. Those ship listings appear under "In our research", not under the official EU list.</li>
    <li>The US Consolidated Screening List often gives no listing date; the table then shows a dash.</li>
    <li>The US, UK and UN files have no link per record, so "List" opens the official list page.</li>
    <li>Our research is a snapshot and is not refreshed nightly.</li>
  </ul>

  <h2>How the lists stay current</h2>
  <p>Every night at 04:00 UTC the four official lists are downloaded and checked. A list that fails to download, changes shape, or shrinks by more than a fifth keeps yesterday's copy, and the page says "Some lists may be out of date". The other lists still update.</p>

  <h2>Credits and full notes</h2>
  <p>Research by the VeilTrace team at the Trace the Unseen build day, 25 September 2026 (<a href="https://github.com/Ttheegela/veil-trace">original repo</a>). Full notes: <a href="sources/RESEARCH_AND_SOURCES.md">research and sources</a>, <a href="sources/METHODS_LOG.md">methods log</a>.</p>
</main>
</body>
</html>
```
(`app/style.css` arrives in Task 9; until then this page renders unstyled, which is expected.)

- [ ] **Step 5: Check the pages open**

Run: `python3 -m http.server 4173 --bind 127.0.0.1` in the repo root, then open each path from the Interfaces list above in a browser.
Expected: each page renders its visual with the "← Undercurrent" link in the top-left. Stop the server with Ctrl-C.

- [ ] **Step 6: Commit**

```bash
git add stories
git commit -m "feat: research stories copied from VeilTrace (88dcaa2), with about page

Research by the VeilTrace team, Trace the Unseen build day, 25 Sep 2026:
https://github.com/Ttheegela/veil-trace

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Research index builder

**Files:**
- Create: `scripts/build_research_index.py`, `scripts/test_build_research_index.py`
- Create (generated): `data/research-index.json`

**Interfaces:**
- Consumes: `normalize_name` (Task 1); story data paths (Task 4)
- Produces: `build() -> list[dict]`, `main() -> int`, `fmt_date(value: str) -> str`, `tidy(text: str) -> str`. File `data/research-index.json` = `{"entries": [Entry, …]}` where

```
Entry = {
  "id": str,                      # "IMO9408695", "co:sovcomflot", "chip:elem", "org:hikvision"
  "kind": str,                    # "Oil Tanker", "Company", "Person", …
  "name": str,
  "keys": [str],                  # normalised names for matching (name, aliases, former names)
  "imo": str | None, "flag": str | None, "manager": str | None,
  "country": str | None, "role": str | None,
  "listings": [{"by": str, "date": str, "program": str, "ref": int}],   # sorted by date
  "events": [{"date": str, "kind": "listing"|"ownership"|"management"|"suspicion", "text": str}],
  "facts": [{"text": str, "refs": [int]}],                               # refs never empty
  "names": [{"name": str, "current": bool}],
  "flags": [str],
  "story": {"label": str, "url": str},
  "sources": [{"n": int, "label": str, "url": str}]                      # n = 1..k in order
}
```

- [ ] **Step 1: Write the failing tests**

`scripts/test_build_research_index.py`:
```python
import pytest

import build_research_index as b


@pytest.fixture(scope="module")
def entries():
    return {e["id"]: e for e in b.build()}


def test_tassos_listings(entries):
    e = entries["IMO9408695"]
    assert e["name"] == "TASSOS"
    assert e["imo"] == "9408695"
    assert e["kind"] == "Oil Tanker"
    assert e["flag"] == "Liberia"
    assert [(l["by"], l["date"], l["program"]) for l in e["listings"]] == [
        ("United States", "2025-07-30", "Iran"),
        ("European Union", "2025-10-24", "Russia"),
        ("United Kingdom", "2026-02-24", "Russia"),
    ]
    assert e["facts"][0]["text"] == (
        "Listed by the United States on 30 July 2025 (Iran), the European Union on "
        "24 October 2025 (Russia) and the United Kingdom on 24 February 2026 (Russia)."
    )


def test_tassos_names_and_history(entries):
    e = entries["IMO9408695"]
    former = {n["name"] for n in e["names"] if not n["current"]}
    assert {"Front Balder", "Bay Global", "Roxen Star", "Seasalvia"} <= former
    assert "FRONT BALDER" in e["keys"]
    assert any(ev["date"] == "2023-02" and ev["text"].startswith("Sold by Frontline") for ev in e["events"])
    assert [ev["kind"] for ev in e["events"]].count("listing") == 3


def test_every_fact_points_at_a_listed_source(entries):
    for e in entries.values():
        numbers = [s["n"] for s in e["sources"]]
        assert numbers == list(range(1, len(numbers) + 1)), e["id"]
        for fact in e["facts"]:
            assert fact["refs"], (e["id"], fact["text"])
            assert set(fact["refs"]) <= set(numbers), e["id"]


def test_all_three_datasets_present(entries):
    assert "co:sovcomflot" in entries
    assert "chip:elem" in entries
    assert any(i.startswith("org:") for i in entries)
    assert all(e["keys"] for e in entries.values())


@pytest.mark.parametrize("value,expected", [
    ("2025-07-30", "30 July 2025"),
    ("2023-02", "February 2023"),
    ("", ""),
    ("n/a", "n/a"),
])
def test_fmt_date(value, expected):
    assert b.fmt_date(value) == expected


@pytest.mark.parametrize("value,expected", [
    ("[unlisted ship manager] (Liberia)", "an unlisted ship manager (Liberia)"),
    ("the Zulu Ships Management & Operation", "the Zulu Ships Management & Operation"),
    ("[shell company] Ltd", "a shell company Ltd"),
])
def test_tidy(value, expected):
    assert b.tidy(value) == expected
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m pytest -q scripts/test_build_research_index.py`
Expected: FAIL, `ModuleNotFoundError: No module named 'build_research_index'`.

- [ ] **Step 3: Implement**

`scripts/build_research_index.py`:
```python
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
        ua = (node.get("sources") or [{}])[0].get("url")
        facts.append(fact("Has also sailed as " + join_and(former) + ".", [src.ref(ua)], src, FLEET_FINDINGS))
    aliases = [a for a in node.get("aliases", []) if normalize_name(a) not in keys_for(current, *former)]
    names = [{"name": current, "current": True}] + [{"name": n, "current": False} for n in former + aliases]
    names = [n for i, n in enumerate(names) if normalize_name(n["name"]) not in keys_for(*(m["name"] for m in names[:i]))]

    for note in node.get("research_notes", []) if node["type"] != "ship" else []:  # ship notes are internal shorthand
        facts.append(fact(note["text"], [src.ref(*FLEET_FINDINGS)], src, FLEET_FINDINGS))
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
        first_listing = c.get("first_listing") or {}
        first_suspicious = c.get("first_suspicious") or {}
        listings = []
        if first_listing.get("authority"):
            listings.append({"by": first_listing["authority"], "date": first_listing.get("date") or "", "program": "Russia", "ref": story_ref})
        facts = [fact((c.get("role") or "Company on a chip route into Russia").rstrip(".") + ".", [story_ref], src, CHIPS_FINDINGS)]
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


def lobby_entries(nodes: list) -> list[dict]:
    out = []
    for n in nodes:
        if n["type"] not in ("listed_entity", "intermediary"):
            continue
        src = Sources()
        ref = src.ref(*LOBBY_FINDINGS)
        listings = [{"by": l["list"], "date": l["date"] if re.match(r"^\d{4}", l.get("date") or "") else "", "program": "", "ref": ref}
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m pytest -q scripts`
Expected: all pass. If `test_tassos_listings` fails on `program`, print the three `designated_by` edges for `IMO9408695` and adjust `program_of` so they read Iran, Russia, Russia; do not change the test.

- [ ] **Step 5: Build the index and check its size**

Run: `python3 scripts/build_research_index.py && gzip -c data/research-index.json | wc -c`
Expected: `wrote 28xx entries to data/research-index.json` and a gzipped size under 1,000,000 bytes.

- [ ] **Step 6: Commit**

```bash
git add scripts/build_research_index.py scripts/test_build_research_index.py data/research-index.json
git commit -m "feat: research index with sourced facts, timelines and names

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Smoke check, nightly workflow and the first real lists

**Files:**
- Create: `scripts/smoke_lists.py`, `scripts/test_smoke_lists.py`
- Create: `.github/workflows/update-lists.yml`
- Create (generated): `data/lists/us.json`, `uk.json`, `eu.json`, `un.json`, `meta.json`

**Interfaces:**
- Consumes: `normalize_name` (Task 1), `main` of `build_official_lists` (Task 3), `data/research-index.json` (Task 5)
- Produces: `check(root: Path = ROOT) -> list[str]` (empty list means pass), `SAMPLES: dict[str, str]`

- [ ] **Step 1: Write the failing tests**

`scripts/test_smoke_lists.py`:
```python
import json
from pathlib import Path

import build_official_lists as b
import smoke_lists as s
from test_build_official_lists import fixture_fetch


def make_root(tmp_path: Path) -> Path:
    b.main(fixture_fetch, tmp_path / "data" / "lists", "2026-10-13T04:00:00Z")
    (tmp_path / "data" / "research-index.json").write_text(json.dumps({"entries": [{"name": "TASSOS"}]}))
    return tmp_path


def test_passes_on_good_data(tmp_path):
    assert s.check(make_root(tmp_path)) == []


def test_reports_missing_sample(tmp_path):
    root = make_root(tmp_path)
    path = root / "data" / "lists" / "uk.json"
    doc = json.loads(path.read_text())
    doc["records"] = [r for r in doc["records"] if r[0] != "TASSOS"]
    path.write_text(json.dumps(doc))
    assert s.check(root) == ["uk: sample 'TASSOS' not found"]


def test_reports_unreadable_file(tmp_path):
    root = make_root(tmp_path)
    (root / "data" / "lists" / "eu.json").write_text("{not json")
    problems = s.check(root)
    assert len(problems) == 1 and problems[0].startswith("eu: cannot load eu.json")


def test_reports_missing_research_index(tmp_path):
    root = make_root(tmp_path)
    (root / "data" / "research-index.json").unlink()
    assert s.check(root)[0].startswith("research-index.json:")
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `python3 -m pytest -q scripts/test_smoke_lists.py`
Expected: FAIL, `ModuleNotFoundError: No module named 'smoke_lists'`.

- [ ] **Step 3: Implement**

`scripts/smoke_lists.py`:
```python
"""Post-build check: every data file loads and finds a known name. Exit 1 on any problem.

Samples are names that have been on each list for years. If one is ever delisted,
the nightly issue will say so; replace it with another long-standing name.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from normalize import normalize_name

ROOT = Path(__file__).resolve().parent.parent
SAMPLES = {"us": "TASSOS", "uk": "TASSOS", "eu": "Saddam Hussein Al-Tikriti", "un": "ERIC BADEGE"}


def check(root: Path = ROOT) -> list[str]:
    problems: list[str] = []
    lists_dir = Path(root) / "data" / "lists"
    for list_id, sample in SAMPLES.items():
        path = lists_dir / f"{list_id}.json"
        try:
            records = json.loads(path.read_text(encoding="utf-8"))["records"]
        except Exception as exc:
            problems.append(f"{list_id}: cannot load {path.name}: {exc}")
            continue
        if any(not isinstance(r, list) or len(r) != 7 for r in records):
            problems.append(f"{list_id}: malformed record")
        if normalize_name(sample) not in {r[1] for r in records}:
            problems.append(f"{list_id}: sample {sample!r} not found")
    try:
        meta = json.loads((lists_dir / "meta.json").read_text(encoding="utf-8"))["lists"]
        missing = sorted(set(SAMPLES) - set(meta))
        if missing:
            problems.append(f"meta.json: missing {missing}")
    except Exception as exc:
        problems.append(f"meta.json: {exc}")
    try:
        index = json.loads((Path(root) / "data" / "research-index.json").read_text(encoding="utf-8"))
        if not any(e.get("name") == "TASSOS" for e in index["entries"]):
            problems.append("research-index.json: TASSOS not found")
    except Exception as exc:
        problems.append(f"research-index.json: {exc}")
    return problems


def main() -> int:
    problems = check()
    print("\n".join(problems) if problems else "smoke check passed")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `python3 -m pytest -q scripts`
Expected: all pass.

- [ ] **Step 5: Build the real lists once**

Run: `python3 scripts/build_official_lists.py && python3 scripts/smoke_lists.py`
Expected: four `fresh` lines, then `smoke check passed`.

Run: `for f in data/lists/*.json; do printf "%s " $f; gzip -c $f | wc -c; done`
Expected: every list file under 2,000,000 bytes gzipped (measured 2026-10-13: US 1.24 MB, EU 0.65 MB, UK 0.18 MB, UN 0.06 MB; research index 0.26 MB).

- [ ] **Step 6: Write the nightly workflow**

`.github/workflows/update-lists.yml`:
```yaml
name: Update official lists

on:
  schedule:
    - cron: "0 4 * * *"
  workflow_dispatch:

permissions:
  contents: read
  issues: write

concurrency:
  group: update-lists
  cancel-in-progress: false

jobs:
  update:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    steps:
      - uses: actions/checkout@v4
        with:
          # Deploy key with write access; the main-branch ruleset lets deploy keys bypass the PR rule.
          ssh-key: ${{ secrets.NIGHTLY_DEPLOY_KEY }}

      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"

      - name: Build lists
        id: build
        continue-on-error: true
        run: python scripts/build_official_lists.py

      - name: Smoke check
        id: smoke
        run: python scripts/smoke_lists.py

      - name: Commit changes
        if: steps.smoke.outcome == 'success'
        run: |
          git config user.name "undercurrent-nightly"
          git config user.email "undercurrent-nightly@users.noreply.github.com"
          git add data/lists
          if git diff --cached --quiet; then
            echo "No changes."
          else
            git commit -m "data: official lists $(date -u +%F)"
            git push
          fi

      - name: Open or update the failure issue
        if: steps.build.outcome == 'failure' || failure()
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          failed=$(python -c "import json;m=json.load(open('data/lists/meta.json'))['lists'];print(', '.join(k for k,v in m.items() if v['status']!='fresh') or 'smoke check')")
          title="Nightly lists: ${failed} failed $(date -u +%F)"
          body="Run: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}. The site keeps serving the previous copy. Details in data/lists/meta.json."
          existing=$(gh issue list --state open --search "Nightly lists in:title" --json number --jq '.[0].number')
          if [ -n "$existing" ]; then
            gh issue comment "$existing" --body "$title. $body"
          else
            gh issue create --title "$title" --body "$body"
          fi
```

- [ ] **Step 7: Commit**

```bash
git add scripts/smoke_lists.py scripts/test_smoke_lists.py .github/workflows/update-lists.yml data/lists
git commit -m "feat: smoke check, nightly workflow and first official lists

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Search core (browser)

**Files:**
- Create: `app/search.js`, `tests/search.test.js`

**Interfaces:**
- Consumes: `normalizeName`, `parseImo` (Task 1); record and entry shapes (Tasks 2, 5)
- Produces:
  - `LIST_IDS = ["us", "uk", "eu", "un"]`, `LIMIT = 10`
  - `loadJson(url, fetchFn = fetch): Promise<any>` (throws on non-2xx)
  - `prepareQuery(raw): {text, imo, norm, tokens, usable}`
  - `scoreName(q, norm): 0|1|2|3`
  - `searchResearch(entries, q): Entry[]` (≤ 10)
  - `searchLists(docs, q): ListHit[]` where `docs = {us?: {records}, …}` and `ListHit = {list, name, program, date, ref, imo, url}` (≤ 10, one per list+ref)
  - `latestOnly(): () => (() => boolean)`
  - `listStatus(meta, now = new Date()): {newest: Date|null, stale: boolean, details: string[]}`

- [ ] **Step 1: Write the failing tests**

`tests/search.test.js`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { prepareQuery, scoreName, searchResearch, searchLists, latestOnly, listStatus, loadJson, LIMIT } from "../app/search.js";

const entry = (id, name, keys, imo = null) => ({ id, name, keys, imo, listings: [] });
const ENTRIES = [
  entry("IMO9408695", "TASSOS", ["TASSOS", "FRONT BALDER", "SEASALVIA"], "9408695"),
  entry("co:sovcomflot", "SOVCOMFLOT", ["SOVCOMFLOT"]),
  entry("co:sterling", "SOVCOMFLOT/STERLING SHIP MANAGEMENT", ["SOVCOMFLOT STERLING SHIP MANAGEMENT"]),
  entry("IMO1", "TASSOS STAR", ["TASSOS STAR"], "1111111"),
];

test("prepareQuery: names, IMO shapes and unusable input", () => {
  assert.deepEqual(prepareQuery("  Sovcomflot PJSC "), { text: "Sovcomflot PJSC", imo: null, norm: "SOVCOMFLOT", tokens: ["SOVCOMFLOT"], usable: true });
  for (const raw of ["9408695", "IMO 9408695", "imo9408695", " 9408695 "]) assert.equal(prepareQuery(raw).imo, "9408695");
  for (const raw of ["Совкомфлот", "LLC", "...", ""]) assert.equal(prepareQuery(raw).usable, false);
});

test("scoreName: exact 3, all words 2, most words 1, last word may be a prefix", () => {
  const q = prepareQuery("Sovcomflot");
  assert.equal(scoreName(q, "SOVCOMFLOT"), 3);
  assert.equal(scoreName(q, "SOVCOMFLOT STERLING SHIP MANAGEMENT"), 2);
  assert.equal(scoreName(prepareQuery("Sovcomflot Sterling Holdings"), "SOVCOMFLOT STERLING SHIP MANAGEMENT"), 1);
  assert.equal(scoreName(prepareQuery("Sovcomfl"), "SOVCOMFLOT"), 2);
  assert.equal(scoreName(prepareQuery("Tanker"), "SOVCOMFLOT"), 0);
});

test("searchResearch: exact first, former names match, IMO is exact", () => {
  assert.deepEqual(searchResearch(ENTRIES, prepareQuery("Sovcomflot")).map((e) => e.id), ["co:sovcomflot", "co:sterling"]);
  assert.deepEqual(searchResearch(ENTRIES, prepareQuery("front balder")).map((e) => e.id), ["IMO9408695"]);
  assert.deepEqual(searchResearch(ENTRIES, prepareQuery("TASSOS")).map((e) => e.id), ["IMO9408695", "IMO1"]);
  assert.deepEqual(searchResearch(ENTRIES, prepareQuery("IMO 9408695")).map((e) => e.id), ["IMO9408695"]);
  assert.deepEqual(searchResearch(ENTRIES, prepareQuery("LLC")), []);
});

test("searchResearch and searchLists cap common words at LIMIT, best first", () => {
  const many = Array.from({ length: 500 }, (_, i) => entry(`e${i}`, `ALPHA SHIPPING ${i}`, [`ALPHA SHIPPING ${i}`]));
  many.push(entry("exact", "SHIPPING", ["SHIPPING"]));
  const hits = searchResearch(many, prepareQuery("shipping"));
  assert.equal(hits.length, LIMIT);
  assert.equal(hits[0].id, "exact");

  const records = Array.from({ length: 500 }, (_, i) => [`Beta Trading ${i}`, `BETA TRADING ${i}`, "Iran", "", `r${i}`, "", ""]);
  assert.equal(searchLists({ us: { records } }, prepareQuery("trading")).length, LIMIT);
});

test("searchLists: one row per listed entity, IMO matches, fields mapped", () => {
  const docs = {
    us: { records: [["TASSOS", "TASSOS", "Iran", "", "54815", "9408695", ""]] },
    uk: { records: [
      ["TASSOS", "TASSOS", "Russia", "2026-02-24", "RUS3483", "9408695", ""],
      ["Tassos", "TASSOS", "Russia", "2026-02-24", "RUS3483", "9408695", ""],
    ] },
  };
  const hits = searchLists(docs, prepareQuery("tassos"));
  assert.deepEqual(hits.map((h) => h.list).sort(), ["uk", "us"]);
  assert.deepEqual(searchLists(docs, prepareQuery("9408695")).length, 2);
  assert.deepEqual(hits.find((h) => h.list === "uk"), { list: "uk", name: "TASSOS", program: "Russia", date: "2026-02-24", ref: "RUS3483", imo: "9408695", url: "" });
});

test("latestOnly: an older ticket stops being latest", () => {
  const next = latestOnly();
  const first = next();
  const second = next();
  assert.equal(first(), false);
  assert.equal(second(), true);
});

test("listStatus: newest time, stale when old or kept-previous", () => {
  const now = new Date("2026-10-13T12:00:00Z");
  const fresh = { label: "United States", status: "fresh", updated_at: "2026-10-13T04:00:00Z" };
  assert.equal(listStatus({ lists: { us: fresh } }, now).stale, false);
  assert.equal(listStatus({ lists: { us: fresh } }, now).newest.toISOString(), "2026-10-13T04:00:00.000Z");
  assert.equal(listStatus({ lists: { us: { ...fresh, updated_at: "2026-10-09T04:00:00Z" } } }, now).stale, true);
  const kept = listStatus({ lists: { us: fresh, uk: { label: "United Kingdom", status: "kept-previous", updated_at: "2026-10-12T04:00:00Z" } } }, now);
  assert.equal(kept.stale, true);
  assert.match(kept.details.join("\n"), /United Kingdom: 2026-10-12 \(kept previous copy\)/);
  assert.deepEqual(listStatus(null, now), { newest: null, stale: true, details: [] });
});

test("loadJson throws on HTTP errors", async () => {
  const fake = async () => ({ ok: false, status: 404, json: async () => ({}) });
  await assert.rejects(loadJson("data/x.json", fake), /404/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL, cannot find module `app/search.js`.

- [ ] **Step 3: Implement**

`app/search.js`:
```js
import { normalizeName, parseImo } from "./normalize.js";

export const LIST_IDS = ["us", "uk", "eu", "un"];
export const LIMIT = 10;
const STALE_MS = 3 * 24 * 60 * 60 * 1000;

export async function loadJson(url, fetchFn = fetch) {
  const res = await fetchFn(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

export function prepareQuery(raw) {
  const text = (raw || "").trim();
  const imo = parseImo(text);
  const norm = imo ? "" : normalizeName(text);
  return { text, imo, norm, tokens: norm ? norm.split(" ") : [], usable: Boolean(imo || norm) };
}

// 3 exact, 2 every query word present, 1 at least 60% of words; the last word may be a prefix (typing).
export function scoreName(q, norm) {
  if (!norm || !q.tokens.length) return 0;
  if (norm === q.norm) return 3;
  const words = norm.split(" ");
  const last = q.tokens.length - 1;
  let hit = 0;
  q.tokens.forEach((t, i) => {
    if (words.includes(t) || (i === last && t.length >= 3 && words.some((w) => w.startsWith(t)))) hit++;
  });
  if (hit === q.tokens.length) return 2;
  return hit / q.tokens.length >= 0.6 ? 1 : 0;
}

export function searchResearch(entries, q) {
  if (!q.usable) return [];
  const scored = [];
  for (const e of entries) {
    const s = q.imo ? (e.imo === q.imo ? 3 : 0) : Math.max(0, ...e.keys.map((k) => scoreName(q, k)));
    if (s) scored.push({ s, e });
  }
  scored.sort((a, b) => b.s - a.s || a.e.name.length - b.e.name.length || a.e.name.localeCompare(b.e.name));
  return scored.slice(0, LIMIT).map((x) => x.e);
}

export function searchLists(docs, q) {
  if (!q.usable) return [];
  const scored = [];
  for (const [list, doc] of Object.entries(docs)) {
    for (const r of doc.records) {
      const s = q.imo ? (r[5] === q.imo ? 3 : 0) : scoreName(q, r[1]);
      if (s) scored.push({ s, list, r });
    }
  }
  scored.sort((a, b) => b.s - a.s || a.r[0].length - b.r[0].length);
  const seen = new Set();
  const out = [];
  for (const { list, r } of scored) {
    const key = `${list}:${r[4]}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ list, name: r[0], program: r[2], date: r[3], ref: r[4], imo: r[5], url: r[6] });
    if (out.length === LIMIT) break;
  }
  return out;
}

// Each call hands out a ticket; only the newest ticket reports true.
export function latestOnly() {
  let current = 0;
  return () => {
    const id = ++current;
    return () => id === current;
  };
}

export function listStatus(meta, now = new Date()) {
  const lists = Object.values(meta?.lists || {});
  if (!lists.length) return { newest: null, stale: true, details: [] };
  const times = lists.map((l) => l.updated_at).filter(Boolean).map((t) => new Date(t).getTime());
  const newest = times.length ? new Date(Math.max(...times)) : null;
  const stale = lists.some((l) => !l.updated_at || l.status !== "fresh" || now - new Date(l.updated_at) > STALE_MS);
  const details = lists.map((l) => `${l.label}: ${l.updated_at ? l.updated_at.slice(0, 10) : "never"}${l.status !== "fresh" ? " (kept previous copy)" : ""}`);
  return { newest, stale, details };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add app/search.js tests/search.test.js
git commit -m "feat: browser search core with ranking, IMO match and staleness

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Rendering and citations

**Files:**
- Create: `app/render.js`, `tests/render.test.js`

**Interfaces:**
- Consumes: Entry shape (Task 5), `ListHit` (Task 7)
- Produces:
  - `CAVEAT: string`, `LIST_LABELS`, `LIST_PAGES`
  - `escapeHtml(value): string`, `safeUrl(url): string`, `joinAnd(items): string`
  - `formatDate(iso, long = false): string` ("30 Jul 2025" / "30 July 2025" / "Feb 2023"; "" for anything else)
  - `formatUpdated(date: Date): string` ("13 Oct 2026, 04:00 UTC")
  - `timelinePositions(events): Array<event & {pct: number}>`
  - `citation(entry, pageUrl, today = new Date()): string`
  - `renderDossier(entry): string`, `renderResearch(entries): string`, `renderLists(hits, failedIds = []): string`, `renderWider(state, query): string` with `state.kind` in `loading|link|error|results`, `renderEmpty(query): string`, `renderHint(): string`, `renderLoading(): string`, `renderLayerError(layer): string` (`layer` is `"research"`)
  - DOM hooks used by later tasks: `.dossier-entry`, `[data-walk="chips"]`, `[data-walk="timeline"]`, `[data-walk="names"]`, `[data-walk="sources"]`, `[data-cite="<entry id>"]`, `[data-retry="research"|"lists"]`, `.state`

- [ ] **Step 1: Write the failing tests**

`tests/render.test.js`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  escapeHtml, safeUrl, formatDate, formatUpdated, timelinePositions, citation,
  renderDossier, renderResearch, renderLists, renderWider, renderEmpty, renderHint,
} from "../app/render.js";

const TASSOS = {
  id: "IMO9408695", kind: "Oil Tanker", name: "TASSOS", keys: ["TASSOS"], imo: "9408695", flag: "Liberia",
  manager: "Zulu Ships", country: null, role: null,
  listings: [
    { by: "United States", date: "2025-07-30", program: "Iran", ref: 1 },
    { by: "European Union", date: "2025-10-24", program: "Russia", ref: 2 },
    { by: "United Kingdom", date: "2026-02-24", program: "Russia", ref: 3 },
  ],
  events: [
    { date: "2023-02", kind: "ownership", text: "Sold by Frontline to an unlisted ship manager (Liberia)" },
    { date: "2024-09-09", kind: "management", text: "Managed by Zulu Ships" },
    { date: "2025-07-30", kind: "listing", text: "United States lists it (Iran)" },
    { date: "2025-10-24", kind: "listing", text: "European Union lists it (Russia)" },
    { date: "2026-02-24", kind: "listing", text: "United Kingdom lists it (Russia)" },
  ],
  facts: [{ text: "Listed by the United States on 30 July 2025 (Iran).", refs: [1, 2, 3] }],
  names: [{ name: "TASSOS", current: true }, { name: "Front Balder", current: false }],
  flags: ["Liberia", "Panama"],
  story: { label: "Open on the shadow-fleet map", url: "stories/shadow-fleet/network/shadow_fleet_map.html" },
  sources: [
    { n: 1, label: "US Treasury OFAC sanctions list", url: "https://sanctionslist.ofac.treas.gov/Home/SdnList" },
    { n: 2, label: "EU Official Journal (EUR-Lex)", url: "https://eur-lex.europa.eu/eli/reg/2014/833/oj" },
    { n: 3, label: "UK Sanctions List", url: "https://www.gov.uk/government/publications/the-uk-sanctions-list" },
  ],
};

test("escapeHtml and safeUrl neutralise hostile data", () => {
  assert.equal(escapeHtml(`<script>"x"&'y'</script>`), "&lt;script&gt;&quot;x&quot;&amp;&#39;y&#39;&lt;/script&gt;");
  assert.equal(safeUrl("javascript:alert(1)"), "#");
  assert.equal(safeUrl("data:text/html,hi"), "#");
  assert.equal(safeUrl("https://www.gov.uk/x"), "https://www.gov.uk/x");
  assert.equal(safeUrl("stories/shadow-fleet/FINDINGS.md"), "stories/shadow-fleet/FINDINGS.md");
});

test("dossier escapes names and drops javascript links", () => {
  const evil = { ...TASSOS, name: `<img src=x onerror=alert(1)>`, sources: [{ n: 1, label: "<b>x</b>", url: "javascript:alert(1)" }] };
  const html = renderDossier(evil);
  assert.ok(!html.includes("<img"));
  assert.ok(!html.includes("javascript:"));
  assert.ok(html.includes("&lt;img"));
});

test("formatDate and formatUpdated", () => {
  assert.equal(formatDate("2025-07-30"), "30 Jul 2025");
  assert.equal(formatDate("2025-07-30", true), "30 July 2025");
  assert.equal(formatDate("2023-02"), "Feb 2023");
  assert.equal(formatDate("n/a"), "");
  assert.equal(formatUpdated(new Date("2026-10-13T04:00:00Z")), "13 Oct 2026, 04:00 UTC");
});

test("timelinePositions: ordered, start at 0, end at most 86, no overlaps", () => {
  const pos = timelinePositions(TASSOS.events);
  assert.equal(pos.length, 5);
  assert.equal(pos[0].pct, 0);
  assert.ok(pos.at(-1).pct <= 86);
  for (let i = 1; i < pos.length; i++) assert.ok(pos[i].pct - pos[i - 1].pct >= 13.9, `gap before ${i}`);
});

test("citation text", () => {
  assert.equal(
    citation(TASSOS, "https://undercurrent.vercel.app/", new Date("2026-10-13T10:00:00Z")),
    "TASSOS (IMO 9408695): listed by the United States on 30 July 2025 (Iran), the European Union on 24 October 2025 (Russia) and the United Kingdom on 24 February 2026 (Russia). " +
    "Sources: https://sanctionslist.ofac.treas.gov/Home/SdnList ; https://eur-lex.europa.eu/eli/reg/2014/833/oj ; https://www.gov.uk/government/publications/the-uk-sanctions-list. " +
    "Via Undercurrent, https://undercurrent.vercel.app/, accessed 13 October 2026.",
  );
});

test("dossier has the hooks the walkthrough and copy button use", () => {
  const html = renderDossier(TASSOS);
  for (const hook of ['data-walk="chips"', 'data-walk="timeline"', 'data-walk="names"', 'data-walk="sources"', 'data-cite="IMO9408695"']) {
    assert.ok(html.includes(hook), hook);
  }
  assert.equal((html.match(/class="chip"/g) || []).length, 3);
});

test("research: first in full, others collapsed", () => {
  const html = renderResearch([TASSOS, { ...TASSOS, id: "IMO1", name: "TASSOS STAR" }]);
  assert.match(html, /In our research · 2 matches/);
  assert.equal((html.match(/<details class="more">/g) || []).length, 1);
});

test("lists table, failures and empty states", () => {
  const hit = { list: "uk", name: "TASSOS", program: "Russia", date: "2026-02-24", ref: "RUS3483", imo: "9408695", url: "" };
  const html = renderLists([hit], ["eu"]);
  assert.match(html, /United Kingdom/);
  assert.match(html, /Couldn't load the European Union list/);
  assert.match(html, /data-retry="lists"/);
  assert.match(renderLists([], []), /No match on the official lists/);
  assert.match(renderEmpty("Qzxv"), /Not found in our research or on the official lists/);
  assert.match(renderHint(), /Latin letters/);
});

test("wider check states", () => {
  assert.match(renderWider({ kind: "link" }, "TASSOS"), /opensanctions\.org\/search\/\?q=TASSOS/);
  assert.match(renderWider({ kind: "error" }, "TASSOS"), /unavailable right now/);
  const results = renderWider({ kind: "results", results: [{ name: "<x>", schema: "Vessel", datasets: ["us_ofac_sdn"], url: "https://www.opensanctions.org/entities/abc/" }] }, "TASSOS");
  assert.match(results, /&lt;x&gt;/);
  assert.match(results, /CC BY-NC 4.0/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL, cannot find module `app/render.js`.

- [ ] **Step 3: Implement**

`app/render.js`:
```js
export const CAVEAT = "A name match is a possible match, not proof. Ships and companies share names; check the numbered source before you publish. This site describes documented conduct and makes no legal findings.";
export const LIST_LABELS = { us: "United States", uk: "United Kingdom", eu: "European Union", un: "United Nations" };
export const LIST_PAGES = {
  us: "https://www.trade.gov/consolidated-screening-list",
  uk: "https://www.gov.uk/government/publications/the-uk-sanctions-list",
  eu: "https://data.europa.eu/data/datasets/consolidated-list-of-persons-groups-and-entities-subject-to-eu-financial-sanctions",
  un: "https://main.un.org/securitycouncil/en/content/un-sc-consolidated-list",
};
const GOVERNMENTS = new Set(Object.values(LIST_LABELS));
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

export function safeUrl(url) {
  try {
    const parsed = new URL(url, "https://undercurrent.invalid/");
    if (parsed.protocol === "https:" || parsed.protocol === "http:") return url;
  } catch { /* fall through */ }
  return "#";
}

export function joinAnd(items) {
  return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

export function formatDate(iso, long = false) {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(iso || "");
  if (!m) return "";
  const month = MONTHS[Number(m[2]) - 1];
  if (!month) return "";
  const name = long ? month : month.slice(0, 3);
  return m[3] ? `${Number(m[3])} ${name} ${m[1]}` : `${name} ${m[1]}`;
}

export function formatUpdated(date) {
  const iso = date.toISOString();
  return `${formatDate(iso.slice(0, 10))}, ${iso.slice(11, 16)} UTC`;
}

const MAX_PCT = 86;
const MIN_GAP = 14;

export function timelinePositions(events) {
  const dated = events
    .map((e) => ({ ...e, t: Date.parse(e.date.length === 7 ? `${e.date}-01` : e.date) }))
    .filter((e) => !Number.isNaN(e.t))
    .sort((a, b) => a.t - b.t);
  if (!dated.length) return [];
  const min = dated[0].t;
  const span = dated.at(-1).t - min || 1;
  const gap = dated.length > 1 ? Math.min(MIN_GAP, MAX_PCT / (dated.length - 1)) : 0;
  const pos = dated.map((e) => ((e.t - min) / span) * MAX_PCT);
  // Push labels apart going forward, then pull them back under MAX_PCT going backward.
  for (let i = 1; i < pos.length; i++) pos[i] = Math.max(pos[i], pos[i - 1] + gap);
  pos[pos.length - 1] = Math.min(pos.at(-1), MAX_PCT);
  for (let i = pos.length - 2; i >= 0; i--) pos[i] = Math.min(pos[i], pos[i + 1] - gap);
  return dated.map((e, i) => ({ ...e, pct: pos[i] }));
}

function listingPhrase(l) {
  return (GOVERNMENTS.has(l.by) ? `the ${l.by}` : l.by) + (l.date ? ` on ${formatDate(l.date, true)}` : "") + (l.program ? ` (${l.program})` : "");
}

export function citation(entry, pageUrl, today = new Date()) {
  const head = entry.imo ? `${entry.name} (IMO ${entry.imo})` : entry.name;
  const listed = entry.listings.length ? `listed by ${joinAnd(entry.listings.map(listingPhrase))}` : "not listed by a government in our research";
  const urls = entry.sources.map((s) => new URL(s.url, pageUrl).href).join(" ; ");
  return `${head}: ${listed}. Sources: ${urls}. Via Undercurrent, ${pageUrl}, accessed ${formatDate(today.toISOString().slice(0, 10), true)}.`;
}

function hostOf(url) {
  try { return new URL(url).hostname; } catch { return "Undercurrent research"; }
}

export function renderDossier(e) {
  const sid = e.id.replace(/[^A-Za-z0-9_-]/g, "_");
  const sub = [e.kind, e.imo && `IMO ${e.imo}`, e.flag && `Flag ${e.flag}`, e.manager && `Manager ${e.manager}`, !e.imo && e.country, !e.imo && e.role]
    .filter(Boolean).join(" · ");
  const chips = e.listings.map((l) => `<div class="chip"><b>${escapeHtml(l.by)}</b><span>${escapeHtml([formatDate(l.date), l.program].filter(Boolean).join(" · ").toUpperCase())}</span></div>`).join("");
  const verdict = chips
    ? `<div class="verdicts" data-walk="chips" aria-label="Listed by">${chips}</div>`
    : `<p class="d-unlisted">Not listed by a government in our research.</p>`;

  const tl = timelinePositions(e.events);
  const timeline = tl.length > 1 ? `
    <div class="timeline" data-walk="timeline" role="img" aria-label="${escapeHtml("Timeline: " + tl.map((x) => `${formatDate(x.date)}, ${x.text}`).join("; "))}">
      <div class="tl-track"><div class="tl-line"></div>${tl.map((x) => `
        <div class="tl-ev${x.kind === "listing" ? " hit" : ""}" style="left:${x.pct.toFixed(1)}%"><span class="when">${escapeHtml(formatDate(x.date).toUpperCase())}</span><span class="dot"></span><span class="what">${escapeHtml(x.text)}</span></div>`).join("")}
      </div>
      <p class="tl-note">Spacing is approximate. Red marks a government listing.</p>
    </div>` : "";

  const sup = (refs) => refs.map((n) => `<sup><a href="#src-${sid}-${n}">${n}</a></sup>`).join("");
  const facts = e.facts.map((f) => `<p>${escapeHtml(f.text)}${sup(f.refs)}</p>`).join("");

  const nameTag = (n) => (n.current ? "CURRENT" : e.imo ? "FORMER" : "ALSO KNOWN AS");
  const names = e.names.length > 1 ? `
    <div class="block" data-walk="names">
      <h3>${e.imo ? `${e.names.length} names, one hull` : "Other names"}</h3>
      <ul class="names">${e.names.map((n) => `<li${n.current ? ' class="now"' : ""}>${escapeHtml(n.name)} <span>${nameTag(n)}</span></li>`).join("")}</ul>
      ${e.flags.length ? `<p class="tl-note">Flags flown: ${escapeHtml(joinAnd(e.flags))}.</p>` : ""}
    </div>` : "";

  const sources = `
    <div class="block" data-walk="sources">
      <h3>Sources</h3>
      <ol class="src">${e.sources.map((s) => `<li value="${s.n}" id="src-${sid}-${s.n}">${escapeHtml(s.label)}. <a href="${escapeHtml(safeUrl(s.url))}" rel="noopener">${escapeHtml(hostOf(s.url))}</a></li>`).join("")}</ol>
    </div>`;

  return `
  <article class="dossier-entry" id="entry-${sid}">
    <div class="d-head">
      <div><h2>${escapeHtml(e.name)}</h2><p class="d-sub">${escapeHtml(sub.toUpperCase())}</p></div>
      ${verdict}
    </div>
    ${timeline}
    <div class="cols">
      <div>
        <div class="block reported"><h3>What the records show</h3>${facts}</div>
        <div class="d-actions">
          <a class="btn" href="${escapeHtml(safeUrl(e.story.url))}">${escapeHtml(e.story.label)}</a>
          <button class="btn" type="button" data-cite="${escapeHtml(e.id)}">Copy citation</button>
        </div>
      </div>
      <div>${names}${sources}</div>
    </div>
  </article>`;
}

export function renderResearch(entries) {
  if (!entries.length) return "";
  const [first, ...rest] = entries;
  const more = rest.map((e) => `
    <details class="more"><summary><span class="more-name">${escapeHtml(e.name)}</span><span class="more-kind">${escapeHtml(e.kind)}</span>${e.listings.map((l) => `<span class="mini-chip">${escapeHtml(l.by)}</span>`).join("")}</summary>${renderDossier(e)}</details>`).join("");
  return `<p class="label">In our research · ${entries.length} ${entries.length === 1 ? "match" : "matches"}</p>${renderDossier(first)}${rest.length ? `<div class="more-list"><h3 class="more-head">Other matches in our research</h3>${more}</div>` : ""}`;
}

export function renderLists(hits, failedIds = []) {
  const rows = hits.map((h) => `<tr><td>${escapeHtml(LIST_LABELS[h.list])}</td><td>${escapeHtml(h.name)}</td><td>${escapeHtml(h.program)}</td><td class="mono">${escapeHtml(h.date || "—")}</td><td><a href="${escapeHtml(safeUrl(h.url || LIST_PAGES[h.list]))}" rel="noopener">${h.url ? "Record" : "List"}</a></td></tr>`).join("");
  const table = hits.length
    ? `<table class="lists"><thead><tr><th scope="col">List</th><th scope="col">Listed as</th><th scope="col">Program</th><th scope="col">Date</th><th scope="col"><span class="visually-hidden">Link</span></th></tr></thead><tbody>${rows}</tbody></table>`
    : `<p class="muted">No match on the official lists${failedIds.length ? " that loaded" : ""}.</p>`;
  const failed = failedIds.length
    ? `<p class="layer-error">Couldn't load the ${escapeHtml(joinAnd(failedIds.map((id) => LIST_LABELS[id])))} list${failedIds.length > 1 ? "s" : ""}. <button class="btn" type="button" data-retry="lists">Retry</button></p>`
    : "";
  return `<div class="block"><h3>On official sanctions lists · ${hits.length} ${hits.length === 1 ? "record" : "records"}</h3>${table}${failed}</div>`;
}

export function renderWider(state, query) {
  const link = `<a class="btn" href="https://www.opensanctions.org/search/?q=${encodeURIComponent(query)}" rel="noopener">Search on OpenSanctions</a>`;
  let body;
  if (state.kind === "loading") {
    body = `<p>Checking OpenSanctions…</p>`;
  } else if (state.kind === "results" && state.results.length) {
    body = `<ul class="wider-list">${state.results.map((r) => `<li><a href="${escapeHtml(safeUrl(r.url))}" rel="noopener">${escapeHtml(r.name)}</a> <span>${escapeHtml([r.schema, (r.datasets || []).slice(0, 3).join(", ")].filter(Boolean).join(" · "))}</span></li>`).join("")}</ul><p class="tl-note">Results from OpenSanctions, CC BY-NC 4.0.</p>${link}`;
  } else if (state.kind === "results") {
    body = `<p>No OpenSanctions match.</p>${link}`;
  } else {
    body = `<p>Other countries' lists, politically exposed people and related companies, from OpenSanctions.${state.kind === "error" ? " The live check is unavailable right now." : ""}</p>${link}`;
  }
  return `<div class="block wider"><h3>Wider check</h3>${body}</div>`;
}

export function renderEmpty(query) {
  return `<div class="state"><strong>Not found in our research or on the official lists</strong>Nothing matched “${escapeHtml(query)}”. Check the spelling, try a former name, or search by the seven-digit IMO number.</div>`;
}

export function renderHint() {
  return `<div class="state"><strong>Type the name in Latin letters, or use the IMO number</strong>Names written only in other scripts, or only a company ending like “LLC”, can't be matched.</div>`;
}

export function renderLoading() {
  return `<div class="state"><strong>Loading the lists…</strong>The first search downloads our research and the four official lists. Later searches are instant.</div>`;
}

export function renderLayerError(layer) {
  return `<div class="state"><strong>Couldn't load our ${escapeHtml(layer)}</strong>The official lists below still work. <button class="btn" type="button" data-retry="${escapeHtml(layer)}">Retry</button></div>`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add app/render.js tests/render.test.js
git commit -m "feat: dossier, lists and wider-check rendering with escaping and citations

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: The page

**Files:**
- Create: `index.html`, `app/style.css`, `app/main.js`

**Interfaces:**
- Consumes: everything from Tasks 7 and 8; `data/research-index.json`, `data/lists/*.json` (Tasks 5, 6)
- Produces: `runSearch(raw: string): Promise<void>` exported from `app/main.js` for the walkthrough; DOM ids `#q`, `#search-form`, `#results`, `#wider`, `#lists-date`, `#start-walk`, `#nav-walk`, `#walk` (+ `#walk-step`, `#walk-bar`, `#walk-text`, `#walk-back`, `#walk-next`, `#walk-exit`)

- [ ] **Step 1: Extract the stylesheet from the approved mockup**

```bash
python3 - <<'EOF'
import re, pathlib
html = pathlib.Path("docs/design/mockup-dark.html").read_text(encoding="utf-8")
css = re.search(r"<style>\n(.*?)</style>", html, re.S).group(1)
pathlib.Path("app/style.css").write_text(css, encoding="utf-8")
print(len(css.splitlines()), "lines")
EOF
```
Expected: about 230 lines written.

- [ ] **Step 2: Adjust the stylesheet for live data**

In `app/style.css`:
1. Delete the whole rule that starts with `.tl-line::after {` (it hard-coded the listing position for TASSOS).
2. In the rule `.tl-ev { position: absolute; …; width: 10rem; }` change `width: 10rem` to `width: 9rem`.
3. Append at the end of the file:

```css
/* Live-data states (added after the mockup) */
.dossier-entry + .more-list { margin-top: var(--space-3xl); }
.more-list { border-top: var(--rule-hair) solid var(--color-rule); }
.more-head { font-size: var(--text-sm); font-weight: 700; margin: var(--space-md) 0; }
.more { border-bottom: var(--rule-hair) solid var(--color-rule); }
.more summary { display: flex; flex-wrap: wrap; align-items: baseline; gap: var(--space-xs) var(--space-md); padding: var(--space-sm) 0; cursor: pointer; list-style: none; }
.more summary::-webkit-details-marker { display: none; }
.more summary::before { content: "+"; font-family: var(--font-mono); color: var(--color-neutral); width: 1ch; }
.more[open] summary::before { content: "−"; }
.more-name { font-weight: 700; }
.more-kind { font-family: var(--font-mono); font-size: var(--text-xs); color: var(--color-neutral); }
.mini-chip { font-size: var(--text-xs); color: var(--color-accent); border: var(--rule-hair) solid var(--color-accent); border-radius: var(--radius-sm); padding: 0 var(--space-xs); white-space: nowrap; }
.more .dossier-entry { padding-bottom: var(--space-xl); }
.d-unlisted { margin: 0; color: var(--color-muted); font-size: var(--text-sm); }
.state { padding: var(--space-xl) 0; color: var(--color-muted); max-width: 60ch; }
.state strong { display: block; color: var(--color-ink); font-size: var(--text-xl); margin-bottom: var(--space-xs); }
.state .btn { margin-top: var(--space-sm); }
.muted { color: var(--color-muted); font-size: var(--text-sm); }
.layer-error { display: flex; flex-wrap: wrap; gap: var(--space-sm); align-items: center; color: var(--color-muted); font-size: var(--text-sm); margin-top: var(--space-md); }
.wider-list { list-style: none; margin: 0 0 var(--space-md); padding: 0; }
.wider-list li { padding: var(--space-xs) 0; border-top: var(--rule-hair) solid var(--color-rule); font-size: var(--text-sm); }
.wider-list span { color: var(--color-neutral); font-family: var(--font-mono); font-size: var(--text-2xs); }
.is-stale { color: var(--color-accent); }
.walk[hidden], #results[hidden] { display: none; }
/* Without this the hero's implicit grid column grows to its content and is clipped at 375 px. */
.hero { grid-template-columns: minmax(0, 1fr); }
```

- [ ] **Step 3: Write `index.html`**

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Undercurrent · Sanctions lookup</title>
<meta name="description" content="Check any ship, company or person against sanctions-evasion research and the US, UK, EU and UN sanctions lists. Every answer comes with its source.">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Schibsted+Grotesk:wght@400;500;700;800&family=Source+Serif+4:opsz,wght@8..60,400;8..60,500&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<link rel="stylesheet" href="app/style.css">
<script type="module" src="app/main.js"></script>
</head>
<body>

<header class="wrap top">
  <a class="brand" href="./"><span class="brand-mark" aria-hidden="true"></span>Undercurrent</a>
  <nav aria-label="Primary"><ul>
    <li><a href="#research">Research</a></li>
    <li><a href="stories/about-the-data.html">About the data</a></li>
    <li><a href="#" id="nav-walk">Walkthrough</a></li>
  </ul></nav>
</header>

<main>
<section class="wrap hero" id="search">
  <h1>Names change. <span>The hull doesn't.</span></h1>
  <p class="hero-sub">Check any ship, company or person against our sanctions-evasion research and the US, UK, EU and UN sanctions lists. Every answer comes with its source.</p>
  <form class="search" role="search" id="search-form">
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="8.5" cy="8.5" r="6" stroke="currentColor" stroke-width="1.6"/><path d="M13 13l5 5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>
    <label for="q" class="visually-hidden">Search a ship, IMO number, company or person</label>
    <input id="q" name="q" type="search" placeholder="Ship name, IMO number, company or person" autocomplete="off" spellcheck="false" maxlength="200">
    <span class="kbd" aria-hidden="true">/</span>
  </form>
  <div class="hero-meta">
    <span id="lists-date"><span class="live-dot" aria-hidden="true"></span>Checking when the official lists were last updated…</span>
    <span>Try <a href="#" data-example="TASSOS">TASSOS</a> · <a href="#" data-example="Sovcomflot">Sovcomflot</a> · <a href="#" data-example="9408695">9408695</a></span>
    <button class="btn btn-accent" type="button" id="start-walk">Follow one tanker, 5 steps</button>
  </div>
</section>

<section class="wrap dossier" id="results" aria-live="polite" hidden></section>

<section class="wrap research" id="research">
  <p class="label">The research behind the search</p>
  <h2>Four investigations, one dataset</h2>
  <ul class="stories">
    <li class="story"><a href="stories/shadow-fleet/network/shadow_fleet_map.html"><span class="big">1,724 <small>ships</small></span><h3>The shadow fleet</h3><p>Tankers and companies behind Russia's and Iran's oil trade, joined by hull number. Interactive map.</p></a></li>
    <li class="story"><a href="stories/chips-into-russia/viz/index.html"><span class="big">15–20 <small>months</small></span><h3>Chips into Russia</h3><p>How long governments took to list the short-lived firms moving Western chips into Russia.</p></a></li>
    <li class="story"><a href="stories/who-lobbies/influence-network/index.html"><span class="big">1,513 <small>reports</small></span><h3>Who lobbies</h3><p>US lobbying filed for the owners, banks and parents of sanctioned fleets.</p></a></li>
    <li class="story"><a href="stories/how-sanctions-work/index.html"><span class="big">Start <small>here</small></span><h3>How sanctions work</h3><p>Lists, licences and the tricks that get around them, in plain language.</p></a></li>
  </ul>
</section>
</main>

<footer class="wrap foot">
  <span>Undercurrent</span>
  <span>Research by the VeilTrace team, Trace the Unseen, 25 Sep 2026</span>
  <a href="stories/about-the-data.html">About the data</a>
  <a href="stories/sources/METHODS_LOG.md">Methods</a>
  <a href="https://github.com/Ttheegela/veil-trace">Original research repo</a>
  <span>Not legal advice</span>
</footer>

<aside class="walk" id="walk" aria-label="Walkthrough" aria-live="polite" hidden>
  <div class="walk-top"><p class="label" id="walk-step">Walkthrough · 1 of 5</p><div class="walk-bar" id="walk-bar"></div></div>
  <p class="walk-text" id="walk-text"></p>
  <div class="walk-ctrl">
    <button class="btn" type="button" id="walk-back">Back</button>
    <button class="btn btn-accent" type="button" id="walk-next">Next</button>
    <button class="btn btn-ghost" type="button" id="walk-exit">Leave</button>
    <span class="kbd">Esc</span>
  </div>
</aside>
</body>
</html>
```

- [ ] **Step 4: Write `app/main.js`**

```js
import { prepareQuery, searchResearch, searchLists, loadJson, LIST_IDS, latestOnly, listStatus } from "./search.js";
import {
  renderResearch, renderLists, renderWider, renderEmpty, renderHint, renderLoading, renderLayerError,
  citation, formatUpdated, escapeHtml, CAVEAT,
} from "./render.js";

const $ = (selector) => document.querySelector(selector);
const state = { research: null, researchFailed: false, lists: {}, listsFailed: [], shown: new Map() };
const nextTicket = latestOnly();
let dataReady = null;

async function loadResearch() {
  try {
    state.research = (await loadJson("data/research-index.json")).entries;
    state.researchFailed = false;
  } catch {
    state.researchFailed = true;
  }
}

async function loadLists(ids) {
  const failed = await Promise.all(ids.map(async (id) => {
    try {
      state.lists[id] = await loadJson(`data/lists/${id}.json`);
      return null;
    } catch {
      return id;
    }
  }));
  state.listsFailed = failed.filter(Boolean);
}

function loadData() {
  dataReady ??= Promise.all([loadResearch(), loadLists(LIST_IDS)]);
  return dataReady;
}

async function checkWider(text, isLatest) {
  let next;
  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(text)}`, { signal: AbortSignal.timeout(5000) });
    const body = await res.json();
    next = body.enabled === false ? { kind: "link" } : body.error ? { kind: "error" } : { kind: "results", results: body.results || [] };
  } catch {
    next = { kind: "link" };
  }
  const slot = $("#wider");
  if (isLatest() && slot) slot.innerHTML = renderWider(next, text);
}

export async function runSearch(raw) {
  const isLatest = nextTicket();
  const q = prepareQuery(raw);
  const out = $("#results");
  if (q.text.length < 2) {
    out.hidden = true;
    out.innerHTML = "";
    return;
  }
  out.hidden = false;
  if (!q.usable) {
    out.innerHTML = renderHint();
    return;
  }
  if (!state.research && !state.researchFailed) out.innerHTML = renderLoading();
  await loadData();
  if (!isLatest()) return;

  const research = state.research ? searchResearch(state.research, q) : [];
  const lists = searchLists(state.lists, q);
  state.shown = new Map(research.map((e) => [e.id, e]));
  out.innerHTML = [
    state.researchFailed ? renderLayerError("research") : renderResearch(research),
    !research.length && !lists.length && !state.researchFailed ? renderEmpty(q.text) : "",
    `<div class="layers">${renderLists(lists, state.listsFailed)}<div id="wider">${renderWider({ kind: "loading" }, q.text)}</div></div>`,
    `<p class="caveat">${escapeHtml(CAVEAT)}</p>`,
  ].join("");
  checkWider(q.text, isLatest);
}

async function showListDate() {
  const slot = $("#lists-date");
  try {
    const status = listStatus(await loadJson("data/lists/meta.json"));
    if (status.stale) {
      slot.innerHTML = `<span class="live-dot" aria-hidden="true"></span><span class="is-stale">Some lists may be out of date</span>`;
      slot.title = status.details.join("\n");
    } else {
      slot.innerHTML = `<span class="live-dot" aria-hidden="true"></span>Official lists updated ${escapeHtml(formatUpdated(status.newest))}`;
    }
  } catch {
    slot.textContent = "List update time unavailable";
  }
}

async function copyCitation(button) {
  const entry = state.shown.get(button.dataset.cite);
  if (!entry) return;
  const label = button.textContent;
  try {
    await navigator.clipboard.writeText(citation(entry, location.href.split("#")[0]));
    button.textContent = "Copied";
  } catch {
    button.textContent = "Copy failed";
  }
  setTimeout(() => { button.textContent = label; }, 2000);
}

function wire() {
  const input = $("#q");
  let timer;
  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => runSearch(input.value), 200);
  });
  $("#search-form").addEventListener("submit", (event) => {
    event.preventDefault();
    clearTimeout(timer);
    runSearch(input.value);
  });
  document.querySelectorAll("[data-example]").forEach((link) => link.addEventListener("click", (event) => {
    event.preventDefault();
    input.value = link.dataset.example;
    runSearch(input.value);
  }));
  document.addEventListener("keydown", (event) => {
    if (event.key === "/" && document.activeElement !== input) {
      event.preventDefault();
      input.focus();
    }
  });
  $("#results").addEventListener("click", async (event) => {
    const cite = event.target.closest("[data-cite]");
    if (cite) return copyCitation(cite);
    const retry = event.target.closest("[data-retry]");
    if (!retry) return;
    if (retry.dataset.retry === "research") await loadResearch();
    else await loadLists(state.listsFailed.length ? state.listsFailed : LIST_IDS);
    runSearch(input.value);
  });
  showListDate();
}

wire();
```

- [ ] **Step 5: Check it in a browser**

Run: `python3 -m http.server 4173 --bind 127.0.0.1` and open `http://127.0.0.1:4173/`.
Check, in order:
1. The hero line changes to "Official lists updated <date>, <time> UTC".
2. Search `TASSOS`: one dossier with 3 chips (US, EU, UK), a timeline, footnoted facts, 5+ names, sources; the official-lists table shows United States and United Kingdom; "Wider check" ends as the "Search on OpenSanctions" link (no API locally).
3. Search `9408695`: same dossier. Search `Sovcomflot`: a company dossier plus collapsed "Other matches". Search `Совкомфлот`: the Latin-letters hint. Search `Qzxv Nonexistent`: the not-found state.
4. Click "Copy citation" and paste somewhere: the citation sentence.
5. DevTools console: no errors other than the 404 for `/api/search`.
6. Device toolbar at 375 px: no sideways scroll; the timeline is vertical.
Expected: all six hold. Stop the server.

- [ ] **Step 6: Commit**

```bash
git add index.html app/style.css app/main.js
git commit -m "feat: the Undercurrent page wired to live data

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: OpenSanctions proxy

**Files:**
- Create: `api/search.js`, `tests/api.test.js`

**Interfaces:**
- Consumes: env `OPENSANCTIONS_API_KEY` (optional)
- Produces: `GET(request: Request): Promise<Response>`; JSON bodies `{enabled:false}` | `{enabled:true, error:true}` | `{enabled:true, results:[{name, schema, datasets, url}]}`; HTTP 400 `{error:"bad query"}` for empty or >200-character `q`. Successful answers carry `Cache-Control: public, s-maxage=86400`; everything else `no-store`. Task 9's `checkWider` already reads these shapes.

- [ ] **Step 1: Write the failing tests**

`tests/api.test.js`:
```js
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { GET } from "../api/search.js";

const realFetch = globalThis.fetch;
let calls;
const req = (q) => new Request(`https://undercurrent.test/api/search${q === undefined ? "" : `?q=${encodeURIComponent(q)}`}`);

beforeEach(() => {
  calls = [];
  process.env.OPENSANCTIONS_API_KEY = "test-key";
});
afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.OPENSANCTIONS_API_KEY;
});

test("rejects empty and overlong queries without calling upstream", async () => {
  globalThis.fetch = async () => { throw new Error("should not be called"); };
  for (const q of [undefined, "", "   ", "x".repeat(201)]) assert.equal((await GET(req(q))).status, 400);
});

test("no key: enabled false", async () => {
  delete process.env.OPENSANCTIONS_API_KEY;
  const res = await GET(req("TASSOS"));
  assert.deepEqual(await res.json(), { enabled: false });
});

test("forwards only q and limit with the key, trims results, caches", async () => {
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    return new Response(JSON.stringify({ results: [{ id: "abc", caption: "TASSOS", schema: "Vessel", datasets: ["us_ofac_sdn"], properties: { secret: 1 } }] }));
  };
  const res = await GET(new Request("https://undercurrent.test/api/search?q=TASSOS&evil=1"));
  assert.equal(res.headers.get("cache-control"), "public, s-maxage=86400");
  assert.deepEqual(await res.json(), { enabled: true, results: [{ name: "TASSOS", schema: "Vessel", datasets: ["us_ofac_sdn"], url: "https://www.opensanctions.org/entities/abc/" }] });
  const sent = new URL(calls[0].url);
  assert.deepEqual([...sent.searchParams.keys()].sort(), ["limit", "q"]);
  assert.equal(calls[0].init.headers.Authorization, "ApiKey test-key");
});

test("upstream error or timeout: enabled true, error true, not cached", async () => {
  globalThis.fetch = async () => new Response("down", { status: 503 });
  let res = await GET(req("TASSOS"));
  assert.deepEqual(await res.json(), { enabled: true, error: true });
  assert.equal(res.headers.get("cache-control"), "no-store");
  globalThis.fetch = async () => { throw new DOMException("timeout", "TimeoutError"); };
  res = await GET(req("TASSOS"));
  assert.deepEqual(await res.json(), { enabled: true, error: true });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL, cannot find module `api/search.js`.

- [ ] **Step 3: Implement**

`api/search.js`:
```js
// OpenSanctions proxy. Never returns an error page: the page falls back to an outbound link.
const UPSTREAM = "https://api.opensanctions.org/search/default";
const TIMEOUT_MS = 4500;

function json(body, { status = 200, cache = false } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": cache ? "public, s-maxage=86400" : "no-store" },
  });
}

export async function GET(request) {
  const q = (new URL(request.url).searchParams.get("q") || "").trim();
  if (!q || q.length > 200) return json({ error: "bad query" }, { status: 400 });
  const key = process.env.OPENSANCTIONS_API_KEY;
  if (!key) return json({ enabled: false });
  try {
    const res = await fetch(`${UPSTREAM}?${new URLSearchParams({ q, limit: "10" })}`, {
      headers: { Authorization: `ApiKey ${key}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return json({ enabled: true, error: true });
    const body = await res.json();
    const results = (body.results || []).slice(0, 10).map((r) => ({
      name: r.caption,
      schema: r.schema,
      datasets: r.datasets || [],
      url: `https://www.opensanctions.org/entities/${encodeURIComponent(r.id)}/`,
    }));
    return json({ enabled: true, results }, { cache: true });
  } catch {
    return json({ enabled: true, error: true });
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add api/search.js tests/api.test.js
git commit -m "feat: OpenSanctions proxy that degrades to a link

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Walkthrough

**Files:**
- Create: `app/walkthrough.js`, `tests/walkthrough.test.js`
- Modify: `app/main.js` (last lines)

**Interfaces:**
- Consumes: `runSearch` (Task 9), DOM hooks from Task 8 and ids from Task 9
- Produces: `STEPS: Array<{target: string, text: string}>`, `availableSteps(steps, doc): steps`, `setupWalkthrough({runSearch, doc = document}): void`

- [ ] **Step 1: Write the failing test**

`tests/walkthrough.test.js`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { STEPS, availableSteps } from "../app/walkthrough.js";

test("five steps in page order", () => {
  assert.deepEqual(STEPS.map((s) => s.target), ["#q", '[data-walk="chips"]', '[data-walk="timeline"]', '[data-walk="names"]', '[data-walk="sources"]']);
});

test("steps whose target is missing are skipped", () => {
  const present = new Set(["#q", '[data-walk="sources"]']);
  const doc = { querySelector: (sel) => (present.has(sel) ? {} : null) };
  assert.deepEqual(availableSteps(STEPS, doc).map((s) => s.target), ["#q", '[data-walk="sources"]']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL, cannot find module `app/walkthrough.js`.

- [ ] **Step 3: Implement**

`app/walkthrough.js`:
```js
export const STEPS = [
  { target: "#q", text: "We searched TASSOS, an oil tanker's current name. Its IMO number, 9408695, works too, and never changes when the name does." },
  { target: '[data-walk="chips"]', text: "Three governments listed TASSOS within seven months, under two different programs: first Iran, then Russia." },
  { target: '[data-walk="timeline"]', text: "The timeline shows the pattern: sold out of a mainstream fleet, handed to a new manager, then listed by the first government 29 months after the sale." },
  { target: '[data-walk="names"]', text: "Five names, one hull. Search any of them and you land here." },
  { target: '[data-walk="sources"]', text: "Every sentence carries a number, and the number is the source. Open it before you quote." },
];

export function availableSteps(steps, doc) {
  return steps.filter((s) => doc.querySelector(s.target));
}

export function setupWalkthrough({ runSearch, doc = document }) {
  const card = doc.querySelector("#walk");
  const label = doc.querySelector("#walk-step");
  const bar = doc.querySelector("#walk-bar");
  const text = doc.querySelector("#walk-text");
  const back = doc.querySelector("#walk-back");
  const next = doc.querySelector("#walk-next");
  let steps = [];
  let index = 0;

  const clear = () => doc.querySelectorAll(".spot").forEach((el) => el.classList.remove("spot"));
  const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function show(i) {
    clear();
    index = i;
    const step = steps[index];
    const target = doc.querySelector(step.target);
    target.classList.add("spot");
    target.scrollIntoView({ block: "center", behavior: reduced() ? "auto" : "smooth" });
    text.classList.add("is-swapping");
    setTimeout(() => {
      text.textContent = step.text;
      text.classList.remove("is-swapping");
    }, 120);
    label.textContent = `Walkthrough · ${index + 1} of ${steps.length}`;
    bar.innerHTML = steps.map((_, k) => `<i${k <= index ? ' class="on"' : ""}></i>`).join("");
    back.disabled = index === 0;
    next.textContent = index === steps.length - 1 ? "Finish" : "Next";
  }

  function leave() {
    clear();
    card.hidden = true;
  }

  async function start(event) {
    event?.preventDefault();
    const input = doc.querySelector("#q");
    input.value = "TASSOS";
    await runSearch("TASSOS");
    steps = availableSteps(STEPS, doc);
    if (!steps.length) return;
    card.hidden = false;
    show(0);
    next.focus();
  }

  doc.querySelector("#start-walk").addEventListener("click", start);
  doc.querySelector("#nav-walk").addEventListener("click", start);
  next.addEventListener("click", () => (index === steps.length - 1 ? leave() : show(index + 1)));
  back.addEventListener("click", () => index > 0 && show(index - 1));
  doc.querySelector("#walk-exit").addEventListener("click", leave);
  doc.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !card.hidden) leave();
  });
}
```

- [ ] **Step 4: Wire it into the page**

In `app/main.js`, add to the imports:
```js
import { setupWalkthrough } from "./walkthrough.js";
```
and replace the final line `wire();` with:
```js
wire();
setupWalkthrough({ runSearch });
```

- [ ] **Step 5: Run tests and check in a browser**

Run: `npm test`
Expected: all pass.

Run the local server, open the page, click "Follow one tanker, 5 steps". Step through with Next: the outline moves search → chips → timeline → names → sources; "Finish" closes the card; Esc closes it at any step; at 375 px the card sits at the bottom and does not cause sideways scroll.

- [ ] **Step 6: Commit**

```bash
git add app/walkthrough.js tests/walkthrough.test.js app/main.js
git commit -m "feat: five-step TASSOS walkthrough

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Smoke test and CI

**Files:**
- Create: `playwright.config.js`, `tests/smoke.spec.js`, `.github/workflows/check.yml`

**Interfaces:**
- Consumes: the whole page (Tasks 9–11), story paths (Task 4)
- Produces: CI job named `check` (the required status check in Task 14)

- [ ] **Step 1: Write the config and tests**

`playwright.config.js`:
```js
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests",
  testMatch: "*.spec.js",
  timeout: 30_000,
  use: { baseURL: "http://127.0.0.1:4173" },
  webServer: {
    command: "python3 -m http.server 4173 --bind 127.0.0.1",
    url: "http://127.0.0.1:4173/index.html",
    reuseExistingServer: !process.env.CI,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
```

`tests/smoke.spec.js`:
```js
import { test, expect } from "@playwright/test";

function watchErrors(page) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && !m.location().url.includes("/api/search")) errors.push(m.text());
  });
  return errors;
}

async function search(page, text) {
  await page.fill("#q", text);
  await page.press("#q", "Enter");
}

test("TASSOS: dossier, three listing chips, timeline, official lists, wider link", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/");
  await search(page, "TASSOS");
  const first = page.locator(".dossier-entry").first();
  await expect(first.locator("h2")).toHaveText("TASSOS");
  await expect(first.locator('[data-walk="chips"] .chip')).toHaveCount(3);
  await expect(first.locator('[data-walk="timeline"]')).toBeVisible();
  await expect(page.locator("table.lists")).toContainText("United States");
  await expect(page.locator("table.lists")).toContainText("United Kingdom");
  await expect(page.locator("#wider")).toContainText("Search on OpenSanctions");
  await expect(page.locator("#lists-date")).toContainText(/Official lists updated|Some lists may be out of date/);
  expect(errors).toEqual([]);
});

test("IMO number finds the same ship", async ({ page }) => {
  await page.goto("/");
  await search(page, "IMO 9408695");
  await expect(page.locator(".dossier-entry h2").first()).toHaveText("TASSOS");
});

test("made-up name shows the empty state; non-Latin shows the hint", async ({ page }) => {
  await page.goto("/");
  await search(page, "Qzxv Nonexistent Shipping 4242");
  await expect(page.locator(".state")).toContainText("Not found in our research or on the official lists");
  await search(page, "Совкомфлот");
  await expect(page.locator(".state")).toContainText("Latin letters");
});

test("research file failing still leaves the official lists working", async ({ page }) => {
  await page.route("**/data/research-index.json", (route) => route.abort());
  await page.goto("/");
  await search(page, "TASSOS");
  await expect(page.locator(".state")).toContainText("Couldn't load our research");
  await expect(page.locator("table.lists")).toContainText("United Kingdom");
});

test("walkthrough runs start to finish", async ({ page }) => {
  await page.goto("/");
  await page.click("#start-walk");
  await expect(page.locator("#walk")).toBeVisible();
  await expect(page.locator("#walk-step")).toHaveText("Walkthrough · 1 of 5");
  for (let i = 0; i < 4; i++) await page.click("#walk-next");
  await expect(page.locator("#walk-next")).toHaveText("Finish");
  await page.click("#walk-next");
  await expect(page.locator("#walk")).toBeHidden();
});

test("no sideways scroll or clipped content on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await search(page, "TASSOS");
  await expect(page.locator(".dossier-entry").first()).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  // overflow-x: clip hides overflow instead of scrolling, so also check nothing is cut off.
  const clipped = await page.evaluate(() => [...document.querySelectorAll("body *")]
    .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1)
    .map((el) => `${el.tagName}.${el.className}`));
  expect(clipped).toEqual([]);
});

test("every story page loads", async ({ request }) => {
  for (const path of [
    "/stories/how-sanctions-work/index.html",
    "/stories/shadow-fleet/network/shadow_fleet_map.html",
    "/stories/chips-into-russia/viz/index.html",
    "/stories/who-lobbies/influence-network/index.html",
    "/stories/who-lobbies/clean-names-graph/index.html",
    "/stories/about-the-data.html",
  ]) {
    expect((await request.get(path)).status(), path).toBe(200);
  }
});
```

- [ ] **Step 2: Run the smoke test locally**

Run: `npx playwright install chromium && npm run smoke`
Expected: 7 passed. If "no sideways scroll" fails, find the element with `document.querySelectorAll('*')` wider than the viewport, fix its CSS with `min-width: 0` / `minmax(0, 1fr)` / `overflow-wrap: anywhere`, and re-run.

- [ ] **Step 3: Write the CI workflow**

`.github/workflows/check.yml`:
```yaml
name: Check

on:
  push:
    branches: [main]
  pull_request:

permissions:
  contents: read

jobs:
  check:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with:
          python-version: "3.12"
      - run: python -m pip install -r requirements-dev.txt
      - run: python -m pytest -q scripts
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: npm
      - run: npm ci
      - run: npm test
      - run: npx playwright install --with-deps chromium
      - run: npm run smoke
```

- [ ] **Step 4: Commit**

```bash
git add playwright.config.js tests/smoke.spec.js .github/workflows/check.yml
git commit -m "test: Playwright smoke test and CI workflow

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Hosting config and README

**Files:**
- Create: `vercel.json`, `.vercelignore`, `README.md`

**Interfaces:**
- Consumes: `api/search.js` (Task 10), repo layout
- Produces: deployable repo

- [ ] **Step 1: Write the config**

`vercel.json`:
```json
{
  "framework": null,
  "installCommand": "true",
  "headers": [
    {
      "source": "/data/(.*)",
      "headers": [{ "key": "Cache-Control", "value": "public, max-age=300, must-revalidate" }]
    }
  ]
}
```

`.vercelignore`:
```
node_modules
tests
scripts
docs
test-results
playwright-report
playwright.config.js
requirements-dev.txt
.github
```

- [ ] **Step 2: Write `README.md`**

```markdown
# Undercurrent

Check any ship, company or person against sanctions-evasion research and the US, UK, EU and UN sanctions lists. Every answer comes with its source.

Built for journalists and researchers covering how Russia, Iran and others get around sanctions.

## Use it

https://undercurrent.vercel.app (the address is confirmed when the Vercel project is created)

Type a ship name, a seven-digit IMO number, a company or a person. New here? Press **Follow one tanker** for a five-step tour.

## Run it locally

```bash
npx serve .
```

Then open http://localhost:3000. Everything works except the live OpenSanctions check, which shows a link instead. To try that too, run `vercel dev` with `OPENSANCTIONS_API_KEY` set.

## How the data updates

- **Official lists** (US Consolidated Screening List, UK Sanctions List, EU financial sanctions list, UN Security Council list) are downloaded every night at 04:00 UTC by `.github/workflows/update-lists.yml`.
- A list that fails to download, changes shape, or shrinks by more than 20% keeps yesterday's copy; the others still update. The page then says "Some lists may be out of date", and a GitHub issue is opened.
- **Our research** is a fixed snapshot from 25 September 2026. Rebuild the index with `python3 scripts/build_research_index.py`.
- **OpenSanctions** (optional): set `OPENSANCTIONS_API_KEY` in the Vercel project. Free for non-commercial use.

## Tests

```bash
python3 -m pytest -q scripts && npm test && npm run smoke
```

## Credit

The research comes from the VeilTrace team at the Trace the Unseen build day, 25 September 2026: https://github.com/Ttheegela/veil-trace

Code is MIT licensed. Data keeps its sources' terms; see `stories/about-the-data.html`.
```

- [ ] **Step 3: Check the README run instructions**

Run: `npx --yes serve@14.2.4 . -l 3000` and open `http://localhost:3000`.
Expected: the page loads and `TASSOS` returns the dossier (serve's clean URLs do not affect `data/` or `stories/` paths). Stop the server.

- [ ] **Step 4: Run every test once more**

Run: `python3 -m pytest -q scripts && npm test && npm run smoke`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add vercel.json .vercelignore README.md
git commit -m "docs: README and Vercel config

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Hosting (each step needs the owner's yes first)

**Files:**
- Modify: `README.md` (final URL, if it differs)

**Interfaces:**
- Consumes: the finished repo; job name `check` (Task 12); secret name `NIGHTLY_DEPLOY_KEY` (Task 6)

Ask the owner before each numbered step and wait for an explicit yes. Never print or log secret values.

- [ ] **Step 1: Create the GitHub repo and push** (ask first)

```bash
gh repo create Ttheegela/undercurrent --public --source . --remote origin --push --description "Sanctions lookup for journalists: ships, companies and people against our research and the US, UK, EU and UN lists."
```
Expected: repo created; the `Check` workflow runs on `main` and passes (`gh run watch`).

- [ ] **Step 2: Nightly deploy key** (ask first)

```bash
KEYDIR=$(mktemp -d)
ssh-keygen -t ed25519 -N "" -C "undercurrent-nightly" -f "$KEYDIR/key" -q
gh repo deploy-key add "$KEYDIR/key.pub" --repo Ttheegela/undercurrent --title "nightly lists" --allow-write
gh secret set NIGHTLY_DEPLOY_KEY --repo Ttheegela/undercurrent < "$KEYDIR/key"
rm -rf "$KEYDIR"
```
Expected: deploy key and secret listed by `gh repo deploy-key list` and `gh secret list`; the key file is deleted.

- [ ] **Step 3: Protect `main`** (ask first)

```bash
gh api repos/Ttheegela/undercurrent/rulesets -X POST --input - <<'EOF'
{
  "name": "protect-main",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    { "type": "pull_request", "parameters": { "required_approving_review_count": 0, "dismiss_stale_reviews_on_push": false, "require_code_owner_review": false, "require_last_push_approval": false, "required_review_thread_resolution": false } },
    { "type": "required_status_checks", "parameters": { "strict_required_status_checks_policy": false, "required_status_checks": [{ "context": "check" }] } }
  ],
  "bypass_actors": [{ "actor_id": null, "actor_type": "DeployKey", "bypass_mode": "always" }]
}
EOF
```
Expected: ruleset created. From now on, changes reach `main` through pull requests that pass `check`; only the nightly deploy key pushes directly.

- [ ] **Step 4: Create the Vercel project and deploy** (ask first)

```bash
vercel link --yes --project undercurrent
vercel git connect https://github.com/Ttheegela/undercurrent --yes
vercel deploy --prod
```
Expected: a production URL. Open it; search `TASSOS`; the dossier appears; `/api/search?q=tassos` returns `{"enabled":false}`. If the URL is not `undercurrent.vercel.app`, update the README in a pull request.

- [ ] **Step 5: Owner-only setup** (the owner does these; give them these instructions)

1. **OpenSanctions key**: sign up at https://www.opensanctions.org/api/ for a non-commercial key, then run `vercel env add OPENSANCTIONS_API_KEY production` in the repo and paste the key at the prompt; redeploy with `vercel deploy --prod`. Check: `/api/search?q=tassos` returns `"enabled":true` with results.
2. **Rate limit**: Vercel dashboard, project `undercurrent`, Firewall, Add rule: if Request Path equals `/api/search`, then Rate Limit, fixed window, 60 requests per 60 seconds, keyed by IP, action Deny. Publish.
3. **Uptime**: at https://uptimerobot.com create three HTTP(S) monitors, 5-minute interval, email alerts: the home page URL, `<url>/data/lists/meta.json`, `<url>/api/search?q=tassos`.

- [ ] **Step 6: First nightly run by hand** (ask first)

```bash
gh workflow run update-lists.yml --repo Ttheegela/undercurrent
gh run watch --repo Ttheegela/undercurrent
```
Expected: the run succeeds and either commits `data: official lists <date>` or reports "No changes."; Vercel deploys the new commit; the page's date line shows today.
