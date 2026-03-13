# Les Imprimeuses — Store Locator

Internal B2B store locator displaying all retail partners on an interactive map.

**Live URL:** https://benbraun1.github.io/store-locator

---

## Overview

A static web app (single HTML file) hosted on GitHub Pages. It reads a published CSV from Google Sheets, which is itself updated nightly from Shopify via Matrixify.

```
Shopify → Matrixify → Google Sheets (Feuille 1)
                              ↓
                     Apps Script (nightly)
                              ↓
                    Google Sheets (_output CSV)
                              ↓
                    index.html (GitHub Pages)
```

---

## Files

| File | Purpose |
|------|---------|
| `index.html` | The entire app — map, sidebar, filters, styling |
| `README.md` | This file |

**Google Sheets** (separate, not in this repo):

| Sheet | Purpose |
|-------|---------|
| `Feuille 1` | Raw Shopify export via `=IMPORTDATA()` from Matrixify |
| `_geocache` | Address → lat/lng lookup table (source of truth for coordinates) |
| `_output` | Enriched CSV with `_lat` and `_lng` columns — what the HTML reads |

**Apps Script** (attached to the Google Sheet):

| Function | Purpose |
|----------|---------|
| `runGeocodeAndRefresh()` | Geocodes any address missing from `_geocache`, then calls `refreshOutput()` |
| `refreshOutput()` | Rebuilds `_output` from `Feuille 1` + `_geocache` |
| `createNightlyTrigger()` | Sets up a nightly 3am trigger on `refreshOutput()` — run once only |

---

## How It Works

### Data pipeline

1. **Shopify** exports customer data nightly to Matrixify
2. **Feuille 1** pulls that data via `=IMPORTDATA(matrixify_url)`
3. **Apps Script** runs at 3am:
   - Scans `Feuille 1` for customers with `Total Orders > 0` and `Top Row = TRUE`
   - For each address not yet in `_geocache`, calls geocode.maps.co API
   - Writes new coordinates to `_geocache`
   - Rebuilds `_output` by joining `Feuille 1` with `_geocache`
4. **index.html** fetches the published `_output` CSV on every page load

### Geocoding cache

`_geocache` has three columns: `address`, `lat`, `lng`.

The cache key is built from `Address Line 1` (cleaned) + `Address City` + `Address Country`. Lookup is case-insensitive. The clean-up logic strips:
- Content in parentheses: `8 rue Gambetta, (mamie mesure)` → `8 rue Gambetta`
- Floor information: `2ème étage, 41 av. de la République` → `41 av. de la République`
- Duplicate street repetitions

When geocoding fails, an empty row is written to `_geocache` to avoid retrying every night. To retry: delete that row and run `runGeocodeAndRefresh()` manually.

### What gets displayed

Only customers with `Total Orders > 0`. Customers with no orders are excluded (prospects imported into Shopify but who have never purchased).

### Active vs inactive

- **Active** (coloured dot): last order < 12 months ago
- **Inactive** (grey dot): last order ≥ 12 months ago, shown below a separator in the sidebar

### Channels

Determined from Shopify `Tags`:

| Tag | Colour | Label |
|-----|--------|-------|
| `b2b` | `#54215D` (purple) | Direct B2B |
| `Faire` | `#ff8c42` (orange) | Faire |
| `Ankorstore` | `#D5A3FF` (light purple) | Ankorstore |
| multiple | `#FCE5E5` (pink) | Multi-canal |

---

## Deployment

### Updating the map (routine)

Nothing to do — the nightly trigger handles everything automatically.

### After a manual geocache fix

1. Edit coordinates directly in `_geocache`
2. Run `refreshOutput()` in Apps Script
3. Reload the map in the browser

### After modifying index.html

Push to GitHub via GitHub Desktop. The map updates within ~30 seconds.

### If many boutiques are suddenly missing

Run `runGeocodeAndRefresh()` manually in Apps Script. Check the execution logs to see which addresses failed and why.

---

## Key Configuration

In `index.html`:

```javascript
// URL of the published _output sheet (CSV)
const CSV_URL = "https://docs.google.com/spreadsheets/d/e/...";

// Months after which a store is considered inactive (grey dot)
// Currently: 12 months hardcoded in parseCSV()
```

In Apps Script:

```javascript
const GEOCODE_API_KEY = "69afdc9a92f5a021371582xjw3e1569"; // geocode.maps.co
```

---

## Known Limitations

- **Geocoding API**: geocode.maps.co free tier — 1 request/second. If many new boutiques appear at once, the nightly run may time out (Apps Script limit: 6 minutes). Run `runGeocodeAndRefresh()` multiple times if needed.
- **Address quality**: Some Shopify addresses contain the shop name in `Address Line 1`. The cleanup logic handles most cases but occasionally a manual coordinate fix in `_geocache` is needed.
- **Decimal separator**: Old `_geocache` entries use a comma as decimal separator (French locale from Google Sheets). New entries use a dot. Both are handled by the HTML parser.

---

## Tech Stack

- **Map**: Leaflet.js 1.9.4 + OpenStreetMap tiles
- **CSV parsing**: PapaParse 5.4.1
- **Fonts**: DM Sans + DM Mono (Google Fonts)
- **Hosting**: GitHub Pages
- **Geocoding**: geocode.maps.co
- **Automation**: Google Apps Script
