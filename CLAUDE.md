# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

GoWebbo CMS — a Vercel-hosted system that generates and serves Dutch trade-business websites (dakdekkers, loodgieters, schilders, etc.). The API generates and saves HTML from templates to GitHub, triggering Vercel deploys.

Live URL: `https://preview.gowebbo.io/{slug}.html`

The editor is **not** in this repo — it lives in `gowebbo-studio/` (Cloudflare Workers, TanStack Start).

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
1. gowebbo-studio `handleSave()` → `POST /api/save` (for `preview`, `modern`, `bigsite` templates)
2. `save.js` loads existing field values from Supabase `client_content` (primary) or CDN HTML fallback (`_extract.js`), merges with incoming data, fills template, commits to GitHub + `gowebbo-klanten`

**dak template saves differently:** gowebbo-studio routes dak saves through its own n8n webhook instead of `api/save`.

### Template system

Four template types, selected per client via the `template` field in Supabase `clients`:

| Type | Pages | Template files |
|------|-------|----------------|
| `preview` | 4 | `template.html`, `-contact`, `-diensten`, `-over-ons` |
| `dak` | 5 | `template-dak.html`, `-contact`, `-diensten`, `-over-ons`, `-projecten` |
| `modern` | 5 | `template-modern.html`, `-contact`, `-diensten`, `-over-ons`, `-projecten` |
| `bigsite` | 17 | `template-bigsite.html`, 10 dienst pages, `-contact`, `-over-ons`, `-projecten`, `-werkgebied`, `-ede`, `-wageningen` |

Templates use `{{KEY}}` placeholders (all-caps). `save.js` builds a substitution map from merged fields plus derived values:
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
| `api/create-website.js` | Intake flow: Claude AI → fill templates → batch GitHub commit |
| `api/_extract.js` | Extracts field values from `<!-- gowebbo-cms: -->` comment in CDN HTML (fallback) |
| `scripts/convert-template.js` | Converts a React template repo to `template-*.html` files |

## Environment variables (Vercel)

| Variable | Purpose |
|----------|---------|
| `GITHUB_TOKEN` | PAT for `maxveer4/preview` and `maxveer4/gowebbo-klanten` |
| `ANTHROPIC_API_KEY` | Claude API for content generation in `create-website.js` |

## GitHub persistence

`githubUpsert` (save.js) GETs the current SHA then PUTs new content. Retries once on 409/422 (stale SHA). The PUT to `maxveer4/preview` triggers Vercel auto-deploy; the PUT to `maxveer4/gowebbo-klanten` is non-fatal (only updates if file already exists there).

`githubBatchCommit` (create-website.js) uses the Trees API to commit all files in one operation — critical for bigsite (17+ files). Retries 3× on 422 non-fast-forward with exponential backoff.

## Supabase tables

- `clients` — `slug` (PK), `naam`, `template`
- `client_content` — `slug` (PK), `data` (jsonb), `updated_at`

The anon key is embedded in the API source files (public read-write key scoped to these tables by RLS).
