// BCA Intelligence — two jobs.
//   POST {action:"ask", question}       signed-in staff: plain-language question → one read-only SQL,
//                                       run AS THE CALLER (RLS applies) → plain-English answer
//   POST {action:"briefing", tenant_id} pg_cron on Monday (x-intel-key): fixed figures → written briefing
//                                       → stored in intel_briefings and emailed to admin@
// The model receives table and column names and the question, never a key, a token or a
// row the caller could not read in the console. Every question is logged with its SQL.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, authorization, apikey, x-intel-key",
  "Content-Type": "application/json",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: cors });
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const MODEL = Deno.env.get("INTEL_MODEL") || "claude-sonnet-4-5";

/* ── BCA branded email shell (palette and logo from bcaleadership.com) ── */
const BRAND = {
  night: "#24170C", espresso: "#452C23", gold: "#F7A61C", green: "#058D52", greenMid: "#23A455",
  clay: "#C14027", olive: "#ABBB61", ink: "#242424", cream: "#FAF6EE", mute: "#6F665E",
  logo: "https://bcaleadership.com/assets/logo-dark.png", site: "https://bcaleadership.com",
  address: "Suite 113, First Floor, Grand Baie Business Park Phase 1, Grand Baie, Mauritius",
};
function brandStrip(): string {
  const cells = [[BRAND.green, 64], [BRAND.gold, 16], [BRAND.clay, 16], [BRAND.olive, 16], [BRAND.espresso, 16], [BRAND.gold, 16], [BRAND.greenMid, 64]];
  const row = cells.concat(cells, cells, cells).map(([c, w]) => `<td width="${w}" height="7" style="background:${c};height:7px;line-height:7px;font-size:1px">&nbsp;</td>`).join("");
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="table-layout:fixed;overflow:hidden"><tr>${row}</tr></table>`;
}
function brandEmail(inner: string, opts: { preheader?: string; footnote?: string } = {}): string {
  return `<!doctype html><html><body style="margin:0;padding:0;background:${BRAND.cream}">
<span style="display:none;max-height:0;overflow:hidden;color:transparent;opacity:0">${opts.preheader || ""}</span>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${BRAND.cream};padding:26px 12px 34px"><tr><td align="center">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid #E9E2D4">
  <tr><td style="padding:0;overflow:hidden">${brandStrip()}</td></tr>
  <tr><td style="padding:24px 34px 8px;border-bottom:1px solid #EFE9DC">
    <img src="${BRAND.logo}" alt="BCA Leadership" width="118" style="width:118px;height:auto;display:block;border:0">
  </td></tr>
  <tr><td style="padding:28px 34px 12px;font-family:Georgia,'Cormorant Garamond','Times New Roman',serif;font-size:17px;line-height:1.65;color:${BRAND.ink}">${inner}</td></tr>
  ${opts.footnote ? `<tr><td style="padding:0 34px 24px;font-family:Helvetica,Arial,sans-serif;font-size:12.5px;line-height:1.5;color:${BRAND.mute}">${opts.footnote}</td></tr>` : ""}
  <tr><td style="background:${BRAND.night};padding:20px 34px;font-family:Helvetica,Arial,sans-serif;font-size:11.5px;line-height:1.7;color:rgba(250,246,238,.72)">
    <span style="color:${BRAND.gold};letter-spacing:.22em;font-size:10.5px;text-transform:uppercase">BCA Leadership</span><br>
    <span style="font-family:Georgia,serif;font-style:italic;font-size:14px;color:#FAF6EE">Where Africa's leaders sharpen each other.</span><br>
    ${BRAND.address}<br>
    <a href="${BRAND.site}" style="color:${BRAND.gold};text-decoration:none">bcaleadership.com</a>
  </td></tr>
</table></td></tr></table></body></html>`;
}
const nl2p = (t: string) => esc(t).split(/\n{2,}/).map((para) => `<p>${para.replace(/\n/g, "<br>")}</p>`).join("");

async function ask(system: string, user: string, maxTokens = 1200): Promise<string> {
  const key = Deno.env.get("ANTHROPIC_API_KEY");
  if (!key) throw new Error("intel_off");
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] }),
  });
  if (!r.ok) { console.error("anthropic", r.status, await r.text()); throw new Error("model_failed"); }
  const j = await r.json();
  return (j.content || []).filter((c: any) => c.type === "text").map((c: any) => c.text).join("\n").trim();
}
const stripFence = (s: string) => s.replace(/^```[a-z]*\s*/i, "").replace(/```\s*$/, "").trim();

const SQL_RULES = `You write one PostgreSQL SELECT for BCA Leadership's coaching engine and nothing else.
Rules:
- Output only the SQL. No prose, no code fence, no trailing semicolon.
- One statement, SELECT or WITH. Never write, never touch schemas other than public. Never use set, pg_, information_schema.
- Row-level security already limits rows to BCA; do not filter on tenant_id.
- Money columns ending in _minor are cents: divide by 100.0 for currency amounts and alias them clearly.
- Dates: use now() and date arithmetic; "this month" = date_trunc('month', now()).
- People names: coalesce(first_name || ' ' || last_name, email). Staff are people whose email ends with bcaleadership.com.
- Prefer aggregates and short result sets. Add "limit 50" unless the question needs a count only.
- Column names in the result should be readable (snake_case is fine).
- If the question cannot be answered from these tables, output exactly: SELECT 'not_answerable' as note`;

const ANSWER_RULES = `You are the analyst inside BCA Leadership's coaching engine, answering a staff member.
Write the answer in plain English, two to five sentences, numbers first, no bullet points, no headers.
Use the rows given. Do not invent figures. Money is USD unless a currency column says otherwise.
If the rows are empty, say so plainly and suggest one narrower question.
If a note says not_answerable, say the question is outside the data the engine holds and name what would be needed.`;

const BRIEF_RULES = `You write the Monday briefing for the BCA Leadership team from the figures supplied.
Voice: warm, direct, no jargon, no bullet points, no headers, no emojis. 140 to 220 words, four short paragraphs.
Paragraph one: money (invoices outstanding, overdue, paid last week). Two: pipeline and proposals. Three: inbound requests and leads, and anything unanswered past 24 hours. Four: one or two things to do this week, drawn from the figures.
Use the numbers as given. Do not invent. Do not add a greeting or sign-off.`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);
  let b: any; try { b = await req.json(); } catch { return json({ ok: false, error: "bad_json" }, 400); }
  const url = Deno.env.get("SUPABASE_URL")!;

  /* ── a staff member asks ── */
  if (b.action === "ask") {
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ ok: false, error: "unauthenticated" }, 401);
    const question = String(b.question || "").trim().slice(0, 600);
    if (question.length < 4) return json({ ok: false, error: "empty" }, 422);
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: userRes, error: ue } = await admin.auth.getUser(token);
    if (ue || !userRes?.user) return json({ ok: false, error: "unauthenticated" }, 401);
    // Everything from here runs as the caller, so RLS decides what the query can see.
    const me = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: `Bearer ${token}` } } });
    const { data: tu } = await admin.from("tenant_users").select("tenant_id,role,status").eq("user_id", userRes.user.id).maybeSingle();
    if (!tu || tu.status === "suspended") return json({ ok: false, error: "forbidden" }, 403);
    const { data: staff } = await admin.from("people").select("id").eq("tenant_id", tu.tenant_id).eq("user_id", userRes.user.id).maybeSingle();
    const t0 = Date.now();
    const log = async (fields: Record<string, unknown>) => {
      await me.from("intel_questions").insert({ tenant_id: tu.tenant_id, asked_by: staff?.id || null, question, ms: Date.now() - t0, ...fields }).then(() => {}, (e: unknown) => console.error("log", e));
    };
    let sql = "", rows: any = null, err = "";
    try {
      const { data: schema, error: se } = await me.rpc("intel_schema");
      if (se) throw new Error("schema: " + se.message);
      sql = stripFence(await ask(SQL_RULES + "\n\nTables:\n" + schema, question, 600));
      let { data, error } = await me.rpc("intel_run", { p_sql: sql });
      if (error) {
        // One repair attempt with the database's own complaint.
        sql = stripFence(await ask(SQL_RULES + "\n\nTables:\n" + schema, `${question}\n\nYour previous SQL failed with: ${error.message}\nPrevious SQL:\n${sql}\nWrite a corrected SELECT.`, 600));
        ({ data, error } = await me.rpc("intel_run", { p_sql: sql }));
        if (error) throw new Error(error.message);
      }
      rows = data;
    } catch (e) {
      err = String((e as Error).message || e);
      await log({ sql: sql || null, ok: false, error: err });
      const friendly = err === "intel_off" ? "Intelligence is not switched on yet: the model key is missing from the engine's secrets." : err === "model_failed" ? "The model did not answer. Try again in a moment." : `The question could not be run: ${err}`;
      return json({ ok: false, error: err, answer: friendly, sql }, err === "intel_off" ? 503 : 200);
    }
    const sample = JSON.stringify(rows).slice(0, 12000);
    let answer = "";
    try { answer = await ask(ANSWER_RULES, `Question: ${question}\n\nSQL used:\n${sql}\n\nRows (JSON, up to 200):\n${sample}`, 500); }
    catch { answer = rows?.length ? `${rows.length} row${rows.length === 1 ? "" : "s"} came back; the written summary is unavailable right now, the table below is the answer.` : "No rows came back for that question."; }
    await log({ sql, answer, row_count: Array.isArray(rows) ? rows.length : null, ok: true });
    return json({ ok: true, answer, sql, rows: Array.isArray(rows) ? rows.slice(0, 200) : [] });
  }

  /* ── Monday briefing (cron) ── */
  if (b.action === "briefing") {
    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: sec } = await admin.from("platform_secrets").select("value").eq("name", "intel_key").maybeSingle();
    if (!sec || req.headers.get("x-intel-key") !== sec.value) return json({ ok: false, error: "forbidden" }, 403);
    const tenant = String(b.tenant_id || "");
    const weekOf = (() => { const d = new Date(); const day = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - day); return d.toISOString().slice(0, 10); })();
    const since = new Date(Date.now() - 7 * 864e5).toISOString();
    const n = async (table: string, f: (q: any) => any) => { const { count } = await f(admin.from(table).select("*", { count: "exact", head: true }).eq("tenant_id", tenant)); return count || 0; };
    const sum = async (table: string, col: string, f: (q: any) => any) => { const { data } = await f(admin.from(table).select(col).eq("tenant_id", tenant)); return (data || []).reduce((t: number, r: any) => t + Number(r[col] || 0), 0) / 100; };
    const today = new Date().toISOString().slice(0, 10);
    const figures = {
      week_of: weekOf,
      invoices_open: await n("invoices", (q) => q.in("status", ["sent", "overdue", "partial"])),
      invoices_open_usd: await sum("invoices", "total_minor", (q) => q.in("status", ["sent", "overdue", "partial"])),
      invoices_overdue: await n("invoices", (q) => q.in("status", ["sent", "overdue", "partial"]).lt("due_on", today)),
      paid_last_week_usd: await sum("invoices", "paid_minor", (q) => q.eq("status", "paid").gte("updated_at", since)),
      opportunities_open: await n("opportunities", (q) => q.in("stage", ["prospect", "qualified", "proposal", "negotiation"])),
      opportunities_open_usd: await sum("opportunities", "value_minor", (q) => q.in("stage", ["prospect", "qualified", "proposal", "negotiation"])),
      proposals_out: await n("proposals", (q) => q.in("status", ["sent", "viewed"])),
      proposals_out_usd: await sum("proposals", "value_minor", (q) => q.in("status", ["sent", "viewed"])),
      proposals_accepted_last_week: await n("proposals", (q) => q.eq("status", "accepted").gte("decided_at", since)),
      requests_new_last_week: await n("requests", (q) => q.gte("received_at", since)),
      requests_unanswered_over_24h: await n("requests", (q) => q.eq("status", "new").is("first_response_at", null).lt("received_at", new Date(Date.now() - 864e5).toISOString())),
      leads_new_last_week: await n("leads", (q) => q.gte("created_at", since)),
      members_active: await n("memberships", (q) => q.eq("status", "active")),
      memberships_renewing_30d: await n("memberships", (q) => q.eq("status", "active").lte("renews_on", new Date(Date.now() + 30 * 864e5).toISOString().slice(0, 10))),
      sessions_this_week: await n("sessions", (q) => q.gte("scheduled_at", weekOf).lt("scheduled_at", new Date(Date.parse(weekOf) + 7 * 864e5).toISOString())),
    };
    let body: string;
    try { body = await ask(BRIEF_RULES, JSON.stringify(figures, null, 1), 700); }
    catch (e) { console.error("briefing_model", e); body = `Figures for the week of ${weekOf}: ${figures.invoices_open} invoices open worth $${figures.invoices_open_usd.toLocaleString()}, ${figures.invoices_overdue} overdue. ${figures.opportunities_open} opportunities open, ${figures.proposals_out} proposals out. ${figures.requests_new_last_week} new requests last week, ${figures.requests_unanswered_over_24h} unanswered past 24 hours. (Written summary unavailable: model key missing.)`; }
    const to = ["info@bcaleadership.com"];
    await admin.from("intel_briefings").upsert({ tenant_id: tenant, week_of: weekOf, figures, body, sent_to: to }, { onConflict: "tenant_id,week_of" });
    const key = Deno.env.get("RESEND_API_KEY");
    if (key) {
      const from = Deno.env.get("RESEND_FROM") || "BCA Leadership <info@bcaleadership.com>";
      const html = brandEmail(`<p style="margin:0 0 4px;font-family:Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:${BRAND.mute}">Monday briefing · week of ${weekOf}</p>${nl2p(body)}<p style="margin-top:22px"><a href="https://bca.coachingengine.app/#intel" style="color:${BRAND.gold}">Ask a follow-up in the console</a></p>`, { preheader: `Week of ${weekOf}: ${figures.invoices_overdue} overdue, ${figures.proposals_out} proposals out` });
      await fetch("https://api.resend.com/emails", { method: "POST", headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from, to, subject: `BCA briefing, week of ${weekOf}`, html }) }).then(async (r) => { if (!r.ok) console.error("resend", r.status, await r.text()); }, (e) => console.error("resend", e));
    }
    return json({ ok: true, week_of: weekOf, figures });
  }
  return json({ ok: false, error: "bad_action" }, 400);
});
