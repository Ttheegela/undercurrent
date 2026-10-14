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
