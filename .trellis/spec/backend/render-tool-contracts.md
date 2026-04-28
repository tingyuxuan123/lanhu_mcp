# Render Tool Contracts

> Executable contracts for MCP rendering tools.

---

## Scenario: UniApp SFC handoff from Lanhu design data

### 1. Scope / Trigger
- Trigger: added a new MCP tool signature, a new runtime entry point, new output files, and new env wiring for direct UniApp SFC generation.
- Applies to: `lanhu_render_uniapp`, `UniAppRestorationRunner`, `runUniAppRestoration()`, and the single-page handoff contract returned to MCP clients.

### 2. Signatures
- MCP tool registration:

```typescript
export function registerRenderUniAppTool(server: McpServer): void;
```

- Tool name:

```text
lanhu_render_uniapp
```

- Runner contract:

```typescript
export interface UniAppRestorationOptions {
  pageUrl?: string;
  jsonUrl?: string;
  cookie?: string;
  referenceImageUrl?: string;
  outputDir?: string;
  outputPrefix?: string;
  statusTime?: string;
  statusApp?: string;
  designWidth?: number;
  assetPublicPath?: string;
}

export class UniAppRestorationRunner {
  async run(options: UniAppRestorationOptions): Promise<unknown>;
}
```

- Runtime entry point:

```javascript
export async function runUniAppRestoration(options = {})
```

### 3. Contracts

#### Request fields

| Field | Type | Required | Constraints |
|------|------|:---:|-------------|
| `url` | string | conditional | full Lanhu page URL; mutually exclusive with `json_url` |
| `json_url` | string | conditional | full Lanhu JSON URL; mutually exclusive with `url` |
| `cookie` | string | conditional | required when `url` is used unless stored cookie exists |
| `reference_image_url` | string | optional | forwarded into output metadata only |
| `output_dir` | string | optional | target directory for `.vue`, metadata, bundle, and assets |
| `output_prefix` | string | optional | file stem for generated artifacts |
| `design_width` | number | optional | must be `> 0`; default `375`; used for `px -> rpx` conversion |
| `asset_public_path` | string | optional | public prefix written back into localized asset URLs |
| `status_time` | string | optional | accepted for parity with `lanhu_render_html`; ignored by UniApp output |
| `status_app` | string | optional | accepted for parity with `lanhu_render_html`; ignored by UniApp output |

#### Response fields

Success payload must be:

```json
{
  "success": true,
  "data": {
    "mode": "uniapp-sfc-assets",
    "source": {
      "pageUrl": "...",
      "jsonUrl": "...",
      "designName": "...",
      "referenceImageUrl": "..."
    },
    "vuePath": "...",
    "bundlePath": "...",
    "metaPath": "...",
    "designWidth": 375,
    "artboard": {
      "name": "...",
      "width": 375,
      "height": 812
    },
    "assetDirectory": "...",
    "assetPublicPathPrefix": "/static/lanhu-assets",
    "assetFiles": []
  }
}
```

#### Environment keys

| Key | Required | Purpose |
|-----|:---:|---------|
| `LANHU_PAGE_URL` | optional | page URL fallback |
| `LANHU_COOKIE` | conditional | cookie fallback for authenticated page mode |
| `LANHU_JSON_URL` | optional | direct JSON fallback |
| `LANHU_REFERENCE_IMAGE_URL` | optional | metadata/reference fallback |
| `LANHU_OUTPUT_DIR` | optional | output directory fallback |
| `RESTORATION_OUTPUT_PREFIX` | optional | output prefix fallback |
| `LANHU_UNIAPP_DESIGN_WIDTH` | optional | default design width fallback |
| `LANHU_UNIAPP_ASSET_PUBLIC_PATH` | optional | default UniApp asset public path |
| `SAMPLE_JSON_PATH` | optional | local sample JSON fallback |
| `SAMPLE_REFERENCE_PATH` | optional | local sample reference image fallback |

### 4. Validation & Error Matrix

| Condition | Behavior |
|----------|----------|
| neither `url` nor `json_url` provided | tool returns MCP error response with `isError: true` |
| both `url` and `json_url` provided | tool returns MCP error response with `isError: true` |
| `url` mode without usable cookie | runtime throws `LANHU_COOKIE is required when LANHU_PAGE_URL is provided` |
| remote `json_url` fetch non-2xx | runtime throws `Failed to fetch Lanhu JSON: <status> <text>` |
| runtime missing `runUniAppRestoration` export | runner throws explicit runtime export error |
| invalid `design_width` (`<= 0` or non-numeric) | normalize to default `375` in runtime/service layer |

### 5. Good / Base / Bad Cases
- Good: `json_url + design_width + asset_public_path` generates `.vue`, `-meta.json`, `-bundle.json`, and localized assets with `/static/...` URLs.
- Base: `json_url` only falls back to default output directory, default `designWidth=375`, and env/public-path defaults.
- Bad: pushing rendering logic into the tool handler, or returning raw runtime output without the `uniapp-sfc-assets` handoff envelope.

### 6. Tests Required
- Unit: `buildUniAppSingleHandoff()` keeps only delivery-facing fields.
- Unit: `renderUniAppRoot()` covers `pxToRpx`, text mapping, image mapping, and rich text ranges.
- Command: `npm run build` must copy both runtime `.mjs` files into `dist/runtime/`.
- Command: `npm test` must execute `node --test tests/*.test.mjs` successfully.
- Smoke: run `UniAppRestorationRunner` against `tmp_sample.json` and assert `.vue`, `-meta.json`, `-bundle.json`, and asset directory exist.

### 7. Wrong vs Correct

#### Wrong

```typescript
server.registerTool('lanhu_render_uniapp', schema, async params => {
  const sfc = renderUniAppRoot(params.layers, params.artboard);
  return { content: [{ type: 'text', text: sfc }] };
});
```

Why wrong:
- bypasses the runtime/runner boundary
- skips asset localization and output files
- returns an unstable ad-hoc payload instead of the handoff contract

#### Correct

```typescript
const result = await uniAppRestorationRunner.run({
  pageUrl: params.url,
  jsonUrl: params.json_url,
  designWidth: params.design_width,
  assetPublicPath: params.asset_public_path,
});
const handoff = buildUniAppSingleHandoff(result as Parameters<typeof buildUniAppSingleHandoff>[0]);
return {
  content: [{ type: 'text' as const, text: JSON.stringify({ success: true, data: handoff }, null, 2) }],
};
```