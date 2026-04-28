# Runtime & Output Structure

> This project has **no frontend application**. This file documents the runtime engine and rendering output structure instead.

---

## Runtime Engines

Runtime engines are `.mjs` files in `src/runtime/` that perform the actual rendering. They are **not TypeScript** and are loaded dynamically via `import()`.

```
src/runtime/
├── html-restoration-runtime.mjs      # HTML rendering engine
└── uniapp-restoration-runtime.mjs    # UniApp SFC rendering engine
```

**Why separate MJS files?**
- Runtime code is loaded dynamically by service runners
- Cannot import TypeScript modules at runtime
- Copied to `dist/runtime/` during build by `scripts/copy-runtime-to-dist.mjs`

**Runtime entry points:**
```javascript
export async function runHtmlRestoration(options = {}) {
  // 1. Load dependencies (LanhuClient, LanhuParser, AssetLocalizer)
  // 2. Fetch/load design document
  // 3. Parse → build layer tree → infer layout hints
  // 4. Localize assets
  // 5. Render HTML
  // 6. Screenshot → compare → handoff package
  return { source, artboard, restoration, localizedAssets, htmlPath, ... };
}

export async function runUniAppRestoration(options = {}) {
  // 1. Load dependencies (LanhuClient, LanhuParser, AssetLocalizer, renderUniAppRoot)
  // 2. Fetch/load design document
  // 3. Parse → build layer tree → localize assets
  // 4. Render a static UniApp single-file component
  // 5. Write .vue + metadata + bundle files
  return { source, artboard, designWidth, localizedAssets, vuePath, ... };
}
```

---

## Rendering Output Structure

Each `lanhu_render_html` call produces an output directory:

```
<output_dir>/
├── <prefix>.html                          # Restored HTML page
├── <prefix>.png                           # Screenshot of rendered HTML
├── <prefix>-diff.png                      # Visual diff (if reference provided)
└── lanhu-restoration-assets/              # Localized image assets
    ├── icon-abc12345.png                  # SHA1-hashed filenames
    ├── banner-def67890.jpg
    └── ...
```

Each `lanhu_render_uniapp` call produces an output directory:

```
<output_dir>/
├── <prefix>.vue                           # Static UniApp single-file component
├── <prefix>-meta.json                     # Runtime output metadata
├── <prefix>-bundle.json                   # Parsed design bundle used to render SFC
└── <prefix>-assets/                       # Localized image assets
  ├── icon-abc12345.png
  ├── banner-def67890.jpg
  └── ...
```

---

## Script Files

```
scripts/
├── copy-runtime-to-dist.mjs    # Copies runtime/*.mjs to dist/runtime/ during build
├── run-lanhu-loop.mjs           # Batch restoration loop script
└── validate-sample-restoration.mjs # Sample validation script
```

---

## Test Files

```
tests/
├── asset-localizer.test.mjs
├── html-handoff.test.mjs
├── html-restoration-batch-runner.test.mjs
├── lanhu-client.test.mjs
├── lanhu-parser.test.mjs
├── uniapp-handoff.test.mjs
├── uniapp-renderer.test.mjs
└── url-parser.test.mjs
```

Tests use Node built-in `test` module (`.mjs` extension, not `.ts`). See `backend/quality-guidelines.md` for test patterns.

<!-- Link to well-organized modules as examples -->

(To be filled by the team)
