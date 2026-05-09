// Extracts CMS field values from generated HTML.
// Priority: embedded gowebbo-cms JSON comment > regex fallback.

// ── Helpers ──────────────────────────────────────────────────────────────────

function first(html, pattern) {
  const m = html.match(pattern);
  return m?.[1]?.trim() ?? null;
}

function all(html, pattern) {
  return [...html.matchAll(pattern)];
}

function set(data, key, val) {
  const s = val != null ? String(val).trim() : '';
  if (s !== '' && !/^\{\{[^}]+\}\}$/.test(s)) {
    data[key] = s;
  }
}

// ── Homepage fields ───────────────────────────────────────────────────────────

function extractHomeFields(html) {
  if (!html) return {};

  // Embedded comment (fastest, set by our editor on every save)
  const cmMatch = html.match(/<!--\s*gowebbo-cms:\s*(\{[\s\S]*?\})\s*-->/);
  if (cmMatch) {
    try { return JSON.parse(cmMatch[1]); } catch (_) {}
  }

  const data = {};

  // ── Meta / SEO ──
  set(data, 'seo_title',       first(html, /<title>(.*?)<\/title>/));
  set(data, 'seo_description', first(html, /<meta name="description" content="(.*?)"/));

  // ── Colours ──
  set(data, 'kleur_primary', first(html, /--primary:\s*(hsl[^;]+);/));

  // ── Contact info ──
  set(data, 'bedrijfsnaam',     first(html, /<p style="font-weight:600;color:var\(--foreground\)">(.*?)<\/p>/));
  set(data, 'telefoon_display', first(html, /<a href="tel:[^"]*">\s*<svg[\s\S]*?<\/svg>\s*([\d\s()+\-]+?)\s*<\/a>/));
  set(data, 'email',            first(html, /<a href="mailto:([^"]+)"/));

  // ── Footer address ──
  set(data, 'kvk', first(html, /KvK:\s*([^<\s]+)/));
  const addrM = html.match(/<p style="font-weight:600;color:var\(--foreground\)">[^<]+<\/p>\s*<p>(.*?)<\/p>\s*<p>(.*?)<\/p>/);
  if (addrM) {
    set(data, 'adres_straat',        addrM[1]);
    set(data, 'adres_postcode_stad', addrM[2]);
  }

  // ── Hero ──
  set(data, 'hero_eyebrow', first(html, /<p class="hero-eyebrow">(.*?)<\/p>/));
  set(data, 'hero_title',   first(html, /<h1 class="hero-title">(.*?)<\/h1>/));
  set(data, 'hero_desc',    first(html, /<p class="hero-desc">(.*?)<\/p>/));

  // ── USPs (hero list) ──
  const heroList = html.match(/<ul class="hero-list">([\s\S]*?)<\/ul>/);
  if (heroList) {
    const lis = all(heroList[1], /<li>[\s\S]*?<\/svg>\s*([\s\S]*?)\s*<\/li>/g);
    ['usp_1', 'usp_2', 'usp_3'].forEach((k, i) => { if (lis[i]) set(data, k, lis[i][1]); });
  }

  // ── Images ──
  set(data, 'foto_hero',      first(html, /<img id="heroImg"\s+src="([^"]+)"/));
  set(data, 'logo_url',       first(html, /<img id="logoImg"\s+src="([^"]+)"/));
  set(data, 'foto_waarom',    first(html, /<img id="serviceImg"\s+src="([^"]+)"/));
  set(data, 'foto_usp',       first(html, /<img id="uspImg"\s+src="([^"]+)"/));
  set(data, 'foto_werkwijze', first(html, /<img id="werkwijzeImg"\s+src="([^"]+)"/));

  // ── Trust section ──
  set(data, 'trust_desc', first(html, /<p class="trust-desc">(.*?)<\/p>/));
  const trustCards = all(html, /<div class="trust-card">[\s\S]*?<h3>(.*?)<\/h3>\s*<p>(.*?)<\/p>/g);
  [[1,'trust_1_titel'],[2,'trust_2_titel'],[3,'trust_3_titel']].forEach(([n, k]) => {
    const c = trustCards[n - 1];
    if (c) { set(data, k, c[1]); set(data, k.replace('titel', 'desc'), c[2]); }
  });

  // ── Service section — anchor search on serviceImg then first h2 + p ──
  const svcM = html.match(/id="serviceImg"[\s\S]*?<h2>([\s\S]*?)<\/h2>[\s\S]*?<p>([\s\S]*?)<\/p>/);
  if (svcM) { set(data, 'service_title', svcM[1]); set(data, 'service_desc', svcM[2]); }

  // ── Why section ──
  set(data, 'why_desc', first(html, /<p class="why-desc">(.*?)<\/p>/));
  const whyGrid = html.match(/<div class="why-grid">([\s\S]*?)<\/div>\s*<\/section>/);
  if (whyGrid) {
    const whys = all(whyGrid[1], /<div><h3>(.*?)<\/h3><p>(.*?)<\/p><\/div>/g);
    ['why_1','why_2','why_3','why_4'].forEach((p, i) => {
      if (whys[i]) { set(data, `${p}_titel`, whys[i][1]); set(data, `${p}_desc`, whys[i][2]); }
    });
  }

  // ── Werkwijze / steps ──
  set(data, 'werk_title', first(html, /<h2>(.*?)<\/h2>\s*<p class="work-desc">/));
  const workDescs = all(html, /<p class="work-desc">(.*?)<\/p>/g);
  if (workDescs[0]) set(data, 'werk_desc_1', workDescs[0][1]);
  if (workDescs[1]) set(data, 'werk_desc_2', workDescs[1][1]);

  set(data, 'stappen_title', first(html, /<div class="work-steps">\s*<h3>(.*?)<\/h3>/));
  const staps = all(html, /<div class="work-step">[\s\S]*?<div><h4>(.*?)<\/h4><p>(.*?)<\/p><\/div>/g);
  ['stap_1','stap_2','stap_3','stap_4'].forEach((p, i) => {
    if (staps[i]) { set(data, `${p}_titel`, staps[i][1]); set(data, `${p}_desc`, staps[i][2]); }
  });

  set(data, 'vakmanschap_desc', first(html, /<h3>Vakmanschap en[\s\S]*?<\/h3>\s*<p>(.*?)<\/p>/));

  // ── Reviews JSON ──
  set(data, 'reviews_json', first(html, /const reviews = \[([\s\S]*?)\];/));

  // ── Modal iframes ──
  set(data, 'modal_offerte_iframe',
    first(html, /closeModal\('offerte'\)[^>]*>.*?<\/button>\s*([\s\S]*?)\s*<\/div>/s));
  set(data, 'modal_advies_iframe',
    first(html, /closeModal\('advies'\)[^>]*>.*?<\/button>\s*([\s\S]*?)\s*<\/div>/s));

  // ── Footer lists: diensten + steden (parsed per section to avoid index shift) ──
  const footer = html.match(/<footer[\s\S]*?<\/footer>/)?.[0] ?? '';
  if (footer) {
    const dienstenBlock = footer.match(/<h4>Diensten<\/h4>\s*<ul>([\s\S]*?)<\/ul>/);
    if (dienstenBlock) {
      const dl = all(dienstenBlock[1], /<li><a[^>]*>([^<]*)<\/a><\/li>/g).map(m => m[1].trim()).filter(Boolean);
      ['dienst_1','dienst_2','dienst_3','dienst_4','dienst_5','dienst_6'].forEach((k, i) => { if (dl[i]) set(data, k, dl[i]); });
    }
    const stedenBlock = footer.match(/<h4>Werkgebied<\/h4>\s*<ul>([\s\S]*?)<\/ul>/);
    if (stedenBlock) {
      const sl = all(stedenBlock[1], /<li><a[^>]*>([^<]*)<\/a><\/li>/g).map(m => m[1].trim()).filter(Boolean);
      ['stad_1','stad_2','stad_3','stad_4','stad_5','stad_6'].forEach((k, i) => { if (sl[i]) set(data, k, sl[i]); });
    }
  }

  // ── Maps URL (from contact section if present) ──
  set(data, 'maps_url', first(html, /href="(https:\/\/[^"]*maps\.[^"]+)"/));

  return data;
}

// ── Contact page fields ───────────────────────────────────────────────────────

function extractContactFields(html) {
  if (!html) return {};
  const data = {};
  set(data, 'contact_hero_desc',    first(html, /<h1>Contact<\/h1>\s*<p>(.*?)<\/p>/));
  set(data, 'contact_form_webhook', first(html, /const CONTACT_WEBHOOK = '(.*?)'/));
  set(data, 'maps_url',             first(html, /href="(https:\/\/[^"]*maps\.[^"]+)"/));
  return data;
}

// ── Diensten page fields ──────────────────────────────────────────────────────

function extractDienstenFields(html) {
  if (!html) return {};
  const data = {};
  set(data, 'diensten_hero_desc', first(html, /<h1>Onze Diensten<\/h1>\s*<p>(.*?)<\/p>/));
  const ctaM = html.match(/<h2>(.*?)<\/h2>\s*<p class="desc">(.*?)<\/p>/);
  if (ctaM) { set(data, 'diensten_cta_titel', ctaM[1]); set(data, 'diensten_cta_desc', ctaM[2]); }
  // diensten_json: content between `var diensten =` and `; var grid`
  set(data, 'diensten_json', first(html, /var diensten = ([\s\S]*?);\s*var grid/));
  return data;
}

// ── Over ons page fields ──────────────────────────────────────────────────────

function extractOverOnsFields(html) {
  if (!html) return {};
  const data = {};
  set(data, 'over_ons_hero_desc', first(html, /<h1>Over Ons<\/h1>\s*<p>(.*?)<\/p>/));
  set(data, 'over_ons_cta_desc',  first(html, /<h2>Kunnen wij u[\s\S]*?<\/h2>\s*<p>(.*?)<\/p>/));

  // Intro paragraphs (after "Wie zijn wij?" heading)
  const introM = html.match(/<h2>Wie zijn[\s\S]*?<\/h2>\s*<p>(.*?)<\/p>\s*<p>(.*?)<\/p>\s*<p>(.*?)<\/p>/);
  if (introM) {
    set(data, 'over_ons_intro_p1', introM[1]);
    set(data, 'over_ons_intro_p2', introM[2]);
    set(data, 'over_ons_intro_p3', introM[3]);
  }

  // Waarden cards
  const waarden = all(html, /<div class="waarde-card">[\s\S]*?<h3>(.*?)<\/h3>\s*<p>(.*?)<\/p>/g);
  ['over_ons_waarde_1','over_ons_waarde_2','over_ons_waarde_3','over_ons_waarde_4'].forEach((p, i) => {
    if (waarden[i]) {
      set(data, `${p}_titel`, waarden[i][1]);
      set(data, `${p}_desc`,  waarden[i][2]);
    }
  });

  return data;
}

// ── Public API ────────────────────────────────────────────────────────────────

// extractFields(html) = homepage extractor (backward compat)
function extractFields(html) {
  return extractHomeFields(html);
}

module.exports = { extractFields, extractHomeFields, extractContactFields, extractDienstenFields, extractOverOnsFields };
