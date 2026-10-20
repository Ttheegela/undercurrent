import { test, expect } from "@playwright/test";

function watchErrors(page) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => {
    if (m.type() === "error" && !m.location().url.includes("/api/")) errors.push(m.text());
  });
  return errors;
}

async function search(page, text) {
  await page.fill("#q", text);
  await page.press("#q", "Enter");
}

test("TASSOS: dossier, three listing chips, timeline, official lists, wider link", async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto("/");
  await search(page, "TASSOS");
  const first = page.locator(".dossier-entry").first();
  await expect(first.locator("h2")).toHaveText("TASSOS");
  await expect(first.locator('[data-walk="chips"] .chip')).toHaveCount(3);
  await expect(first.locator('[data-walk="timeline"]')).toBeVisible();
  await expect(page.locator("table.lists")).toContainText("United States");
  await expect(page.locator("table.lists")).toContainText("United Kingdom");
  await expect(page.locator("#wider")).toContainText("Search on OpenSanctions");
  await expect(page.locator("#lists-date")).toContainText(/Official lists updated|Some lists may be out of date/);
  expect(errors).toEqual([]);
});

async function timelineBoxes(page) {
  return page.locator(".dossier-entry").first().locator(".tl-ev").evaluateAll((els) => els.map((el) => {
    const what = el.querySelector(".what");
    const r = el.getBoundingClientRect();
    const t = el.parentElement.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, trackBottom: t.bottom,
      clipped: what.scrollHeight > what.clientHeight + 1, color: getComputedStyle(what).color, weight: getComputedStyle(what).fontWeight };
  }));
}

function expectFullAndApart(boxes) {
  for (const b of boxes) {
    expect(b.clipped).toBe(false);
    expect(b.bottom).toBeLessThanOrEqual(b.trackBottom + 1);
  }
  for (let i = 1; i < boxes.length; i++) {
    const sideBySide = boxes[i].left >= boxes[i - 1].right - 1;
    const stacked = boxes[i].top >= boxes[i - 1].bottom - 1;
    expect(sideBySide || stacked).toBe(true);
  }
}

test("TASSOS timeline at 1280px: compact by default, toggle shows every label in full", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");
  await search(page, "TASSOS");
  const tl = page.locator(".dossier-entry").first().locator(".timeline");
  const more = tl.locator(".tl-more");
  await expect(more).toBeVisible();
  await expect(more).toHaveAttribute("aria-expanded", "false");
  let boxes = await timelineBoxes(page);
  expect(boxes.some((b) => b.clipped)).toBe(true);
  for (const b of boxes) expect([b.color, b.weight]).toEqual([boxes[0].color, boxes[0].weight]);

  await more.focus();
  await page.keyboard.press("Enter");
  await expect(more).toHaveAttribute("aria-expanded", "true");
  await expect(more).toHaveText("Show less");
  await expect(tl.locator(".what", { hasText: "John Fredriksen) to an unlisted ship manager (Liberia)" })).toBeVisible();
  expectFullAndApart(await timelineBoxes(page));

  await more.click();
  await expect(more).toHaveAttribute("aria-expanded", "false");
  await expect(more).toHaveText("Show full text");
  boxes = await timelineBoxes(page);
  expect(boxes.some((b) => b.clipped)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("TASSOS timeline at 375px: stacked, full text, same colour, no toggle", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto("/");
  await search(page, "TASSOS");
  const tl = page.locator(".dossier-entry").first().locator(".timeline");
  await expect(tl.locator(".tl-ev").first()).toBeVisible();
  await expect(tl.locator(".tl-more")).toBeHidden();
  const boxes = await timelineBoxes(page);
  expectFullAndApart(boxes);
  for (const b of boxes) expect([b.color, b.weight]).toEqual([boxes[0].color, boxes[0].weight]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("IMO number finds the same ship", async ({ page }) => {
  await page.goto("/");
  await search(page, "IMO 9408695");
  await expect(page.locator(".dossier-entry h2").first()).toHaveText("TASSOS");
});

test("made-up name shows the empty state; non-Latin shows the hint", async ({ page }) => {
  await page.goto("/");
  await search(page, "Qzxv Nonexistent Shipping 4242");
  await expect(page.locator(".state")).toContainText("Not found in our research or on the official lists");
  await search(page, "Совкомфлот");
  await expect(page.locator(".state")).toContainText("Latin letters");
});

test("research file failing still leaves the official lists working", async ({ page }) => {
  await page.route("**/data/research-index.json", (route) => route.abort());
  await page.goto("/");
  await search(page, "TASSOS");
  await expect(page.locator(".state")).toContainText("Couldn't load our research");
  await expect(page.locator("table.lists")).toContainText("United Kingdom");
});

test("walkthrough runs start to finish", async ({ page }) => {
  await page.goto("/");
  await page.click("#start-walk");
  await expect(page.locator("#walk")).toBeVisible();
  await expect(page.locator("#walk-step")).toHaveText("Walkthrough · 1 of 5");
  for (let i = 0; i < 4; i++) await page.click("#walk-next");
  await expect(page.locator("#walk-next")).toHaveText("Finish");
  await page.click("#walk-next");
  await expect(page.locator("#walk")).toBeHidden();
});

test("no sideways scroll or clipped content on a phone", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await search(page, "TASSOS");
  await expect(page.locator(".dossier-entry").first()).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  // overflow-x: clip hides overflow instead of scrolling, so also check nothing is cut off.
  const clipped = await page.evaluate(() => [...document.querySelectorAll("body *")]
    .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1)
    .map((el) => `${el.tagName}.${el.className}`));
  expect(clipped).toEqual([]);
});

test("every story page loads", async ({ request }) => {
  for (const path of [
    "/stories/how-sanctions-work/index.html",
    "/stories/shadow-fleet/network/shadow_fleet_map.html",
    "/stories/chips-into-russia/viz/index.html",
    "/stories/chips-into-russia/viz/coverage.html",
    "/stories/chips-into-russia/viz/listing_lag.html",
    "/stories/chips-into-russia/viz/river.html",
    "/stories/who-lobbies/influence-network/index.html",
    "/stories/who-lobbies/clean-names-graph/index.html",
    "/stories/about-the-data.html",
  ]) {
    expect((await request.get(path)).status(), path).toBe(200);
  }
});

test("a failed list never produces a false 'Not found'", async ({ page }) => {
  await page.route("**/data/lists/us.json", (r) => r.abort());
  await page.goto("/");
  await search(page, "Qzxv Nonexistent Shipping 4242");
  await expect(page.locator("#results")).toContainText("Couldn't load the United States list");
  await expect(page.locator(".state", { hasText: "Not found in our research or on the official lists" })).toHaveCount(0);
});

test("a wrong-shape research file fails alone", async ({ page }) => {
  await page.route("**/data/research-index.json", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: '{"oops":1}' }));
  await page.goto("/");
  await search(page, "TASSOS");
  await expect(page.locator("#results")).toContainText("Couldn't load our research");
  await expect(page.locator("table.lists")).toContainText("United Kingdom");
});

const CONNECTIONS = {
  TASSOS: {
    sanctions: { available: true, matched: true, others: 0, linksMore: 0,
      focus: { name: "TASSOS", schema: "Vessel", imo: "9408695", authorities: ["US", "UK"] },
      links: [{ name: "Zulu Ships Management", schema: "Organization", role: "Property in the interest of", direction: "out", authorities: ["US", "UK"],
        groups: [{ schema: "Vessel", items: ["TAGOR", "NEMRUT", "MANASLU", "BRIONT"].map((n) => ({ name: n, schema: "Vessel", role: "Property in the interest of", direction: "in", authorities: ["US", "UK"] })), more: 6 }] }] },
    lobbying: { available: true, matched: false, checked_no_filings: false },
    attribution: "Sanctions links: official sanctions lists compiled by OpenSanctions (CC BY-NC 4.0).",
  },
  NS2: {
    sanctions: { available: true, matched: false },
    lobbying: { available: true, matched: true, client: "Nord Stream 2 AG", as_of: "2026-10-14", checked_no_filings: false,
      firms: [{ name: "Capitol Counsel LLC", filings: 12, fees_usd: 1230000, sub_fees_usd: null, subcontract: false, years: [2017, 2022], url: "https://lda.gov/filings/public/filing/u1/print/" }],
      lobbyists: [], lobbyists_more: 0, revolving_door: [], bodies: [{ name: "US Senate", filings: 9 }], bills: [], parents: [], bridges: [] },
    attribution: "Lobbying: US Lobbying Disclosure Act filings (lda.gov).",
  },
  SOV: {
    sanctions: { available: true, matched: true, others: 2, linksMore: 0, focus: { name: "SOVCOMFLOT", schema: "Company", imo: "", authorities: ["US"] },
      links: [{ name: "Government of Russia", schema: "Organization", role: "Owned by", direction: "out", authorities: ["US"], groups: [] }] },
    lobbying: { available: true, matched: false, checked_no_filings: true },
    attribution: "",
  },
};

async function stubConnections(page) {
  await page.route("**/api/connections**", (route) => {
    const url = new URL(route.request().url());
    const key = url.searchParams.get("imo") === "9408695" ? "TASSOS" : /nord stream/i.test(url.searchParams.get("name") || "") ? "NS2" : "SOV";
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(CONNECTIONS[key]) });
  });
}

test("connections: TASSOS shows Zulu and its ships, names are searchable", async ({ page }) => {
  await stubConnections(page);
  await page.goto("/");
  await search(page, "TASSOS");
  const panel = page.locator(".dossier-entry").first().locator(".conn");
  await expect(panel).toContainText("Zulu Ships Management");
  await expect(panel).toContainText("+6 more");
  await expect(panel.locator(".conn-graph")).toBeVisible();
  await panel.locator('[data-search="TAGOR"]').click();
  await expect(page.locator("#q")).toHaveValue("TAGOR");
});

test("connections: Nord Stream 2 shows its lobbying firm", async ({ page }) => {
  await stubConnections(page);
  await page.goto("/");
  await search(page, "Nord Stream 2 AG");
  const panel = page.locator(".dossier-entry").first().locator(".conn");
  await expect(panel).toContainText("Lobbying in Washington");
  await expect(panel).toContainText("Capitol Counsel LLC");
});

test("connections: Sovcomflot says no lobbying found; phone hides the graph without clipping", async ({ page }) => {
  await stubConnections(page);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");
  await search(page, "Sovcomflot");
  const panel = page.locator(".dossier-entry").first().locator(".conn");
  await expect(panel).toContainText("No US lobbying filings found (checked nightly)");
  await expect(panel.locator(".conn-graph")).toBeHidden();
  const clipped = await page.evaluate(() => [...document.querySelectorAll("body *")]
    .filter((el) => el.getBoundingClientRect().right > window.innerWidth + 1).map((el) => `${el.tagName}.${el.className}`));
  expect(clipped).toEqual([]);
});

test("home chips card reads the median from data, keeps 20 when the file is missing", async ({ page }) => {
  await page.route("**/chips-into-russia/data/summary.json", (r) =>
    r.fulfill({ status: 200, contentType: "application/json", body: '{"median_months":22.4,"n":30}' }));
  await page.goto("/");
  await expect(page.locator("#chips-months")).toHaveText("22");
  await page.unroute("**/chips-into-russia/data/summary.json");
  await page.route("**/chips-into-russia/data/summary.json", (r) => r.fulfill({ status: 404, body: "" }));
  await page.goto("/");
  await expect(page.locator("#lists-date")).toContainText(/Official lists|out of date|unavailable/);
  await expect(page.locator("#chips-months")).toHaveText("20");
});

test("chip dossiers: RM Design links the time-to-list page, ELEM GROUP does not", async ({ page }) => {
  await page.goto("/");
  await search(page, "RM Design and Development");
  await expect(page.locator('.dossier-entry a[href$="viz/listing_lag.html"]').first()).toBeVisible();
  await search(page, "ELEM GROUP");
  const elem = page.locator(".dossier-entry", { hasText: "ELEM GROUP" }).first();
  await expect(elem.locator('a[href$="viz/index.html"]')).toBeVisible();
  await expect(elem.locator('a[href$="listing_lag.html"]')).toHaveCount(0);
});

const MAP = "/stories/shadow-fleet/network/shadow_fleet_map.html";
const NETWORK = "/stories/who-lobbies/influence-network/index.html";

for (const [name, path] of [["shadow-fleet map", MAP], ["influence network", NETWORK]]) {
  test(`${name}: the key drags, collapses and resets, and remembers across reloads`, async ({ page }) => {
    const errors = watchErrors(page);
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(path);
    const key = page.locator("#legend"), handle = key.locator(".lg-handle"), toggle = key.locator(".lg-toggle");
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    const start = await key.boundingBox(), h = await handle.boundingBox();
    const dx = start.x < 640 ? 100 : -100, dy = start.y < 400 ? 80 : -80; // away from the default corner
    await page.mouse.move(h.x + 20, h.y + h.height / 2);
    await page.mouse.down();
    await page.mouse.move(h.x + 20 + dx, h.y + h.height / 2 + dy, { steps: 5 });
    await page.mouse.up();
    await handle.focus();
    await page.keyboard.press("ArrowRight");
    const moved = await key.boundingBox();
    expect([Math.round(moved.x - start.x), Math.round(moved.y - start.y)]).toEqual([dx + 8, dy]);

    await page.reload();
    expect(await key.boundingBox()).toEqual(moved);
    await toggle.click();
    await page.reload();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(key.locator(".lg-body")).toBeHidden();
    await toggle.click();
    await key.locator(".lg-reset").click();
    expect(await key.boundingBox()).toEqual(start);
    await page.reload();
    expect(await key.boundingBox()).toEqual(start);
    expect(errors).toEqual([]);
  });
}

test("every page with the main header links to both graphs, on desktop and phone", async ({ page }) => {
  test.setTimeout(90_000);
  const pages = ["/index.html", "/stories/about-the-data.html", "/stories/how-sanctions-work/index.html",
    "/stories/chips-into-russia/viz/index.html", "/stories/chips-into-russia/viz/coverage.html",
    "/stories/chips-into-russia/viz/listing_lag.html", "/stories/chips-into-russia/viz/river.html",
    "/stories/who-lobbies/influence-network/methods.html", "/stories/who-lobbies/clean-names-graph/index.html", MAP, NETWORK];
  for (const width of [1280, 375]) {
    await page.setViewportSize({ width, height: 812 });
    for (const path of pages) {
      await page.goto(path, { waitUntil: "domcontentloaded" });
      const links = page.locator("header .nav-graphs a");
      await expect(links.nth(0), `${path} @ ${width}`).toBeVisible();
      await expect(links.nth(1), `${path} @ ${width}`).toBeVisible();
      const got = await links.evaluateAll((as) => as.map((a) => [new URL(a.href).pathname, a.getAttribute("aria-current")]));
      expect(got, `${path} @ ${width}`).toEqual([[MAP, path === MAP ? "page" : null], [NETWORK, path === NETWORK ? "page" : null]]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${path} @ ${width}`).toBe(true);
    }
  }
  await page.goto("/index.html");
  await page.locator("header .nav-graphs a", { hasText: "Influence network" }).click();
  await expect(page).toHaveURL(new RegExp(NETWORK + "$"));
  await page.locator("header .nav-graphs a", { hasText: "Shadow fleet map" }).click();
  await expect(page).toHaveURL(new RegExp(MAP + "$"));
});

// ---- shadow-fleet map: live data (fleet-data.json), the changes panel, highlights and ghosts ----
const FLEET_JSON = "**/stories/shadow-fleet/network/fleet-data.json";
const CHANGES_JSON = "**/data/changes/changes.json";
const edgeId = (k) => `e:${String(k).padStart(12, "0")}`;
const shipNode = (n, extra = {}) => ({ id: `IMO${1000000 + n}`, type: "ship", name: `SHIP ${n}`, aliases: [`SHIP ${n}`], imo: String(1000000 + n),
  programs: ["russia", "iran"], program_group: "both", listed_by: ["us"], listed: true, first_listed: "2025-03-01", ship_type: "Crude Oil Tanker",
  name_count: 1, flag_count: 1, sources: [], angle: ["lists"], ...extra });

// ALPHA, BRAVO, CHARLIE and DELTA are run by ACME and fly the Panama flag; `bulk` more ships stand alone.
// Links have no id, as in the real payload: a change names its link by (endpoint_ids, node_type) = (s, t, y).
function fleetFixture(bulk = 0) {
  const ships = [["ALPHA", 1], ["BRAVO", 2], ["CHARLIE", 3], ["DELTA", 4]].map(([name, n]) => shipNode(n, { name, aliases: [name] }));
  for (let i = 0; i < bulk; i++) ships.push(shipNode(100 + i, { name: `BULK ${i}`, aliases: [`BULK ${i}`] }));
  const edges = ships.slice(0, 4).flatMap((s, k) => [
    { s: "co:acme", t: s.id, y: "operates", d: "2025-03-01", c: "D", src: [[0, null, "rec", "lists", "D"]] },
    { s: s.id, t: "cc:pa", y: "flagged_in", d: "", c: "D", src: [] },
  ]);
  return {
    nodes: [...ships,
      { id: "co:acme", type: "company", name: "ACME SHIPPING", aliases: [], country: "pa", role: "operator", ship_count: 4, listed: true, listed_by: ["us"],
        program_group: "both", programs: ["russia"], first_listed: "2025-03-01", sources: [] },
      { id: "cc:pa", type: "country", name: "Panama", country: "pa" }, { id: "gov:us", type: "government", name: "United States" }],
    edges, sources: [["https://example.org/list", "list.csv"]], quotes: [],
    meta: { title: "Shadow Fleet Network", subtitle: "Fixture", credits: "Fixture credits", generated: "2026-10-19", patterns: [], coverage: [],
      study_counts: [], verified_angles: [], counts: {} },
  };
}
const change = (over) => ({ date: "2026-10-19", graph: "fleet", kind: "added", item: "node", id: "", name: "", node_type: "ship", summary: "",
  source_url: "https://example.org/list", source_label: "Example list", ...over });
const EDGE_ENDS = (a, b, an, bn) => ({ item: "edge", node_type: "operates", endpoints: [an, bn], endpoint_ids: [a, b] });
const STD_CHANGES = [
  change({ id: "IMO1000003", name: "CHARLIE", summary: "US listed CHARLIE (IMO 1000003)" }),
  change({ ...EDGE_ENDS("co:acme", "IMO1000003", "ACME SHIPPING", "CHARLIE"), id: edgeId(3), name: "ACME SHIPPING → CHARLIE", summary: "New link: CHARLIE → ACME SHIPPING (operated by)" }),
  change({ kind: "changed", id: "IMO1000004", name: "DELTA", field: "listed_by", from: ["eu"], summary: "EU removed DELTA (IMO 1000004)" }),
  change({ kind: "removed", id: "IMO1000099", name: "GONE SHIP", summary: "EU removed GONE SHIP (IMO 1000099)" }),
  change({ ...EDGE_ENDS("co:acme", "IMO1000099", "ACME SHIPPING", "GONE SHIP"), kind: "removed", id: edgeId(90), name: "ACME SHIPPING → GONE SHIP", summary: "Link removed: GONE SHIP → ACME SHIPPING (operated by)" }),
  change({ ...EDGE_ENDS("co:acme", "IMO1000002", "ACME SHIPPING", "BRAVO"), node_type: "owns", kind: "removed", id: edgeId(91), name: "ACME SHIPPING → BRAVO", summary: "Link removed: BRAVO → ACME SHIPPING (owned by)" }),
  change({ ...EDGE_ENDS("co:old", "IMO1000001", "OLD CO", "ALPHA"), kind: "removed", id: edgeId(92), name: "OLD CO → ALPHA", summary: "Link removed: ALPHA → OLD CO (operated by)" }),
  change({ graph: "lobby", id: "p:someone", name: "Someone", node_type: "lobbyist", summary: "New lobbyist: Someone" }),
];
const recordFixture = (changes) => ({ started: "2026-10-10", days: [
  { date: "2026-10-19", sources: { us: "fresh", uk: "fresh", eu: "fresh", un: "fresh", lobbying: "fresh" }, changes },
  { date: "2026-10-18", sources: { us: "fresh", uk: "unavailable", eu: "fresh", un: "fresh", lobbying: "fresh" }, changes: [] }] });

async function stubMap(page, { fleet = fleetFixture(), record = recordFixture(STD_CHANGES) } = {}) {
  await page.route(FLEET_JSON, (r) => r.fulfill({ json: fleet }));
  await page.route(CHANGES_JSON, (r) => (record ? r.fulfill({ json: record }) : r.fulfill({ status: 404, body: "" })));
}
async function mapReady(page, hash = "") {
  await page.goto(MAP + hash);
  await page.locator("html[data-ready]").waitFor({ state: "attached" });
}
const edgeEnds = (page, selector) => page.evaluate((s) => window.__fleet.cy.edges(s).map((e) => [e.source().id(), e.target().id(), e.data("y")].join(" ")).sort(), selector);
const cyIds = (page, selector) => page.evaluate((s) => window.__fleet.cy.elements(s).map((e) => e.id()).sort(), selector);
const ghostBox = (page, id) => page.evaluate((gid) => {
  const g = window.__fleet.cy.getElementById(gid), p = g.renderedPosition(), b = document.getElementById("cy").getBoundingClientRect();
  return { x: b.left + p.x, y: b.top + p.y, w: b.width, h: b.height, inside: p.x > 0 && p.y > 0 && p.x < b.width && p.y < b.height };
}, id);

test("map loads data by fetch and shows Data built date", async ({ page }) => {
  const errors = watchErrors(page);
  let fetched = 0;
  page.on("request", (r) => { if (r.url().endsWith("/network/fleet-data.json")) fetched++; });
  await stubMap(page);
  await mapReady(page);
  expect(await page.evaluate(() => window.FLEET_DATA)).toBeUndefined();
  await expect(page.locator("#gen")).toHaveText("Data built 2026-10-19");
  await expect(page.locator("#time")).toHaveAttribute("max", "93"); // Jan 2019 is month 0, Oct 2026 is month 93
  await expect(page.locator("#asof")).toHaveText("Oct 2026");
  expect(fetched).toBe(1);
  expect(errors).toEqual([]);
});

// the added ship and link get green rings, the changed ship a grey one, removed items dashed ghosts (never clickable for details)
test("since window highlights added ship and draws removed ghost", async ({ page }) => {
  const errors = watchErrors(page);
  await stubMap(page);
  await mapReady(page);
  await expect(page.locator(".chg-title")).toHaveText("Since 12 Oct · 7 changes"); // the lobby change is not the map's
  await expect.poll(() => cyIds(page, "node.chg-new")).toEqual(["IMO1000003"]);
  expect(await edgeEnds(page, ".chg-new")).toEqual(["co:acme IMO1000003 operates"]);
  expect(await cyIds(page, "node.chg-changed")).toEqual(["IMO1000004"]); // a changed ship must never look new
  expect(await cyIds(page, "node.chg-new")).not.toContain("IMO1000004");
  // removed: a ghost ship, a ghost link to it, a ghost link between two ships still on screen; a link with an unknown end is skipped
  expect(await cyIds(page, ".chg-removed")).toEqual([`ghost:${edgeId(90)}`, `ghost:${edgeId(91)}`, "ghost:IMO1000099"].sort());
  const ghost = await page.evaluate(() => { const g = window.__fleet.cy.getElementById("ghost:IMO1000099"); return { label: g.data("lab"), events: g.style("events") }; });
  expect(ghost).toEqual({ label: "GONE SHIP", events: "no" });
  expect(await page.evaluate((id) => { const e = window.__fleet.cy.getElementById(id); return [e.source().id(), e.target().id()]; }, `ghost:${edgeId(90)}`)).toEqual(["co:acme", "ghost:IMO1000099"]);
  expect(await page.evaluate((id) => { const e = window.__fleet.cy.getElementById(id); return [e.source().id(), e.target().id()]; }, `ghost:${edgeId(91)}`)).toEqual(["co:acme", "IMO1000002"]);
  // a ghost takes no clicks, so it never gets details (the click goes through to whatever is behind it: here the operator's box)
  const at = await ghostBox(page, "ghost:IMO1000099");
  expect(at.inside).toBe(true);
  await page.mouse.click(at.x, at.y);
  expect(await page.evaluate(() => (window.__fleet.S.selected || {}).id || "")).not.toMatch(/^ghost:/);
  await expect(page.locator("#p-detail")).not.toContainText("GONE SHIP");
  // choosing a shorter window drops what it no longer holds
  await page.getByRole("button", { name: "Yesterday" }).click();
  await expect(page.locator(".chg-title")).toHaveText("Since 18 Oct · 7 changes");
  expect(errors).toEqual([]);
});

test("map: rings are painted on the overlay, green for new and grey for changed", async ({ page }) => {
  await stubMap(page);
  await mapReady(page);
  await expect.poll(() => cyIds(page, "node.chg-new")).toEqual(["IMO1000003"]);
  // the ring is a circle 5px outside the node: count the pixels of each colour on it (other drawings can cover some of them)
  const ring = (id) => page.evaluate((nid) => {
    const el = window.__fleet.cy.getElementById(nid), p = el.renderedPosition(), r = Math.max(el.renderedWidth(), el.renderedHeight()) / 2 + 5;
    const ov = document.getElementById("overlay"), px = ov.getContext("2d").getImageData(0, 0, ov.width, ov.height), dpr = ov.width / ov.clientWidth;
    let green = 0, grey = 0;
    for (let a = 0; a < 360; a += 10) {
      const x = Math.round((p.x + r * Math.cos(a * Math.PI / 180)) * dpr), y = Math.round((p.y + r * Math.sin(a * Math.PI / 180)) * dpr), i = (y * ov.width + x) * 4;
      const [R, G, B, A] = px.data.slice(i, i + 4);
      if (A < 150) continue;
      if (G > R + 30 && G > B + 30) green++; else if (Math.abs(R - G) < 25 && Math.abs(G - B) < 30) grey++;
    }
    return { green, grey };
  }, id);
  await expect.poll(async () => (await ring("IMO1000003")).green).toBeGreaterThan(18); // painted on the next animation frame
  await expect.poll(async () => (await ring("IMO1000004")).grey).toBeGreaterThan(18);
  expect((await ring("IMO1000004")).green).toBe(0);
});

test("deep link #focus=…&since=… opens focused with window", async ({ page }) => {
  const errors = watchErrors(page);
  await stubMap(page);
  await mapReady(page, "#focus=IMO1000003&since=2026-10-19");
  expect(await page.evaluate(() => [window.__fleet.S.focusId, window.__fleet.S.selected.id])).toEqual(["IMO1000003", "IMO1000003"]);
  await expect(page.locator("#viewname")).toHaveText("Focus");
  await expect(page.locator(".chg-title")).toHaveText("Since 19 Oct · 7 changes");
  await expect.poll(() => cyIds(page, "node.chg-new")).toEqual(["IMO1000003"]);
  expect(errors).toEqual([]);
});

test("map: a deep link to a removed ship centres on its ghost", async ({ page }) => {
  const errors = watchErrors(page);
  await stubMap(page);
  await mapReady(page, "#focus=IMO1000099&since=2026-10-12");
  await expect.poll(() => cyIds(page, "node.chg-removed")).toEqual(["ghost:IMO1000099"]);
  await expect.poll(async () => (await ghostBox(page, "ghost:IMO1000099")).inside).toBe(true);
  expect(await page.evaluate(() => window.__fleet.S.focusId)).toBeNull();
  expect(errors).toEqual([]);
});

test("hashchange re-focuses", async ({ page }) => {
  const errors = watchErrors(page);
  await stubMap(page);
  await mapReady(page);
  await page.evaluate(() => { location.hash = "#focus=IMO1000002&since=2026-10-15"; });
  await expect.poll(() => page.evaluate(() => window.__fleet.S.focusId + " " + (window.__fleet.S.selected || {}).id)).toBe("IMO1000002 IMO1000002"); // the focus view has been laid out
  await expect(page.locator(".chg-title")).toHaveText("Since 15 Oct · 7 changes");
  await page.evaluate(() => { location.hash = "#select=IMO1000001"; });
  await expect.poll(() => page.evaluate(() => window.__fleet.S.selected && window.__fleet.S.selected.id)).toBe("IMO1000001");
  expect(errors).toEqual([]);
});

test("map: junk in the hash is ignored", async ({ page }) => {
  const errors = watchErrors(page);
  await stubMap(page);
  await mapReady(page, "#focus=%3Cimg%20src%3Dx%3E&since=2026-13-45&select=constructor&view=nope&tab=nope&x=%E0%A4%A");
  await expect(page.locator(".chg-title")).toHaveText("Since 12 Oct · 7 changes");
  expect(await page.evaluate(() => [window.__fleet.S.focusId, window.__fleet.S.preset])).toEqual([null, "overlap"]);
  await page.evaluate(() => { location.hash = "#focus=__proto__&since=20261019"; });
  await expect(page.locator(".chg-title")).toHaveText("Since 12 Oct · 7 changes");
  expect(errors).toEqual([]);
});

test("map: one broken pair in the hash does not lose the others", async ({ page }) => {
  await stubMap(page);
  await mapReady(page, "#x=%E0%A4%A&since=2026-10-19&y=%");
  await expect(page.locator(".chg-title")).toHaveText("Since 19 Oct · 7 changes");
});

test("200 changes highlight without timeout", async ({ page }) => {
  const errors = watchErrors(page);
  const added = Array.from({ length: 200 }, (_, i) => change({ id: `IMO${1000100 + i}`, name: `BULK ${i}`, summary: `US listed BULK ${i}` }));
  await stubMap(page, { fleet: fleetFixture(200), record: recordFixture(added) });
  const t0 = Date.now();
  await page.goto(MAP);
  await expect(page.locator(".chg-more")).toContainText("+150 more", { timeout: 3000 });
  expect(Date.now() - t0).toBeLessThan(3000);
  await expect(page.locator(".chg-title")).toHaveText("Since 12 Oct · 200 changes");
  await expect(page.locator(".chg-item")).toHaveCount(50);
  await expect.poll(() => page.evaluate(() => window.__fleet.cy.nodes(".chg-new").length), { timeout: 10_000 }).toBe(200);
  expect(errors).toEqual([]);
});

test("map: choosing a change row focuses an added ship and centres a removed one on its ghost", async ({ page }) => {
  const errors = watchErrors(page);
  await stubMap(page);
  await mapReady(page);
  await page.locator(".chg-pick", { hasText: "GONE SHIP (IMO 1000099)" }).click();
  await expect.poll(async () => (await ghostBox(page, "ghost:IMO1000099")).inside).toBe(true);
  await expect(page.locator("#app")).toHaveClass(/panel-closed/); // no details for a ghost
  await page.locator(".chg-pick", { hasText: "US listed CHARLIE" }).click();
  await expect.poll(() => page.evaluate(() => window.__fleet.S.focusId)).toBe("IMO1000003");
  await page.locator(".chg-pick", { hasText: "ALPHA → OLD CO" }).click(); // its ends are unknown: nothing to centre on
  expect(await page.evaluate(() => window.__fleet.S.focusId)).toBe("IMO1000003");
  expect(errors).toEqual([]);
});

test("map: change text is escaped and never becomes markup", async ({ page }) => {
  const errors = watchErrors(page);
  const hostile = '<img src=x onerror="window.__pwned=1">';
  const rows = [change({ id: "IMO1000003", name: hostile, summary: `US listed ${hostile}`, source_label: hostile, source_url: "javascript:window.__pwned=1" }),
    change({ kind: "removed", id: "IMO1000098", name: hostile, summary: `EU removed ${hostile}` })];
  await stubMap(page, { record: recordFixture(rows) });
  await mapReady(page);
  await expect(page.locator(".chg-title")).toHaveText("Since 12 Oct · 2 changes");
  await expect(page.locator(".chg-list img")).toHaveCount(0);
  await expect(page.locator(".chg-list")).toContainText("<img src=x");
  await expect(page.locator(".chg-list a[href^='javascript']")).toHaveCount(0);
  expect(await page.evaluate(() => window.__pwned)).toBeUndefined();
  expect(errors).toEqual([]);
});

test("changes record failure says unavailable, not no changes", async ({ page }) => {
  const bad = [{ status: 404, body: "" }, { json: { days: "nope" } }, { json: { started: "2026-10-10", days: [{ date: "2026-10-19", sources: {}, changes: [null] }] } }];
  await page.route(FLEET_JSON, (r) => r.fulfill({ json: fleetFixture() }));
  for (const answer of bad) {
    await page.route(CHANGES_JSON, (r) => r.fulfill(answer));
    await mapReady(page);
    const root = page.locator("#chg-root");
    await expect(root).toContainText("Changes unavailable right now");
    await expect(root.getByRole("button", { name: "Retry" })).toBeVisible();
    await expect(root).not.toContainText("No changes since");
    await expect(page.locator(".chg-title")).toHaveCount(0);
    expect(await page.evaluate(() => window.__fleet.cy.nodes().length)).toBeGreaterThan(3); // the map itself is fine
    await page.unroute(CHANGES_JSON);
  }
  // a record that loaded and holds nothing for the window is a different thing: that one does say so
  await page.route(CHANGES_JSON, (r) => r.fulfill({ json: recordFixture([]) }));
  await mapReady(page);
  await expect(page.locator(".chg-empty")).toContainText("No changes since");
});

test("retry restores the change panel and rings", async ({ page }) => {
  let down = true, record = 0, code = 0;
  await page.route(FLEET_JSON, (r) => r.fulfill({ json: fleetFixture() }));
  await page.route(CHANGES_JSON, (r) => { record++; return down ? r.abort() : r.fulfill({ json: recordFixture(STD_CHANGES) }); });
  await page.route(/\/app\/changes\.js/, (r) => { code++; return down ? r.abort() : r.continue(); }); // the panel's own code fails too
  await mapReady(page);
  const root = page.locator("#chg-root");
  await expect(root).toContainText("Changes unavailable right now");
  expect(await cyIds(page, ".chg-new, .chg-changed, .chg-removed")).toEqual([]);
  down = false;
  await root.getByRole("button", { name: "Retry" }).click();
  await expect(page.locator(".chg-title")).toHaveText("Since 12 Oct · 7 changes");
  await expect.poll(() => cyIds(page, "node.chg-new")).toEqual(["IMO1000003"]);
  expect(await cyIds(page, ".chg-removed")).toContain("ghost:IMO1000099");
  expect([record, code]).toEqual([2, 2]);
  // and a Retry that fails again says so again, with the button kept
  const again = await page.context().newPage();
  down = true;
  await again.route(FLEET_JSON, (r) => r.fulfill({ json: fleetFixture() }));
  await again.route(CHANGES_JSON, (r) => r.abort());
  await again.goto(MAP);
  await again.locator("html[data-ready]").waitFor({ state: "attached" });
  await again.locator("#chg-root").getByRole("button", { name: "Retry" }).click();
  await expect(again.locator("#chg-root")).toContainText("Changes unavailable right now");
  await expect(again.locator("#chg-root").getByRole("button", { name: "Retry" })).toBeFocused();
});

test("map retry after a full outage reloads the change record too", async ({ page }) => {
  let down = true, record = 0;
  await page.route(FLEET_JSON, (r) => (down ? r.abort() : r.fulfill({ json: fleetFixture() })));
  await page.route(CHANGES_JSON, (r) => { record++; return down ? r.abort() : r.fulfill({ json: recordFixture(STD_CHANGES) }); });
  await page.route(/\/app\/changes\.js/, (r) => (down ? r.abort() : r.continue()));
  await page.goto(MAP);
  await expect(page.getByText("Map data unavailable right now")).toBeVisible();
  down = false;
  await page.getByRole("button", { name: "Retry" }).click();
  await page.locator("html[data-ready]").waitFor({ state: "attached" });
  await expect(page.locator(".chg-title")).toHaveText("Since 12 Oct · 7 changes");
  await expect.poll(() => cyIds(page, "node.chg-new")).toEqual(["IMO1000003"]);
  expect(record).toBe(2);
});

test("map shows retry when the map library fails to load", async ({ page }) => {
  await page.route(/cytoscape\.min\.js/, (r) => r.abort());
  await stubMap(page);
  await page.goto(MAP);
  await expect(page.getByText("Map data unavailable right now")).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry" })).toBeFocused();
});

test("map: an item removed and then back on the map is neither a ghost nor a ring", async ({ page }) => {
  const rows = [change({ kind: "removed", id: "IMO1000001", name: "ALPHA", summary: "EU removed ALPHA (IMO 1000001)" }),
    change({ ...EDGE_ENDS("co:acme", "IMO1000001", "ACME SHIPPING", "ALPHA"), kind: "removed", id: edgeId(1), name: "ACME SHIPPING → ALPHA", summary: "Link removed: ALPHA → ACME SHIPPING (operated by)" })];
  await stubMap(page, { record: recordFixture(rows) });
  await mapReady(page);
  await expect(page.locator(".chg-title")).toHaveText("Since 12 Oct · 2 changes");
  expect(await cyIds(page, ".chg-removed, .chg-new, .chg-changed")).toEqual([]);
});

test("map: on a phone choosing a change brings the map into view", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await stubMap(page);
  await mapReady(page);
  await page.locator("#changes > summary").click(); // folded on a phone until opened
  const stageTop = () => page.evaluate(() => Math.round(document.getElementById("stage").getBoundingClientRect().top));
  expect(await stageTop()).toBeGreaterThan(700); // below the controls, off screen
  await page.locator(".chg-pick", { hasText: "US listed CHARLIE" }).click();
  await expect.poll(stageTop).toBeLessThan(300);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("map: on a phone a row with nothing to show does not scroll the page", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await stubMap(page);
  await mapReady(page);
  await page.locator("#changes > summary").click();
  await page.locator(".chg-pick", { hasText: "ALPHA → OLD CO" }).click(); // its ends are not on the map: no ghost, no focus
  await page.waitForTimeout(500);
  expect(await page.evaluate(() => Math.round(scrollY))).toBeLessThan(40); // only the opening of the fold moved it, if anything
  const top = await page.evaluate(() => Math.round(document.getElementById("stage").getBoundingClientRect().top));
  expect(top).toBeGreaterThan(500);
});

test("map: a deep link to a new link focuses the ship it starts at", async ({ page }) => {
  const errors = watchErrors(page);
  await stubMap(page);
  await mapReady(page, `#focus=${edgeId(3)}&since=2026-10-12`);
  expect(await page.evaluate(() => window.__fleet.S.focusId)).toBe("co:acme");
  await expect.poll(() => edgeEnds(page, ".chg-new")).toEqual(["co:acme IMO1000003 operates"]);
  expect(errors).toEqual([]);
});

test("map: if the panel's code fails to load the map still works", async ({ page }) => {
  await page.route("**/app/changes.js", (r) => r.abort());
  await stubMap(page);
  await page.goto(MAP);
  await page.locator("html[data-ready]").waitFor({ state: "attached" });
  await expect(page.locator("#chg-root")).toContainText("unavailable right now");
  expect(await page.evaluate(() => window.__fleet.cy.nodes().length)).toBeGreaterThan(3);
});

test("map: a link is matched by its ends and type, nothing else", async ({ page }) => {
  const errors = watchErrors(page);
  const rows = [
    change({ ...EDGE_ENDS("co:acme", "IMO1000003", "ACME SHIPPING", "CHARLIE"), node_type: "owns", id: edgeId(3), name: "x", summary: "right ends, wrong type" }), // no such link
    change({ ...EDGE_ENDS("IMO1000003", "co:acme", "CHARLIE", "ACME SHIPPING"), id: edgeId(4), name: "x", summary: "ends the wrong way round" }),
    change({ ...EDGE_ENDS("co:nobody", "IMO1000003", "NOBODY", "CHARLIE"), id: edgeId(5), name: "x", summary: "an end that is not on the map" }),
    change({ ...EDGE_ENDS("co:acme", "IMO1000004", "ACME SHIPPING", "DELTA"), id: edgeId(6), name: "x", summary: "the right link under another id" })]; // the one that matches
  await stubMap(page, { record: recordFixture(rows) });
  await mapReady(page);
  await expect(page.locator(".chg-title")).toHaveText("Since 12 Oct · 4 changes");
  expect(await edgeEnds(page, ".chg-new")).toEqual(["co:acme IMO1000004 operates"]);
  expect(errors).toEqual([]);
});

// ACME has a removed link to BULK 0, which stands alone: a ghost link between two ships on screen
const GHOST_LINK = [change({ ...EDGE_ENDS("co:acme", "IMO1000100", "ACME SHIPPING", "BULK 0"), node_type: "owns", kind: "removed", id: edgeId(95), name: "ACME SHIPPING → BULK 0", summary: "Link removed: BULK 0 → ACME SHIPPING (owned by)" })];

test("selecting a node does not frame its removed-link ghost", async ({ page }) => {
  const errors = watchErrors(page);
  await stubMap(page, { fleet: fleetFixture(3), record: recordFixture(GHOST_LINK) });
  await mapReady(page);
  const ghostLink = `ghost:${edgeId(95)}`;
  expect(await cyIds(page, "edge.chg-removed")).toEqual([ghostLink]);
  // a removed link is not a lead link: its own dash pattern, and fainter
  const look = await page.evaluate((id) => { const g = window.__fleet.cy.getElementById(id); return [g.style("line-dash-pattern"), +g.style("opacity")]; }, ghostLink);
  expect(look[0]).not.toBe("5 4"); // a lead link's dashes
  expect(look[1]).toBeLessThan(0.55); // a lead link's opacity is 0.6
  // BULK 0 is moved far from ACME (but not past the lowest zoom, so framing it would show it); selecting ACME must neither frame it nor light the ghost link
  await page.evaluate(() => { window.__fleet.cy.getElementById("IMO1000100").position({ x: 2000, y: 2000 }); window.__fleet.selectNode("co:acme", { fly: true }); });
  await page.waitForTimeout(800); // the camera takes 350 ms
  const after = await page.evaluate((id) => {
    const cy = window.__fleet.cy, g = cy.getElementById(id), far = cy.getElementById("IMO1000100").renderedPosition(), box = document.getElementById("cy").getBoundingClientRect();
    return { lit: g.hasClass("hl"), dim: g.hasClass("dim"), farInView: far.x > 0 && far.y > 0 && far.x < box.width && far.y < box.height, selected: window.__fleet.S.selected.id };
  }, ghostLink);
  expect(after).toEqual({ lit: false, dim: true, farInView: false, selected: "co:acme" });
  expect(errors).toEqual([]);
});

test("ghosts follow the type filter and come back with it", async ({ page }) => {
  await stubMap(page);
  await mapReady(page);
  expect(await cyIds(page, "node.ghost")).toContain("ghost:IMO1000099");
  await page.locator("#filters > summary").click();
  await page.locator("#f-type label", { hasText: "Ships" }).click();
  await expect.poll(() => cyIds(page, "node.ghost")).toEqual([]);
  expect(await cyIds(page, "edge.ghost")).not.toContain(`ghost:${edgeId(90)}`); // its end is gone
  await page.locator("#f-type label", { hasText: "Ships" }).click();
  await expect.poll(() => cyIds(page, "node.ghost")).toContain("ghost:IMO1000099");
  expect(await cyIds(page, "edge.ghost")).toContain(`ghost:${edgeId(90)}`);
});

test("map: the key names new, changed and removed", async ({ page }) => {
  await stubMap(page);
  await mapReady(page);
  const key = page.locator("#key");
  for (const t of ["New since", "Changed", "Removed"]) await expect(key).toContainText(t);
});

test("map shows retry when data fails", async ({ page }) => {
  let down = true;
  await page.route(FLEET_JSON, (r) => (down ? r.abort() : r.fulfill({ json: fleetFixture() })));
  await page.route(CHANGES_JSON, (r) => r.fulfill({ json: recordFixture(STD_CHANGES) }));
  await page.goto(MAP);
  await expect(page.getByText("Map data unavailable right now")).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry" })).toBeFocused();
  await expect(page.locator("#changes")).toBeHidden(); // an empty "What changed" would only confuse
  down = false;
  await page.getByRole("button", { name: "Retry" }).click();
  await page.locator("html[data-ready]").waitFor({ state: "attached" });
  await expect(page.getByText("Map data unavailable right now")).toBeHidden();
  await expect(page.locator("#changes")).toBeVisible();
  await expect(page.locator(".chg-title")).toHaveText("Since 12 Oct · 7 changes");
});

test("map: a wrong-shape data file also shows retry", async ({ page }) => {
  await page.route(FLEET_JSON, (r) => r.fulfill({ json: { oops: 1 } }));
  await page.goto(MAP);
  await expect(page.getByText("Map data unavailable right now")).toBeVisible();
});
