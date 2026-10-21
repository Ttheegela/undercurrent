// The relevance judge: TypeSafe's Jev reads a question and the sentences Ask answered it with, and returns typed judgments, not text:
// how directly the answer responds (a score over four levels, low to high) and whether any sentence is beside the point (a noul). It
// sits beside the LangSmith runner's deterministic `pass` and never changes it. It measures what `pass` can't see: true records that
// don't answer the question, a part given as if it were the whole, or a different aspect answered.
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
      "The answer gives what the question asks for, or clearly says it shows only part of it or only examples.",
    ],
  },
  unrelated: {
    type: "noul",
    instructions: "Does the answer include any record or sentence that does not bear on the question, presented as though it answered it?",
    criteria: { true: "At least one sentence is about something the question does not ask about.", false: "Every sentence bears on what the question asks." },
  },
};
const TOP = QUESTIONS.addresses.criteria.length - 1; // the highest level's number

const within = (x, lo, hi) => typeof x === "number" && x >= lo && x <= hi;
const unavailable = () => {
  console.error("ask-relevance: judge unavailable"); // (fixed: never the response text, which can quote the request, nor the key)
  return null;
};

/**
 * Judges one answer. `sentences` are its sentences' text and `sources` the labels of what it cites. Resolves to {relevance (the
 * score over 0..1), relevance_probabilities, relevance_confidence, unrelated (the noul), judge_model (the model that answered),
 * input_tokens}, or to null when there is no key, the call fails or times out, or the body is not what the docs describe.
 */
export async function judgeRelevance({ question, sentences, sources }, { fetch, apiKey, model = JUDGE_MODEL, timeoutMs = 15000 }) {
  if (!apiKey) return unavailable();
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs); // (covers reading the body too)
  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, state: { question, answer: sentences, sources }, questions: QUESTIONS }),
      signal: abort.signal,
    });
    if (!res.ok) return unavailable();
    const { model: judge_model, answers, usage } = await res.json();
    const [score, noul] = [answers?.addresses?.score, answers?.unrelated?.noul];
    if (typeof judge_model !== "string" || !within(score, 0, TOP) || !within(noul, 0, 1) || !Number.isInteger(usage?.input_tokens)) return unavailable();
    const { probabilities, confidence } = answers.addresses;
    return { relevance: score / TOP, relevance_probabilities: probabilities, relevance_confidence: confidence, unrelated: noul, judge_model, input_tokens: usage.input_tokens };
  } catch {
    return unavailable();
  } finally {
    clearTimeout(timer);
  }
}
