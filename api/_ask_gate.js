// Ask's relevance gate. TypeSafe's Jev reads the reader's question and each sentence an answer would show, with the labels of its
// sources, and judges whether it bears on what the question asks; the sentences that don't are dropped. The checker then numbers the
// sources again and rebuilds the "Showing N of M" lines (keepSentences in _ask_check.js), and an answer with nothing left says that
// nothing recorded answers. Fixed copy has no source (the part-answer line, the notice, the Showing lines, "nothing answers"): it is never
// sent or dropped. A caveat (what a none could not check, the source gaps of a range) is never sent either: it is kept exactly when the
// line it qualifies is. The gate fails open: with no key, a timeout, an HTTP error, a reply not as the docs give it, or an answer the
// checker did not write (it could not be rebuilt, so nothing is sent), the answer is shown as it is and one fixed line is logged. Nothing
// else is logged: never the question, a sentence or the key, which is read here and nowhere else in api/.
// The API, as https://docs.typesafe.ai/api/system-one.md and /primitives/noul.md give it: POST /v1/systemone with a bearer key and
// {model, state, questions}; a noul question's answer is {noul: the probability of yes, 0 to 1}. Plain fetch, passed in, so no SDK.
import { judgedSentences, keepSentences } from "./_ask_check.js";

const ENDPOINT = "https://api.typesafe.ai/v1/systemone";
/** A sentence stays when Jev's probability that it bears on the question is at least this. Provisional, until the evals tune it. */
export const GATE_THRESHOLD = 0.5;
/** The gate's time in ms, out of the request's 26 s. */
export const GATE_MS = 3000;

const unavailable = (answer) => {
  console.error("ask: relevance gate unavailable"); // (fixed: never the question, a sentence, the reply or the key)
  return answer;
};

/**
 * The answer with only the sentences that bear on `question`, or the answer as it is when the gate is unavailable (see above), or
 * `skipped` (its reason, such as "follow-up": nothing is sent or logged). Never throws.
 */
export async function gate(question, answer, { fetch, apiKey = process.env.TYPESAFE_API_KEY, timeoutMs = GATE_MS, skipped } = {}) {
  try {
    if (skipped || !answer.sentences.some((s) => s.sources.length)) return answer; // skipped, or fixed copy only: nothing to judge
    const said = judgedSentences(answer);
    if (!said || !apiKey) return unavailable(answer);
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "jev-latest",
        state: { question, sentences: said.map((s, i) => ({ i, text: s.text, source: s.sources.map((x) => x.label).join("; ") })) },
        questions: Object.fromEntries(said.map((_, i) => [`s${i}`, { type: "noul", instructions: `Does sentence ${i} bear on what the question asks?` }])),
      }),
      signal: AbortSignal.timeout(timeoutMs), // (reading the reply too)
    });
    if (!res.ok) return unavailable(answer);
    const { answers } = await res.json();
    const yes = said.map((_, i) => answers?.[`s${i}`]?.noul);
    if (!yes.every((p) => typeof p === "number" && p >= 0 && p <= 1)) return unavailable(answer);
    const kept = new Set(said.filter((_, i) => yes[i] >= GATE_THRESHOLD).map((s) => s.text));
    return keepSentences(answer, (text) => kept.has(text));
  } catch {
    return unavailable(answer);
  }
}
