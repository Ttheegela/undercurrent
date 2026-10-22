// How an Ask answer is judged against its case's `expect`: its kind, and the phrases it must not contain (the model's choices vary, so
// nothing else fails a case). Shared by the live script (scripts/ask-live-eval.mjs) and the real-model runner, so both judge alike.
import { NOT_ADVICE, NOTHING_ANSWERS } from "./ask-oracle.mjs";

// `also`: other kinds that count as right, where a grounded answer is as good as the expected kind
export const expected = (c) => `${c.expect.kind}${c.expect.also?.length ? ` (or ${c.expect.also.join(" or ")})` : ""}${c.expect.fallback ? " (or fallback)" : ""}${c.expect.notice ? " (or an answer ending in the advice notice)" : ""}`;
// The server refuses nothing on its own: an advice-shaped question the model answers instead of refusing gets records and the notice
const noticed = (c, kind, sentences) => c.expect.notice === true && kind === "answer" && sentences.at(-1) === NOT_ADVICE;
/** Whether lower-cased `text` holds an include: a phrase, or a list of phrases any one of which will do (an answer that can rightly take either of two shapes). */
export const holds = (text, include) => (Array.isArray(include) ? include.some((s) => holds(text, s)) : text.includes(include.toLowerCase()));

/**
 * A decline: the fallback, or an answer that only says nothing recorded on the site answers (with or without the advice notice). Neither
 * gives a record, so wherever the fallback is a decline this is one too: it is not counted as answered, not sent to the relevance judge,
 * and right only where the case allows the fallback.
 */
export function declined(a) {
  if (a?.kind === "fallback") return true;
  const said = a?.kind === "answer" ? a.sentences.map((s) => String(s.text)).filter((t) => t !== NOT_ADVICE) : [];
  return said.length === 1 && said[0] === NOTHING_ANSWERS;
}

/**
 * Judges one reply to the case's question. `result` is what runAsk returns (and what the endpoint replies with): {ok:true, answer} or
 * {ok:false, reason}; a failed reply may carry `why`, shown in the message. The kind is the answer's kind, or the reason when there was
 * no answer; `fallback` is whether it declined; `includesOk` is null where the case has no `includes`; `problems` are the live script's
 * messages.
 */
export function judge(c, result) {
  const a = result.ok ? result.answer : null;
  const kind = a ? a.kind : result.reason;
  const sentences = a ? a.sentences.map((s) => String(s.text)) : [];
  const text = sentences.join("\n").toLowerCase();
  const found = (c.expect.excludes ?? []).filter((s) => text.includes(s.toLowerCase()));
  const fallback = declined(a);
  const kindOk = fallback
    ? c.expect.kind === "fallback" || c.expect.fallback === true
    : kind === c.expect.kind || (c.expect.also ?? []).includes(kind) || noticed(c, kind, sentences);
  const problems = [];
  if (!kindOk) problems.push(`expected ${expected(c)}, got ${kind}${fallback && kind !== "fallback" ? " (only that nothing recorded answers: a decline)" : ""}${result.why ? ` (${result.why})` : ""}`);
  for (const s of found) problems.push(`the text contains ${JSON.stringify(s)}`);
  const includesOk = c.expect.includes?.length ? c.expect.includes.every((s) => holds(text, s)) : null;
  return { kind, sentences, kindOk, excludesOk: !found.length, includesOk, fallback, problems };
}
