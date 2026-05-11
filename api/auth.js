module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { password } = req.body || {};
  const expected = process.env.EDITOR_PASSWORD;
  const token    = process.env.EDITOR_TOKEN;

  if (!expected || !token) {
    return res.status(500).json({ error: 'Server niet geconfigureerd (env vars ontbreken)' });
  }

  if (!password || password !== expected) {
    return res.status(401).json({ error: 'Ongeldig wachtwoord' });
  }

  return res.status(200).json({ token });
};
