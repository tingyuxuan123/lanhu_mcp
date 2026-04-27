# Quality Guidelines

> Code quality standards for this project.

---

## TypeScript Configuration

- **Target:** ES2022 (async/await, optional chaining, nullish coalescing)
- **Module:** Node16 (ESM — `import/export`, `.js` extensions required in imports)
- **Strict mode:** Enabled (`strict: true`)
- **Declarations:** Generated (`.d.ts` files)
- **No path aliases** — use relative imports only

---

## Build & Run

| Command | Purpose |
|---------|---------|
| `npm run build` | Compile TS + copy runtime MJS to `dist/` |
| `npm run dev` | Watch mode |
| `npm start` | Run compiled server (`dist/index.js`) |
| `npm test` | Build + run all tests |

---

## Testing

**Framework:** Node built-in `test` module + `node:assert/strict`

**Test file convention:** `tests/<module-name>.test.mjs`

**Test structure:**
```javascript
import test from 'node:test';
import assert from 'node:assert/strict';

test('descriptive test name', async () => {
  // Setup
  const originalFetch = globalThis.fetch;
  
  // Mock (if needed)
  globalThis.fetch = async (url) => { ... };
  
  try {
    // Act
    const result = await someFunction();
    
    // Assert
    assert.equal(result.field, expectedValue);
    assert.ok(result.list.length > 0);
    assert.match(stringValue, /pattern/);
  } finally {
    // Cleanup — always restore mocks
    globalThis.fetch = originalFetch;
  }
});
```

**Test patterns used in this project:**
- **Mock `globalThis.fetch`** for HTTP tests, restore in `finally` block
- **Load real fixture files** (`tmp_sample.json`) for integration tests
- **Flat structure** — no `describe()` blocks, just `test()` at top level
- **Call tracking** — push to an array in mock to verify call order/count

---

## Import Conventions

```typescript
// Node built-ins — use node: prefix
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

// Third-party — named imports
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

// Internal — relative paths with .js extension (ESM requirement)
import { ApiError, AuthenticationError } from '../utils/error.js';
import { logger } from '../utils/logger.js';
import type { SimplifiedLayer } from '../types/lanhu.js';
```

**Rules:**
- Always use `.js` extension in internal imports (Node16 ESM requirement)
- Use `import type` for type-only imports
- Named imports only (no default exports except in runtime `.mjs` files)

---

## Naming Conventions

| Category | Convention | Examples |
|----------|-----------|----------|
| Functions | camelCase | `buildLayerTree`, `renderNode`, `localizeAssets` |
| Classes | PascalCase | `LanhuClient`, `LanhuParser`, `ImageCompareService` |
| Interfaces | PascalCase, no `I` prefix | `SimplifiedLayer`, `LanhuApiResponse` |
| Type aliases | PascalCase | `ErrorCode`, `LogLevel` |
| Constants | UPPER_SNAKE_CASE | `LOG_LEVELS`, `DEFAULT_TIMEOUT` |
| Files | kebab-case | `lanhu-client.ts`, `asset-localizer.ts` |
| Test files | `<name>.test.mjs` | `lanhu-client.test.mjs` |

---

## Forbidden Patterns

- **Never use `console.log`** — breaks MCP stdio protocol; use `logger.info()` to stderr
- **Never use default exports** — use named exports for tree-shaking and consistency
- **Never use `any` type** — use `unknown` and narrow with type guards
- **Never skip `.js` extension in imports** — Node16 ESM will fail at runtime
- **Never put business logic in tool handlers** — tools are thin wrappers; delegate to services
- **Never swallow errors** — always log and re-throw or return error response

---

## Code Review Checklist

- [ ] TypeScript compiles with `strict: true`
- [ ] All imports use `.js` extension
- [ ] No `console.log` (use logger)
- [ ] Error handling follows the `LanhuMcpError` hierarchy
- [ ] MCP tool handlers have `try/catch` with `isError: true` on failure
- [ ] New functions/classes have at least one test
- [ ] No sensitive data (cookies, tokens) in error messages or logs
