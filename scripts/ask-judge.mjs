// How an Ask answer is judged against its case's `expect`: its kind, and the phrases it must not contain (the model's choices vary, so
// nothing else fails a case). Shared by the live script (scripts/ask-live-eval.mjs) and the real-model runner, so both judge alike.
import { NOT_ADVICE } from "./ask-oracle.mjs";

// `also`: other kinds that count as right, where a grounded answer is as good as the expected kind
export const expected = (c) => `${c.expect.kind}${c.expect.also?.length ? ` (or ${c.expect.also.join(" or ")})` : ""}${c.expect.fallback ? " (or fallback)" : ""}${c.expect.notice ? " (or an answer ending in the advice notice)" : ""}`;
// The server refuses nothing on its own: an advice-shaped question the model answers instead of refusing gets records and the notice
const noticed = (c, kind, sentences) => c.expect.notice === true && kind === "answer" && sentences.at(-1) === NOT_ADVICE;

/**
 * Judges one reply to the case's question. `result` is what runAsk returns (and what the endpoint replies with): {ok:true, answer} or
 * {ok:false, reason}; a failed reply may carry `why`, shown in the message. The kind is the answer's kind, or the reason when there was
 * no answer; `includesOk` is null where the case has no `includes`; `problems` are the live script's messages.
 */
export function judge(c, result) {
  const a = result.ok ? result.answer : null;
  const kind = a ? a.kind : result.reason;
  const sentences = a ? a.sentences.map((s) => String(s.text)) : [];
  const text = sentences.join("\n").toLowerCase();
  const found = (c.expect.excludes ?? []).filter((s) => text.includes(s.toLowerCase()));
  const fallback = kind === "fallback";
  const kindOk = kind === c.expect.kind || (c.expect.also ?? []).includes(kind) || (fallback && c.expect.fallback === true) || noticed(c, kind, sentences);
  const problems = [];
  if (!kindOk) problems.push(`expected ${expected(c)}, got ${kind}${result.why ? ` (${result.why})` : ""}`);
  for (const s of found) problems.push(`the text contains ${JSON.stringify(s)}`);
  const includesOk = c.expect.includes?.length ? c.expect.includes.every((s) => text.includes(s.toLowerCase())) : null;
  return { kind, sentences, kindOk, excludesOk: !found.length, includesOk, fallback, problems };
}
