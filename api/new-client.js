const SUPABASE_URL = 'https://agdwnlqiepnmxwkrpzqv.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFnZHdubHFpZXBubXh3a3JwenF2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwNzM4MzAsImV4cCI6MjA5MTY0OTgzMH0.bSw1y5gvVGg1C02AFU-bbfq4rSmy99APILktrlPIf2Y';
const REPO   = 'maxveer4/preview';
const BRANCH = 'main';

async function updateClientsJson(token, slug, naam) {
  const url     = `https://api.github.com/repos/${REPO}/contents/public/clients.json`;
  const headers = {
    Authorization: `token ${token}`,
    'Content-Type': 'application/json',
    Accept: 'application/vnd.github.v3+json',
    'User-Agent': 'gowebbo-editor/1.0',
  };

  const getRes = await fetch(url, { headers });
  if (!getRes.ok) throw new Error(`GitHub GET mislukt: ${getRes.status}`);
  const existing = await getRes.json();

  const clients = JSON.parse(Buffer.from(existing.content, 'base64').toString('utf8'));

  const alreadyExists = clients.some(c => c.slug === slug);
  if (!alreadyExists) {
    clients.push({ slug, naam });
    clients.sort((a, b) => a.naam.toLowerCase().localeCompare(b.naam.toLowerCase()));
  }

  const putRes = await fetch(url, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      message: `Voeg ${naam} toe aan clients.json`,
      content: Buffer.from(JSON.stringify(clients, null, 4)).toString('base64'),
      sha:     existing.sha,
      branch:  BRANCH,
    }),
  });
  if (!putRes.ok) throw new Error(`GitHub PUT mislukt: ${putRes.status} ${await putRes.text()}`);
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const token = process.env.GITHUB_TOKEN;
  if (!token) return res.status(500).json({ error: 'GITHUB_TOKEN env var not set' });

  const { slug, naam } = req.body || {};
  if (!slug || !naam) {
    return res.status(400).json({ error: 'slug en naam zijn verplicht' });
  }

  // Supabase insert (niet-fataal als het mislukt)
  await fetch(`${SUPABASE_URL}/rest/v1/clients`, {
    method: 'POST',
    headers: {
      apikey:         SUPABASE_KEY,
      Authorization:  `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer:         'resolution=ignore-duplicates',
    },
    body: JSON.stringify({ slug, naam }),
  }).catch(() => {});

  // clients.json bijwerken in GitHub (de fallback die het dashboard laadt)
  try {
    await updateClientsJson(token, slug, naam);
  } catch (err) {
    return res.status(500).json({ error: 'clients.json update mislukt', detail: err.message });
  }

  return res.status(200).json({ ok: true, slug, naam });
};
