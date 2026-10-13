// OpenSanctions proxy. Never returns an error page: the page falls back to an outbound link.
const UPSTREAM = "https://api.opensanctions.org/search/default";
const TIMEOUT_MS = 4500;

function json(body, { status = 200, cache = false } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": cache ? "public, s-maxage=86400" : "no-store" },
  });
}

export async function GET(request) {
  const q = (new URL(request.url).searchParams.get("q") || "").trim();
  if (!q || q.length > 200) return json({ error: "bad query" }, { status: 400 });
  const key = process.env.OPENSANCTIONS_API_KEY;
  if (!key) return json({ enabled: false });
  try {
    const res = await fetch(`${UPSTREAM}?${new URLSearchParams({ q, limit: "10" })}`, {
      headers: { Authorization: `ApiKey ${key}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return json({ enabled: true, error: true });
    const body = await res.json();
    const results = (body.results || []).slice(0, 10).map((r) => ({
      name: r.caption,
      schema: r.schema,
      datasets: r.datasets || [],
      url: `https://www.opensanctions.org/entities/${encodeURIComponent(r.id)}/`,
    }));
    return json({ enabled: true, results }, { cache: true });
  } catch {
    return json({ enabled: true, error: true });
  }
}
