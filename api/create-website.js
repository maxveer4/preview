const { TEMPLATES, DEFAULT_TEMPLATE } = require('./_template-config');

const REPO        = 'maxveer4/preview';
const BRANCH      = 'main';
const SUPABASE_URL = 'https://agdwnlqiepnmxwkrpzqv.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFnZHdubHFpZXBubXh3a3JwenF2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwNzM4MzAsImV4cCI6MjA5MTY0OTgzMH0.bSw1y5gvVGg1C02AFU-bbfq4rSmy99APILktrlPIf2Y';
const STOCK_BASE  = 'https://agdwnlqiepnmxwkrpzqv.supabase.co/storage/v1/object/public/stockfotos';
const GHL_URL     = 'https://services.leadconnectorhq.com/hooks/cBpKffr120uYK9k2aD5m/webhook-trigger/ad5ce8f7-1f45-48b6-9045-0909c7c555fa';

// Template configs live in _template-config.js (shared with save.js)

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

function slugToLabel(s) {
  return String(s || '').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function applyMap(template, map) {
  let out = template;
  for (const [key, val] of Object.entries(map)) {
    const raw = val == null ? '' : String(val);
    const escaped = raw.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    out = out.split(`"{{${key}}}"`).join(`"${escaped}"`);
    out = out.split(`{{${key}}}`).join(raw);
  }
  return out.replace(/\{\{[A-Z0-9_]+\}\}/g, '');
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

// Push multiple files as a single commit via the GitHub Trees API.
// Much faster than sequential githubUpsert calls (blobs created in parallel,
// one commit total), critical for bigsite which has 13 files.
async function githubBatchCommit(token, files, commitMessage) {
  const repoUrl = `https://api.github.com/repos/${REPO}`;
  const headers = {
    Authorization: `token ${token}`,
    'Content-Type': 'application/json',
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'gowebbo-create/1.0',
  };

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      // 1. Current branch HEAD
      const refRes = await fetch(`${repoUrl}/git/refs/heads/${BRANCH}`, { headers });
      if (!refRes.ok) throw new Error(`get ref failed: ${refRes.status}`);
      const latestSha = (await refRes.json()).object.sha;

      // 2. Current tree SHA
      const commitRes = await fetch(`${repoUrl}/git/commits/${latestSha}`, { headers });
      if (!commitRes.ok) throw new Error(`get commit failed: ${commitRes.status}`);
      const baseTreeSha = (await commitRes.json()).tree.sha;

      // 3. Create all blobs in parallel
      const treeItems = await Promise.all(
        Object.entries(files).map(async ([path, content]) => {
          const blobRes = await fetch(`${repoUrl}/git/blobs`, {
            method: 'POST', headers,
            body: JSON.stringify({ content: Buffer.from(content).toString('base64'), encoding: 'base64' }),
          });
          if (!blobRes.ok) throw new Error(`blob for ${path} failed: ${blobRes.status}`);
          const { sha } = await blobRes.json();
          return { path, mode: '100644', type: 'blob', sha };
        })
      );

      // 4. Create tree
      const treeRes = await fetch(`${repoUrl}/git/trees`, {
        method: 'POST', headers,
        body: JSON.stringify({ base_tree: baseTreeSha, tree: treeItems }),
      });
      if (!treeRes.ok) throw new Error(`create tree failed: ${treeRes.status}`);
      const newTreeSha = (await treeRes.json()).sha;

      // 5. Create commit
      const newCommitRes = await fetch(`${repoUrl}/git/commits`, {
        method: 'POST', headers,
        body: JSON.stringify({ message: commitMessage, tree: newTreeSha, parents: [latestSha] }),
      });
      if (!newCommitRes.ok) throw new Error(`create commit failed: ${newCommitRes.status}`);
      const newCommitSha = (await newCommitRes.json()).sha;

      // 6. Update branch ref (retry whole loop on 422 = non-fast-forward)
      const updateRes = await fetch(`${repoUrl}/git/refs/heads/${BRANCH}`, {
        method: 'PATCH', headers,
        body: JSON.stringify({ sha: newCommitSha }),
      });
      if (updateRes.ok) return;
      const errBody = await updateRes.text();
      if (updateRes.status === 422 && attempt < 2) {
        console.warn(`[githubBatchCommit] ref update conflict on attempt ${attempt + 1}, retrying...`);
        await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
        continue;
      }
      throw new Error(`update ref failed (${updateRes.status}): ${errBody}`);
    } catch (e) {
      if (attempt < 2 && e.message.includes('conflict')) {
        await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
        continue;
      }
      throw e;
    }
  }
}

function buildPrompt(bedrijfsnaam, sector, dienstenNamen, stad, display, email, isModern, isBigsite) {
  const modernExtra = isModern ? `
  "TRUST_4_TITEL": "Vierde vertrouwenskolom titel (2-4 woorden)",
  "TRUST_4_DESC": "Uitleg bij vierde vertrouwenskolom (1 zin, max 15 woorden)",
  "PROJECTEN_JSON": [{"foto":"","titel":"realistisch projecttitel passend bij sector","categorie":"dienstcategorie","locatie":"gemeente in werkgebied","desc":"korte projectomschrijving max 15 woorden"},{"foto":"","titel":"...","categorie":"...","locatie":"...","desc":"..."},{"foto":"","titel":"...","categorie":"...","locatie":"...","desc":"..."},{"foto":"","titel":"...","categorie":"...","locatie":"...","desc":"..."}],` : '';

  // Shared hero content for all werkgebied/stad pages
  const bigsiteStadExtra = isBigsite ? `
  "STAD_EYEBROW": "Korte label boven de h1 op stadpagina's (max 8 woorden, bijv. 'Uw specialist in de regio')",
  "STAD_H1_PREFIX": "Woorden vóór 'in [stad]' in de h1 (2-5 woorden, bijv. 'De beste dakdekker')",
  "STAD_INTRO": "Intro beschrijving voor alle stadpagina's (2-3 zinnen, max 50 woorden, generiek genoeg voor elke stad)",
  "STAD_USP_1": "USP 1 voor stadpagina's (max 8 woorden)",
  "STAD_USP_2": "USP 2 voor stadpagina's (max 8 woorden)",
  "STAD_USP_3": "USP 3 voor stadpagina's (max 8 woorden)",
  "STAD_1_SECTIE_TITEL": "Sectie 2 titel voor de pagina van STAD_1 — verwerk die stadnaam in de titel (max 8 woorden)",
  "STAD_1_SECTIE_BODY": "Sectie 2 eerste alinea specifiek voor de stad van STAD_1 — gebruik die stadnaam, anders dan alle andere steden (3-4 zinnen, max 70 woorden)",
  "STAD_1_SECTIE_BODY_2": "Sectie 2 tweede alinea voor STAD_1 stad — aanvullend en uniek (2-3 zinnen, max 50 woorden)",
  "STAD_2_SECTIE_TITEL": "Sectie 2 titel voor de pagina van STAD_2 — verwerk die stadnaam in de titel (max 8 woorden)",
  "STAD_2_SECTIE_BODY": "Sectie 2 eerste alinea specifiek voor de stad van STAD_2 — gebruik die stadnaam, anders dan alle andere steden (3-4 zinnen, max 70 woorden)",
  "STAD_2_SECTIE_BODY_2": "Sectie 2 tweede alinea voor STAD_2 stad — aanvullend en uniek (2-3 zinnen, max 50 woorden)",
  "STAD_3_SECTIE_TITEL": "Sectie 2 titel voor de pagina van de stad in STAD_3 — verwerk die stadnaam in de titel (max 8 woorden)",
  "STAD_3_SECTIE_BODY": "Sectie 2 eerste alinea specifiek voor de stad van STAD_3 — gebruik die stadnaam, anders dan alle andere steden (3-4 zinnen, max 70 woorden)",
  "STAD_3_SECTIE_BODY_2": "Sectie 2 tweede alinea voor STAD_3 stad — aanvullend en uniek (2-3 zinnen, max 50 woorden)",
  "STAD_4_SECTIE_TITEL": "Sectie 2 titel voor de pagina van de stad in STAD_4 — verwerk die stadnaam in de titel (max 8 woorden)",
  "STAD_4_SECTIE_BODY": "Sectie 2 eerste alinea specifiek voor de stad van STAD_4 — gebruik die stadnaam, anders dan alle andere steden (3-4 zinnen, max 70 woorden)",
  "STAD_4_SECTIE_BODY_2": "Sectie 2 tweede alinea voor STAD_4 stad — aanvullend en uniek (2-3 zinnen, max 50 woorden)",
  "STAD_5_SECTIE_TITEL": "Sectie 2 titel voor de pagina van de stad in STAD_5 — verwerk die stadnaam in de titel (max 8 woorden)",
  "STAD_5_SECTIE_BODY": "Sectie 2 eerste alinea specifiek voor de stad van STAD_5 — gebruik die stadnaam, anders dan alle andere steden (3-4 zinnen, max 70 woorden)",
  "STAD_5_SECTIE_BODY_2": "Sectie 2 tweede alinea voor STAD_5 stad — aanvullend en uniek (2-3 zinnen, max 50 woorden)",
  "STAD_6_SECTIE_TITEL": "Sectie 2 titel voor de pagina van de stad in STAD_6 — verwerk die stadnaam in de titel (max 8 woorden)",
  "STAD_6_SECTIE_BODY": "Sectie 2 eerste alinea specifiek voor de stad van STAD_6 — gebruik die stadnaam, anders dan alle andere steden (3-4 zinnen, max 70 woorden)",
  "STAD_6_SECTIE_BODY_2": "Sectie 2 tweede alinea voor STAD_6 stad — aanvullend en uniek (2-3 zinnen, max 50 woorden)",` : '';

  // Generate page content fields for each existing dienst (1 up to N)
  const bigsiteExtra = isBigsite ? dienstenNamen.slice(0, 10).map((naam, i) => {
    const n = i + 1;
    return `
  "PAGINA_DIENST_${n}_H1": "Paginatitel voor '${naam}' (max 6 woorden, krachtige h1)",
  "PAGINA_DIENST_${n}_INTRO": "Hero intro tekst voor '${naam}' pagina (1-2 zinnen, max 30 woorden)",
  "PAGINA_DIENST_${n}_H2": "Content sectie koptekst voor '${naam}' (max 8 woorden, bijv. 'Waarom kiezen voor...')",
  "PAGINA_DIENST_${n}_BODY": "Content sectie eerste alinea voor '${naam}' (3-4 zinnen, max 70 woorden, overtuigend)",
  "PAGINA_DIENST_${n}_BODY_2": "Content sectie tweede alinea voor '${naam}' (3-4 zinnen, max 70 woorden, aanvullend op de eerste alinea)",`;
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
  "WERK_STAP_TITEL": "Ondertitel stappenplan, bijv. 'Dakwerk in 4 stappen' (4-6 woorden)",
  "VAKMANSCHAP_TITEL": "Ondertitel vakmanschapsblok, bijv. 'Vakmanschap en betrouwbaarheid' (3-5 woorden)",
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
  "STAD_4": "Vierde gemeente", "STAD_5": "Vijfde gemeente", "STAD_6": "Zesde gemeente",${bigsiteStadExtra}
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
  "DIENST_7_DESC": "Beschrijving over '${dienstenNamen[6] || ''}' (3-4 zinnen, max 60 woorden)",
  "DIENST_8_DESC": "Beschrijving over '${dienstenNamen[7] || ''}' (3-4 zinnen, max 60 woorden)",
  "DIENST_9_DESC": "Beschrijving over '${dienstenNamen[8] || ''}' (3-4 zinnen, max 60 woorden)",
  "DIENST_10_DESC": "Beschrijving over '${dienstenNamen[9] || ''}' (3-4 zinnen, max 60 woorden)",
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

BELANGRIJK: geef ALLEEN het JSON object, geen uitleg of markdown. REVIEWS_JSON is een array van 6 objecten. Steden zijn echte gemeenten rondom ${stad}. Gebruik NOOIT gedachtestreepjes. Spreek altijd namens het bedrijf, nooit op naam van de contactpersoon.${isBigsite ? ' Voor de *_SECTIE_* velden: elke stad moet ANDERE inhoud krijgen — verwerk de specifieke stadnaam in elke titel en schrijf per stad een unieke lokale tekst. Kopieer NOOIT dezelfde tekst voor meerdere steden.' : ''}`;
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
  const apiKey   = process.env.OPENAI_API_KEY;
  if (!apiKey)             return res.status(500).json({ error: 'OPENAI_API_KEY not set' });
  if (!dry_run && !token)  return res.status(500).json({ error: 'GITHUB_TOKEN not set' });

  const bedrijfsnaam       = d.bedrijfsnaam || '';
  const naam_contactpersoon = d.naam_contactpersoon || '';
  const telefoon            = d.telefoon || '';
  const email               = d.email || '';
  const beroep              = d.beroep || d.sector || '';
  const dienstenRaw         = d.diensten || d.Diensten || '';
  const stad                = d.stad || '';
  // Normalize legacy key: 'dak-masterpiece' was renamed to 'dak' to match save.js and editor
  const template_keuze      = (d.template_keuze || 'preview').replace('dak-masterpiece', 'dak');
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
  const tpl        = TEMPLATES[template_keuze] ?? TEMPLATES[DEFAULT_TEMPLATE];
  const isModern   = tpl.isModern  ?? false;
  const isBigsite  = tpl.isBigsite ?? false;

  const fotoHero      = d.foto_hero    || `${STOCK_BASE}/${beroepSlug}/hero/${beroepSlug}-hero-1.jpeg`;
  const fotoWaarom    = d.foto_sectie2 || `${STOCK_BASE}/${beroepSlug}/waarom/${beroepSlug}-waarom-1.jpeg`;
  const fotoUsp       = `${STOCK_BASE}/${beroepSlug}/sectie2/${beroepSlug}-sectie2-1.jpeg`;
  const fotoWerkwijze = `${STOCK_BASE}/${beroepSlug}/werkwijze/${beroepSlug}-werkwijze-1.jpeg`;

  const dienstenNamen = Array.isArray(dienstenRaw)
    ? dienstenRaw.map(x => String(x).trim()).filter(Boolean)
    : String(dienstenRaw).split(',').map(x => x.trim()).filter(Boolean);
  // Human-readable display names: "lekkage-verhelpen" → "Lekkage Verhelpen"
  const dienstenLabels = dienstenNamen.map(slugToLabel);

  const logoHtml = foto_logo
    ? `<img src="${foto_logo}" alt="${bedrijfsnaam} logo" style="height:${isModern ? '90px' : '40px'};width:auto;max-width:${isModern ? '300px' : '160px'};object-fit:contain">`
    : `<span style="font-weight:700;font-size:1.25rem">${bedrijfsnaam}</span>`;

  // ── Register early in both tables so the editor overview always shows this client ──
  // Done before GitHub/Claude work to survive Vercel function timeouts.
  const earlyKlantRecord = {
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
    dienst_1:  dienstenLabels[0] || null,
    dienst_2:  dienstenLabels[1] || null,
    dienst_3:  dienstenLabels[2] || null,
    dienst_4:  dienstenLabels[3] || null,
    dienst_5:  dienstenLabels[4] || null,
    dienst_6:  dienstenLabels[5] || null,
    dienst_7:  dienstenLabels[6] || null,
    dienst_8:  dienstenLabels[7] || null,
    dienst_9:  dienstenLabels[8] || null,
    dienst_10: dienstenLabels[9] || null,
  };
  try {
    const kr = await fetch(`${SUPABASE_URL}/rest/v1/klanten`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify(earlyKlantRecord),
    });
    if (!kr.ok) console.error('Supabase klanten early insert failed:', kr.status, await kr.text().catch(() => ''));
  } catch (e) { console.error('Supabase klanten early insert failed:', e.message); }
  try {
    const cr = await fetch(`${SUPABASE_URL}/rest/v1/clients`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify({ slug, naam: bedrijfsnaam, template: template_keuze }),
    });
    if (!cr.ok) console.error('Supabase clients early insert failed:', cr.status, await cr.text().catch(() => ''));
  } catch (e) { console.error('Supabase clients early insert failed:', e.message); }

  // ── Fetch templates + call Claude in parallel (saves ~0.5–1s) ────────────
  const regularTemplates = {}; // suffix → html
  const dienstTemplates  = {}; // n (1-based) → html
  const stadTemplates    = {}; // n (3-6) → html, bigsite only
  let ai = {};
  try {
    const claudePromise = fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({
        model:             'gpt-5.5',
        max_output_tokens: isBigsite ? 8000 : 4000,
        instructions:      `Je bent een professionele Nederlandse webtekstschrijver voor GoWebbo. Je schrijft website teksten voor lokale vakbedrijven zoals schilders, dakdekkers, stukadoors, aannemers, klussenbedrijven, loodgieters, installateurs, hoveniers, vloerenleggers en renovatiebedrijven.

Je antwoordt UITSLUITEND met één geldig JSON object. Geen uitleg, geen markdown, geen codeblok en geen tekst vóór of na de JSON. De output moet direct parsebaar zijn met JSON.parse().

Volg exact het JSON schema dat is meegegeven:

* Gebruik exact dezelfde keys.
* Voeg geen extra keys toe.
* Laat geen keys weg.
* Gebruik strings, arrays en objecten precies zoals het schema vraagt.
* Gebruik geen null.
* Gebruik geen trailing commas.
* Gebruik geen HTML, tenzij het schema dit expliciet vraagt.

Schrijfstijl:

* Schrijf in natuurlijk, professioneel Nederlands.
* Gebruik altijd "u" en "uw".
* Schrijf simpel, duidelijk en betrouwbaar.
* Klink als een echte Nederlandse vakman, niet als een marketingbureau.
* Maak de tekst geschikt voor een normale lokale bedrijfswebsite.
* Schrijf rustig en overtuigend, niet schreeuwerig.
* Maak de tekst specifiek voor de branche, diensten, plaats en bedrijfsnaam die zijn aangeleverd.

Kwaliteitseisen:

* Elke tekst moet logisch, concreet en bruikbaar zijn op een website.
* Schrijf geen rare, zweverige of overdreven zinnen.
* Herhaal niet steeds dezelfde woorden of voordelen.
* Zorg dat elke diensttekst anders klinkt.
* Schrijf alsof de bezoeker snel wil weten: wat doet dit bedrijf, waarom is het betrouwbaar en hoe kan ik contact opnemen?

Claims en veiligheid:

* Verzin geen feiten.
* Zeg niet dat het bedrijf erkend, gecertificeerd, verzekerd, specialist, marktleider, de beste of 24/7 bereikbaar is, tenzij dit expliciet is aangeleverd.
* Zeg niet "jarenlange ervaring", "meer dan 20 jaar ervaring", "duizenden klanten" of vergelijkbare claims, tenzij dit expliciet is aangeleverd.
* Maak geen harde beloftes over prijs, snelheid, garantie, levertijd of beschikbaarheid als dit niet is aangeleverd.
* Als informatie ontbreekt, schrijf dan een veilige algemene tekst die past bij de branche.

Voor diensten:

* Beschrijf concreet wat de klant krijgt.
* Benoem praktische voordelen zoals nette afwerking, duidelijke communicatie, zorgvuldige voorbereiding, betrouwbaar werk en duurzaam resultaat.
* Houd de tekst professioneel maar eenvoudig.
* Gebruik geen overdreven technische details als die niet zijn aangeleverd.

Voor lokale SEO:

* Gebruik plaatsnamen en werkgebied natuurlijk.
* Forceer zoekwoorden niet.
* SEO titles moeten duidelijk en klikbaar zijn.
* Meta descriptions moeten kort, concreet en uitnodigend zijn.

Voor CTA's:

* Schrijf laagdrempelig en professioneel.
* Gebruik rustige zinnen zoals "Vraag vrijblijvend advies aan", "Neem contact op voor een offerte" of "Bespreek uw project".
* Gebruik geen agressieve verkooptactieken.

Controleer vóór je antwoordt:

* Is het 100% geldige JSON?
* Kloppen alle keys met het schema?
* Zijn alle strings goed afgesloten?
* Zijn er geen trailing commas?
* Is de tekst natuurlijk Nederlands?
* Zijn er geen verzonnen claims?
* Klinkt het niet als AI?
* Zijn de teksten geschikt voor een lokale Nederlandse bedrijfswebsite?`,
        input:             buildPrompt(bedrijfsnaam, beroep, dienstenLabels, stad, display, email, isModern, isBigsite),
      }),
    });

    // Fetch regular pages + bigsite dienst/stad pages in parallel
    const templatePromise = Promise.all([
      ...tpl.pages.map(async suffix => {
        regularTemplates[suffix] = await fetchTemplate(`${tpl.prefix}${suffix}.html`);
      }),
      ...Array.from({ length: tpl.dienstCount }, async (_, i) => {
        const n = i + 1;
        dienstTemplates[n] = await fetchTemplate(`${tpl.prefix}-dienst-${n}.html`);
      }),
      ...(isBigsite ? [3, 4, 5, 6].map(async n => {
        stadTemplates[n] = await fetchTemplate(`${tpl.prefix}-stad-${n}.html`).catch(() => null);
      }) : []),
    ]);

    const [claudeRes] = await Promise.all([claudePromise, templatePromise]);

    if (!claudeRes.ok) throw new Error(`OpenAI ${claudeRes.status}: ${await claudeRes.text()}`);
    const claudeJson = await claudeRes.json();
    const raw = claudeJson.output?.find(item => item.type === 'message')?.content?.[0]?.text || '';
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
    ai = JSON.parse(cleaned);

    // Herorden STAD_N_SECTIE_* zodat de stadnaam in de titel overeenkomt met STAD_N.
    // De AI genereert soms de content in de verkeerde volgorde. Dit legt elk sectie
    // bij de stad die in de titel wordt vermeld.
    if (isBigsite) {
      const sections = [1,2,3,4,5,6].map(n => ({
        n,
        stad: (ai[`STAD_${n}`] || '').toLowerCase().trim(),
        titel: ai[`STAD_${n}_SECTIE_TITEL`] || '',
        body:  ai[`STAD_${n}_SECTIE_BODY`]  || '',
        body2: ai[`STAD_${n}_SECTIE_BODY_2`] || '',
      }));
      const result  = Array(6).fill(null);
      const used    = new Set();
      // Pass 1: match by stad name in titel
      for (let i = 0; i < 6; i++) {
        const stadNaam = sections[i].stad;
        if (!stadNaam) continue;
        for (let j = 0; j < 6; j++) {
          if (used.has(j)) continue;
          if (sections[j].titel.toLowerCase().includes(stadNaam)) {
            result[i] = sections[j];
            used.add(j);
            break;
          }
        }
      }
      // Pass 2: fill remaining slots with unused sections (original order)
      let spare = 0;
      for (let i = 0; i < 6; i++) {
        if (!result[i]) {
          while (spare < 6 && used.has(spare)) spare++;
          result[i] = spare < 6 ? sections[spare++] : sections[i];
          used.add(spare - 1);
        }
      }
      // Write back
      for (let i = 0; i < 6; i++) {
        const n = i + 1;
        if (result[i]) {
          ai[`STAD_${n}_SECTIE_TITEL`] = result[i].titel;
          ai[`STAD_${n}_SECTIE_BODY`]  = result[i].body;
          ai[`STAD_${n}_SECTIE_BODY_2`] = result[i].body2;
        }
      }
    }

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
    console.error('[create-website] Content generation failed:', e.message);
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

    // Services (display names for nav/labels; photo URLs still use dienstenNamen slugs)
    DIENST_1:  dienstenLabels[0] || '',
    DIENST_2:  dienstenLabels[1] || '',
    DIENST_3:  dienstenLabels[2] || '',
    DIENST_4:  dienstenLabels[3] || '',
    DIENST_5:  dienstenLabels[4] || '',
    DIENST_6:  dienstenLabels[5] || '',
    DIENST_7:  dienstenLabels[6] || '',
    DIENST_8:  dienstenLabels[7] || '',
    DIENST_9:  dienstenLabels[8] || '',
    DIENST_10: dienstenLabels[9] || '',
    ...dienstFotos,

    // Project photos (bigsite only — empty at creation, editor fills in later)
    FOTO_PROJECT_1: '', FOTO_PROJECT_2: '', FOTO_PROJECT_3: '', FOTO_PROJECT_4: '',
    FOTO_PROJECT_5: '', FOTO_PROJECT_6: '', FOTO_PROJECT_7: '', FOTO_PROJECT_8: '',

    // Bigsite dienst page slugs — computed from dienst names (no Claude needed)
    ...Object.fromEntries(
      Array.from({ length: 10 }, (_, i) => [
        `PAGINA_DIENST_${i + 1}_SLUG`,
        makeSlug(dienstenNamen[i] || ''),
      ])
    ),

    // Bigsite stad page slugs (3-6) — computed from AI-generated STAD_N city names
    ...(isBigsite ? Object.fromEntries(
      [3, 4, 5, 6].map(n => {
        const stadNaam = (ai[`STAD_${n}`] || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
        return [`PAGINA_STAD_${n}_SLUG`, stadNaam];
      })
    ) : {}),

    // JSON data
    DIENSTEN_JSON:  JSON.stringify(dienstenJson),
    REVIEWS_JSON:   reviewsForTemplate,
    PROJECTEN_JSON: projectenJson,

    // Conditional / UI
    HIDE_PROJECTEN:   tpl.pages.includes('-projecten') ? '' : 'display:none',
    REVIEWS_DISPLAY:  '',

    // Forms (empty at creation — editor fills these in later)
    OFFERTE_WEBHOOK:      '',
    FORMULIER_WEBHOOK:    '',
    MODAL_OFFERTE_IFRAME: '',
    MODAL_ADVIES_IFRAME:  '',

    // Social footer icons (modern only — editor fills these in later)
    SOCIAL_FACEBOOK:  '#',
    SOCIAL_INSTAGRAM: '#',
    SOCIAL_LINKEDIN:  '#',
  };

  // ── Apply map to all templates ────────────────────────────────────────────
  const generated = {};

  // Regular pages: suffix '' → {slug}.html, '-contact' → {slug}-contact.html, etc.
  for (const [suffix, html] of Object.entries(regularTemplates)) {
    const outputFile = suffix === '' ? `${slug}.html` : `${slug}${suffix}.html`;
    generated[outputFile] = applyMap(html, map);
  }

  // Bigsite dienst pages: output file uses the AI-generated dienst name as slug
  for (const [n, html] of Object.entries(dienstTemplates)) {
    const idx   = parseInt(n) - 1;
    if (!dienstenNamen[idx]) continue; // skip empty dienst slots
    const dslug = makeSlug(dienstenNamen[idx]) || `dienst-${n}`;
    generated[`${slug}-${dslug}.html`] = applyMap(html, map);
  }

  // Bigsite stad pages (3-6): output file uses lowercased city name as slug
  for (const [n, html] of Object.entries(stadTemplates)) {
    if (!html) continue;
    const stadSlug = map[`PAGINA_STAD_${n}_SLUG`];
    if (!stadSlug) continue; // skip if STAD_N was not generated
    generated[`${slug}-${stadSlug}.html`] = applyMap(html, map);
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

  // ── Push all files as a single batch commit (Trees API: blobs in parallel → 1 commit) ──
  // This is 5-10x faster than sequential githubUpsert and avoids Vercel function timeouts
  // when generating bigsite websites with 13 files.
  const fileList = Object.keys(generated);
  console.log(`[create-website] Batch-committing ${fileList.length} files: ${fileList.join(', ')}`);
  const publicFiles = Object.fromEntries(
    Object.entries(generated).map(([filename, content]) => [`public/${filename}`, content])
  );

  // Also include clients.json update in the same batch commit so the editor overview
  // always shows this client, even if the Supabase insert fails silently.
  try {
    const cjUrl = `https://api.github.com/repos/${REPO}/contents/public/clients.json`;
    const cjHeaders = {
      Authorization: `token ${token}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'gowebbo-create/1.0',
    };
    const cjRes = await fetch(cjUrl, { headers: cjHeaders });
    if (cjRes.ok) {
      const { content: cjContent } = await cjRes.json();
      const existing = JSON.parse(Buffer.from(cjContent, 'base64').toString('utf8'));
      if (!existing.some(c => c.slug === slug)) {
        existing.unshift({ slug, naam: bedrijfsnaam });
        publicFiles['public/clients.json'] = JSON.stringify(existing, null, 4);
      }
    }
  } catch (_) {}

  try {
    await githubBatchCommit(token, publicFiles, `Create website for ${slug} (${fileList.length} files)`);
    console.log(`[create-website] Batch commit done: ${fileList.length} files`);
  } catch (e) {
    console.error(`[create-website] GitHub batch commit failed: ${e.message}`);
    return res.status(500).json({ error: e.message });
  }

  // ── Trigger Vercel deployment via a normal Contents API commit ────────────
  // The Trees API batch commit doesn't reliably trigger Vercel's webhook.
  // A single githubUpsert after the batch ensures Vercel picks up all new files.
  try {
    const triggerContent = `${slug} ${Date.now()}`;
    await githubUpsert(token, 'public/_last-generated.txt', triggerContent);
    console.log(`[create-website] Vercel trigger commit done`);
  } catch (e) {
    console.warn(`[create-website] Vercel trigger failed (non-fatal): ${e.message}`);
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
    template_homepage:   `${tpl.prefix}.html`,
    template_diensten:   tpl.pages.includes('-diensten')  ? `${tpl.prefix}-diensten.html`  : null,
    template_contact:    tpl.pages.includes('-contact')   ? `${tpl.prefix}-contact.html`   : null,
    template_over_ons:   tpl.pages.includes('-over-ons')  ? `${tpl.prefix}-over-ons.html`  : null,
    template_projecten:  tpl.pages.includes('-projecten') ? `${tpl.prefix}-projecten.html` : null,
    dienst_1:  dienstenLabels[0] || null,
    dienst_2:  dienstenLabels[1] || null,
    dienst_3:  dienstenLabels[2] || null,
    dienst_4:  dienstenLabels[3] || null,
    dienst_5:  dienstenLabels[4] || null,
    dienst_6:  dienstenLabels[5] || null,
    dienst_7:  dienstenLabels[6] || null,
    dienst_8:  dienstenLabels[7] || null,
    dienst_9:  dienstenLabels[8] || null,
    dienst_10: dienstenLabels[9] || null,
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

  // Update klanten with full data incl. ai_content (early insert already created the row)
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/klanten?slug=eq.${encodeURIComponent(slug)}`, {
      method: 'PATCH',
      headers: {
        apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(klantRecord),
    });
    if (!r.ok) console.error('Supabase klanten patch failed:', r.status, await r.text());
  } catch (e) { console.error('Supabase klanten patch failed:', e.message); }

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
