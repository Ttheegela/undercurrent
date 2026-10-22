// The relevance judge: TypeSafe's Jev reads a question and the sentences Ask answered it with, and returns typed judgments, not text:
// how directly the answer responds (a score over four levels, low to high) and whether any sentence that cites a record is beside the
// point (a noul). It sits beside the LangSmith runner's deterministic `pass` and never changes it. It measures what `pass` can't see:
// true records that don't answer the question, a part given as if it were the whole, or a different aspect answered. `unrelated` reads
// only the record sentences (`records` in the state): the fixed lines that cite nothing ("Showing N of M.", the part-answer line, the
// notice) are scope statements, which Ask's live gate never judges either. `addresses` reads the whole answer, so a "Showing" line still tells it the
// answer is partial. An answer with no record sentence is not asked `unrelated` at all.
//
// The API, as https://docs.typesafe.ai/api/system-one.md, /primitives/score.md and /primitives/noul.md give it: POST /v1/systemone
// with a bearer key and {model, state, questions}. A score question's criteria are its levels, numbered from 0; its answer is {score
// (probability-weighted, so it can fall between levels), probabilities, confidence, legend}. A noul's answer is {noul: probability of
// yes}. The response names the model that answered, and usage.input_tokens is what is billed. Plain fetch, so no SDK is added; the
// tests inject a fake one.
export const JUDGE_MODEL = "jev-latest";
const ENDPOINT = "https://api.typesafe.ai/v1/systemone";

export const QUESTIONS = {
  addresses: {
    type: "score",
    instructions: "How directly does the answer respond to what the question asks?",
    criteria: [
      "The answer is about something other than what the question asks: its records do not bear on the question.",
      "The answer is about the right subject but gives a different kind of information than the question asks for, for example the question asks how many or how long and the answer gives some other figure or fact.",
      "The answer gives only part of what the question asks for and does not say that it is partial or only examples.",
      "The answer gives what the question asks for.",
    ],
  },
  unrelated: {
    type: "noul",
    instructions: "Does any sentence in `records` present a record or fact that does not bear on the question, as though it answered it?",
    criteria: { true: "At least one sentence in `records` is about something the question does not ask about.", false: "Every sentence in `records` bears on what the question asks." },
  },
};
const TOP = QUESTIONS.addresses.criteria.length - 1; // the highest level's number

const within = (x, lo, hi) => typeof x === "number" && x >= lo && x <= hi;
const unavailable = () => {
  console.error("ask-relevance: judge unavailable"); // (fixed: never the response text, which can quote the request, nor the key)
  return null;
};

/**
 * Judges one answer. `sentences` are its sentences' text, `records` the text of those that cite a record, and `sources` the labels of
 * what it cites. Resolves to {relevance (the score over 0..1), relevance_probabilities, relevance_confidence, unrelated (the noul, or
 * null when there are no records and it was not asked), judge_model (the model that answered), input_tokens}, or to null when there is
 * no key, the call fails or times out, or the body is not what the docs describe.
 */
export async function judgeRelevance({ question, sentences, records, sources }, { fetch, apiKey, model = JUDGE_MODEL, timeoutMs = 15000 }) {
  if (!apiKey) return unavailable();
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs); // (covers reading the body too)
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, state: { question, answer: sentences, records, sources }, questions: records.length ? QUESTIONS : { addresses: QUESTIONS.addresses } }),
      signal: abort.signal,
    });
    if (!res.ok) return unavailable();
    const { model: judge_model, answers, usage } = await res.json();
    const [score, noul] = [answers?.addresses?.score, records.length ? answers?.unrelated?.noul : null];
    if (typeof judge_model !== "string" || !within(score, 0, TOP) || (noul !== null && !within(noul, 0, 1)) || !Number.isInteger(usage?.input_tokens)) return unavailable();
    const { probabilities, confidence } = answers.addresses;
    return { relevance: score / TOP, relevance_probabilities: probabilities, relevance_confidence: confidence, unrelated: noul, judge_model, input_tokens: usage.input_tokens };
  } catch {
    return unavailable();
  } finally {
    clearTimeout(timer);
  }
}

// ---- the judge check: does the judge agree with hand labels? -------------------------------------------------------------

/** When a judgment agrees with a hand label (good, partial or bad). Provisional: to be tuned once the check has run. */
export const THRESHOLDS = {
  good: { relevance: 0.67, unrelated: 0.5 }, // relevance at least 0.67 and unrelated under 0.5
  bad: { relevance: 0.5, unrelated: 0.5 }, // relevance under 0.5, or unrelated at least 0.5
  partial: { low: 0.33, high: 0.9 }, // relevance from 0.33 up to, not including, 0.9
};
const RULES = {
  good: (r, t) => r.relevance >= t.relevance && r.unrelated < t.unrelated,
  bad: (r, t) => r.relevance < t.relevance || r.unrelated >= t.unrelated,
  partial: (r, t) => r.relevance >= t.low && r.relevance < t.high,
};
export const agrees = (label, r) => RULES[label](r, THRESHOLDS[label]);

/**
 * Runs the judge on each hand-labelled answer, {id, question, sentences, sources?, label, why}, one at a time, sending its sources as
 * a run sends an answer's (none when it has none, as the owner's live answers have). A label's sentences carry no sources of their own,
 * and each is a listing, quote or claim, so every one is sent as a record: the check measures `unrelated` as it did before. Resolves to {rows: [{id, label, relevance, unrelated, verdict: agree|disagree|unavailable}],
 * agreed, unavailable, total, input_tokens, judge_models}.
 */
export async function judgeCheck(labels, { fetch, apiKey }) {
  const rows = [];
  const models = new Set();
  let tokens = 0;
  for (const l of labels) {
    const r = await judgeRelevance({ question: l.question, sentences: l.sentences, records: l.sentences, sources: l.sources ?? [] }, { fetch, apiKey });
    if (r) {
      tokens += r.input_tokens;
      models.add(r.judge_model);
    }
    rows.push({ id: l.id, label: l.label, relevance: r?.relevance ?? null, unrelated: r?.unrelated ?? null, verdict: !r ? "unavailable" : agrees(l.label, r) ? "agree" : "disagree" });
  }
  const n = (verdict) => rows.filter((r) => r.verdict === verdict).length;
  return { rows, agreed: n("agree"), unavailable: n("unavailable"), total: rows.length, input_tokens: tokens, judge_models: [...models] };
}

/** The check as plain text: one row per label, then how many agree and what the judge read. */
export function checkReport({ rows, agreed, unavailable, total, input_tokens, judge_models }) {
  const cell = (x) => (x === null ? "-" : x.toFixed(2));
  const table = [["id", "label", "relevance", "unrelated", "verdict"], ...rows.map((r) => [r.id, r.label, cell(r.relevance), cell(r.unrelated), r.verdict])];
  const width = table[0].map((_, i) => Math.max(...table.map((row) => row[i].length)));
  return [
    ...table.map((row) => row.map((c, i) => c.padEnd(width[i])).join("  ").trimEnd()),
    "",
    `${agreed} of ${total} agree${unavailable ? `, ${unavailable} unavailable` : ""}. Judge input tokens: ${input_tokens}${judge_models.length ? ` (${judge_models.join(", ")})` : ""}.`,
  ].join("\n");
}
