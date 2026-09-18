import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Website traffic for the BCA console.
//
// Vercel Web Analytics collects the numbers but lives in TechFides's Vercel
// account, which BCA has no seat on. This reads that API server-side and hands
// the console the figures, so BCA sees their own traffic without anyone being
// given access to TechFides infrastructure.
//
// verify_jwt is TRUE: only a signed-in console user reaches this. It holds no
// service role key and touches no database, so the worst it can leak is a
// visitor count to someone who already has a BCA login.
//
// The supported public API is api.vercel.com/v1/query/web-analytics/*,
// documented at https://vercel.com/docs/analytics/web-analytics-api. It exposes
// pageviews and visitors only; there is no bounce rate, so none is reported.

const cors = {
  "Access-Control-Allow-Origin": "https://bca.coachingengine.app",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info",
  "Content-Type": "application/json",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: cors });

const API = "https://api.vercel.com/v1/query/web-analytics";
const day = (d: Date) => d.toISOString().slice(0, 10);

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const token = Deno.env.get("VERCEL_ANALYTICS_TOKEN");
  const projectId = Deno.env.get("VERCEL_PROJECT_ID");
  const teamId = Deno.env.get("VERCEL_TEAM_ID");
  if (!token || !projectId) return json({ unavailable: true, reason: "not_configured" });

  let range = "30d";
  try {
    const b = await req.json();
    if (typeof b?.range === "string") range = b.range;
  } catch (_e) { /* default */ }

  const days = range === "7d" ? 7 : range === "90d" ? 90 : 30;
  const until = new Date();
  const since = new Date(Date.now() - days * 864e5);

  const base = () => {
    const p = new URLSearchParams({ projectId });
    if (teamId) p.set("teamId", teamId);
    return p;
  };
  const get = async (path: string, params: URLSearchParams) => {
    const r = await fetch(`${API}/${path}?${params.toString()}`, {
      headers: { Authorization: "Bearer " + token },
    });
    if (!r.ok) throw new Error(path + "_" + r.status + "_" + (await r.text()).slice(0, 120));
    return r.json();
  };

  try {
    const tp = base();
    tp.set("since", day(since));
    tp.set("until", day(until));
    const totals = await get("visits/count", tp);

    // Each breakdown is optional: a failure in one must not blank the panel.
    const agg = async (by: string, limit?: number) => {
      const p = base();
      p.set("since", day(since));
      p.set("until", day(until));
      p.set("by", by);
      if (limit) p.set("limit", String(limit));
      try {
        const d = await get("visits/aggregate", p);
        return Array.isArray(d?.data) ? d.data : [];
      } catch (_e) { return []; }
    };

    const [daily, pages, referrers, countries, cities, devices] = await Promise.all([
      agg("day"),
      agg("requestPath", 8),
      agg("referrerHostname", 6),
      agg("country", 15),
      agg("city", 10),
      agg("deviceType", 4),
    ]);

    const num = (v: unknown) => Number(v ?? 0);
    return json({
      range,
      since: day(since),
      until: day(until),
      visitors: totals?.data?.visitors ?? 0,
      pageviews: totals?.data?.pageviews ?? 0,
      daily: daily.map((r: Record<string, unknown>) => ({
        date: String(r.timestamp ?? "").slice(0, 10), pageviews: num(r.pageviews), visitors: num(r.visitors),
      })),
      pages: pages.map((r: Record<string, unknown>) => ({
        path: r.requestPath ?? "-", pageviews: num(r.pageviews), visitors: num(r.visitors),
      })),
      referrers: referrers
        .map((r: Record<string, unknown>) => ({ source: r.referrerHostname ?? "", pageviews: num(r.pageviews), visitors: num(r.visitors) }))
        .filter((r: { source: string }) => r.source && r.source !== "-"),
      countries: countries
        .map((r: Record<string, unknown>) => ({ code: String(r.country ?? ""), pageviews: num(r.pageviews), visitors: num(r.visitors) }))
        .filter((r: { code: string }) => r.code && r.code !== "-"),
      cities: cities
        .map((r: Record<string, unknown>) => ({ city: String(r.city ?? ""), pageviews: num(r.pageviews), visitors: num(r.visitors) }))
        .filter((r: { city: string }) => r.city && r.city !== "-"),
      devices: devices
        .map((r: Record<string, unknown>) => ({ device: String(r.deviceType ?? ""), pageviews: num(r.pageviews), visitors: num(r.visitors) }))
        .filter((r: { device: string }) => r.device && r.device !== "-"),
      generated_at: new Date().toISOString(),
    });
  } catch (e) {
    return json({ unavailable: true, reason: String((e as Error)?.message || e).slice(0, 160) });
  }
});
