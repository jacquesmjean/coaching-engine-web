// BCA Nudge — runs every weekday morning (pg_cron). One digest per owner mailbox listing every
// inbound request still waiting past the response target. Called with the shared key held in
// platform_secrets, which only the service role can read.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: secret } = await admin.from("platform_secrets").select("value").eq("name", "nudge_key").maybeSingle();
  if (!secret || req.headers.get("x-nudge-key") !== secret.value) return json({ ok: false, error: "forbidden" }, 403);
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) return json({ ok: false, error: "email_off" }, 503);

  const { data: tenants } = await admin.from("tenant_config").select("tenant_id,business_rules");
  let sent = 0;
  for (const t of tenants || []) {
    const hours = Number((t.business_rules as any)?.inbound_response_hours || 24);
    const cutoff = new Date(Date.now() - hours * 36e5).toISOString();
    const { data: late } = await admin.from("requests")
      .select("id,full_name,organization,topic,kind,owner_mailbox,owner_id,received_at")
      .eq("tenant_id", t.tenant_id).is("first_response_at", null)
      .not("status", "in", "(declined,dormant,won)")
      .lt("received_at", cutoff).order("received_at", { ascending: true });
    if (!late?.length) continue;

    // Named owners get their own copy.
    const ownerIds = [...new Set(late.map((r) => r.owner_id).filter(Boolean))] as string[];
    const { data: owners } = ownerIds.length
      ? await admin.from("tenant_users").select("user_id,email,full_name").eq("tenant_id", t.tenant_id).in("user_id", ownerIds)
      : { data: [] as any[] };
    const ownerEmail = new Map((owners || []).map((o: any) => [o.user_id, o.email]));

    const groups = new Map<string, any[]>();
    for (const r of late) {
      const mb = r.owner_mailbox || "info@bcaleadership.com";
      groups.set(mb, [...(groups.get(mb) || []), r]);
    }
    for (const [mailbox, rows] of groups) {
      const to = new Set<string>([mailbox]);
      rows.forEach((r) => { const e = ownerEmail.get(r.owner_id); if (e) to.add(String(e)); });
      const list = rows.map((r) => {
        const waited = (Date.now() - new Date(r.received_at).getTime()) / 36e5;
        const w = waited < 48 ? `${Math.round(waited)} h` : `${(waited / 24).toFixed(1)} days`;
        return `<tr><td style="padding:6px 12px 6px 0"><b>${esc(r.full_name)}</b>${r.organization ? ` · ${esc(r.organization)}` : ""}</td><td style="padding:6px 12px 6px 0;color:#555">${esc(r.topic || r.kind)}</td><td style="padding:6px 0;color:#C06A4E;white-space:nowrap">waiting ${w}</td></tr>`;
      }).join("");
      const html = `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#242424;max-width:640px"><p>${rows.length === 1 ? "One enquiry is" : rows.length + " enquiries are"} past BCA's ${hours}-hour reply target and still waiting on <b>${esc(mailbox)}</b>.</p><table>${list}</table><p style="margin-top:14px"><a href="https://bca.coachingengine.app/" style="color:#0B1426"><b>Open Inbound requests</b></a> to reply from the console. Each reply stops the clock.</p></div>`;
      try {
        const r = await fetch("https://api.resend.com/emails", {
          method: "POST", headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify({ from: `BCA Leadership <${mailbox}>`, to: [...to], subject: `${rows.length} inbound ${rows.length === 1 ? "request" : "requests"} past the ${hours}h target`, html }),
        });
        if (r.ok) { sent++; await admin.from("requests").update({ last_nudged_at: new Date().toISOString() }).in("id", rows.map((x) => x.id)); }
      } catch (e) { console.error("nudge_send_error", e); }
    }
  }
  return json({ ok: true, digests_sent: sent });
});
