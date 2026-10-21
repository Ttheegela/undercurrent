// POST /api/ask: a short tool loop against Claude Haiku 5.5 through OpenRouter, then the server's own checker (_ask_check.js) writes
// every sentence of the answer from the evidence the tools returned. The model writes no text. GET /api/ask reports whether Ask is
// switched on and never calls the model. No message text is logged or stored: the visitor limit holds a hash of the address and the
// times of its last questions, nothing else, and no log line or error carries more than a fixed phrase and a status.
import { createHash } from "node:crypto";
import { TOOLS, runTool } from "./_ask_tools.js";
import { checkAnswer } from "./_ask_check.js";
import { SYSTEM_PROMPT } from "./_ask_prompt.js";

const OPENROUTER = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = "anthropic/claude-haiku-5.5";
const FORCE_ANSWER = { type: "function", function: { name: "answer" } };
const TOOL_ROUNDS = 4; // then one call forced to `answer`
const CALLS_PER_ROUND = 6;
const CALL_MS = 20_000;
const TOTAL_MS = 25_000;
const MAX_MESSAGES = 10;
const MAX_CHARS = 500;
const MAX_BODY = 16 * 1024;
const PER_HOUR = 20;
const HOUR = 3_600_000;
const MAX_VISITORS = 5000;
const UNAVAILABLE = { ok: false, reason: "unavailable" };

const reply = (status, body) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const refuse = (status, reason) => reply(status, { ok: false, reason });

export async function GET() {
  return reply(200, { ok: true, enabled: Boolean(process.env.OPENROUTER_API_KEY), public: process.env.ASK_PUBLIC === "1" });
}

// ---- the per-visitor limit ----------------------------------------------------------------------------------------
// Best effort, per function instance (OpenRouter's $5 key limit is the hard backstop). Keys are the SHA-256 of the visitor's address.
// An entry moves to the end whenever its visitor asks, so the front holds the least recently active: that is where stale entries and,
// past the cap, the oldest ones are dropped.
export const visitors = new Map(); // sha256(address) -> times of the visitor's questions in the last hour

function allowed(request, now) {
  const address = request.headers.get("x-forwarded-for")?.split(",")[0].trim() || request.headers.get("x-real-ip") || "";
  const key = createHash("sha256").update(address).digest("hex");
  for (const [k, times] of visitors) {
    if (visitors.size < MAX_VISITORS && now - times.at(-1) < HOUR) break;
    visitors.delete(k);
  }
  const recent = (visitors.get(key) ?? []).filter((t) => now - t < HOUR);
  if (recent.length >= PER_HOUR) return false;
  visitors.delete(key);
  visitors.set(key, [...recent, now]);
  return true;
}

// ---- reading the request ------------------------------------------------------------------------------------------

/** The body as text, or null when it is over 16 KB (the declared length is checked first, the bytes as they arrive). */
async function readBody(request) {
  if (Number(request.headers.get("content-length")) > MAX_BODY) return null;
  const chunks = [];
  let size = 0;
  for await (const chunk of request.body ?? []) {
    size += chunk.length;
    if (size > MAX_BODY) return null;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** The turns to send the model, or null for a bad request. The panel sends its last 10 messages, which can open with an assistant turn. */
function parseMessages(text) {
  let list;
  try {
    list = JSON.parse(text)?.messages;
  } catch {
    return null;
  }
  if (!Array.isArray(list) || !list.length || list.length > MAX_MESSAGES) return null;
  const fine = (m) => (m?.role === "user" || m?.role === "assistant") && typeof m.text === "string" && m.text.trim() && m.text.length <= MAX_CHARS;
  if (!list.every(fine) || list.at(-1).role !== "user") return null;
  const turns = list.map((m) => ({ role: m.role, content: m.text }));
  while (turns[0].role === "assistant") turns.shift();
  return turns;
}

// ---- the model ----------------------------------------------------------------------------------------------------

const nextMonth = (now) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
/** The day the budget resets: OpenRouter's own date, else the first of next month (UTC). */
function resetsOn(at, now) {
  const t = typeof at === "string" ? Date.parse(at) : NaN;
  const day = Number.isNaN(t) ? "" : new Date(t).toISOString().slice(0, 10);
  return /^\d{4}-\d\d-\d\d$/.test(day) ? day : nextMonth(now);
}

/** One call: {message} on success, else {stop: the reply to give the reader}. */
async function callModel(messages, toolChoice, deadline, now) {
  const left = deadline - Date.now();
  if (left <= 0) return { stop: UNAVAILABLE };
  let res;
  let body;
  try {
    res = await fetch(OPENROUTER, {
      method: "POST",
      signal: AbortSignal.timeout(Math.min(CALL_MS, left)),
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "https://undercurrent-research.vercel.app",
        "X-Title": "Undercurrent",
      },
      body: JSON.stringify({ model: MODEL, max_tokens: 800, provider: { data_collection: "deny" }, messages, tools: TOOLS, tool_choice: toolChoice }),
    });
    body = await res.json();
  } catch {
    console.error("ask: the model call failed or timed out"); // (no error text: it can quote the request)
    return { stop: UNAVAILABLE };
  }
  const error = body?.error;
  if (!res.ok || error) {
    const status = Number(res.ok ? error?.code : res.status);
    const source = error?.metadata?.limit_source;
    // the key's $5 limit, or the account's credits, are spent: Ask rests until the date OpenRouter gives
    if ((status === 402 || status === 403) && (source === "openrouter_key_limit" || source === "openrouter_credits")) {
      return { stop: { ok: false, reason: "resting", resets: resetsOn(error.metadata.resets_at, now) } };
    }
    console.error("ask: the model call returned status", status); // (the status only: a body can echo the question)
    return { stop: UNAVAILABLE };
  }
  const message = body?.choices?.[0]?.message;
  if (message && typeof message === "object") return { message };
  console.error("ask: the model reply had no message");
  return { stop: UNAVAILABLE };
}

const parse = (args) => {
  try {
    return typeof args === "string" ? JSON.parse(args) : args;
  } catch {
    return undefined;
  }
};

/**
 * Up to four rounds of tool calls, then one call forced to `answer`. The answer call's arguments go to the checker with the evidence
 * the tools returned in this request, which is the only evidence there is: earlier turns are plain context.
 */
async function converse(history, now) {
  const today = now.toISOString().slice(0, 10);
  const question = history.at(-1).content;
  const deadline = Date.now() + TOTAL_MS;
  const ev = [];
  const messages = [{ role: "system", content: SYSTEM_PROMPT.replace("{today}", today) }, ...history];
  for (let round = 0; round <= TOOL_ROUNDS; round++) {
    const forced = round === TOOL_ROUNDS;
    const { message, stop } = await callModel(messages, forced ? FORCE_ANSWER : "auto", deadline, now);
    if (stop) return stop;
    const calls = (Array.isArray(message.tool_calls) ? message.tool_calls : []).filter((c) => typeof c?.function?.name === "string");
    const final = calls.find((c) => c.function.name === "answer");
    // an answer call (alone: tools beside it would run after the model chose what to cite), a forced call that is not one, or a reply with no call
    if (final || forced || !calls.length) return { ok: true, answer: checkAnswer(final && parse(final.function.arguments), ev, { question }) };
    const asked = calls.slice(0, CALLS_PER_ROUND).map((c, i) => ({
      id: typeof c.id === "string" && c.id ? c.id : `call_${round}_${i}`,
      type: "function",
      function: { name: c.function.name, arguments: typeof c.function.arguments === "string" ? c.function.arguments : JSON.stringify(c.function.arguments ?? {}) },
    }));
    messages.push({ role: "assistant", content: null, tool_calls: asked });
    for (const c of asked) {
      messages.push({ role: "tool", tool_call_id: c.id, content: JSON.stringify(await runTool(c.function.name, parse(c.function.arguments), ev, { today })) });
    }
  }
}

// ---- the endpoint -------------------------------------------------------------------------------------------------

export async function POST(request) {
  try {
    if (request.headers.get("origin") !== new URL(request.url).origin) return refuse(403, "forbidden");
    if (!/^application\/json\s*(;|$)/i.test(request.headers.get("content-type") ?? "")) return refuse(415, "unsupported");
    if (!process.env.OPENROUTER_API_KEY) return refuse(503, "disabled");
    const text = await readBody(request);
    if (text === null) return refuse(413, "too_large");
    const history = parseMessages(text);
    if (!history) return refuse(400, "bad_request");
    const now = new Date(Date.now());
    if (!allowed(request, now.getTime())) return refuse(429, "busy");
    return reply(200, await converse(history, now));
  } catch {
    console.error("ask: unexpected failure"); // (no error text: it can quote the request)
    return reply(200, UNAVAILABLE);
  }
}
