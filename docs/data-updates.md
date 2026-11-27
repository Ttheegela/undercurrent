# How the data updates

[Back to the README](../README.md)

Every night at 04:00 UTC, `.github/workflows/update-lists.yml` refreshes:

| Data | Source | Where it goes |
|---|---|---|
| Official lists | US Consolidated Screening List, UK Sanctions List, EU financial sanctions list, UN Security Council list | `data/lists/` |
| Wider check | OpenSanctions bulk data (CC BY-NC 4.0, no key) | `opensanctions.json.gz` on the `data-latest` release |
| Connections | OpenSanctions relationship data | `connections.json.gz` on the release |
| Lobbying | lda.gov filings for the companies in `data/lobbying-clients.json` (add a company there) | `lobbying.json.gz` on the release |
| Semiconductors into Russia | UN Comtrade (HS 8542 exports to Russia, data availability), Eurostat Comext, OFAC SDN advanced XML, the Consolidated Screening List | `stories/chips-into-russia/data/` |
| Live graphs | The shadow-fleet map and the influence network, rebuilt from the official lists, the OpenSanctions OFAC and EU Official Journal exports (CC BY-NC 4.0) and the lobbying filings above | `stories/shadow-fleet/network/` (`fleet-data.json`, `nodes.json`, `edges.json`), `stories/who-lobbies/influence-network/kg.json`, the day's changes in `data/changes/changes.json` (the Updates page), the page figures in `data/site-stats.json`, and `data/live-graphs-meta.json` |

- **Failure handling:** each source fails alone. A source that fails to download, changes shape or shrinks by more than 20% keeps yesterday's copy, and a GitHub issue names it. The page says "Some lists may be out of date" when a list is stale.
- **Live graphs:** `scripts/build_live_graphs.py` runs after the other steps. If it keeps yesterday's map, or the lobbying asset is there but cannot be read (the map still updates and the network keeps yesterday's lobbying layer), it exits 1, and the nightly issue names "live graphs" and quotes the build's own note from `data/live-graphs-meta.json`. Its guards:
  - **Source families:** official links are counted per source family: the UK list, the US screening list, OFAC and the EU Official Journal (both via OpenSanctions) and the EU financial sanctions list. A family with 100 or more links yesterday that drops by more than 20% marks its government unavailable and the map keeps yesterday's copy. A smaller family is rejected only if it drops to none. The same holds if all official links together drop by more than 20%, or if the sample check fails (TASSOS, IMO 9408695, must keep its official link to Zulu Ships Management).
  - **Empty files:** both OpenSanctions downloads must arrive with rows. A UK, US or EU list that is not fresh, or a missing raw download, also keeps the previous map.
  - **Write order:** each file is first written whole to a `.tmp` file, then all are renamed into place in a fixed order: map payload, nodes, edges, network, page figures, then the change record, then the status file. The record is never ahead of the graphs it describes.
  - **Change record:** a source that kept its previous copy files no changes that day and is marked unavailable. The night it comes back reports what changed in it meanwhile. A re-run on the same day adds its changes to that day. History starts at the first live run.
- **Chip firms:** the list is hand-checked in `stories/chips-into-russia/data/chips-firms.json`. Firms are joined by OFAC id and each is named in a US Treasury press release. The home page's "months" figure is read from `summary.json`.
- **Research snapshot:** fixed at 25 September 2026 for search and the dossiers; the nightly build does not rebuild it. A hand rebuild with `python3 scripts/build_research_index.py` reads the map's 25 September files from git (commit `ad46320`), not the files the nightly rewrites, so it gives the same snapshot.
- **Research notes:** the Markdown files under `stories/` are the source; the site serves the `.html` pages that `python3 scripts/build_docs.py` writes next to them. Edit the `.md`, run the script and commit both (a test fails if a page is out of date). `vercel.json` redirects the old `.md` URLs.

## Two jobs, one key

- **build:** downloads and parses all outside data with a read-only token and no secrets, then hands the results to `publish` as a short-lived artifact.
- **publish:** runs none of the project's Python. It:
  - rejects the artifact if it holds hidden files, links, or file names with anything but letters, digits, `.`, `_`, `-` and `/`
  - copies the expected files into place and attaches the release assets
  - commits to `main` only if the smoke check passed
  - opens the failure issue
- **What publish may commit:** a fail-closed allowlist limits it to plain `.json` files at the expected paths.
- **The key:** the deploy key `NIGHTLY_DEPLOY_KEY` lives only in the `nightly` GitHub environment, which only `main` may use. It is the repo's only deploy key, and the `protect-main` ruleset lets it push the nightly commit.

To replace the key, run this on your own machine (never paste the private key anywhere):

```bash
ssh-keygen -t ed25519 -N "" -C "undercurrent-nightly" -f ~/.ssh/undercurrent_nightly -q
gh repo deploy-key add ~/.ssh/undercurrent_nightly.pub -R Ttheegela/undercurrent --allow-write --title "nightly (environment)"
gh secret set NIGHTLY_DEPLOY_KEY --env nightly -R Ttheegela/undercurrent < ~/.ssh/undercurrent_nightly
```

Then run the workflow once (`gh workflow run update-lists.yml --ref main`), check both jobs pass, and delete the old deploy key.
