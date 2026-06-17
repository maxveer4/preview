'use strict';

/**
 * Single source of truth for all template types.
 * Required by save.js and create-website.js.
 *
 * ── HOW TO ADD A NEW TEMPLATE ────────────────────────────────────────────────
 * 1. Add an entry here (prefix, pages, dienstCount, flags)
 * 2. Create the template-*.html files in the preview-repo root
 *    - If React-based: add cms-markers.json to the template repo,
 *      run `node scripts/convert-template.js ../your-template-repo` from preview-repo
 * 3. Update FIELD_SCHEMA in gowebbo-studio/src/routes/editor.$slug.tsx
 *    if the new template needs extra editor fields
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * pages:       Suffixes appended to prefix. '' = homepage.
 *              Template file → {prefix}{suffix}.html
 *              Output file   → {slug}{suffix}.html  ('' → {slug}.html)
 *
 * dienstCount: Number of dynamic dienst pages generated (bigsite = 10, others = 0).
 *              Template files: {prefix}-dienst-1.html … {prefix}-dienst-N.html
 *              Output files:   {slug}-{dienstSlug}.html (slug from AI-generated name)
 *
 * isModern:    Enables larger logo (90px) in save.js + extra AI prompt fields.
 * isBigsite:   Enables per-dienst page AI content in create-website.js buildPrompt().
 */

const TEMPLATES = {
  preview: {
    prefix:      'template',
    pages:       ['', '-contact', '-diensten', '-over-ons'],
    dienstCount: 0,
  },
  dak: {
    prefix:      'template-dak',
    pages:       ['', '-contact', '-diensten', '-over-ons', '-projecten'],
    dienstCount: 0,
  },
  modern: {
    prefix:      'template-modern',
    pages:       ['', '-contact', '-diensten', '-over-ons', '-projecten'],
    dienstCount: 0,
    isModern:    true,
  },
  bigsite: {
    prefix:      'template-bigsite',
    pages:       ['', '-contact', '-over-ons', '-projecten', '-werkgebied', '-ede', '-wageningen'],
    dienstCount: 10,
    isBigsite:   true,
  },
};

const DEFAULT_TEMPLATE = 'preview';

module.exports = { TEMPLATES, DEFAULT_TEMPLATE };
