// BCA Board — notices to the directors from the Board Room.
//   POST {action:"notice",     meeting_id}     meeting notice: date, place, agenda, board pack links, calendar file; creates RSVP rows
//   POST {action:"remind",     meeting_id}     48-hour reminder to those who have not declined
//   POST {action:"minutes",    meeting_id}     draft minutes circulated for approval at the next meeting
//   POST {action:"resolution", resolution_id}  electronic resolution open for vote, with the motion and the closing time
//   POST {action:"actions",    meeting_id?}    open actions, each director gets their own list
// Caller must be signed in and be an owner/admin of the tenant or an officer of the board (chair, vice-chair, secretary).
// Deploy with Verify JWT OFF. Needs RESEND_API_KEY. Board pack links are signed for 14 days.
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
const ROLE: Record<string, string> = { chair: "Board Chair", vice_chair: "Board Vice-Chair", director: "Director", ceo: "Chief Executive", secretary: "Company Secretary", observer: "Observer" };

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
  <tr><td style="padding:24px 34px 8px;border-bottom:1px solid #EFE9DC"><img src="${BRAND.logo}" alt="BCA Leadership" width="118" style="width:118px;height:auto;display:block;border:0"><div style="font-family:Helvetica,Arial,sans-serif;font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:${BRAND.mute};margin-top:10px">Board of Directors</div></td></tr>
  <tr><td style="padding:28px 34px 12px;font-family:Georgia,'Times New Roman',serif;font-size:17px;line-height:1.65;color:${BRAND.ink}">${inner}</td></tr>
  ${opts.footnote ? `<tr><td style="padding:0 34px 24px;font-family:Helvetica,Arial,sans-serif;font-size:12.5px;line-height:1.5;color:${BRAND.mute}">${opts.footnote}</td></tr>` : ""}
  <tr><td style="background:${BRAND.night};padding:20px 34px;font-family:Helvetica,Arial,sans-serif;font-size:11.5px;line-height:1.7;color:rgba(250,246,238,.72)">
    <span style="color:${BRAND.gold};letter-spacing:.22em;font-size:10.5px;text-transform:uppercase">BCA Leadership</span><br>${BRAND.address}<br>
    <a href="${BRAND.site}" style="color:${BRAND.gold};text-decoration:none">bcaleadership.com</a></td></tr>
</table></td></tr></table></body></html>`;
}
const button = (href: string, label: string) => `<a href="${href}" style="display:inline-block;background:${BRAND.gold};color:${BRAND.night};font-family:Helvetica,Arial,sans-serif;font-weight:700;font-size:13px;letter-spacing:.06em;text-transform:uppercase;padding:13px 20px;text-decoration:none;margin:6px 0">${label}</a>`;
const whenLong = (iso: string) => new Date(iso).toLocaleString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC", hour12: false }) + " GMT";

async function send(to: string[], subject: string, html: string, attachments?: { filename: string; content: string }[]) {
  const key = Deno.env.get("RESEND_API_KEY"); if (!key) return false;
  try {
    const r = await fetch("https://api.resend.com/emails", { method: "POST", headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: Deno.env.get("RESEND_FROM") || "BCA Leadership <info@bcaleadership.com>", to, subject, html, ...(attachments?.length ? { attachments } : {}) }) });
    return r.ok;
  } catch (_) { return false; }
}
const icsDate = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
function ics(m: any): string {
  const end = m.ends_at || new Date(new Date(m.starts_at).getTime() + 2 * 3600e3).toISOString();
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//BCA Leadership//Board Room//EN", "METHOD:PUBLISH", "BEGIN:VEVENT", `UID:${m.id}@bca.coachingengine.app`, `DTSTAMP:${icsDate(new Date().toISOString())}`,
    `DTSTART:${icsDate(m.starts_at)}`, `DTEND:${icsDate(end)}`, `SUMMARY:${String(m.title).replace(/[,;]/g, " ")}`, `LOCATION:${String(m.location || m.video_url || "").replace(/[,;]/g, " ")}`, `DESCRIPTION:BCA Leadership board meeting. Agenda and papers in the Board Room: ${ENGINE}/`, "END:VEVENT", "END:VCALENDAR"].join("\r\n");
}
const b64 = (s: string) => btoa(unescape(encodeURIComponent(s)));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);
  const db = admin();
  let b: any = {}; try { b = await req.json(); } catch { return json({ ok: false, error: "bad_json" }, 400); }
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ ok: false, error: "unauthenticated" }, 401);
  const { data: userRes, error: ue } = await db.auth.getUser(token);
  if (ue || !userRes?.user) return json({ ok: false, error: "unauthenticated" }, 401);
  const uid = userRes.user.id;

  // the thing being sent
  const action = String(b.action || "");
  let meeting: any = null, resolution: any = null;
  if (action === "resolution") { const { data } = await db.from("board_resolutions").select("*").eq("id", String(b.resolution_id || "")).maybeSingle(); resolution = data; if (!resolution) return json({ ok: false, error: "not_found" }, 404); if (resolution.meeting_id) { const { data: m } = await db.from("board_meetings").select("*").eq("id", resolution.meeting_id).maybeSingle(); meeting = m; } }
  else if (b.meeting_id) { const { data } = await db.from("board_meetings").select("*").eq("id", String(b.meeting_id)).maybeSingle(); meeting = data; if (!meeting) return json({ ok: false, error: "not_found" }, 404); }
  const tenant = meeting?.tenant_id || resolution?.tenant_id;
  if (!tenant && action !== "actions") return json({ ok: false, error: "bad_request" }, 422);

  // permission: owner/admin, or an officer of the board
  const { data: tu } = await db.from("tenant_users").select("full_name,email,role,status,tenant_id").eq("user_id", uid).maybeSingle();
  const tenantId = tenant || tu?.tenant_id;
  const { data: myPerson } = await db.from("people").select("id").eq("tenant_id", tenantId).eq("user_id", uid).maybeSingle();
  const { data: officer } = myPerson ? await db.from("board_members").select("id,full_name,role").eq("tenant_id", tenantId).eq("person_id", myPerson.id).eq("status", "active").maybeSingle() : { data: null };
  const isAdmin = !!tu && tu.status !== "suspended" && ["owner", "admin"].includes(tu.role) && tu.tenant_id === tenantId;
  const isOfficer = !!officer && ["chair", "vice_chair", "secretary"].includes(officer.role);
  if (!isAdmin && !isOfficer) return json({ ok: false, error: "forbidden" }, 403);
  const signer = officer ? `${officer.full_name}, ${ROLE[officer.role] || officer.role}` : (tu?.full_name || "The BCA team");

  const { data: members } = await db.from("board_members").select("id,full_name,email,role").eq("tenant_id", tenantId).eq("status", "active").order("sort");
  const withEmail = (members || []).filter((m: any) => m.email && /@/.test(m.email));
  const room = `${ENGINE}/`;
  const fmtMembers = (ids: string[]) => (members || []).filter((m: any) => ids.includes(m.id)).map((m: any) => m.full_name).join(", ");

  const results: Record<string, boolean> = {};
  if (action === "notice" || action === "remind") {
    const { data: agenda } = await db.from("board_agenda_items").select("*").eq("meeting_id", meeting.id).order("sort");
    // board pack: signed links to the vault documents
    let pack: { title: string; url: string }[] = [];
    if ((meeting.pack_document_ids || []).length) {
      const { data: docs } = await db.from("documents").select("id,title,file_name,storage_path").in("id", meeting.pack_document_ids);
      for (const d of docs || []) { const { data: s } = await db.storage.from("vault").createSignedUrl(d.storage_path, 14 * 86400); if (s?.signedUrl) pack.push({ title: d.title || d.file_name, url: s.signedUrl }); }
    }
    // RSVP rows for everyone
    for (const m of members || []) await db.from("board_attendance").upsert({ tenant_id: tenantId, meeting_id: meeting.id, member_id: m.id }, { onConflict: "meeting_id,member_id", ignoreDuplicates: true });
    const { data: att } = await db.from("board_attendance").select("member_id,rsvp").eq("meeting_id", meeting.id);
    const declined = new Set((att || []).filter((a: any) => a.rsvp === "no").map((a: any) => a.member_id));
    const agendaHtml = (agenda || []).length ? `<ol style="padding-left:20px;margin:0 0 14px">${(agenda || []).map((a: any) => `<li style="margin-bottom:6px"><b>${esc(a.title)}</b> <span style="color:${BRAND.mute};font-size:14px">· ${esc(a.kind)}${a.presenter_id ? " · " + esc(fmtMembers([a.presenter_id])) : ""}${a.minutes_planned ? " · " + a.minutes_planned + " min" : ""}</span>${a.notes ? `<br><span style="font-size:15px">${esc(a.notes)}</span>` : ""}</li>`).join("")}</ol>` : `<p style="color:${BRAND.mute}">The agenda will follow.</p>`;
    const packHtml = pack.length ? `<p><b>Board pack</b></p><ul style="padding-left:20px;margin:0 0 14px">${pack.map((p) => `<li><a href="${p.url}" style="color:${BRAND.green}">${esc(p.title)}</a></li>`).join("")}</ul><p style="font-size:13px;color:${BRAND.mute}">Links work for 14 days and are for directors only.</p>` : "";
    const where = [meeting.location, meeting.video_url ? `<a href="${esc(meeting.video_url)}" style="color:${BRAND.green}">${esc(meeting.video_url)}</a>` : ""].filter(Boolean).join(" · ");
    const isNotice = action === "notice";
    const subject = isNotice ? `Notice of meeting: ${meeting.title}, ${new Date(meeting.starts_at).toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" })}` : `Reminder: ${meeting.title} is ${new Date(meeting.starts_at).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })}`;
    for (const m of withEmail) {
      if (!isNotice && declined.has(m.id)) continue;
      const first = m.full_name.replace(/^(Dr|Mr|Mrs|Ms)\.?\s+/i, "").split(/\s+/)[0];
      const html = brandEmail(`<p>Dear ${esc(first)},</p>
        <p>${isNotice ? `Notice is given of the following meeting of the Board of BCA Leadership.` : `A reminder of the meeting below. Your papers are in the Board Room.`}</p>
        <table style="font-size:15.5px;margin:0 0 14px"><tr><td style="padding:3px 14px 3px 0;color:${BRAND.mute}">Meeting</td><td><b>${esc(meeting.title)}</b></td></tr><tr><td style="padding:3px 14px 3px 0;color:${BRAND.mute}">When</td><td>${esc(whenLong(meeting.starts_at))}${meeting.ends_at ? " to " + esc(new Date(meeting.ends_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" })) + " GMT" : ""}</td></tr>${where ? `<tr><td style="padding:3px 14px 3px 0;color:${BRAND.mute}">Where</td><td>${where}</td></tr>` : ""}</table>
        <p><b>Agenda</b></p>${agendaHtml}${packHtml}
        <p>Please confirm your attendance in the Board Room, where the agenda, papers and any resolutions open for vote are kept.</p>
        <p>${button(room, isNotice ? "Confirm attendance" : "Open the Board Room")}</p>
        <p>${esc(signer)}</p>`, { preheader: `${meeting.title}, ${whenLong(meeting.starts_at)}`, footnote: "You are receiving this as a director of BCA Leadership. Sent from the BCA Coaching Engine." });
      results[m.email] = await send([m.email], subject, html, isNotice ? [{ filename: "bca-board-meeting.ics", content: b64(ics(meeting)) }] : undefined);
    }
    await db.from("board_meetings").update(isNotice ? { status: meeting.status === "planned" ? "notice_sent" : meeting.status, notice_sent_at: new Date().toISOString() } : { reminder_sent_at: new Date().toISOString() }).eq("id", meeting.id);
  }
  else if (action === "minutes") {
    if (!meeting.minutes) return json({ ok: false, error: "no_minutes" }, 422);
    const paras = String(meeting.minutes).split(/\n{2,}/).map((p) => p.startsWith("## ") ? `<h3 style="font-weight:400;margin:16px 0 6px">${esc(p.slice(3))}</h3>` : `<p style="margin:0 0 10px">${esc(p).replace(/\n/g, "<br>")}</p>`).join("");
    const { data: res } = await db.from("board_resolutions").select("number,title,status").eq("meeting_id", meeting.id).order("created_at");
    const { data: acts } = await db.from("board_actions").select("title,owner_id,due_on").eq("meeting_id", meeting.id).order("due_on");
    const resHtml = (res || []).length ? `<p><b>Resolutions</b></p><ul style="padding-left:20px">${(res || []).map((r: any) => `<li>${r.number ? esc(r.number) + " · " : ""}${esc(r.title)} <span style="color:${BRAND.mute}">(${esc(r.status)})</span></li>`).join("")}</ul>` : "";
    const actHtml = (acts || []).length ? `<p><b>Actions</b></p><ul style="padding-left:20px">${(acts || []).map((a: any) => `<li>${esc(a.title)}${a.owner_id ? " · " + esc(fmtMembers([a.owner_id])) : ""}${a.due_on ? " · by " + esc(a.due_on) : ""}</li>`).join("")}</ul>` : "";
    const subject = `Draft minutes for approval: ${meeting.title}`;
    for (const m of withEmail) {
      const first = m.full_name.replace(/^(Dr|Mr|Mrs|Ms)\.?\s+/i, "").split(/\s+/)[0];
      results[m.email] = await send([m.email], subject, brandEmail(`<p>Dear ${esc(first)},</p><p>The draft minutes of <b>${esc(meeting.title)}</b> (${esc(whenLong(meeting.starts_at))}) are below for your review. Corrections to the Chair or Secretary before the next meeting, where they will be put for approval.</p><div style="background:${BRAND.cream};border:1px solid #E9E2D4;padding:16px 20px;margin:14px 0;font-size:15.5px">${paras}${resHtml}${actHtml}</div><p>${button(room, "Open the Board Room")}</p><p>${esc(signer)}</p>`, { preheader: "Draft minutes for your review", footnote: "Draft until approved by the Board. Sent from the BCA Coaching Engine." }));
    }
    await db.from("board_meetings").update({ minutes_status: "circulated", minutes_circulated_at: new Date().toISOString() }).eq("id", meeting.id);
  }
  else if (action === "resolution") {
    if (resolution.status !== "open") return json({ ok: false, error: "not_open" }, 422);
    const subject = `Resolution for your vote: ${resolution.title}`;
    for (const m of withEmail) {
      const first = m.full_name.replace(/^(Dr|Mr|Mrs|Ms)\.?\s+/i, "").split(/\s+/)[0];
      results[m.email] = await send([m.email], subject, brandEmail(`<p>Dear ${esc(first)},</p><p>A written resolution of the Board is open for your vote${resolution.closes_at ? ` until <b>${esc(whenLong(resolution.closes_at))}</b>` : ""}.</p><div style="background:${BRAND.cream};border:1px solid #E9E2D4;padding:16px 20px;margin:14px 0;font-size:15.5px"><p style="margin:0 0 8px"><b>${resolution.number ? esc(resolution.number) + " · " : ""}${esc(resolution.title)}</b></p>${String(resolution.text || "").split(/\n{2,}/).map((p) => `<p style="margin:0 0 10px">${esc(p)}</p>`).join("")}${resolution.moved_by ? `<p style="font-size:14px;color:${BRAND.mute};margin:0">Moved by ${esc(fmtMembers([resolution.moved_by]))}${resolution.seconded_by ? ", seconded by " + esc(fmtMembers([resolution.seconded_by])) : ""}. Passes by ${esc(String(resolution.threshold).replace("_", " "))}.</p>` : ""}</div><p>Cast your vote in the Board Room: For, Against or Abstain. Your vote is recorded with the time.</p><p>${button(room, "Vote now")}</p><p>${esc(signer)}</p>`, { preheader: resolution.title, footnote: "Sent to all directors of BCA Leadership from the BCA Coaching Engine." }));
    }
  }
  else if (action === "actions") {
    let q = db.from("board_actions").select("id,title,owner_id,due_on,meeting_id").eq("tenant_id", tenantId).eq("status", "open").order("due_on");
    if (b.meeting_id) q = q.eq("meeting_id", b.meeting_id);
    const { data: acts } = await q;
    for (const m of withEmail) {
      const mine = (acts || []).filter((a: any) => a.owner_id === m.id); if (!mine.length) continue;
      const first = m.full_name.replace(/^(Dr|Mr|Mrs|Ms)\.?\s+/i, "").split(/\s+/)[0];
      results[m.email] = await send([m.email], `Your open board actions (${mine.length})`, brandEmail(`<p>Dear ${esc(first)},</p><p>These actions from the Board are with you:</p><ul style="padding-left:20px">${mine.map((a: any) => `<li style="margin-bottom:6px"><b>${esc(a.title)}</b>${a.due_on ? ` <span style="color:${BRAND.mute}">· due ${esc(a.due_on)}</span>` : ""}</li>`).join("")}</ul><p>Mark them done in the Board Room when they are.</p><p>${button(room, "Open the Board Room")}</p><p>${esc(signer)}</p>`, { preheader: `${mine.length} open action${mine.length === 1 ? "" : "s"}` }));
    }
  }
  else return json({ ok: false, error: "bad_action" }, 422);

  const sent = Object.values(results).filter(Boolean).length;
  return json({ ok: true, sent, total: withEmail.length, skipped: (members || []).length - withEmail.length, email_off: !Deno.env.get("RESEND_API_KEY") });
});
