// BCA Approve — approval of content by email link, no login needed.
//   POST {action:"send", entity, entity_id, to_email, to_name?, message?}   staff (JWT, owner/admin):
//        creates a token, emails the approver a summary of the content with Approve / Request changes buttons.
//   POST {action:"show", token}                                              public: returns the content for approve.html
//   POST {action:"decide", token, decision:"approved"|"changes", note?}      public: records the decision in content_reviews,
//        moves the content's status, marks the token used, and tells the sender by email.
// Deploy with Verify JWT OFF (the approver has no account); staff calls are checked against tenant_users here.
// Needs RESEND_API_KEY (same as bca-intake). Links point at ENGINE_URL (default https://bca.coachingengine.app).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, authorization, apikey",
  "Content-Type": "application/json",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: cors });
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const admin = () => createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const ENGINE = (Deno.env.get("ENGINE_URL") || "https://bca.coachingengine.app").replace(/\/$/, "");
const TABLE: Record<string, string> = { plan: "content_plans", social: "social_posts", blog: "blog_posts" };

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
  <tr><td style="padding:24px 34px 8px;border-bottom:1px solid #EFE9DC"><img src="${BRAND.logo}" alt="BCA Leadership" width="118" style="width:118px;height:auto;display:block;border:0"></td></tr>
  <tr><td style="padding:28px 34px 12px;font-family:Georgia,'Times New Roman',serif;font-size:17px;line-height:1.65;color:${BRAND.ink}">${inner}</td></tr>
  ${opts.footnote ? `<tr><td style="padding:0 34px 24px;font-family:Helvetica,Arial,sans-serif;font-size:12.5px;line-height:1.5;color:${BRAND.mute}">${opts.footnote}</td></tr>` : ""}
  <tr><td style="background:${BRAND.night};padding:20px 34px;font-family:Helvetica,Arial,sans-serif;font-size:11.5px;line-height:1.7;color:rgba(250,246,238,.72)">
    <span style="color:${BRAND.gold};letter-spacing:.22em;font-size:10.5px;text-transform:uppercase">BCA Leadership</span><br>
    <span style="font-family:Georgia,serif;font-style:italic;font-size:14px;color:#FAF6EE">Where Africa's leaders sharpen each other.</span><br>${BRAND.address}<br>
    <a href="${BRAND.site}" style="color:${BRAND.gold};text-decoration:none">bcaleadership.com</a></td></tr>
</table></td></tr></table></body></html>`;
}
const button = (href: string, label: string, bg: string, fg: string) =>
  `<a href="${href}" style="display:inline-block;background:${bg};color:${fg};font-family:Helvetica,Arial,sans-serif;font-weight:700;font-size:13px;letter-spacing:.06em;text-transform:uppercase;padding:13px 20px;text-decoration:none;margin:4px 10px 4px 0">${label}</a>`;

async function send(to: string[], subject: string, html: string, replyTo?: string) {
  const key = Deno.env.get("RESEND_API_KEY"); if (!key) return false;
  try {
    const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: Deno.env.get("RESEND_FROM") || "BCA Leadership <info@bcaleadership.com>", to, subject, html, ...(replyTo ? { reply_to: replyTo } : {}) }) });
    return r.ok;
  } catch (_) { return false; }
}

/* What the approver sees: a plain summary of the thing, whatever its kind. */
function summarise(entity: string, row: any): { title: string; kind: string; html: string; text: string } {
  const paras = (s: unknown) => String(s || "").split(/\n{2,}/).map((p) => `<p style="margin:0 0 12px">${esc(p).replace(/\n/g, "<br>")}</p>`).join("");
  if (entity === "plan") {
    const dates = (row.key_dates || []).map((d: any) => `${d.on || ""} ${d.what || ""}`.trim()).join(", ");
    return { title: row.headline || row.title, kind: "Campaign plan",
      html: `<p><b>${esc(row.title)}</b> · ${esc(row.period_start)} to ${esc(row.period_end)}</p>${row.headline ? `<p style="font-size:20px">${esc(row.headline)}</p>` : ""}${row.objectives ? `<p><b>Objectives.</b> ${esc(row.objectives)}</p>` : ""}${row.audience ? `<p><b>Audience.</b> ${esc(row.audience)}</p>` : ""}${(row.pillars || []).length ? `<p><b>Pillars.</b> ${esc((row.pillars || []).join(" · "))}</p>` : ""}${dates ? `<p><b>Key dates.</b> ${esc(dates)}</p>` : ""}${row.notes ? paras(row.notes) : ""}`,
      text: `${row.title}\n${row.headline || ""}\n${row.objectives || ""}` };
  }
  if (entity === "social") {
    const when = row.scheduled_for ? new Date(row.scheduled_for).toUTCString().replace(":00 GMT", " GMT") : "not scheduled";
    return { title: (row.title || String(row.body || "").split("\n")[0] || "Social post").slice(0, 90), kind: `${String(row.platform || "").replace(/^\w/, (c: string) => c.toUpperCase())} post`,
      html: `<p class="m">${esc(String(row.platform || "")).toUpperCase()} · ${esc(when)}</p>${row.title ? `<p><b>${esc(row.title)}</b></p>` : ""}${paras(row.body)}${row.link_url ? `<p>Link: <a href="${esc(row.link_url)}">${esc(row.link_url)}</a></p>` : ""}${row.media_note ? `<p><i>Image or video: ${esc(row.media_note)}</i></p>` : ""}`,
      text: String(row.body || "") };
  }
  const body = String(row.body_en || "");
  const bodyHtml = body.split(/\n{2,}/).map((p) => p.startsWith("## ") ? `<h3 style="font-weight:400;margin:18px 0 6px">${esc(p.slice(3))}</h3>` : `<p style="margin:0 0 12px">${esc(p)}</p>`).join("");
  return { title: row.title_en || row.slug, kind: "Blog post",
    html: `<p class="m">Blog · slot ${esc(row.publish_on || "—")} · ${esc(row.author_name || "")}</p><p style="font-size:20px"><b>${esc(row.title_en || "")}</b></p>${row.excerpt_en ? `<p><i>${esc(row.excerpt_en)}</i></p>` : ""}${bodyHtml}<p class="m">French, Spanish and Portuguese versions: ${["fr", "es", "pt"].map((l) => (row[`body_${l}`] ? l.toUpperCase() + " ready" : l.toUpperCase() + " pending")).join(", ")}.</p>`,
    text: `${row.title_en || ""}\n${row.excerpt_en || ""}\n\n${body}` };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);
  const db = admin();
  let b: any = {}; try { b = await req.json(); } catch { return json({ ok: false, error: "bad_json" }, 400); }
  const action = String(b.action || "");

  /* ── staff: send the request ── */
  if (action === "send") {
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ ok: false, error: "unauthenticated" }, 401);
    const { data: userRes, error: ue } = await db.auth.getUser(token);
    if (ue || !userRes?.user) return json({ ok: false, error: "unauthenticated" }, 401);
    const entity = String(b.entity || ""); const table = TABLE[entity];
    if (!table) return json({ ok: false, error: "bad_entity" }, 422);
    const { data: row } = await db.from(table).select("*").eq("id", String(b.entity_id || "")).maybeSingle();
    if (!row) return json({ ok: false, error: "not_found" }, 404);
    const { data: member } = await db.from("tenant_users").select("full_name,email,role,status").eq("tenant_id", row.tenant_id).eq("user_id", userRes.user.id).maybeSingle();
    if (!member || member.status === "suspended" || !["owner", "admin"].includes(member.role)) return json({ ok: false, error: "forbidden" }, 403);
    const toEmail = String(b.to_email || "").trim().toLowerCase(); const toName = String(b.to_name || "").trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(toEmail)) return json({ ok: false, error: "bad_email" }, 422);
    const { data: person } = await db.from("people").select("id").eq("tenant_id", row.tenant_id).eq("user_id", userRes.user.id).maybeSingle();

    const tok = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
    const { data: ar, error: ie } = await db.from("approval_requests").insert({
      tenant_id: row.tenant_id, entity, entity_id: row.id, token: tok, recipient_name: toName || null, recipient_email: toEmail,
      message: String(b.message || "").trim() || null, sent_by: person?.id || null,
    }).select("id").single();
    if (ie) return json({ ok: false, error: "insert_failed", detail: ie.message }, 500);

    const s = summarise(entity, row);
    const link = `${ENGINE}/approve.html?t=${tok}`;
    const first = (toName || "there").split(/\s+/)[0].replace(/^Dr\.?$/i, toName.split(/\s+/)[1] || "there");
    const sender = member.full_name || member.email;
    const html = brandEmail(`<p>Hello ${esc(first)},</p>
      <p>${esc(sender)} is asking for your approval on a ${esc(s.kind.toLowerCase())} before it goes out.</p>
      ${b.message ? `<p style="border-left:3px solid ${BRAND.gold};padding-left:12px;color:${BRAND.espresso}">${esc(String(b.message))}</p>` : ""}
      <div style="background:${BRAND.cream};border:1px solid #E9E2D4;padding:18px 20px;margin:16px 0;font-size:15.5px">${s.html.replace(/class="m"/g, `style="font-family:Helvetica,Arial,sans-serif;font-size:12px;letter-spacing:.1em;text-transform:uppercase;color:${BRAND.mute}"`)}</div>
      <p>One click records your decision. You can add a note on the next page.</p>
      <p>${button(link + "&d=approved", "Approve", BRAND.green, "#FAF6EE")}${button(link + "&d=changes", "Request changes", "#FFFFFF", BRAND.night).replace('style="', `style="border:1px solid ${BRAND.night};`)}</p>`,
      { preheader: `${s.kind}: ${s.title}`, footnote: `This link is personal to you and works for 21 days. If it was not meant for you, ignore this email. Sent from the BCA Coaching Engine on behalf of ${esc(sender)}.` });
    const sent = await send([toEmail], `For your approval: ${s.title}`, html, member.email || undefined);

    // note on the review trail, so the team sees it went out
    await db.from("content_reviews").insert({ tenant_id: row.tenant_id, entity, entity_id: row.id, reviewer: person?.id || null, decision: "comment",
      note: `Sent to ${toName || toEmail} for approval by email${sent ? "" : " (email sending is off; share the link by hand)"}.` });
    if (!["review"].includes(row.status) && ["draft"].includes(row.status)) await db.from(table).update({ status: "review" }).eq("id", row.id);
    return json({ ok: true, id: ar.id, link, sent });
  }

  /* ── approver: show and decide (token is the credential) ── */
  const tok = String(b.token || "").trim();
  if (!/^[a-f0-9]{64}$/.test(tok)) return json({ ok: false, error: "bad_token" }, 400);
  const { data: ar } = await db.from("approval_requests").select("*").eq("token", tok).maybeSingle();
  if (!ar) return json({ ok: false, error: "not_found" }, 404);
  const expired = new Date(ar.expires_at).getTime() < Date.now();
  const { data: row } = await db.from(TABLE[ar.entity]).select("*").eq("id", ar.entity_id).maybeSingle();
  if (!row) return json({ ok: false, error: "gone" }, 404);
  const s = summarise(ar.entity, row);
  const { data: sender } = ar.sent_by ? await db.from("people").select("first_name,last_name,email").eq("id", ar.sent_by).maybeSingle() : { data: null };
  const senderName = sender ? `${sender.first_name || ""} ${sender.last_name || ""}`.trim() : "The BCA team";

  if (action === "show") {
    if (!ar.opened_at) await db.from("approval_requests").update({ opened_at: new Date().toISOString() }).eq("id", ar.id);
    return json({ ok: true, entity: ar.entity, kind: s.kind, title: s.title, html: s.html, recipient: ar.recipient_name || ar.recipient_email,
      message: ar.message, sender: senderName, sent_at: ar.sent_at, expired, decided: !!ar.decided_at, decision: ar.decision, note: ar.note, status: row.status });
  }
  if (action === "decide") {
    if (expired) return json({ ok: false, error: "expired" }, 410);
    if (ar.decided_at) return json({ ok: false, error: "already", decision: ar.decision }, 409);
    const decision = b.decision === "approved" ? "approved" : b.decision === "changes" ? "changes" : null;
    if (!decision) return json({ ok: false, error: "bad_decision" }, 422);
    const note = String(b.note || "").trim() || null;
    if (decision === "changes" && !note) return json({ ok: false, error: "note_required" }, 422);
    const who = ar.recipient_name || ar.recipient_email;
    await db.from("approval_requests").update({ decided_at: new Date().toISOString(), decision, note }).eq("id", ar.id);
    await db.from("content_reviews").insert({ tenant_id: ar.tenant_id, entity: ar.entity, entity_id: ar.entity_id, reviewer: null, decision,
      note: `${who} by email: ${note || (decision === "approved" ? "Approved." : "")}` });
    const table = TABLE[ar.entity];
    if (decision === "approved" && ["draft", "review"].includes(row.status)) {
      const complete = ar.entity !== "blog" || ["en", "fr", "es", "pt"].every((l) => (row[`title_${l}`] || "").trim() && (row[`excerpt_${l}`] || "").trim() && (row[`body_${l}`] || "").trim());
      if (complete) await db.from(table).update({ status: "approved", approved_at: new Date().toISOString() }).eq("id", row.id);
    }
    if (decision === "changes" && ["review", "approved"].includes(row.status)) await db.from(table).update({ status: "draft" }).eq("id", row.id);
    if (sender?.email) {
      await send([sender.email], `${who} ${decision === "approved" ? "approved" : "asked for changes on"}: ${s.title}`,
        brandEmail(`<p>${esc(who)} has ${decision === "approved" ? "<b>approved</b>" : "<b>asked for changes</b> on"} the ${esc(s.kind.toLowerCase())} <b>${esc(s.title)}</b>.</p>${note ? `<p style="border-left:3px solid ${BRAND.gold};padding-left:12px">${esc(note)}</p>` : ""}<p><a href="${ENGINE}/" style="color:${BRAND.night}"><b>Open the engine</b></a> to continue.</p>`, { preheader: note || s.title }));
    }
    return json({ ok: true, decision });
  }
  return json({ ok: false, error: "bad_action" }, 422);
});
