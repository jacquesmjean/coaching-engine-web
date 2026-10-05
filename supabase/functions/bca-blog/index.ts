// BCA Blog — publishes a blog post from the engine to bcaleadership.com.
//   POST {action:"preview", post_id}   staff (JWT): returns the rendered page HTML (for the console's preview tab)
//   POST {action:"publish", post_id}   staff (JWT, owner/admin): writes insight-<slug>.html, assets/insights.json,
//                                      the cover image and sitemap.xml into the site repo through the GitHub API.
//                                      Vercel deploys main; the page is live about a minute later.
//   POST {action:"unpublish", post_id} staff (JWT, owner/admin): removes the page and the index entry.
// All four languages are required before publish. The page carries each language in its own block and
// the site's language switch (assets/i18n.js) shows the right one; search engines see English first.
// Needs GITHUB_TOKEN in Edge Function secrets: a fine-grained token with Contents: read and write on the site repo.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type, authorization, apikey",
  "Content-Type": "application/json",
};
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: cors });
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
const LANGS = ["en", "fr", "es", "pt"] as const;
const LOCALE: Record<string, string> = { en: "en-GB", fr: "fr-FR", es: "es-ES", pt: "pt-PT" };
const READ: Record<string, string> = { en: "Read the article →", fr: "Lire l’article →", es: "Leer el artículo →", pt: "Ler o artigo →" };
const admin = () => createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

const TEMPLATE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
{{META}}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Marcellus&family=Cormorant+Garamond:ital,wght@0,500;0,600;1,500;1,600&family=Jost:wght@300;400;500;600&display=swap" rel="stylesheet">
<link rel="icon" type="image/png" href="assets/logo.png">
<style>
:root{--bca-green:#058D52;--bca-green-mid:#23A455;--bca-gold:#F7A61C;--bca-gold-2:#F9AF41;--bca-clay:#C14027;--bca-olive:#ABBB61;--bca-espresso:#452C23;--bca-night:#24170C;--bca-night-2:#211012;--bca-ink:#242424;--cream:#FAF6EE;--cream-2:#F2EBDD;--line:rgba(36,23,12,.14);--line-light:rgba(250,246,238,.16);--disp:"Marcellus",serif;--edit:"Cormorant Garamond",Georgia,serif;--ui:"Jost",Helvetica,sans-serif;}
*{margin:0;padding:0;box-sizing:border-box}html{scroll-behavior:smooth}
body{font-family:var(--ui);font-weight:300;background:var(--cream);color:var(--bca-ink);font-size:17px;line-height:1.65;-webkit-font-smoothing:antialiased}
::selection{background:var(--bca-gold);color:var(--bca-night)}
.brandstrip{height:8px;background:repeating-linear-gradient(90deg,var(--bca-green) 0 64px,var(--bca-gold) 64px 80px,var(--bca-clay) 80px 96px,var(--bca-olive) 96px 112px,var(--bca-espresso) 112px 128px,var(--bca-gold) 128px 144px,var(--bca-green-mid) 144px 208px)}
.wrap{max-width:1240px;margin:0 auto;padding:0 30px}
nav{background:rgba(250,246,238,.92);backdrop-filter:blur(12px);border-bottom:1px solid var(--line);position:sticky;top:0;z-index:90}
.nav-inner{display:flex;align-items:center;justify-content:space-between;padding:14px 0;gap:18px}
.nav-logo img{height:52px;display:block}
.nav-links{display:flex;align-items:center;gap:24px;list-style:none}
.nav-links a{color:var(--bca-ink);text-decoration:none;white-space:nowrap;font-size:14px;font-weight:400;letter-spacing:.04em;text-transform:uppercase;position:relative;padding:4px 0}
.nav-links a::after{content:"";position:absolute;left:0;bottom:-2px;width:0;height:2px;background:var(--bca-gold);transition:width .3s}
.nav-links a:hover::after,.nav-links a.active::after{width:100%}
.nav-right{display:flex;align-items:center;gap:18px}
.lang{display:inline-flex;border:1px solid var(--line)}
.lang button{font-family:var(--ui);font-size:12px;font-weight:500;letter-spacing:.06em;padding:8px 12px;border:none;background:transparent;color:var(--bca-espresso);cursor:pointer}
.lang button.on{background:var(--bca-night);color:var(--bca-gold)}
.btn{display:inline-flex;align-items:center;gap:10px;background:var(--bca-clay);color:var(--cream);text-decoration:none;padding:14px 30px;font-family:var(--ui);font-weight:500;font-size:14px;letter-spacing:.08em;text-transform:uppercase;border:1px solid var(--bca-clay);cursor:pointer;transition:.3s}
.btn:hover{background:transparent;color:var(--bca-clay);box-shadow:inset 0 0 0 1px var(--bca-clay)}
.btn.gold{background:var(--bca-gold);border-color:var(--bca-gold);color:var(--bca-night)}
.btn.gold:hover{background:transparent;color:var(--bca-gold);box-shadow:inset 0 0 0 1px var(--bca-gold)}
.btn.green{background:var(--bca-green);border-color:var(--bca-green);color:var(--cream)}
.btn.green:hover{background:transparent;color:var(--bca-green);box-shadow:inset 0 0 0 1px var(--bca-green)}
.btn.ghost{background:transparent;color:var(--cream);border-color:rgba(250,246,238,.4)}
.btn.ghost:hover{border-color:var(--bca-gold);color:var(--bca-gold)}
.hero{background:var(--bca-night-2);color:var(--cream);padding:92px 0 72px;position:relative;overflow:hidden;background-image:radial-gradient(800px 420px at 80% -10%,rgba(247,166,28,.14),transparent 60%),radial-gradient(600px 420px at 0% 110%,rgba(5,141,82,.13),transparent 55%)}
.hero .eyebrow{display:inline-flex;align-items:center;gap:14px;font-size:12.5px;letter-spacing:.34em;text-transform:uppercase;color:var(--bca-gold);margin-bottom:24px}
.hero .eyebrow::before{content:"";width:44px;height:1px;background:var(--bca-gold);opacity:.6}
.hero h1{font-family:var(--disp);font-weight:400;font-size:clamp(36px,4.8vw,64px);line-height:1.07;color:var(--cream);max-width:18ch}
.hero h1 .gild{color:var(--bca-gold)}
.hero p{max-width:60ch;margin-top:22px;color:rgba(250,246,238,.74);font-size:18px}
.hero .ctas{display:flex;gap:16px;flex-wrap:wrap;margin-top:34px}
section{padding:88px 0}
.sec-eyebrow{display:inline-flex;align-items:center;gap:12px;font-size:12px;font-weight:500;letter-spacing:.3em;text-transform:uppercase;color:var(--bca-clay);margin-bottom:18px}
.sec-eyebrow::before{content:"";width:38px;height:1px;background:var(--bca-clay)}
.center{text-align:center}.center .sec-eyebrow{justify-content:center}
h2{font-family:var(--disp);font-weight:400;font-size:clamp(28px,3.6vw,46px);color:var(--bca-night);line-height:1.12}
h2 .gild{color:var(--bca-gold)}
.lead{margin-top:14px;color:rgba(36,36,36,.7);max-width:62ch}
.center .lead{margin-left:auto;margin-right:auto}
.grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:22px;margin-top:46px}
.grid2{display:grid;grid-template-columns:repeat(2,1fr);gap:22px;margin-top:46px}
.card{background:#fff;border:1px solid var(--line);padding:34px 30px;transition:.35s;position:relative;overflow:hidden}
.card::before{content:"";position:absolute;top:0;left:0;width:100%;height:4px;transform:scaleX(0);transform-origin:left;transition:.4s;background:var(--bca-gold)}
.card:hover{transform:translateY(-6px);box-shadow:0 22px 44px rgba(36,23,12,.12);border-color:var(--bca-gold)}
.card:hover::before{transform:scaleX(1)}
.card .no{font-family:var(--edit);font-style:italic;font-size:18px;color:var(--bca-clay)}
.card h3{font-family:var(--disp);font-weight:400;font-size:22px;color:var(--bca-night);margin:10px 0 10px}
.card p{font-size:15px;color:rgba(36,36,36,.68)}
.card .price{font-family:var(--disp);font-size:30px;color:var(--bca-green);margin-top:10px}
.tagline{display:inline-block;font-size:10.5px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;background:var(--bca-gold);color:var(--bca-night);padding:4px 10px;margin-bottom:12px}
.tagline.soon{background:var(--cream-2);color:var(--bca-espresso)}
.quoteband{background:var(--bca-night);color:var(--cream);padding:84px 0;text-align:center}
.quoteband blockquote{font-family:var(--edit);font-style:italic;font-weight:500;font-size:clamp(24px,3.4vw,42px);line-height:1.22;max-width:22ch;margin:0 auto}
.quoteband blockquote b{color:var(--bca-gold);font-weight:500}
.cta-final{background:var(--bca-night-2);color:var(--cream);padding:104px 0;text-align:center}
.cta-final h2{color:var(--cream)}.cta-final p{color:rgba(250,246,238,.7);margin:16px 0 32px}
footer{background:var(--bca-night);color:rgba(250,246,238,.7);padding:64px 0 38px;font-size:14px;border-top:1px solid var(--line-light)}
.foot-grid{display:grid;grid-template-columns:2fr 1fr 1fr 1.3fr;gap:46px;margin-bottom:44px}
.foot-grid img{height:50px;display:block}
footer h4{font-family:var(--disp);font-weight:400;color:var(--bca-gold);font-size:14px;letter-spacing:.2em;text-transform:uppercase;margin-bottom:16px}
footer ul{list-style:none}footer li{margin-bottom:10px}
footer a{color:rgba(250,246,238,.7);text-decoration:none;transition:.2s}footer a:hover{color:var(--bca-gold)}
.foot-bottom{border-top:1px solid var(--line-light);padding-top:24px;display:flex;justify-content:space-between;flex-wrap:wrap;gap:12px;font-size:12.5px;opacity:.55}
.tabs{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 30px}
.tab{padding:14px 26px;border:1px solid var(--line);background:#fff;font-family:var(--ui);font-size:14px;font-weight:500;letter-spacing:.04em;text-transform:uppercase;color:rgba(36,36,36,.7);cursor:pointer;transition:.2s}
.tab.on{background:var(--bca-night);color:var(--cream);border-color:var(--bca-night)}
.panel{display:none}.panel.on{display:block}
.formwrap{background:#fff;border:1px solid var(--line);padding:42px 44px;max-width:760px}
.field{margin-bottom:18px}
.field label{display:block;font-size:12px;font-weight:500;letter-spacing:.12em;text-transform:uppercase;color:var(--bca-espresso);margin-bottom:7px}
.field .req{color:var(--bca-clay)}
.field input,.field select,.field textarea{width:100%;padding:13px 15px;border:1px solid var(--line);background:#fff;font-family:var(--ui);font-size:15px;color:var(--bca-ink);outline:none;transition:.2s}
.field textarea{min-height:110px;resize:vertical}
.field input:focus,.field select:focus,.field textarea:focus{border-color:var(--bca-green);box-shadow:0 0 0 3px rgba(5,141,82,.12)}
.frow{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.hint{font-size:12.5px;color:rgba(36,36,36,.55);margin-top:6px}
.done{background:#fff;border:1px solid var(--line);padding:48px 44px;text-align:center;max-width:760px}
.done .ok{width:72px;height:72px;border-radius:50%;background:var(--bca-green);color:#fff;font-size:30px;display:flex;align-items:center;justify-content:center;margin:0 auto 22px}
.done h3{font-family:var(--disp);font-weight:400;font-size:26px;color:var(--bca-night);margin-bottom:10px}
.done p{color:rgba(36,36,36,.66);max-width:46ch;margin:0 auto}
.rate{width:100%;border-collapse:collapse;background:#fff;border:1px solid var(--line);margin-top:40px}
.rate th,.rate td{padding:18px 20px;text-align:left;border-bottom:1px solid var(--line);font-size:15px}
.rate th{font-family:var(--disp);font-weight:400;color:var(--bca-espresso)}
.rate td:last-child{font-family:var(--disp);color:var(--bca-green);font-size:18px}
@media(max-width:1080px){.nav-links{display:none}.grid3,.grid2,.frow{grid-template-columns:1fr}.foot-grid{grid-template-columns:1fr 1fr}.formwrap{padding:32px 26px}}

.social{display:inline-flex;gap:15px;align-items:center;flex-wrap:wrap}.social a,.social .soon{display:inline-flex;color:rgba(250,246,238,.72);transition:.2s}.social a:hover{color:var(--bca-gold)}.social .soon{opacity:.4}.social svg{width:19px;height:19px;fill:currentColor;display:block}
[data-l10n]{display:none}html[lang="en"] [data-l10n="en"],html[lang="fr"] [data-l10n="fr"],html[lang="es"] [data-l10n="es"],html[lang="pt"] [data-l10n="pt"]{display:block}
</style>
<style>
.post-hero{background:var(--bca-night-2);color:var(--cream);padding:70px 0 54px;position:relative;overflow:hidden;background-image:radial-gradient(800px 420px at 82% -10%,rgba(247,166,28,.14),transparent 60%),radial-gradient(620px 420px at 0% 110%,rgba(5,141,82,.13),transparent 55%)}
.post-hero .wrap{max-width:820px}
.post-hero .eyebrow{color:var(--bca-gold);letter-spacing:.28em;text-transform:uppercase;font-size:12px;font-weight:500}
.post-hero h1{font-family:var(--disp);font-weight:400;font-size:clamp(30px,4vw,52px);line-height:1.08;margin:16px 0 18px}
.post-hero .byline{color:rgba(250,246,238,.7);font-size:14.5px}
.post-hero .byline b{color:var(--bca-gold);font-weight:500}
.post-figure{max-width:960px;margin:-34px auto 0;padding:0 30px;position:relative;z-index:2}
.post-figure img{width:100%;height:auto;display:block;border:1px solid var(--line);box-shadow:0 30px 70px rgba(36,23,12,.22)}
.article{max-width:720px;margin:0 auto;padding:56px 30px 30px}
.article p{font-size:18px;line-height:1.75;color:rgba(36,36,36,.86);margin:0 0 22px}
.article h2{font-family:var(--disp);font-weight:400;font-size:26px;color:var(--bca-night);margin:40px 0 14px;line-height:1.2}
.article p:first-of-type::first-letter{font-family:var(--disp);font-size:64px;line-height:.8;float:left;margin:6px 12px 0 0;color:var(--bca-clay)}
.article a{color:var(--bca-green)}
.post-foot{max-width:720px;margin:0 auto;padding:20px 30px 60px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:16px;border-top:1px solid var(--line)}
.post-foot .back{color:var(--bca-clay);text-decoration:none;font-weight:500;font-size:14px;letter-spacing:.04em;text-transform:uppercase}
.post-foot .share{display:flex;gap:12px}
.post-foot .share a{width:38px;height:38px;border:1px solid var(--line);display:inline-flex;align-items:center;justify-content:center;color:var(--bca-espresso);border-radius:50%;transition:.2s}
.post-foot .share a:hover{background:var(--bca-green);color:#fff;border-color:var(--bca-green)}
.post-foot .share svg{width:16px;height:16px;fill:currentColor}
.more{background:var(--cream-2);padding:70px 0}
.more h3{font-family:var(--disp);font-weight:400;font-size:24px;color:var(--bca-night);text-align:center;margin-bottom:30px}
/* blog listing */
.blog-feat{display:grid;grid-template-columns:1.15fr 1fr;gap:0;border:1px solid var(--line);background:#fff;margin-top:8px;overflow:hidden}
.blog-feat .img{background-size:cover;background-position:center;min-height:340px}
.blog-feat .body{padding:44px 42px}
.blog-feat .k{font-size:11.5px;letter-spacing:.16em;text-transform:uppercase;color:var(--bca-clay);font-weight:600}
.blog-feat h2{font-family:var(--disp);font-weight:400;font-size:clamp(24px,2.6vw,34px);color:var(--bca-night);margin:14px 0 12px;line-height:1.15}
.blog-feat p{color:rgba(36,36,36,.7);font-size:16px;margin-bottom:20px}
.blog-feat .date{font-size:13px;color:var(--bca-espresso);opacity:.6;margin-bottom:20px}
.bgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:24px;margin-top:26px}
.bcard{background:#fff;border:1px solid var(--line);display:flex;flex-direction:column;text-decoration:none;transition:.35s;overflow:hidden}
.bcard:hover{transform:translateY(-6px);box-shadow:0 24px 48px rgba(36,23,12,.14);border-color:var(--bca-gold)}
.bcard .img{height:190px;background-size:cover;background-position:center}
.bcard .body{padding:24px 24px 26px;flex:1;display:flex;flex-direction:column}
.bcard .date{font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:var(--bca-clay);font-weight:600}
.bcard h3{font-family:var(--disp);font-weight:400;font-size:20px;color:var(--bca-night);margin:10px 0 10px;line-height:1.2}
.bcard p{font-size:14px;color:rgba(36,36,36,.66);flex:1}
.bcard .r{margin-top:16px;color:var(--bca-green);font-size:13px;font-weight:500;letter-spacing:.04em;text-transform:uppercase}
@media(max-width:900px){.blog-feat{grid-template-columns:1fr}.blog-feat .img{min-height:220px}.bgrid{grid-template-columns:1fr}}
</style>
</head>
<body>
<div class="brandstrip"></div>
<nav><div class="wrap nav-inner">
  <a class="nav-logo" href="index.html"><img src="assets/logo-dark.png" alt="BCA Leadership"></a>
  <ul class="nav-links"><li><a href="index.html" data-t="nav.home">Home</a></li><li><a href="why-bca.html" data-t="nav.why">Why BCA</a></li><li><a href="the-bench.html" data-t="nav.coaches">The Bench</a></li><li><a href="membership.html" data-t="nav.membership">Membership</a></li><li><a href="coaching-packages.html" data-t="nav.coaching">Coaching</a></li><li><a href="services.html" data-t="nav.services">Services</a></li><li><a href="bca-online.html" data-t="nav.online">BCAOnline</a></li></ul>
  <div class="nav-right"><div class="lang"><button data-lang="en" class="on">EN</button><button data-lang="fr">FR</button><button data-lang="es">ES</button><button data-lang="pt">PT</button></div>
  <a class="btn" href="services.html" data-t="bp.nav.cta">Work with us</a></div>
</div></nav>
{{HERO}}
{{FIGURE}}
{{ARTICLES}}
<div class="post-foot">
  <a class="back" href="insights.html" data-t="bp.back">← All insights</a>
  <div class="share">{{SHARE}}</div>
</div>
{{MORE}}
<div class="brandstrip"></div>
<footer><div class="wrap">
  <div class="foot-grid">
    <div><img src="assets/logo-white.png" alt="BCA Leadership"><p style="margin-top:16px;max-width:300px" data-t="bp.foot.tag">Pan-African leadership enhancement: coaching, peer learning, consulting, project management, and business matching since 2017.</p></div>
    <div><h4 data-t="bp.foot.network">Network</h4><ul><li><a href="the-bench.html" data-t="nav.coaches">The Bench</a></li><li><a href="membership.html" data-t="nav.membership">Membership</a></li><li><a href="coaching-packages.html" data-t="nav.coaching">Coaching</a></li><li><a href="services.html" data-t="nav.services">Services</a></li><li><a href="bca-online.html" data-t="nav.online">BCAOnline</a></li></ul></div>
    <div><h4 data-t="bp.foot.explore">Explore</h4><ul><li><a href="podcast.html" data-t="nav.podcast">Podcast</a></li><li><a href="insights.html" data-t="nav.insights">Insights</a></li><li><a href="governance.html" data-t="bp.foot.gov">Board &amp; Governance</a></li><li><a href="programs.html" data-t="nav.programs">Programs</a></li><li><a href="shop.html" data-t="nav.shop">Shop</a></li><li><a href="sponsorship.html" data-t="nav.sponsorship">Sponsorship</a></li></ul></div>
    <div><h4 data-t="bp.foot.contact">Contact</h4><ul><li><a href="mailto:info@bcaleadership.com">info@bcaleadership.com</a></li><li><div class="social"><a href="https://www.linkedin.com/company/bcaafrica/" target="_blank" rel="noopener" aria-label="LinkedIn"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/></svg></a><a href="https://www.facebook.com/bcaAfrica" target="_blank" rel="noopener" aria-label="Facebook"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg></a><a href="https://x.com/bcaAfrica" target="_blank" rel="noopener" aria-label="X"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932L18.901 1.153zm-1.293 19.494h2.039L6.486 3.24H4.298L17.608 20.647z"/></svg></a><span class="soon" title="Coming soon" aria-label="TikTok (coming soon)" data-t-title="foot.soon" data-t-aria="a6.soc.tiktok"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z"/></svg></span><span class="soon" title="Coming soon" aria-label="Instagram (coming soon)" data-t-title="foot.soon" data-t-aria="a6.soc.ig"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/></svg></span><a href="https://www.youtube.com/@bcaleadership1873" target="_blank" rel="noopener" aria-label="YouTube"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg></a></div></li><li style="opacity:.65;font-size:13px;line-height:1.5" data-t="bp.foot.addr">BCA Leadership, Suite 113, First Floor, Grand Baie Business Park Phase 1, Grand Baie, Mauritius</li></ul></div>
  </div>
  <div class="foot-bottom"><span data-t="bp.foot.bottom">© 2026 BCA Leadership. All rights reserved. · <a href="terms.html" style="color:inherit;text-decoration:none;border-bottom:1px solid rgba(250,246,238,.25)" data-t="foot.terms">Terms of Use</a> · <a href="privacy.html" style="color:inherit;text-decoration:none;border-bottom:1px solid rgba(250,246,238,.25)" data-t="foot.privacy">Privacy Policy</a></span><span><a href="https://www.techfides.com" target="_blank" rel="noopener" style="color:#0EA5E9;text-decoration:none;font-weight:500" data-t="foot.powered">Powered by TechFides</a></span></div>
</div></footer>
<script src="assets/concierge.js" defer></script>
<script src="assets/engage.js" defer></script>
<script src="assets/search.js" defer></script>
<script src="assets/lux.js" defer></script>
<script>window.BCA_PAGE_I18N={{PAGE_I18N}};</script>
<script src="assets/i18n.js"></script>
</body>
</html>
`;
const SHARE = `<a href="https://www.linkedin.com/sharing/share-offsite/?url={{URL}}" target="_blank" rel="noopener" aria-label="Share on LinkedIn" data-t-aria="bp.share.li"><svg viewBox="0 0 24 24"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452z"/></svg></a>
    <a href="https://twitter.com/intent/tweet?url={{URL}}&text={{TITLE_URL}}" target="_blank" rel="noopener" aria-label="Share on X" data-t-aria="bp.share.x"><svg viewBox="0 0 24 24"><path d="M18.901 1.153h3.68l-8.04 9.19L24 22.846h-7.406l-5.8-7.584-6.638 7.584H.474l8.6-9.83L0 1.154h7.594l5.243 6.932zM17.61 20.644h2.039L6.486 3.24H4.298z"/></svg></a>`;
const PAGE_I18N = {"en": {"bp.nav.cta": "Work with us", "bp.back": "← All insights", "bp.more.h": "More from BCA", "bp.foot.tag": "Pan-African leadership enhancement: coaching, peer learning, consulting, project management, and business matching since 2017.", "bp.foot.network": "Network", "bp.foot.explore": "Explore", "bp.foot.gov": "Board &amp; Governance", "bp.foot.contact": "Contact", "bp.foot.addr": "BCA Leadership, Suite 113, First Floor, Grand Baie Business Park Phase 1, Grand Baie, Mauritius", "bp.foot.bottom": "© 2026 BCA Leadership. All rights reserved. · <a href=\"terms.html\" style=\"color:inherit;text-decoration:none;border-bottom:1px solid rgba(250,246,238,.25)\">Terms of Use</a> · <a href=\"privacy.html\" style=\"color:inherit;text-decoration:none;border-bottom:1px solid rgba(250,246,238,.25)\">Privacy Policy</a>"}, "fr": {"bp.nav.cta": "Travailler avec nous", "bp.back": "← Toutes les analyses", "bp.more.h": "Autres publications de BCA", "bp.foot.tag": "Renforcement du leadership panafricain : coaching, apprentissage entre pairs, conseil, gestion de projet et mise en relation d’affaires depuis 2017.", "bp.foot.network": "Réseau", "bp.foot.explore": "Explorer", "bp.foot.gov": "Conseil &amp; gouvernance", "bp.foot.contact": "Contact", "bp.foot.addr": "BCA Leadership, Suite 113, First Floor, Grand Baie Business Park Phase 1, Grand Baie, Maurice", "bp.foot.bottom": "© 2026 BCA Leadership. Tous droits réservés. · <a href=\"terms.html\" style=\"color:inherit;text-decoration:none;border-bottom:1px solid rgba(250,246,238,.25)\">Conditions d'utilisation</a> · <a href=\"privacy.html\" style=\"color:inherit;text-decoration:none;border-bottom:1px solid rgba(250,246,238,.25)\">Politique de confidentialité</a>"}, "es": {"bp.nav.cta": "Trabaje con nosotros", "bp.back": "← Todos los análisis", "bp.more.h": "Más de BCA", "bp.foot.tag": "Desarrollo del liderazgo panafricano: coaching, aprendizaje entre pares, consultoría, gestión de proyectos y vinculación de negocios desde 2017.", "bp.foot.network": "Red", "bp.foot.explore": "Explorar", "bp.foot.gov": "Consejo &amp; gobernanza", "bp.foot.contact": "Contacto", "bp.foot.addr": "BCA Leadership, Suite 113, First Floor, Grand Baie Business Park Phase 1, Grand Baie, Mauricio", "bp.foot.bottom": "© 2026 BCA Leadership. Todos los derechos reservados. · <a href=\"terms.html\" style=\"color:inherit;text-decoration:none;border-bottom:1px solid rgba(250,246,238,.25)\">Condiciones de uso</a> · <a href=\"privacy.html\" style=\"color:inherit;text-decoration:none;border-bottom:1px solid rgba(250,246,238,.25)\">Política de privacidad</a>"}, "pt": {"bp.nav.cta": "Trabalhe connosco", "bp.back": "← Todas as análises", "bp.more.h": "Mais da BCA", "bp.foot.tag": "Desenvolvimento da liderança pan-africana: coaching, aprendizagem entre pares, consultoria, gestão de projectos e ligação de negócios desde 2017.", "bp.foot.network": "Rede", "bp.foot.explore": "Explorar", "bp.foot.gov": "Conselho &amp; governação", "bp.foot.contact": "Contacto", "bp.foot.addr": "BCA Leadership, Suite 113, First Floor, Grand Baie Business Park Phase 1, Grand Baie, Maurícia", "bp.foot.bottom": "© 2026 BCA Leadership. Todos os direitos reservados. · <a href=\"terms.html\" style=\"color:inherit;text-decoration:none;border-bottom:1px solid rgba(250,246,238,.25)\">Termos de utilização</a> · <a href=\"privacy.html\" style=\"color:inherit;text-decoration:none;border-bottom:1px solid rgba(250,246,238,.25)\">Política de privacidade</a>"}};

/* Plain text → article HTML. Blank line = new paragraph. "## " starts a heading. Bare URLs become links. */
function articleHtml(body: string): string {
  return String(body || "").trim().split(/\n{2,}/).map((blk) => {
    const t = blk.trim();
    if (/^##\s+/.test(t)) return `<h2>${esc(t.replace(/^##\s+/, ""))}</h2>`;
    return `<p>${esc(t).replace(/\n/g, "<br>").replace(/(https?:\/\/[^\s<]+)/g, (m) => `<a href="${m}" rel="noopener">${m}</a>`)}</p>`;
  }).join("\n");
}
const longDate = (d: string, lang: string) => new Date(d + "T12:00:00Z").toLocaleDateString(LOCALE[lang] || "en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

function renderPage(p: any, base: string, coverPath: string, more: any[]): string {
  const url = `${base}/insight-${p.slug}`;
  const date = p.publish_on || new Date().toISOString().slice(0, 10);
  const meta = `<title>${esc(p.title_en)} | BCA Leadership</title>
<meta name="description" content="${esc(p.excerpt_en)}">
<link rel="canonical" href="${url}">
<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": "Article", headline: p.title_en, description: p.excerpt_en, author: { "@type": "Person", name: p.author_name }, publisher: { "@type": "Organization", name: "BCA Leadership", logo: { "@type": "ImageObject", url: `${base}/assets/logo.png` } }, datePublished: date, dateModified: date, inLanguage: ["en", "fr", "es", "pt"], mainEntityOfPage: url, image: `${base}/${coverPath}` })}</script>
<meta property="og:type" content="article">
<meta property="og:site_name" content="BCA Leadership">
<meta property="og:title" content="${esc(p.title_en)} | BCA Leadership">
<meta property="og:description" content="${esc(p.excerpt_en)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="${base}/${coverPath}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(p.title_en)} | BCA Leadership">
<meta name="twitter:description" content="${esc(p.excerpt_en)}">
<meta name="twitter:image" content="${base}/${coverPath}">`;
  const hero = `<header class="post-hero"><div class="wrap">
  <div class="eyebrow" data-t="nav.insights">Insights</div>
  ${LANGS.map((l) => `<div data-l10n="${l}"><h1>${esc(p["title_" + l])}</h1><div class="byline">By <b>${esc(p.author_name)}</b> · ${esc(longDate(date, l))}</div></div>`).join("\n  ")}
</div></header>`;
  const figure = `<figure class="post-figure"><img src="${esc(coverPath)}" alt="${esc(p.title_en)}" loading="eager"></figure>`;
  const articles = LANGS.map((l) => `<article class="article" lang="${l}" data-l10n="${l}">\n${articleHtml(p["body_" + l])}\n</article>`).join("\n");
  const shareHtml = SHARE.replace(/\{\{URL\}\}/g, url).replace(/\{\{TITLE_URL\}\}/g, encodeURIComponent(p.title_en));
  const moreHtml = more.length ? `<section class="more"><div class="wrap"><h3 data-t="bp.more.h">More from BCA</h3><div class="bgrid">${more.slice(0, 3).map((m) => `<a class="bcard" href="${esc(m.href)}"><div class="img" style="background-image:url('${esc(m.cover)}')"></div><div class="body">${LANGS.map((l) => `<div data-l10n="${l}"><div class="date">${esc(m.date[l] || m.date.en)}</div><h3>${esc(m.title[l] || m.title.en)}</h3><p>${esc(m.excerpt[l] || m.excerpt.en)}</p></div>`).join("")}<span class="r">→</span></div></a>`).join("")}</div></div></section>` : "";
  return TEMPLATE.replace("{{META}}", meta).replace("{{HERO}}", hero).replace("{{FIGURE}}", figure).replace("{{ARTICLES}}", articles)
    .replace("{{SHARE}}", shareHtml).replace("{{MORE}}", moreHtml).replace("{{PAGE_I18N}}", JSON.stringify(PAGE_I18N));
}

/* ── GitHub contents API ── */
async function gh(path: string, init: RequestInit = {}) {
  const r = await fetch(`https://api.github.com${path}`, { ...init, headers: { Authorization: `Bearer ${Deno.env.get("GITHUB_TOKEN")}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "bca-coaching-engine", ...(init.headers || {}) } });
  return r;
}
async function ghGet(repo: any, path: string): Promise<{ sha: string; content: string } | null> {
  const r = await gh(`/repos/${repo.owner}/${repo.repo}/contents/${path}?ref=${repo.branch}`);
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`GitHub read ${path}: ${r.status} ${(await r.text()).slice(0, 160)}`);
  const j = await r.json();
  return { sha: j.sha, content: j.encoding === "base64" ? new TextDecoder().decode(Uint8Array.from(atob(j.content.replace(/\n/g, "")), (c) => c.charCodeAt(0))) : "" };
}
const b64 = (u8: Uint8Array) => { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };
async function ghPut(repo: any, path: string, bytes: Uint8Array, message: string): Promise<string> {
  const cur = await gh(`/repos/${repo.owner}/${repo.repo}/contents/${path}?ref=${repo.branch}`);
  const sha = cur.ok ? (await cur.json()).sha : undefined;
  const r = await gh(`/repos/${repo.owner}/${repo.repo}/contents/${path}`, { method: "PUT", body: JSON.stringify({ message, branch: repo.branch, content: b64(bytes), ...(sha ? { sha } : {}), committer: { name: "BCA Coaching Engine", email: "info@bcaleadership.com" } }) });
  if (!r.ok) throw new Error(`GitHub write ${path}: ${r.status} ${(await r.text()).slice(0, 200)}`);
  return (await r.json()).commit?.sha || "";
}
async function ghDelete(repo: any, path: string, message: string) {
  const cur = await gh(`/repos/${repo.owner}/${repo.repo}/contents/${path}?ref=${repo.branch}`);
  if (!cur.ok) return;
  const sha = (await cur.json()).sha;
  await gh(`/repos/${repo.owner}/${repo.repo}/contents/${path}`, { method: "DELETE", body: JSON.stringify({ message, branch: repo.branch, sha }) });
}
const enc = (s: string) => new TextEncoder().encode(s);

/* The index file the Insights page reads. Newest first. */
function indexEntry(p: any, base: string, coverPath: string) {
  const date = p.publish_on || new Date().toISOString().slice(0, 10);
  const o: any = { slug: p.slug, href: `insight-${p.slug}.html`, url: `${base}/insight-${p.slug}`, cover: coverPath, published_on: date, author: p.author_name, title: {}, excerpt: {}, date: {} };
  for (const l of LANGS) { o.title[l] = p["title_" + l]; o.excerpt[l] = p["excerpt_" + l]; o.date[l] = longDate(date, l); }
  return o;
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
  const { data: p } = await db.from("blog_posts").select("*").eq("id", String(b.post_id || "")).maybeSingle();
  if (!p) return json({ ok: false, error: "not_found" }, 404);
  const { data: member } = await db.from("tenant_users").select("full_name,email,role,status").eq("tenant_id", p.tenant_id).eq("user_id", userRes.user.id).maybeSingle();
  if (!member || member.status === "suspended" || !["owner", "admin"].includes(member.role)) return json({ ok: false, error: "forbidden" }, 403);

  const { data: cfg } = await db.from("tenant_config").select("business_rules").eq("tenant_id", p.tenant_id).maybeSingle();
  const repo = { owner: "jacquesmjean", repo: "bca-leadership-website", branch: "main", base_url: "https://bcaleadership.com", ...(cfg?.business_rules?.site_repo || {}) };
  const base = String(repo.base_url).replace(/\/$/, "");

  // completeness: every language, every field
  const missing: string[] = [];
  for (const l of LANGS) for (const f of ["title", "excerpt", "body"]) if (!String(p[`${f}_${l}`] || "").trim()) missing.push(`${f}_${l}`);
  if (!p.cover_document_id && !p.cover_url) missing.push("cover");

  // cover: from the vault (copied into the repo) or an external URL
  let coverPath = p.cover_url || "assets/og-bca.jpg"; let coverBytes: Uint8Array | null = null;
  if (p.cover_document_id) {
    const { data: doc } = await db.from("documents").select("storage_path,file_name,mime_type").eq("id", p.cover_document_id).maybeSingle();
    if (doc) {
      const ext = (doc.file_name.match(/\.(jpe?g|png|webp)$/i) || [".jpg"])[0].toLowerCase();
      coverPath = `assets/blog/${p.slug}${ext}`;
      if (b.action !== "preview") {
        const { data: file, error: fe } = await db.storage.from("vault").download(doc.storage_path);
        if (fe || !file) return json({ ok: false, error: "cover_download_failed" }, 502);
        coverBytes = new Uint8Array(await file.arrayBuffer());
      } else coverPath = (await db.storage.from("vault").createSignedUrl(doc.storage_path, 600)).data?.signedUrl || coverPath;
    }
  }

  // other published posts, for the "More from BCA" strip: read from the live index (it already knows every cover)
  let idxList: any[] = [];
  if (Deno.env.get("GITHUB_TOKEN")) { try { const idx = await ghGet(repo, "assets/insights.json"); idxList = idx ? JSON.parse(idx.content) : []; } catch { idxList = []; } }
  const more = idxList.filter((e: any) => e.slug !== p.slug);

  if (b.action === "preview") return json({ ok: true, html: renderPage(p, base, coverPath, more), missing });

  if (!Deno.env.get("GITHUB_TOKEN")) return json({ ok: false, error: "no_github_token" }, 503);

  if (b.action === "unpublish") {
    await ghDelete(repo, `insight-${p.slug}.html`, `Unpublish: ${p.title_en}`);
    const list = idxList.filter((e: any) => e.slug !== p.slug);
    await ghPut(repo, "assets/insights.json", enc(JSON.stringify(list, null, 1)), `Insights index: remove ${p.slug}`);
    const sm = await ghGet(repo, "sitemap.xml");
    if (sm && sm.content.includes(`/insight-${p.slug}<`)) await ghPut(repo, "sitemap.xml", enc(sm.content.replace(new RegExp(`\\s*<url><loc>[^<]*/insight-${p.slug}</loc>.*?</url>`, "s"), "")), `Sitemap: remove ${p.slug}`);
    await db.from("blog_posts").update({ status: "archived" }).eq("id", p.id);
    return json({ ok: true });
  }

  if (b.action === "publish") {
    if (missing.length) return json({ ok: false, error: "incomplete", missing }, 422);
    if (!["approved", "published"].includes(p.status)) return json({ ok: false, error: "not_approved" }, 409);
    try {
      if (coverBytes) await ghPut(repo, coverPath, coverBytes, `Blog cover: ${p.slug}`);
      const html = renderPage(p, base, coverPath, more);
      const sha = await ghPut(repo, `insight-${p.slug}.html`, enc(html), `Blog: ${p.title_en}`);
      const list = idxList.filter((e: any) => e.slug !== p.slug);
      list.unshift(indexEntry(p, base, coverPath));
      list.sort((a: any, b2: any) => String(b2.published_on).localeCompare(String(a.published_on)));
      await ghPut(repo, "assets/insights.json", enc(JSON.stringify(list, null, 1)), `Insights index: ${p.slug}`);
      const sm = await ghGet(repo, "sitemap.xml");
      if (sm && !sm.content.includes(`/insight-${p.slug}<`)) {
        const entry = `  <url><loc>${base}/insight-${p.slug}</loc><lastmod>${p.publish_on || new Date().toISOString().slice(0, 10)}</lastmod><changefreq>yearly</changefreq><priority>0.6</priority></url>\n`;
        await ghPut(repo, "sitemap.xml", enc(sm.content.replace("</urlset>", entry + "</urlset>")), `Sitemap: ${p.slug}`);
      }
      const url = `${base}/insight-${p.slug}`;
      await db.from("blog_posts").update({ status: "published", published_at: p.published_at || new Date().toISOString(), published_url: url, last_commit: sha, cover_url: p.cover_document_id ? null : p.cover_url }).eq("id", p.id);
      return json({ ok: true, url, commit: sha });
    } catch (e) { return json({ ok: false, error: String((e as Error).message) }, 502); }
  }
  return json({ ok: false, error: "unknown_action" }, 400);
});
