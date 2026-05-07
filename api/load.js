const { extractHomeFields, extractContactFields, extractDienstenFields, extractOverOnsFields } = require('./_extract');

const BASE_URL = 'https://preview.gowebbo.io';

async function fetchHtml(url) {
  try {
    const r = await fetch(url);
    return r.ok ? r.text() : null;
  } catch (_) { return null; }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const slug = (req.query?.slug || '').trim();
  if (!slug) return res.status(400).json({ error: 'slug is required' });

  try {
    const [homeHtml, contactHtml, dienstenHtml, overOnsHtml] = await Promise.all([
      fetchHtml(`${BASE_URL}/${slug}.html`),
      fetchHtml(`${BASE_URL}/${slug}-contact.html`),
      fetchHtml(`${BASE_URL}/${slug}-diensten.html`),
      fetchHtml(`${BASE_URL}/${slug}-over-ons.html`),
    ]);

    if (!homeHtml) return res.status(200).json({ ok: true, data: {} });

    const data = {
      ...extractHomeFields(homeHtml),
      ...extractContactFields(contactHtml),
      ...extractDienstenFields(dienstenHtml),
      ...extractOverOnsFields(overOnsHtml),
    };

    return res.status(200).json({ ok: true, data });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
