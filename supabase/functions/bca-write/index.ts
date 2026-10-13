// BCA Write — drafts content from a month's theme, in BCA's voice, built for search engines and AI answers.
//   POST {kind:"social", plan_id, platform?, count?}      → { posts:[{body, hashtags, link, media_note}] }
//   POST {kind:"blog",   plan_id, lang, title?, source?}  → { title, excerpt, body }   (source = English draft to translate from)
//   POST {kind:"email",  plan_id}                          → { subject, preheader, body }
// Staff only (JWT, owner/admin). Nothing is saved here: the console puts the draft in the editor and the team saves it.
// Needs ANTHROPIC_API_KEY in Edge Function secrets (and optionally ANTHROPIC_MODEL). Without the key: {error:"no_model_key"}.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, authorization, apikey",
  "Content-Type": "application/json",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: cors });
const admin = () => createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const LANG_NAME: Record<string, string> = { en: "English", fr: "French", es: "Spanish", pt: "European Portuguese" };

const FACTS = `Facts about BCA Leadership (use only these; never invent numbers, names or claims):
- BCA Leadership, Mauritius-registered, Pan-African membership organisation for heads of organisations. Tagline: "Where Africa's leaders sharpen each other." Site: https://bcaleadership.com
- Founded 2017. 5,000+ leaders served. 45 certified coaches and consultants across all five regions of Africa and the diaspora (The Bench: https://bcaleadership.com/the-bench).
- What members get: monthly peer learning rooms (confidential cohorts of CEOs and senior leaders), private executive coaching, a continental network (Needs & Leads), BCAOnline boardroom, and the annual Mindful Leadership Conference (MLC).
- Membership from USD 600 a year (Basic: monthly peer cohort), Executive USD 1,600 (4 private coaching sessions), Platinum USD 2,800 (12 private coaching sessions). Page: https://bcaleadership.com/membership
- Corporate: coaching packages for leadership teams (https://bcaleadership.com/coaching-packages), consulting, project management, business matching.
- Survey of member CEOs: 63% grew revenue by 10% or more.
- CEO: Dr. Modupe Taylor-Pearce. Podcast: Success in Africa. Insights: https://bcaleadership.com/insights
- Contact: info@bcaleadership.com`;

const VOICE = `Voice: a seasoned African operator talking to another one. Warm, direct, specific. Short sentences. No hype, no buzzwords, no exclamation marks, no emojis, no em dashes (use commas, full stops, colons). British spelling. Say it once. Lead with the reader's situation, not with BCA.`;

const SEO = `Search and AI-answer rules (SEO and AEO):
- One clear focus phrase taken from the title; use it in the title, the first paragraph and one heading, naturally.
- Headings as the questions a leader would actually type or ask an assistant; answer each in the first two sentences under it, then the detail.
- Name the entities plainly (BCA Leadership, executive coaching, peer learning, Africa, the country or region) so a machine can tell what the piece is about.
- Concrete over abstract: a number, a place, a situation, a decision.
- End with a short FAQ of three questions and one-paragraph answers, then one call to action with a bcaleadership.com link.`;

async function model(system: string, user: string, maxTokens = 3500): Promise<any> {
  const key = Deno.env.get("ANTHROPIC_API_KEY"); if (!key) throw new Error("no_model_key");
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST", headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: Deno.env.get("ANTHROPIC_MODEL") || "claude-sonnet-4-5", max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error("model_error: " + (j?.error?.message || r.status));
  const text = (j.content || []).map((c: any) => c.text || "").join("");
  const m = text.match(/\{[\s\S]*\}$/) || text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error("model_bad_json");
  return JSON.parse(m[0]);
}

function planBrief(p: any): string {
  return `Month theme: "${p.headline || p.title}" (${p.title}), ${p.period_start} to ${p.period_end}.
Objectives: ${p.objectives || "—"}
Audience: ${p.audience || "—"}
Pillars: ${(p.pillars || []).join("; ") || "—"}
Key dates: ${(p.key_dates || []).map((d: any) => `${d.on || ""} ${d.what || ""}`).join("; ") || "—"}
Notes: ${p.notes || "—"}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "method" }, 405);
  const db = admin();
  let b: any = {}; try { b = await req.json(); } catch { return json({ ok: false, error: "bad_json" }, 400); }
  const token = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ ok: false, error: "unauthenticated" }, 401);
  const { data: userRes, error: ue } = await db.auth.getUser(token);
  if (ue || !userRes?.user) return json({ ok: false, error: "unauthenticated" }, 401);
  const { data: plan } = await db.from("content_plans").select("*").eq("id", String(b.plan_id || "")).maybeSingle();
  if (!plan) return json({ ok: false, error: "no_plan" }, 404);
  const { data: member } = await db.from("tenant_users").select("role,status").eq("tenant_id", plan.tenant_id).eq("user_id", userRes.user.id).maybeSingle();
  if (!member || member.status === "suspended" || !["owner", "admin"].includes(member.role)) return json({ ok: false, error: "forbidden" }, 403);
  if (!Deno.env.get("ANTHROPIC_API_KEY")) return json({ ok: false, error: "no_model_key" }, 412);

  const { data: cfg } = await db.from("tenant_config").select("business_rules").eq("tenant_id", plan.tenant_id).maybeSingle();
  const brand = cfg?.business_rules?.brand || {};
  const hashtags: string[] = brand.hashtags || ["#BCALeadership", "#AfricanLeaders", "#ExecutiveCoaching", "#PeerLearning"];
  const system = `You write for BCA Leadership. ${VOICE}\n\n${FACTS}\n\n${SEO}\n\nAnswer with JSON only, no preamble, no code fence.`;
  const kind = String(b.kind || "");

  try {
    if (kind === "social") {
      const platform = String(b.platform || "linkedin"); const count = Math.min(Math.max(Number(b.count) || 8, 1), 12);
      const limits: Record<string, string> = { linkedin: "under 1,300 characters, the first line must work on its own because LinkedIn truncates", facebook: "under 80 words", instagram: "under 125 words, written to sit under an image", youtube: "a title under 70 characters plus a 2 sentence description", x: "under 280 characters including hashtags" };
      const out = await model(system, `${planBrief(plan)}\n\nWrite ${count} ${platform} posts for this month, two a week in order (Tuesday, Thursday). Each post: one idea, a first line that stops the scroll (a situation, a number or a question), two to four short paragraphs, a call to action that names where to go. ${limits[platform] || ""}. Vary the angle across the month: the leader's problem, a proof point from the facts, what happens in a BCA room, a coach's lesson, the month's blog, the month's event. Do not put hashtags in the body. Return {"posts":[{"body":"...","hashtags":["#..."],"link":"https://bcaleadership.com/...","media_note":"what image or clip goes with it"}]} using three to five hashtags from ${hashtags.join(" ")} plus at most one of your own per post.`, 4000);
      return json({ ok: true, posts: (out.posts || []).slice(0, count) });
    }
    if (kind === "blog") {
      const lang = ["en", "fr", "es", "pt"].includes(b.lang) ? b.lang : "en";
      if (lang !== "en" && b.source?.body) {
        const out = await model(`You translate for BCA Leadership into ${LANG_NAME[lang]}. Keep meaning, structure, headings marked "## ", paragraph breaks and the FAQ; adapt idiom, never word for word. Keep names, numbers and links exactly. Answer with JSON only.`,
          `Translate this blog post to ${LANG_NAME[lang]}. Return {"title":"...","excerpt":"... under 200 characters","body":"..."}.\n\nTITLE: ${b.source.title}\nEXCERPT: ${b.source.excerpt}\nBODY:\n${b.source.body}`, 4500);
        return json({ ok: true, lang, ...out });
      }
      const title = String(b.title || plan.headline || plan.title);
      const out = await model(system, `${planBrief(plan)}\n\nWrite the month's blog post in ${LANG_NAME[lang]} with the working title "${title}" (improve the title if a sharper one keeps the focus phrase). 750 to 950 words. Plain paragraphs separated by one blank line; headings as lines starting "## "; no bullet lists; no bold. Open with a concrete situation an African CEO recognises. Three or four sections with question headings, each answered in its first two sentences. Close with "## Questions leaders ask" holding three Q&As (question as a plain line, answer as a paragraph), then one closing paragraph with a call to action and a bcaleadership.com link. Return {"title":"...","excerpt":"one sentence under 200 characters that makes a leader click","body":"..."}.`, 4500);
      return json({ ok: true, lang, ...out });
    }
    if (kind === "email") {
      const out = await model(system, `${planBrief(plan)}\n\nWrite the month's email letter to ${b.audience || "leads who have not joined BCA"}. Start with "Dear {first}," (keep the token). Four short paragraphs at most, 120 to 170 words: the reader's situation, what BCA does about it with one proof point, what the month offers (the blog, an event or a conversation), and a one-line invitation. No sign-off (the template adds it) and no link in the body (the template adds the button). Return {"subject":"under 55 characters","preheader":"under 90 characters","body":"...","button":"two to four words","link":"https://bcaleadership.com/..."}.`, 1500);
      return json({ ok: true, ...out });
    }
    return json({ ok: false, error: "bad_kind" }, 422);
  } catch (e) {
    const msg = String((e as Error).message || e);
    return json({ ok: false, error: msg.startsWith("no_model_key") ? "no_model_key" : msg.startsWith("model_") ? msg : "failed", detail: msg }, msg.startsWith("no_model_key") ? 412 : 500);
  }
});
