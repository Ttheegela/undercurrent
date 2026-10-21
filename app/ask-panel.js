// The Ask panel: a drawer (a full-height sheet on a phone) over any page. ask.js loads this on the first click; styles in ask-panel.css.
// /api/ask answers in sentences that are fixed copy, claims the server wrote, or quotes of the site's own data, each with its sources
// (see api/_ask_check.js). Everything the panel shows goes through escapeHtml, and every link through safeUrl (a rejected one shows as text).
// The conversation is the module variable `convo`: no storage, and closing the panel clears it.
import { escapeHtml, safeUrl, formatDate } from "./render.js";

export const STARTERS = ["What changed this week?", "Is TASSOS sanctioned?", "Who manages TASSOS?", "How long does it take to list a new semiconductor firm?"];
const NOTES = {
  unavailable: "Ask isn't available right now. Try the search on the home page.",
  busy: "You've asked a lot of questions this hour, so Ask needs a short break. Try again later; the search on the home page still works.",
  disabled: "Ask isn't switched on right now. Try the search on the home page.",
};
const SENT = 10; // messages sent with a question
const WAIT_MS = 35_000; // the server gives up at 26 s
const NEW_TAB = ' target="_blank" rel="noopener noreferrer"'; // a source opens beside the panel, so the conversation is not lost

const isText = (s) => typeof s?.text === "string" && s.text.trim() !== "";
const safe = (url) => (typeof url === "string" && safeUrl(url) !== "#" ? url : null);
const link = (url, inner, attrs = "") => (safe(url) ? `<a href="${escapeHtml(url)}"${attrs}>${inner}</a>` : inner);

/** A status note: resting (with its date), unavailable, busy or disabled. Anything else, or a date that is not one, says unavailable. */
export function renderStatus(reason, resets) {
  const day = reason === "resting" && typeof resets === "string" && /^\d{4}-\d\d-\d\d$/.test(resets) && !Number.isNaN(Date.parse(resets)) ? formatDate(resets) : "";
  const key = day ? "resting" : Object.hasOwn(NOTES, reason) ? reason : "unavailable";
  const text = day ? `Ask has used its budget for this month and is resting until ${day}. Everything else on the site works as usual.` : NOTES[key];
  return `<div class="ask-msg ask-status" data-reason="${key}"><p>${escapeHtml(text)}</p></div>`;
}

/** An answer from /api/ask: its sentences, each with numbered links to its sources, then the sources and the next steps. */
export function renderAnswer(rendered) {
  const sentences = Array.isArray(rendered?.sentences) ? rendered.sentences.filter(isText) : [];
  if (!sentences.length) return renderStatus("unavailable");
  const cited = new Map(); // n -> source, in order of number
  const refs = (list) => (Array.isArray(list) ? list : []).filter((s) => Number.isInteger(s?.n) && s.n > 0).map((s) => {
    if (!cited.has(s.n)) cited.set(s.n, s);
    const label = typeof s.label === "string" ? s.label : "";
    return safe(s.url)
      ? `<a class="ask-ref" href="${escapeHtml(s.url)}"${NEW_TAB} aria-label="${escapeHtml(`Source ${s.n}${label ? `: ${label}` : ""}`)}">${s.n}</a>`
      : `<span class="ask-ref">${s.n}</span>`;
  }).join("");
  const body = sentences.map((s) => `<p>${escapeHtml(s.text)}${refs(s.sources)}</p>`).join("");
  const sources = [...cited.values()].sort((a, b) => a.n - b.n)
    .map((s) => `<li value="${s.n}">${link(s.url, escapeHtml(s.label || `Source ${s.n}`), NEW_TAB)}</li>`).join("");
  const next = (Array.isArray(rendered.next) ? rendered.next : []).filter((n) => typeof n?.label === "string" && n.label)
    .map((n) => `<li>${link(n.href, escapeHtml(n.label))}</li>`).join("");
  const kind = ["answer", "refusal", "clarify", "fallback"].includes(rendered.kind) ? rendered.kind : "answer";
  return `<div class="ask-msg ask-a" data-kind="${kind}">${body}`
    + (sources ? `<p class="label">Sources</p><ol class="ask-src">${sources}</ol>` : "")
    + (next ? `<p class="label">Next</p><ul class="ask-next">${next}</ul>` : "") + "</div>";
}

/** What the server is told an assistant turn said: its sentences, joined by spaces (it cuts the text to 500 characters). */
export const assistantText = (rendered) => (Array.isArray(rendered?.sentences) ? rendered.sentences.filter(isText).map((s) => s.text).join(" ") : "");

/** The last 10 messages, role and text only. */
export const lastMessages = (convo) => convo.slice(-SENT).map(({ role, text }) => ({ role, text }));

// ---- the panel -------------------------------------------------------------------------------------------------

let convo = []; // [{ role: "user" | "assistant", text }]: this tab's conversation, never stored
let button, panel, out, box, send, start, styled;
let pending = null; // the AbortController of the question that is out

function build() {
  const el = document.createElement("aside");
  el.className = "ask-panel";
  el.setAttribute("role", "dialog");
  el.setAttribute("aria-modal", "true");
  el.setAttribute("aria-labelledby", "ask-title");
  el.hidden = true;
  el.innerHTML = `<div class="ask-head"><h2 id="ask-title">Ask</h2><button type="button" class="ask-close" aria-label="Close Ask">&times;</button></div>
<div class="ask-body">
  <div class="ask-start">
    <p class="ask-intro">Ask answers only from this site's data, and every line shows its source. It can't give legal or compliance advice.</p>
    <p class="label">Try asking</p>
    <ul class="ask-starters">${STARTERS.map((q) => `<li><button type="button" class="btn ask-starter">${escapeHtml(q)}</button></li>`).join("")}</ul>
  </div>
  <div id="ask-log" class="ask-log" role="log" aria-live="polite" aria-relevant="additions"></div>
</div>
<form class="ask-form">
  <label class="label" for="ask-q">Your question</label>
  <textarea id="ask-q" rows="2" maxlength="500" autocomplete="off" enterkeyhint="send"></textarea>
  <div class="ask-row">
    <p class="ask-note">Your question and data from this site go to an AI model. Nothing is stored. <a href="/stories/about-the-data.html#ask"${NEW_TAB}>Details</a></p>
    <button type="submit" class="btn btn-accent">Send</button>
  </div>
</form>`;
  document.body.append(el);
  out = el.querySelector("#ask-log");
  box = el.querySelector("#ask-q");
  send = el.querySelector("[type=submit]");
  start = el.querySelector(".ask-start");
  el.querySelector(".ask-close").addEventListener("click", close);
  el.querySelector(".ask-form").addEventListener("submit", (e) => { e.preventDefault(); ask(box.value); });
  start.addEventListener("click", (e) => { const q = e.target.closest(".ask-starter"); if (q) ask(q.textContent); });
  el.addEventListener("keydown", (e) => {
    e.stopPropagation(); // the graph pages step their story, jump to their search and clear focus on keys like these
    if (e.key === "Escape") { e.preventDefault(); close(); return; }
    if (e.key === "Enter" && e.target === box && !e.shiftKey && !e.isComposing) { e.preventDefault(); ask(box.value); return; }
    if (e.key !== "Tab") return;
    const stops = [...el.querySelectorAll("a[href], button:not(:disabled), textarea")].filter((x) => x.getClientRects().length);
    const edge = stops[e.shiftKey ? 0 : stops.length - 1];
    if (document.activeElement === edge) { e.preventDefault(); stops[e.shiftKey ? stops.length - 1 : 0].focus(); }
  });
  return el;
}

/** The panel's stylesheet, loaded once on the first open (the pages carry only the button's): the panel shows when it is in, or has failed to load. */
const styles = () => (styled ??= new Promise((done) => {
  const l = document.createElement("link");
  l.rel = "stylesheet";
  l.href = "/app/ask-panel.css";
  l.onload = l.onerror = done;
  document.head.append(l);
}));

export async function openAsk(opener) {
  await styles();
  button = opener;
  panel ??= build();
  panel.hidden = false;
  button.hidden = true; // the drawer covers its corner
  box.focus();
}

function close() {
  pending?.abort();
  pending = null;
  convo = [];
  out.replaceChildren();
  start.hidden = false;
  box.value = "";
  send.disabled = false;
  panel.hidden = true;
  button.hidden = false;
  button.focus();
}

function show(html, atTop) {
  out.insertAdjacentHTML("beforeend", html);
  const el = out.lastElementChild;
  el.scrollIntoView({ block: atTop ? "start" : "nearest" });
  return el;
}

async function ask(raw) {
  const text = raw.trim();
  if (!text || pending) return;
  const mine = (pending = new AbortController());
  start.hidden = true;
  box.value = "";
  box.focus();
  send.disabled = true;
  convo.push({ role: "user", text });
  show(`<div class="ask-msg ask-q"><span class="visually-hidden">You: </span><p>${escapeHtml(text)}</p></div>`);
  const wait = show('<div class="ask-msg ask-wait"><p>Checking the site\'s data…</p></div>');
  const timer = setTimeout(() => mine.abort(), WAIT_MS);
  let html;
  try {
    const res = await fetch("/api/ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages: lastMessages(convo) }), signal: mine.signal });
    const body = await res.json().catch(() => null); // (a 4xx with no body, or one that is not JSON)
    if (pending !== mine) return; // the panel was closed meanwhile
    if (res.ok && body?.ok === true && assistantText(body.answer)) {
      html = renderAnswer(body.answer);
      convo.push({ role: "assistant", text: assistantText(body.answer) });
    } else {
      html = renderStatus(body?.reason, body?.resets);
    }
  } catch {
    if (pending !== mine) return;
    html = renderStatus("unavailable");
  } finally {
    clearTimeout(timer);
  }
  pending = null;
  wait.remove();
  show(html, true);
  send.disabled = false;
}
