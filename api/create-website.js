const REPO        = 'maxveer4/preview';
const BRANCH      = 'main';
const SUPABASE_URL = 'https://agdwnlqiepnmxwkrpzqv.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFnZHdubHFpZXBubXh3a3JwenF2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwNzM4MzAsImV4cCI6MjA5MTY0OTgzMH0.bSw1y5gvVGg1C02AFU-bbfq4rSmy99APILktrlPIf2Y';
const STOCK_BASE  = 'https://agdwnlqiepnmxwkrpzqv.supabase.co/storage/v1/object/public/stockfotos';
const GHL_URL     = 'https://services.leadconnectorhq.com/hooks/cBpKffr120uYK9k2aD5m/webhook-trigger/ad5ce8f7-1f45-48b6-9045-0909c7c555fa';

// ── Template configs ──────────────────────────────────────────────────────────
const TEMPLATE_CONFIGS = {
  preview: {
    homepage: 'template.html',
    contact:  'template-contact.html',
    diensten: 'template-diensten.html',
    over_ons: 'template-over-ons.html',
    projecten: null,
  },
  'dak-masterpiece': {
    homepage: 'template-dak.html',
    contact:  'template-dak-contact.html',
    diensten: 'template-dak-diensten.html',
    over_ons: 'template-dak-over-ons.html',
    projecten: 'template-dak-projecten.html',
  },
  modern: {
    homepage: 'template-modern.html',
    contact:  'template-modern-contact.html',
    diensten: 'template-modern-diensten.html',
    over_ons: 'template-modern-over-ons.html',
    projecten: 'template-modern-projecten.html',
  },
  bigsite: {
    homepage:  'template-bigsite.html',
    dienst_1:  'template-bigsite-dienst-1.html',
    dienst_2:  'template-bigsite-dienst-2.html',
    dienst_3:  'template-bigsite-dienst-3.html',
    dienst_4:  'template-bigsite-dienst-4.html',
    dienst_5:  'template-bigsite-dienst-5.html',
    dienst_6:  'template-bigsite-dienst-6.html',
    contact:   'template-bigsite-contact.html',
    over_ons:  'template-bigsite-over-ons.html',
    projecten: 'template-bigsite-projecten.html',
    werkgebied:'template-bigsite-werkgebied.html',
    ede:       'template-bigsite-ede.html',
    wageningen:'template-bigsite-wageningen.html',
  },
};

// Maps template config key → output filename suffix
// dienst_N use placeholder slugs; overridden per-request after ai response
const PAGE_SLUG = {
  homepage:   s => `${s}.html`,
  contact:    s => `${s}-contact.html`,
  diensten:   s => `${s}-diensten.html`,
  over_ons:   s => `${s}-over-ons.html`,
  projecten:  s => `${s}-projecten.html`,
  dienst_1:   s => `${s}-dienst-1.html`,
  dienst_2:   s => `${s}-dienst-2.html`,
  dienst_3:   s => `${s}-dienst-3.html`,
  dienst_4:   s => `${s}-dienst-4.html`,
  dienst_5:   s => `${s}-dienst-5.html`,
  dienst_6:   s => `${s}-dienst-6.html`,
  werkgebied: s => `${s}-werkgebied.html`,
  ede:        s => `${s}-ede.html`,
  wageningen: s => `${s}-wageningen.html`,
};

const COLOR_MAP = {
  geel:  { p: 'hsl(45,95%,50%)',   a20: 'hsla(45,95%,50%,0.2)',   a10: 'hsla(45,95%,50%,0.1)',  tw: '45 95% 50%'   },
  groen: { p: 'hsl(142,72%,38%)',  a20: 'hsla(142,72%,38%,0.2)',  a10: 'hsla(142,72%,38%,0.1)', tw: '142 72% 38%'  },
  rood:  { p: 'hsl(0,72%,50%)',    a20: 'hsla(0,72%,50%,0.2)',    a10: 'hsla(0,72%,50%,0.1)',   tw: '0 72% 50%'    },
  blauw: { p: 'hsl(213,76%,52%)',  a20: 'hsla(213,76%,52%,0.2)',  a10: 'hsla(213,76%,52%,0.1)', tw: '213 76% 52%'  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeSlug(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function applyMap(template, map) {
  let out = template;
  for (const [key, val] of Object.entries(map)) {
    out = out.split(`{{${key}}}`).join(val == null ? '' : String(val));
  }
  return out;
}

async function fetchTemplate(filename) {
  const url = `https://raw.githubusercontent.com/${REPO}/${BRANCH}/${filename}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Template fetch failed: ${filename} (${r.status})`);
  return r.text();
}

async function githubUpsert(token, filePath, content) {
  const url     = `https://api.github.com/repos/${REPO}/contents/${filePath}`;
  const headers = {
    Authorization: `token ${token}`,
    'Content-Type': 'application/json',
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'gowebbo-create/1.0',
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    const getRes  = await fetch(url, { headers });
    const existing = getRes.ok ? await getRes.json() : null;
    const body = {
      message: `Create website for ${filePath}`,
      content: Buffer.from(content).toString('base64'),
      branch: BRANCH,
    };
    if (existing?.sha) body.sha = existing.sha;
    const putRes = await fetch(url, { method: 'PUT', headers, body: JSON.stringify(body) });
    if (putRes.ok) return;
    const errBody = await putRes.text();
    console.error(`[githubUpsert] attempt=${attempt} status=${putRes.status} path=${filePath} body=${errBody}`);
    if ((putRes.status === 409 || putRes.status === 422) && attempt === 0) continue;
    throw new Error(`GitHub ${putRes.status} for ${filePath}: ${errBody}`);
  }
}

function buildPrompt(bedrijfsnaam, sector, dienstenNamen, stad, display, email, isModern, isBigsite) {
  const modernExtra = isModern ? `
  "TRUST_4_TITEL": "Vierde vertrouwenskolom titel (2-4 woorden)",
  "TRUST_4_DESC": "Uitleg bij vierde vertrouwenskolom (1 zin, max 15 woorden)",
  "PROJECTEN_JSON": [{"foto":"","titel":"realistisch projecttitel passend bij sector","categorie":"dienstcategorie","locatie":"gemeente in werkgebied","desc":"korte projectomschrijving max 15 woorden"},{"foto":"","titel":"...","categorie":"...","locatie":"...","desc":"..."},{"foto":"","titel":"...","categorie":"...","locatie":"...","desc":"..."},{"foto":"","titel":"...","categorie":"...","locatie":"...","desc":"..."}],` : '';

  // Generate page content fields for each existing dienst (1 up to N)
  const bigsiteExtra = isBigsite ? dienstenNamen.slice(0, 6).map((naam, i) => {
    const n = i + 1;
    return `
  "PAGINA_DIENST_${n}_H1": "Paginatitel voor '${naam}' (max 6 woorden, krachtige h1)",
  "PAGINA_DIENST_${n}_INTRO": "Hero intro tekst voor '${naam}' pagina (1-2 zinnen, max 30 woorden)",
  "PAGINA_DIENST_${n}_H2": "Content sectie koptekst voor '${naam}' (max 8 woorden, bijv. 'Waarom kiezen voor...')",
  "PAGINA_DIENST_${n}_BODY": "Content sectie body voor '${naam}' (3-4 zinnen, max 70 woorden, overtuigend)",`;
  }).join('') : '';

  return `Genereer alle websiteteksten voor dit bedrijf:

Bedrijfsnaam: ${bedrijfsnaam}
Sector: ${sector}
Diensten: ${dienstenNamen.join(', ')}
Stad/regio: ${stad}
Telefoon: ${display}
E-mail: ${email}

Geef een JSON object terug met EXACT deze velden:

{
  "SEO_TITLE": "Paginatitel voor Google (max 60 tekens)",
  "SEO_DESCRIPTION": "Meta description (max 155 tekens) met call-to-action",
  "HERO_EYEBROW": "Tagline boven H1 (max 6 woorden)",
  "HERO_TITLE": "Krachtige H1 (max 8 woorden) — omsluit exact één sleutelwoord met *sterretjes* voor gouden markering, bv: 'Vakkundig *schilderwerk* voor uw woning.'",
  "HERO_DESC": "Hero beschrijving (1-2 zinnen, max 30 woorden)",
  "HERO_ALT": "Alt-tekst hero foto (max 8 woorden)",
  "USP_1": "Eerste USP bullet (max 6 woorden)",
  "USP_2": "Tweede USP bullet (max 6 woorden)",
  "USP_3": "Derde USP bullet (max 6 woorden)",
  "TRUST_DESC": "Intro vertrouwenssectie (max 20 woorden)",
  "TRUST_1_TITEL": "Trust 1 titel (2-4 woorden)",
  "TRUST_1_DESC": "Trust 1 beschrijving (1 zin, max 15 woorden)",
  "TRUST_2_TITEL": "Trust 2 titel (2-4 woorden)",
  "TRUST_2_DESC": "Trust 2 beschrijving (1 zin, max 15 woorden)",
  "TRUST_3_TITEL": "Trust 3 titel (2-4 woorden)",
  "TRUST_3_DESC": "Trust 3 beschrijving (1 zin, max 15 woorden)",${modernExtra}
  "SERVICE_TITLE": "Sectietitel diensten (4-7 woorden) — omsluit één sleutelwoord met *sterretjes*, bv: 'Voor al uw *schilderwerk*.'",
  "SERVICE_DESC": "Hoofddienst beschrijving (5-6 zinnen, overtuigend)",${isBigsite ? `
  "SERVICE_DESC_2": "Tweede alinea over de diensten (3-4 zinnen, max 60 woorden, aanvullend op SERVICE_DESC)",${bigsiteExtra}` : ''}
  "SERVICE_ALT": "Alt-tekst dienstenfoto (max 6 woorden)",
  "WHY_DESC": "Intro waarom-sectie (max 25 woorden)",
  "WHY_1_TITEL": "Voordeel 1 titel (2-4 woorden)", "WHY_1_DESC": "Voordeel 1 (1 zin, max 15 woorden)",
  "WHY_2_TITEL": "Voordeel 2 titel (2-4 woorden)", "WHY_2_DESC": "Voordeel 2 (1 zin, max 15 woorden)",
  "WHY_3_TITEL": "Voordeel 3 titel (2-4 woorden)", "WHY_3_DESC": "Voordeel 3 (1 zin, max 15 woorden)",
  "WHY_4_TITEL": "Voordeel 4 titel (2-4 woorden)", "WHY_4_DESC": "Voordeel 4 (1 zin, max 15 woorden)",
  "WERK_TITLE": "Sectietitel werkwijze (4-7 woorden)",
  "WERK_DESC_1": "Werkwijze alinea 1 (2-3 zinnen, max 45 woorden)",
  "WERK_DESC_2": "Werkwijze alinea 2 (1-2 zinnen, max 30 woorden)",
  "WERK_ALT": "Alt-tekst werkwijzefoto (max 6 woorden)",
  "STAPPEN_TITLE": "Titel boven stappen (4-7 woorden)",
  "STAP_1_TITEL": "Stap 1 (2-4 woorden)", "STAP_1_DESC": "Stap 1 uitleg (max 20 woorden)",
  "STAP_2_TITEL": "Stap 2 (2-4 woorden)", "STAP_2_DESC": "Stap 2 uitleg (max 20 woorden)",
  "STAP_3_TITEL": "Stap 3 (2-4 woorden)", "STAP_3_DESC": "Stap 3 uitleg (max 20 woorden)",
  "STAP_4_TITEL": "Stap 4 (2-4 woorden)", "STAP_4_DESC": "Stap 4 uitleg (max 20 woorden)",
  "VAKMANSCHAP_DESC": "Afsluitende alinea vakmanschap (2-3 zinnen, max 50 woorden)",
  "CTA_TITEL": "Call-to-action titel (max 8 woorden)",
  "CTA_DESC": "CTA ondersteuning (1 zin, max 15 woorden)",
  "STAD_1": "Eerste werkgebied gemeente rondom ${stad}",
  "STAD_2": "Tweede gemeente", "STAD_3": "Derde gemeente",
  "STAD_4": "Vierde gemeente", "STAD_5": "Vijfde gemeente", "STAD_6": "Zesde gemeente",
  "OVER_ONS_HERO_DESC": "Subtitel over-ons hero (max 10 woorden)",
  "OVER_ONS_INTRO_P1": "Over het bedrijf alinea 1 (2-3 zinnen, max 50 woorden)",
  "OVER_ONS_INTRO_P2": "Werkwijze en aanpak alinea 2 (2-3 zinnen, max 40 woorden)",
  "OVER_ONS_INTRO_P3": "Missie alinea 3 (1-2 zinnen, max 30 woorden)",
  "OVER_ONS_WAARDE_1_TITEL": "Kernwaarde 1 (2-3 woorden)", "OVER_ONS_WAARDE_1_DESC": "Kernwaarde 1 uitleg (max 12 woorden)",
  "OVER_ONS_WAARDE_2_TITEL": "Kernwaarde 2 (2-3 woorden)", "OVER_ONS_WAARDE_2_DESC": "Kernwaarde 2 uitleg (max 12 woorden)",
  "OVER_ONS_WAARDE_3_TITEL": "Kernwaarde 3 (2-3 woorden)", "OVER_ONS_WAARDE_3_DESC": "Kernwaarde 3 uitleg (max 12 woorden)",
  "OVER_ONS_WAARDE_4_TITEL": "Kernwaarde 4 (2-3 woorden)", "OVER_ONS_WAARDE_4_DESC": "Kernwaarde 4 uitleg (max 12 woorden)",
  "OVER_ONS_CTA_DESC": "CTA tekst over-ons pagina (max 15 woorden)",
  "CONTACT_HERO_DESC": "Subtitel contact hero (max 10 woorden)",
  "DIENSTEN_HERO_DESC": "Intro diensten pagina (max 20 woorden)",
  "DIENSTEN_CTA_TITEL": "CTA titel diensten pagina (max 10 woorden)",
  "DIENSTEN_CTA_DESC": "CTA beschrijving diensten pagina (max 20 woorden)",
  "DIENST_1_DESC": "Beschrijving over '${dienstenNamen[0] || ''}' (3-4 zinnen, max 60 woorden)",
  "DIENST_2_DESC": "Beschrijving over '${dienstenNamen[1] || ''}' (3-4 zinnen, max 60 woorden)",
  "DIENST_3_DESC": "Beschrijving over '${dienstenNamen[2] || ''}' (3-4 zinnen, max 60 woorden)",
  "DIENST_4_DESC": "Beschrijving over '${dienstenNamen[3] || ''}' (3-4 zinnen, max 60 woorden)",
  "DIENST_5_DESC": "Beschrijving over '${dienstenNamen[4] || ''}' (3-4 zinnen, max 60 woorden)",
  "DIENST_6_DESC": "Beschrijving over '${dienstenNamen[5] || ''}' (3-4 zinnen, max 60 woorden)",
  "PROJECTEN_HERO_DESC": "Intro projecten pagina (max 20 woorden)",
  "PROJECTEN_CTA_TITEL": "CTA titel projecten pagina (max 6 woorden)",
  "PROJECTEN_CTA_DESC": "CTA tekst projecten pagina (max 20 woorden)",
  "REVIEWS_JSON": [
    {"naam":"Voornaam A.","stad":"Plaatsnaam","tekst":"Reviewtekst 2-3 zinnen.","datum":"1 maand geleden","score":5},
    {"naam":"Voornaam B.","stad":"Plaatsnaam","tekst":"Reviewtekst 2-3 zinnen.","datum":"2 weken geleden","score":5},
    {"naam":"Voornaam C.","stad":"Plaatsnaam","tekst":"Reviewtekst 2-3 zinnen.","datum":"3 weken geleden","score":5},
    {"naam":"Voornaam D.","stad":"Plaatsnaam","tekst":"Reviewtekst 2-3 zinnen.","datum":"1 week geleden","score":5},
    {"naam":"Voornaam E.","stad":"Plaatsnaam","tekst":"Reviewtekst 2-3 zinnen.","datum":"2 maanden geleden","score":5},
    {"naam":"Voornaam F.","stad":"Plaatsnaam","tekst":"Reviewtekst 2-3 zinnen.","datum":"4 weken geleden","score":5}
  ]
}

BELANGRIJK: geef ALLEEN het JSON object, geen uitleg of markdown. REVIEWS_JSON is een array van 6 objecten. Steden zijn echte gemeenten rondom ${stad}. Gebruik NOOIT gedachtestreepjes. Spreek altijd namens het bedrijf, nooit op naam van de contactpersoon.`;
}

// ── Main handler ──────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  const d        = req.body || {};
  const dry_run  = !!d.dry_run;
  const token    = process.env.GITHUB_TOKEN;
  const apiKey   = process.env.ANTHROPIC_API_KEY;
  if (!apiKey)             return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });
  if (!dry_run && !token)  return res.status(500).json({ error: 'GITHUB_TOKEN not set' });

  const bedrijfsnaam       = d.bedrijfsnaam || '';
  const naam_contactpersoon = d.naam_contactpersoon || '';
  const telefoon            = d.telefoon || '';
  const email               = d.email || '';
  const beroep              = d.beroep || d.sector || '';
  const dienstenRaw         = d.diensten || d.Diensten || '';
  const stad                = d.stad || '';
  const template_keuze      = d.template_keuze || 'preview';
  const kleur_thema         = d.kleur_thema || 'blauw';
  const foto_logo           = d.foto_logo || '';
  const adres_straat        = d.adres_straat || '';
  const adres_postcode_stad = d.adres_postcode_stad || '';
  const kvk                 = d.kvk || '';
  const maps_url            = d.maps_url || '';

  if (!bedrijfsnaam) return res.status(400).json({ error: 'bedrijfsnaam is required' });

  // ── Derived values ────────────────────────────────────────────────────────
  const slug       = makeSlug(bedrijfsnaam);
  const kleur      = COLOR_MAP[kleur_thema.toLowerCase()] || COLOR_MAP.blauw;
  const digits     = telefoon.replace(/\D/g, '');
  const display    = digits.length === 10
    ? digits.replace(/(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/, '$1 $2 $3 $4 $5')
    : digits;
  const beroepSlug = makeSlug(beroep);
  const isModern   = template_keuze === 'modern';
  const isBigsite  = template_keuze === 'bigsite';

  const fotoHero      = d.foto_hero    || `${STOCK_BASE}/${beroepSlug}/hero/${beroepSlug}-hero-1.jpeg`;
  const fotoWaarom    = d.foto_sectie2 || `${STOCK_BASE}/${beroepSlug}/waarom/${beroepSlug}-waarom-1.jpeg`;
  const fotoUsp       = `${STOCK_BASE}/${beroepSlug}/sectie2/${beroepSlug}-sectie2-1.jpeg`;
  const fotoWerkwijze = `${STOCK_BASE}/${beroepSlug}/werkwijze/${beroepSlug}-werkwijze-1.jpeg`;

  const dienstenNamen = Array.isArray(dienstenRaw)
    ? dienstenRaw.map(x => String(x).trim()).filter(Boolean)
    : String(dienstenRaw).split(',').map(x => x.trim()).filter(Boolean);

  const logoHtml = foto_logo
    ? `<img src="${foto_logo}" alt="${bedrijfsnaam} logo" style="height:${isModern ? '90px' : '40px'};width:auto;max-width:${isModern ? '300px' : '160px'};object-fit:contain">`
    : `<span style="font-weight:700;font-size:1.25rem">${bedrijfsnaam}</span>`;

  const tplConfig = TEMPLATE_CONFIGS[template_keuze] || TEMPLATE_CONFIGS.preview;

  // ── Fetch templates + call Claude in parallel (saves ~0.5–1s) ────────────
  const templates = {};
  let ai = {};
  try {
    const claudePromise = fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json',
      },
      body: JSON.stringify({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: isBigsite ? 8000 : 4000,
        system:     'Je bent een professionele Nederlandse webtekstschrijver. Je antwoordt UITSLUITEND met een geldig JSON object — geen uitleg, geen markdown, geen codeblokken.',
        messages:   [{ role: 'user', content: buildPrompt(bedrijfsnaam, beroep, dienstenNamen, stad, display, email, isModern, isBigsite) }],
      }),
    });

    const templatePromise = Promise.all(
      Object.entries(tplConfig)
        .filter(([, filename]) => !!filename)
        .map(async ([key, filename]) => {
          templates[key] = await fetchTemplate(filename);
        })
    );

    const [claudeRes] = await Promise.all([claudePromise, templatePromise]);

    if (!claudeRes.ok) throw new Error(`Anthropic ${claudeRes.status}: ${await claudeRes.text()}`);
    const raw     = (await claudeRes.json()).content?.[0]?.text || '';
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
    ai = JSON.parse(cleaned);

    // Converteer *accentwoord* → <span class="accent"> voor static HTML templates.
    // Bigsite is React-based: HTML in GOWEBBO_DATA breekt de JS syntax (dubbele aanhalingstekens
    // in class="accent" termineren de string). Strip de markers daar gewoon.
    const accentFields = ['HERO_TITLE', 'SERVICE_TITLE'];
    for (const field of accentFields) {
      if (ai[field]) {
        if (isBigsite) {
          ai[field] = ai[field].replace(/\*([^*]+)\*/g, '$1');
        } else {
          ai[field] = ai[field].replace(/\*([^*]+)\*/g, '<span class="accent">$1</span>');
        }
      }
    }
  } catch (e) {
    return res.status(500).json({ error: `Content generation failed: ${e.message}` });
  }

  // ── Build DIENSTEN_JSON ───────────────────────────────────────────────────
  const dienstenJson = dienstenNamen.map((naam, i) => ({
    naam,
    desc: ai[`DIENST_${i + 1}_DESC`] || '',
    foto: naam ? `${STOCK_BASE}/${beroepSlug}/diensten/${naam}/${naam}-1.jpeg` : '',
  }));

  // ── Build REVIEWS_JSON (strip outer brackets — template wraps in [...]) ───
  const reviewsArr         = Array.isArray(ai.REVIEWS_JSON) ? ai.REVIEWS_JSON : [];
  const reviewsForTemplate = JSON.stringify(reviewsArr).slice(1, -1);

  // ── Build PROJECTEN_JSON (full array — template uses directly) ────────────
  let projectenJson = '[]';
  if (ai.PROJECTEN_JSON) {
    projectenJson = Array.isArray(ai.PROJECTEN_JSON)
      ? JSON.stringify(ai.PROJECTEN_JSON)
      : String(ai.PROJECTEN_JSON);
  }

  // ── Build placeholder map ─────────────────────────────────────────────────
  // Spread all AI string fields first, then override with computed values
  const aiTextFields = Object.fromEntries(
    Object.entries(ai).filter(([, v]) => typeof v === 'string' || typeof v === 'number')
  );

  const dienstFotos = Object.fromEntries(
    dienstenNamen.map((naam, i) => [
      `DIENST_${i + 1}_FOTO`,
      naam ? `${STOCK_BASE}/${beroepSlug}/diensten/${naam}/${naam}-1.jpeg` : '',
    ])
  );

  const map = {
    ...aiTextFields,         // all AI-generated text (SEO_TITLE, HERO_TITLE, etc.)

    // Core identity
    SLUG:                slug,
    BEDRIJFSNAAM:        bedrijfsnaam,
    LOGO_URL:            foto_logo,
    LOGO_HTML:           logoHtml,
    FAVICON_HTML:        foto_logo ? `<link rel="icon" href="${foto_logo}">` : '',

    // Colors
    KLEUR_PRIMARY:          kleur.p,
    KLEUR_PRIMARY_A20:      kleur.a20,
    KLEUR_PRIMARY_A10:      kleur.a10,
    KLEUR_PRIMARY_TAILWIND: kleur.tw,

    // Contact
    TELEFOON_DISPLAY:    display,
    TELEFOON_HREF:       digits,
    EMAIL:               email,
    WHATSAPP_HREF:       `https://wa.me/31${digits.replace(/^0/, '')}`,
    ADRES_STRAAT:        adres_straat,
    ADRES_POSTCODE_STAD: adres_postcode_stad,
    KVK:                 kvk,
    MAPS_URL:            maps_url,

    // Photos
    FOTO_HERO:           fotoHero,
    FOTO_WAAROM:         fotoWaarom,
    FOTO_USP:            fotoUsp,
    FOTO_WERKWIJZE:      fotoWerkwijze,

    // Services
    DIENST_1: dienstenNamen[0] || '',
    DIENST_2: dienstenNamen[1] || '',
    DIENST_3: dienstenNamen[2] || '',
    DIENST_4: dienstenNamen[3] || '',
    DIENST_5: dienstenNamen[4] || '',
    DIENST_6: dienstenNamen[5] || '',
    ...dienstFotos,

    // Project photos (bigsite only — empty at creation, editor fills in later)
    FOTO_PROJECT_1: '', FOTO_PROJECT_2: '', FOTO_PROJECT_3: '', FOTO_PROJECT_4: '',
    FOTO_PROJECT_5: '', FOTO_PROJECT_6: '', FOTO_PROJECT_7: '', FOTO_PROJECT_8: '',

    // Bigsite dienst page slugs — computed from dienst names (no Claude needed)
    ...Object.fromEntries(
      Array.from({ length: 6 }, (_, i) => [
        `PAGINA_DIENST_${i + 1}_SLUG`,
        makeSlug(dienstenNamen[i] || ''),
      ])
    ),

    // JSON data
    DIENSTEN_JSON:  JSON.stringify(dienstenJson),
    REVIEWS_JSON:   isBigsite
      ? JSON.stringify(reviewsArr).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
      : reviewsForTemplate,
    PROJECTEN_JSON: projectenJson,

    // Conditional / UI
    HIDE_PROJECTEN:   tplConfig.projecten ? '' : 'display:none',
    REVIEWS_DISPLAY:  '',

    // Forms (empty at creation — editor fills these in later)
    OFFERTE_WEBHOOK:      '',
    FORMULIER_WEBHOOK:    '',
    MODAL_OFFERTE_IFRAME: '',
    MODAL_ADVIES_IFRAME:  '',
  };

  // ── Apply map to all templates ────────────────────────────────────────────
  // For bigsite, override dienst_N slugs (computed from makeSlug of dienst name)
  // and skip dienst pages that don't have an actual dienst for that slot.
  const pageSlugFns = isBigsite
    ? {
        ...PAGE_SLUG,
        ...Object.fromEntries(
          Array.from({ length: 6 }, (_, i) => {
            const n = i + 1;
            const dslug = makeSlug(dienstenNamen[i] || '') || `dienst-${n}`;
            return [`dienst_${n}`, s => `${s}-${dslug}.html`];
          })
        ),
      }
    : PAGE_SLUG;

  const generated = {};
  for (const [key, html] of Object.entries(templates)) {
    // Skip bigsite dienst pages where no dienst name exists
    const dienstMatch = key.match(/^dienst_(\d+)$/);
    if (isBigsite && dienstMatch) {
      const n = parseInt(dienstMatch[1]);
      if (!dienstenNamen[n - 1]) continue;
    }
    generated[(pageSlugFns[key] || PAGE_SLUG[key])(slug)] = applyMap(html, map);
  }

  // ── dry_run: return HTML without any side effects ────────────────────────
  if (dry_run) {
    return res.status(200).json({
      ok:      true,
      dry_run: true,
      slug,
      files:   Object.keys(generated),
      html:    generated,
    });
  }

  // ── Push all files to GitHub sequentially (avoids SHA race conditions on updates) ──
  const fileList = Object.keys(generated);
  console.log(`[create-website] Pushing ${fileList.length} files: ${fileList.join(', ')}`);
  try {
    for (const [filename, content] of Object.entries(generated)) {
      console.log(`[create-website] Committing ${filename}...`);
      await githubUpsert(token, `public/${filename}`, content);
      console.log(`[create-website] Done: ${filename}`);
    }
  } catch (e) {
    console.error(`[create-website] GitHub push failed: ${e.message}`);
    return res.status(500).json({ error: e.message });
  }

  // ── Build Supabase klanten record (matched to real schema) ──────────────
  const klantRecord = {
    slug,
    bedrijfsnaam,
    template_keuze,
    status:              'actief',
    telefoon:            display,
    email,
    adres_straat,
    adres_postcode_stad,
    kvk:                 kvk || null,
    maps_url:            maps_url || null,
    sector:              beroep,
    kleur_thema,
    logo_url:            foto_logo || null,
    foto_hero:           fotoHero,
    foto_waarom:         fotoWaarom,
    foto_usp:            fotoUsp,
    foto_werkwijze:      fotoWerkwijze,
    template_homepage:   tplConfig.homepage  || null,
    template_diensten:   tplConfig.diensten  || null,
    template_contact:    tplConfig.contact   || null,
    template_over_ons:   tplConfig.over_ons  || null,
    template_projecten:  tplConfig.projecten || null,
    dienst_1: dienstenNamen[0] || null,
    dienst_2: dienstenNamen[1] || null,
    dienst_3: dienstenNamen[2] || null,
    dienst_4: dienstenNamen[3] || null,
    dienst_5: dienstenNamen[4] || null,
    dienst_6: dienstenNamen[5] || null,
    ...Object.fromEntries(dienstenNamen.map((naam, i) => [
      `dienst_${i + 1}_foto`,
      naam ? `${STOCK_BASE}/${beroepSlug}/diensten/${naam}/${naam}-1.jpeg` : null,
    ])),
    reviews:    reviewsArr.length > 0 ? reviewsArr : null,
    ai_content: {
      ...ai,
      ...Object.fromEntries(dienstenNamen.map((naam, i) => [`DIENST_${i + 1}`, naam])),
      ...Object.fromEntries(dienstenNamen.map((naam, i) => [
        `DIENST_${i + 1}_FOTO`,
        naam ? `${STOCK_BASE}/${beroepSlug}/diensten/${naam}/${naam}-1.jpeg` : '',
      ])),
      DIENST_AANTAL: String(dienstenNamen.length),
    },
  };

  // Insert into klanten (for editor overview)
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/klanten`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify(klantRecord),
    });
    if (!r.ok) console.error('Supabase klanten insert failed:', r.status, await r.text());
  } catch (e) { console.error('Supabase klanten insert failed:', e.message); }

  // Insert into clients (used by save.js to look up template type)
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/clients`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify({ slug, naam: bedrijfsnaam, template: template_keuze }),
    });
    if (!r.ok) console.error('Supabase clients insert failed:', r.status, await r.text());
  } catch (e) { console.error('Supabase clients insert failed:', e.message); }

  // Also save to client_content (used by editor save flow)
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/client_content`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify({ slug, data: map, updated_at: new Date().toISOString() }),
    });
  } catch (e) { console.error('Supabase client_content save failed (non-fatal):', e.message); }

  // GoHighLevel notification (non-fatal)
  const voornaam = naam_contactpersoon.split(' ')[0] || naam_contactpersoon;
  try {
    await fetch(GHL_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        bedrijfsnaam,
        naam:    naam_contactpersoon,
        telefoon: display,
        url:     `https://preview.gowebbo.io/${slug}.html`,
        bericht: `Hi ${voornaam}, je nieuwe website is klaar! 🎉\n\n🔗 https://preview.gowebbo.io/${slug}.html\n\nIs er iets dat je er aan zou willen aanpassen, of zullen we hem meteen online zetten?`,
      }),
    });
  } catch (e) { console.error('GHL webhook failed (non-fatal):', e.message); }

  return res.status(200).json({
    ok:    true,
    slug,
    url:   `https://preview.gowebbo.io/${slug}.html`,
    files: Object.keys(generated),
  });
};
