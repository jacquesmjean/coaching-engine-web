// BCA Intake — membership applications + all site enquiries -> prospect + lead + inbound request
// (+ signed contract for applications). On every reach-out: the visitor gets an acknowledgment in
// their language, and the owning mailbox gets an alert. Routing and the response target live in
// tenant_config.business_rules (inbound_routing, inbound_response_hours), not in code.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const TENANT = "6b3d4f12-121f-4f17-9ab9-3be82c74ca03";
const TIERS: Record<string, { product: string; amount: number }> = {
  Basic:     { product: "baef2cdf-3d74-4163-b226-20c127890522", amount: 60000 },
  Platinum:  { product: "8c96ccdf-5f21-4ac1-af85-85c5db37ee31", amount: 280000 },
  Executive: { product: "39e83444-a697-4bec-81e2-e3969792fd5a", amount: 160000 },
};
const DEFAULT_ROUTING: Record<string, string> = {
  membership_application: "admin@bcaleadership.com", consultation: "admin@bcaleadership.com",
  coach_booking: "admin@bcaleadership.com", corporate_proposal: "admin@bcaleadership.com",
  sponsorship: "admin@bcaleadership.com", consulting: "admin@bcaleadership.com",
  project_management: "admin@bcaleadership.com", business_matching: "admin@bcaleadership.com",
  bench_application: "admin@bcaleadership.com",
  concierge: "info@bcaleadership.com", general: "info@bcaleadership.com",
  newsletter: "info@bcaleadership.com", podcast: "info@bcaleadership.com",
};
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, authorization, apikey",
  "Content-Type": "application/json",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: cors });
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
function splitName(full: string): [string, string] {
  const parts = (full || "").trim().split(/\s+/);
  const first = parts.shift() || "Member";
  return [first, parts.join(" ") || ""];
}
function kindOf(p: any, isJoin: boolean): string {
  if (isJoin) return "membership_application";
  const t = String(p.topic || "").toLowerCase();
  if (t.startsWith("consultation")) return "consultation";
  if (t.startsWith("coach booking")) return "coach_booking";
  if (t.startsWith("corporate")) return "corporate_proposal";
  if (t.startsWith("sponsor")) return "sponsorship";
  if (t.startsWith("concierge")) return "concierge";
  if (t.startsWith("newsletter")) return "newsletter";
  if (t.startsWith("podcast")) return "podcast";
  if (t.startsWith("consulting")) return "consulting";
  if (t.startsWith("project management")) return "project_management";
  if (t.startsWith("business matching")) return "business_matching";
  if (t.startsWith("bench") || t.startsWith("join the bench")) return "bench_application";
  return "general";
}

/* ── Acknowledgment to the visitor, in their language ── */
const ACK: Record<string, { subject: string; body: (n: string, h: number, join: boolean) => string }> = {
  en: { subject: "We have your message — BCA Leadership",
    body: (n, h, join) => `<p>Hello ${n},</p><p>${join ? "Thank you for applying to BCA. Your application has reached us." : "Thank you for reaching out to BCA Leadership. Your message has reached us."} A member of our team will reply within ${h} hours.</p><p>If it is urgent, reply to this email and it will find the right person.</p><p>Warm regards,<br>The BCA Leadership team<br>Grand Baie, Mauritius</p>` },
  fr: { subject: "Nous avons bien reçu votre message — BCA Leadership",
    body: (n, h, join) => `<p>Bonjour ${n},</p><p>${join ? "Merci pour votre candidature à BCA. Elle nous est bien parvenue." : "Merci d'avoir contacté BCA Leadership. Votre message nous est bien parvenu."} Un membre de notre équipe vous répondra sous ${h} heures.</p><p>En cas d'urgence, répondez simplement à cet email.</p><p>Cordialement,<br>L'équipe BCA Leadership<br>Grand Baie, Maurice</p>` },
  es: { subject: "Hemos recibido su mensaje — BCA Leadership",
    body: (n, h, join) => `<p>Hola ${n},</p><p>${join ? "Gracias por su solicitud a BCA. La hemos recibido." : "Gracias por contactar a BCA Leadership. Hemos recibido su mensaje."} Un miembro de nuestro equipo le responderá en un plazo de ${h} horas.</p><p>Si es urgente, responda a este correo.</p><p>Un cordial saludo,<br>El equipo de BCA Leadership<br>Grand Baie, Mauricio</p>` },
  pt: { subject: "Recebemos a sua mensagem — BCA Leadership",
    body: (n, h, join) => `<p>Olá ${n},</p><p>${join ? "Obrigado pela sua candidatura à BCA. Já a recebemos." : "Obrigado por contactar a BCA Leadership. A sua mensagem chegou até nós."} Um membro da nossa equipa responderá no prazo de ${h} horas.</p><p>Se for urgente, responda a este email.</p><p>Com os melhores cumprimentos,<br>A equipa BCA Leadership<br>Grand Baie, Maurícia</p>` },
};

async function send(from: string, to: string[], subject: string, html: string, replyTo?: string) {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) return false;
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to, subject, html, ...(replyTo ? { reply_to: replyTo } : {}) }),
    });
    return r.ok;
  } catch (_) { return false; }
}
/*BRAND*/
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

const wrap = (inner: string) => `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.55;color:#242424;max-width:600px">${inner}</div>`;
const mailboxName = (mb: string) => `BCA Leadership <${mb}>`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);
  let p: any; try { p = await req.json(); } catch { return json({ ok: false, error: "bad_json" }, 400); }
  const email = (p.email || "").trim().toLowerCase();
  const fullName = (p.full_name || p.name || "").trim();
  if (!fullName || email.indexOf("@") < 1) return json({ ok: false, error: "missing_fields" }, 422);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || null;
  const agent = req.headers.get("user-agent") || null;
  const isJoin = !!p.tier && !!TIERS[p.tier];
  const kind = kindOf(p, isJoin);
  const lang = ["en", "fr", "es", "pt"].includes(String(p.lang || "").slice(0, 2)) ? String(p.lang).slice(0, 2) : "en";

  try {
    const { data: cfg } = await supabase.from("tenant_config").select("business_rules").eq("tenant_id", TENANT).maybeSingle();
    const rules = (cfg?.business_rules || {}) as any;
    const routing = { ...DEFAULT_ROUTING, ...(rules.inbound_routing || {}) };
    const owner = routing[kind] || routing.general;
    const hours = Number(rules.inbound_response_hours || 24);

    let personId: string | null = null;
    const { data: existing } = await supabase.from("people").select("id").eq("tenant_id", TENANT).eq("email", email).maybeSingle();
    if (existing?.id) personId = existing.id;
    else {
      const [first, last] = splitName(fullName);
      const { data: person, error: pe } = await supabase.from("people").insert({
        id: crypto.randomUUID(), tenant_id: TENANT, first_name: first, last_name: last, email,
        country: p.country || null, status: "prospect", preferred_language: lang, timezone: "UTC",
      }).select("id").single();
      if (pe) throw pe;
      personId = person.id;
    }
    const interest = isJoin
      ? `Membership application: ${p.tier}`
      : `${p.topic || "Website enquiry"}${p.message ? " — " + String(p.message).slice(0, 400) : ""}`;
    const { data: lead } = await supabase.from("leads").insert({
      id: crypto.randomUUID(), tenant_id: TENANT, full_name: fullName, email,
      organization: p.company || null, country: p.country || null, source: "website",
      status: "new", score: isJoin ? 70 : 50, interest, language: lang, person_id: personId,
    }).select("id").single();

    let ref: string | null = null;
    if (isJoin) {
      const t = TIERS[p.tier];
      const num = "BCA-APP-" + Date.now().toString(36).toUpperCase() + "-" + Math.floor(Math.random() * 1e4).toString().padStart(4, "0");
      const signed = p.agreed === true;
      const { error: ce } = await supabase.from("contracts").insert({
        id: crypto.randomUUID(), tenant_id: TENANT, number: num, product_id: t.product, person_id: personId,
        amount_minor: t.amount, currency: "USD", billing: "annual", status: signed ? "signed" : "generated",
        legal_name: fullName, company: p.company || null, country: p.country || null, language: lang,
        generated_at: new Date().toISOString(), signed_at: signed ? new Date().toISOString() : null,
        signature_name: signed ? fullName : null, signature_ip: ip, signature_agent: agent,
      });
      if (ce) throw ce;
      ref = num;
    }

    const summary = isJoin ? `Membership application: ${p.tier}${ref ? " (" + ref + ")" : ""}` : (p.message ? String(p.message).slice(0, 4000) : interest);
    const topic = isJoin ? `Membership: ${p.tier}` : (p.topic || "Website enquiry");
    const { data: reqRow, error: re } = await supabase.from("requests").insert({
      tenant_id: TENANT, kind, full_name: fullName, work_email: email,
      organization: p.company || null, country: p.country || null,
      summary, topic, page_url: p.page || null, status: "new", source: "website", language: lang,
      person_id: personId, owner_mailbox: owner, received_at: new Date().toISOString(),
    }).select("id").single();
    if (re) console.error("request_insert_error", re);
    const requestId = reqRow?.id || null;

    // 1. Acknowledge the visitor, from the mailbox that will answer them.
    const [first] = splitName(fullName);
    const ack = ACK[lang] || ACK.en;
    const acked = await send(mailboxName(owner), [email], ack.subject, brandEmail(ack.body(esc(first), hours, isJoin), { preheader: ack.subject, footnote: "You are receiving this because you contacted BCA Leadership through bcaleadership.com." }), owner);
    if (acked && requestId) {
      await supabase.from("requests").update({ acknowledged_at: new Date().toISOString() }).eq("id", requestId);
      await supabase.from("activities").insert({
        tenant_id: TENANT, kind: "email_sent", direction: "out", person_id: personId, lead_id: lead?.id || null,
        request_id: requestId, subject: ack.subject, body: `Automatic acknowledgment (${lang}), ${hours}h target stated.`,
      });
    }

    // 2. Alert the owner mailbox.
    const subject = isJoin ? `New membership application: ${p.tier} — ${fullName}` : `New ${kind.replace(/_/g, " ")} — ${fullName}`;
    const rows = [
      ["Name", fullName], ["Email", email], ["Company", p.company || "—"], ["Country", p.country || "—"],
      ["Tier", p.tier || "—"], ["Topic", topic], ["Message", p.message || "—"], ["Reference", ref || "—"], ["Page", p.page || "—"],
    ].map(([k, v]) => `<tr><td style="padding:4px 12px 4px 0;color:#666;vertical-align:top">${esc(k)}</td><td style="padding:4px 0"><b>${esc(v)}</b></td></tr>`).join("");
    const console_ = "https://bca.coachingengine.app/";
    await send(Deno.env.get("RESEND_FROM") || mailboxName(owner), (Deno.env.get("RESEND_TO") || owner).split(",").map((x) => x.trim()).filter(Boolean),
      subject, brandEmail(`<p>A new reach-out just came in from the BCA website. It is yours to answer within ${hours} hours.</p><table>${rows}</table><p style="margin-top:14px"><a href="${console_}" style="color:#24170C"><b>Open Inbound requests to reply</b></a> — the visitor has already received an acknowledgment${acked ? "" : " (email sending is off)"}.</p>`, { preheader: subject }), email);

    return json({ ok: true, kind: isJoin ? "membership" : "enquiry", ref });
  } catch (e) {
    console.error("intake_error", e);
    return json({ ok: false, error: "server" }, 500);
  }
});
