// BCA Campaign — the sending side of Campaigns.
//   POST {action:"test", campaign_id}          staff (JWT): send the campaign to the caller only, marked TEST
//   POST {action:"send", campaign_id}          staff (JWT, owner/admin): send to the audience now
//   POST {action:"dispatch"}                   pg_cron (x-nudge-key): send anything scheduled and due
//   POST Resend webhook (svix headers)         delivered / opened / clicked / bounced / complained → per-recipient status
//   GET  ?u=<unsubscribe_token>                one-click unsubscribe page
// Audience resolution is app.campaign_audience (SQL). Every message carries List-Unsubscribe,
// a footer unsubscribe link, the campaign tag, and UTM parameters on every link.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, authorization, apikey, x-nudge-key, svix-id, svix-timestamp, svix-signature",
  "Content-Type": "application/json",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: cors });
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const FN = "https://uojsxmdnpwskxeueftgp.supabase.co/functions/v1/bca-campaign";

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
const button = (href: string, text: string) =>
  `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:22px 0 6px"><tr><td style="background:${BRAND.gold};border-radius:3px">
   <a href="${href}" style="display:inline-block;padding:13px 26px;font-family:Helvetica,Arial,sans-serif;font-size:13.5px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:${BRAND.night};text-decoration:none">${text}</a></td></tr></table>`;

/* Body text → paragraphs. {first} is the recipient's first name. Bare URLs become links with UTM. */
function utm(url: string, c: any): string {
  try { const u = new URL(url); if (/bcaleadership\.com$/i.test(u.hostname)) { u.searchParams.set("utm_source", "engine"); u.searchParams.set("utm_medium", "email"); u.searchParams.set("utm_campaign", c.utm_campaign || c.id); } return u.toString(); }
  catch { return url; }
}
const ABOUT_DEFAULT = {
  headline: "About BCA Leadership",
  text: "Africa's premier executive coaching and peer-learning network: 45 certified coaches, membership from $600 a year, serving 5,000+ leaders since 2017. Where Africa's leaders sharpen each other.",
  links: [
    { label: "Membership", url: "https://bcaleadership.com/membership.html", note: "Join the network" },
    { label: "The Bench", url: "https://bcaleadership.com/the-bench.html", note: "Meet the coaches" },
    { label: "Insights", url: "https://bcaleadership.com/insights.html", note: "Essays and podcast" },
  ],
};
const longDate = (d = new Date()) => d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
/* The letter. Letterhead (shell), date line, message, button, sign-off block, About panel, footer. */
function render(c: any, first: string, unsubUrl: string, test = false, about: any = ABOUT_DEFAULT): string {
  const paras = esc(c.body.replace(/\{first\}/g, first || "there")).split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 16px">${p.replace(/\n/g, "<br>").replace(/(https?:\/\/[^\s<]+)/g, (m) => `<a href="${utm(m.replace(/&amp;/g, "&"), c)}" style="color:${BRAND.gold}">${m}</a>`)}</p>`).join("");
  const cta = c.cta_text && c.cta_url ? button(utm(c.cta_url, c), esc(c.cta_text)) : "";
  const signer = c.signer_name ? `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:26px 0 6px"><tr>
      <td style="border-left:3px solid ${BRAND.gold};padding:2px 0 2px 14px;font-family:Helvetica,Arial,sans-serif">
        <span style="font-family:Georgia,serif;font-size:17px;color:${BRAND.night}"><b>${esc(c.signer_name)}</b></span><br>
        ${c.signer_title ? `<span style="font-size:13px;color:${BRAND.mute}">${esc(c.signer_title)}</span><br>` : ""}
        <span style="font-size:13px;color:${BRAND.mute}">BCA Leadership · <a href="mailto:${esc(c.from_mailbox)}" style="color:${BRAND.gold};text-decoration:none">${esc(c.from_mailbox)}</a></span>
      </td></tr></table>` : "";
  const aboutPanel = c.show_about === false ? "" : `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-top:30px;background:${BRAND.cream};border-top:3px solid ${BRAND.green}">
      <tr><td style="padding:22px 26px 6px;font-family:Helvetica,Arial,sans-serif;font-size:10.5px;letter-spacing:.22em;text-transform:uppercase;color:${BRAND.espresso}">${esc(about.headline || ABOUT_DEFAULT.headline)}</td></tr>
      <tr><td style="padding:0 26px 16px;font-family:Georgia,serif;font-size:15px;line-height:1.6;color:${BRAND.ink}">${esc(about.text || ABOUT_DEFAULT.text)}</td></tr>
      <tr><td style="padding:0 20px 22px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>
        ${(about.links || ABOUT_DEFAULT.links).slice(0, 3).map((l: any) => `<td width="33%" style="padding:0 6px"><a href="${utm(l.url, c)}" style="display:block;background:#ffffff;border:1px solid #E9E2D4;padding:12px 12px;text-decoration:none">
          <span style="font-family:Georgia,serif;font-size:15px;color:${BRAND.night}"><b>${esc(l.label)}</b></span><br>
          <span style="font-family:Helvetica,Arial,sans-serif;font-size:12px;color:${BRAND.mute}">${esc(l.note || "")}</span></a></td>`).join("")}
      </tr></table></td></tr></table>`;
  const head = `<p style="margin:0 0 18px;font-family:Helvetica,Arial,sans-serif;font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:${BRAND.mute}">${longDate()}</p>`;
  return brandEmail(`${test ? `<p style="background:#FBEBC9;padding:8px 12px;font-family:Helvetica,Arial,sans-serif;font-size:12px">TEST SEND. Only you received this.</p>` : ""}${head}${paras}${cta}${signer}${aboutPanel}`,
    { preheader: c.preheader || "", footnote: `You are receiving this because you are a member of, or have been in touch with, BCA Leadership. <a href="${unsubUrl}" style="color:${BRAND.mute}">Unsubscribe</a> in one click.` });
}

const admin = () => createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

async function resendBatch(msgs: any[]): Promise<any[]> {
  const key = Deno.env.get("RESEND_API_KEY"); if (!key) throw new Error("email_off");
  const r = await fetch("https://api.resend.com/emails/batch", { method: "POST", headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify(msgs) });
  if (!r.ok) { const t = await r.text(); console.error("resend_batch", r.status, t); throw new Error("send_failed: " + t.slice(0, 200)); }
  const j = await r.json().catch(() => ({})); return j.data || [];
}

async function recount(db: any, campaignId: string) {
  const { data } = await db.from("campaign_recipients").select("status").eq("campaign_id", campaignId);
  const rows = data || []; const n = (f: (s: string) => boolean) => rows.filter((r: any) => f(r.status)).length;
  await db.from("campaigns").update({
    n_recipients: rows.length, n_sent: n((s) => !["queued", "failed"].includes(s)),
    n_delivered: n((s) => ["delivered", "opened", "clicked", "unsubscribed"].includes(s)),
    n_opened: n((s) => ["opened", "clicked", "unsubscribed"].includes(s)), n_clicked: n((s) => s === "clicked"),
    n_bounced: n((s) => ["bounced", "complained"].includes(s)), n_unsubscribed: n((s) => s === "unsubscribed"),
  }).eq("id", campaignId);
}

/* Send a campaign to its audience (or to one test address). Returns counts. */
async function aboutFor(db: any, tenantId: string) {
  const { data } = await db.from("tenant_config").select("business_rules").eq("tenant_id", tenantId).maybeSingle();
  const a = data?.business_rules?.campaign_about;
  return a && (a.text || a.links) ? { ...ABOUT_DEFAULT, ...a } : ABOUT_DEFAULT;
}
async function sendCampaign(db: any, c: any, testTo?: { email: string; first: string }) {
  const from = `BCA Leadership <${c.from_mailbox || "info@bcaleadership.com"}>`;
  const about = await aboutFor(db, c.tenant_id);
  if (testTo) {
    const [r] = await resendBatch([{ from, to: [testTo.email], reply_to: c.from_mailbox, subject: `[TEST] ${c.subject}`, html: render(c, testTo.first, `${FN}?u=test`, true, about), tags: [{ name: "campaign", value: c.id }, { name: "test", value: "1" }] }]);
    await db.from("campaigns").update({ last_test_at: new Date().toISOString() }).eq("id", c.id);
    return { test: true, id: r?.id || null };
  }
  const { data: aud, error: ae } = await db.rpc("campaign_audience", { p_audience: c.audience, p_filter: c.audience_filter || {} });
  if (ae) throw new Error("audience: " + ae.message);
  const people = (aud || []).filter((p: any) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(p.email));
  await db.from("campaigns").update({ status: "sending", n_recipients: people.length }).eq("id", c.id);
  if (!people.length) { await db.from("campaigns").update({ status: "sent", sent_at: new Date().toISOString() }).eq("id", c.id); return { sent: 0, failed: 0, recipients: 0 }; }
  // Tokens for unsubscribe links
  const ids = people.map((p: any) => p.person_id);
  const { data: toks } = await db.from("people").select("id,unsubscribe_token").in("id", ids);
  const tokOf: Record<string, string> = Object.fromEntries((toks || []).map((t: any) => [t.id, t.unsubscribe_token]));
  await db.from("campaign_recipients").upsert(people.map((p: any) => ({ tenant_id: c.tenant_id, campaign_id: c.id, person_id: p.person_id, email: p.email, status: "queued" })), { onConflict: "campaign_id,email", ignoreDuplicates: true });
  let sent = 0, failed = 0;
  for (let i = 0; i < people.length; i += 50) {
    const chunk = people.slice(i, i + 50);
    const msgs = chunk.map((p: any) => { const unsub = `${FN}?u=${tokOf[p.person_id] || ""}`; return {
      from, to: [p.email], reply_to: c.from_mailbox, subject: c.subject, html: render(c, p.first_name, unsub, false, about),
      headers: { "List-Unsubscribe": `<${unsub}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
      tags: [{ name: "campaign", value: c.id }] }; });
    try {
      const out = await resendBatch(msgs); const now = new Date().toISOString();
      for (let k = 0; k < chunk.length; k++) {
        const id = out[k]?.id || null;
        await db.from("campaign_recipients").update({ status: id ? "sent" : "failed", resend_id: id, sent_at: now, error: id ? null : "no id returned" }).eq("campaign_id", c.id).eq("email", chunk[k].email);
        if (id) sent++; else failed++;
      }
    } catch (e) {
      failed += chunk.length;
      await db.from("campaign_recipients").update({ status: "failed", error: String((e as Error).message).slice(0, 200) }).eq("campaign_id", c.id).in("email", chunk.map((p: any) => p.email));
    }
  }
  await db.from("campaigns").update({ status: "sent", sent_at: new Date().toISOString() }).eq("id", c.id);
  await recount(db, c.id);
  return { sent, failed, recipients: people.length };
}

/* Resend webhook signature (Svix): HMAC-SHA256 over "id.timestamp.body" with the base64 secret after "whsec_". */
async function verifySvix(req: Request, body: string): Promise<boolean> {
  const secret = Deno.env.get("RESEND_WEBHOOK_SECRET"); if (!secret) return false;
  const id = req.headers.get("svix-id") || "", ts = req.headers.get("svix-timestamp") || "", sigs = req.headers.get("svix-signature") || "";
  if (!id || !ts || !sigs) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const raw = Uint8Array.from(atob(secret.replace(/^whsec_/, "")), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("raw", raw, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${ts}.${body}`)));
  const expected = btoa(String.fromCharCode(...mac));
  return sigs.split(" ").some((s) => s.split(",")[1] === expected);
}

const unsubPage = (msg: string) => new Response(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>BCA Leadership</title></head>
<body style="margin:0;background:${BRAND.cream};font-family:Georgia,serif;color:${BRAND.ink}"><div style="max-width:560px;margin:60px auto;padding:0 20px"><img src="${BRAND.logo}" alt="BCA Leadership" width="118" style="display:block;margin-bottom:24px"><p style="font-size:19px;line-height:1.6">${msg}</p><p style="font-family:Helvetica,Arial,sans-serif;font-size:13px;color:${BRAND.mute}">Changed your mind? Write to <a href="mailto:info@bcaleadership.com" style="color:${BRAND.gold}">info@bcaleadership.com</a>.</p></div></body></html>`,
  { headers: { "Content-Type": "text/html; charset=utf-8" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = admin();

  /* ── one-click unsubscribe ── */
  if (req.method === "GET") {
    const u = new URL(req.url).searchParams.get("u") || "";
    if (u === "test") return unsubPage("This was a test message. Nothing has changed.");
    if (!/^[0-9a-f]{32}$/.test(u)) return unsubPage("This link is not valid.");
    const { data: p } = await db.from("people").select("id,tenant_id,email").eq("unsubscribe_token", u).maybeSingle();
    if (!p) return unsubPage("This link is not valid.");
    await db.from("people").update({ marketing_opt_out: true, marketing_opt_out_at: new Date().toISOString() }).eq("id", p.id);
    const { data: recent } = await db.from("campaign_recipients").select("id,campaign_id").eq("person_id", p.id).order("sent_at", { ascending: false }).limit(1);
    if (recent?.[0]) { await db.from("campaign_recipients").update({ status: "unsubscribed" }).eq("id", recent[0].id); await recount(db, recent[0].campaign_id); }
    return unsubPage("You have been unsubscribed. You will not receive campaign emails from BCA Leadership again. Membership, invoice and booking messages are unaffected.");
  }
  if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);
  const bodyText = await req.text();
  let b: any; try { b = JSON.parse(bodyText); } catch { return json({ ok: false, error: "bad_json" }, 400); }

  /* ── Resend webhook ── */
  if (req.headers.get("svix-id")) {
    if (!(await verifySvix(req, bodyText))) return json({ ok: false, error: "bad_signature" }, 401);
    const type = String(b.type || ""); const emailId = b.data?.email_id; if (!emailId) return json({ ok: true, ignored: true });
    const map: Record<string, string> = { "email.delivered": "delivered", "email.opened": "opened", "email.clicked": "clicked", "email.bounced": "bounced", "email.complained": "complained" };
    const next = map[type]; if (!next) return json({ ok: true, ignored: type });
    const { data: r } = await db.from("campaign_recipients").select("id,campaign_id,status,person_id").eq("resend_id", emailId).maybeSingle();
    if (!r) return json({ ok: true, ignored: "not_campaign" });
    const rank: Record<string, number> = { queued: 0, failed: 0, sent: 1, delivered: 2, opened: 3, clicked: 4, unsubscribed: 5, bounced: 5, complained: 5 };
    const patch: any = {};
    if (next === "opened" && !r.opened_at) patch.opened_at = new Date().toISOString();
    if (next === "clicked") patch.clicked_at = new Date().toISOString();
    if ((rank[next] || 0) > (rank[r.status] || 0)) patch.status = next;
    if (Object.keys(patch).length) await db.from("campaign_recipients").update(patch).eq("id", r.id);
    if (next === "complained" && r.person_id) await db.from("people").update({ marketing_opt_out: true, marketing_opt_out_at: new Date().toISOString() }).eq("id", r.person_id);
    await recount(db, r.campaign_id);
    return json({ ok: true });
  }

  /* ── scheduled dispatch (cron) ── */
  if (b.action === "dispatch") {
    const { data: sec } = await db.from("platform_secrets").select("value").eq("name", "nudge_key").maybeSingle();
    if (!sec || req.headers.get("x-nudge-key") !== sec.value) return json({ ok: false, error: "forbidden" }, 403);
    const { data: due } = await db.from("campaigns").select("*").eq("status", "scheduled").lte("scheduled_for", new Date().toISOString()).limit(5);
    const out: any[] = [];
    for (const c of due || []) { try { out.push({ id: c.id, ...(await sendCampaign(db, c)) }); } catch (e) { out.push({ id: c.id, error: String((e as Error).message) }); await db.from("campaigns").update({ status: "approved" }).eq("id", c.id); } }
    return json({ ok: true, dispatched: out });
  }

  /* ── staff actions ── */
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ ok: false, error: "unauthenticated" }, 401);
  const { data: userRes, error: ue } = await db.auth.getUser(token);
  if (ue || !userRes?.user) return json({ ok: false, error: "unauthenticated" }, 401);
  const { data: c } = await db.from("campaigns").select("*").eq("id", String(b.campaign_id || "")).maybeSingle();
  if (!c) return json({ ok: false, error: "not_found" }, 404);
  const { data: member } = await db.from("tenant_users").select("full_name,email,role,status").eq("tenant_id", c.tenant_id).eq("user_id", userRes.user.id).maybeSingle();
  if (!member || member.status === "suspended" || !["owner", "admin"].includes(member.role)) return json({ ok: false, error: "forbidden" }, 403);

  if (b.action === "test") {
    // A test goes to the caller, or to another staff address on this tenant if one is named.
    let to = member.email, first = (member.full_name || "").split(" ")[0];
    if (b.to && String(b.to).toLowerCase() !== String(member.email).toLowerCase()) {
      const { data: other } = await db.from("tenant_users").select("email,full_name").eq("tenant_id", c.tenant_id).ilike("email", String(b.to)).maybeSingle();
      const { data: staffP } = other ? { data: null } : await db.from("people").select("email,first_name").eq("tenant_id", c.tenant_id).ilike("email", String(b.to)).not("user_id", "is", null).maybeSingle();
      if (!other && !staffP) return json({ ok: false, error: "test_to_not_staff" }, 422);
      to = (other?.email || staffP?.email); first = other ? (other.full_name || "").split(" ")[0] : (staffP?.first_name || first);
    }
    try { return json({ ok: true, ...(await sendCampaign(db, c, { email: to, first })) }); }
    catch (e) { return json({ ok: false, error: String((e as Error).message) }, 502); }
  }
  if (b.action === "send") {
    if (!["approved", "scheduled"].includes(c.status)) return json({ ok: false, error: "not_approved" }, 409);
    try { return json({ ok: true, ...(await sendCampaign(db, c)) }); }
    catch (e) { await db.from("campaigns").update({ status: "approved" }).eq("id", c.id); return json({ ok: false, error: String((e as Error).message) }, 502); }
  }
  if (b.action === "preview") {
    const about = await aboutFor(db, c.tenant_id);
    return json({ ok: true, html: render(c, (member.full_name || "").split(" ")[0], `${FN}?u=test`, false, about) });
  }
  if (b.action === "audience") {
    const { data: aud, error: ae } = await db.rpc("campaign_audience", { p_audience: c.audience, p_filter: c.audience_filter || {} });
    if (ae) return json({ ok: false, error: ae.message }, 500);
    return json({ ok: true, count: (aud || []).length, sample: (aud || []).slice(0, 8).map((p: any) => `${[p.first_name, p.last_name].filter(Boolean).join(" ")} <${p.email}>`) });
  }
  return json({ ok: false, error: "bad_action" }, 400);
});
