#!/usr/bin/env node
/**
 * convert-template.js
 *
 * Converts a React/Vite template (with GOWEBBO_ marker strings) to plain HTML
 * template files with {{KEY}} placeholders, ready for the GoWebbo CMS system.
 *
 * Usage:
 *   node scripts/convert-template.js <path-to-template-repo> <template-name>
 *
 * Example:
 *   node scripts/convert-template.js ../dak-masterpiece dak
 *
 * The template repo must have a cms-markers.json at its root:
 * {
 *   "routes": {
 *     "/":           "template-dak.html",
 *     "/contact":    "template-dak-contact.html",
 *     "/diensten":   "template-dak-diensten.html",
 *     "/over-ons":   "template-dak-over-ons.html",
 *     "/projecten":  "template-dak-projecten.html"
 *   },
 *   "markers": {
 *     "BEDRIJFSNAAM":        "GOWEBBO_BEDRIJFSNAAM",
 *     "TELEFOON_DISPLAY":    "GOWEBBO_TELEFOON",
 *     "EMAIL":               "GOWEBBO_EMAIL",
 *     "KLEUR_PRIMARY":       "hsl(210,100%,40%)",
 *     "HERO_TITLE":          "GOWEBBO_HERO_TITLE",
 *     "HERO_DESC":           "GOWEBBO_HERO_DESC"
 *   }
 * }
 *
 * After running, the generated template-*.html files appear in the preview-repo root.
 * Review them and manually verify all {{KEY}} placeholders are correctly placed.
 */

'use strict';

const path    = require('path');
const fs      = require('fs');
const { execSync, spawn } = require('child_process');

// ── Args ──────────────────────────────────────────────────────────────────────

const [,, templateRepoArg] = process.argv;
if (!templateRepoArg) {
  console.error('Usage: node scripts/convert-template.js <path-to-template-repo>');
  console.error('Example: node scripts/convert-template.js ../dak-masterpiece');
  process.exit(1);
}

const templateRepo = path.resolve(templateRepoArg);
const previewRepo  = path.resolve(__dirname, '..');

if (!fs.existsSync(templateRepo)) {
  console.error(`Template repo not found: ${templateRepo}`);
  process.exit(1);
}

const markersFile = path.join(templateRepo, 'cms-markers.json');
if (!fs.existsSync(markersFile)) {
  console.error(`cms-markers.json not found in ${templateRepo}`);
  console.error('Create it with "routes" and "markers" — see script header for format.');
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(markersFile, 'utf8'));
const { routes, markers } = config;

if (!routes || !markers) {
  console.error('cms-markers.json must have "routes" and "markers" keys.');
  process.exit(1);
}

// ── Build ─────────────────────────────────────────────────────────────────────

console.log('\n[1/4] Installing dependencies…');
execSync('npm install', { cwd: templateRepo, stdio: 'inherit' });

console.log('\n[2/4] Building…');
execSync('npm run build', { cwd: templateRepo, stdio: 'inherit' });

// ── Start preview server ──────────────────────────────────────────────────────

const PREVIEW_PORT = 4175;
const BASE = `http://localhost:${PREVIEW_PORT}`;

console.log(`\n[3/4] Starting preview server on port ${PREVIEW_PORT}…`);
const server = spawn('npx', ['vite', 'preview', '--port', String(PREVIEW_PORT), '--strictPort'], {
  cwd: templateRepo,
  stdio: ['ignore', 'pipe', 'pipe'],
  shell: true,
});

// Give the server 4 seconds to start
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Playwright render ─────────────────────────────────────────────────────────

async function renderPages() {
  await sleep(4000);

  // Write a temporary playwright script inside the template repo so it can use
  // the playwright installation that's already there.
  // Use .cjs extension so Node treats it as CommonJS even if the template repo
  // has "type": "module" in package.json.
  const playwrightScript = `
const { chromium } = require('@playwright/test');

(async () => {
  const browser = await chromium.launch();
  const page    = await browser.newPage();
  const results = {};

  const routes = ${JSON.stringify(routes)};

  for (const [route, outFile] of Object.entries(routes)) {
    const url = '${BASE}' + (route === '/' ? '' : route);
    await page.goto(url, { waitUntil: 'networkidle' });
    results[outFile] = await page.content();
    console.log('Rendered:', url, '->', outFile);
  }

  await browser.close();
  require('fs').writeFileSync(
    require('path').join(__dirname, '_cms_rendered.json'),
    JSON.stringify(results, null, 2)
  );
})();
`;

  const scriptPath = path.join(templateRepo, '_cms_render_script.cjs');
  fs.writeFileSync(scriptPath, playwrightScript);

  try {
    console.log('\n[4/4] Rendering pages with Playwright…');
    execSync('node _cms_render_script.cjs', { cwd: templateRepo, stdio: 'inherit' });
  } finally {
    fs.unlinkSync(scriptPath);
  }

  const renderedPath = path.join(templateRepo, '_cms_rendered.json');
  const rendered = JSON.parse(fs.readFileSync(renderedPath, 'utf8'));
  fs.unlinkSync(renderedPath);
  return rendered;
}

// ── Apply marker substitution ─────────────────────────────────────────────────

function applyMarkers(html, markers) {
  let out = html;
  for (const [key, markerValue] of Object.entries(markers)) {
    // Escape special regex chars in the marker value
    const escaped = markerValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    out = out.replace(new RegExp(escaped, 'g'), `{{${key}}}`);
  }
  return out;
}

// Build and inject window.GOWEBBO_DATA script block + color override style.
// Both are inserted in <head> before the Vite bundle so React reads them at mount time.
function injectGowebboData(html, markers) {
  const dataObj = Object.keys(markers).reduce((acc, key) => {
    acc[key] = `{{${key}}}`;
    return acc;
  }, {});

  // GOWEBBO_DATA makes all CMS values available to React at runtime.
  const scriptBlock = `<script>window.GOWEBBO_DATA=${JSON.stringify(dataObj)};</script>`;

  // Color override: lets save.js swap --primary without touching the compiled CSS bundle.
  // {{KLEUR_PRIMARY_TAILWIND}} is derived in save.js from {{KLEUR_PRIMARY}} (strips hsl() wrapper).
  const styleBlock = `<style id="gowebbo-colors">:root{--primary:{{KLEUR_PRIMARY_TAILWIND}};--ring:{{KLEUR_PRIMARY_TAILWIND}};}</style>`;

  const injection = styleBlock + '\n' + scriptBlock;

  // Insert before the first <script src=... or <script type=... tag (the Vite bundle)
  return html.replace(/(<script\b(?:[^>]*\bsrc\b|\s+type\s*=)[^>]*>)/, injection + '\n$1');
}

// Copy JS and CSS bundles from dist/assets to preview-repo/public/assets.
// Images are intentionally excluded — they're large and per-client replaceable.
function copyBundleAssets(templateRepo, previewRepo) {
  const src  = path.join(templateRepo, 'dist', 'assets');
  const dest = path.join(previewRepo, 'public', 'assets');
  if (!fs.existsSync(src)) { console.warn('  No dist/assets found — skipping asset copy.'); return; }
  fs.mkdirSync(dest, { recursive: true });
  let copied = 0;
  for (const file of fs.readdirSync(src)) {
    if (/\.(js|css)$/.test(file)) {
      fs.copyFileSync(path.join(src, file), path.join(dest, file));
      copied++;
    }
  }
  console.log(`  Copied ${copied} JS/CSS bundle files → public/assets/`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

(async () => {
  let rendered;
  try {
    rendered = await renderPages();
  } finally {
    server.kill();
  }

  console.log('\nApplying marker substitution and writing template files…\n');

  for (const [outFile, html] of Object.entries(rendered)) {
    let processed = applyMarkers(html, markers);
    processed = injectGowebboData(processed, markers);
    const outPath   = path.join(previewRepo, outFile);
    fs.writeFileSync(outPath, processed, 'utf8');
    console.log(`  Written: ${outFile}`);
  }

  copyBundleAssets(templateRepo, previewRepo);

  console.log('\nDone! Review the generated files and verify {{KEY}} placeholders.');
  console.log('Tip: search for remaining GOWEBBO_ strings to find unmarked fields.\n');
})().catch(err => {
  server.kill();
  console.error('Conversion failed:', err.message);
  process.exit(1);
});
