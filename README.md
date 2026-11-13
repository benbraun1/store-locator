# Les Imprimeuses — Store Locator

Three interactive maps displaying the retail partners of Les Imprimeuses:

- **Internal B2B dashboard** (`index.html`) — all partners, with RFM-based segmentation, order history and activity status. For internal use only.
- **Internal mobile map** (`mobile.html`) — same data and segmentation as the dashboard, stripped down for a smartphone: full-screen map, tappable dots, reseller card in a bottom sheet. For internal use only.
- **Public reseller finder** (`public.html`) — active partners only, name + city, light theme, mobile-friendly. Safe to link from the public website.

**URLs:**
- Internal: https://benbraun1.github.io/store-locator/
- Internal mobile: https://benbraun1.github.io/store-locator/mobile.html
- Public: https://benbraun1.github.io/store-locator/public.html

---

## Overview

Three static HTML pages hosted on GitHub Pages. All three read the same published CSV from Google Sheets, which is updated nightly from Shopify via Matrixify — so a single data pipeline feeds every view.

```
Shopify → Matrixify → Google Sheets (Feuille 1)
                              ↓
                     Apps Script (nightly)
                              ↓
                    Google Sheets (_output CSV)
                              ↓
          index.html / mobile.html / public.html (GitHub Pages)
```

---

## Files

| File | Purpose |
|------|---------|
| `index.html` | Internal dashboard — dark theme, RFM segment filters, full order details |
| `mobile.html` | Internal mobile map — dark theme, full-screen map, tappable dots, bottom-sheet reseller card |
| `public.html` | Public reseller finder — light theme, active partners only, mobile drawer |
| `guide_operationnel_store_locator.docx` | Operational guide for non-developer users |
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
4. **index.html**, **mobile.html** and **public.html** fetch the published `_output` CSV on every page load

### Geocoding cache

`_geocache` has three columns: `address`, `lat`, `lng`.

The cache key is built from `Address Line 1` (cleaned) + `Address City` + `Address Country`. Lookup is case-insensitive. The clean-up logic strips:
- Content in parentheses: `8 rue Gambetta, (mamie mesure)` → `8 rue Gambetta`
- Floor information: `2ème étage, 41 av. de la République` → `41 av. de la République`
- Duplicate street repetitions

When geocoding fails, an empty row is written to `_geocache` to avoid retrying every night. To retry: delete that row and run `runGeocodeAndRefresh()` manually.

### What gets displayed

Only customers with `Total Orders > 0` **and** `Total Spent > 0`. Customers with no orders are excluded (prospects imported into Shopify but who have never purchased), and so are customers whose orders were all cancelled or refunded (Shopify still counts those orders, but `Total Spent` drops to 0).

`NAME_OVERRIDES` (top of each HTML file, keyed by Shopify customer ID) forces a display name when the default address's `Address Company` is wrong. Prefer fixing the company directly in Shopify; the override can then be removed.

The three views apply different filters on top of that:

| | `index.html` (internal) | `mobile.html` (internal) | `public.html` (public) |
|---|---|---|---|
| Active partners (last order < 12 months) | ✓ coloured dot | ✓ coloured dot | ✓ uniform purple dot |
| Inactive partners (≥ 12 months) | ✓ grey dot, below separator | ✓ grey dot, toggleable | ✗ hidden |
| Segment colour coding (RFM) | ✓ colour + filter chips | ✓ colour + filter chips | ✗ uniform dot |
| Order count, lifetime value, last order date | ✓ in detail panel | ✓ in bottom sheet | ✗ never exposed |
| List contents | all partners, sorted by last order | no list — map only | only partners inside current map bounds, sorted alphabetically |
| Search | ✓ | ✗ | ✗ |
| Mobile layout | — | designed for phones (full-screen map, swipe-to-close sheet, "my position" button) | bottom drawer with swipe (< 768px) |

**Privacy note:** `mobile.html` shows the same commercial data as `index.html` (amounts, order counts, tags, email) — do not link it publicly. `public.html` deliberately exposes only `Address Company`, `Address City` and `Address Country`. No order data, tags, email, or customer ID is rendered. If new fields get added to `_output`, double-check that `public.html`'s `parseCSV()` still only pulls the safe subset before deploying.

### Active vs inactive

- **Active** (coloured dot): last order < 12 months ago
- **Inactive** (grey dot): last order ≥ 12 months ago, shown below a separator in the sidebar

### Segments (RFM)

`index.html` classifies each active partner into one of five actionable segments based on **Recency** (months since last order), **Frequency** (total orders) and **Monetary** value (lifetime spend). Inactive partners form a sixth group.

| Segment | Colour | Rule |
|---------|--------|------|
| **Champions** | `#4ADE80` (green) | Recent (< 3 months) and high LTV (≥ p75) |
| **Fidèles** | `#60A5FA` (blue) | Repeat buyer (≥ 2 orders), mid-to-high LTV (≥ p50), last order < 6 months |
| **Nouveaux** | `#FACC15` (yellow) | Single order, < 3 months ago |
| **À relancer** | `#FB923C` (orange) | Mid-to-high LTV repeat buyer, last order 3–12 months ago |
| **Occasionnels** | `#A78BFA` (violet) | Everything else active (low LTV, irregular) |
| **Inactifs** | `#555` (grey) | Last order ≥ 12 months — shown under separator, toggleable |

The **p50 / p75 thresholds are computed live** from the active cohort's lifetime value distribution on every page load, so the segmentation auto-adapts as the customer base grows. No hardcoded euro values.

Each segment has its own filter chip in the top bar (including `Inactifs`), so users can isolate e.g. Champions + À relancer for a targeted campaign.

---

## Deployment

### Updating the map (routine)

Nothing to do — the nightly trigger handles everything automatically.

### After a manual geocache fix

1. Edit coordinates directly in `_geocache`
2. Run `refreshOutput()` in Apps Script
3. Reload the map in the browser

### After modifying index.html, mobile.html or public.html

Push to GitHub via GitHub Desktop. The map updates within ~30 seconds. All files share the same data source — editing one does not affect the others.

### If many boutiques are suddenly missing

Run `runGeocodeAndRefresh()` manually in Apps Script. Check the execution logs to see which addresses failed and why.

---

## Key Configuration

In `index.html`, `mobile.html` and `public.html`:

```javascript
// URL of the published _output sheet (CSV) — must stay in sync across all three files
const CSV_URL = "https://docs.google.com/spreadsheets/d/e/...";
```

`index.html`:

```javascript
// Months after which a store is considered inactive (grey dot)
// Currently: 12 months hardcoded in parseCSV()
```

`mobile.html`:

```javascript
const ACTIVE_MONTHS = 12;   // partners older than this are shown as grey "Inactifs"
const LOGO_B64      = "..."; // brand logo embedded as base64 PNG
```

Implementation notes on `mobile.html`:

- **Same RFM logic as `index.html`** — `classifySegment()`, `quantile()` and `parseCSV()` are copied verbatim (plus `parseDate()` from `public.html`). If the segmentation rules change in `index.html`, change them here too.
- **Initial view** fits the dense core of stores (within ~6° lat / 8° lng of the median position), not every marker — otherwise the handful of far-away resellers (Japan, USA, Korea) would force zoom level 1 on a phone screen. Those stores are still on the map, just zoom out.
- **Tappable dots** — each marker has a 32px touch target around a 16px dot (24px when selected).
- **Bottom sheet** — opens on tap, closes on map tap, on the × or by swiping down. The map pans so the selected dot stays visible above the sheet.
- **"Itinéraire" button** opens Apple Plans on iOS and Google Maps elsewhere; **"Email"** is a `mailto:` link (hidden if the store has no email).
- **"Ma position" button** (bottom right) uses the browser geolocation API to centre the map on the user.

`public.html`:

```javascript
const ACTIVE_MONTHS = 12;   // partners older than this are hidden entirely
const DOT_COLOR   = "#D5A3FF";
const DOT_BORDER  = "#54215D";
const LOGO_B64    = "..."; // brand logo embedded as base64 PNG
```

Implementation notes on `public.html`:

- **`parseDate()` helper** — robust parsing of Shopify's `"2025-01-19 10:52:53 +0100"` timestamps, normalized to ISO before passing to `Date`.
- **Cache-busting** — the CSV fetch appends `&t=Date.now()` so stale CDN copies never stick.
- **Mobile drawer** — uses `100dvh` + `env(safe-area-inset-bottom)` and animates via `height` (not `transform`) so Leaflet attribution stays above the drawer peek on iOS.

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
