'use strict';

const PREVIEW_REPO   = 'maxveer4/preview';
const KLANTEN_REPO   = 'maxveer4/gowebbo-klanten';
const BRANCH         = 'main';
const PREVIEW_ORIGIN = 'https://preview.gowebbo.io';

// Batch-commit multiple files to any GitHub repo via the Trees API.
async function githubBatchCommit(token, repo, files, message) {
  const base = `https://api.github.com/repos/${repo}`;
  const h = {
    Authorization: `token ${token}`,
    'Content-Type': 'application/json',
    Accept:         'application/vnd.github.v3+json',
    'User-Agent':   'gowebbo-deploy/1.0',
  };

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const latestSha  = (await (await fetch(`${base}/git/refs/heads/${BRANCH}`, { headers: h })).json()).object.sha;
      const baseTree   = (await (await fetch(`${base}/git/commits/${latestSha}`,  { headers: h })).json()).tree.sha;

      const treeItems = await Promise.all(
        Object.entries(files).map(async ([path, content]) => {
          const r = await fetch(`${base}/git/blobs`, {
            method: 'POST', headers: h,
            body: JSON.stringify({ content: Buffer.from(content).toString('base64'), encoding: 'base64' }),
          });
          if (!r.ok) throw new Error(`blob voor ${path} mislukt: ${r.status}`);
          return { path, mode: '100644', type: 'blob', sha: (await r.json()).sha };
        })
      );

      const newTree   = (await (await fetch(`${base}/git/trees`, {
        method: 'POST', headers: h,
        body: JSON.stringify({ base_tree: baseTree, tree: treeItems }),
      })).json()).sha;

      const newCommit = (await (await fetch(`${base}/git/commits`, {
        method: 'POST', headers: h,
        body: JSON.stringify({ message, tree: newTree, parents: [latestSha] }),
      })).json()).sha;

      const upd = await fetch(`${base}/git/refs/heads/${BRANCH}`, {
        method: 'PATCH', headers: h,
        body: JSON.stringify({ sha: newCommit }),
      });
      if (upd.ok) return;
      if (upd.status === 422 && attempt < 2) {
        await new Promise(r => setTimeout(r, 600 * (attempt + 1)));
        continue;
      }
      throw new Error(`ref update mislukt: ${upd.status}`);
    } catch (e) {
      if (attempt < 2) { await new Promise(r => setTimeout(r, 600 * (attempt + 1))); continue; }
      throw e;
    }
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).end();

  const { slug } = req.body ?? {};
  if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
    return res.status(400).json({ error: 'Ongeldige slug' });
  }

  const token = process.env.GITHUB_TOKEN;
  const ghHeaders = {
    Authorization: `token ${token}`,
    'User-Agent':  'gowebbo-deploy/1.0',
    Accept:        'application/vnd.github.v3+json',
  };

  // 1. Haal directory-listing van preview/public op via de Trees API (geen 1000-item limiet)
  // De Contents API trunceert stilletjes bij 1000 bestanden — de Trees API niet.
  const refRes = await fetch(
    `https://api.github.com/repos/${PREVIEW_REPO}/git/refs/heads/${BRANCH}`,
    { headers: ghHeaders }
  );
  if (!refRes.ok) {
    return res.status(502).json({ error: 'Kon preview repo niet bereiken' });
  }
  const latestSha = (await refRes.json()).object.sha;

  const commitRes = await fetch(
    `https://api.github.com/repos/${PREVIEW_REPO}/git/commits/${latestSha}`,
    { headers: ghHeaders }
  );
  const rootTreeSha = (await commitRes.json()).tree.sha;

  const rootTreeRes = await fetch(
    `https://api.github.com/repos/${PREVIEW_REPO}/git/trees/${rootTreeSha}`,
    { headers: ghHeaders }
  );
  const rootTree = (await rootTreeRes.json()).tree;
  const publicEntry = rootTree.find(e => e.path === 'public' && e.type === 'tree');
  if (!publicEntry) {
    return res.status(502).json({ error: 'public/ directory niet gevonden in preview repo' });
  }

  const publicTreeRes = await fetch(
    `https://api.github.com/repos/${PREVIEW_REPO}/git/trees/${publicEntry.sha}`,
    { headers: ghHeaders }
  );
  const publicTree = (await publicTreeRes.json()).tree;

  // Filter: alleen HTML bestanden die bij deze slug horen
  const slugEntries = publicTree.filter(e =>
    e.type === 'blob' && e.path.endsWith('.html') &&
    (e.path === `${slug}.html` || e.path.startsWith(`${slug}-`))
  );

  if (!slugEntries.length) {
    return res.status(404).json({
      error: `Geen HTML-bestanden gevonden voor "${slug}". Sla de website eerst op via de editor.`,
    });
  }

  // 2. Haal alle bestanden parallel op via blob SHA
  const fetched = await Promise.allSettled(
    slugEntries.map(async entry => {
      const r = await fetch(
        `https://api.github.com/repos/${PREVIEW_REPO}/git/blobs/${entry.sha}`,
        { headers: ghHeaders }
      );
      if (!r.ok) throw new Error(`${entry.path}: HTTP ${r.status}`);
      const { content: b64, encoding } = await r.json();
      if (encoding !== 'base64') throw new Error(`${entry.path}: onverwachte encoding ${encoding}`);
      return { name: entry.path, html: Buffer.from(b64, 'base64').toString('utf-8') };
    })
  );

  const filesToCommit = {};
  const redirects     = [];

  for (const result of fetched) {
    if (result.status === 'rejected') {
      console.warn('[deploy-klanten] bestand overgeslagen:', result.reason?.message);
      continue;
    }
    const { name, html: rawHtml } = result.value;

    // Vervang /assets/ door absolute CDN-URL (bundles staan op preview.gowebbo.io)
    let html = rawHtml
      .split('href="/assets/').join(`href="${PREVIEW_ORIGIN}/assets/`)
      .split('src="/assets/').join(`src="${PREVIEW_ORIGIN}/assets/`);

    // Pad in klanten repo + Vercel redirects
    if (name === `${slug}.html`) {
      filesToCommit[`${slug}/index.html`] = html;
      redirects.push(
        { source: `/${slug}.html`, destination: '/', permanent: false },
        { source: `/${slug}`,      destination: '/', permanent: false },
      );
    } else {
      const pageName = name.slice(`${slug}-`.length); // bv. "contact.html"
      const pageSlug = pageName.replace('.html', '');
      filesToCommit[`${slug}/${pageName}`] = html;
      redirects.push(
        { source: `/${slug}-${pageSlug}.html`, destination: `/${pageSlug}.html`, permanent: false },
        { source: `/${slug}-${pageSlug}`,      destination: `/${pageSlug}`,      permanent: false },
      );
    }
  }

  if (!Object.keys(filesToCommit).length) {
    return res.status(500).json({ error: 'Alle bestanden konden niet worden opgehaald' });
  }

  // vercel.json: clean URLs + redirects zodat oude /{slug}-page.html links werken
  filesToCommit[`${slug}/vercel.json`] = JSON.stringify(
    { cleanUrls: true, redirects },
    null, 2
  );

  // 3. Batch commit naar gowebbo-klanten
  try {
    await githubBatchCommit(
      token,
      KLANTEN_REPO,
      filesToCommit,
      `deploy(${slug}): ${Object.keys(filesToCommit).length - 1} pagina's naar eigen domein`
    );
  } catch (e) {
    console.error('[deploy-klanten] commit mislukt:', e.message);
    return res.status(500).json({ error: `GitHub commit mislukt: ${e.message}` });
  }

  return res.status(200).json({
    ok: true,
    slug,
    fileCount: Object.keys(filesToCommit).length - 1,
    githubUrl: `https://github.com/${KLANTEN_REPO}/tree/main/${slug}`,
  });
};
