# Security and monitoring

[Back to the README](../README.md)

## Security

- **Headers:** set in `vercel.json` and enforced.
  - Content-Security-Policy: strict for the app, looser for `/stories/`, which has inline scripts and pinned CDN libraries with integrity hashes.
  - Also: `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`.
  - HSTS comes from Vercel.
- **Firewall:** set in the Vercel dashboard, not in this repo.
  - `/api/` is rate-limited to 120 requests a minute per IP.
  - Any method other than GET, HEAD or OPTIONS is denied. Ask's launch adds one exception (see [Ask](ask.md)).
- **APIs:** answer GET only; the one exception is `POST /api/ask` (see [Ask](ask.md)). Queries over 200 characters are rejected with 400, and so are names that normalise to under two characters.
- **Data:** the sanctions side names people only as official lists or government documents name them. Lobbyists are named only from their own US lobbying filings. Names in `exclude_lobbyists` (in `data/lobbying-clients.json`) are never shown. Corrections and removal requests go through GitHub issues, as described on the About page.

## Monitoring

UptimeRobot checks three things every 5 minutes and emails on failure:

- the home page
- `/api/search?q=tassos`, which must contain `"enabled":true`
- `/api/connections?imo=9408695`, which must contain `"matched":true`

Public status page: https://stats.uptimerobot.com/5FeFn9Euy7

A scheduled maintenance agent checks the nightly run every day at 10:30 UTC and opens fix PRs; changes to listing or naming rules, workflows or security settings wait for the owner.

Hosting is Vercel's free Hobby plan. It has no billing, and Vercel pauses the site rather than charging if usage limits are reached.
