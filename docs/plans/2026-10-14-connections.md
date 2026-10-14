# Connections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Connections panel to every search result: live sanctions links (owners, managers, linked companies, other ships under the same manager) and nightly-refreshed US lobbying links (firms, named lobbyists with former posts, bodies, bills, parents), both rebuilt each night.

**Architecture:**
- **Nightly builders:** two new Python builders run in the existing nightly workflow. One streams OpenSanctions' relationship file into `connections.json.gz`. The other pulls US lobbying-disclosure filings for a configurable client list into `lobbying.json.gz`, porting the VeilTrace knowledge-graph method.
- **Storage:** both are uploaded to the `data-latest` GitHub release next to the OpenSanctions index; small status files are committed.
- **API:** a new Vercel Function `api/connections.js` loads both, sharing the asset loader extracted from `api/search.js`. It resolves the searched entity exactly and returns a capped, labelled neighbourhood.
- **Page:** fetches it after each dossier renders and draws a hand-made SVG plus lists.

**Tech Stack:** Python 3.12 stdlib (pytest for tests); Node 22 ES modules (`node:test`); Playwright 1.48.2; Vercel Functions; GitHub Actions.

**Spec:** `docs/specs/2026-10-14-connections-design.md` (builds on `docs/specs/2026-10-13-undercurrent-design.md`).

## Global Constraints

- Repo `~/Desktop/portfolio/projects/undercurrent`, branch `feat/connections` (already checked out). Never push or switch branches.
- Python runs from the repo venv: `.venv/bin/python -m pytest -q scripts`. Build scripts use the standard library only.
- JS tests: `npm test`; smoke: `npm run smoke` (needs a static server on 127.0.0.1:4173; start `python3 -m http.server 4173 --bind 127.0.0.1` from the repo root in the background if none is running, stop it after).
- No new runtime dependencies, no build step for the site. Functions use only Node built-ins and `app/` modules.
- Every value from data that reaches `innerHTML` goes through `escapeHtml`; every URL through `safeUrl`.
- Colours and fonts in CSS come from the `:root` tokens (Hallmark rule); no literal colours outside the token block.
- Plain words on screen; relationship wording is the list's own text (translated only for the Latvian strings listed in Task 1).
- Named people: sanctions side only as the official lists name them; lobbyists only from their own LDA disclosures, in that role. Lobbyist names in `exclude_lobbyists` are never shown.
- "No filing found is not proof of no influence." Every lobbying empty state says this.
- Each data source fails alone: its own build step, upload step and status file; yesterday's asset stays on failure; failures name the source in the nightly issue.
- Sanctions-graph caps: at most 8 boxes in the SVG; groups capped at 20 names plus a `more` count; up to 4 lobbying-firm boxes; never expand beyond one step except through a company or organisation, never from a person.
- Commit messages end with `Co-Authored-By: Claude <model> <noreply@anthropic.com>` naming the model that did the work.

## Review Focus

1. **Common names shared by several list entries** (e.g. three OpenSanctions entries named "SOVCOMFLOT"): use the best-linked one and say "N other list entries share this name". Pinned in Task 5 (`resolve`).
2. **Huge hubs** (Hizballah 232 links, IRISL 120): the response stays small (≤ 20 links, ≤ 20 per group plus `more`) and the SVG ≤ 8 boxes. Pinned in Task 5 (caps) and Task 6 (`layoutGraph`).
3. **Family and person networks:** no second-step expansion from a person. Pinned in Task 5.
4. **LDA throttling or outages** (HTTP 429 with `Retry-After`, 5xx, timeouts): retry with backoff, then fail the step and keep yesterday's asset. Pinned in Task 2 (`get_json`) and Task 3 (builder failure).
5. **Hostile or odd names** (`<script>`, quotes, very long names) in either dataset: escaped everywhere, including SVG text and `aria-label`, and truncated in boxes. Pinned in Task 6.

---

## File map

| Path | Responsibility |
|---|---|
| `scripts/asset_build.py` | Shared "validate, write gz asset, keep previous on failure" helper for nightly assets |
| `scripts/connections.py` | Parse OpenSanctions FtM lines into compact entities and sentence-ordered links |
| `scripts/build_connections.py` | Nightly builder for `connections.json.gz` |
| `scripts/lobbying.py` | LDA fetch (with retries) and extraction (port of the hackathon method) |
| `scripts/build_lobbying.py` | Nightly builder for `lobbying.json.gz` |
| `data/lobbying-clients.json` | Editable lobbying client list, queries, foreign-entity aliases, exclusions |
| `data/lobbying-bridges.json` | Hand-checked bridges and the "no lobbying found" list from the hackathon research |
| `api/_asset.js` | Shared cached gzip-JSON asset loader (12 h refresh, 10 min backoff, stale on failure) |
| `api/search.js` | Refactored to use `api/_asset.js` (behaviour unchanged) |
| `api/connections.js` | `/api/connections`: resolve entity, build capped neighbourhood and lobbying view |
| `app/connections.js` | Pure rendering: graph layout, SVG and lists for the panel |
| `app/render.js`, `app/main.js`, `app/style.css` | Panel slot, fetch-and-render wiring, styles |
| `.github/workflows/update-lists.yml` | Two new build and upload steps |
| `tests/connections.test.js`, `tests/connections-render.test.js`, `tests/smoke.spec.js` | JS tests |

---

### Task 1: Shared asset builder and the sanctions-connections builder

**Files:**
- Create: `scripts/asset_build.py`, `scripts/connections.py`, `scripts/build_connections.py`
- Create: `scripts/test_connections.py`, `scripts/test_build_connections.py`
- Create (generated): `scripts/fixtures/opensanctions_entities.jsonl`, `data/connections-meta.json`

**Interfaces:**
- Consumes: `normalize_name` (`scripts/normalize.py`), `USER_AGENT` (`scripts/build_official_lists.py`).
- Produces:
  - `asset_build.build_asset(*, label, page_url, produce, count, sample_ok, sample_name, asset_path, meta_path, now=None) -> int`
  - `connections.parse(lines) -> {"entities": [[id, schema, names, imo, authorities]], "links": [[subject, object, kind, role, authorities]]}`. A link reads as the sentence "subject role object".
  - `connections.authorities(datasets) -> list[str]`
  - `build_connections.build(lines_fn=fetch_lines, asset_path=ASSET, meta_path=META, now=None) -> int`
  - `build_connections.ASSET = build/connections.json.gz`

Facts confirmed against the live file on 2026-10-14:
- Every line is one FollowTheMoney entity with keys `id, schema, caption, datasets, properties, …`.
- Relationship schemas and their endpoint properties: Ownership `owner`/`asset`; Directorship `director`/`organization`; UnknownLink `subject`/`object`; Representation `agent`/`client`; Membership `member`/`organization`; Family `person`/`relative` (its wording is in `relationship`, not `role`).
- **Ownership wording reads from the asset's side**: `{owner: Zulu Ships Management, asset: TASSOS, role: "Property in the interest of"}` means "TASSOS property in the interest of Zulu", and `{owner: Mahan Air, asset: EP-MMC, role: "Owned or Controlled By"}` means "EP-MMC owned or controlled by Mahan Air". The exception is `"Owns, controls, or operates"`, which reads owner → asset. An empty Ownership role reads asset → owner as "Owned by".
- Other schemas read from the first property to the second.
- TASSOS id `NK-k837moN9ssPZedvkRUrexG`, `properties.imoNumber = ["IMO9408695"]`.

- [ ] **Step 1: Cut the fixture from the downloaded file**

The full file is already downloaded at `/private/tmp/claude-501/-Users-taruntheegela-Desktop-portfolio-projects-veil-trace--claude-worktrees-veil-trace-v2-cleanup-5a1fc9/b27b0ed3-0664-4464-a43a-30ed84a8521b/scratchpad/os/entities.ftm.json`. If it is missing, download it with `curl -sSL -A "Undercurrent/1.0" -o <that path> https://data.opensanctions.org/datasets/latest/sanctions/entities.ftm.json`.

```bash
SRC=/private/tmp/claude-501/-Users-taruntheegela-Desktop-portfolio-projects-veil-trace--claude-worktrees-veil-trace-v2-cleanup-5a1fc9/b27b0ed3-0664-4464-a43a-30ed84a8521b/scratchpad/os/entities.ftm.json
python3 -I - "$SRC" scripts/fixtures/opensanctions_entities.jsonl <<'EOF'
import json, sys
src, dst = sys.argv[1], sys.argv[2]
ENDS = {"Ownership": ("owner", "asset"), "Directorship": ("director", "organization"), "UnknownLink": ("subject", "object"),
        "Representation": ("agent", "client"), "Membership": ("member", "organization"), "Family": ("person", "relative")}
TASSOS = "NK-k837moN9ssPZedvkRUrexG"
def ends(r):
    a, b = ENDS[r["schema"]]
    return r["properties"].get(a, []) + r["properties"].get(b, [])
rels = []
with open(src, encoding="utf-8") as f:
    for line in f:
        r = json.loads(line)
        if r["schema"] in ENDS:
            rels.append((r, line))
zulu = next(r["properties"]["owner"][0] for r, _ in rels if r["schema"] == "Ownership" and TASSOS in r["properties"].get("asset", []))
picked = [(r, l) for r, l in rels if TASSOS in ends(r) or zulu in ends(r)]
picked.append(next((r, l) for r, l in rels if r["schema"] == "Family"))
picked.append(next((r, l) for r, l in rels if (r["properties"].get("role") or [""])[0] == "Līdzekļi"))
picked.append(next((r, l) for r, l in rels if (r["properties"].get("role") or [""])[0] == "Owns, controls, or operates"))
ids = {x for r, _ in picked for x in ends(r)}
out, extra = [l for _, l in picked], {"Sanction": None, "Address": None}
with open(src, encoding="utf-8") as f:
    for line in f:
        e = json.loads(line)
        if e["id"] in ids and e["schema"] not in ENDS:
            out.append(line)
        elif e["schema"] in extra and extra[e["schema"]] is None:
            extra[e["schema"]] = line
out += [l for l in extra.values() if l]
with open(dst, "w", encoding="utf-8") as f:
    f.writelines(l if l.endswith("\n") else l + "\n" for l in out)
print(len(out), "lines; zulu id", zulu)
EOF
```
Expected: about 40 lines; note the printed Zulu id for the report.

- [ ] **Step 2: Write the failing tests**

`scripts/test_connections.py`:
```python
import json
from pathlib import Path

import pytest

import connections as cx

FIX = Path(__file__).parent / "fixtures" / "opensanctions_entities.jsonl"
TASSOS = "NK-k837moN9ssPZedvkRUrexG"


@pytest.fixture(scope="module")
def parsed():
    with open(FIX, encoding="utf-8") as f:
        return cx.parse(f)


def ent(parsed, eid):
    return next(e for e in parsed["entities"] if e[0] == eid)


def test_tassos_entity(parsed):
    e = ent(parsed, TASSOS)
    assert e[1] == "Vessel"
    assert e[2][0] == "TASSOS"
    assert e[3] == "9408695"
    assert {"US", "UK"} <= set(e[4])


def test_tassos_is_property_of_zulu(parsed):
    names = {e[0]: e[2][0] for e in parsed["entities"]}
    link = next(l for l in parsed["links"] if l[0] == TASSOS and names[l[1]] == "Zulu Ships Management")
    assert link[2] == "Ownership"
    assert link[3] == "Property in the interest of"
    assert set(link[4]) == {"US", "UK"}


def test_owns_controls_reads_owner_first(parsed):
    link = next(l for l in parsed["links"] if l[3] == "Owns, controls, or operates")
    owner_schema = ent(parsed, link[0])[1]
    assert owner_schema in {"Person", "Company", "Organization", "LegalEntity"}


def test_family_wording_and_latvian_translation(parsed):
    assert any(l[2] == "Family" and l[3] == "Family member of" for l in parsed["links"])
    assert any(l[3] == "Linked to (assets)" for l in parsed["links"])
    assert not any(l[3].startswith("Līdzekļi") for l in parsed["links"])


def test_every_link_endpoint_is_an_entity_and_other_schemas_are_ignored(parsed):
    ids = {e[0] for e in parsed["entities"]}
    assert all(l[0] in ids and l[1] in ids for l in parsed["links"])
    assert {e[1] for e in parsed["entities"]} <= cx.ENTITY_SCHEMAS


def line(**kw):
    return json.dumps(kw)


def test_duplicate_links_merge_authorities():
    lines = [
        line(id="A", schema="Company", caption="Alpha", datasets=["us_ofac_sdn"], properties={}),
        line(id="B", schema="Vessel", caption="Bravo", datasets=["gb_fcdo_sanctions"], properties={"imoNumber": ["1234567"]}),
        line(id="r1", schema="Ownership", caption="", datasets=["us_ofac_sdn"], properties={"owner": ["A"], "asset": ["B"], "role": ["Owned or Controlled By"]}),
        line(id="r2", schema="Ownership", caption="", datasets=["gb_fcdo_sanctions"], properties={"owner": ["A"], "asset": ["B"], "role": ["Owned or Controlled By"]}),
    ]
    out = cx.parse(lines)
    assert out["links"] == [["B", "A", "Ownership", "Owned or Controlled By", ["US", "UK"]]]
    assert [e[3] for e in out["entities"] if e[0] == "B"] == ["1234567"]


def test_empty_ownership_role_reads_owned_by():
    lines = [
        line(id="A", schema="Company", caption="Alpha", datasets=[], properties={}),
        line(id="B", schema="Company", caption="Bravo", datasets=[], properties={}),
        line(id="r", schema="Ownership", caption="", datasets=["us_ofac_sdn"], properties={"owner": ["A"], "asset": ["B"]}),
    ]
    assert cx.parse(lines)["links"] == [["B", "A", "Ownership", "Owned by", ["US"]]]


def test_bad_input_raises():
    with pytest.raises(ValueError, match="bad JSON"):
        cx.parse(["{not json"])
    with pytest.raises(ValueError, match="no FollowTheMoney"):
        cx.parse([])


def test_authorities():
    assert cx.authorities(["us_ofac_sdn", "gb_fcdo_sanctions", "us_trade_csl", "xx_new_list"]) == ["US", "UK", "XX"]
```

`scripts/test_build_connections.py`:
```python
import gzip
import json
from pathlib import Path

import build_connections as b

FIX = Path(__file__).parent / "fixtures" / "opensanctions_entities.jsonl"
NOW = "2026-10-14T04:00:00Z"


def fixture_lines(url):
    assert url == b.cx.SOURCE_URL
    return FIX.read_text(encoding="utf-8").splitlines(keepends=True)


def test_fresh_build(tmp_path):
    asset, meta = tmp_path / "c.json.gz", tmp_path / "m.json"
    assert b.build(fixture_lines, asset, meta, NOW) == 0
    doc = json.loads(gzip.decompress(asset.read_bytes()))
    assert doc["updated_at"] == NOW and doc["links"] and doc["entities"]
    m = json.loads(meta.read_text())
    assert m["status"] == "fresh" and m["record_count"] == len(doc["links"])


def test_download_failure_keeps_previous(tmp_path):
    asset, meta = tmp_path / "c.json.gz", tmp_path / "m.json"

    def broken(url):
        raise OSError("timed out")

    assert b.build(broken, asset, meta, NOW) == 1
    assert not asset.exists()
    assert "timed out" in json.loads(meta.read_text())["error"]


def test_shrink_rejected(tmp_path):
    asset, meta = tmp_path / "c.json.gz", tmp_path / "m.json"
    meta.write_text(json.dumps({"record_count": 100000, "updated_at": "2026-10-13T04:00:00Z"}))
    assert b.build(fixture_lines, asset, meta, NOW) == 1
    m = json.loads(meta.read_text())
    assert "shrank" in m["error"] and m["record_count"] == 100000 and not asset.exists()


def test_missing_sample_rejected(tmp_path):
    asset, meta = tmp_path / "c.json.gz", tmp_path / "m.json"

    def no_tassos(url):
        return [l for l in fixture_lines(url) if "NK-k837moN9ssPZedvkRUrexG" not in l]

    assert b.build(no_tassos, asset, meta, NOW) == 1
    assert "sample" in json.loads(meta.read_text())["error"]


def test_corrupt_previous_meta_is_ignored(tmp_path):
    asset, meta = tmp_path / "c.json.gz", tmp_path / "m.json"
    meta.write_text("{not json")
    assert b.build(fixture_lines, asset, meta, NOW) == 0
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `.venv/bin/python -m pytest -q scripts/test_connections.py scripts/test_build_connections.py`
Expected: FAIL, `ModuleNotFoundError: No module named 'connections'`.

- [ ] **Step 4: Implement**

`scripts/asset_build.py`:
```python
"""Shared nightly-asset build: validate, write a gzipped JSON asset, keep yesterday's on failure.

produce() returns the asset dict and raises on any download or parse problem.
count(asset) is the size compared against the last good build (20% shrink limit).
sample_ok(asset) must be true. On any failure the asset file is not written and
meta records "kept-previous"; on success meta records "fresh".
"""
from __future__ import annotations

import gzip
import json
from datetime import datetime, timezone
from pathlib import Path

SHRINK_LIMIT = 0.8


def _write_meta(path: Path, meta: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")


def build_asset(*, label, page_url, produce, count, sample_ok, sample_name, asset_path, meta_path, now=None) -> int:
    now = now or datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    asset_path, meta_path = Path(asset_path), Path(meta_path)
    try:
        previous = json.loads(meta_path.read_text(encoding="utf-8"))
        if not isinstance(previous, dict):
            previous = {}
    except (OSError, ValueError):
        previous = {}
    base = {"label": label, "source_url": page_url, "checked_at": now}
    try:
        asset = produce()
        size = count(asset)
        if not size:
            raise ValueError("empty asset")
        prev_count = previous.get("record_count") or 0
        if prev_count and size < SHRINK_LIMIT * prev_count:
            raise ValueError(f"shrank from {prev_count} to {size}")
        if not sample_ok(asset):
            raise ValueError(f"sample check failed: {sample_name}")
    except Exception as exc:  # keep yesterday's release asset
        _write_meta(meta_path, {**base, "status": "kept-previous", "error": f"{type(exc).__name__}: {exc}",
                                "updated_at": previous.get("updated_at"), "record_count": previous.get("record_count", 0)})
        print(f"{label}: kept-previous - {type(exc).__name__}: {exc}")
        return 1
    asset_path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps({"updated_at": now, **asset}, ensure_ascii=False, separators=(",", ":"))
    asset_path.write_bytes(gzip.compress(payload.encode("utf-8"), 9))
    _write_meta(meta_path, {**base, "status": "fresh", "updated_at": now, "record_count": size})
    print(f"{label}: fresh ({size})")
    return 0
```

`scripts/connections.py`:
```python
"""Compact sanctions-relationship graph from OpenSanctions' entities.ftm.json (CC BY-NC 4.0).

parse(lines) reads FollowTheMoney JSON lines and returns
    {"entities": [[id, schema, names, imo, authorities]],
     "links":    [[subject, object, kind, role, authorities]]}
A link reads as the sentence "subject role object", e.g. TASSOS / Property in the
interest of / Zulu Ships Management. Only entities that appear in a link are kept.
"""
from __future__ import annotations

import json

SOURCE_URL = "https://data.opensanctions.org/datasets/latest/sanctions/entities.ftm.json"
PAGE_URL = "https://www.opensanctions.org/datasets/sanctions/"
ENTITY_SCHEMAS = {"Person", "Organization", "Company", "LegalEntity", "Vessel", "Airplane"}
MAX_NAMES = 6
# kind -> (first property, second property, default wording reading first -> second)
RELATIONS = {
    "Directorship": ("director", "organization", "Director of"),
    "UnknownLink": ("subject", "object", "Linked to"),
    "Representation": ("agent", "client", "Acting for"),
    "Membership": ("member", "organization", "Member of"),
    "Family": ("person", "relative", "Family member of"),
}
ROLE_TRANSLATIONS = {
    "Līdzekļi": "Linked to (assets)",
    "Līdzekļi; kapitāldaļas": "Linked to (assets, shares)",
    "related-to": "Related to",
}
DATASET_AUTHORITIES = {
    "us": "US", "gb": "UK", "eu": "EU", "un": "UN", "ch": "Switzerland", "ca": "Canada", "au": "Australia",
    "nz": "New Zealand", "jp": "Japan", "ua": "Ukraine", "fr": "France", "de": "Germany", "lv": "Latvia",
    "lt": "Lithuania", "sa": "Saudi Arabia", "il": "Israel", "vn": "Vietnam", "in": "India", "pl": "Poland",
}


def authorities(datasets) -> list[str]:
    out: list[str] = []
    for ds in datasets or []:
        prefix = ds.split("_")[0].lower()
        label = DATASET_AUTHORITIES.get(prefix, prefix.upper())
        if label not in out:
            out.append(label)
    return out


def _first(values) -> str:
    return (values or [""])[0].strip()


def _sentence(kind: str, props: dict):
    """Return (subjects, objects, role) so that "subject role object" reads correctly."""
    if kind == "Ownership":
        role = _first(props.get("role"))
        if role.lower().startswith("owns"):
            return props.get("owner") or [], props.get("asset") or [], role
        return props.get("asset") or [], props.get("owner") or [], role or "Owned by"
    first, second, default = RELATIONS[kind]
    role = _first(props.get("relationship" if kind == "Family" else "role")) or default
    return props.get(first) or [], props.get(second) or [], role


def _imo(props: dict) -> str:
    for value in props.get("imoNumber") or []:
        digits = value.upper().removeprefix("IMO").strip()
        if len(digits) == 7 and digits.isdigit():
            return digits
    return ""


def parse(lines) -> dict:
    entities: dict[str, list] = {}
    merged: dict[tuple, list] = {}
    seen = 0
    for raw in lines:
        raw = raw.strip()
        if not raw:
            continue
        try:
            record = json.loads(raw)
        except ValueError as exc:
            raise ValueError(f"connections: bad JSON line ({exc})") from exc
        seen += 1
        schema = record.get("schema")
        props = record.get("properties") or {}
        if schema == "Ownership" or schema in RELATIONS:
            subjects, objects, role = _sentence(schema, props)
            role = ROLE_TRANSLATIONS.get(role, role)
            auth = authorities(record.get("datasets"))
            for s in subjects:
                for o in objects:
                    if s == o:
                        continue
                    key = (s, o, schema, role)
                    if key in merged:
                        merged[key][4] += [a for a in auth if a not in merged[key][4]]
                    else:
                        merged[key] = [s, o, schema, role, list(auth)]
        elif schema in ENTITY_SCHEMAS:
            names: list[str] = []
            for name in [record.get("caption") or "", *(props.get("name") or []), *(props.get("alias") or [])]:
                name = name.strip()
                if name and name not in names:
                    names.append(name)
            if names:
                entities[record["id"]] = [record["id"], schema, names[:MAX_NAMES], _imo(props), authorities(record.get("datasets"))]
    if not seen:
        raise ValueError("connections: no FollowTheMoney records")
    links = [l for l in merged.values() if l[0] in entities and l[1] in entities]
    used = {x for l in links for x in l[:2]}
    return {"entities": [entities[i] for i in sorted(used)], "links": links}
```

`scripts/build_connections.py`:
```python
"""Nightly: build the sanctions-connections asset from OpenSanctions' relationship data.

Writes build/connections.json.gz (uploaded to the data-latest release by the workflow)
and data/connections-meta.json (committed). Exits 1 and leaves the asset unwritten when
the download fails, the file has the wrong shape, the link count falls more than 20%
below the last good build, or TASSOS is no longer linked to Zulu Ships Management.
"""
from __future__ import annotations

import sys
import urllib.request
from pathlib import Path

import connections as cx
from asset_build import build_asset
from build_official_lists import USER_AGENT
from normalize import normalize_name

ROOT = Path(__file__).resolve().parent.parent
ASSET = ROOT / "build" / "connections.json.gz"
META = ROOT / "data" / "connections-meta.json"
SAMPLE = "TASSOS (IMO 9408695) linked to Zulu Ships Management"


def fetch_lines(url: str):
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=300) as response:
        for raw in response:
            yield raw.decode("utf-8")


def tassos_linked_to_zulu(asset: dict) -> bool:
    names = {e[0]: {normalize_name(n) for n in e[2]} for e in asset["entities"]}
    ships = {e[0] for e in asset["entities"] if e[3] == "9408695"}
    target = normalize_name("Zulu Ships Management")
    for subject, obj, *_ in asset["links"]:
        if (subject in ships and target in names.get(obj, set())) or (obj in ships and target in names.get(subject, set())):
            return True
    return False


def build(lines_fn=fetch_lines, asset_path: Path = ASSET, meta_path: Path = META, now: str | None = None) -> int:
    return build_asset(
        label="OpenSanctions connections", page_url=cx.PAGE_URL,
        produce=lambda: cx.parse(lines_fn(cx.SOURCE_URL)), count=lambda a: len(a["links"]),
        sample_ok=tassos_linked_to_zulu, sample_name=SAMPLE,
        asset_path=asset_path, meta_path=meta_path, now=now,
    )


if __name__ == "__main__":
    sys.exit(build())
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `.venv/bin/python -m pytest -q scripts`
Expected: all pass, including the existing 74.

- [ ] **Step 6: Build once from the real file, and commit the baseline meta**

```bash
.venv/bin/python -c "import sys; sys.path.insert(0, 'scripts'); import build_connections as b; p = '/private/tmp/claude-501/-Users-taruntheegela-Desktop-portfolio-projects-veil-trace--claude-worktrees-veil-trace-v2-cleanup-5a1fc9/b27b0ed3-0664-4464-a43a-30ed84a8521b/scratchpad/os/entities.ftm.json'; print(b.build(lambda u: open(p, encoding='utf-8')))"
ls -la build/connections.json.gz && cat data/connections-meta.json
```
Expected: `0`, a file of about 0.8–1 MB, meta `fresh` with record_count about 12,000. Keep `data/connections-meta.json` (the nightly shrink baseline); `build/` is git-ignored.

- [ ] **Step 7: Commit**

```bash
git add scripts/asset_build.py scripts/connections.py scripts/build_connections.py scripts/test_connections.py scripts/test_build_connections.py scripts/fixtures/opensanctions_entities.jsonl data/connections-meta.json
git commit -m "feat: nightly sanctions-connections asset from OpenSanctions relationships"
```

---

### Task 2: Lobbying configuration, bridges and the LDA fetch and extract module

**Files:**
- Create: `data/lobbying-clients.json`, `data/lobbying-bridges.json` (generated in Step 1)
- Create: `scripts/lobbying.py`, `scripts/test_lobbying.py`
- Create (generated): `scripts/fixtures/lda_nord_stream_2.json`

**Interfaces:**
- Consumes: none from earlier tasks.
- Produces:
  - `lobbying.BASE = "https://lda.gov/api/v1/filings/"`, `lobbying.DELAY = 1.2`
  - `lobbying.load_config(path) -> dict` with keys `queries` (list of `[param, value]`), `clients`, `associations`, `foreign_entity_aliases`, `exclude_lobbyists`
  - `lobbying.get_json(url, opener=urllib.request.urlopen, sleep=time.sleep) -> dict` (retries)
  - `lobbying.fetch_filings(queries, get=get_json, sleep=time.sleep, base=BASE) -> dict[str, dict]` keyed by `filing_uuid`
  - `lobbying.extract(filings, config) -> {"nodes": [...], "edges": [...], "filings_kept": int, "filings_scanned": int}`
  - Node: `{"id", "type": "company|association|person|lobbyfirm|government|bill", "name", "layer": "lobby", …}`. Clients carry `lda_names`; persons carry `covered_positions`; bills carry `title`.
  - Edge: `{"source", "target", "type", "filings": [uuid], "n_filings", "years": [first, last], "texts": [≤4], "source_url", "dataset", "confidence": "Documented"}`, plus `amount` (hired), `subcontract`/`sub_amount`, `ownership_pct` (foreign_entity_of) and `client` (lobbied, lobbied_on).

This ports `research/knowledge-graph/scripts/fetch_lda.py` and `extract_lobby.py` from `veil-trace@88dcaa2` with exactly three changes:
1. The client list, queries, foreign-entity aliases and associations come from `data/lobbying-clients.json`.
2. `lobbied` and `lobbied_on` edges are kept per client (their aggregation key includes the client id, and the edge carries `client`), so one firm's work for two clients is not mixed.
3. Filing URLs use `https://lda.gov/filings/public/filing/<uuid>/print/` (the current host), and lobbyists in `exclude_lobbyists` are dropped.

- [ ] **Step 1: Write the config, generate the bridges file and fetch the fixture**

`data/lobbying-clients.json` (exact content):
```json
{
  "about": "Lobbying clients tracked nightly in US Lobbying Disclosure Act filings (lda.gov). Started from the VeilTrace knowledge graph (25 Sep 2026). Add a company: one query line and one client line. exclude_lobbyists: normalised names never shown (takedown requests).",
  "queries": [
    ["client_name", "Sberbank"], ["client_name", "VTB Bank"], ["client_name", "Gazprombank"],
    ["client_name", "Gazpromexport"], ["client_name", "Nord Stream 2"], ["client_name", "New European Pipeline"],
    ["client_name", "Norilsk"], ["client_name", "Norimet"], ["client_name", "Union of Oil and Gas Producers"],
    ["client_name", "Arctic LNG"], ["client_name", "Hikvision"], ["client_name", "Yamal LNG"], ["client_name", "Novatek"],
    ["client_name", "Deripaska"], ["client_name", "Huawei"], ["client_name", "Futurewei"], ["client_name", "ZTE"],
    ["client_name", "Hytera"], ["client_name", "Semiconductor Manufacturing International"], ["client_name", "DJI Technology"],
    ["client_name", "Ninestar"], ["client_name", "Semiconductor Industry Association"],
    ["client_name", "Semiconductors Industry Association"], ["client_name", "US-China Business Council"],
    ["client_name", "NVIDIA"],
    ["foreign_entity_name", "Gazprom"], ["foreign_entity_name", "Sberbank"], ["foreign_entity_name", "Novatek"],
    ["foreign_entity_name", "Deripaska"], ["foreign_entity_name", "Huawei"], ["foreign_entity_name", "Hikvision"],
    ["foreign_entity_name", "Sovcomflot"], ["foreign_entity_name", "Rosneft"], ["foreign_entity_name", "Lukoil"]
  ],
  "clients": [
    {"pattern": "\\bSBERBANK\\b", "id": "co:sberbank-cib-usa", "name": "Sberbank CIB USA", "group": "russia"},
    {"pattern": "^VTB BANK", "id": "co:vtb-bank", "name": "VTB Bank", "group": "russia"},
    {"pattern": "GAZPROMBANK", "id": "co:gazprombank", "name": "Gazprombank", "group": "russia"},
    {"pattern": "GAZPROMEXPORT", "id": "co:gazpromexport", "name": "Gazpromexport", "group": "russia"},
    {"pattern": "NORD STREAM 2", "id": "co:nord-stream-2", "name": "Nord Stream 2 AG", "group": "russia"},
    {"pattern": "NEW EUROPEAN PIPELINE", "id": "co:nord-stream-2", "name": "Nord Stream 2 AG", "group": "russia"},
    {"pattern": "NORILSK", "id": "co:norilsk-nickel", "name": "Norilsk Nickel", "group": "russia"},
    {"pattern": "^NORIMET", "id": "co:norilsk-nickel", "name": "Norilsk Nickel", "group": "russia"},
    {"pattern": "UNION OF OIL AND GAS PRODUCERS", "id": "co:union-oil-gas-producers-russia", "name": "Union of Oil and Gas Producers of Russia", "group": "russia"},
    {"pattern": "ARCTIC LNG", "id": "co:arctic-lng-2", "name": "Arctic LNG 2", "group": "russia"},
    {"pattern": "YAMAL LNG", "id": "co:yamal-lng", "name": "Yamal LNG", "group": "russia"},
    {"pattern": "^(OAO |PAO )?NOVATEK", "id": "co:novatek", "name": "Novatek", "group": "russia"},
    {"pattern": "^OLEG DERIPASKA", "id": "p:oleg-deripaska", "name": "Oleg Deripaska", "group": "russia"},
    {"pattern": "^EN\\+ GROUP", "id": "co:en-plus-group", "name": "En+ Group", "group": "russia"},
    {"pattern": "HIKVISION", "id": "co:hikvision-usa", "name": "Hikvision USA", "group": "china"},
    {"pattern": "HUAWEI|FUTUREWEI", "id": "co:huawei", "name": "Huawei", "group": "china"},
    {"pattern": "\\bZTE (USA|CORP)", "id": "co:zte", "name": "ZTE", "group": "china"},
    {"pattern": "HYTERA", "id": "co:hytera", "name": "Hytera Communications", "group": "china"},
    {"pattern": "SEMICONDUCTOR MANUFACTURING INTERNATIONAL", "id": "co:smic", "name": "SMIC (Semiconductor Manufacturing International)", "group": "china"},
    {"pattern": "^DJI TECHNOLOGY", "id": "co:dji", "name": "DJI Technology", "group": "china"},
    {"pattern": "NINESTAR CORP", "id": "co:ninestar", "name": "Ninestar", "group": "china"},
    {"pattern": "^SEMICONDUCTORS? INDUSTRY ASSOCIATION", "id": "org:sia", "name": "Semiconductor Industry Association", "group": "chips"},
    {"pattern": "US-CHINA BUSINESS COUNCIL", "id": "org:uscbc", "name": "US-China Business Council", "group": "chips"},
    {"pattern": "^NVIDIA", "id": "co:nvidia", "name": "NVIDIA", "group": "chips"}
  ],
  "associations": ["org:sia", "org:uscbc", "co:union-oil-gas-producers-russia"],
  "foreign_entity_aliases": [
    ["gazprombank", "co:gazprombank", "company", "Gazprombank"],
    ["gazprom(?!bank|export)", "co:gazprom", "company", "Gazprom"],
    ["russian federation", "gov:russia", "government", "Government of Russia"],
    ["novate[kc]h?", "co:novatek", "company", "Novatek"],
    ["deripaska", "p:oleg-deripaska", "person", "Oleg Deripaska"],
    ["^wang tao", "p:wang-tao", "person", "Wang Tao"],
    ["^qingzhou chen", "p:qingzhou-chen", "person", "Qingzhou Chen"],
    ["^dji\\b", "co:dji-group", "company", "DJI group companies"],
    ["iflight", "co:iflight-technology", "company", "iFlight Technology"],
    ["royal dutch shell", "co:shell", "company", "Shell"],
    ["^engie", "co:engie", "company", "Engie"],
    ["^omv", "co:omv", "company", "OMV"],
    ["^uniper", "co:uniper", "company", "Uniper"],
    ["^wintershall", "co:wintershall", "company", "Wintershall"],
    ["^e\\.?on", "co:e-on", "company", "E.ON"],
    ["china electronics technology group", "co:cetc", "company", "China Electronics Technology Group (CETC)"],
    ["^cethik", "co:cethik-group", "company", "CETHIK Group"],
    ["zhongxingxin", "co:zhongxingxin", "company", "Zhongxingxin Telecom Equipment"],
    ["zhongxing telecom", "co:zte", "company", "ZTE"],
    ["independent trustees", null, null, null]
  ],
  "exclude_lobbyists": []
}
```

Generate `data/lobbying-bridges.json` from the hackathon's hand-checked file, resolving ids to names with the published graph:
```bash
OLD=/Users/taruntheegela/Desktop/portfolio/projects/veil-trace
git -C "$OLD" show 88dcaa2:research/knowledge-graph/scripts/curated.json > /tmp/uc_curated.json
python3 - /tmp/uc_curated.json stories/who-lobbies/influence-network/kg_data.js data/lobbying-bridges.json <<'EOF'
import json, sys
cur = json.load(open(sys.argv[1], encoding="utf-8"))
kg = open(sys.argv[2], encoding="utf-8").read()
kg = json.loads(kg[kg.index("{"):kg.rindex("}") + 1])
names = {n["id"]: n["n"] for n in kg["nodes"]}
names.update({n["id"]: n["name"] for n in cur["nodes"]})
def name(i):
    return names.get(i) or i.split(":", 1)[-1].replace("-", " ").title()
GRADES = {"Documented": "documented", "Reported": "reported", "Lead": "lead"}
links = [{"from": name(e["source"]), "relation": e["type"].replace("_", " "), "to": name(e["target"]),
          "grade": GRADES.get(e.get("confidence"), "lead"), "date": e.get("date") or "",
          "source_url": e.get("source_url") or "", "quote": (e.get("quote") or "")[:300]} for e in cur["edges"]]
out = {"about": "Hand-checked links between the lobbying side and the fleet, and companies searched with no US lobbying found, from the VeilTrace knowledge graph (veil-trace@88dcaa2, 25 Sep 2026). Grade 'lead' means our inference, not an official finding.",
       "links": links, "no_lobbying_found": cur["no_lobbying_found"]["names"]}
json.dump(out, open(sys.argv[3], "w", encoding="utf-8"), ensure_ascii=False, indent=1)
print(len(links), "bridges;", len(out["no_lobbying_found"]), "no-lobbying names")
EOF
rm /tmp/uc_curated.json
```
Expected: `18 bridges; 18 no-lobbying names`.

Fetch the fixture page (one real API page, about 60 filings spread over 3 pages; keep page 1):
```bash
curl -sS -A "Undercurrent/1.0 (+https://github.com/Ttheegela/undercurrent)" "https://lda.gov/api/v1/filings/?client_name=Nord+Stream+2&page_size=25" -o scripts/fixtures/lda_nord_stream_2.json
python3 -c "import json; d=json.load(open('scripts/fixtures/lda_nord_stream_2.json')); print(d['count'], len(d['results']))"
```
Expected: a count of about 60 and 25 results.

- [ ] **Step 2: Write the failing tests**

`scripts/test_lobbying.py`:
```python
import email.message
import json
import urllib.error
from pathlib import Path

import pytest

import lobbying as lb

ROOT = Path(__file__).resolve().parent.parent
CONFIG = lb.load_config(ROOT / "data" / "lobbying-clients.json")
FIX = Path(__file__).parent / "fixtures" / "lda_nord_stream_2.json"


def filing(uuid, *, client="NORD STREAM 2 AG", client_id=1, registrant="CAPITOL COUNSEL LLC", reg_id=10,
           year=2018, period="first_quarter", income=None, posted="2018-04-20T00:00:00Z", activities=None, foreign=None):
    return {"filing_uuid": uuid, "client": {"id": client_id, "name": client}, "registrant": {"id": reg_id, "name": registrant},
            "filing_year": year, "filing_period": period, "income": income, "expenses": None, "dt_posted": posted,
            "lobbying_activities": activities or [], "foreign_entities": foreign or []}


def edges(out, typ):
    return [e for e in out["edges"] if e["type"] == typ]


def test_amendment_counted_once_latest_amount_wins():
    out = lb.extract({"a": filing("a", income="50000", posted="2018-04-20T00:00:00Z"),
                      "b": filing("b", income="60000", posted="2018-05-20T00:00:00Z")}, CONFIG)
    [hired] = edges(out, "hired")
    assert hired["source"] == "co:nord-stream-2"
    assert hired["amount"] == 60000.0
    assert hired["n_filings"] == 2


def test_version_with_amount_beats_later_blank():
    out = lb.extract({"a": filing("a", income="40000", posted="2020-01-01T00:00:00Z"),
                      "b": filing("b", income=None, posted="2020-02-01T00:00:00Z")}, CONFIG)
    assert edges(out, "hired")[0]["amount"] == 40000.0


def test_subcontract_not_added_to_client_total():
    out = lb.extract({"a": filing("a", client="BIG FIRM ON BEHALF OF NORD STREAM 2 AG", income="30000")}, CONFIG)
    [hired] = edges(out, "hired")
    assert hired.get("subcontract") is True
    assert hired.get("sub_amount") == 30000.0
    assert "amount" not in hired


def test_in_house_filing():
    out = lb.extract({"a": filing("a", registrant="NORD STREAM 2 AG", income="10000")}, CONFIG)
    assert edges(out, "lobbied_in_house")[0]["target"] == "co:nord-stream-2"


def test_lobbyist_former_post_bodies_bills_and_parent():
    act = {"description": "S.722 Countering Iran's Destabilizing Activities Act, Russia sanctions",
           "government_entities": [{"name": "SENATE"}, {"name": "TREASURY - DEPT OF"}],
           "lobbyists": [{"lobbyist": {"first_name": "JANE", "last_name": "EXAMPLE"}, "covered_position": "Legislative Assistant, Sen. Smith"}]}
    foreign = [{"name": "GAZPROM (50% of NS2 operating budget)", "country": "RU", "ownership_percentage": "50"}]
    out = lb.extract({"a": filing("a", income="1000", activities=[act], foreign=foreign)}, CONFIG)
    names = {n["id"]: n for n in out["nodes"]}
    assert names["p:jane-example"]["name"] == "Jane Example"
    assert names["p:jane-example"]["covered_positions"] == ["Legislative Assistant, Sen. Smith"]
    assert any(e["source"] == "p:jane-example" and e["target"] == "gov:us-senate" for e in edges(out, "formerly_served_in"))
    assert {(e["target"], e["client"]) for e in edges(out, "lobbied")} == {("gov:us-senate", "co:nord-stream-2"), ("gov:us-treasury", "co:nord-stream-2")}
    assert [(e["target"], e["client"]) for e in edges(out, "lobbied_on")] == [("bill:s722", "co:nord-stream-2")]
    [fe] = edges(out, "foreign_entity_of")
    assert fe["source"] == "co:gazprom" and fe["target"] == "co:nord-stream-2"
    assert fe["texts"] == ["50% of NS2 operating budget"] and fe["ownership_pct"] == "50"
    assert edges(out, "lobbied_for")[0]["source"] == "p:jane-example"


def test_long_tail_bill_dropped_and_lobbied_kept_per_client():
    act1 = {"description": "H.R. 1234 farm subsidies", "government_entities": [{"name": "SENATE"}], "lobbyists": []}
    out = lb.extract({"a": filing("a", activities=[act1]),
                      "b": filing("b", client="HUAWEI TECHNOLOGIES USA", client_id=2, activities=[act1])}, CONFIG)
    assert not any(n["type"] == "bill" for n in out["nodes"])
    assert {e["client"] for e in edges(out, "lobbied")} == {"co:nord-stream-2", "co:huawei"}


def test_excluded_lobbyist_and_unmatched_client_dropped():
    cfg = {**CONFIG, "exclude_lobbyists": ["JANE EXAMPLE"]}
    act = {"description": "", "government_entities": [], "lobbyists": [{"lobbyist": {"first_name": "Jane", "last_name": "Example"}, "covered_position": ""}]}
    out = lb.extract({"a": filing("a", activities=[act]), "z": filing("z", client="ACME WIDGETS", client_id=9)}, cfg)
    assert not any(n["id"] == "p:jane-example" for n in out["nodes"])
    assert out["filings_kept"] == 1 and out["filings_scanned"] == 2


def test_filing_url_uses_lda_gov():
    out = lb.extract({"abc-123": filing("abc-123", income="1")}, CONFIG)
    assert edges(out, "hired")[0]["source_url"] == "https://lda.gov/filings/public/filing/abc-123/print/"


def test_real_page_gives_nord_stream_2_firms():
    page = json.loads(FIX.read_text(encoding="utf-8"))
    out = lb.extract({r["filing_uuid"]: r for r in page["results"]}, CONFIG)
    hired = [e for e in out["edges"] if e["type"] in ("hired", "lobbied_in_house") and e["source"] == "co:nord-stream-2"]
    assert hired and all(e["source_url"].startswith("https://lda.gov/filings/public/filing/") for e in hired)


def test_fetch_walks_every_page():
    pages = {"https://x/?client_name=A&page_size=25": {"results": [{"filing_uuid": "1", "client": {"name": "A"}}], "next": "https://x/p2"},
             "https://x/p2": {"results": [{"filing_uuid": "2", "client": {"name": "A"}}], "next": None}}
    got = lb.fetch_filings([["client_name", "A"]], get=pages.__getitem__, sleep=lambda s: None, base="https://x/")
    assert sorted(got) == ["1", "2"]


class FakeResponse:
    def __init__(self, body):
        self.body = body
    def __enter__(self):
        return self
    def __exit__(self, *a):
        return False
    def read(self):
        return self.body


def http_error(code, retry_after=None):
    headers = email.message.Message()
    if retry_after:
        headers["Retry-After"] = retry_after
    return urllib.error.HTTPError("https://x", code, "err", headers, None)


def test_get_json_retries_429_then_succeeds():
    waits, calls = [], []

    def opener(req, timeout):
        calls.append(1)
        if len(calls) == 1:
            raise http_error(429, "7")
        return FakeResponse(b'{"ok": true}')

    assert lb.get_json("https://x", opener=opener, sleep=waits.append) == {"ok": True}
    assert waits == [7]


def test_get_json_gives_up_after_six_server_errors():
    def opener(req, timeout):
        raise http_error(503)

    with pytest.raises(RuntimeError, match="giving up"):
        lb.get_json("https://x", opener=opener, sleep=lambda s: None)


def test_get_json_raises_on_client_error():
    def opener(req, timeout):
        raise http_error(404)

    with pytest.raises(urllib.error.HTTPError):
        lb.get_json("https://x", opener=opener, sleep=lambda s: None)
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `.venv/bin/python -m pytest -q scripts/test_lobbying.py`
Expected: FAIL, `ModuleNotFoundError: No module named 'lobbying'`.

- [ ] **Step 4: Implement `scripts/lobbying.py`**

```python
"""US lobbying-disclosure (LDA) layer: fetch filings for tracked clients and extract a graph.

Ported from the VeilTrace knowledge graph (veil-trace@88dcaa2 research/knowledge-graph/scripts/
fetch_lda.py and extract_lobby.py). Changes: clients, queries and aliases come from
data/lobbying-clients.json; lobbied/lobbied_on edges are kept per client; filing URLs use
lda.gov; lobbyists in exclude_lobbyists are dropped.

extract() output:
  nodes: lobby firms, clients, their foreign parents, lobbyists (named by the filing), government
         bodies lobbied, bills/orders named, former government posts (the revolving door)
  edges: hired, lobbied_in_house, lobbyist_at, lobbied_for, lobbied, lobbied_on,
         foreign_entity_of, formerly_served_in. Every edge carries its filing UUIDs and URL.
"""
from __future__ import annotations

import json
import re
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from pathlib import Path

from normalize import normalize_name

BASE = "https://lda.gov/api/v1/filings/"
FILING_URL = "https://lda.gov/filings/public/filing/%s/print/"
DELAY = 1.2
USER_AGENT = "Undercurrent/1.0 (+https://github.com/Ttheegela/undercurrent)"

SUBCONTRACT = re.compile(r"ON BEHALF OF|\bTHROUGH\b|\(FOR ", re.I)
BILL_RE = re.compile(r"\b(S\.\s?\d{2,5}|H\.\s?R\.\s?\d{2,5}|E\.?O\.?\s?\d{5}|Executive Order\s?\d{5})", re.I)
POSTS = [
    (r"treasury", "gov:us-treasury", "US Treasury"),
    (r"commerce|\bdoc\b", "gov:us-commerce", "US Commerce Department"),
    (r"state dep|dept\. of state|department of state|secretary of state|ambassador|\bstate\b.*secy|secy.*\bstate\b", "gov:us-state", "US State Department"),
    (r"white house|\bwh\b|to (the )?pres|ast to pres|potus|national economic council|natl econ|\bnsc\b|national security council|\beop\b|ustr|trade representative", "gov:white-house", "White House"),
    (r"senat|\bsen\b|\bsen\.|\bs\.? maj|senate", "gov:us-senate", "US Senate"),
    (r"house|congress|representative|\brep\b|\brep\.|speaker|\bspkr\b", "gov:us-house", "US House of Representatives"),
    (r"defense|pentagon|army|navy|air force", "gov:us-defense", "US Defense Department"),
    (r"justice|doj|attorney", "gov:us-justice", "US Justice Department"),
]
POST_RE = [(re.compile(p, re.I), gid, name) for p, gid, name in POSTS]
ROLE_WORDS = re.compile(r"chief|director|counsel|assist|asst|staff|member|senator|secretary|secy|advis|aide|"
                        r"correspondent|ambassador|representative|congress|legislative|\bla\b|\bld\b|\bcos\b", re.I)
KEY_BILLS = {
    "bill:s722": "S.722 Countering Iran's Destabilizing Activities Act (2017), the vehicle for new Russia sanctions",
    "bill:hr3364": "H.R.3364 Countering America's Adversaries Through Sanctions Act (CAATSA, 2017)",
    "bill:s1705": "S.1705 Chip Security Act",
    "bill:hr3447": "H.R.3447 Chip Security Act",
    "bill:s3455": "S.3455 ZTE Enforcement Review and Oversight Act",
    "bill:eo13660": "Executive Order 13660 (2014): first US sanctions over Ukraine",
    "bill:eo13873": "Executive Order 13873 (2019): securing telecom supply chains",
    "bill:eo14017": "Executive Order 14017 (2021): America's supply chains",
}
BILL_KEEP = re.compile(r"sanction|export control|export administration|entity list|russia|china|chinese|huawei|zte|"
                       r"countering|pipeline|nord stream|caatsa|adversar|outbound|cfius|iran|hikvision|drone|unmanned|"
                       r"chip security|ofac|magnitsky|ukraine", re.I)
GOV_BODIES = [
    (r"SENATE", "gov:us-senate", "US Senate"),
    (r"HOUSE OF REP", "gov:us-house", "US House of Representatives"),
    (r"TREASURY", "gov:us-treasury", "US Treasury"),
    (r"COMMERCE", "gov:us-commerce", "US Commerce Department"),
    (r"STATE - DEPT|STATE DEPT|DEPARTMENT OF STATE", "gov:us-state", "US State Department"),
    (r"WHITE HOUSE|EXECUTIVE OFFICE|NATIONAL SECURITY COUNCIL|TRADE REPRESENTATIVE|USTR", "gov:white-house", "White House"),
    (r"DEFENSE", "gov:us-defense", "US Defense Department"),
    (r"ENERGY - DEPT", "gov:us-energy", "US Energy Department"),
]
GOV_RE = [(re.compile(p, re.I), gid, name) for p, gid, name in GOV_BODIES]


def load_config(path) -> dict:
    cfg = json.loads(Path(path).read_text(encoding="utf-8"))
    for key in ("queries", "clients", "associations", "foreign_entity_aliases", "exclude_lobbyists"):
        if key not in cfg:
            raise ValueError(f"lobbying config: missing {key}")
    return cfg


def get_json(url: str, opener=urllib.request.urlopen, sleep=time.sleep) -> dict:
    for attempt in range(6):
        request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
        try:
            with opener(request, timeout=60) as response:
                return json.loads(response.read())
        except urllib.error.HTTPError as exc:
            if exc.code == 429:
                sleep(int(exc.headers.get("Retry-After") or 20 * (attempt + 1)))
                continue
            if exc.code >= 500:
                sleep(5 * (attempt + 1))
                continue
            raise
        except urllib.error.URLError:
            sleep(5 * (attempt + 1))
    raise RuntimeError("giving up on " + url)


def fetch_filings(queries, get=get_json, sleep=time.sleep, base: str = BASE) -> dict[str, dict]:
    filings: dict[str, dict] = {}
    for param, value in queries:
        url = base + "?" + urllib.parse.urlencode({param: value, "page_size": 25})
        while url:
            data = get(url)
            for r in data.get("results") or []:
                if isinstance(r, dict) and r.get("filing_uuid") and isinstance(r.get("client"), dict):
                    filings[r["filing_uuid"]] = r
            url = data.get("next")
            sleep(DELAY)
    return filings


def slug(s: str) -> str:
    s = re.sub(r"[.,'\"()&]", " ", s.lower())
    s = re.sub(r"\b(llc|l l c|inc|ltd|lp|llp|pllc|corp|corporation|co|company|the)\b", " ", s)
    return re.sub(r"[^a-z0-9]+", "-", s).strip("-")


def person_name(p: dict) -> str:
    parts = [p.get("first_name") or "", p.get("middle_name") or "", p.get("last_name") or "", p.get("suffix") or ""]
    return " ".join(x.strip().title() for x in parts if x and x.strip())


def money(r: dict) -> float:
    for k in ("income", "expenses"):
        v = r.get(k)
        if v not in (None, ""):
            try:
                return float(v)
            except ValueError:
                pass
    return 0.0


def extract(filings, config: dict) -> dict:
    filings = filings if isinstance(filings, dict) else {r["filing_uuid"]: r for r in filings}
    client_re = [(re.compile(c["pattern"]), c["id"], c["name"], c["group"]) for c in config["clients"]]
    fe_re = [(re.compile(p, re.I), fid, t, n) for p, fid, t, n in config["foreign_entity_aliases"]]
    assoc = set(config["associations"])
    excluded = {normalize_name(n) for n in config["exclude_lobbyists"]}

    def match_client(name: str):
        for rx, cid, disp, grp in client_re:
            if rx.search(name.upper()):
                return cid, disp, grp
        return None

    nodes: dict[str, dict] = {}
    agg: dict[tuple, dict] = {}

    def node(nid, typ, name, **kw):
        n = nodes.setdefault(nid, {"id": nid, "type": typ, "name": name, "layer": "lobby"})
        for k, v in kw.items():
            if v not in (None, "", [], {}):
                n.setdefault(k, v)
        return n

    # One filing per (registrant, client, year, period): the version stating an amount, then the most recent.
    latest: dict[tuple, dict] = {}
    for r in filings.values():
        key = ((r.get("registrant") or {}).get("id"), r["client"].get("id"), r.get("filing_year"), r.get("filing_period"))
        rank = (money(r) > 0, r.get("dt_posted") or "")
        if key not in latest or rank > (money(latest[key]) > 0, latest[key].get("dt_posted") or ""):
            latest[key] = r
    canonical = {r["filing_uuid"] for r in latest.values()}

    def edge(s, t, typ, r, client=None, text=None):
        key = (s, t, typ, client)
        e = agg.setdefault(key, {"source": s, "target": t, "type": typ, "filings": [], "years": set(),
                                 "amount": 0.0, "texts": set(), "confidence": "Documented"})
        if client:
            e["client"] = client
        uuid = r["filing_uuid"]
        if uuid not in e["filings"]:
            e["filings"].append(uuid)
            if typ == "hired":
                # Count each firm-client-quarter once (latest version), never subcontracted money toward the client.
                if SUBCONTRACT.search(r["client"].get("name") or ""):
                    e["sub_amount"] = e.get("sub_amount", 0.0) + (money(r) if uuid in canonical else 0.0)
                    e["subcontract"] = True
                elif uuid in canonical:
                    e["amount"] += money(r)
        if r.get("filing_year"):
            e["years"].add(int(r["filing_year"]))
        if text:
            e["texts"].add(text[:220])
        return e

    kept = 0
    for r in filings.values():
        cname = (r["client"].get("name") or "").strip()
        m = match_client(cname)
        if not m:
            continue
        cid, cdisp, grp = m
        kept += 1
        ctype = "association" if cid in assoc else "person" if cid.startswith("p:") else "company"
        cn = node(cid, ctype, cdisp, group=grp)
        cn["type"], cn["name"] = ctype, cdisp
        cn.setdefault("lda_names", [])
        if cname not in cn["lda_names"]:
            cn["lda_names"].append(cname)
        rname = ((r.get("registrant") or {}).get("name") or "").strip()
        reg_match = match_client(rname)
        self_filed = reg_match is not None and reg_match[0] == cid
        if self_filed:
            fid = cid
        else:
            fid = "lf:" + slug(rname)
            node(fid, "lobbyfirm", rname.title().replace("Llc", "LLC").replace("Llp", "LLP"))
        hired = edge(cid, fid, "lobbied_in_house" if self_filed else "hired", r)
        for fe in r.get("foreign_entities") or []:
            fname = (fe.get("name") or "").strip()
            if not fname:
                continue
            note = "; ".join(re.findall(r"\(([^)]*)\)", fname))
            base = re.sub(r"\s*\([^)]*\)", "", fname).strip()
            if re.fullmatch(r"(joint stock company|llc|pjsc|oao|jsc)", base, re.I) and note:
                base, note = note, ""
            hit = next(((fid_, t_, n_) for rx, fid_, t_, n_ in fe_re if rx.search(base)), None)
            if hit and hit[0] is None:
                continue
            fm = match_client(base)
            if hit:
                feid, fetype, fename = hit
            elif fm:
                feid, fetype, fename = fm[0], "company", fm[1]
            else:
                feid, fetype, fename = "co:" + slug(base), "company", base.title()
            if feid == cid:
                continue
            node(feid, fetype, fename, country=fe.get("country") or "", group=grp,
                 role="named as a foreign entity on a US lobbying filing")
            fe_e = edge(feid, cid, "foreign_entity_of", r, text=note)
            if fe.get("ownership_percentage"):
                fe_e["ownership_pct"] = fe["ownership_percentage"]
        for act in r.get("lobbying_activities") or []:
            desc = (act.get("description") or "").strip()
            for b in set(BILL_RE.findall(desc)):
                bid = "bill:" + re.sub(r"[^a-z0-9]", "", b.lower().replace("executive order", "eo"))
                if bid not in KEY_BILLS and not BILL_KEEP.search(desc):
                    continue
                label = re.sub(r"^(ExecutiveOrder|E\.?O\.?)", "EO ", re.sub(r"\s+", "", b))
                node(bid, "bill", label, title=KEY_BILLS.get(bid, ""))
                edge(fid, bid, "lobbied_on", r, client=cid, text=desc)
            for ge in act.get("government_entities") or []:
                gname = ge.get("name") if isinstance(ge, dict) else str(ge)
                for rx, gid, gdisp in GOV_RE:
                    if gname and rx.search(gname):
                        node(gid, "government", gdisp)
                        edge(fid, gid, "lobbied", r, client=cid, text=desc)
                        break
            if desc:
                hired["texts"].add(desc[:220])
            for entry in act.get("lobbyists") or []:
                p = entry.get("lobbyist") if isinstance(entry, dict) else None
                if not p:
                    continue
                pn = person_name(p)
                if not pn or normalize_name(pn) in excluded:
                    continue
                pid = "p:" + slug(pn)
                cov = (entry.get("covered_position") or "").strip()
                pnode = node(pid, "person", pn, role="lobbyist (named in US lobbying disclosure)")
                if cov and not ROLE_WORDS.search(cov) and not re.search(r"white house|treasury|commerce|potus|nsc|ustr", cov, re.I):
                    cov = ""
                if cov and re.search(r"\bintern", cov, re.I) and not re.search(r"chief|director|counsel|assist|asst|staff|secretary|advis|aide|correspondent|member", cov, re.I):
                    cov = ""
                if cov and cov.lower() not in ("n/a", "na", "none"):
                    pnode.setdefault("covered_positions", [])
                    if cov not in pnode["covered_positions"]:
                        pnode["covered_positions"].append(cov)
                    for rx, gid, gdisp in POST_RE:
                        if rx.search(cov):
                            node(gid, "government", gdisp)
                            edge(pid, gid, "formerly_served_in", r, text=cov)
                            break
                edge(pid, fid, "lobbyist_at", r)
                edge(pid, cid, "lobbied_for", r)

    # Keep a bill only if it is a key bill or at least 3 filings name it.
    bill_filings: dict[str, set] = defaultdict(set)
    for (s, t, typ, _c), e in agg.items():
        if typ == "lobbied_on":
            bill_filings[t].update(e["filings"])
    drop = {n["id"] for n in nodes.values() if n["type"] == "bill" and n["id"] not in KEY_BILLS and len(bill_filings[n["id"]]) < 3}
    for b in drop:
        nodes.pop(b, None)

    edges = []
    for (s, t, typ, _c), e in agg.items():
        if t in drop:
            continue
        yrs = sorted(e.pop("years"))
        e["years"] = [yrs[0], yrs[-1]] if yrs else []
        e["texts"] = sorted(e["texts"])[:4]
        e["n_filings"] = len(e["filings"])
        e["source_url"] = FILING_URL % e["filings"][0]
        e["dataset"] = "US lobbying disclosures (LDA)"
        if not e["amount"]:
            e.pop("amount")
        edges.append(e)
    return {"nodes": list(nodes.values()), "edges": edges, "filings_kept": kept, "filings_scanned": len(filings)}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `.venv/bin/python -m pytest -q scripts`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add data/lobbying-clients.json data/lobbying-bridges.json scripts/lobbying.py scripts/test_lobbying.py scripts/fixtures/lda_nord_stream_2.json
git commit -m "feat: LDA lobbying fetch and extraction, ported from the VeilTrace knowledge graph"
```

---

### Task 3: Nightly lobbying builder

**Files:**
- Create: `scripts/build_lobbying.py`, `scripts/test_build_lobbying.py`
- Create (generated): `data/lobbying-meta.json`

**Interfaces:**
- Consumes: `build_asset` (Task 1); `lobbying.load_config`, `fetch_filings`, `extract`, `get_json` (Task 2); `data/lobbying-clients.json`, `data/lobbying-bridges.json`.
- Produces:
  - `build_lobbying.build(get=lobbying.get_json, sleep=time.sleep, asset_path=ASSET, meta_path=META, now=None) -> int`
  - the asset `{"updated_at", "nodes", "edges", "filings_kept", "filings_scanned", "bridges": {"links": [...], "no_lobbying_found": [...]}, "exclude_lobbyists": [...]}` (the exclusion list travels with the data so the API can enforce it too)
  - `ASSET = build/lobbying.json.gz`

- [ ] **Step 1: Write the failing tests**

`scripts/test_build_lobbying.py`:
```python
import gzip
import json
from pathlib import Path

import build_lobbying as b

FIX = json.loads((Path(__file__).parent / "fixtures" / "lda_nord_stream_2.json").read_text(encoding="utf-8"))
NOW = "2026-10-14T04:00:00Z"


def fake_get(url):
    # Every query returns the same Nord Stream 2 page with no next link.
    return {**FIX, "next": None}


def no_sleep(seconds):
    pass


def test_fresh_build(tmp_path):
    asset, meta = tmp_path / "l.json.gz", tmp_path / "m.json"
    assert b.build(fake_get, no_sleep, asset, meta, NOW) == 0
    doc = json.loads(gzip.decompress(asset.read_bytes()))
    assert any(e["type"] in ("hired", "lobbied_in_house") and e["source"] == "co:nord-stream-2" for e in doc["edges"])
    assert len(doc["bridges"]["links"]) == 18
    assert "Sovcomflot" in doc["bridges"]["no_lobbying_found"]
    assert doc["exclude_lobbyists"] == []
    m = json.loads(meta.read_text())
    assert m["status"] == "fresh" and m["record_count"] == doc["filings_kept"]


def test_fetch_failure_keeps_previous(tmp_path):
    asset, meta = tmp_path / "l.json.gz", tmp_path / "m.json"

    def broken(url):
        raise RuntimeError("giving up on " + url)

    assert b.build(broken, no_sleep, asset, meta, NOW) == 1
    assert not asset.exists()
    assert "giving up" in json.loads(meta.read_text())["error"]


def test_shrink_rejected(tmp_path):
    asset, meta = tmp_path / "l.json.gz", tmp_path / "m.json"
    meta.write_text(json.dumps({"record_count": 100000}))
    assert b.build(fake_get, no_sleep, asset, meta, NOW) == 1
    assert "shrank" in json.loads(meta.read_text())["error"]


def test_missing_sample_rejected(tmp_path):
    asset, meta = tmp_path / "l.json.gz", tmp_path / "m.json"

    def other_client(url):
        page = json.loads(json.dumps(FIX))
        for r in page["results"]:
            r["client"]["name"] = "HUAWEI TECHNOLOGIES USA"
        return {**page, "next": None}

    assert b.build(other_client, no_sleep, asset, meta, NOW) == 1
    assert "sample" in json.loads(meta.read_text())["error"]
```

- [ ] **Step 2: Run to verify it fails**

Run: `.venv/bin/python -m pytest -q scripts/test_build_lobbying.py`
Expected: FAIL, `ModuleNotFoundError: No module named 'build_lobbying'`.

- [ ] **Step 3: Implement `scripts/build_lobbying.py`**

```python
"""Nightly: pull US lobbying filings for the tracked clients and write the lobbying asset.

Writes build/lobbying.json.gz (uploaded to the data-latest release by the workflow) and
data/lobbying-meta.json (committed). Exits 1 and leaves the asset unwritten when the pull
fails, the number of filings kept falls more than 20% below the last good build, or Nord
Stream 2 no longer has a lobbying link.
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import lobbying
from asset_build import build_asset

ROOT = Path(__file__).resolve().parent.parent
CONFIG = ROOT / "data" / "lobbying-clients.json"
BRIDGES = ROOT / "data" / "lobbying-bridges.json"
ASSET = ROOT / "build" / "lobbying.json.gz"
META = ROOT / "data" / "lobbying-meta.json"
PAGE_URL = "https://lda.gov/"
SAMPLE = "Nord Stream 2 AG has a lobbying firm"


def produce(get, sleep) -> dict:
    config = lobbying.load_config(CONFIG)
    filings = lobbying.fetch_filings(config["queries"], get=get, sleep=sleep)
    out = lobbying.extract(filings, config)
    bridges = json.loads(BRIDGES.read_text(encoding="utf-8"))
    out["bridges"] = {"links": bridges["links"], "no_lobbying_found": bridges["no_lobbying_found"]}
    out["exclude_lobbyists"] = config["exclude_lobbyists"]
    return out


def has_nord_stream_firm(asset: dict) -> bool:
    return any(e["type"] in ("hired", "lobbied_in_house") and e["source"] == "co:nord-stream-2" for e in asset["edges"])


def build(get=lobbying.get_json, sleep=time.sleep, asset_path: Path = ASSET, meta_path: Path = META, now: str | None = None) -> int:
    return build_asset(
        label="US lobbying (LDA)", page_url=PAGE_URL, produce=lambda: produce(get, sleep),
        count=lambda a: a["filings_kept"], sample_ok=has_nord_stream_firm, sample_name=SAMPLE,
        asset_path=asset_path, meta_path=meta_path, now=now,
    )


if __name__ == "__main__":
    sys.exit(build())
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `.venv/bin/python -m pytest -q scripts`
Expected: all pass.

- [ ] **Step 5: Run the real builder once (network, a few minutes) and keep the meta baseline**

Run: `time .venv/bin/python scripts/build_lobbying.py && ls -la build/lobbying.json.gz && cat data/lobbying-meta.json`
Expected: `US lobbying (LDA): fresh (N)` with N about 1,500, a file of a few hundred KB, and the run time. Report the time and size. If the API is unreachable, report BLOCKED with the error; do not commit a `kept-previous` meta as the baseline.

- [ ] **Step 6: Commit**

```bash
git add scripts/build_lobbying.py scripts/test_build_lobbying.py data/lobbying-meta.json
git commit -m "feat: nightly lobbying asset builder"
```

---

### Task 4: Nightly workflow steps

**Files:**
- Modify: `.github/workflows/update-lists.yml`

**Interfaces:**
- Consumes: `scripts/build_connections.py`, `scripts/build_lobbying.py` (Tasks 1, 3); release `data-latest` (exists).
- Produces: release assets `connections.json.gz` and `lobbying.json.gz`; committed `data/connections-meta.json` and `data/lobbying-meta.json`.

- [ ] **Step 1: Add the steps**

Directly after the existing "Upload OpenSanctions index" step, insert:
```yaml
      - name: Build connections
        id: cxbuild
        timeout-minutes: 20
        continue-on-error: true
        run: python scripts/build_connections.py

      - name: Upload connections
        id: cxupload
        if: steps.cxbuild.outcome == 'success'
        continue-on-error: true
        env:
          GH_TOKEN: ${{ github.token }}
        run: gh release upload data-latest build/connections.json.gz --clobber

      - name: Build lobbying
        id: lobbuild
        timeout-minutes: 20
        continue-on-error: true
        run: python scripts/build_lobbying.py

      - name: Upload lobbying
        id: lobupload
        if: steps.lobbuild.outcome == 'success'
        continue-on-error: true
        env:
          GH_TOKEN: ${{ github.token }}
        run: gh release upload data-latest build/lobbying.json.gz --clobber
```

In "Commit changes", change the `git add` line to:
```yaml
          git add data/lists data/opensanctions-meta.json data/connections-meta.json data/lobbying-meta.json
```

In "Open or update the failure issue":
- the `if:` line becomes
```yaml
        if: steps.build.outcome == 'failure' || steps.osbuild.outcome == 'failure' || steps.osupload.outcome == 'failure' || steps.cxbuild.outcome == 'failure' || steps.cxupload.outcome == 'failure' || steps.lobbuild.outcome == 'failure' || steps.lobupload.outcome == 'failure' || failure()
```
- the `up=` line becomes
```bash
          up=""
          [ "${{ steps.osupload.outcome }}" = "failure" ] && up="${up}, opensanctions upload"
          [ "${{ steps.cxbuild.outcome }}" = "failure" ] && up="${up}, connections"
          [ "${{ steps.cxupload.outcome }}" = "failure" ] && up="${up}, connections upload"
          [ "${{ steps.lobbuild.outcome }}" = "failure" ] && up="${up}, lobbying"
          [ "${{ steps.lobupload.outcome }}" = "failure" ] && up="${up}, lobbying upload"
```
- the body sentence ending "Details in data/lists/meta.json and data/opensanctions-meta.json." becomes "Details in data/lists/meta.json, data/opensanctions-meta.json, data/connections-meta.json and data/lobbying-meta.json."

- [ ] **Step 2: Verify**

Run: `ruby -ryaml -e 'y = YAML.load_file(".github/workflows/update-lists.yml"); steps = y["jobs"]["update"]["steps"].map { |s| s["name"] }; puts steps; puts "yaml ok"'`
Expected: the step list includes Build connections, Upload connections, Build lobbying and Upload lobbying after "Upload OpenSanctions index", then "yaml ok".

Also run: `grep -n "timeout-minutes: 30" .github/workflows/update-lists.yml`. If the job timeout is 30, raise it to 60, because the job now runs four builders.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/update-lists.yml
git commit -m "ci: build and upload connections and lobbying assets nightly"
```

---

### Task 5: Shared asset loader and `/api/connections`

**Files:**
- Create: `api/_asset.js`, `api/connections.js`, `tests/connections.test.js`
- Modify: `api/search.js` (use `api/_asset.js`; behaviour unchanged)

**Interfaces:**
- Consumes: `normalizeName`, `parseImo` (`app/normalize.js`); asset shapes from Tasks 1 and 3.
- Produces:
  - `createAssetLoader(url, transform) -> { load(fetchFn = fetch, now = Date.now()), reset() }`
  - `api/connections.js` exports:
    - `CONNECTIONS_URL`, `LOBBYING_URL`, `GROUP_CAP = 20`, `LINK_CAP = 20`
    - `buildGraph(doc)`, `buildLobby(doc)`, `resolve(graph, {imo, name})`
    - `sanctionsFor(graph, {imo, name})`, `lobbyingFor(lobby, ...names)`
    - `resetConnectionsCache()`, `GET(request)`
  - Response shape (consumed by Task 6):
```
{ query,
  sanctions: { available: true, matched: false }
           | { available: false }
           | { available: true, matched: true,
               focus: {name, schema, imo, authorities}, others: N, linksMore: N,
               links: [{ name, schema, role, direction: "out"|"in", authorities,
                         groups: [{ schema, items: [{name, schema, role, direction, authorities}], more }] }] },
  lobbying:  { available: false }
           | { available: true, matched: false, checked_no_filings: bool }
           | { available: true, matched: true, client, as_of, checked_no_filings,
               firms: [{name, filings, fees_usd|null, sub_fees_usd|null, subcontract, years, url}],
               lobbyists: [{name, firm, former_posts, former_bodies}],
               bodies: [{name, filings}], bills: [{label, title, filings}],
               parents: [{name, note, ownership_pct, url}],
               bridges: [{from, relation, to, grade, date, source_url}] },
  attribution }
```
  `direction: "out"` means "focus role neighbour"; `"in"` means "neighbour role focus". The same holds for group items relative to their parent link's neighbour.

- [ ] **Step 1: Write the failing tests**

`tests/connections.test.js`:
```js
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { createAssetLoader } from "../api/_asset.js";
import {
  GET, buildGraph, buildLobby, resolve, sanctionsFor, lobbyingFor, resetConnectionsCache,
  CONNECTIONS_URL, LOBBYING_URL, GROUP_CAP,
} from "../api/connections.js";

const T = "NK-k837moN9ssPZedvkRUrexG";
const ships = Array.from({ length: 25 }, (_, i) => [`S${i}`, "Vessel", [`SHIP ${i}`], "", ["US"]]);
const graphDoc = {
  updated_at: "2026-10-14T04:00:00Z",
  entities: [
    [T, "Vessel", ["TASSOS", "Tassos"], "9408695", ["US", "UK"]],
    ["Z", "Organization", ["Zulu Ships Management"], "", ["US", "UK"]],
    ["H", "Person", ["Hossein Shamkhani"], "", ["US"]],
    ["R", "Person", ["Relative Of Hossein"], "", ["US"]],
    ["SOV1", "Company", ["SOVCOMFLOT"], "", ["US"]],
    ["SOV2", "Company", ["SOVCOMFLOT"], "", ["UK"]],
    ...ships,
  ],
  links: [
    [T, "Z", "Ownership", "Property in the interest of", ["US", "UK"]],
    ...ships.map(([id]) => [id, "Z", "Ownership", "Property in the interest of", ["US"]]),
    ["Z", "H", "UnknownLink", "Providing support to", ["US"]],
    ["H", "R", "Family", "Family member of", ["US"]],
    ["SOV2", "Z", "UnknownLink", "Linked to", ["UK"]],
  ],
};
const lobbyDoc = {
  updated_at: "2026-10-14T04:00:00Z",
  filings_kept: 3, filings_scanned: 3, exclude_lobbyists: ["Hidden Person"],
  nodes: [
    { id: "co:nord-stream-2", type: "company", name: "Nord Stream 2 AG", lda_names: ["NORD STREAM 2 AG"] },
    { id: "lf:capitol-counsel", type: "lobbyfirm", name: "Capitol Counsel LLC" },
    { id: "p:jane-example", type: "person", name: "Jane Example", covered_positions: ["Legislative Assistant, Sen. Smith"] },
    { id: "p:hidden-person", type: "person", name: "Hidden Person" },
    { id: "gov:us-senate", type: "government", name: "US Senate" },
    { id: "bill:s722", type: "bill", name: "S.722", title: "S.722 Countering Iran's Destabilizing Activities Act (2017)" },
    { id: "co:gazprom", type: "company", name: "Gazprom" },
  ],
  edges: [
    { source: "co:nord-stream-2", target: "lf:capitol-counsel", type: "hired", n_filings: 12, amount: 1230000, years: [2017, 2022], source_url: "https://lda.gov/filings/public/filing/u1/print/" },
    { source: "p:jane-example", target: "lf:capitol-counsel", type: "lobbyist_at", n_filings: 4, years: [2017, 2018], source_url: "https://lda.gov/x" },
    { source: "p:jane-example", target: "co:nord-stream-2", type: "lobbied_for", n_filings: 4, years: [2017, 2018], source_url: "https://lda.gov/x" },
    { source: "p:hidden-person", target: "co:nord-stream-2", type: "lobbied_for", n_filings: 1, years: [2018, 2018], source_url: "https://lda.gov/x" },
    { source: "p:jane-example", target: "gov:us-senate", type: "formerly_served_in", n_filings: 4, years: [2017, 2018], source_url: "https://lda.gov/x" },
    { source: "lf:capitol-counsel", target: "gov:us-senate", type: "lobbied", client: "co:nord-stream-2", n_filings: 9, years: [2017, 2022], source_url: "https://lda.gov/x" },
    { source: "lf:capitol-counsel", target: "bill:s722", type: "lobbied_on", client: "co:nord-stream-2", n_filings: 5, years: [2017, 2018], source_url: "https://lda.gov/x" },
    { source: "co:gazprom", target: "co:nord-stream-2", type: "foreign_entity_of", n_filings: 3, texts: ["50% of NS2 operating budget"], ownership_pct: "50", years: [2017, 2019], source_url: "https://lda.gov/y" },
  ],
  bridges: {
    links: [{ from: "Gazprom", relation: "owns", to: "Gazprom Neft", grade: "documented", date: "2014-09-12", source_url: "https://home.treasury.gov/news/press-releases/jl2629" }],
    no_lobbying_found: ["Sovcomflot", "Zulu Ships Management"],
  },
};

const realFetch = globalThis.fetch;
let calls;
function serve({ graph = graphDoc, lobby = lobbyDoc, failGraph = false, failLobby = false } = {}) {
  globalThis.fetch = async (url) => {
    calls.push(url);
    if (url === CONNECTIONS_URL) return failGraph ? new Response("no", { status: 404 }) : new Response(gzipSync(JSON.stringify(graph)));
    if (url === LOBBYING_URL) return failLobby ? new Response("no", { status: 404 }) : new Response(gzipSync(JSON.stringify(lobby)));
    throw new Error("unexpected " + url);
  };
}
const get = (qs) => GET(new Request(`https://undercurrent.test/api/connections?${qs}`));

beforeEach(() => { calls = []; resetConnectionsCache(); });
afterEach(() => { globalThis.fetch = realFetch; });

test("asset loader: shared fetch, refresh, stale on failure with backoff", async () => {
  let n = 0;
  const ok = async () => { n++; return new Response(gzipSync('{"v":1}')); };
  const bad = async () => { n++; return new Response("x", { status: 500 }); };
  const loader = createAssetLoader("https://x/a.gz", (doc) => doc.v);
  assert.deepEqual(await Promise.all([loader.load(ok, 0), loader.load(ok, 0)]), [1, 1]);
  assert.equal(n, 1);
  assert.equal(await loader.load(bad, 13 * 3600e3), 1);
  assert.equal(n, 2);
  assert.equal(await loader.load(bad, 13 * 3600e3 + 60e3), 1);
  assert.equal(n, 2);
  loader.reset();
  await assert.rejects(loader.load(bad, 0));
});

test("bad queries are rejected without loading data", async () => {
  serve();
  for (const qs of ["", "name=", "imo=123", "name=" + "x".repeat(201)]) assert.equal((await get(qs)).status, 400);
  assert.equal(calls.length, 0);
});

test("TASSOS by IMO: Zulu with its other ships capped, and the person it supports", async () => {
  const s = sanctionsFor(buildGraph(graphDoc), { imo: "9408695" });
  assert.equal(s.matched, true);
  assert.deepEqual(s.focus, { name: "TASSOS", schema: "Vessel", imo: "9408695", authorities: ["US", "UK"] });
  const [zulu] = s.links;
  assert.equal(zulu.name, "Zulu Ships Management");
  assert.equal(zulu.direction, "out");
  assert.equal(zulu.role, "Property in the interest of");
  const vessels = zulu.groups.find((g) => g.schema === "Vessel");
  assert.equal(vessels.items.length, GROUP_CAP);
  assert.equal(vessels.more, 5);
  assert.ok(vessels.items.every((i) => i.name !== "TASSOS" && i.direction === "in"));
  const people = zulu.groups.find((g) => g.schema === "Person");
  assert.deepEqual(people.items.map((i) => [i.name, i.direction, i.role]), [["Hossein Shamkhani", "out", "Providing support to"]]);
});

test("no expansion from a person", () => {
  const s = sanctionsFor(buildGraph(graphDoc), { name: "Zulu Ships Management" });
  const hossein = s.links.find((l) => l.name === "Hossein Shamkhani");
  assert.deepEqual(hossein.groups, []);
});

test("shared names pick the best-linked entry and report the others", () => {
  const g = buildGraph(graphDoc);
  assert.deepEqual(resolve(g, { name: "sovcomflot" }), { id: "SOV2", others: 1 });
  assert.deepEqual(resolve(g, { name: "Nobody At All" }), null);
});

test("unknown names are matched: false, never fuzzy", () => {
  assert.deepEqual(sanctionsFor(buildGraph(graphDoc), { name: "TASSO" }), { available: true, matched: false });
});

test("lobbying view for Nord Stream 2", () => {
  const l = lobbyingFor(buildLobby(lobbyDoc), "Nord Stream 2 AG");
  assert.equal(l.matched, true);
  assert.equal(l.client, "Nord Stream 2 AG");
  assert.deepEqual(l.firms, [{ name: "Capitol Counsel LLC", filings: 12, fees_usd: 1230000, sub_fees_usd: null, subcontract: false, years: [2017, 2022], url: "https://lda.gov/filings/public/filing/u1/print/" }]);
  assert.deepEqual(l.lobbyists, [{ name: "Jane Example", firm: "Capitol Counsel LLC", former_posts: ["Legislative Assistant, Sen. Smith"], former_bodies: ["US Senate"] }]);
  assert.deepEqual(l.bodies, [{ name: "US Senate", filings: 9 }]);
  assert.deepEqual(l.bills.map((b) => b.label), ["S.722"]);
  assert.deepEqual(l.parents, [{ name: "Gazprom", note: "50% of NS2 operating budget", ownership_pct: "50", url: "https://lda.gov/y" }]);
  assert.equal(l.bridges.length, 1);
  assert.equal(l.checked_no_filings, false);
});

test("lobbying: checked-no-filings list and untracked names", () => {
  const lob = buildLobby(lobbyDoc);
  assert.deepEqual(lobbyingFor(lob, "SOVCOMFLOT"), { available: true, matched: false, checked_no_filings: true });
  assert.deepEqual(lobbyingFor(lob, "Acme Widgets"), { available: true, matched: false, checked_no_filings: false });
});

test("GET: each asset fails alone, and a full answer is cached", async () => {
  serve({ failLobby: true });
  let res = await get("imo=9408695");
  let body = await res.json();
  assert.equal(body.sanctions.matched, true);
  assert.deepEqual(body.lobbying, { available: false });
  assert.equal(res.headers.get("cache-control"), "no-store");
  resetConnectionsCache();
  serve({ failGraph: true });
  body = await (await get("name=Nord%20Stream%202%20AG")).json();
  assert.deepEqual(body.sanctions, { available: false });
  assert.equal(body.lobbying.client, "Nord Stream 2 AG");
  resetConnectionsCache();
  serve();
  res = await get("imo=9408695");
  assert.equal(res.headers.get("cache-control"), "public, s-maxage=21600");
  body = await res.json();
  assert.match(body.attribution, /OpenSanctions/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL, cannot find `api/_asset.js`.

- [ ] **Step 3: Implement `api/_asset.js`**

```js
// Shared loader for gzipped JSON assets on the data-latest release: one fetch at a time,
// cached for 12 hours, a failed refresh keeps serving the last good copy and retries after 10 minutes.
import { gunzipSync } from "node:zlib";

const REFRESH_MS = 12 * 60 * 60 * 1000;
const RETRY_MS = 10 * 60 * 1000;
const LOAD_TIMEOUT_MS = 4000;

export function createAssetLoader(url, transform) {
  let cached = null; // { loadedAt, value }
  let pending = null;

  async function fetchAsset(fetchFn, now) {
    const res = await fetchFn(url, { signal: AbortSignal.timeout(LOAD_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`asset HTTP ${res.status}`);
    const doc = JSON.parse(gunzipSync(Buffer.from(await res.arrayBuffer())).toString("utf8"));
    const value = transform(doc);
    cached = { loadedAt: now, value };
    return value;
  }

  async function load(fetchFn = fetch, now = Date.now()) {
    if (cached && now - cached.loadedAt < REFRESH_MS) return cached.value;
    if (!pending) pending = fetchAsset(fetchFn, now).finally(() => { pending = null; });
    try {
      return await pending;
    } catch (err) {
      if (cached) {
        cached.loadedAt = now - REFRESH_MS + RETRY_MS;
        return cached.value;
      }
      throw err;
    }
  }

  return { load, reset() { cached = null; pending = null; } };
}
```

Refactor `api/search.js`. Keep `INDEX_URL`, `searchIndex`, `GET`, `json` and the exports `loadIndex` and `resetIndexCache` with the same signatures. Replace the module-level `cached`/`pending`, `fetchIndex` and the body of `loadIndex` with:
```js
import { createAssetLoader } from "./_asset.js";

const index = createAssetLoader(INDEX_URL, (doc) => {
  if (!Array.isArray(doc.entities)) throw new Error("index has no entities");
  return doc.entities.map(([id, schema, imo, by, names]) => ({ id, schema, imo, by, names, keys: names.map(normalizeName) }));
});

export function resetIndexCache() {
  index.reset();
}

export function loadIndex(fetchFn = fetch, now = Date.now()) {
  return index.load(fetchFn, now);
}
```
Remove the now-unused `gunzipSync` import and the `REFRESH_MS`, `LOAD_TIMEOUT_MS` and `RETRY_MS` constants from `api/search.js`. The existing `tests/api.test.js` must pass unchanged.

- [ ] **Step 4: Implement `api/connections.js`**

```js
// Connections for one entity: sanctions links rebuilt nightly from the official lists via
// OpenSanctions (CC BY-NC 4.0), and US lobbying from LDA filings. Exact matching only.
// Never returns an error page: a section whose data cannot load answers {available:false}.
import { createAssetLoader } from "./_asset.js";
import { normalizeName, parseImo } from "../app/normalize.js";

const RELEASE = "https://github.com/Ttheegela/undercurrent/releases/download/data-latest/";
export const CONNECTIONS_URL = `${RELEASE}connections.json.gz`;
export const LOBBYING_URL = `${RELEASE}lobbying.json.gz`;
export const GROUP_CAP = 20;
export const LINK_CAP = 20;
const LOBBYIST_CAP = 50;
const EXPANDABLE = new Set(["Organization", "Company", "LegalEntity"]);
const ATTRIBUTION = "Sanctions links: official sanctions lists compiled by OpenSanctions (CC BY-NC 4.0). Lobbying: US Lobbying Disclosure Act filings (lda.gov).";

function addTo(map, key, value) {
  if (!key) return;
  if (!map.has(key)) map.set(key, new Set());
  map.get(key).add(value);
}

export function buildGraph(doc) {
  if (!Array.isArray(doc.entities) || !Array.isArray(doc.links)) throw new Error("connections asset has no entities or links");
  const byId = new Map();
  const byImo = new Map();
  const byName = new Map();
  const adj = new Map();
  for (const [id, schema, names, imo, authorities] of doc.entities) {
    byId.set(id, { id, schema, name: names[0], imo, authorities });
    addTo(byImo, imo, id);
    for (const n of names) addTo(byName, normalizeName(n), id);
  }
  for (const [s, o, kind, role, authorities] of doc.links) {
    const link = { s, o, kind, role, authorities };
    for (const id of [s, o]) {
      if (!adj.has(id)) adj.set(id, []);
      adj.get(id).push(link);
    }
  }
  return { byId, byImo, byName, adj, updatedAt: doc.updated_at };
}

export function resolve(graph, { imo, name }) {
  const pool = imo ? graph.byImo.get(imo) : graph.byName.get(normalizeName(name || ""));
  if (!pool || !pool.size) return null;
  const degree = (id) => (graph.adj.get(id) || []).length;
  const ids = [...pool].sort((a, b) => degree(b) - degree(a) || a.localeCompare(b));
  return { id: ids[0], others: ids.length - 1 };
}

function neighbour(graph, link, fromId) {
  const out = link.s === fromId;
  const other = graph.byId.get(out ? link.o : link.s);
  return { id: other.id, name: other.name, schema: other.schema, role: link.role, direction: out ? "out" : "in", authorities: link.authorities };
}

function groupsFor(graph, n, focusId) {
  if (!EXPANDABLE.has(n.schema)) return [];
  const bySchema = new Map();
  for (const link of graph.adj.get(n.id) || []) {
    const m = neighbour(graph, link, n.id);
    if (m.id === focusId) continue;
    if (!bySchema.has(m.schema)) bySchema.set(m.schema, []);
    bySchema.get(m.schema).push(m);
  }
  return [...bySchema.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .map(([schema, items]) => ({
      schema,
      items: items.slice(0, GROUP_CAP).map(({ name, schema: s, role, direction, authorities }) => ({ name, schema: s, role, direction, authorities })),
      more: Math.max(0, items.length - GROUP_CAP),
    }));
}

export function sanctionsFor(graph, query) {
  const hit = resolve(graph, query);
  if (!hit) return { available: true, matched: false };
  const focus = graph.byId.get(hit.id);
  const direct = (graph.adj.get(hit.id) || []).map((link) => neighbour(graph, link, hit.id));
  const links = direct.slice(0, LINK_CAP).map((n) => ({
    name: n.name, schema: n.schema, role: n.role, direction: n.direction, authorities: n.authorities,
    groups: groupsFor(graph, n, hit.id),
  }));
  return {
    available: true, matched: true,
    focus: { name: focus.name, schema: focus.schema, imo: focus.imo, authorities: focus.authorities },
    others: hit.others, links, linksMore: Math.max(0, direct.length - LINK_CAP),
  };
}

export function buildLobby(doc) {
  if (!Array.isArray(doc.nodes) || !Array.isArray(doc.edges)) throw new Error("lobbying asset has no nodes or edges");
  const nodes = new Map(doc.nodes.map((n) => [n.id, n]));
  const byName = new Map();
  for (const n of doc.nodes) {
    if (!["company", "association", "person"].includes(n.type)) continue;
    for (const name of [n.name, ...(n.lda_names || [])]) addTo(byName, normalizeName(name), n.id);
  }
  const from = new Map();
  const to = new Map();
  for (const e of doc.edges) {
    if (!from.has(e.source)) from.set(e.source, []);
    from.get(e.source).push(e);
    if (!to.has(e.target)) to.set(e.target, []);
    to.get(e.target).push(e);
  }
  const bridges = doc.bridges || { links: [], no_lobbying_found: [] };
  return {
    nodes, byName, from, to, asOf: (doc.updated_at || "").slice(0, 10),
    bridges: bridges.links || [],
    noLobbying: new Set((bridges.no_lobbying_found || []).map(normalizeName)),
    excluded: new Set((doc.exclude_lobbyists || []).map(normalizeName)),
  };
}

const firmEdge = (e) => e.type === "hired" || e.type === "lobbied_in_house";

export function lobbyingFor(lob, ...names) {
  const keys = names.filter(Boolean).map(normalizeName).filter(Boolean);
  const ids = new Set(keys.flatMap((k) => [...(lob.byName.get(k) || [])]));
  const hiredCount = (id) => (lob.from.get(id) || []).filter(firmEdge).length;
  const clientId = [...ids].sort((a, b) => hiredCount(b) - hiredCount(a) || a.localeCompare(b))[0];
  const checked = keys.some((k) => lob.noLobbying.has(k));
  if (!clientId) return { available: true, matched: false, checked_no_filings: checked };
  const node = (id) => lob.nodes.get(id) || { name: id };
  const out = lob.from.get(clientId) || [];
  const inc = lob.to.get(clientId) || [];
  const firms = out.filter(firmEdge).sort((a, b) => b.n_filings - a.n_filings).map((e) => ({
    name: e.target === clientId ? `${node(clientId).name} (in-house)` : node(e.target).name,
    filings: e.n_filings, fees_usd: e.amount ?? null, sub_fees_usd: e.sub_amount ?? null,
    subcontract: Boolean(e.subcontract), years: e.years || [], url: e.source_url,
  }));
  const firmIds = new Set(out.filter(firmEdge).map((e) => e.target));
  const lobbyists = inc
    .filter((e) => e.type === "lobbied_for")
    .map((e) => node(e.source))
    .filter((p) => !lob.excluded.has(normalizeName(p.name)))
    .slice(0, LOBBYIST_CAP)
    .map((p) => {
      const pOut = lob.from.get(p.id) || [];
      const firm = pOut.find((e) => e.type === "lobbyist_at" && firmIds.has(e.target));
      return {
        name: p.name,
        firm: firm ? node(firm.target).name : "",
        former_posts: p.covered_positions || [],
        former_bodies: pOut.filter((e) => e.type === "formerly_served_in").map((e) => node(e.target).name),
      };
    });
  const scoped = (type) => [...firmIds].flatMap((f) => (lob.from.get(f) || []).filter((e) => e.type === type && e.client === clientId));
  const bodies = scoped("lobbied").map((e) => ({ name: node(e.target).name, filings: e.n_filings })).sort((a, b) => b.filings - a.filings);
  const bills = scoped("lobbied_on").map((e) => ({ label: node(e.target).name, title: node(e.target).title || "", filings: e.n_filings })).sort((a, b) => b.filings - a.filings);
  const parents = inc.filter((e) => e.type === "foreign_entity_of").map((e) => ({
    name: node(e.source).name, note: (e.texts || [])[0] || "", ownership_pct: e.ownership_pct || "", url: e.source_url,
  }));
  const clientKeys = new Set([normalizeName(node(clientId).name), ...keys]);
  const bridges = lob.bridges
    .filter((b) => clientKeys.has(normalizeName(b.from)) || clientKeys.has(normalizeName(b.to)))
    .map(({ from, relation, to, grade, date, source_url }) => ({ from, relation, to, grade, date, source_url }));
  return {
    available: true, matched: true, client: node(clientId).name, as_of: lob.asOf,
    checked_no_filings: firms.length === 0,
    firms, lobbyists, bodies, bills, parents, bridges,
  };
}

const graphAsset = createAssetLoader(CONNECTIONS_URL, buildGraph);
const lobbyAsset = createAssetLoader(LOBBYING_URL, buildLobby);

export function resetConnectionsCache() {
  graphAsset.reset();
  lobbyAsset.reset();
}

function json(body, { status = 200, cache = false } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": cache ? "public, s-maxage=21600" : "no-store" },
  });
}

export async function GET(request) {
  const params = new URL(request.url).searchParams;
  const rawImo = (params.get("imo") || "").trim();
  const imo = rawImo ? parseImo(rawImo) : null;
  const name = (params.get("name") || "").trim();
  if ((rawImo && !imo) || (!imo && !name) || name.length > 200) return json({ error: "bad query" }, { status: 400 });
  const [graph, lobby] = await Promise.allSettled([graphAsset.load(), lobbyAsset.load()]);
  const sanctions = graph.status === "fulfilled" ? sanctionsFor(graph.value, { imo, name }) : { available: false };
  const lobbying = lobby.status === "fulfilled" ? lobbyingFor(lobby.value, name, sanctions.focus?.name) : { available: false };
  const complete = sanctions.available && lobbying.available;
  return json({ query: imo || name, sanctions, lobbying, attribution: ATTRIBUTION }, { cache: complete });
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test`
Expected: all pass, including the unchanged `tests/api.test.js`.

- [ ] **Step 6: Measure memory and cold load on the real assets**

```bash
node --input-type=module -e "
import { readFileSync } from 'node:fs';
import { buildGraph, buildLobby, sanctionsFor, lobbyingFor } from './api/connections.js';
import { gunzipSync } from 'node:zlib';
const t0 = performance.now();
const g = buildGraph(JSON.parse(gunzipSync(readFileSync('build/connections.json.gz'))));
const l = buildLobby(JSON.parse(gunzipSync(readFileSync('build/lobbying.json.gz'))));
const t1 = performance.now();
const s = sanctionsFor(g, { imo: '9408695' });
console.log('load ms', Math.round(t1 - t0), 'rss MB', Math.round(process.memoryUsage().rss / 1e6));
console.log(s.links.map((x) => x.name), JSON.stringify(lobbyingFor(l, 'Nord Stream 2 AG')).length, 'bytes lobbying');
"
```
Report the numbers. If `build/` lacks either asset, run the Task 1 Step 6 and Task 3 Step 5 builders first.

- [ ] **Step 7: Commit**

```bash
git add api/_asset.js api/search.js api/connections.js tests/connections.test.js
git commit -m "feat: /api/connections with shared asset loader"
```

---

### Task 6: Connections panel rendering

**Files:**
- Create: `app/connections.js`, `tests/connections-render.test.js`

**Interfaces:**
- Consumes: `escapeHtml`, `safeUrl`, `joinAnd` (`app/render.js`); the response shape from Task 5.
- Produces:
  - `connectionsQuery(entry) -> string` (`"imo=9408695"` or `"name=<encoded>"`)
  - `sentence(focusName, link) -> string`
  - `layoutGraph(data) -> {width, height, boxes: [{x, y, w, h, kind, label, title, focus}], lines: [{x1, y1, x2, y2, label}]}`
  - `renderConnections(data) -> string`
  - `renderConnectionsLoading() -> string`
  - DOM hooks: `.conn`, `.conn-graph`, `button[data-search="<name>"]`, `button[data-retry="connections"]`

- [ ] **Step 1: Write the failing tests**

`tests/connections-render.test.js`:
```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { connectionsQuery, sentence, layoutGraph, renderConnections, renderConnectionsLoading } from "../app/connections.js";

const tassos = {
  sanctions: {
    available: true, matched: true, others: 0, linksMore: 0,
    focus: { name: "TASSOS", schema: "Vessel", imo: "9408695", authorities: ["US", "UK"] },
    links: [{
      name: "Zulu Ships Management", schema: "Organization", role: "Property in the interest of", direction: "out", authorities: ["US", "UK"],
      groups: [
        { schema: "Vessel", items: ["TAGOR", "NEMRUT", "MANASLU"].map((n) => ({ name: n, schema: "Vessel", role: "Property in the interest of", direction: "in", authorities: ["US", "UK"] })), more: 7 },
        { schema: "Person", items: [{ name: "Hossein Shamkhani", schema: "Person", role: "Providing support to", direction: "out", authorities: ["US"] }], more: 0 },
      ],
    }],
  },
  lobbying: { available: true, matched: false, checked_no_filings: true },
  attribution: "Sanctions links: official sanctions lists compiled by OpenSanctions (CC BY-NC 4.0).",
};

const ns2 = {
  sanctions: { available: true, matched: false },
  lobbying: {
    available: true, matched: true, client: "Nord Stream 2 AG", as_of: "2026-10-14", checked_no_filings: false,
    firms: [{ name: "Capitol Counsel LLC", filings: 12, fees_usd: 1230000, sub_fees_usd: null, subcontract: false, years: [2017, 2022], url: "https://lda.gov/filings/public/filing/u1/print/" }],
    lobbyists: [{ name: "Jane Example", firm: "Capitol Counsel LLC", former_posts: ["Legislative Assistant, Sen. Smith"], former_bodies: ["US Senate"] },
                { name: "John Sample", firm: "Capitol Counsel LLC", former_posts: [], former_bodies: [] }],
    bodies: [{ name: "US Senate", filings: 9 }],
    bills: [{ label: "S.722", title: "S.722 Countering Iran's Destabilizing Activities Act (2017)", filings: 5 }],
    parents: [{ name: "Gazprom", note: "50% of NS2 operating budget", ownership_pct: "50", url: "https://lda.gov/y" }],
    bridges: [{ from: "Gazprom", relation: "owns", to: "Gazprom Neft", grade: "documented", date: "2014-09-12", source_url: "https://home.treasury.gov/news/press-releases/jl2629" }],
  },
  attribution: "Lobbying: US Lobbying Disclosure Act filings (lda.gov).",
};

test("query string per entry", () => {
  assert.equal(connectionsQuery({ imo: "9408695", name: "TASSOS" }), "imo=9408695");
  assert.equal(connectionsQuery({ imo: null, name: "Nord Stream 2 AG" }), "name=Nord%20Stream%202%20AG");
});

test("sentences read in the list's direction", () => {
  assert.equal(sentence("TASSOS", tassos.sanctions.links[0]), "TASSOS property in the interest of Zulu Ships Management");
  assert.equal(sentence("Zulu Ships Management", { name: "TAGOR", role: "Property in the interest of", direction: "in" }), "TAGOR property in the interest of Zulu Ships Management");
});

test("layout: focus plus at most 8 sanctions boxes, collapsed groups, lobbying firms", () => {
  const many = { ...tassos, sanctions: { ...tassos.sanctions, links: Array.from({ length: 12 }, (_, i) => ({ ...tassos.sanctions.links[0], name: `Company ${i}` })) } };
  const g = layoutGraph(many);
  assert.ok(g.boxes.filter((b) => !b.focus && b.kind !== "firm").length <= 8);
  assert.ok(g.boxes.some((b) => b.focus && b.label === "TASSOS"));
  const one = layoutGraph(tassos);
  assert.ok(one.boxes.some((b) => b.label.includes("TAGOR") && b.kind === "group" && b.title.includes("+7")));
  const firms = layoutGraph({ ...ns2, sanctions: { available: true, matched: true, others: 0, linksMore: 0, focus: { name: "Nord Stream 2 AG", schema: "Company", imo: "", authorities: [] }, links: [] } });
  assert.ok(firms.boxes.some((b) => b.kind === "firm" && b.label === "Capitol Counsel LLC"));
});

test("TASSOS panel: graph, list with searchable names, more count, no-lobbying note", () => {
  const html = renderConnections(tassos);
  assert.match(html, /class="conn-graph"/);
  assert.match(html, /data-search="Zulu Ships Management"/);
  assert.match(html, /data-search="TAGOR"/);
  assert.match(html, /\+7 more/);
  assert.match(html, /US, UK/);
  assert.match(html, /No US lobbying filings found \(checked nightly\)/);
  assert.match(html, /not proof of no influence/);
});

test("Nord Stream 2 panel: firms, lobbyists with former posts, revolving door, bodies, bills, parents, bridges", () => {
  const html = renderConnections(ns2);
  assert.match(html, /Lobbying in Washington/);
  assert.match(html, /Capitol Counsel LLC/);
  assert.match(html, /12 filings/);
  assert.match(html, /\$1\.23M/);
  assert.match(html, /self-reported/);
  assert.match(html, /Jane Example/);
  assert.match(html, /Legislative Assistant, Sen\. Smith/);
  assert.match(html, /1 lobbyist previously served at the US Senate/);
  assert.match(html, /S\.722/);
  assert.match(html, /Gazprom/);
  assert.match(html, /home\.treasury\.gov/);
  assert.match(html, /No recorded connections on the sanctions lists/);
});

test("unavailable sections offer retry; untracked lobbying shows a coverage note", () => {
  const html = renderConnections({ sanctions: { available: false }, lobbying: { available: true, matched: false, checked_no_filings: false }, attribution: "" });
  assert.match(html, /Connections are unavailable right now/);
  assert.match(html, /data-retry="connections"/);
  assert.match(html, /Lobbying is tracked for a list of companies/);
  assert.match(renderConnectionsLoading(), /Loading connections/);
});

test("hostile names are escaped everywhere, long names truncated in boxes", () => {
  const evil = `<img src=x onerror=alert(1)>"'${"x".repeat(80)}`;
  const data = JSON.parse(JSON.stringify(tassos));
  data.sanctions.focus.name = evil;
  data.sanctions.links[0].name = evil;
  const html = renderConnections(data);
  assert.ok(!html.includes("<img"));
  assert.ok(!/data-search="[^"]*"[^ >]*"/.test(html));
  const g = layoutGraph(data);
  assert.ok(g.boxes.every((b) => b.label.length <= 26));
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: FAIL, cannot find `app/connections.js`.

- [ ] **Step 3: Implement `app/connections.js`**

```js
// Connections panel: who the sanctions lists link to an entity, and US lobbying around it.
// Pure functions returning HTML strings; every value from data is escaped.
import { escapeHtml, safeUrl, joinAnd } from "./render.js";

const MAX_SANCTION_BOXES = 8;
const MAX_FIRM_BOXES = 4;
const MAX_DIRECT_BOXES = 4;
const BOX = { w: 190, h: 52, gapY: 16 };
const COLS = [20, 290, 560];
const LABEL_MAX = 26;
const PLURAL = { Vessel: "ships", Person: "people", Company: "companies", Organization: "organisations", LegalEntity: "entities", Airplane: "aircraft" };
const NO_PROOF = "No filing found is not proof of no influence.";

export function connectionsQuery(entry) {
  return entry.imo ? `imo=${entry.imo}` : `name=${encodeURIComponent(entry.name)}`;
}

export function sentence(focusName, link) {
  const role = link.role.charAt(0).toLowerCase() + link.role.slice(1);
  return link.direction === "out" ? `${focusName} ${role} ${link.name}` : `${link.name} ${role} ${focusName}`;
}

function clip(text) {
  return text.length > LABEL_MAX ? `${text.slice(0, LABEL_MAX - 1)}…` : text;
}

const fmtMoney = (usd) => (usd >= 1e6 ? `$${(usd / 1e6).toFixed(2)}M` : usd >= 1e3 ? `$${Math.round(usd / 1e3)}K` : `$${usd}`);
const years = (y) => (y && y.length ? (y[0] === y[1] ? `${y[0]}` : `${y[0]}–${y[1]}`) : "");
const auth = (a) => (a && a.length ? a.join(", ") : "");

export function layoutGraph(data) {
  const s = data.sanctions || {};
  const l = data.lobbying || {};
  const focusName = s.matched ? s.focus.name : l.matched ? l.client : "";
  const boxes = [];
  const lines = [];
  let used = 0;
  let row = 0;
  const y = (r) => 10 + r * (BOX.h + BOX.gapY);
  const add = (box) => { boxes.push(box); return box; };
  const right = (b) => ({ x: b.x + b.w, y: b.y + b.h / 2 });
  const left = (b) => ({ x: b.x, y: b.y + b.h / 2 });
  const link = (a, b, label) => { const p = right(a); const q = left(b); lines.push({ x1: p.x, y1: p.y, x2: q.x, y2: q.y, label }); };
  const rows = [];
  if (s.matched) {
    for (const n of s.links.slice(0, MAX_DIRECT_BOXES)) {
      if (used >= MAX_SANCTION_BOXES) break;
      const groups = n.groups.slice(0, 2);
      const span = Math.max(1, Math.min(groups.length, MAX_SANCTION_BOXES - used - 1));
      rows.push({ n, groups: groups.slice(0, span), at: row });
      used += 1 + Math.min(groups.length, span);
      row += span;
    }
  }
  const firms = l.matched ? l.firms.slice(0, MAX_FIRM_BOXES) : [];
  const firmStart = row;
  row += firms.length;
  const total = Math.max(1, row);
  const focus = add({ x: COLS[0], y: y((total - 1) / 2), w: BOX.w - 40, h: BOX.h, kind: "focus", label: clip(focusName), title: focusName, focus: true, schema: s.matched ? s.focus.schema : "Company" });
  for (const { n, groups, at } of rows) {
    const nb = add({ x: COLS[1], y: y(at + (Math.max(1, groups.length) - 1) / 2), w: BOX.w, h: BOX.h, kind: "link", label: clip(n.name), title: n.name, focus: false, schema: n.schema });
    link(focus, nb, `${n.role} · ${auth(n.authorities)}`.toUpperCase());
    groups.forEach((g, i) => {
      const names = g.items.slice(0, 2).map((x) => x.name).join(" · ");
      const count = g.items.length + g.more;
      const extra = count - Math.min(2, g.items.length);
      const gb = add({ x: COLS[2], y: y(at + i), w: BOX.w, h: BOX.h, kind: "group", label: clip(names), title: `${count} ${PLURAL[g.schema] || g.schema}: ${g.items.map((x) => x.name).join(", ")}${extra > 0 ? ` +${extra}` : ""}`, focus: false, schema: g.schema, count });
      link(nb, gb, `${count} ${PLURAL[g.schema] || g.schema}`.toUpperCase());
    });
  }
  firms.forEach((f, i) => {
    const fb = add({ x: COLS[1], y: y(firmStart + i), w: BOX.w, h: BOX.h, kind: "firm", label: clip(f.name), title: f.name, focus: false, schema: "Lobbying firm" });
    link(focus, fb, `HIRED · ${f.filings} FILINGS`);
  });
  const width = COLS[2] + BOX.w + 20;
  const height = y(total) + 4;
  return { width, height, boxes, lines };
}

function renderSvg(data) {
  const g = layoutGraph(data);
  if (g.boxes.length < 2) return "";
  const summary = g.lines.map((ln) => ln.label).join("; ");
  const lines = g.lines.map((ln) => {
    const mx = (ln.x1 + ln.x2) / 2;
    return `<path class="conn-edge" d="M${ln.x1} ${ln.y1} C ${mx} ${ln.y1}, ${mx} ${ln.y2}, ${ln.x2} ${ln.y2}"/>` +
      `<text class="conn-edge-label" x="${mx}" y="${Math.min(ln.y1, ln.y2) - 6}" text-anchor="middle">${escapeHtml(ln.label.length > 34 ? ln.label.slice(0, 33) + "…" : ln.label)}</text>`;
  }).join("");
  const boxes = g.boxes.map((b) => {
    const kind = b.kind === "group" ? `${b.count} ${(PLURAL[b.schema] || b.schema)}` : b.schema;
    return `<g class="conn-node${b.focus ? " is-focus" : ""}${b.kind === "firm" ? " is-firm" : ""}"><title>${escapeHtml(b.title)}</title>` +
      `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="4"/>` +
      `<text class="conn-kind" x="${b.x + 12}" y="${b.y + 20}">${escapeHtml(String(kind).toUpperCase())}</text>` +
      `<text class="conn-label" x="${b.x + 12}" y="${b.y + 39}">${escapeHtml(b.label)}</text></g>`;
  }).join("");
  return `<svg class="conn-graph" viewBox="0 0 ${g.width} ${g.height}" width="100%" role="img" aria-label="${escapeHtml(summary)}">${lines}${boxes}</svg>`;
}

const searchButton = (name) => `<button class="conn-name" type="button" data-search="${escapeHtml(name)}">${escapeHtml(name)}</button>`;

function renderSanctions(s) {
  if (!s || s.available === false) {
    return `<div class="conn-block"><h3>Connections on the sanctions lists</h3><p class="conn-empty">Connections are unavailable right now. <button class="btn" type="button" data-retry="connections">Retry</button></p></div>`;
  }
  if (!s.matched || !s.links.length) {
    return `<div class="conn-block"><h3>Connections on the sanctions lists</h3><p class="conn-empty">No recorded connections on the sanctions lists.</p></div>`;
  }
  const focus = s.focus.name;
  const items = s.links.map((n) => {
    const groups = n.groups.map((g) => {
      const count = g.items.length + g.more;
      const sharedRole = g.items[0] ? g.items[0].role : "";
      const label = `${count} ${PLURAL[g.schema] || g.schema} linked to ${n.name}`;
      return `<div class="conn-group"><span class="conn-rel">${escapeHtml(label.toUpperCase())}${sharedRole ? ` · ${escapeHtml(sharedRole.toUpperCase())}` : ""}</span>` +
        `<div class="conn-chips">${g.items.map((x) => searchButton(x.name)).join("")}${g.more ? `<span class="conn-more">+${g.more} more</span>` : ""}</div></div>`;
    }).join("");
    return `<li><span class="conn-rel">${escapeHtml(sentence(focus, n).toUpperCase())} · ${escapeHtml(auth(n.authorities))}</span>${searchButton(n.name)}${groups}</li>`;
  }).join("");
  const more = s.linksMore ? `<p class="conn-note">+${s.linksMore} more direct links on the lists.</p>` : "";
  const others = s.others ? `<p class="conn-note">${s.others} other list ${s.others === 1 ? "entry shares" : "entries share"} this name; showing the one with the most links.</p>` : "";
  return `<div class="conn-block"><h3>Connections on the sanctions lists</h3><p class="conn-lede">Who governments say is linked to ${escapeHtml(focus)}. Select a name to search it.</p><ul class="conn-list">${items}</ul>${more}${others}</div>`;
}

function revolvingDoor(lobbyists) {
  const counts = new Map();
  for (const p of lobbyists) for (const body of new Set(p.former_bodies)) counts.set(body, (counts.get(body) || 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])
    .map(([body, n]) => `${n} ${n === 1 ? "lobbyist" : "lobbyists"} previously served at the ${body}`);
}

function renderLobbying(l) {
  const head = `<h3>Lobbying in Washington</h3>`;
  if (!l || l.available === false) {
    return `<div class="conn-block">${head}<p class="conn-empty">Lobbying data is unavailable right now. <button class="btn" type="button" data-retry="connections">Retry</button></p></div>`;
  }
  if (!l.matched) {
    const msg = l.checked_no_filings
      ? `No US lobbying filings found (checked nightly). ${NO_PROOF}`
      : "Lobbying is tracked for a list of companies named in sanctions research; this one is not on it.";
    return `<div class="conn-block">${head}<p class="conn-empty">${escapeHtml(msg)}</p></div>`;
  }
  if (l.checked_no_filings) {
    return `<div class="conn-block">${head}<p class="conn-empty">${escapeHtml(`No US lobbying filings found for ${l.client} (checked nightly). ${NO_PROOF}`)}</p></div>`;
  }
  const firms = l.firms.map((f) => {
    const money = f.fees_usd ? ` · ${fmtMoney(f.fees_usd)}` : f.sub_fees_usd ? ` · ${fmtMoney(f.sub_fees_usd)} as subcontractor` : "";
    return `<li><a href="${escapeHtml(safeUrl(f.url))}" rel="noopener">${escapeHtml(f.name)}</a><span class="conn-meta">${f.filings} filings · ${escapeHtml(years(f.years))}${escapeHtml(money)}</span></li>`;
  }).join("");
  const byFirm = new Map();
  for (const p of l.lobbyists) {
    const key = p.firm || "Other";
    if (!byFirm.has(key)) byFirm.set(key, []);
    byFirm.get(key).push(p);
  }
  const lobbyists = [...byFirm.entries()].map(([firm, people]) =>
    `<li><span class="conn-rel">${escapeHtml(firm.toUpperCase())}</span>${people.map((p) =>
      `<span class="conn-person">${escapeHtml(p.name)}${p.former_posts.length ? ` <span class="conn-meta">formerly ${escapeHtml(joinAnd(p.former_posts))}</span>` : ""}</span>`).join("")}</li>`).join("");
  const door = revolvingDoor(l.lobbyists).map((t) => `<li>${escapeHtml(t)}</li>`).join("");
  const bodies = l.bodies.map((b) => `${escapeHtml(b.name)} (${b.filings})`).join(", ");
  const bills = l.bills.map((b) => `<li><b>${escapeHtml(b.label)}</b>${b.title ? ` <span class="conn-meta">${escapeHtml(b.title)}</span>` : ""} · ${b.filings} filings</li>`).join("");
  const parents = l.parents.map((p) => `<li>${escapeHtml(p.name)}${p.ownership_pct ? ` · ${escapeHtml(p.ownership_pct)}%` : ""}${p.note ? ` <span class="conn-meta">${escapeHtml(p.note)}</span>` : ""} <a href="${escapeHtml(safeUrl(p.url))}" rel="noopener">filing</a></li>`).join("");
  const bridges = l.bridges.map((b) => `<li>${escapeHtml(`${b.from} ${b.relation} ${b.to}`)} <span class="conn-meta">${escapeHtml(b.grade === "lead" ? "lead (our inference)" : b.grade)}${b.date ? ` · ${escapeHtml(b.date)}` : ""}</span>${b.source_url ? ` <a href="${escapeHtml(safeUrl(b.source_url))}" rel="noopener">source</a>` : ""}</li>`).join("");
  const section = (title, body) => (body ? `<h4>${title}</h4><ul class="conn-list">${body}</ul>` : "");
  return `<div class="conn-block">${head}<p class="conn-lede">${escapeHtml(`US lobbying filed for ${l.client}, as disclosed up to ${l.as_of}. Fees are self-reported and rounded.`)}</p>` +
    section("Firms hired", firms) +
    section("Revolving door", door) +
    section("Lobbyists (named in their own filings)", lobbyists) +
    (bodies ? `<h4>Lobbied</h4><p>${bodies}</p>` : "") +
    section("Bills and orders", bills) +
    section("Foreign parent named on filings", parents) +
    section("Hand-checked links", bridges) +
    `</div>`;
}

export function renderConnections(data) {
  const svg = renderSvg(data);
  const note = `A listed link is a government finding; check the source before you publish. Lobbying is legal; filings describe disclosed activity. ${data.attribution || ""}`;
  return `<section class="conn" aria-label="Connections">${svg}${renderSanctions(data.sanctions)}${renderLobbying(data.lobbying)}<p class="conn-note">${escapeHtml(note)}</p></section>`;
}

export function renderConnectionsLoading() {
  return `<section class="conn"><p class="conn-empty">Loading connections…</p></section>`;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add app/connections.js tests/connections-render.test.js
git commit -m "feat: connections panel rendering (graph and lists)"
```

---

### Task 7: Page wiring, styles, smoke tests and docs

**Files:**
- Modify: `app/render.js` (`renderDossier` gets a connections slot), `app/main.js` (fetch, render, search-by-name, retry, open-on-expand), `app/style.css` (panel styles)
- Modify: `tests/smoke.spec.js` (three connections tests with a stubbed API), `stories/about-the-data.html`, `README.md`, `docs/specs/2026-10-14-connections-design.md` (status line)

**Interfaces:**
- Consumes: `connectionsQuery`, `renderConnections`, `renderConnectionsLoading` (Task 6); `/api/connections` (Task 5); `runSearch` and `latestOnly` already in `app/main.js`.
- Produces: `<div class="connections" data-connections="<entry id>"></div>` as the last child of every `.dossier-entry`.

- [ ] **Step 1: Add the slot to `renderDossier` in `app/render.js`**

In `renderDossier`, add the slot just before the closing `</article>`:
```js
    <div class="connections" data-connections="${escapeHtml(e.id)}"></div>
  </article>`;
```
(that is, change the final `  </article>\`;` to the two lines above.)

- [ ] **Step 2: Wire it in `app/main.js`**

Add to the imports:
```js
import { connectionsQuery, renderConnections, renderConnectionsLoading } from "./connections.js";
```
Add these functions above `runSearch`:
```js
async function loadConnections(entry, isLatest) {
  const slot = [...document.querySelectorAll("[data-connections]")].find((el) => el.dataset.connections === entry.id);
  if (!slot) return;
  slot.innerHTML = renderConnectionsLoading();
  let data;
  try {
    const res = await fetch(`/api/connections?${connectionsQuery(entry)}`, { signal: AbortSignal.timeout(8000) });
    data = await res.json();
    if (!data || typeof data !== "object" || !("sanctions" in data)) throw new Error("bad connections answer");
  } catch {
    data = { sanctions: { available: false }, lobbying: { available: false }, attribution: "" };
  }
  if (isLatest()) slot.innerHTML = renderConnections(data);
}
```
At the end of `runSearch`, after `checkWider(q.text, isLatest);`, add:
```js
  if (research[0]) loadConnections(research[0], isLatest);
```
In `wire()`, inside the existing `$("#results").addEventListener("click", async (event) => { … })` handler, add at the top:
```js
    const named = event.target.closest("[data-search]");
    if (named) {
      input.value = named.dataset.search;
      runSearch(input.value);
      window.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
```
and replace the `if (retry.dataset.retry === "research") await loadResearch();` line with:
```js
    if (retry.dataset.retry === "connections") {
      const id = retry.closest("[data-connections]")?.dataset.connections;
      const entry = id && state.shown.get(id);
      if (entry) loadConnections(entry, () => true);
      return;
    }
    if (retry.dataset.retry === "research") await loadResearch();
```
Also in `wire()`, add a listener that loads connections when a collapsed "Other matches" entry is opened:
```js
  $("#results").addEventListener("toggle", (event) => {
    const details = event.target;
    if (!(details instanceof HTMLDetailsElement) || !details.open) return;
    const id = details.querySelector("[data-connections]")?.dataset.connections;
    const entry = id && state.shown.get(id);
    if (entry && !details.querySelector(".conn")) loadConnections(entry, () => true);
  }, true);
```

- [ ] **Step 3: Styles — append to `app/style.css`**

```css
/* Connections panel */
.connections { margin-top: var(--space-2xl); }
.conn { border-top: 2px solid var(--color-ink); padding-top: var(--space-sm); }
.conn-graph { display: block; max-width: 760px; margin: var(--space-sm) 0 var(--space-lg); }
.conn-edge { stroke: var(--color-rule); stroke-width: 1.5; fill: none; }
.conn-edge-label { font-family: var(--font-mono); font-size: 10px; fill: var(--color-neutral); }
.conn-node rect { fill: var(--color-paper-3); stroke: var(--color-rule); }
.conn-node.is-focus rect { fill: var(--color-accent-dim); stroke: var(--color-accent); }
.conn-node.is-firm rect { stroke-dasharray: 4 3; }
.conn-kind { font-family: var(--font-mono); font-size: 9px; letter-spacing: 0.06em; fill: var(--color-neutral); }
.conn-label { font-family: var(--font-display); font-size: 14px; font-weight: 700; fill: var(--color-ink); }
.conn-block + .conn-block { margin-top: var(--space-xl); }
.conn-block h3 { font-size: var(--text-sm); font-weight: 700; margin: 0 0 var(--space-xs); }
.conn-block h4 { font-size: var(--text-xs); font-weight: 700; margin: var(--space-md) 0 var(--space-xs); color: var(--color-muted); text-transform: uppercase; letter-spacing: 0.06em; }
.conn-lede { margin: 0 0 var(--space-sm); color: var(--color-muted); font-family: var(--font-serif); font-size: var(--text-sm); }
.conn-list { list-style: none; margin: 0; padding: 0; }
.conn-list li { padding: var(--space-xs) 0; border-top: var(--rule-hair) solid var(--color-rule); font-size: var(--text-sm); }
.conn-rel { display: block; font-family: var(--font-mono); font-size: var(--text-2xs); letter-spacing: 0.04em; color: var(--color-neutral); margin-bottom: 2px; overflow-wrap: anywhere; }
.conn-name { font: inherit; color: var(--color-ink); background: none; border: 0; padding: 0; text-decoration: underline; text-underline-offset: 0.2em; cursor: pointer; text-align: left; overflow-wrap: anywhere; }
.conn-name:hover { text-decoration-thickness: 2px; }
.conn-group { margin-top: var(--space-xs); }
.conn-chips { display: flex; flex-wrap: wrap; gap: var(--space-2xs) var(--space-xs); }
.conn-chips .conn-name { font-size: var(--text-xs); border: var(--rule-hair) solid var(--color-rule); border-radius: var(--radius-sm); padding: 1px 7px; text-decoration: none; color: var(--color-muted); }
.conn-more, .conn-meta { color: var(--color-neutral); font-size: var(--text-xs); }
.conn-meta { display: inline; margin-left: var(--space-xs); }
.conn-person { display: block; }
.conn-empty { color: var(--color-muted); font-size: var(--text-sm); margin: 0; }
.conn-note { color: var(--color-neutral); font-size: var(--text-xs); margin: var(--space-md) 0 0; max-width: 70ch; }
@media (max-width: 47.99rem) { .conn-graph { display: none; } }
```

- [ ] **Step 4: Add the smoke tests (with a stubbed API)**

Append to `tests/smoke.spec.js`:
```js
const CONNECTIONS = {
  TASSOS: {
    sanctions: { available: true, matched: true, others: 0, linksMore: 0,
      focus: { name: "TASSOS", schema: "Vessel", imo: "9408695", authorities: ["US", "UK"] },
      links: [{ name: "Zulu Ships Management", schema: "Organization", role: "Property in the interest of", direction: "out", authorities: ["US", "UK"],
        groups: [{ schema: "Vessel", items: ["TAGOR", "NEMRUT", "MANASLU", "BRIONT"].map((n) => ({ name: n, schema: "Vessel", role: "Property in the interest of", direction: "in", authorities: ["US", "UK"] })), more: 6 }] }] },
    lobbying: { available: true, matched: false, checked_no_filings: false },
    attribution: "Sanctions links: official sanctions lists compiled by OpenSanctions (CC BY-NC 4.0).",
  },
  NS2: {
    sanctions: { available: true, matched: false },
    lobbying: { available: true, matched: true, client: "Nord Stream 2 AG", as_of: "2026-10-14", checked_no_filings: false,
      firms: [{ name: "Capitol Counsel LLC", filings: 12, fees_usd: 1230000, sub_fees_usd: null, subcontract: false, years: [2017, 2022], url: "https://lda.gov/filings/public/filing/u1/print/" }],
      lobbyists: [], bodies: [{ name: "US Senate", filings: 9 }], bills: [], parents: [], bridges: [] },
    attribution: "Lobbying: US Lobbying Disclosure Act filings (lda.gov).",
  },
  SOV: {
    sanctions: { available: true, matched: true, others: 2, linksMore: 0, focus: { name: "SOVCOMFLOT", schema: "Company", imo: "", authorities: ["US"] },
      links: [{ name: "Government of Russia", schema: "Organization", role: "Owned by", direction: "out", authorities: ["US"], groups: [] }] },
    lobbying: { available: true, matched: false, checked_no_filings: true },
    attribution: "",
  },
};

async function stubConnections(page) {
  await page.route("**/api/connections**", (route) => {
    const url = new URL(route.request().url());
    const key = url.searchParams.get("imo") === "9408695" ? "TASSOS" : /nord stream/i.test(url.searchParams.get("name") || "") ? "NS2" : "SOV";
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(CONNECTIONS[key]) });
  });
}

test("connections: TASSOS shows Zulu and its ships, names are searchable", async ({ page }) => {
  await stubConnections(page);
  await page.goto("/");
  await search(page, "TASSOS");
  const panel = page.locator(".dossier-entry").first().locator(".conn");
  await expect(panel).toContainText("Zulu Ships Management");
  await expect(panel).toContainText("+6 more");
  await expect(panel.locator(".conn-graph")).toBeVisible();
  await panel.locator('[data-search="TAGOR"]').click();
  await expect(page.locator("#q")).toHaveValue("TAGOR");
});

test("connections: Nord Stream 2 shows its lobbying firm", async ({ page }) => {
  await stubConnections(page);
  await page.goto("/");
  await search(page, "Nord Stream 2 AG");
  const panel = page.locator(".dossier-entry").first().locator(".conn");
  await expect(panel).toContainText("Lobbying in Washington");
  await expect(panel).toContainText("Capitol Counsel LLC");
});

test("connections: Sovcomflot says no lobbying found; phone hides the graph without clipping", async ({ page }) => {
  await stubConnections(page);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await search(page, "Sovcomflot");
  const panel = page.locator(".dossier-entry").first().locator(".conn");
  await expect(panel).toContainText("No US lobbying filings found (checked nightly)");
  await expect(panel.locator(".conn-graph")).toBeHidden();
  const clipped = await page.evaluate(() => [...document.querySelectorAll("body *")]
    .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1).map((el) => `${el.tagName}.${el.className}`));
  expect(clipped).toEqual([]);
});
```
The existing TASSOS smoke test's console-error filter ignores `/api/search`; extend it to `/api/` so the unstubbed local 404 for `/api/connections` in other tests is also ignored:
```js
    if (m.type() === "error" && !m.location().url.includes("/api/")) errors.push(m.text());
```

- [ ] **Step 5: Docs**

- `stories/about-the-data.html`: after the OpenSanctions list item, add
```html
    <li><strong>Connections</strong>: owners, managers and linked companies from the official sanctions lists (via OpenSanctions' relationship data), and US lobbying from Lobbying Disclosure Act filings (<a href="https://lda.gov">lda.gov</a>) for a tracked list of companies, both refreshed nightly. Lobbyists are named only from their own disclosures. No filing found is not proof of no influence.</li>
```
- `README.md`, under "How the data updates", add the bullet:
```
- **Connections** (sanctions links and US lobbying): the nightly job also builds `connections.json.gz` from OpenSanctions' relationship data and `lobbying.json.gz` from lda.gov filings for the companies in `data/lobbying-clients.json` (add a company there), and attaches both to the `data-latest` release; `api/connections.js` serves them.
```
- `docs/specs/2026-10-14-connections-design.md`: change `Status: draft, awaiting review` to `Status: approved 2026-10-14; built per docs/plans/2026-10-14-connections.md`. Add this line under "Data sources", after the bullet list of measured facts: `Plan note: the client list is stored as separate "queries" and "clients" arrays (one company can need several queries), and lobbied/lobbied_on edges carry their client so one firm's work for two clients is not mixed.`

- [ ] **Step 6: Run everything**

Run: `.venv/bin/python -m pytest -q scripts && npm test && npm run smoke`
Expected: all pass (12 Playwright tests).

- [ ] **Step 7: Commit**

```bash
git add app/render.js app/main.js app/style.css tests/smoke.spec.js stories/about-the-data.html README.md docs/specs/2026-10-14-connections-design.md
git commit -m "feat: connections panel in every result"
```
