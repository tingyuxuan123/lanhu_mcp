# External Services & Data

> This project has **no database**. This file documents external service interaction patterns instead.

---

## Lanhu API

**Client:** `src/services/lanhu-client.ts` — `LanhuClient` class

**Base URL:** `https://lanhuapp.com`

**Authentication:** Cookie-based, managed by `src/config/cookie-manager.ts` (singleton)

**Key endpoints:**

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/project/image` | GET | Fetch design info (project_id, image_id) |
| `/api/account/user_settings` | GET | Resolve team_id from user settings |
| Sketch JSON URL | GET | Fetch raw design data (from `json_url`) |

**Request pattern:**
- All requests go through `LanhuClient.request<T>()` (private method)
- Timeout: 30 seconds via `AbortSignal.timeout()`
- Response validation: check `code === '00000'` for success
- JSON parse with fallback error handling

**Cookie management:**
- `cookieManager.setCookie(value)` — store for subsequent requests
- `cookieManager.getCookie(override?)` — get stored or override
- Cookies are passed via tool params or from prior `lanhu_set_cookie` call

---

## Asset Downloads

**Service:** `src/services/asset-localizer.ts` — `AssetLocalizer`

**Pattern:**
1. Collect all `assetUrl` references from parsed layers
2. Download each with retry logic (`downloadWithRetry`)
3. Compute SHA1 content hash for deduplication
4. Detect file extension from buffer + Content-Type
5. Write to local directory with slug-based names
6. Return asset manifest with local paths

**Deduplication:** By SHA1 hash — identical content only downloaded/written once.

---

## Playwright (Screenshot)

**Used by:** `html-restoration-runtime.mjs` for headless screenshots

**Pattern:**
- Launch Chromium headless
- Set viewport to design dimensions (1:1 pixel mapping)
- Navigate to `file://` HTML path
- Screenshot `#artboard` element only
- Used for visual diff comparison

---

## File System

**Key directories:**

| Path | Purpose |
|------|---------|
| Output dir (configurable) | HTML/SFC files, screenshots, diffs |
| `<output>/lanhu-restoration-assets/` | Localized image assets |

**File I/O:** Always uses `node:fs/promises` (async). Never sync file operations.
