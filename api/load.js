const { extractFields } = require('./_extract');

const BASE_URL = 'https://preview.gowebbo.io';

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const slug = (req.query?.slug || '').trim();
  if (!slug) return res.status(400).json({ error: 'slug is required' });

  try {
    const r = await fetch(`${BASE_URL}/${slug}.html`);
    if (!r.ok) return res.status(200).json({ ok: true, data: {} });

    const html = await r.text();
    const data = extractFields(html);
    return res.status(200).json({ ok: true, data });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
