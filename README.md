# Undercurrent

Check any ship, company or person against sanctions-evasion research and the US, UK, EU and UN sanctions lists. Every answer comes with its source.

Built for journalists and researchers covering how Russia, Iran and others get around sanctions. An independent project.

## Use it

https://undercurrent-research.vercel.app (the old `undercurrent-jet-nine.vercel.app` address redirects here)

Type a ship name, a seven-digit IMO number, a company or a person. New here? Press **Follow one tanker** for a five-step tour.

Each result shows:

- **Our research**: a dossier from the research snapshot, with sources.
- **The official lists**: US, UK, EU and UN entries, refreshed nightly.
- **Wider check**: OpenSanctions (95 sources).
- **Connections**: owners, managers and linked companies from the official lists, and US lobbying (firms, named lobbyists, agencies, bills) from lda.gov filings.

Stories: the shadow-fleet map, who lobbies (influence network and clean-names graph), semiconductors into Russia (routes, who reports, time to list, Kyrgyzstan and Kazakhstan), and how sanctions work.

## Run it locally

```bash
npx serve .
```

Then open http://localhost:3000 (or the address serve prints). Everything works except the OpenSanctions check and the Connections panel, which run as Vercel Functions (`api/search.js`, `api/connections.js`) and show a link or "unavailable" when run this way.

## How the data updates

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

### Two jobs, one key

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

## Ask

A chat panel on every page that answers questions about what is on the site: the official lists, ship and company connections, lobbying, the semiconductor data, the research and the daily updates. An independent project, so it answers only from the site's own data and refuses anything else, including legal or compliance advice.

- **How it answers:** the model writes no sentences. `api/ask.js` runs it through OpenRouter (Claude Haiku 5.5, `provider.data_collection: deny`) for at most four rounds (ten calls in all) of lookups in `api/_ask_tools.js`, then forces one `answer` call. That call only cites evidence ids. `api/_ask_check.js` writes every sentence itself, either fixed copy ("appears on the … list", "not on the lists we check", changes and source gaps) or one sentence copied word for word from the cited item. Anything it cannot build is dropped, and an answer with nothing left is a fixed fallback. Ask refuses nothing on its own (only the model can refuse, and then the answer is the fixed refusal), but an answer to a question that looks like a request for advice on doing business ends with a fixed notice that Ask gives no legal or compliance advice and that these are records with their sources. The system prompt is `api/_ask_prompt.js`.
- **Privacy:** no accounts, and the conversation lives only in the browser tab. The server logs no message text and stores none. For the hourly limit it keeps, in memory, a hash of the visitor's address and the times of their last questions.
- **Limits:** 10 messages of at most 500 characters (an earlier answer in the history is cut to 500, since it is context only), a 16 KB body, 20 questions per visitor per rolling hour (best effort, per function instance), at most 10 tool calls and 5 model calls per question, 20 s per model call and 26 s per question. Requests must come from the site's own origin as JSON.
- **Endpoint:** `GET /api/ask` returns `{"ok":true,"enabled":…,"public":…}` (cached for 60 seconds) and never calls the model. `POST /api/ask` takes `{"messages":[{"role":"user"|"assistant","text":"…"}]}` and returns `{"ok":true,"answer":…}`, or `{"ok":false,"reason":…}` with `bad_request`, `forbidden`, `unsupported`, `too_large`, `busy`, `disabled`, `resting` (with `resets`, a date) or `unavailable`.
- **The panel:** every reader-facing page loads `app/ask.css` and `app/ask.js` (under 1 KB of brotli in all). The loader asks `GET /api/ask` once and adds the "Ask" button only when `enabled` and `public` are both true; the panel itself (`app/ask-panel.js`, `app/ask-panel.css`) loads on the first click. A new page needs the two tags (`tests/ask-pages.test.js` checks every page, and the notes template in `scripts/build_docs.py` has them). The button sits bottom-right. Where that covers controls, set `<html data-ask-side="left">`, or lift it with the `--ask-lift` CSS variable (the map's footer row and the network's story card do). While the button is on, `ask.js` adds the class `ask-on` to `<html>` and `ask.css` gives `body` bottom padding of the button's height plus its offset, so a scrolling page can always bring its last control clear of the button; a page that does not scroll (the map's wide layout) sets `--ask-pad: 0px`. The conversation is a module variable: nothing is stored, closing the panel clears it, and the last 10 messages go with each question.

| Variable | Where | Meaning |
|---|---|---|
| `OPENROUTER_API_KEY` | Vercel, Production, Secret | A dedicated OpenRouter key with a $5 limit that resets monthly. The owner enters it with `vercel env add OPENROUTER_API_KEY production` at the hidden prompt. It is never in the repo, a log, a test or a chat. Unset: `POST /api/ask` answers 503 `disabled`. |
| `ASK_PUBLIC` | Vercel, Production | `1` shows the Ask button on every page. Unset, the button stays hidden but the endpoint still answers, so the live evaluation can run against production before launch. |

- **Budget:** the key's $5 monthly limit is the hard cap. When it is spent (or the account has no credit) OpenRouter answers 402 or 403, and Ask says it is resting until the key resets (the first of the next month, UTC, unless OpenRouter gives a date). The rest of the site is unaffected. Buy credits with auto top-up off.
- **Cost estimate:** the price is $0.10 / $0.50 per million input / output tokens (the spec's figure from OpenRouter's list, 19 Oct 2026, not re-checked). Every model call resends the system prompt, the tool definitions and all earlier tool results, so a question costs more the more it looks up. The token counts below are measured on the stubbed loop with the real site data and estimated at 3 to 4 characters per token (no tokenizer is available offline).
  - **Typical question** (one lookup, then the answer): 2 model calls, about 4,000 to 6,800 input tokens and 100 output tokens, so about $0.0007. $5 covers several thousand of these.
  - **Worst case:** a question that pulls the largest results (a one-word name such as "AL" returns about 14 KB) is capped at 10 tool calls in all and 5 model calls. The same lookup repeated ten times and spread to resend as much as possible (6, 2, 1, 1 calls, then the forced answer) resends about 500 KB in all: about 125,000 to 167,000 input tokens and at most 4,000 output tokens, so $0.015 to $0.019. $5 covers about 260 to 330 of these, and one visitor's 20 in an hour would cost about $0.30 to $0.38.
- **Firewall:** the rule that denies non-read methods on `/api/` must allow `POST` on `/api/ask` only, and `POST /api/search` must still be refused.
- **Live evaluation:** `node scripts/ask-live-eval.mjs --base https://undercurrent-research.vercel.app` posts the evaluation questions to a deployed endpoint, prints each answer with its timing, and exits non-zero if any case fails. It needs no key and costs a few cents. Run it before launch and after any change to the prompt or the model.

## Evals

The 20 real-model questions in `tests/ask-eval.json` (the cases without `"live": false`) go through Ask's own loop and are scored in LangSmith, so how Ask does is on public record: the cases, the scores, the failures and the cost.

Dashboard: (link added after the first run)

- **What runs and when:** `.github/workflows/ask-evals.yml` runs `scripts/ask-langsmith.mjs`.
  - **Weekly:** Mondays at 13:00 UTC, and by hand (`gh workflow run ask-evals.yml --ref main`). A run on main first makes the LangSmith dataset `undercurrent-ask` match the live cases, then runs them. Until a run on main, weekly or manual, has created the dataset, pull request runs fail with "dataset undercurrent-ask not found".
  - **Per pull request:** once, when it is opened or marked ready for review, if it touches Ask's code, prompt, cases or the runner. A pull request evaluates main's cases and never syncs the dataset, and the run records the pull request's own commit. Drafts and forks are skipped, and later pushes do not re-run it. A manual run on another branch does not sync either.
- **Experiments:** named `ask-weekly-…`, `ask-manual-…` and `ask-pr-<number>-…`, with the model's name added when a run compares another model (`ask-manual-deepseek-v4.1-flash-…`). Each carries `commit`, `trigger`, `pr`, `model` (the model the run used) and `prompt_hash` (the first 12 characters of a hash of the system prompt and the tool definitions), so a change in score can be tied to a change in the prompt.
- **Outcomes:** each case ends as one of four. `quality`: Ask answered. `unavailable`: Ask replied that it is unavailable. `budget`: the eval key's limit was reached. `download_failed`: a lookup could not download its data (this wins over `quality`).
- **Scores:** `pass` is recorded only for `quality` outcomes, so the pass rate leaves infrastructure out. It is 1 when the answer is the expected kind, says nothing the case rules out, and every sentence is grounded in what the lookups returned. On every case: `outcome`, `tool_calls`, `latency_s`, `tokens_in`, `tokens_out` and `cost_usd`. On answered cases: `fallback` and, where the case lists sentences the answer must contain, `includes_ok`. There are no retries: a case runs once, as a visitor would have met it.
- **Failure notes:** a case with `pass` 0 gets a `note` of "Under review · date · commit". To replace it, add `{ "experiment": "<full experiment name>", "case": "<case id>", "note": "<what went wrong>" }` to the array in `tests/ask-eval-notes.json` and merge to main. The `notes` job then posts each note over "Under review", and fails if an entry's experiment, case or note is not found.
- **Issues:** a weekly run opens an issue titled `Ask evals: weekly run failed (date)` when any answered case fails, or when no case was answered. It lists the failed case ids and links the experiment. An open issue with that title gets a comment instead of a second issue. A weekly run that stops on an error, runs past its time limit or crashes opens the same issue, with the run's link in place of case ids.
- **Secrets:** `LANGSMITH_API_KEY` and `OPENROUTER_EVAL_KEY`, both GitHub repository secrets and nowhere else. The workflow hands the second to the runner as `OPENROUTER_API_KEY`, the name Ask reads. Only two steps can see them: the one that runs the cases gets both, and the one that posts the notes gets the LangSmith key. The issue job holds none, and neither key is printed or traced. Without them the runner stops before any call and names the missing one.
- **Cost:** about $0.01 to $0.40 a run: 20 questions at the Ask cost estimates above, a typical one about $0.0007 and the worst case about $0.02. The eval key is a separate OpenRouter key with a $2 monthly limit. If it runs out mid-run, the remaining cases are `budget`, get no `pass` score, and open no issue unless no case was answered.
- **Visitors:** no visitor reaches LangSmith. `langsmith` is a dev dependency, nothing under `api/` imports it, and production calls `runAsk` without the tracing hook.

## Security

- **Headers:** set in `vercel.json` and enforced.
  - Content-Security-Policy: strict for the app, looser for `/stories/`, which has inline scripts and pinned CDN libraries with integrity hashes.
  - Also: `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`.
  - HSTS comes from Vercel.
- **Firewall:** set in the Vercel dashboard, not in this repo.
  - `/api/` is rate-limited to 120 requests a minute per IP.
  - Any method other than GET, HEAD or OPTIONS is denied. Ask's launch adds one exception (see Ask).
- **APIs:** answer GET only; the one exception is `POST /api/ask` (see Ask). Queries over 200 characters are rejected with 400, and so are names that normalise to under two characters.
- **Data:** the sanctions side names people only as official lists or government documents name them. Lobbyists are named only from their own US lobbying filings. Names in `exclude_lobbyists` (in `data/lobbying-clients.json`) are never shown. Corrections and removal requests go through GitHub issues, as described on the About page.

## Monitoring

UptimeRobot checks three things every 5 minutes and emails on failure:

- the home page
- `/api/search?q=tassos`, which must contain `"enabled":true`
- `/api/connections?imo=9408695`, which must contain `"matched":true`

Public status page: https://stats.uptimerobot.com/5FeFn9Euy7

A scheduled maintenance agent checks the nightly run every day at 10:30 UTC and opens fix PRs; changes to listing or naming rules, workflows or security settings wait for the owner.

Hosting is Vercel's free Hobby plan. It has no billing, and Vercel pauses the site rather than charging if usage limits are reached.

## Tests

```bash
python3 -m pytest -q scripts && npm test && npm run smoke
```

## Credit

The research comes from the VeilTrace team at the Trace the Unseen build day, 25 September 2026: https://github.com/Ttheegela/veil-trace

Code is MIT licensed. Data keeps its sources' terms; see `stories/about-the-data.html`.
