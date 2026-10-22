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

- **How it answers:** the model writes no sentences. `api/ask.js` runs it through OpenRouter (Claude Haiku 5.5, `provider.data_collection: deny`) for at most four rounds (ten calls in all) of lookups in `api/_ask_tools.js`, then forces one `answer` call. That call only cites evidence ids, each with a claim. `api/_ask_check.js` writes every sentence itself, either fixed copy filled from the cited items or one sentence copied word for word from a cited item. The fixed copy covers:
  - listings ("appears on the … list") and not-found lines ("not on the lists we check");
  - ages ("has been on the … list for 5 years 10 months (since …)", with what the date stands for, or "gives no listing date");
  - counts the tools compute: records on an official list under a programme, the research map's ships by programme group, list, flag, type or names (the `research` tool), and the chips research's firms;
  - nones that say what they rest on ("No programme on the … list is named …", "None of the ships in Undercurrent's research map …", "None of the N updates recorded … involve …" with how many could not be checked);
  - changes and source gaps, and "Showing N of M." after a capped result, counting the matches the answer names.

  Anything it cannot build is dropped, and an answer with nothing left is a fixed fallback. When the model cites nothing after lookups that all worked, the answer is "Nothing recorded on this site answers that." The relevance gate (below) then drops sentences that don't bear on the question. Ask refuses nothing on its own (only the model can refuse, and then the answer is the fixed refusal), but an answer to a question that looks like a request for advice on doing business ends with a fixed notice that Ask gives no legal or compliance advice and that these are records with their sources. The system prompt is `api/_ask_prompt.js`.
- **The relevance gate:** before an answer is shown, `api/_ask_gate.js` sends the question and each of its sentences, with the labels of their sources, to TypeSafe's Jev (`jev-latest`, `POST /v1/systemone`), one yes/no question (a noul) per sentence: does it bear on what the question asks? A sentence stays when the probability of yes is at least 0.5 (`GATE_THRESHOLD`, provisional until the evals tune it). After a drop the sources are numbered again and the "Showing N of M" lines rebuilt; with no sentence left the answer is "Nothing recorded on this site answers that." (the fallback when a lookup failed). Fixed copy (the part-answer line, the advice notice, the Showing lines) is never sent or dropped, and refusals, clarifying questions and the fallback skip the gate. Follow-ups are not checked: when the conversation holds more than one question, Jev could not judge "And the other one?" without the earlier turns, and only the latest question is ever sent, so the answer is shown as the checker wrote it. A caveat (what a none could not check, the source gaps of a range) is not sent either: it stays exactly when the line it qualifies does. It has 3 s, inside the request's 26 s, and **fails open**: with no key, a timeout, an HTTP error, a malformed reply or an answer the checker did not write, the answer is shown unchecked and one fixed line, `ask: relevance gate unavailable`, is logged. It never logs the question or a sentence.
- **Privacy:** no accounts, and the conversation lives only in the browser tab. The question and the site's data go to OpenRouter, and each request tells it to use only model providers that don't collect user data. The question and the answer's sentences go to TypeSafe for the relevance gate, and under its terms TypeSafe doesn't use them for training. The server logs no message text and stores none. For the hourly limit it keeps, in memory, a hash of the visitor's address and the times of their last questions.
- **Limits:** 10 messages of at most 500 characters (an earlier answer in the history is cut to 500, since it is context only), a 16 KB body, 20 questions per visitor per rolling hour (best effort, per function instance), at most 10 tool calls and 5 model calls per question, 20 s per model call and 26 s per question. Requests must come from the site's own origin as JSON.
- **Endpoint:** `GET /api/ask` returns `{"ok":true,"enabled":…,"public":…}` (cached for 60 seconds) and never calls the model. `POST /api/ask` takes `{"messages":[{"role":"user"|"assistant","text":"…"}]}` and returns `{"ok":true,"answer":…}`, or `{"ok":false,"reason":…}` with `bad_request`, `forbidden`, `unsupported`, `too_large`, `busy`, `disabled`, `resting` (with `resets`, a date, when there is one, and `daily: true` for the daily budget) or `unavailable`.
- **The panel:** every reader-facing page loads `app/ask.css` and `app/ask.js` (under 1 KB of brotli in all). The loader asks `GET /api/ask` once and adds the "Ask" button only when `enabled` and `public` are both true; the panel itself (`app/ask-panel.js`, `app/ask-panel.css`) loads on the first click. A new page needs the two tags (`tests/ask-pages.test.js` checks every page, and the notes template in `scripts/build_docs.py` has them). The button sits bottom-right. Where that covers controls, set `<html data-ask-side="left">`, or lift it with the `--ask-lift` CSS variable (the map's footer row and the network's story card do). While the button is on, `ask.js` adds the class `ask-on` to `<html>` and `ask.css` gives `body` bottom padding of the button's height plus its offset, so a scrolling page can always bring its last control clear of the button; a page that does not scroll (the map's wide layout) sets `--ask-pad: 0px`. The conversation is a module variable: nothing is stored, closing the panel clears it, and the last 10 messages go with each question.

| Variable | Where | Meaning |
|---|---|---|
| `OPENROUTER_API_KEY` | Vercel, Production, Secret | A dedicated OpenRouter key with a $5 limit that resets monthly. The owner enters it with `vercel env add OPENROUTER_API_KEY production` at the hidden prompt. It is never in the repo, a log, a test or a chat. Unset: `POST /api/ask` answers 503 `disabled`. |
| `TYPESAFE_API_KEY` | Vercel, Production, Secret | The relevance gate's TypeSafe key, separate from the eval one. The owner enters it with `vercel env add TYPESAFE_API_KEY production`. Read only in `api/_ask_gate.js`, never logged. Unset: answers are shown without the gate, and each logs the gate's fixed line. |
| `ASK_PUBLIC` | Vercel, Production | `1` shows the Ask button on every page. Unset, the button stays hidden but the endpoint still answers, so the live evaluation can run against production before launch. |

- **Budget:** the key's $5 monthly limit is the hard cap, and an OpenRouter guardrail gives the key a $1 daily budget under it. When the key's limit is spent OpenRouter answers 402 or 403, and Ask says it is resting until the key resets (the first of the next month, UTC, unless OpenRouter gives a date). When the daily budget is spent (a 403 from the guardrail) Ask says it is resting until the guardrail's reset day, and when the account has no credit (a 402 with no limit source) it says only that it is resting. The rest of the site is unaffected. Buy credits with auto top-up off. Each answered question, unless it is a follow-up, also makes one TypeSafe call for the relevance gate, outside this budget. A TypeSafe failure, a spent TypeSafe key included, fails open: the answer is shown unchecked.
- **Cost estimate:** the price is $0.10 / $0.50 per million input / output tokens (the spec's figure from OpenRouter's list, 19 Oct 2026, not re-checked). Every model call resends the system prompt, the tool definitions and all earlier tool results, so a question costs more the more it looks up. The token counts below are measured on the stubbed loop with the real site data and estimated at 3 to 4 characters per token (no tokenizer is available offline).
  - **Typical question** (one lookup, then the answer): 2 model calls, about 4,000 to 6,800 input tokens and 100 output tokens, so about $0.0007. $5 covers several thousand of these.
  - **Worst case:** a question that pulls the largest results (a one-word name such as "AL" returns about 14 KB) is capped at 10 tool calls in all and 5 model calls. The same lookup repeated ten times and spread to resend as much as possible (6, 2, 1, 1 calls, then the forced answer) resends about 500 KB in all: about 125,000 to 167,000 input tokens and at most 4,000 output tokens, so $0.015 to $0.019. $5 covers about 260 to 330 of these, and one visitor's 20 in an hour would cost about $0.30 to $0.38.
  - **The relevance gate:** each answered question, unless it is a follow-up, also makes one TypeSafe call, billed by TypeSafe for its input tokens (the question and the answer's sentences) and not in the figures above. A TypeSafe failure fails open: the answer is shown unchecked.
- **Firewall:** the rule that denies non-read methods on `/api/` must allow `POST` on `/api/ask` only, and `POST /api/search` must still be refused.
- **Live evaluation:** `node scripts/ask-live-eval.mjs --base https://undercurrent-research.vercel.app` posts the evaluation questions to a deployed endpoint, prints each answer with its timing, and exits non-zero if any case fails. Its 45 questions are more than the endpoint's 20 an hour, so run them in the three `--only` batches it prints, an hour apart. With `--limit-check` it also counts the declines: the fallback, and an answer that only says nothing recorded answers. It needs no key and costs a few cents. Run it before launch and after any change to the prompt or the model.

## Evals

The 45 real-model questions in `tests/ask-eval.json` (the cases without `"live": false`) go through Ask's own loop and are scored in LangSmith, so how Ask does is on public record: the cases, the scores, the failures and the cost. 21 of them cover question patterns across the site's topics (counts, durations, topic filters on the updates, lists by programme, country or flag, questions whose honest answer is "none" or that nothing recorded answers, two-part questions and a near-miss name), each with a note on what a good answer would be. Where the server can now say it (a count, an age, an undated listing, a none), the case expects that sentence in `includes` and no fallback. A live run meets that night's data and its own date, so an include holds only what neither can move:
- **Fixed parts only:** a count's sentence without its numbers, an age's head and its listing date without the span, no "Showing N of M" line, and no update's date. The chips median, which the nightly data recomputes, is the head of its sentence.
- **Either shape:** a question about recent updates takes the none line or a list of updates, whichever the night's record gives. An include can be a list of phrases, any one of which will do.
- **Exact:** listing sentences with their listing dates, undated listings, a programme no list names, not-found lines, quotes of the research and the explainers, and the day the record began.

`tests/ask-eval.test.js` checks every live include against these rules. A case accepts the fallback only where declining can be right. Each case's evidence is recorded once with Ask's real tools, from the committed data and the release assets (re-recorded on 22 Oct 2026 for the new claims). It keeps its exact numbers, so the offline suite never changes with the nightly data.

Dashboard: (link added after the first run)

- **What runs and when:** `.github/workflows/ask-evals.yml` runs `scripts/ask-langsmith.mjs`.
  - **Weekly:** Mondays at 13:00 UTC, and by hand (`gh workflow run ask-evals.yml --ref main`). A run on main first makes the LangSmith dataset `undercurrent-ask` match the live cases, then runs them. Until a run on main, weekly or manual, has created the dataset, pull request runs fail with "dataset undercurrent-ask not found".
  - **Per pull request:** once, when it is opened or marked ready for review, if it touches Ask's code, prompt, cases or the runner. A pull request evaluates main's cases and never syncs the dataset, and the run records the pull request's own commit. Drafts and forks are skipped, and later pushes do not re-run it. A manual run on another branch does not sync either.
  - **Comparing models:** by hand only, with `gh workflow run ask-evals.yml --ref main -f model=deepseek/deepseek-v4.1-flash`. The same cases then run on that OpenRouter model (`vendor/model`; anything else stops the run before it starts) instead of the site's. The site itself keeps Claude Haiku 5.5. On main such a run also syncs the dataset, like any manual run there.
  - **Repetitions:** by hand only, with `-f repetitions=3` (1, 2 or 3; the runner's `--repetitions N`, which only a manual run takes). Every case then runs that many times in the one experiment, as that many runs of the set; they are not retries. The job has 45 minutes for that.
- **Experiments:** named `ask-weekly-…`, `ask-manual-…` and `ask-pr-<number>-…`, with the model's name added when a run compares another model (`ask-manual-deepseek-v4.1-flash-…`). Each carries `commit`, `trigger`, `pr`, `model` (the model the run used), `judge_model` (`jev-latest`, or null when the relevance judge was skipped) and `prompt_hash` (the first 12 characters of a hash of the system prompt and the tool definitions), so a change in score can be tied to a change in the prompt.
- **Outcomes:** each case ends as one of four. `quality`: Ask answered. `unavailable`: Ask replied that it is unavailable. `budget`: the eval key's limit was reached. `download_failed`: a lookup could not download its data (this wins over `quality`).
- **Scores:** `pass` is recorded only for `quality` outcomes, so the pass rate leaves infrastructure out. It is 1 when the answer is the expected kind, says nothing the case rules out, and every sentence is grounded in what the lookups returned. On every case: `outcome`, `tool_calls`, `latency_s`, `tokens_in`, `tokens_out`, `cost_usd` and `gate_tokens` (the input tokens TypeSafe billed for the relevance gate, also in the case's trace outputs; 0 when the gate ran without a key). On answered cases: `fallback` and, where the case lists sentences the answer must contain, `includes_ok`. There are no retries: a case runs once in each run of the set, as a visitor would have met it.
- **Declines:** the fallback, and an answer that only says "Nothing recorded on this site answers that." (with or without the advice notice), are both declines (`declined` in `scripts/ask-judge.mjs`, which the runner and the live script share). A decline scores `fallback` 1, passes only where the case allows the fallback, is never sent to the relevance judge, and is never counted as answered.
- **Answer rate:** `answer_rate` in the result JSON is `answered / should_answer`. The questions Ask should answer are the cases that expect an answer, or also accept one, and do not expect the line that nothing recorded answers; of those it replied to (infrastructure outcomes are left out, as from the pass rate), the answered ones got an answer or a clarifying question rather than a decline or a refusal. `counts` carries `answered` and `should_answer`, and the job summary gives the rate. It keeps a lower unrelated score from being bought by declining more. The summary's "Replied" line is wider: every reply with the outcome `quality`, a refusal or a decline too.
- **Repetitions in the result:** with more than one, `counts`, `relevance` and `answer_rate` are over every run together (the job summary calls these "pooled"), and `repetitions` gives four metrics (`pass_rate`, `mean_relevance`, `mean_unrelated` and `answer_rate`), each as its mean over the runs (the summary's "mean of runs"), its worst run (the lowest, or for unrelated the highest) and each run's value, since a target is met on the mean and no run may miss it by more than 0.05. `failures` then lists every case that failed in any run, with how many runs it failed (`{"id", "failed"}`), so a case that must pass in every run shows when it did not. With one run the result keeps its earlier shape, plus `answer_rate`.
- **Relevance judge:** `pass` cannot see an answer whose records are true but do not answer the question, that gives part of an answer as if it were all of it, or that answers a different aspect. `scripts/ask-relevance.mjs` asks TypeSafe's Jev model (`jev-latest`, which returns typed judgments and probabilities, not text) two questions about each answered case whose answer is an answer, given the question, the sentences and the labels of what they cite:
  - `relevance`: how directly the answer responds to what was asked, a score over four levels (about something else; the right subject but a different kind of information; only part of it, without saying so; what was asked), scaled to 0 to 1.
  - `unrelated`: the probability that at least one sentence is about something the question does not ask.
  - Declines (fallbacks, and answers that only say nothing recorded answers), refusals, clarifies and infrastructure outcomes are not judged, and the judge never changes `pass`. A case the judge could not answer for (an error, a malformed reply or a 15-second timeout) gets no relevance scores.
  - The result JSON and the job summary give `relevance`: how many cases were judged, the two means, the judge's billed input tokens, the judge versions that answered (`judge_models`, what `jev-latest` resolved to), how many cases the judge could not answer for (`unavailable`), how many answers asked the reader to clarify (`clarified`, counted apart) and the relevance gate's input tokens over the run (`gate_tokens`, on its own summary line). Without `TYPESAFE_API_KEY` the run goes on and prints that the judge was skipped.
- **Judge check:** before the judge's scores are trusted, check it against hand labels with `gh workflow run ask-evals.yml --ref main -f task=judge-check`. That dispatch skips the evals and runs a job of its own, holding the TypeSafe key alone, which runs `node scripts/ask-langsmith.mjs judge-check`.
  - **The labels:** `tests/ask-relevance-labels.json` holds the owner's five answers from the live site (21 Oct 2026) and seven built from sentences Ask renders, each labelled `good`, `partial` or `bad`, with why. The seven built ones carry `sources`, the labels of what their sentences cite as the checker renders them, and the judge gets them as a run sends an answer's. The owner's five carry none, so for those the judge sees the question and the sentences only.
  - **The output:** one row per label (relevance, unrelated, agree or disagree), then how many agree and the judge's input tokens.
  - **Agreement:** `good` when relevance is at least 0.67 and unrelated under 0.5; `bad` when relevance is under 0.5 or unrelated at least 0.5; `partial` when relevance is from 0.33 to under 0.9. These thresholds are provisional, set before the judge has seen a real answer, and live in one place (`THRESHOLDS` in `scripts/ask-relevance.mjs`). A known tension in the rubric: the bands overlap (relevance from 0.33 to under 0.5 agrees with both `partial` and `bad`, and from 0.67 to under 0.9 with both `good` and `partial`). The owner's DJI answer, a date where an age was asked and labelled `partial`, fits both the "different kind of information" level (0.33) and the "only part" level (0.67), so the `partial` band is wide enough to take either.
  - **Exit codes:** 0 whatever the agreement, since the check is informational; 1 when the judge was unavailable for a label; 2 without `TYPESAFE_API_KEY`.
- **Failure notes:** a case with `pass` 0 gets a `note` of "Under review · date · commit". To replace it, add `{ "experiment": "<full experiment name>", "case": "<case id>", "note": "<what went wrong>" }` to the array in `tests/ask-eval-notes.json` and merge to main. The `notes` job then posts each note over "Under review", and fails if an entry's experiment, case or note is not found.
- **Issues:** a weekly run opens an issue titled `Ask evals: weekly run failed (date)` when any answered case fails, or when no case was answered. It lists the failed case ids and links the experiment. An open issue with that title gets a comment instead of a second issue. A weekly run that stops on an error, runs past its time limit or crashes opens the same issue, with the run's link in place of case ids.
- **Secrets:** `LANGSMITH_API_KEY`, `OPENROUTER_EVAL_KEY` and `TYPESAFE_API_KEY`, all GitHub repository secrets and nowhere else. The workflow hands the second to the runner as `OPENROUTER_API_KEY`, the name Ask reads. Only three steps can see them: the one that runs the cases gets all three, the one that posts the notes gets the LangSmith key, and the judge check gets the TypeSafe key. The issue job holds none, and no key is printed or traced. Without the LangSmith or OpenRouter key the runner stops before any call and names the missing one; without the TypeSafe key it skips the judge. The cases go through Ask's relevance gate as a visitor's question does, on the same TypeSafe key, traced as the step `gate` with the answer it was handed (never the key).
- **Cost:** about $0.03 to $0.90 a run: 45 questions at the Ask cost estimates above (three times that with three repetitions), a typical one about $0.0007 and the worst case about $0.02. A run comparing another model costs what OpenRouter charges for that model. The relevance judge and the relevance gate add TypeSafe's charge for their input tokens, which the job summary reports. The eval key is a separate OpenRouter key with a $2 monthly limit. If it runs out mid-run, the remaining cases are `budget`, get no `pass` score, and open no issue unless no case was answered.
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
