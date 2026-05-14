# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this repo is

GoWebbo CMS — a Vercel-hosted system that generates and serves Dutch trade-business websites (dakdekkers, loodgieters, schilders, etc.). The editor lets users fill in client details; the API generates HTML from templates and commits it to GitHub, triggering a Vercel deployment.

Live URLs:
- Editor: `https://preview.gowebbo.io/editor`
- Client preview: `https://preview.gowebbo.io/{slug}.html`

## Architecture

```
api/           Vercel serverless functions (Node.js)
public/        Static files served directly (client HTML + editor SPA)
  editor/      CMS editor SPA (index.html entry + editor.html)
  assets/      Compiled JS/CSS bundles from template repos
  clients.json Client registry (slug + naam)
scripts/       CLI tools (run locally, not deployed)
template*.html Master templates with {{KEY}} placeholders
```

### Data flow

1. **New client** → `POST /api/new-client` → registers in Supabase `clients` table
2. **Generate AI content** → `POST /api/generate-content` → Claude Haiku → saves to Supabase `client_content`
3. **Editor loads** → `GET /api/load?slug=X` → reads from Supabase (primary) or CDN HTML (fallback)
4. **Save** → `POST /api/save` → merges fields, fills `{{KEY}}` in template HTML, commits to `maxveer4/preview` (triggers Vercel) + `maxveer4/gowebbo-klanten`
5. **Public access** → Vercel serves `/public/{slug}.html` via CDN

### Template system

Two template sets, selected per client via the `template` field in Supabase `clients`:
- `default` — 4 pages: `template.html`, `template-contact.html`, `template-diensten.html`, `template-over-ons.html`
- `dak` — 5 pages: same with `template-dak-` prefix + `template-dak-projecten.html`

Templates use `{{KEY}}` placeholders (all-caps). `save.js` builds a substitution map from the merged client fields (keys are uppercased), plus derived values:
- `KLEUR_PRIMARY_TAILWIND` — derived from `KLEUR_PRIMARY` (strips `hsl()` wrapper)
- `TELEFOON_HREF` / `WHATSAPP_HREF` — derived from `TELEFOON_DISPLAY`
- `LOGO_HTML` / `FAVICON_HTML` — derived from `LOGO_URL`

Templates also contain a `<!-- gowebbo-cms: {...} -->` comment prepended by `save.js`; `_extract.js` reads this for field extraction in subsequent loads.

### Generating new template HTML files

When the React/Vite template repo changes, regenerate the `template-*.html` files:

```bash
node scripts/convert-template.js ../dak-masterpiece
```

This builds the Vite app, renders pages with Playwright, substitutes `GOWEBBO_*` markers with `{{KEY}}` placeholders, injects `window.GOWEBBO_DATA` and the color override `<style>`, and copies JS/CSS bundles to `public/assets/`. The template repo must have a `cms-markers.json` at its root (see script header for format).

## Key files

| File | Role |
|------|------|
| `api/save.js` | Core: field merging, template substitution, GitHub commits, Supabase sync |
| `api/_extract.js` | Extracts field values from rendered HTML (used by load.js) |
| `api/load.js` | Pre-fills editor from Supabase or CDN HTML |
| `api/generate-content.js` | Calls Claude Haiku to generate all 60+ copy fields |
| `api/new-client.js` | Registers a new client in Supabase |
| `api/auth.js` | Password check for editor login |
| `scripts/convert-template.js` | Converts a React template repo to `template-*.html` |
| `stock-photos.json` | Stock photo URLs by trade type and slot (hero, waarom, werkwijze, diensten) |

## Environment variables (Vercel)

| Variable | Purpose |
|----------|---------|
| `GITHUB_TOKEN` | PAT for `maxveer4/preview` and `maxveer4/gowebbo-klanten` |
| `ANTHROPIC_API_KEY` | Claude API for content generation |
| `EDITOR_PASSWORD` | Login password for the editor |

## GitHub persistence

`githubUpsert` (save.js) GETs the current SHA then PUTs new content. It retries once on 409/422 (stale SHA from concurrent saves). Failures throw and return HTTP 500 to the editor. The PUT to `maxveer4/preview` triggers Vercel auto-deploy; the PUT to `maxveer4/gowebbo-klanten` is non-fatal (only updates if file already exists there).

## Supabase tables

- `clients` — columns: `slug` (PK), `naam`, `template`
- `client_content` — columns: `slug` (PK), `data` (jsonb), `updated_at`

The anon key is embedded in the API source files (it's a public read-write key scoped to these tables by RLS).
