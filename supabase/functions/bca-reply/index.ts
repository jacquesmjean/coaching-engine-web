// BCA Reply — a signed-in BCA team member answers an inbound request from the console.
// Sends as the request's owner mailbox (info@ / admin@ / support@) with the visitor's message
// quoted, stamps first_response_at, logs the activity, and assigns the request to the sender
// if nobody has it yet. The caller's JWT is verified by the platform; we additionally check
// they belong to the request's tenant.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, authorization, apikey",
  "Content-Type": "application/json",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: cors });
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);
  const auth = req.headers.get("authorization") || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  if (!token) return json({ ok: false, error: "unauthenticated" }, 401);

  let p: any; try { p = await req.json(); } catch { return json({ ok: false, error: "bad_json" }, 400); }
  const requestId = String(p.request_id || "");
  const subject = String(p.subject || "").trim().slice(0, 200);
  const body = String(p.body || "").trim().slice(0, 8000);
  if (!requestId || !subject || !body) return json({ ok: false, error: "missing_fields" }, 422);

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: userRes, error: ue } = await admin.auth.getUser(token);
  if (ue || !userRes?.user) return json({ ok: false, error: "unauthenticated" }, 401);
  const userId = userRes.user.id;

  const { data: r } = await admin.from("requests").select("*").eq("id", requestId).maybeSingle();
  if (!r) return json({ ok: false, error: "not_found" }, 404);
  const { data: member } = await admin.from("tenant_users").select("full_name,email,role,status,job_title")
    .eq("tenant_id", r.tenant_id).eq("user_id", userId).maybeSingle();
  const { data: staff } = await admin.from("people").select("id").eq("tenant_id", r.tenant_id).eq("user_id", userId).maybeSingle();
  const staffId: string | null = staff?.id || null;
  if (!member || member.status === "suspended" || !["owner", "admin", "coach"].includes(member.role)) {
    return json({ ok: false, error: "forbidden" }, 403);
  }

  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) return json({ ok: false, error: "email_off" }, 503);
  const mailbox = r.owner_mailbox || "info@bcaleadership.com";
  const from = `${member.full_name || "BCA Leadership"} · BCA Leadership <${mailbox}>`;
  const quoted = r.summary
    ? `<hr style="border:0;border-top:1px solid #ddd;margin:22px 0 12px"><p style="color:#777;font-size:12.5px;margin:0 0 6px">On ${new Date(r.received_at).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" })} UTC, ${esc(r.full_name)} wrote via bcaleadership.com${r.topic ? ` (${esc(r.topic)})` : ""}:</p><blockquote style="margin:0;padding:6px 14px;border-left:3px solid #F7A61C;color:#555;font-size:13.5px;white-space:pre-wrap">${esc(r.summary)}</blockquote>`
    : "";
  const html = brandEmail(`${nl2p(body)}<p style="margin-top:22px;margin-bottom:0"><b style="color:#24170C">${esc(member.full_name || "BCA Leadership")}</b>${member.job_title ? `<br><span style="color:#6F665E;font-size:14px">${esc(member.job_title)}</span>` : ""}<br><span style="color:#6F665E;font-size:14px">BCA Leadership · <a href="mailto:${esc(mailbox)}" style="color:#F7A61C;text-decoration:none">${esc(mailbox)}</a></span></p>${quoted}`, { preheader: subject });

  let sendRes: Response;
  try {
    sendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: [r.work_email], reply_to: mailbox, subject, html }),
    });
  } catch (e) { console.error("resend_error", e); return json({ ok: false, error: "send_failed" }, 502); }
  if (!sendRes.ok) { console.error("resend_status", sendRes.status, await sendRes.text()); return json({ ok: false, error: "send_failed" }, 502); }
  const sent = await sendRes.json().catch(() => ({}));

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = { updated_at: now };
  if (!r.first_response_at) { patch.first_response_at = now; patch.answered_by = userId; }
  if (r.status === "new") patch.status = "answered";
  if (!r.owner_id && staffId) patch.owner_id = staffId;
  const { error: upErr } = await admin.from("requests").update(patch).eq("id", requestId);
  if (upErr) console.error("request_update_error", upErr);
  const { error: actErr } = await admin.from("activities").insert({
    tenant_id: r.tenant_id, kind: "email_sent", direction: "out", person_id: r.person_id || null,
    request_id: requestId, actor_id: staffId, subject, body: `${body}\n\n[sent as ${mailbox}${sent?.id ? ", Resend " + sent.id : ""}]`,
  });
  if (actErr) console.error("activity_insert_error", actErr);
  return json({ ok: true, first_response: !r.first_response_at, mailbox, logged: !actErr, updated: !upErr, err: upErr?.message || actErr?.message || null });
});
