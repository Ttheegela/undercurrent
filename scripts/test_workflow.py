"""The nightly publish job's security lines (.github/workflows/update-lists.yml), read as plain text: the allowlist that
decides what it may commit, and the three path lists (collect, put in place, git add) that must name the same files."""
import re
from pathlib import Path

TEXT = (Path(__file__).resolve().parent.parent / ".github" / "workflows" / "update-lists.yml").read_text(encoding="utf-8")
ALLOW = (r"^(data\/lists\/[a-z]+\.json|data\/[a-z-]+-meta\.json|data\/site-stats\.json|data\/changes\/changes\.json|"
         r"stories\/chips-into-russia\/data\/[a-z_-]+\.json|stories\/shadow-fleet\/network\/(fleet-data|nodes|edges)\.json|"
         r"stories\/who-lobbies\/influence-network\/kg\.json)$")
# fields split on tabs only; the mode is the second word of the first; a line without exactly one tab is printed whole
AWK = ("bad=$(git diff --cached --raw --no-renames | awk -F'\\t' '{ split($1, m, \" \"); if (NF != 2 || "
       "(m[2] != \"100644\" && m[2] != \"000000\") || $2 !~ /" + ALLOW + "/) print (NF == 2 ? $2 : $0) }')")


def step(name: str) -> str:
    """One step's text, from its `- name:` line to the next step's."""
    start = TEXT.index(f"      - name: {name}\n")
    end = TEXT.find("\n      - ", start + 1)
    return TEXT[start:] if end == -1 else TEXT[start:end]


def loop(text: str) -> list:
    return re.search(r"for p in (.+?); do", text).group(1).split()


def test_the_allowlist_line_is_pinned():
    lines = [x.strip() for x in step("Commit changes").splitlines()]
    assert AWK in lines
    assert sum("git diff --cached --raw" in x for x in lines) == 1  # (and it is the only one)
    assert 'if [ -n "$bad" ]; then echo "::error::Unexpected staged paths: $bad"; exit 1; fi' in lines


def test_collect_put_in_place_and_git_add_name_the_same_files():
    collect = loop(step("Collect outputs"))
    put = step("Put data files in place")
    placed = loop(put) + (["data/lists"] if 'rm -rf data/lists && cp -R "$src/data/lists" data/lists' in put else [])
    added = re.search(r"^\s*git add (.+)$", step("Commit changes"), re.M).group(1).split()
    assert collect[-1] == "build/*.json.gz"  # (the release assets: collected, never committed)
    for paths in (collect[:-1], placed, added):
        assert len(paths) == len(set(paths))
    assert set(collect[:-1]) == set(placed) == set(added) and "data/lists" in added


def test_every_committed_file_passes_the_allowlist_and_odd_names_do_not():
    added = re.search(r"^\s*git add (.+)$", step("Commit changes"), re.M).group(1).split()
    for path in [p for p in added if p != "data/lists"] + ["data/lists/us.json", "data/lists/meta.json"]:
        assert re.fullmatch(ALLOW, path), path
    for path in ("data/lists/x.json evil.html", "data/lists/x.json/evil.json", "data/lists/Us.json", "data/-meta.json",
                 "data/x/live-graphs-meta.json", "stories/shadow-fleet/network/evil.html", "data/changes/other.json",
                 "stories/who-lobbies/influence-network/kg_data.js", "stories/shadow-fleet/network/nodes.json.js"):
        assert not re.fullmatch(ALLOW, path), path


def test_odd_artifact_names_are_listed_with_workflow_commands_stopped():
    put = [x.strip() for x in step("Put data files in place").splitlines()]
    listing = next(i for i, x in enumerate(put) if "cat -vt" in x)
    assert put[listing - 2] == 'stop=$(openssl rand -hex 16)'
    assert put[listing - 1] == 'echo "::stop-commands::$stop"' and put[listing + 1] == 'echo "::$stop::"'
