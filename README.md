# Undercurrent

**Try it now:** open https://undercurrent-research.vercel.app and search `TASSOS`.

Check any ship, company or person against sanctions-evasion research and the US, UK, EU and UN sanctions lists. Every answer comes with its source. Built for journalists and researchers covering how Russia, Iran and others get around sanctions. An independent project.

## Use it (1 minute)

1. Open https://undercurrent-research.vercel.app (the old `undercurrent-jet-nine.vercel.app` address redirects here).
2. Type a ship name, a seven-digit IMO number, a company or a person.
3. Read the red verdict line first: how many of the four governments list it, and which.

New here? Press **Follow one tanker** for a five-step tour.

Each result shows:

- **Our research**: a dossier from the research snapshot, with sources.
- **The official lists**: US, UK, EU and UN entries, refreshed nightly.
- **Wider check**: OpenSanctions (95 sources).
- **Connections**: owners, managers and linked companies from the official lists, and US lobbying (firms, named lobbyists, agencies, bills) from lda.gov filings.

Stories: the shadow-fleet map, who lobbies (influence network and clean-names graph), semiconductors into Russia (routes, who reports, time to list, Kyrgyzstan and Kazakhstan), and how sanctions work.

## Run it locally (2 minutes)

```bash
npx serve .
```

Then open http://localhost:3000 (or the address serve prints). The OpenSanctions check, the Connections panel and Ask run as Vercel Functions (`api/`), so locally they show a link, "unavailable" or no Ask button.

## Run the tests (about 5 minutes)

```bash
python3 -m pytest -q scripts && npm test && npm run smoke
```

## Edit a research note (2 minutes)

1. Edit the `.md` file under `stories/`.
2. Run `python3 scripts/build_docs.py`.
3. Commit both the `.md` and the `.html`. A test fails if a page is out of date.

## Reference

- [How the data updates](docs/data-updates.md): the nightly 04:00 UTC run, its sources, failure handling and the deploy key.
- [Ask](docs/ask.md): the chat panel, its limits, budget and cost, and its evals.
- [Security and monitoring](docs/operations.md): headers, firewall, uptime checks and hosting.

## Credit

The research comes from the VeilTrace hackathon project at the Trace the Unseen build day, 25 September 2026: https://github.com/Ttheegela/veil-trace

Code is MIT licensed. Data keeps its sources' terms; see `stories/about-the-data.html`.
