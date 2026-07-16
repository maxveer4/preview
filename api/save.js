const fs   = require('fs');
const path = require('path');
const { extractHomeFields, extractContactFields, extractDienstenFields, extractOverOnsFields } = require('./_extract');
const { TEMPLATES, DEFAULT_TEMPLATE } = require('./_template-config');
const { ICON_MAP, DEFAULT_ICON_NAMES } = require('./_icon-map');

const REPO         = 'maxveer4/preview';
const KLANTEN_REPO = 'maxveer4/gowebbo-klanten';
const BRANCH       = 'main';
const BASE_URL     = 'https://preview.gowebbo.io';
const SUPABASE_URL = 'https://agdwnlqiepnmxwkrpzqv.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFnZHdubHFpZXBubXh3a3JwenF2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwNzM4MzAsImV4cCI6MjA5MTY0OTgzMH0.bSw1y5gvVGg1C02AFU-bbfq4rSmy99APILktrlPIf2Y';

// Replace all {{KEY}} occurrences using plain split/join.
// Two passes per key:
//   1. "{{KEY}}" (quoted) → JSON-escaped value  (safe inside window.GOWEBBO_DATA JSON)
//   2.  {{KEY}}  (plain)  → raw value            (safe inside JS expressions like [{{REVIEWS_JSON}}])
function applyMap(template, map) {
  let out = template;
  for (const [key, val] of Object.entries(map)) {
    const raw = val == null ? '' : String(val);
    // Escape backslashes and double-quotes so the value is safe inside a JSON string.
    const escaped = raw.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    // Pass 1: replace the quoted placeholder first (more specific match).
    out = out.split(`"{{${key}}}"`).join(`"${escaped}"`);
    // Pass 2: replace any remaining unquoted placeholder with the raw value.
    out = out.split(`{{${key}}}`).join(raw);
  }
  // Remove any remaining unknown placeholders so they don't show up in the HTML.
  return out.replace(/\{\{[A-Z0-9_]+\}\}/g, '');
}

// "hsl(142,72%,38%)" → "hsla(142,72%,38%,0.2)"
function hslToHsla(hsl, alpha) {
  return hsl.trim().replace(/^hsl\(/, 'hsla(').replace(/\)$/, `,${alpha})`);
}

// "#3b82f6" → "rgba(59,130,246,0.1)"
function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

// "#3b82f6" → "213 88% 61%"  (Tailwind HSL format: no hsl() wrapper, spaces not commas)
function hexToHslTailwind(hex) {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

// Normalize all keys to lowercase so editor getElementById(id) can always find fields
// (create-website.js saves ALL_CAPS keys; editor elements have lowercase IDs).
function normalizeKeys(obj) {
  if (!obj || typeof obj !== 'object') return {};
  const result = {};
  for (const [k, v] of Object.entries(obj)) {
    result[k.toLowerCase()] = v;
  }
  return result;
}

// Editor sends [{naam, tekst, stad, datum, score}] with outer brackets.
// Template does: const reviews = [{{REVIEWS_JSON}}]; and uses r.naam, r.tekst, r.datum.
// → strip outer brackets only so template gets [{...},{...}] not [[{...}]].
function processReviewsJson(raw) {
  try {
    let arr = JSON.parse(raw);
    if (!Array.isArray(arr)) arr = [arr];
    return arr.map(r => JSON.stringify(r)).join(',');
  } catch (_) {
    return raw;
  }
}

// Fetch all 4 pages and extract every possible field value for merge.
// Tries Supabase first (no CDN caching delay), falls back to CDN extraction.
async function loadAllExistingFields(slug) {
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/client_content?slug=eq.${encodeURIComponent(slug)}&select=data`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } },
    );
    if (r.ok) {
      const rows = await r.json();
      if (rows[0]?.data) return normalizeKeys(rows[0].data);
    }
  } catch (_) {}

  async function fetchHtml(url) {
    try { const r = await fetch(url); return r.ok ? r.text() : null; }
    catch (_) { return null; }
  }
  const [homeHtml, contactHtml, dienstenHtml, overOnsHtml] = await Promise.all([
    fetchHtml(`${BASE_URL}/${slug}.html`),
    fetchHtml(`${BASE_URL}/${slug}-contact.html`),
    fetchHtml(`${BASE_URL}/${slug}-diensten.html`),
    fetchHtml(`${BASE_URL}/${slug}-over-ons.html`),
  ]);
  return normalizeKeys({
    ...extractHomeFields(homeHtml),
    ...extractContactFields(contactHtml),
    ...extractDienstenFields(dienstenHtml),
    ...extractOverOnsFields(overOnsHtml),
  });
}

async function githubUpdateIfExists(token, filePath, content, repo) {
  const url     = `https://api.github.com/repos/${repo}/contents/${filePath}`;
  const headers = {
    Authorization: `token ${token}`,
    'Content-Type': 'application/json',
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'gowebbo-editor/1.0',
  };
  const getRes = await fetch(url, { headers });
  if (!getRes.ok) return; // bestand bestaat niet in klanten repo → overslaan
  const existing = await getRes.json();
  await fetch(url, {
    method: 'PUT', headers,
    body: JSON.stringify({
      message: `Update ${filePath} via CMS editor`,
      content: Buffer.from(content).toString('base64'),
      branch: BRANCH,
      sha: existing.sha,
    }),
  });
}

async function githubUpsert(token, filePath, content, repo = REPO) {
  const url     = `https://api.github.com/repos/${repo}/contents/${filePath}`;
  const headers = {
    Authorization: `token ${token}`,
    'Content-Type': 'application/json',
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'gowebbo-editor/1.0',
  };

  for (let attempt = 0; attempt < 2; attempt++) {
    const getRes  = await fetch(url, { headers });
    const existing = getRes.ok ? await getRes.json() : null;

    const body = {
      message: `Update ${filePath} via CMS editor`,
      content: Buffer.from(content).toString('base64'),
      branch:  BRANCH,
    };
    if (existing?.sha) body.sha = existing.sha;

    const putRes = await fetch(url, { method: 'PUT', headers, body: JSON.stringify(body) });
    if (putRes.ok) return;
    // 409/422 = SHA conflict (stale SHA from a concurrent save) — retry with fresh SHA
    if ((putRes.status === 409 || putRes.status === 422) && attempt === 0) continue;
    const txt = await putRes.text();
    throw new Error(`GitHub ${putRes.status} for ${filePath}: ${txt}`);
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  const token = process.env.GITHUB_TOKEN;
  if (!token) return res.status(500).json({ error: 'GITHUB_TOKEN env var not set' });

  const { slug, template: templateFromPayload, website_data, changed_fields: _cf, ...directFields } = req.body || {};
  const incomingFields = website_data || directFields;
  if (!slug) return res.status(400).json({ error: 'slug is required' });

  // Load existing values from all 4 pages — incoming fields take precedence
  const existingFields = await loadAllExistingFields(slug);
  // Guard against cross-slug contamination: if the existing HTML was generated for a
  // different client (e.g. a copied file), strip client-specific fields so they don't
  // bleed into this save.
  if (existingFields.slug && existingFields.slug !== slug) {
    ['email','bedrijfsnaam','telefoon_display','adres_straat','adres_postcode_stad','kvk',
     'logo_url','maps_url'].forEach(f => delete existingFields[f]);
  }
  // Normalize to lowercase so editor getElementById() can always pre-fill on next load.
  // Duplicate ALL_CAPS vs lowercase keys: incomingFields (spread last) wins, which is correct.
  const fields = normalizeKeys({ ...existingFields, ...incomingFields });

  // Build substitution map: field_name → FIELD_NAME
  // Include ALL fields (even empty/null) so {{KEY}} placeholders are always replaced.
  const map = { SLUG: slug };
  for (const [k, v] of Object.entries(fields)) {
    map[k.toUpperCase()] = (v == null) ? '' : String(v).trim();
  }
  map.SLUG = slug; // Request slug wint altijd — website_data mag dit nooit overschrijven

  // Ensure empty service slots clear their {{KEY}} placeholder so React hides them
  for (let i = 1; i <= 8; i++) {
    const key = `DIENST_${i}_TITEL`;
    if (!(key in map)) map[key] = '';
  }
  for (let i = 1; i <= 8; i++) {
    if (!map[`DIENST_${i}_FOTO`]) map[`DIENST_${i}_FOTO`] = '';
  }

  // Clear unset foto placeholders so src="" instead of src="{{FOTO_HERO}}"
  if (!map.FOTO_HERO)      map.FOTO_HERO      = '';
  if (!map.FOTO_WAAROM)    map.FOTO_WAAROM    = '';
  if (!map.FOTO_WERKWIJZE) map.FOTO_WERKWIJZE = '';
  if (!map.FOTO_USP)       map.FOTO_USP       = '';

  // Clear unset project photo and stad placeholders (bigsite template)
  for (let i = 1; i <= 8; i++) {
    if (!map[`FOTO_PROJECT_${i}`]) map[`FOTO_PROJECT_${i}`] = '';
  }
  for (let i = 3; i <= 6; i++) {
    if (!map[`STAD_${i}`]) map[`STAD_${i}`] = '';
  }

  // Derived values
  if (map.KLEUR_PRIMARY) {
    if (/^#[0-9a-fA-F]{6}$/.test(map.KLEUR_PRIMARY)) {
      // Hex color from new editor
      map.KLEUR_PRIMARY_A10      = hexToRgba(map.KLEUR_PRIMARY, '0.1');
      map.KLEUR_PRIMARY_A20      = hexToRgba(map.KLEUR_PRIMARY, '0.2');
      map.KLEUR_PRIMARY_TAILWIND = hexToHslTailwind(map.KLEUR_PRIMARY);
    } else {
      // HSL color from legacy flow
      map.KLEUR_PRIMARY_A20 = hslToHsla(map.KLEUR_PRIMARY, '0.2');
      map.KLEUR_PRIMARY_A10 = hslToHsla(map.KLEUR_PRIMARY, '0.1');
      // Tailwind CSS expects space-separated HSL without hsl() wrapper (e.g. "133 33% 24%")
      map.KLEUR_PRIMARY_TAILWIND = map.KLEUR_PRIMARY
        .replace(/^hsl\(\s*/, '').replace(/\s*\)$/, '').replace(/,\s*/g, ' ');
    }
  }
  // Fix reviews: convert Dutch keys to English, strip outer brackets
  if (map.REVIEWS_JSON) {
    map.REVIEWS_JSON = processReviewsJson(map.REVIEWS_JSON);
  }
  if (map.TELEFOON_DISPLAY) {
    map.TELEFOON_HREF = map.TELEFOON_DISPLAY.replace(/\s+/g, '');
    map.WHATSAPP_HREF = `https://wa.me/${map.TELEFOON_HREF.replace(/^0/, '31')}`;
  }
  if (map.LOGO_URL) {
    map.LOGO_HTML    = `<img src="${map.LOGO_URL}" alt="${map.BEDRIJFSNAAM || slug} logo" style="height:40px;width:auto;max-width:160px;object-fit:contain;">`;
    map.FAVICON_HTML = `<link rel="icon" href="${map.LOGO_URL}">`;
  } else {
    map.LOGO_HTML    = '';
    map.FAVICON_HTML = '';
  }
  map.REVIEWS_DISPLAY = (map.REVIEWS_VISIBLE === '0') ? 'display:none' : '';
  // Dak template uses SVG sprites: <use href="#icon-{{ICON_X}}"/> — expects the icon NAME.
  // If stored value is not a known icon name (e.g. corrupt "/>"), fall back to slot default.
  for (let i = 1; i <= 8; i++) {
    const key = `ICON_${i}`;
    if (map[key] && !ICON_MAP[map[key]]) map[key] = DEFAULT_ICON_NAMES[i - 1];
  }
  const name = map.BEDRIJFSNAAM || slug;
  if (!map.HERO_ALT)    map.HERO_ALT    = `${name} - hero afbeelding`;
  if (!map.SERVICE_ALT) map.SERVICE_ALT = `${name} - service afbeelding`;
  if (!map.WERK_ALT)    map.WERK_ALT    = `${name} - werkfoto`;
  // All footer diensten: always replace so deleted/empty slots render as "" not literal {{DIENST_N}}
  for (let i = 1; i <= 10; i++) {
    if (!map[`DIENST_${i}`]) map[`DIENST_${i}`] = '';
  }

  // Rebuild DIENSTEN_JSON from individual DIENST_N fields so editor field edits always win.
  // The editor may send a stale DIENSTEN_JSON (built from old Supabase column values),
  // but the individual DIENST_N / DIENST_N_DESC / DIENST_N_FOTO fields always reflect the edit.
  {
    const dienstenArr = [];
    for (let i = 1; i <= 8; i++) {
      const naam = map[`DIENST_${i}`] || '';
      const desc = map[`DIENST_${i}_DESC`] || '';
      const foto = map[`DIENST_${i}_FOTO`] || '';
      if (naam) dienstenArr.push({ naam, desc, foto });
    }
    if (dienstenArr.length > 0) map.DIENSTEN_JSON = JSON.stringify(dienstenArr);
    else if (!map.DIENSTEN_JSON) map.DIENSTEN_JSON = '[]'; // prevent {{DIENSTEN_JSON}} being stripped → SyntaxError
  }
  // Prevent {{PROJECTEN_JSON}} being stripped to empty → projecten=; → SyntaxError breaks entire script block
  if (!map.PROJECTEN_JSON) map.PROJECTEN_JSON = '[]';

  // Look up which template set this client uses
  let templateType = templateFromPayload || 'default';
  if (!templateFromPayload) {
    try {
      const tr = await fetch(
        `${SUPABASE_URL}/rest/v1/clients?slug=eq.${encodeURIComponent(slug)}&select=template`,
        { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } },
      );
      if (tr.ok) {
        const rows = await tr.json();
        if (rows[0]?.template) templateType = rows[0].template;
      }
    } catch (_) {}
  }

  // Read templates from repo root
  const root = path.join(__dirname, '..');

  // Look up template config — single source of truth is _template-config.js
  const tplCfg = TEMPLATES[templateType];
  if (!tplCfg) {
    console.error(`[save] Unknown template type "${templateType}" for slug "${slug}" — falling back to "${DEFAULT_TEMPLATE}"`);
  }
  const tpl = tplCfg ?? TEMPLATES[DEFAULT_TEMPLATE];

  if (tpl.isModern && map.LOGO_URL) {
    map.LOGO_HTML = `<img src="${map.LOGO_URL}" alt="${map.BEDRIJFSNAAM || slug} logo" style="height:90px;width:auto;max-width:300px;object-fit:contain;">`;
  }
  if (tpl.isModern && !map.CONTACT_DESC) {
    map.CONTACT_DESC = 'Heeft u een vraag of wilt u een vrijblijvende offerte? Bel, mail of stuur ons een bericht. Wij reageren snel.';
  }
  if (tpl.isModern && !map.PROJECTEN_CTA_LABEL) {
    map.PROJECTEN_CTA_LABEL = 'Uw project als volgende?';
  }
  if (tpl.isModern && !map.PROJECTEN_CTA_TITEL) {
    map.PROJECTEN_CTA_TITEL = 'Benieuwd wat wij voor uw woning kunnen betekenen?';
  }
  if (tpl.isModern && !map.SOCIAL_FACEBOOK)  map.SOCIAL_FACEBOOK  = '#';
  if (tpl.isModern && !map.SOCIAL_INSTAGRAM) map.SOCIAL_INSTAGRAM = '#';
  if (tpl.isModern && !map.SOCIAL_LINKEDIN)  map.SOCIAL_LINKEDIN  = '#';
  if (tpl.isBigsite) {
    for (const prefix of ['STAD_1', 'STAD_2', 'STAD_3', 'STAD_4', 'STAD_5', 'STAD_6']) {
      if (!map[`${prefix}_SECTIE_TITEL`])  map[`${prefix}_SECTIE_TITEL`]  = '';
      if (!map[`${prefix}_SECTIE_BODY`])   map[`${prefix}_SECTIE_BODY`]   = '';
      if (!map[`${prefix}_SECTIE_BODY_2`]) map[`${prefix}_SECTIE_BODY_2`] = '';
    }
  }
  if (tpl.isBigsite && !map.STAD_EYEBROW)   map.STAD_EYEBROW   = 'Uw specialist in de regio';
  if (tpl.isBigsite && !map.STAD_H1_PREFIX)  map.STAD_H1_PREFIX = 'Specialist';
  if (tpl.isBigsite && !map.STAD_INTRO)      map.STAD_INTRO     = '';
  if (tpl.isBigsite && !map.STAD_USP_1)      map.STAD_USP_1     = '';
  if (tpl.isBigsite && !map.STAD_USP_2)      map.STAD_USP_2     = '';
  if (tpl.isBigsite && !map.STAD_USP_3)      map.STAD_USP_3     = '';

  let templates;
  try {
    templates = {};
    for (const s of tpl.pages) {
      const filename = s ? `${slug}${s}.html` : `${slug}.html`;
      templates[filename] = fs.readFileSync(
        path.join(root, `${tpl.prefix}${s}.html`), 'utf8'
      );
    }
    // Bigsite: load dynamic dienst pages based on stored PAGINA_DIENST_N_SLUG + DIENST_N
    if (tpl.isBigsite) {
      for (let n = 1; n <= tpl.dienstCount; n++) {
        const dienstNaam = map[`DIENST_${n}`];
        const dienstSlug = map[`PAGINA_DIENST_${n}_SLUG`];
        if (!dienstNaam || !dienstSlug) continue;
        const tplFile = path.join(root, `template-bigsite-dienst-${n}.html`);
        if (!fs.existsSync(tplFile)) continue;
        templates[`${slug}-${dienstSlug}.html`] = fs.readFileSync(tplFile, 'utf8');
      }
      // Bigsite: stad pages 3-6 get URLs based on the city name (e.g. "Doorn" → "{slug}-doorn.html")
      for (let n = 3; n <= 6; n++) {
        const stad = map[`STAD_${n}`];
        if (!stad) continue;
        const stadSlug = stad.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        map[`PAGINA_STAD_${n}_SLUG`] = stadSlug;
        const tplFile = path.join(root, `template-bigsite-stad-${n}.html`);
        if (!fs.existsSync(tplFile)) continue;
        templates[`${slug}-${stadSlug}.html`] = fs.readFileSync(tplFile, 'utf8');
      }
    }
  } catch (e) {
    return res.status(500).json({ error: `Template read failed: ${e.message}` });
  }

  // Embed merged field data as a hidden comment so future loads can extract it
  const cmsComment = `<!-- gowebbo-cms: ${JSON.stringify(fields)} -->\n`;

  // Generate HTML — prepend comment then apply placeholder substitution
  const generated = {};
  for (const [filename, tpl] of Object.entries(templates)) {
    generated[filename] = cmsComment + applyMap(tpl, map);
  }

  // Save merged field values to Supabase (non-fatal)
  try {
    const sbRes = await fetch(`${SUPABASE_URL}/rest/v1/client_content`, {
      method: 'POST',
      headers: {
        apikey:         SUPABASE_KEY,
        Authorization:  `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        Prefer:         'resolution=merge-duplicates',
      },
      body: JSON.stringify({ slug, data: fields, updated_at: new Date().toISOString() }),
    });
    if (!sbRes.ok) {
      const sbErr = await sbRes.text().catch(() => sbRes.status);
      console.error(`Supabase save failed (${sbRes.status}):`, sbErr);
    }
  } catch (e) {
    console.error('Supabase save failed (non-fatal):', e.message);
  }

  // Update klanten.website_data so gowebbo-studio editor reloads the correct state (non-fatal)
  try {
    const klRes = await fetch(
      `${SUPABASE_URL}/rest/v1/klanten?slug=eq.${encodeURIComponent(slug)}`,
      {
        method: 'PATCH',
        headers: {
          apikey:         SUPABASE_KEY,
          Authorization:  `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ website_data: incomingFields }),
      },
    );
    if (!klRes.ok) {
      const klErr = await klRes.text().catch(() => klRes.status);
      console.error(`Supabase klanten update failed (${klRes.status}):`, klErr);
    }
  } catch (e) {
    console.error('Supabase klanten update failed (non-fatal):', e.message);
  }

  // Commit all 4 files to GitHub
  try {
    for (const [filename, content] of Object.entries(generated)) {
      await githubUpsert(token, `public/${filename}`, content);
    }
  } catch (e) {
    console.error('GitHub commit failed:', e.message);
    return res.status(500).json({ error: e.message });
  }

  // Ook opslaan in gowebbo-klanten (non-fataal) — dekt alle gegenereerde pagina's incl. bigsite
  // dienst/stad pagina's. Asset paden worden omgezet naar absolute CDN-URL zodat ze op een
  // eigen domein blijven werken.
  try {
    for (const [filename, content] of Object.entries(generated)) {
      const klantPath = filename === `${slug}.html`
        ? `${slug}/index.html`
        : `${slug}/${filename.slice(slug.length + 1)}`; // strip "{slug}-" prefix
      const transformed = content
        .split('href="/assets/').join(`href="${BASE_URL}/assets/`)
        .split('src="/assets/').join(`src="${BASE_URL}/assets/`);
      await githubUpdateIfExists(token, klantPath, transformed, KLANTEN_REPO);
    }
  } catch (e) {
    console.error('gowebbo-klanten commit failed (non-fatal):', e.message);
  }

  return res.status(200).json({ ok: true, slug, files: Object.keys(generated) });
};
