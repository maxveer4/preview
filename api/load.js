const { extractHomeFields, extractContactFields, extractDienstenFields, extractOverOnsFields } = require('./_extract');

// Normalize all keys to lowercase so editor getElementById(id) can always match fields.
function normalizeKeys(obj) {
  if (!obj || typeof obj !== 'object') return {};
  const result = {};
  for (const [k, v] of Object.entries(obj)) {
    result[k.toLowerCase()] = v;
  }
  return result;
}

const BASE_URL     = 'https://preview.gowebbo.io';
const SUPABASE_URL = 'https://agdwnlqiepnmxwkrpzqv.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFnZHdubHFpZXBubXh3a3JwenF2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYwNzM4MzAsImV4cCI6MjA5MTY0OTgzMH0.bSw1y5gvVGg1C02AFU-bbfq4rSmy99APILktrlPIf2Y';

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
    // Supabase first: always reflects latest save, no CDN caching delay
    try {
      const [contentRes, clientRes] = await Promise.all([
        fetch(
          `${SUPABASE_URL}/rest/v1/client_content?slug=eq.${encodeURIComponent(slug)}&select=data`,
          { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } },
        ),
        fetch(
          `${SUPABASE_URL}/rest/v1/clients?slug=eq.${encodeURIComponent(slug)}&select=template`,
          { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } },
        ),
      ]);
      if (contentRes.ok) {
        const rows = await contentRes.json();
        if (rows[0]?.data) {
          // Normalize to lowercase so editor getElementById(id) always finds the matching element.
          const data = normalizeKeys(rows[0].data);
          // Enrich data with template type from clients table
          if (clientRes.ok) {
            const clientRows = await clientRes.json();
            if (clientRows[0]?.template) data.template = clientRows[0].template;
          }
          return res.status(200).json({ ok: true, data });
        }
      }
    } catch (_) {}

    // Fallback: extract from CDN HTML (first save or Supabase unavailable)
    const [homeHtml, contactHtml, dienstenHtml, overOnsHtml] = await Promise.all([
      fetchHtml(`${BASE_URL}/${slug}.html`),
      fetchHtml(`${BASE_URL}/${slug}-contact.html`),
      fetchHtml(`${BASE_URL}/${slug}-diensten.html`),
      fetchHtml(`${BASE_URL}/${slug}-over-ons.html`),
    ]);

    if (!homeHtml) return res.status(200).json({ ok: true, data: {} });

    const data = normalizeKeys({
      ...extractHomeFields(homeHtml),
      ...extractContactFields(contactHtml),
      ...extractDienstenFields(dienstenHtml),
      ...extractOverOnsFields(overOnsHtml),
    });

    return res.status(200).json({ ok: true, data });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
