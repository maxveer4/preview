# Website Generatie & Edit Flow — Gowebbo CMS

## Overzicht van de templates

| Template       | Intake waarde      | Pagina's | Type                              |
|----------------|--------------------|----------|-----------------------------------|
| Regulier       | `preview`          | 4        | Pure static HTML met `{{KEY}}`    |
| Dak            | `dak-masterpiece`  | 5        | Pure static HTML met `{{KEY}}`    |
| Modern         | `modern`           | 5        | Pure static HTML met `{{KEY}}`    |
| Airco (bigsite)| `bigsite`          | 9        | Static shell + React bundle + `window.GOWEBBO_DATA` |

---

## 1. Generatiestroom (intake → live website)

**Bestand:** `api/create-website.js`  
**Aanroep:** Intake formulier (`testhook`) → `POST https://preview.gowebbo.io/api/create-website`

### Stap-voor-stap

```
Intake formulier verzendt:
  bedrijfsnaam, stad, sector, diensten, kleur_thema, template_keuze, foto_logo, etc.
        │
        ▼
create-website.js
  ┌─ Claude Haiku API (parallel met template fetch)
  │    - Prompt bevat bedrijfsinfo + JSON schema voor alle tekstvelden
  │    - Geeft JSON terug: HERO_TITLE, SERVICE_DESC, REVIEWS_JSON, etc.
  │    - max_tokens: 4000 (genoeg voor regulier/dak/modern; bigsite heeft meer nodig)
  │
  ├─ Template fetch (parallel met Claude)
  │    - GET raw.githubusercontent.com/maxveer4/preview/main/template-{type}.html
  │    - Alle pagina's van het template worden tegelijk opgehaald
  │
  ├─ Placeholder map opbouwen
  │    - AI-velden:  HERO_TITLE, SERVICE_DESC, USP_1, REVIEWS_JSON, etc.
  │    - Berekend:   SLUG, TELEFOON_HREF, WHATSAPP_HREF, LOGO_HTML, FAVICON_HTML
  │    - Kleuren:    KLEUR_PRIMARY, KLEUR_PRIMARY_A10/A20, KLEUR_PRIMARY_TAILWIND (bigsite)
  │    - Fotos:      FOTO_HERO, FOTO_WAAROM, FOTO_USP, FOTO_WERKWIJZE
  │    - Diensten:   DIENSTEN_JSON, DIENST_1–6
  │
  ├─ applyMap(template, map)
  │    - Vervangt elk {{KEY}} met de waarde uit de map (plain split/join)
  │    - Dezelfde functie voor ALLE templates
  │
  ├─ GitHub push (sequentieel per pagina)
  │    - GET bestand voor SHA (als bestand al bestaat)
  │    - PUT nieuw bestand naar public/{slug}-{pagina}.html
  │    - Triggert automatisch Vercel deploy
  │
  └─ Supabase opslaan
       - `clients` tabel: slug, naam, template_keuze
       - `klanten` tabel: alle klantgegevens + AI content
```

### Welke `{{KEY}}`s zijn er?

De templates (regulier/dak/modern) gebruiken placeholders direct in de HTML:

```html
<title>{{SEO_TITLE}}</title>
<h1 class="hero-title">{{HERO_TITLE}}</h1>
<p class="hero-desc">{{HERO_DESC}}</p>
--primary: {{KLEUR_PRIMARY}};
const reviews = [{{REVIEWS_JSON}}];   ← let op: template plaatst [] eromheen
var diensten = {{DIENSTEN_JSON}};     ← JSON.stringify() geeft al [] mee
```

**REVIEWS_JSON formaat voor regulier/dak/modern:**
- `reviewsForTemplate = JSON.stringify(arr).slice(1, -1)` → strips outer `[]`
- Template doet `const reviews = [{{REVIEWS_JSON}}]` → array is compleet

---

## 2. Editstroom (editor → live update)

**Bestand:** `api/save.js`  
**Aanroep:** CMS editor → `POST https://preview.gowebbo.io/api/save`

### Stap-voor-stap

```
Editor (preview.gowebbo.io/editor) verzendt:
  { slug, website_data: { hero_title: "...", service_desc: "...", ... } }
        │
        ▼
save.js
  ┌─ loadAllExistingFields(slug)
  │    1. Supabase: client_content tabel → JSON data object (primair)
  │    2. Fallback: CDN HTML ophalen + _extract.js regex parsing
  │
  ├─ Velden samenvoegen
  │    bestaande velden ← overschreven door → editor velden
  │
  ├─ Map opbouwen
  │    - Alle veldnamen naar UPPERCASE: hero_title → HERO_TITLE
  │    - Afgeleide waarden berekenen:
  │        KLEUR_PRIMARY → KLEUR_PRIMARY_A10/A20/TAILWIND
  │        LOGO_URL → LOGO_HTML, FAVICON_HTML
  │        TELEFOON_DISPLAY → TELEFOON_HREF, WHATSAPP_HREF
  │        REVIEWS_JSON → processReviewsJson() (strips outer [])
  │
  ├─ Template type opzoeken
  │    - Supabase clients tabel: slug → template (preview / dak-masterpiece / modern / bigsite)
  │    - Bepaalt welke template*.html bestanden worden gelezen
  │
  ├─ Templates lezen van lokale disk (fs.readFileSync)
  │    - template.html, template-contact.html, etc. (vanuit repo root)
  │    - gowebbo-cms comment toevoegen: <!-- gowebbo-cms: {fields JSON} -->
  │
  ├─ applyMap() → HTML genereren
  │
  └─ GitHub push + Supabase sync
       - public/{slug}.html, public/{slug}-contact.html, etc.
       - client_content tabel updaten met alle veldwaarden
```

---

## 3. Data uitlezen (_extract.js)

**Wanneer gebruikt:** Bij save.js als Supabase geen data heeft (eerste save of Supabase down).

### Werkwijze

Elke save schrijft `<!-- gowebbo-cms: {"hero_title":"...","service_desc":"...",...} -->` bovenaan de HTML. Bij de volgende laadronde pakt `_extract.js` dit comment als eerste.

**Fallback:** regex patterns die class-gebaseerde HTML zoeken:
```javascript
// Voorbeelden van extractor patterns (voor regulier/dak/modern)
first(html, /<h1 class="hero-title">(.*?)<\/h1>/)     // hero_title
first(html, /<p class="hero-desc">(.*?)<\/p>/)         // hero_desc
first(html, /const reviews = \[([\s\S]*?)\];/)         // reviews_json
```

**Belangrijk:** `_extract.js` werkt ALLEEN voor static HTML templates (regulier/dak/modern). Bigsite is een React SPA waarbij de content pas zichtbaar is na JavaScript rendering — de regex patterns vinden de content niet.

---

## 4. Verschil: Regulier/Dak/Modern vs. Bigsite

### Regulier / Dak / Modern — Pure Static HTML

```
Browser laadt {slug}.html
  │
  └─ HTML bevat direct de content:
       <h1 class="hero-title">Vakkundig schilderwerk voor uw woning</h1>
       <style>--primary: hsl(142,72%,38%);</style>
       const reviews = [{"naam":"Jan",...},{"naam":"Piet",...}];
  
  → Zichtbaar zonder JavaScript
  → _extract.js kan regex-matig data uitlezen
  → Accent markup: <span class="accent">schilderwerk</span> werkt direct als HTML
```

### Bigsite — Static Shell + React SPA

```
Browser laadt {slug}.html
  │
  ├─ Static HTML (pre-rendered door Playwright, voor SEO/first-paint)
  │    Bevat dezelfde content MAAR React vervangt dit zodra JS geladen is
  │
  ├─ Script block:
  │    window.GOWEBBO_DATA = {
  │      "HERO_TITLE": "Vakkundig airco installatie voor uw woning",
  │      "SERVICE_DESC": "Onze specialisten...",
  │      "REVIEWS_JSON": "[{\"naam\":\"Jan\",...}]",   ← JSON-escaped string
  │      "PAGE": "/"
  │    };
  │
  ├─ React bundle (/assets/index-CoufrYeP.js) laadt
  │    - MemoryRouter initialiseert op window.GOWEBBO_DATA.PAGE
  │    - Elke component roept cms('VELDNAAM', 'GOWEBBO_VELDNAAM') aan
  │    - cms() → window.GOWEBBO_DATA[key] als beschikbaar, anders fallback
  │
  └─ Zichtbare content = GOWEBBO_DATA waarden (niet de static HTML)
```

**cms() fallback mechanisme:**
```typescript
export function cms(key: string, fallback: string): string {
  if (typeof window !== 'undefined' && window.GOWEBBO_DATA && key in window.GOWEBBO_DATA) {
    return window.GOWEBBO_DATA[key];
  }
  return fallback;  // ← 'GOWEBBO_HERO_TITLE' etc. (baked in bij build)
}
```

Als `window.GOWEBBO_DATA` undefined is (door SyntaxError), returnt elke `cms()` call zijn fallback string. Dit ziet de gebruiker als letterlijke tekst op het scherm.

---

## 5. Diagnose: Waarom Alleen Placeholders op de Bigsite?

Na generatie via de intake (09:11 succesvolle run) toont de bigsite `GOWEBBO_HERO_TITLE`, `GOWEBBO_SERVICE_DESC`, etc. als zichtbare tekst. Dit betekent: `window.GOWEBBO_DATA` is undefined → SyntaxError in de script block.

### Oorzaak: Dubbele aanhalingstekens in HERO_TITLE / SERVICE_TITLE

`create-website.js` converteert `*sleutelwoord*` naar HTML voor accent-markering:

```javascript
// In create-website.js (PROBLEMATISCH voor bigsite)
ai[field] = ai[field].replace(/\*([^*]+)\*/g, '<span class="accent">$1</span>');
```

Dit produceert: `Vakkundig <span class="accent">airco</span> installatie.`

Wanneer dit in de GOWEBBO_DATA script block terechtkomt:

```javascript
// NA applyMap — KAPOT JavaScript:
window.GOWEBBO_DATA = {
  "HERO_TITLE": "Vakkundig <span class="accent">airco</span> installatie.",
  //                                      ↑ HIER eindigt de string!
  ...
};
```

De dubbele aanhalingstekens in `class="accent"` termineren de JavaScript string prematuur → **SyntaxError** → **GOWEBBO_DATA = undefined** → **alle `cms()` calls returnen `GOWEBBO_*` fallbacks**.

### Bijkomend probleem: React rendert HTML als tekst

Zelfs als de SyntaxError wordt opgelost, zou `<span class="accent">` als literal tekst getoond worden in React:

```tsx
// HeroSection.tsx — cms() waarde wordt als text node gerenderd
<h1>{cms('HERO_TITLE', 'GOWEBBO_HERO_TITLE')}</h1>
// → toont: "Vakkundig <span class="accent">airco</span> installatie."
// → NIET als HTML markup
```

### Fix

**Korte termijn:** Voor bigsite de `*...*` markers strippen in plaats van omzetten naar HTML:
```javascript
// create-website.js
if (isBigsite) {
  ai[field] = ai[field].replace(/\*([^*]+)\*/g, '$1');  // gewoon de tekst
} else {
  ai[field] = ai[field].replace(/\*([^*]+)\*/g, '<span class="accent">$1</span>');
}
```

**Lange termijn:** GOWEBBO_DATA JSON-safe maken door de script block te vervangen met:
```html
<script type="application/json" id="gowebbo-data">{"HERO_TITLE":"..."}</script>
<script>window.GOWEBBO_DATA = JSON.parse(document.getElementById('gowebbo-data').textContent);</script>
```
Hierdoor zijn speciale tekens (aanhalingstekens, backslashes, etc.) automatisch veilig.

---

## 6. Veelvoorkomende Fouten & Diagnose

| Symptoom | Oorzaak | Oplossing |
|----------|---------|-----------|
| `GOWEBBO_HERO_TITLE` etc. zichtbaar op bigsite | SyntaxError in GOWEBBO_DATA script block | Controleer HERO_TITLE / REVIEWS_JSON op ongeescapete `"` |
| `{{KEY}}` zichtbaar in static HTML | Veld niet in de substitutie-map | Voeg het veld toe aan de map in create-website.js of save.js |
| Reviews leeg op regulier/dak/modern | REVIEWS_JSON formaat fout | Template verwacht `[{{REVIEWS_JSON}}]` → waarde moet zonder outer `[]` |
| Vercel 404 na intake | create-website.js returned 500 | Controleer Vercel runtime logs voor GitHub API fout |
| Fotos leeg | Supabase storage path verkeerd of geen foto geüpload | Stock foto URL controleren, of gebruiker heeft geen foto ingevuld |
| Editor laadt lege velden | Supabase leeg + _extract.js vindt geen match | Controleer of gowebbo-cms comment aanwezig is in HTML |
