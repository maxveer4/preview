const SUPABASE_URL = 'https://agdwnlqiepnmxwkrpzqv.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFnZHdubHFpZXBubXh3a3JwenF2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwNzM4MzAsImV4cCI6MjA5MTY0OTgzMH0.bSw1y5gvVGg1C02AFU-bbfq4rSmy99APILktrlPIf2Y';
const REPO   = 'maxveer4/preview';
const BRANCH = 'main';

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const token = process.env.GITHUB_TOKEN;
  if (!token) return res.status(500).json({ error: 'GITHUB_TOKEN env var not set' });

  const { slug, naam, template = 'default' } = req.body || {};
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
    body: JSON.stringify({ slug, naam, template }),
  }).catch(() => {});

  // Also add to clients.json on GitHub so the editor fallback always shows new clients
  try {
    const REPO = 'maxveer4/preview';
    const FILE = 'public/clients.json';
    const headers = {
      Authorization: `token ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'gowebbo-new-client/1.0',
    };
    const getRes = await fetch(`https://api.github.com/repos/${REPO}/contents/${FILE}`, { headers });
    if (getRes.ok) {
      const { content, sha } = await getRes.json();
      const existing = JSON.parse(Buffer.from(content, 'base64').toString('utf8'));
      if (!existing.some(c => c.slug === slug)) {
        existing.unshift({ slug, naam });
        await fetch(`https://api.github.com/repos/${REPO}/contents/${FILE}`, {
          method: 'PUT',
          headers,
          body: JSON.stringify({
            message: `Add client ${slug}`,
            content: Buffer.from(JSON.stringify(existing, null, 4)).toString('base64'),
            sha,
            branch: 'main',
          }),
        });
      }
    }
  } catch (_) {}

  return res.status(200).json({ ok: true, slug, naam, template });
};
