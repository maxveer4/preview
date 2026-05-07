// Extracts CMS field values from a generated HTML string.
// Priority: embedded gowebbo-cms JSON comment > regex fallback.

function extractFields(html) {
  // ── 1. Try embedded JSON comment (fastest, most complete) ──
  const cmMatch = html.match(/<!--\s*gowebbo-cms:\s*(\{[\s\S]*?\})\s*-->/);
  if (cmMatch) {
    try { return JSON.parse(cmMatch[1]); } catch (_) {}
  }

  // ── 2. Regex fallback for n8n-generated HTML ──
  const data = {};

  function grab(pattern, key, transform) {
    const m = html.match(pattern);
    if (m?.[1]) data[key] = transform ? transform(m[1].trim()) : m[1].trim();
  }

  // Meta / SEO
  grab(/<title>(.*?)<\/title>/, 'seo_title');
  grab(/<meta name="description" content="(.*?)"/, 'seo_description');

  // CSS primary colour
  grab(/--primary:\s*(hsl[^;]+);/, 'kleur_primary');

  // Company — bedrijfsnaam appears reliably in footer address block
  grab(/<p style="font-weight:600;color:var\(--foreground\)">(.*?)<\/p>/, 'bedrijfsnaam');

  // Contact info
  grab(/<a href="tel:[^"]*">\s*<svg[\s\S]*?<\/svg>\s*([\d\s()+\-]+?)\s*<\/a>/, 'telefoon_display');
  grab(/<a href="mailto:([^"]+)"/, 'email');

  // Hero
  grab(/<p class="hero-eyebrow">(.*?)<\/p>/, 'hero_eyebrow');
  grab(/<h1 class="hero-title">(.*?)<\/h1>/, 'hero_title');
  grab(/<p class="hero-desc">(.*?)<\/p>/, 'hero_desc');

  // USPs — 3 <li> items inside .hero-list, each has an <svg> then the text
  const heroListM = html.match(/<ul class="hero-list">([\s\S]*?)<\/ul>/);
  if (heroListM) {
    const liMatches = [...heroListM[1].matchAll(/<li>[\s\S]*?<\/svg>\s*([\s\S]*?)\s*<\/li>/g)];
    ['usp_1', 'usp_2', 'usp_3'].forEach((k, i) => {
      if (liMatches[i]) data[k] = liMatches[i][1].trim();
    });
  }

  // Images (Supabase URLs stored in src)
  grab(/<img id="heroImg"\s+src="([^"]+)"/, 'foto_hero');
  grab(/<img id="logoImg"\s+src="([^"]+)"/, 'logo_url');
  grab(/<img id="serviceImg"\s+src="([^"]+)"/, 'foto_waarom');
  grab(/<img id="uspImg"\s+src="([^"]+)"/, 'foto_usp');
  grab(/<img id="werkwijzeImg"\s+src="([^"]+)"/, 'foto_werkwijze');

  // Footer address block
  grab(/KvK:\s*([^<\s]+)/, 'kvk');

  // adres_straat, adres_postcode_stad — appear right after the bedrijfsnaam p
  const addrM = html.match(
    /<p style="font-weight:600;color:var\(--foreground\)">[^<]+<\/p>\s*<p>(.*?)<\/p>\s*<p>(.*?)<\/p>/
  );
  if (addrM) {
    data.adres_straat        = addrM[1].trim();
    data.adres_postcode_stad = addrM[2].trim();
  }

  // Footer list — Diensten (first <ul> in footer containing href="#" links)
  const footerM = html.match(/<footer[\s\S]*?<\/footer>/);
  if (footerM) {
    const footer = footerM[0];
    // All <a href="#"> items — first 4 are diensten, next 6 are steden
    const allLinks = [...footer.matchAll(/<li><a href="#">(.*?)<\/a><\/li>/g)].map(m => m[1].trim());
    ['dienst_1','dienst_2','dienst_3','dienst_4'].forEach((k, i) => {
      if (allLinks[i]) data[k] = allLinks[i];
    });
    ['stad_1','stad_2','stad_3','stad_4','stad_5','stad_6'].forEach((k, i) => {
      if (allLinks[4 + i]) data[k] = allLinks[4 + i];
    });
  }

  // Service section
  grab(/<h2>(.*?)<\/h2>[\s\S]*?class="service-img"/, 'service_title');
  // service_title more reliably
  const svcM = html.match(/class="service-img"[\s\S]{0,200}?<h2>(.*?)<\/h2>/);
  if (!svcM) {
    const svc2 = html.match(/<h2>(.*?)<\/h2>[\s\S]{0,50}?<p>(.*?)<\/p>[\s\S]{0,200}?service-img/);
    if (svc2) { data.service_title = svc2[1].trim(); data.service_desc = svc2[2].trim(); }
  }

  // Werkwijze
  grab(/<h2>(.*?)<\/h2>[\s\S]{0,30}?<p class="work-desc">/, 'werk_title');
  const workM = html.match(/<p class="work-desc">(.*?)<\/p>\s*<p class="work-desc">(.*?)<\/p>/);
  if (workM) { data.werk_desc_1 = workM[1].trim(); data.werk_desc_2 = workM[2].trim(); }

  // Maps URL
  grab(/src="(https:\/\/www\.google\.com\/maps\/embed[^"]+)"/, 'maps_url');

  // Contact form webhook
  grab(/fetch\('([^']+)',\s*\{[\s\S]*?method:\s*'POST'/, 'contact_form_webhook');

  return data;
}

module.exports = { extractFields };
