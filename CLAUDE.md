# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Vergrendelde secties — VERPLICHT LEZEN VOOR BEWERKEN

`section-status.json` in de repo-root bevat de status van elke template: `"todo"`, `"in-progress"` of `"locked"`.

**Regel: bewerk NOOIT een bestand waarvan de sectie als `"locked"` is gemarkeerd, tenzij de gebruiker dit expliciet vraagt.**

Vergrendelen doe je door `"status": "locked"` en `"lockedAt": "YYYY-MM-DD"` in te stellen. Er is geen visuele UI — het JSON bestand direct bewerken.

`section-status.json` dekt alleen `preview` en `modern` templates — `dak`, `bigsite` en `craft` staan er niet in.

---

## Commands

There is no local dev server — this repo is a Vercel serverless API + static HTML files. There are no test commands.

```bash
# Regenerate template HTML from a React/Vite template repo (run from preview-repo/)
node scripts/convert-template.js ../bigsite
node scripts/convert-template.js ../dak-masterpiece
node scripts/convert-template.js ../premium-craft-hero   # craft template

# Test create-website without committing (dry_run mode)
# POST /api/create-website with { "dry_run": true, ... } — returns HTML, no side effects
```

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
stock-photos.json  Stock photo URLs keyed by sector + photo type (hero/waarom/werkwijze/sectie2/diensten)
```

### Data flow

**Intake flow (new website via n8n):**
1. n8n → `POST /api/create-website` → OpenAI `gpt-5.5` generates content → `applyMap()` fills `{{KEY}}` placeholders → GitHub Trees API batch commit (all pages + `clients.json` in one commit) → Vercel auto-deploys

**Editor save flow (gowebbo-studio → api/save):**
1. gowebbo-studio `handleSave()` → `POST /api/save` (all template types including dak)
2. `save.js` loads existing field values from Supabase `client_content` (primary) or CDN HTML fallback (`_extract.js`), merges with incoming data, resolves icon names to SVG (`_icon-map.js`), fills template, commits to GitHub + `gowebbo-klanten`, updates `klanten.website_data`

**Critical difference — template loading:**
- `save.js` reads templates from **local disk** (`fs.readFileSync`) — templates must exist in the repo root
- `create-website.js` fetches templates from **GitHub raw** (`raw.githubusercontent.com`) — always reads the committed version

### Template system

Six template types, selected per client via the `template` field in Supabase `clients`:

| Type | Pages | Template files |
|------|-------|----------------|
| `preview` | 4 | `template.html`, `-contact`, `-diensten`, `-over-ons` |
| `dak` | 5 | `template-dak.html`, `-contact`, `-diensten`, `-over-ons`, `-projecten` |
| `modern` | 5 | `template-modern.html`, `-contact`, `-diensten`, `-over-ons`, `-projecten` |
| `bigsite` | 20 | `template-bigsite.html`, 10 dienst pages, `-contact`, `-over-ons`, `-projecten`, `-ede`, `-wageningen`, stad-3 t/m stad-6 |
| `craft` | 5 | `template-craft.html`, `-contact`, `-diensten`, `-over-ons`, `-projecten` |

Templates use `{{KEY}}` placeholders (all-caps). `applyMap()` does **two passes per key**: first replaces `"{{KEY}}"` (quoted) with a JSON-escaped value (safe inside `window.GOWEBBO_DATA` strings), then replaces bare `{{KEY}}` with the raw value (safe inside JS array literals like `[{{REVIEWS_JSON}}]`). Unknown placeholders are stripped at the end. `applyMap()` is duplicated identically in both `save.js` and `create-website.js`.

`save.js` builds a substitution map from merged fields plus derived values:
- `KLEUR_PRIMARY_TAILWIND` — strips `hsl()` wrapper (space-separated for Tailwind CSS variable)
- `KLEUR_PRIMARY_A10 / A20` — semi-transparent RGBA variants (supports both hex and hsl input)
- `TELEFOON_HREF` / `WHATSAPP_HREF` — derived from `TELEFOON_DISPLAY`
- `LOGO_HTML` / `FAVICON_HTML` — derived from `LOGO_URL` (logo height: 40px default, 90px when `isModern: true`)
- `DIENSTEN_JSON` — always rebuilt from individual `DIENST_N` / `DIENST_N_DESC` / `DIENST_N_FOTO` fields; defaults to `'[]'` if empty (prevents SyntaxError)
- `PROJECTEN_JSON` — defaults to `'[]'` if not provided (prevents `projecten=;` SyntaxError)

`create-website.js` has a `COLOR_MAP` with preset named colors: `geel`, `groen`, `rood`, `blauw` — each stores pre-computed `p`, `a10`, `a20`, `tw` values. If the intake sends a hex/hsl color instead, `save.js`'s runtime derivation handles it.

Editor saves incoming field keys with mixed case; `normalizeKeys()` in `save.js` lowercases all keys before merging so `HERO_TITLE` from AI and `hero_title` from the editor are treated as the same field.

**REVIEWS_JSON format:** editor sends `[{...},{...}]` with outer brackets. `processReviewsJson()` strips the outer `[]` so the template's `const reviews = [{{REVIEWS_JSON}}]` produces a valid array. Never double-wrap.

Templates contain a `<!-- gowebbo-cms: {...} -->` comment prepended by `save.js`; `_extract.js` reads this for field extraction as CDN fallback. `_extract.js` regex patterns only work for static HTML templates (preview/dak/modern) — bigsite content is injected by React at runtime and cannot be regex-extracted. **There is no projecten page extractor** — `_extract.js` covers only home, contact, diensten, and over-ons pages.

**`isModern` flag** injects default values when not already set: `CONTACT_DESC`, `PROJECTEN_CTA_LABEL`, `PROJECTEN_CTA_TITEL`.

### Bigsite stad pages (stad-3 through stad-6)

These pages are **not listed in `_template-config.js` `pages` array** — they are handled by a separate hardcoded loop in `save.js`. Each page's output filename is derived from the city name: `STAD_N` → lowercase slug → `{slug}-{citySlug}.html`. Template files: `template-bigsite-stad-3.html` through `template-bigsite-stad-6.html`. The placeholder `PAGINA_STAD_N_SLUG` is computed and injected into the map so other pages can link to them.

Ede and Wageningen (`-ede`, `-wageningen`) ARE in the `pages` array and have fixed output filenames (`{slug}-ede.html`, `{slug}-wageningen.html`).

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
| `api/create-website.js` | Intake flow: OpenAI gpt-5.5 → fill templates → batch GitHub commit |
| `api/deploy-klanten.js` | One-time deploy endpoint: copies all slug pages to `gowebbo-klanten/{slug}/` for own-domain hosting |
| `api/_template-config.js` | Single source of truth for all template types — required by both save.js and create-website.js |
| `api/_extract.js` | Extracts field values from `<!-- gowebbo-cms: -->` comment in CDN HTML (fallback, static templates only, no projecten extractor) |
| `api/_icon-map.js` | Resolves icon names (e.g. `"wrench"`) to SVG sprite `<use>` references in dak template |
| `scripts/convert-template.js` | Converts a React template repo to `template-*.html` files via Playwright |
| `stock-photos.json` | Sector-keyed stock photo URLs (Supabase storage); used by create-website.js when no client photo provided |

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

## Known pitfalls

**HTML in bigsite GOWEBBO_DATA → SyntaxError:** `create-website.js` converts `*sleutelwoord*` to `<span class="accent">sleutelwoord</span>` for static templates. If this HTML reaches a bigsite `window.GOWEBBO_DATA` JSON block, the `class="accent"` double-quotes break the JavaScript string → SyntaxError → `GOWEBBO_DATA = undefined` → all `cms()` calls return `GOWEBBO_*` placeholder fallback strings as visible text. Strip `*...*` markers to plain text for bigsite; only convert to `<span>` for static HTML templates.

**Template key inconsistency** — the key in `_template-config.js` and Supabase `clients.template` must match exactly. Past bug: `"dak-masterpiece"` vs `"dak"` caused silent Supabase insert failures.

**clients.json not updated** — if a new website is created via `create-website.js` but `clients.json` is not updated, the client won't appear in gowebbo-studio when Supabase fails. `create-website.js` includes `clients.json` in the batch commit.

**Supabase non-fatal pattern** — all Supabase calls are wrapped in try/catch. Silent failures are possible. Always test that the fallback (clients.json or CDN HTML) works correctly.

**Editor query columns** — only query columns that actually exist in the Supabase `clients` table. The `created_at` column may not exist. Use `?select=slug,naam,template&order=naam.asc`.

**addInitScript order** — `page.addInitScript()` must be called on a fresh page **before** `page.goto()`. After navigation it has no effect. Each route needs its own `await browser.newPage()`.

**React Router v6 bigsite** — use static routes (`/dienst-1` through `/dienst-10`), not dynamic route `/dienst-:n`. React Router v6 params don't work directly after `/` without a prefix.

**GitHub batch commit retries** — `githubBatchCommit()` uses the Trees API. On 422 non-fast-forward it retries 3× with exponential backoff. Individual `githubUpsert()` calls also retry once on 409/422 (stale SHA).

**KLEUR_PRIMARY disappears** — in gowebbo-studio: if `kleur_thema` is null in Supabase and no `kleur_primary` column value exists, the color disappears after the first save. Workaround: set hex color manually via the Algemeen tab.

**Markers prefix collision** — when adding a new marker in `cms-markers.json`: the marker string must be longer than all markers it is a prefix of. `convert-template.js` sorts by descending length, but names in the React component must also be unique enough.

**CSS bundle overrides color** — `convert-template.js` injects the `<style>` with CSS variables always just before `</head>`, ensuring it comes after the Vite CSS bundle and is not overridden.

**Bigsite stad-content mismatch** — the AI sometimes generates `STAD_3_SECTIE_TITEL` with the wrong city name. Post-processing in `create-website.js` re-sorts sections based on which city name appears in the title. If you add new per-stad fields, add them to the post-processing logic too.

**Bigsite stad-3 through stad-6 are not in `_template-config.js`** — they are generated by a hardcoded loop in `save.js` and `create-website.js`. Adding new per-stad fields requires updating both files, not just `_template-config.js`.
