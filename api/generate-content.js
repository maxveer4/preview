const SUPABASE_URL = 'https://agdwnlqiepnmxwkrpzqv.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFnZHdubHFpZXBubXh3a3JwenF2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwNzM4MzAsImV4cCI6MjA5MTY0OTgzMH0.bSw1y5gvVGg1C02AFU-bbfq4rSmy99APILktrlPIf2Y';

// Fields to generate per template type.
// Each entry: [fieldName, short description for the AI]
const FIELDS_DEFAULT = [
  ['seo_title',        'paginatitel voor Google, max 60 tekens'],
  ['seo_description',  'meta description voor Google, max 155 tekens'],
  ['hero_eyebrow',     'klein label boven de hoofdtitel, max 5 woorden, bijv. "Vakkundig & Betrouwbaar"'],
  ['hero_title',       'hoofdtitel van de website, pakkend, max 8 woorden'],
  ['hero_desc',        'korte introductiezin onder de hoofdtitel, max 20 woorden'],
  ['usp_1',            'eerste unique selling point, max 6 woorden'],
  ['usp_2',            'tweede unique selling point, max 6 woorden'],
  ['usp_3',            'derde unique selling point, max 6 woorden'],
  ['trust_desc',       'korte zin die vertrouwen opwekt, max 15 woorden'],
  ['trust_1_titel',    'titel van eerste vertrouwenskenmerk, max 4 woorden'],
  ['trust_1_desc',     'uitleg bij eerste vertrouwenskenmerk, max 15 woorden'],
  ['trust_2_titel',    'titel van tweede vertrouwenskenmerk, max 4 woorden'],
  ['trust_2_desc',     'uitleg bij tweede vertrouwenskenmerk, max 15 woorden'],
  ['trust_3_titel',    'titel van derde vertrouwenskenmerk, max 4 woorden'],
  ['trust_3_desc',     'uitleg bij derde vertrouwenskenmerk, max 15 woorden'],
  ['service_title',    'sectietitel diensten, max 6 woorden'],
  ['service_desc',     'korte omschrijving dienstenaanbod, max 25 woorden'],
  ['why_desc',         'intro zin voor "Waarom wij?" sectie, max 20 woorden'],
  ['why_1_titel',      'eerste voordeel titel, max 4 woorden'],
  ['why_1_desc',       'uitleg eerste voordeel, max 15 woorden'],
  ['why_2_titel',      'tweede voordeel titel, max 4 woorden'],
  ['why_2_desc',       'uitleg tweede voordeel, max 15 woorden'],
  ['why_3_titel',      'derde voordeel titel, max 4 woorden'],
  ['why_3_desc',       'uitleg derde voordeel, max 15 woorden'],
  ['why_4_titel',      'vierde voordeel titel, max 4 woorden'],
  ['why_4_desc',       'uitleg vierde voordeel, max 15 woorden'],
  ['werk_title',       'sectietitel werkwijze, max 6 woorden'],
  ['stappen_title',    'ondertitel voor de stappen, max 5 woorden'],
  ['stap_1_titel',     'stap 1 naam, max 4 woorden'],
  ['stap_1_desc',      'stap 1 uitleg, max 15 woorden'],
  ['stap_2_titel',     'stap 2 naam, max 4 woorden'],
  ['stap_2_desc',      'stap 2 uitleg, max 15 woorden'],
  ['stap_3_titel',     'stap 3 naam, max 4 woorden'],
  ['stap_3_desc',      'stap 3 uitleg, max 15 woorden'],
  ['stap_4_titel',     'stap 4 naam, max 4 woorden'],
  ['stap_4_desc',      'stap 4 uitleg, max 15 woorden'],
  ['over_ons_hero_desc',   'intro zin op de over ons pagina, max 20 woorden'],
  ['over_ons_intro_p1',    'eerste paragraaf over het bedrijf, max 40 woorden'],
  ['over_ons_intro_p2',    'tweede paragraaf over het bedrijf, max 40 woorden'],
  ['over_ons_intro_p3',    'derde paragraaf over het bedrijf, max 40 woorden'],
  ['over_ons_waarde_1_titel', 'eerste kernwaarde titel, max 3 woorden'],
  ['over_ons_waarde_1_desc',  'uitleg eerste kernwaarde, max 15 woorden'],
  ['over_ons_waarde_2_titel', 'tweede kernwaarde titel, max 3 woorden'],
  ['over_ons_waarde_2_desc',  'uitleg tweede kernwaarde, max 15 woorden'],
  ['over_ons_waarde_3_titel', 'derde kernwaarde titel, max 3 woorden'],
  ['over_ons_waarde_3_desc',  'uitleg derde kernwaarde, max 15 woorden'],
  ['over_ons_waarde_4_titel', 'vierde kernwaarde titel, max 3 woorden'],
  ['over_ons_waarde_4_desc',  'uitleg vierde kernwaarde, max 15 woorden'],
  ['werk_desc_1',          'eerste alinea over werkervaring en aanpak, max 40 woorden'],
  ['werk_desc_2',          'tweede alinea over werkervaring en aanpak, max 40 woorden'],
  ['vakmanschap_desc',     'tekst over werkgebied en regio, max 30 woorden'],
  ['cta_titel',            'call-to-action sectietitel op homepagina, max 8 woorden'],
  ['cta_desc',             'korte tekst onder de call-to-action titel, max 20 woorden'],
  ['over_ons_cta_desc',    'tekst onder de CTA op over ons pagina, max 20 woorden'],
  ['contact_hero_desc',    'intro zin op contactpagina, max 20 woorden'],
  ['diensten_hero_desc',   'intro zin op dienstenpagina, max 20 woorden'],
];

// Extra fields for the 'dak' template (5th page: projecten)
const FIELDS_DAK_EXTRA = [
  ['projecten_hero_desc',  'intro zin op de projectenpagina, max 20 woorden'],
  ['projecten_cta_titel',  'call-to-action titel onderaan projectenpagina, max 6 woorden'],
  ['projecten_cta_desc',   'korte CTA tekst, max 20 woorden'],
];

function buildPrompt(naam, bedrijfstype, template, diensten = [], stad = '') {
  const extraFields = template === 'dak' ? FIELDS_DAK_EXTRA : [];
  const allFields   = [...FIELDS_DEFAULT, ...extraFields];

  const fieldLines = allFields
    .map(([key, desc]) => `  "${key}": "<${desc}>"`)
    .join(',\n');

  const dienstenLine = diensten.length
    ? `- Aangeboden diensten: ${diensten.join(', ')}`
    : '';
  const stadLine = stad ? `- Werkgebied: ${stad} en omstreken` : '';

  return `Je bent een Nederlandse copywriter die professionele website-teksten schrijft voor ${bedrijfstype}-bedrijven.

Genereer website content voor het volgende bedrijf:
- Bedrijfsnaam: ${naam}
- Type: ${bedrijfstype}
${dienstenLine}
${stadLine}

Schrijf alle teksten in het Nederlands. Wees direct, professioneel en lokaal georiënteerd.
Gebruik geen generieke uitdrukkingen als "Wij zijn trots op…" of "Met jarenlange ervaring…".
Verwijs specifiek naar de aangeboden diensten en het werkgebied waar relevant.

Geef je antwoord als ALLEEN geldig JSON (geen uitleg, geen markdown codeblok):

{
${fieldLines}
}`;
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY env var not set' });

  const { slug, naam, bedrijfstype, template = 'default', diensten = [], stad = '' } = req.body || {};
  if (!slug || !naam || !bedrijfstype) {
    return res.status(400).json({ error: 'slug, naam en bedrijfstype zijn verplicht' });
  }

  // Call Claude API
  let fields;
  try {
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
        'content-type':      'application/json',
      },
      body: JSON.stringify({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 2048,
        messages: [{ role: 'user', content: buildPrompt(naam, bedrijfstype, template, diensten, stad) }],
      }),
    });

    if (!anthropicRes.ok) {
      const err = await anthropicRes.text();
      throw new Error(`Anthropic API ${anthropicRes.status}: ${err}`);
    }

    const data = await anthropicRes.json();
    const text = data.content?.[0]?.text ?? '';
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
    fields = JSON.parse(cleaned);
  } catch (e) {
    console.error('Claude generation failed:', e.message);
    return res.status(500).json({ error: `Content generation failed: ${e.message}` });
  }

  // Always include bedrijfsnaam + template in the stored data
  fields.bedrijfsnaam = naam;
  fields.template     = template;
  if (stad) fields.stad = stad;

  // Pre-fill DIENST_1…6 from intake selection (first 6 selected services)
  const dienstenArr = Array.isArray(diensten) ? diensten : [];
  for (let i = 0; i < 6; i++) {
    fields[`dienst_${i + 1}`] = dienstenArr[i] || fields[`dienst_${i + 1}`] || '';
  }

  // Save to Supabase client_content so the editor pre-fills on load
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

  return res.status(200).json({ ok: true, slug, fields });
};
