const fs   = require('fs');
const path = require('path');
const { extractHomeFields, extractContactFields, extractDienstenFields, extractOverOnsFields } = require('./_extract');

const REPO         = 'maxveer4/preview';
const KLANTEN_REPO = 'maxveer4/gowebbo-klanten';
const BRANCH       = 'main';
const BASE_URL     = 'https://preview.gowebbo.io';
const SUPABASE_URL = 'https://agdwnlqiepnmxwkrpzqv.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFnZHdubHFpZXBubXh3a3JwenF2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwNzM4MzAsImV4cCI6MjA5MTY0OTgzMH0.bSw1y5gvVGg1C02AFU-bbfq4rSmy99APILktrlPIf2Y';

// Replace all {{KEY}} occurrences using plain split/join
function applyMap(template, map) {
  let out = template;
  for (const [key, val] of Object.entries(map)) {
    out = out.split(`{{${key}}}`).join(val == null ? '' : String(val));
  }
  return out;
}

// "hsl(142,72%,38%)" → "hsla(142,72%,38%,0.2)"
function hslToHsla(hsl, alpha) {
  return hsl.trim().replace(/^hsl\(/, 'hsla(').replace(/\)$/, `,${alpha})`);
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
      if (rows[0]?.data) return rows[0].data;
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
  return {
    ...extractHomeFields(homeHtml),
    ...extractContactFields(contactHtml),
    ...extractDienstenFields(dienstenHtml),
    ...extractOverOnsFields(overOnsHtml),
  };
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

  const getRes  = await fetch(url, { headers });
  const existing = getRes.ok ? await getRes.json() : null;

  const body = {
    message: `Update ${filePath} via CMS editor`,
    content: Buffer.from(content).toString('base64'),
    branch:  BRANCH,
  };
  if (existing?.sha) body.sha = existing.sha;

  const putRes = await fetch(url, { method: 'PUT', headers, body: JSON.stringify(body) });
  if (!putRes.ok) {
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

  const { slug, ...incomingFields } = req.body || {};
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
  const fields = { ...existingFields, ...incomingFields };

  // Build substitution map: field_name → FIELD_NAME
  const map = { SLUG: slug };
  for (const [k, v] of Object.entries(fields)) {
    if (v !== null && v !== undefined && String(v).trim() !== '') {
      map[k.toUpperCase()] = String(v).trim();
    }
  }

  // Derived values
  if (map.KLEUR_PRIMARY) {
    map.KLEUR_PRIMARY_A20 = hslToHsla(map.KLEUR_PRIMARY, '0.2');
    map.KLEUR_PRIMARY_A10 = hslToHsla(map.KLEUR_PRIMARY, '0.1');
  }
  if (map.TELEFOON_DISPLAY) {
    map.TELEFOON_HREF = map.TELEFOON_DISPLAY.replace(/\s+/g, '');
    map.WHATSAPP_HREF = map.TELEFOON_HREF.replace(/^0/, '31');
  }
  if (map.LOGO_URL) {
    map.LOGO_HTML    = `<img src="${map.LOGO_URL}" alt="${map.BEDRIJFSNAAM || slug} logo" style="height:40px;width:auto;max-width:160px;object-fit:contain;">`;
    map.FAVICON_HTML = `<link rel="icon" href="${map.LOGO_URL}">`;
  } else {
    map.FAVICON_HTML = '';
  }
  map.REVIEWS_DISPLAY = (map.REVIEWS_VISIBLE === '0') ? 'display:none' : '';
  const name = map.BEDRIJFSNAAM || slug;
  if (!map.HERO_ALT)    map.HERO_ALT    = `${name} - hero afbeelding`;
  if (!map.SERVICE_ALT) map.SERVICE_ALT = `${name} - service afbeelding`;
  if (!map.WERK_ALT)    map.WERK_ALT    = `${name} - werkfoto`;
  // Optional footer diensten: always replace so empty slots are hidden by CSS
  if (!map.DIENST_5) map.DIENST_5 = '';
  if (!map.DIENST_6) map.DIENST_6 = '';

  // Look up which template set this client uses
  let templateType = 'default';
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

  // Read templates from repo root
  const root = path.join(__dirname, '..');

  // Map template type → file prefix and page suffixes
  const TEMPLATE_CONFIGS = {
    default: {
      prefix:   'template',
      suffixes: ['', '-contact', '-diensten', '-over-ons'],
    },
    dak: {
      prefix:   'template-dak',
      suffixes: ['', '-contact', '-diensten', '-over-ons', '-projecten'],
    },
  };
  const tplCfg = TEMPLATE_CONFIGS[templateType] ?? TEMPLATE_CONFIGS.default;

  let templates;
  try {
    templates = {};
    for (const s of tplCfg.suffixes) {
      const filename = s ? `${slug}${s}.html` : `${slug}.html`;
      templates[filename] = fs.readFileSync(
        path.join(root, `${tplCfg.prefix}${s || ''}.html`), 'utf8'
      );
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
    await fetch(`${SUPABASE_URL}/rest/v1/client_content`, {
      method: 'POST',
      headers: {
        apikey:         SUPABASE_KEY,
        Authorization:  `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        Prefer:         'resolution=merge-duplicates',
      },
      body: JSON.stringify({ slug, data: fields, updated_at: new Date().toISOString() }),
    });
  } catch (e) {
    console.error('Supabase save failed (non-fatal):', e.message);
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

  // Ook opslaan in gowebbo-klanten (non-fataal)
  const klantenMap = {
    [`${slug}.html`]:            `${slug}/index.html`,
    [`${slug}-contact.html`]:    `${slug}/contact.html`,
    [`${slug}-diensten.html`]:   `${slug}/diensten.html`,
    [`${slug}-over-ons.html`]:   `${slug}/over-ons.html`,
    [`${slug}-projecten.html`]:  `${slug}/projecten.html`,
  };
  try {
    for (const [oldName, newPath] of Object.entries(klantenMap)) {
      if (generated[oldName]) {
        await githubUpdateIfExists(token, newPath, generated[oldName], KLANTEN_REPO);
      }
    }
  } catch (e) {
    console.error('gowebbo-klanten commit failed (non-fatal):', e.message);
  }

  return res.status(200).json({ ok: true, slug, files: Object.keys(generated) });
};
