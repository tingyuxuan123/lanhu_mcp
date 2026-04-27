# Directory Structure

> How the MCP server codebase is organized.

---

## Overview

This is a **MCP Server** project (not a traditional REST API). The codebase follows a layered architecture:
- **Tools** → MCP tool definitions (the public interface)
- **Services** → Business logic
- **Runtime** → Rendering engines (`.mjs` files executed in sandbox)
- **Config** → Singleton state management
- **Types** → TypeScript type definitions
- **Utils** → Cross-cutting utilities

---

## Directory Layout

```
src/
├── index.ts                  # Entry point (shebang, bootstrap, stdio transport)
├── server.ts                 # MCP server setup, tool registration
├── config/
│   └── cookie-manager.ts     # Singleton cookie state
├── runtime/
│   └── html-restoration-runtime.mjs  # Rendering engine (pure JS, dynamically imported)
├── services/
│   ├── lanhu-client.ts       # HTTP client for Lanhu API
│   ├── lanhu-parser.ts       # JSON → SimplifiedLayer tree, layout inference
│   ├── asset-localizer.ts    # Download, hash, deduplicate image assets
│   ├── html-restoration-runner.ts      # Loads runtime.mjs, runs restoration
│   ├── html-restoration-batch-runner.ts # Batch version with validation
│   ├── html-handoff.ts       # Packages result for downstream use
│   ├── image-compare.ts      # Visual diff and similarity scoring
│   └── style-extractor.ts    # CSS/Tailwind/React/Vue style converters
├── tools/
│   ├── index.ts              # Barrel export of all tool registrations
│   ├── render-html.ts        # lanhu_render_html tool
│   ├── render-html-batch.ts  # lanhu_render_batch tool
│   ├── compare-images.ts     # lanhu_compare_images tool
│   ├── set-cookie.ts         # lanhu_set_cookie tool
│   ├── fetch-design.ts       # lanhu_fetch_design tool
│   ├── parse-sketch.ts       # lanhu_parse_sketch tool
│   └── prepare-restoration.ts # lanhu_prepare_restoration tool
├── types/
│   ├── index.ts              # Barrel re-export
│   ├── lanhu.ts              # Lanhu domain types (SimplifiedLayer, etc.)
│   └── api.ts                # API response types, helper functions
└── utils/
    ├── error.ts              # LanhuMcpError hierarchy
    ├── logger.ts             # Singleton Logger (outputs to stderr)
    ├── url-parser.ts         # Lanhu URL parsing utilities
    └── asset-localization.ts # Path building helpers for localized assets
```

---

## Module Responsibilities

| Module | Responsibility | Depends On |
|--------|---------------|------------|
| `index.ts` | Bootstrap, create server, connect stdio | `server.ts`, `utils/logger` |
| `server.ts` | Create McpServer, register all tools | `tools/*` |
| `tools/*` | Define MCP tools (Zod schemas + handler functions) | `services/*`, `config/*`, `utils/*` |
| `services/*` | Business logic, data processing | `types/*`, `utils/*` |
| `runtime/*.mjs` | Rendering engines (loaded via `import()`) | Standalone, no TS imports |
| `types/*` | Type definitions only, no logic | Nothing |
| `utils/*` | Cross-cutting concerns | `types/*` |

---

## Key Patterns

### Entry Point Chain
```
index.ts → createServer() → registerXxxTool(server) → tool handler → service.method()
```

### Runtime Loading
Rendering engines are `.mjs` files in `src/runtime/` loaded dynamically:
```typescript
// src/services/html-restoration-runner.ts
const module = await import(this.scriptUrl);
return module.runHtmlRestoration({ ... });
```
Runtime files are copied to `dist/` by `scripts/copy-runtime-to-dist.mjs` during build.

### Barrel Exports
- `src/tools/index.ts` exports tool definitions AND `registerXxxTool` functions
- `src/types/index.ts` re-exports from `api.ts` and `lanhu.ts`

---

## Naming Conventions

| Category | Convention | Examples |
|----------|-----------|----------|
| Files | kebab-case | `lanhu-client.ts`, `html-restoration-runner.ts` |
| Classes | PascalCase | `LanhuClient`, `LanhuParser`, `ImageCompareService` |
| Functions | camelCase | `buildLayerTree`, `renderNode`, `localizeAssets` |
| Constants | UPPER_SNAKE_CASE | `LOG_LEVELS`, `DEFAULT_TIMEOUT` |
| Interfaces | PascalCase (no `I` prefix) | `SimplifiedLayer`, `LanhuApiResponse` |
| Runtime files | kebab-case `.mjs` | `html-restoration-runtime.mjs` |

---

## Forbidden Patterns

- **Never put business logic in `tools/`** — tools are thin wrappers that delegate to services
- **Never import from `runtime/` in TypeScript** — runtime files are loaded via `import()` only
- **Never output to `stdout`** — this is an MCP stdio server; all logging goes to `stderr`
- **Never use default exports** — use named exports for all public API

<!-- Link to well-organized modules as examples -->

(To be filled by the team)
