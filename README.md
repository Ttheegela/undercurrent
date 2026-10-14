# Undercurrent

Check any ship, company or person against sanctions-evasion research and the US, UK, EU and UN sanctions lists. Every answer comes with its source.

Built for journalists and researchers covering how Russia, Iran and others get around sanctions.

## Use it

https://undercurrent-jet-nine.vercel.app

Type a ship name, a seven-digit IMO number, a company or a person. New here? Press **Follow one tanker** for a five-step tour.

## Run it locally

```bash
npx serve .
```

Then open http://localhost:3000 (or the address serve prints). Everything works except the OpenSanctions check, which runs as a Vercel Function and shows a link instead when run this way.

## How the data updates

- **Official lists** (US Consolidated Screening List, UK Sanctions List, EU financial sanctions list, UN Security Council list) are downloaded every night at 04:00 UTC by `.github/workflows/update-lists.yml`.
- A list that fails to download, changes shape, or shrinks by more than 20% keeps yesterday's copy; the others still update. The page then says "Some lists may be out of date", and a GitHub issue is opened.
- **Our research** is a fixed snapshot from 25 September 2026. Rebuild the index with `python3 scripts/build_research_index.py`.
- **OpenSanctions** (95 sources, CC BY-NC 4.0): the same nightly job downloads OpenSanctions' free bulk sanctions data, builds a compact index and attaches it to the `data-latest` GitHub release; `api/search.js` searches it in memory. No API key is needed.
- **Connections** (sanctions links and US lobbying): the nightly job also builds `connections.json.gz` from OpenSanctions' relationship data and `lobbying.json.gz` from lda.gov filings for the companies in `data/lobbying-clients.json` (add a company there), and attaches both to the `data-latest` release; `api/connections.js` serves them.

## Tests

```bash
python3 -m pytest -q scripts && npm test && npm run smoke
```

## Credit

The research comes from the VeilTrace team at the Trace the Unseen build day, 25 September 2026: https://github.com/Ttheegela/veil-trace

Code is MIT licensed. Data keeps its sources' terms; see `stories/about-the-data.html`.
