// Ask: adds the button when the site has Ask switched on and public. The panel (ask-panel.js) loads on the first click.
fetch("/api/ask").then((r) => r.ok && r.json()).then((s) => {
  if (!s || !s.enabled || !s.public) return;
  const b = document.createElement("button");
  b.type = "button";
  b.className = "ask-open";
  b.textContent = "Ask";
  b.setAttribute("aria-haspopup", "dialog");
  b.onclick = () => import("/app/ask-panel.js").then((m) => m.openAsk(b), () => b.remove());
  document.body.append(b);
  document.documentElement.classList.add("ask-on");
}).catch(() => {});
