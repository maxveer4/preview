# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Vergrendelde secties — VERPLICHT LEZEN VOOR BEWERKEN

`section-status.json` in de repo-root bevat de status van elke template: `"todo"`, `"in-progress"` of `"locked"`.

**Regel: bewerk NOOIT een bestand waarvan de sectie als `"locked"` is gemarkeerd, tenzij de gebruiker dit expliciet vraagt.**

Vergrendelen doe je door `"status": "locked"` en `"lockedAt": "YYYY-MM-DD"` in te stellen. Er is geen visuele UI — het JSON bestand direct bewerken.

---

## What this repo is

GoWebbo CMS — a Vercel-hosted system that generates and serves Dutch trade-business websites (dakdekkers, loodgieters, schilders, etc.). The API generates and saves HTML from templates to GitHub, triggering Vercel deploys.

Live URL: `https://preview.gowebbo.io/{slug}.html`

The editor is **not** in this repo — it lives in `gowebbo-studio/` (TanStack Start SPA, deployed on Vercel).

## Architecture

```
api/           Vercel serverless functions (Node.js)
public/        Static files served via CDN
  assets/      Compiled JS/CSS bundles from template repos
  clients.json Client registry (slug + naam) — fallback if Supabase query fails
  *.html       Generated client sites (one or more files per slug)
scripts/       CLI tools (run locally, not deployed)
template*.html Master templates with {{KEY}} placeholders
```

### Data flow

**Intake flow (new website via n8n):**
1. n8n → `POST /api/create-website` → Claude AI generates content → `applyMap()` fills `{{KEY}}` placeholders → GitHub Trees API batch commit (all pages + `clients.json` in one commit) → Vercel auto-deploys

**Editor save flow (gowebbo-studio → api/save):**
1. gowebbo-studio `handleSave()` → `POST /api/save` (all template types including dak)
2. `save.js` loads existing field values from Supabase `client_content` (primary) or CDN HTML fallback (`_extract.js`), merges with incoming data, resolves icon names to SVG (`_icon-map.js`), fills template, commits to GitHub + `gowebbo-klanten`, updates `klanten.website_data`

### Template system

Four template types, selected per client via the `template` field in Supabase `clients`:

| Type | Pages | Template files |
|------|-------|----------------|
| `preview` | 4 | `template.html`, `-contact`, `-diensten`, `-over-ons` |
| `dak` | 5 | `template-dak.html`, `-contact`, `-diensten`, `-over-ons`, `-projecten` |
| `modern` | 5 | `template-modern.html`, `-contact`, `-diensten`, `-over-ons`, `-projecten` |
| `bigsite` | 20 | `template-bigsite.html`, 10 dienst pages, `-contact`, `-over-ons`, `-projecten`, `-ede`, `-wageningen`, stad-3 t/m stad-6 (dynamic slug) |

Templates use `{{KEY}}` placeholders (all-caps). `applyMap()` does **two passes per key**: first replaces `"{{KEY}}"` (quoted) with a JSON-escaped value (safe inside `window.GOWEBBO_DATA` strings), then replaces bare `{{KEY}}` with the raw value (safe inside JS array literals like `[{{REVIEWS_JSON}}]`). Unknown placeholders are stripped at the end.

`save.js` builds a substitution map from merged fields plus derived values:
- `KLEUR_PRIMARY_TAILWIND` — strips `hsl()` wrapper (space-separated for Tailwind CSS variable)
- `KLEUR_PRIMARY_A10 / A20` — semi-transparent RGBA variants
- `TELEFOON_HREF` / `WHATSAPP_HREF` — derived from `TELEFOON_DISPLAY`
- `LOGO_HTML` / `FAVICON_HTML` — derived from `LOGO_URL`

Templates contain a `<!-- gowebbo-cms: {...} -->` comment prepended by `save.js`; `_extract.js` reads this for field extraction as CDN fallback.

### Generating new template HTML files

When a React/Vite template repo (`../bigsite`, `../dak-masterpiece`) changes, regenerate:

```bash
# From preview-repo/
node scripts/convert-template.js ../bigsite
node scripts/convert-template.js ../dak-masterpiece
```

This builds the Vite app, renders pages with Playwright (`addInitScript` sets `window.GOWEBBO_DATA.PAGE` before React mounts), substitutes `GOWEBBO_*` markers with `{{KEY}}` placeholders, injects `window.GOWEBBO_DATA` and the color override `<style>`, and copies JS/CSS bundles to `public/assets/`.

## Key files

| File | Role |
|------|------|
| `api/save.js` | Core: field merging, template substitution, dual GitHub commit (preview + klanten repo) |
| `api/create-website.js` | Intake flow: GPT-5.5 AI → fill templates → batch GitHub commit |
| `api/deploy-klanten.js` | One-time deploy endpoint: copies all slug pages to `gowebbo-klanten/{slug}/` for own-domain hosting |
| `api/_template-config.js` | Single source of truth for all template types — required by both save.js and create-website.js |
| `api/_extract.js` | Extracts field values from `<!-- gowebbo-cms: -->` comment in CDN HTML (fallback) |
| `api/_icon-map.js` | Resolves icon names (e.g. `"wrench"`) to SVG sprite `<use>` references in dak template |
| `scripts/convert-template.js` | Converts a React template repo to `template-*.html` files via Playwright |

## Environment variables (Vercel)

| Variable | Purpose |
|----------|---------|
| `GITHUB_TOKEN` | PAT for `maxveer4/preview` and `maxveer4/gowebbo-klanten` |
| `OPENAI_API_KEY` | OpenAI API for content generation in `create-website.js` (uses `gpt-5.5`) |
| `SUPABASE_ANON_KEY` | Optional override; anon key is hardcoded as fallback in all API files |

## Vercel config (`vercel.json`)

- `api/create-website.js` has `maxDuration: 300` (bigsite generation + AI can take ~60–120s)
- All requests rewrite to `/public/$1` — so `https://preview.gowebbo.io/slug.html` serves `public/slug.html`

## GitHub persistence

`githubUpsert` (save.js) GETs the current SHA then PUTs new content. Retries once on 409/422 (stale SHA). The PUT to `maxveer4/preview` triggers Vercel auto-deploy.

**gowebbo-klanten sync (save.js):** After every editor save, ALL generated HTML files are synced to `maxveer4/gowebbo-klanten/{slug}/` via `githubUpdateIfExists` (non-fatal, skips if file doesn't exist yet). Path mapping: `{slug}.html` → `{slug}/index.html`, `{slug}-contact.html` → `{slug}/contact.html`, etc. Asset paths (`/assets/...`) are rewritten to absolute `https://preview.gowebbo.io/assets/...` URLs so the JS/CSS bundles load correctly on own-domain deployments. Covers all pages including bigsite's dynamic dienst and stad pages.

**deploy-klanten.js:** One-time endpoint called from the editor "Eigen domein" button. Fetches all `{slug}*.html` from `maxveer4/preview/public/`, applies the same asset path fix + path mapping, generates a `vercel.json` with `cleanUrls: true` and redirects from old `/{slug}-page` URLs, then batch-commits everything to `gowebbo-klanten`. After this initial deploy, every editor save keeps the klanten folder in sync automatically.

`githubBatchCommit` (create-website.js + deploy-klanten.js) uses the Trees API to commit all files in one operation — critical for bigsite (20+ files). Retries 3× on 422 non-fast-forward with exponential backoff.

**Vercel trigger workaround:** The Trees API batch commit doesn't reliably trigger Vercel's deploy webhook. After the batch, `create-website.js` does a separate `githubUpsert` to `public/_last-generated.txt` to guarantee Vercel picks up the new files.

**`dry_run` mode:** `create-website.js` accepts `{ dry_run: true }` in the POST body. It generates all HTML and returns `{ ok, slug, files, html }` without any GitHub commits, Supabase writes, or GHL notifications — useful for testing content generation.

**GoHighLevel webhook:** After a successful website creation, `create-website.js` POSTs a WhatsApp-style notification to GHL (`services.leadconnectorhq.com`) with the new site URL. Non-fatal.

## Supabase tables

- `clients` — `slug` (PK), `naam`, `template` — read by save.js to look up template type
- `client_content` — `slug` (PK), `data` (jsonb), `updated_at` — primary field store for save.js
- `klanten` — `slug`, `website_data` (jsonb), `ai_content` (jsonb) — read/written by save.js so gowebbo-studio editor reloads correct state

The anon key is embedded in the API source files (public read-write key scoped to these tables by RLS).
