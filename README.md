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
