# Type System Conventions

> How types are organized and used across this MCP Server project.

---

## Type Organization

Types live in `src/types/` and are organized by domain:

```
src/types/
├── index.ts       # Barrel re-export: `export * from './api.js'; export * from './lanhu.js';`
├── lanhu.ts       # Lanhu domain types: SimplifiedLayer, LanhuColor, LanhuBounds, etc.
└── api.ts         # API response types: LanhuApiResponse<T>, ImageResult, DesignInfo, etc.
```

**Import pattern:**
```typescript
import type { SimplifiedLayer, LanhuBounds } from '../types/lanhu.js';
import type { LanhuApiResponse, ImageResult } from '../types/api.js';
```

Always use `import type` for type-only imports (no runtime cost).

---

## Naming Conventions

| Category | Convention | Examples |
|----------|-----------|----------|
| Interfaces | PascalCase, no `I` prefix | `SimplifiedLayer`, `LanhuColor`, `LanhuApiResponse` |
| Type aliases | PascalCase | `ErrorCode`, `LogLevel` |
| Generic types | Single letter or descriptive | `LanhuApiResponse<T>`, `Record<string, string>` |
| Optional fields | Use `?` liberally | Most Lanhu API fields are optional |

---

## Key Type Structures

### `SimplifiedLayer` — The Core Data Model

The most important type in the project. Represents a parsed design layer:

```typescript
interface SimplifiedLayer {
  // Identity
  id: number;
  name: string;
  type: 'text' | 'shape' | 'image' | 'group' | 'layer';
  visible: boolean;
  
  // Geometry
  bounds: { x: number; y: number; width: number; height: number };
  
  // Content
  text?: string;
  textStyle?: SimplifiedTextStyle;
  textStyleRanges?: SimplifiedTextStyleRange[];
  fill?: string;  // CSS color or gradient string
  stroke?: SimplifiedStroke;
  assetUrl?: string;
  pathData?: SimplifiedPathGeometry;
  
  // Layout (inferred by parser)
  layoutHint?: SimplifiedLayoutHint;  // flex-row, flex-column, or absolute
  sizeHint?: { width?: 'content'; height?: 'content' };
  
  // Hierarchy
  children?: SimplifiedLayer[];
  
  // Rendering
  renderStrategy: 'asset' | 'text' | 'shape' | 'group' | 'adjustment';
}
```

### `LanhuApiResponse<T>` — Generic API Wrapper

```typescript
interface LanhuApiResponse<T> {
  code: string;      // '00000' = success
  msg?: string;
  result: T;
}
```

### API Helper Functions (in `types/api.ts`)

```typescript
function getLatestVersion(result: ImageResult): ImageVersion | null;
function extractDesignInfo(result: ImageResult): DesignInfo;
```

These are **pure functions**, not class methods. Defined alongside the types they operate on.

---

## Validation

**Zod** is used for MCP tool input validation (in `src/tools/*.ts`):

```typescript
import { z } from 'zod';

export const renderHtmlTool = {
  inputSchema: {
    url: z.string().url().optional().describe('Full Lanhu page URL'),
    json_url: z.string().url().optional().describe('Direct json_url'),
    cookie: z.string().optional().describe('Optional cookie'),
  },
};
```

**No runtime validation** for Lanhu API responses — they are cast with `as T` after JSON parse. This is acceptable because:
- Lanhu API structure is known and relatively stable
- Parser handles malformed data gracefully with fallbacks
- Adding Zod schemas for 30+ fields would be excessive for an internal API client

---

## Forbidden Patterns

- **Never use `any`** — use `unknown` and narrow with type guards
- **Never use type assertions (`as X`) for external data** — except for Lanhu API responses where the structure is known
- **Never put types in implementation files** — types go in `src/types/`
- **Never use `interface` for union types** — use `type` for `ErrorCode`, `LogLevel`, etc.
- **Never duplicate type definitions** — check `src/types/` before creating new types

(To be filled by the team)
