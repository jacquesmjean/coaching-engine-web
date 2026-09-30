// BCA Proposal — one function, three jobs.
//   POST {action:"send", proposal_id}            signed-in staff: email the recipient a private link, mark sent
//   GET  ?t=<public_token>                       recipient: read the proposal, record the open
//   POST {action:"decide", t, decision, note}    recipient: accept or decline, notify BCA
// The public link never exposes an id, only the 48-hex token on the row. Everything is
// written with the service role after the token or the JWT has been checked.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, authorization, apikey",
  "Content-Type": "application/json",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: cors });
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const PAGE = "https://bca.coachingengine.app/proposal.html";
const money = (m: number, c = "USD") => (Number(m || 0) / 100).toLocaleString("en-US", { style: "currency", currency: c, maximumFractionDigits: 0 });
const day = (d?: string | null) => d ? new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : "";

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
const nl2p = (t: string) => esc(t).split(/\n{2,}/).map((para) => `<p>${para.replace(/\n/g, "<br>")}</p>`).join("");

async function resend(from: string, to: string[], subject: string, html: string, replyTo?: string) {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) throw new Error("email_off");
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST", headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to, subject, html, ...(replyTo ? { reply_to: replyTo } : {}) }),
  });
  if (!r.ok) { console.error("resend", r.status, await r.text()); throw new Error("send_failed"); }
  return await r.json().catch(() => ({}));
}

const admin = () => createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

async function loadFull(db: ReturnType<typeof admin>, where: { id?: string; token?: string }) {
  let qb = db.from("proposals").select("*, organizations(name), people!proposals_person_id_fkey(first_name,last_name,email,title)");
  qb = where.id ? qb.eq("id", where.id) : qb.eq("public_token", where.token!);
  const { data: p } = await qb.maybeSingle();
  if (!p) return null;
  const { data: lines } = await db.from("proposal_lines").select("description,detail,qty,unit_minor,sort").eq("proposal_id", p.id).order("sort");
  return { ...p, lines: lines || [] };
}
const publicView = (p: any) => ({
  number: p.number, title: p.title, kind: p.kind, status: p.status, currency: p.currency, total_minor: p.total_minor,
  valid_until: p.valid_until, intro: p.intro, terms: p.terms, sent_at: p.sent_at, decided_at: p.decided_at,
  organization: p.organizations?.name || null,
  recipient: p.people ? { name: [p.people.first_name, p.people.last_name].filter(Boolean).join(" "), title: p.people.title } : null,
  lines: p.lines,
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const db = admin();

  /* ── recipient reads the proposal ── */
  if (req.method === "GET") {
    const t = new URL(req.url).searchParams.get("t") || "";
    if (!/^[0-9a-f]{48}$/.test(t)) return json({ ok: false, error: "not_found" }, 404);
    const p = await loadFull(db, { token: t });
    if (!p || p.status === "draft" || p.status === "withdrawn") return json({ ok: false, error: "not_found" }, 404);
    const now = new Date().toISOString();
    const expired = p.status === "sent" || p.status === "opened" ? (p.valid_until && p.valid_until < now.slice(0, 10)) : false;
    const patch: Record<string, unknown> = { last_opened_at: now, open_count: (p.open_count || 0) + 1 };
    if (!p.opened_at) patch.opened_at = now;
    if (p.status === "sent") patch.status = expired ? "expired" : "opened";
    else if (expired && p.status === "opened") patch.status = "expired";
    await db.from("proposals").update(patch).eq("id", p.id);
    await db.from("proposal_events").insert({ tenant_id: p.tenant_id, proposal_id: p.id, kind: p.opened_at ? "opened" : "opened", detail: p.opened_at ? `Opened again (${(p.open_count || 0) + 1})` : "First open" });
    return json({ ok: true, proposal: publicView({ ...p, ...patch }) });
  }

  if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);
  let b: any; try { b = await req.json(); } catch { return json({ ok: false, error: "bad_json" }, 400); }

  /* ── recipient decides ── */
  if (b.action === "decide") {
    const t = String(b.t || ""); const decision = String(b.decision || "");
    if (!/^[0-9a-f]{48}$/.test(t) || !["accepted", "declined"].includes(decision)) return json({ ok: false, error: "bad_request" }, 400);
    const p = await loadFull(db, { token: t });
    if (!p || !["sent", "opened"].includes(p.status)) return json({ ok: false, error: "closed" }, 409);
    const now = new Date().toISOString(); const note = String(b.note || "").trim().slice(0, 2000) || null;
    await db.from("proposals").update({ status: decision, decided_at: now, decision_note: note }).eq("id", p.id);
    await db.from("proposal_events").insert({ tenant_id: p.tenant_id, proposal_id: p.id, kind: decision, detail: note });
    if (p.opportunity_id) await db.from("opportunities").update({ stage: decision === "accepted" ? "verbal" : "lost", ...(decision === "declined" ? { lost_reason: note || "Proposal declined" } : {}) }).eq("id", p.opportunity_id);
    try {
      const from = Deno.env.get("RESEND_FROM") || "BCA Leadership <info@bcaleadership.com>";
      const who = p.people ? [p.people.first_name, p.people.last_name].filter(Boolean).join(" ") : "The recipient";
      await resend(from, ["admin@bcaleadership.com"], `${decision === "accepted" ? "Accepted" : "Declined"}: ${p.number} ${p.title}`,
        brandEmail(`<p><b>${esc(who)}</b>${p.organizations?.name ? ` of ${esc(p.organizations.name)}` : ""} has <b>${decision}</b> proposal ${esc(p.number)}, <i>${esc(p.title)}</i>, worth ${money(p.total_minor, p.currency)}.</p>${note ? `<blockquote style="margin:14px 0;padding:6px 14px;border-left:3px solid ${BRAND.gold};color:#555;font-size:15px">${nl2p(note)}</blockquote>` : ""}${button("https://bca.coachingengine.app/#proposals", "Open in the console")}`, { preheader: `${p.number} ${decision}` }));
    } catch (e) { console.error("notify_failed", e); }
    return json({ ok: true, status: decision });
  }

  /* ── staff sends ── */
  if (b.action === "send") {
    const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
    if (!token) return json({ ok: false, error: "unauthenticated" }, 401);
    const { data: userRes, error: ue } = await db.auth.getUser(token);
    if (ue || !userRes?.user) return json({ ok: false, error: "unauthenticated" }, 401);
    const p = await loadFull(db, { id: String(b.proposal_id || "") });
    if (!p) return json({ ok: false, error: "not_found" }, 404);
    const { data: member } = await db.from("tenant_users").select("full_name,email,role,status,job_title").eq("tenant_id", p.tenant_id).eq("user_id", userRes.user.id).maybeSingle();
    if (!member || member.status === "suspended" || !["owner", "admin", "coach"].includes(member.role)) return json({ ok: false, error: "forbidden" }, 403);
    const { data: staff } = await db.from("people").select("id").eq("tenant_id", p.tenant_id).eq("user_id", userRes.user.id).maybeSingle();
    if (!p.people?.email) return json({ ok: false, error: "no_recipient" }, 422);
    if (!p.lines.length) return json({ ok: false, error: "no_lines" }, 422);
    if (["accepted", "declined"].includes(p.status)) return json({ ok: false, error: "closed" }, 409);

    const mailbox = "admin@bcaleadership.com";
    const from = `${member.full_name || "BCA Leadership"} · BCA Leadership <${mailbox}>`;
    const link = `${PAGE}?t=${p.public_token}`;
    const first = p.people.first_name || "there";
    const rows = p.lines.map((l: any) => `<tr><td style="padding:8px 0;border-bottom:1px solid #EFE9DC;font-size:15px">${esc(l.description)}${l.detail ? `<br><span style="color:${BRAND.mute};font-size:13px">${esc(l.detail)}</span>` : ""}</td><td align="right" style="padding:8px 0;border-bottom:1px solid #EFE9DC;font-size:15px;white-space:nowrap">${money(Math.round(l.qty * l.unit_minor), p.currency)}</td></tr>`).join("");
    const html = brandEmail(
      `<p>Dear ${esc(first)},</p>
       ${p.intro ? nl2p(p.intro) : `<p>Thank you for the conversation. Please find our proposal below.</p>`}
       <p style="margin:18px 0 4px;font-family:Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:${BRAND.mute}">Proposal ${esc(p.number)}</p>
       <p style="margin:0 0 12px;font-size:20px;color:${BRAND.night}"><b>${esc(p.title)}</b></p>
       <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="font-family:Georgia,serif">${rows}
         <tr><td style="padding:12px 0;font-size:16px"><b>Total</b></td><td align="right" style="padding:12px 0;font-size:18px;color:${BRAND.night}"><b>${money(p.total_minor, p.currency)}</b></td></tr></table>
       ${p.valid_until ? `<p style="color:${BRAND.mute};font-size:14px">Valid until ${day(p.valid_until)}.</p>` : ""}
       ${button(link, "View and respond")}
       <p style="margin-top:22px;margin-bottom:0"><b style="color:${BRAND.night}">${esc(member.full_name || "BCA Leadership")}</b>${member.job_title ? `<br><span style="color:${BRAND.mute};font-size:14px">${esc(member.job_title)}</span>` : ""}<br><span style="color:${BRAND.mute};font-size:14px">BCA Leadership · <a href="mailto:${mailbox}" style="color:${BRAND.gold};text-decoration:none">${mailbox}</a></span></p>`,
      { preheader: `${p.title} · ${money(p.total_minor, p.currency)}`, footnote: `This link is private to you: <a href="${link}" style="color:${BRAND.gold}">${link}</a>` });
    let sent: any;
    try { sent = await resend(from, [p.people.email], `Proposal ${p.number}: ${p.title}`, html, mailbox); }
    catch (e) { return json({ ok: false, error: String((e as Error).message) }, 502); }
    const now = new Date().toISOString();
    const resent = !!p.sent_at;
    await db.from("proposals").update({ status: p.status === "opened" ? "opened" : "sent", sent_at: p.sent_at || now, ...(staff?.id && !p.owner_id ? { owner_id: staff.id } : {}) }).eq("id", p.id);
    await db.from("proposal_events").insert({ tenant_id: p.tenant_id, proposal_id: p.id, kind: resent ? "resent" : "sent", person_id: staff?.id || null, detail: `To ${p.people.email}${sent?.id ? " · Resend " + sent.id : ""}` });
    if (p.opportunity_id) await db.from("opportunities").update({ stage: "proposal" }).eq("id", p.opportunity_id).in("stage", ["qualifying", "briefing"]);
    if (p.person_id) await db.from("activities").insert({ tenant_id: p.tenant_id, kind: "proposal_sent", direction: "out", person_id: p.person_id, actor_id: staff?.id || null, subject: `Proposal ${p.number}: ${p.title}`, body: link }).then(() => {}, (e: unknown) => console.error("activity", e));
    return json({ ok: true, link, resent });
  }
  return json({ ok: false, error: "bad_action" }, 400);
});
