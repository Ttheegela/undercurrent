// The home page's ASCII field: a tanker above the waterline, the current moving below it.
// Glyph density follows brightness, the way image-to-ASCII tools map a picture. Decorative only.
const sea = document.getElementById("sea");
const RAMP = " .,:;-~=+";
const ROWS = 11, WATER = 7;

function shipAt(u, y) {
  if (y === 1 && u > 0.755 && u < 0.775) return "#";                               // funnel
  if (y === 2 && u > 0.70 && u < 0.80) return u > 0.755 && u < 0.775 ? "#" : "=";
  if (y === 3 && u > 0.70 && u < 0.80) return Math.round(u * 400) % 2 ? "|" : "o";  // bridge windows
  if (y === 3 && u > 0.235 && u < 0.25) return "|";                                 // fore mast
  if (y === 4 && u > 0.20 && u < 0.81) return u > 0.70 ? "|" : "_";                 // deck
  if ((y === 5 && u > 0.19 && u < 0.82) || (y === 6 && u > 0.20 && u < 0.815)) return "#"; // hull
  if (y === WATER && u > 0.22 && u < 0.81) return "%";                              // hull at the waterline
  return null;
}

function draw(cols, t) {
  let html = "";
  for (let y = 0; y < ROWS; y++) {
    for (let x = 0; x < cols; x++) {
      const u = x / cols, s = shipAt(u, y);
      if (s) html += y >= WATER ? `<i>${s}</i>` : `<b>${s}</b>`;
      else if (y < WATER) html += " ";
      else if (y === WATER) html += Math.sin(x * 0.9 + t * 0.6) > 0.2 ? "~" : " ";
      else if (y === WATER + 1 && u > 0.24 && u < 0.79) html += "<i>:</i>";            // the keel, under the surface
      else {
        const depth = (y - WATER) / (ROWS - WATER);
        const v = Math.sin(x * 0.35 - t * (1 + depth * 2.5) + y * 1.7) * 0.5 + 0.5;  // deeper water runs faster
        html += RAMP[Math.min(RAMP.length - 1, Math.floor(v * depth * RAMP.length))];
      }
    }
    html += "\n";
  }
  sea.innerHTML = html;
}

if (sea) {
  const probe = Object.assign(document.createElement("span"), { textContent: "M" });
  sea.append(probe);
  const cw = probe.getBoundingClientRect().width || 7;
  probe.remove();
  const cols = () => Math.max(24, Math.floor(sea.clientWidth / cw));
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
  draw(cols(), 0);
  addEventListener("resize", () => draw(cols(), performance.now() / 1000));
  let last = 0, seen = true;
  new IntersectionObserver(([e]) => { seen = e.isIntersecting; }).observe(sea);
  (function tick(now) {
    if (!still && seen && now - last > 90) { draw(cols(), now / 1000); last = now; }
    requestAnimationFrame(tick);
  })(0);
}
