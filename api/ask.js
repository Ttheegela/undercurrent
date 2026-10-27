// POST /api/ask: a short tool loop against Claude Haiku 5.5 through OpenRouter, then the server's own checker (_ask_check.js) writes
// every sentence of the answer from the evidence the tools returned, and the relevance gate (_ask_gate.js, TypeSafe's Jev) drops those
// that don't bear on the question. The model writes no text. GET /api/ask reports whether Ask is switched on and never calls the model.
// No message text is logged or stored: the visitor limit holds a hash of the address and the times of its last questions, nothing
// else, and no log line or error carries more than a fixed phrase and a status.
import { createHash, randomBytes } from "node:crypto";
import { TOOLS, runTool } from "./_ask_tools.js";
import { checkAnswer, withVerdict } from "./_ask_check.js";
import { gate, GATE_MS } from "./_ask_gate.js";
import { SYSTEM_PROMPT } from "./_ask_prompt.js";

const OPENROUTER = "https://openrouter.ai/api/v1/chat/completions";
export const MODEL = "anthropic/claude-haiku-5.5";
const FORCE_ANSWER = { type: "function", function: { name: "answer" } };
const TOOL_ROUNDS = 4; // then one call forced to `answer`
const CALLS_PER_ROUND = 6;
const MAX_TOOL_CALLS = 10; // in all, across the rounds: every call resends all earlier results, so this is what bounds a question's cost
const CALL_MS = 20_000;
const MIN_CALL_MS = 3_000; // a model call is not started with less than this left
const TOTAL_MS = 26_000; // the whole request; the function is cut off at 30 s (vercel.json)
const MAX_MESSAGES = 10;
const MAX_CHARS = 500;
const MAX_BODY = 16 * 1024;
const PER_HOUR = 20;
const HOUR = 3_600_000;
const MAX_VISITORS = 5000;
const UNAVAILABLE = { ok: false, reason: "unavailable" };

const reply = (status, body, cache = "no-store") => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": cache } });
const refuse = (status, reason) => reply(status, { ok: false, reason });

export async function GET() {
  return reply(200, { ok: true, enabled: Boolean(process.env.OPENROUTER_API_KEY), public: process.env.ASK_PUBLIC === "1" }, "public, s-maxage=60"); // (a new deployment gets a new cache)
}

// ---- the per-visitor limit ----------------------------------------------------------------------------------------
// Best effort, per function instance (OpenRouter's $5 key limit is the hard backstop). Keys are the SHA-256 of the visitor's address with
// a random salt of this instance, so the hash cannot be undone by trying every IPv4 address.
// An entry moves to the end whenever its visitor asks, so the front holds the least recently active: that is where stale entries and,
// past the cap, the oldest ones are dropped.
export const visitors = new Map(); // sha256(salt, address) -> times of the visitor's questions in the last hour
const salt = randomBytes(16);

function allowed(request, now) {
  const address = request.headers.get("x-forwarded-for")?.split(",")[0].trim() || request.headers.get("x-real-ip") || "";
  const key = createHash("sha256").update(salt).update(address).digest("hex");
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

/** True when the Origin is this site's: the request's own origin, or https:// plus the forwarded host (request.url can arrive as http:// behind a proxy). */
function fromThisSite(request) {
  const origin = request.headers.get("origin");
  const host = (request.headers.get("x-forwarded-host") || request.headers.get("host") || "").split(",")[0].trim();
  return Boolean(origin) && (origin === new URL(request.url).origin || (host !== "" && origin === `https://${host}`));
}

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
  // A user turn is at most 500 characters. An assistant turn is the server's own earlier answer, which can run longer: it is context
  // only, so it is trimmed and cut to 500 (not through a character that straddles the cut) instead of refusing the follow-up, and
  // one that is only whitespace is dropped.
  const fine = (m) => typeof m?.text === "string" && (m.role === "assistant" || (m.role === "user" && m.text.trim() && m.text.length <= MAX_CHARS));
  if (!list.every(fine) || list.at(-1).role !== "user") return null;
  const turns = list.map((m) => ({ role: m.role, content: m.role === "assistant" ? m.text.trim().slice(0, MAX_CHARS).replace(/[\ud800-\udbff]$/, "") : m.text }))
    .filter((t) => t.content);
  while (turns[0].role === "assistant") turns.shift();
  return turns;
}

// ---- the model ----------------------------------------------------------------------------------------------------

const nextMonth = (now) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString().slice(0, 10);
/** OpenRouter's reset time as its day (UTC), or "" when it is not a date. */
function dayOf(at) {
  const t = typeof at === "string" ? Date.parse(at) : NaN;
  const day = Number.isNaN(t) ? "" : new Date(t).toISOString().slice(0, 10);
  return /^\d{4}-\d\d-\d\d$/.test(day) ? day : "";
}
/** The day the key's limit resets: OpenRouter's own date, else the first of next month (UTC). */
const resetsOn = (at, now) => dayOf(at) || nextMonth(now);

/** One call to `model`: {message, usage} on success (usage is OpenRouter's, or null), else {stop: the reply to give the reader}. */
async function callModel(messages, toolChoice, deadline, now, model) {
  const left = deadline - Date.now();
  if (left < MIN_CALL_MS) return { stop: UNAVAILABLE };
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
      // (the model reasons before it calls a tool, and that counts here: at 800 a long reasoning left no room for the answer call)
      body: JSON.stringify({ model, max_tokens: 2000, provider: { data_collection: "deny" }, messages, tools: TOOLS, tool_choice: toolChoice }),
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
    // the guardrail's daily budget is spent: Ask rests until its reset day (a lifetime budget has none, so then it only rests)
    if (status === 403 && source === "openrouter_guardrail_budget") {
      const day = dayOf(error.metadata.resets_at);
      return { stop: { ok: false, reason: "resting", ...(day && { resets: day, daily: true }) } };
    }
    // the account has no credit left (a 402 with no limit source): Ask rests until it is topped up, which has no date
    if (status === 402 && !source) return { stop: { ok: false, reason: "resting" } };
    console.error("ask: the model call returned status", status); // (the status only: a body can echo the question)
    return { stop: UNAVAILABLE };
  }
  const message = body?.choices?.[0]?.message;
  if (message && typeof message === "object") return { message, usage: body.usage ?? null };
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

// The checks a question ran, for the panel's one line: where its tool calls looked, and whether each found anything there (a check
// that found nothing still ran). check_lists looks in the lists, the research and OpenSanctions at once. Only an answer or a clarify
// says them: a refusal looked nowhere, and a fallback checked nothing.
const LOOKS_IN = { check_lists: ["lists", "research", "wider"], research: ["research"], connections: ["wider"], changes: ["updates"], chips: ["chips"], site_docs: ["docs"] };
const FINDS = {
  lists: (e) => e.kind === "list" || (e.kind === "count" && Boolean(e.list) && e.n > 0),
  research: (e) => e.kind === "research" || (e.kind === "count" && !e.list && e.unit === "ships" && e.n > 0),
  wider: (e) => e.kind === "opensanctions" || e.kind === "connection" || e.kind === "lobbying",
  docs: (e) => e.kind === "doc",
  updates: (e) => e.kind === "change" && e.found !== false,
  chips: (e) => e.kind === "chips" || e.kind === "chips_firm",
};
function checksOf(looked, ev) {
  return Object.keys(FINDS).filter((name) => [...looked].some((tool) => LOOKS_IN[tool]?.includes(name))).map((name) => ({ name, found: ev.some(FINDS[name]) }));
}

/** Which way an answer fell back, for the log: never the question or the model's words, only the code for its path. */
function fallbackReason(calls, final, raw, toolFailed) {
  if (!calls.length) return "no_call";
  if (!final) return "forced_not_answer";
  if (calls.length > 1) return "answer_beside_calls";
  if (raw === undefined) return "bad_arguments";
  if (raw?.kind !== "answer" && raw?.kind !== "clarify") return "wrong_kind";
  return toolFailed ? "tool_failed" : "nothing_checked";
}

/**
 * Up to four rounds of tool calls (ten calls in all), then one call forced to `answer`. The answer call's arguments go to the checker
 * with the evidence the tools returned in this request, which is the only evidence there is: earlier turns are plain context. An answer
 * (not a refusal, a clarify or the fallback) then goes through the relevance gate (_ask_gate.js), inside the request's 26 s, unless the
 * question is a follow-up: the gate is handed it `skipped` and sends nothing, since Jev would need the earlier turns and only the latest
 * question is ever sent. callModel, runTool, checkAnswer and gate are used as `wrap` returns them, for this request only, and each is
 * awaited: a tracing wrapper returns a promise even for the checker.
 */
async function converse(history, now, wrap, modelId) {
  const model = wrap("callModel", callModel);
  const tool = wrap("runTool", runTool);
  const check = wrap("checkAnswer", checkAnswer);
  const relevant = wrap("gate", gate);
  const today = now.toISOString().slice(0, 10);
  const question = history.at(-1).content;
  const deadline = Date.now() + TOTAL_MS;
  const ev = [];
  const ctx = { today, failed: new Map() }; // one for the request: a download that failed stays failed until it ends (see _ask_tools.js)
  const messages = [{ role: "system", content: SYSTEM_PROMPT.replace("{today}", today) }, ...history];
  let used = 0;
  let toolFailed = false; // a call that returned an error: then an answer of no sentences can't say that nothing answers
  const looked = new Set(); // the tools whose calls ran without an error
  const done = (answer) => {
    const checks = answer.kind === "answer" || answer.kind === "clarify" ? checksOf(looked, ev) : [];
    return checks.length ? { ok: true, answer, checks } : { ok: true, answer };
  };
  for (let round = 0; round <= TOOL_ROUNDS; round++) {
    const forced = round === TOOL_ROUNDS || used >= MAX_TOOL_CALLS;
    const { message, stop } = await model(messages, forced ? FORCE_ANSWER : "auto", deadline, now, modelId);
    if (stop) return stop;
    const calls = (Array.isArray(message.tool_calls) ? message.tool_calls : []).filter((c) => typeof c?.function?.name === "string");
    const final = calls.find((c) => c.function.name === "answer");
    // An answer call is final, but only alone: beside lookups it was written before their results, so it cannot cite them and would
    // read as complete without them. A forced call that is not an answer, and a reply with no call, are the fallback.
    // (ages count to the request's own date, the one the tools and the prompt use)
    if (final || forced || !calls.length) {
      const raw = final && calls.length === 1 ? parse(final.function.arguments) : undefined;
      const answer = withVerdict(await check(raw, ev, { question, today, toolFailed }));
      if (answer.kind === "fallback") console.error("ask: fallback", fallbackReason(calls, final, raw, toolFailed));
      if (answer.kind !== "answer") return done(answer);
      // ("And the other one?" can't be judged on its own: shown unchecked, the step still traced)
      if (history.filter((m) => m.role === "user").length > 1) return done(await relevant(question, answer, { skipped: "follow-up" }));
      // the gate gives up 50 ms before the request's time is out, so a slow answer is still shown, unchecked
      const timeoutMs = Math.max(0, Math.min(GATE_MS, deadline - Date.now() - 50));
      const gated = await relevant(question, answer, { fetch, timeoutMs });
      if (gated.kind === "fallback") console.error("ask: fallback", "gate_dropped_all");
      return done(gated);
    }
    const asked = calls.slice(0, Math.min(CALLS_PER_ROUND, MAX_TOOL_CALLS - used)).map((c, i) => ({
      id: typeof c.id === "string" && c.id ? c.id : `call_${round}_${i}`,
      type: "function",
      function: { name: c.function.name, arguments: typeof c.function.arguments === "string" ? c.function.arguments : JSON.stringify(c.function.arguments ?? {}) },
    }));
    used += asked.length;
    messages.push({ role: "assistant", content: null, tool_calls: asked });
    for (const c of asked) {
      if (deadline - Date.now() <= 0) return UNAVAILABLE;
      const result = await tool(c.function.name, parse(c.function.arguments), ev, ctx);
      if (result?.error) toolFailed = true;
      else looked.add(c.function.name);
      messages.push({ role: "tool", tool_call_id: c.id, content: JSON.stringify(result) });
    }
  }
}

/**
 * One question, end to end: {ok: true, answer} or {ok: false, reason, resets?}, which is what POST replies with. `wrap(name, fn)` is
 * the eval runner's hook to trace callModel, runTool, checkAnswer and gate; it defaults to leaving them as they are. `model` is the OpenRouter
 * model id the eval runner compares; it defaults to MODEL. POST passes neither, so the site always uses MODEL.
 */
export async function runAsk(history, now, { wrap = (name, fn) => fn, model = MODEL } = {}) {
  // the whole request is abandoned at 26 s, even if a tool is stuck (it is checked between steps too, so nothing new starts after that)
  let timer;
  const late = new Promise((resolve) => { timer = setTimeout(resolve, TOTAL_MS, UNAVAILABLE); });
  try {
    return await Promise.race([converse(history, now, wrap, model), late]);
  } finally {
    clearTimeout(timer);
  }
}

// ---- the endpoint -------------------------------------------------------------------------------------------------

export async function POST(request) {
  try {
    if (!fromThisSite(request)) return refuse(403, "forbidden");
    if (!/^application\/json\s*(;|$)/i.test(request.headers.get("content-type") ?? "")) return refuse(415, "unsupported");
    if (!process.env.OPENROUTER_API_KEY) return refuse(503, "disabled");
    const text = await readBody(request);
    if (text === null) return refuse(413, "too_large");
    const history = parseMessages(text);
    if (!history) return refuse(400, "bad_request");
    const now = new Date(Date.now());
    if (!allowed(request, now.getTime())) return refuse(429, "busy");
    return reply(200, await runAsk(history, now));
  } catch {
    console.error("ask: unexpected failure"); // (no error text: it can quote the request)
    return reply(200, UNAVAILABLE);
  }
}
