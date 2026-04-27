# Logging Guidelines

> How logging is done in this project.

---

## Logger Implementation

Singleton `Logger` class in `src/utils/logger.ts`. Imported as:
```typescript
import { logger } from '../utils/logger.js';
```

**CRITICAL: All output goes to `stderr`, not `stdout`.** This is because the project uses MCP stdio transport — `stdout` is reserved for MCP protocol messages.

---

## Log Levels

| Level | Number | When to Use |
|-------|--------|-------------|
| `debug` | 0 | Internal details: URL parsing, API response sizes, layer tree stats |
| `info` | 1 | Lifecycle events: service started, rendering started/completed, assets downloaded |
| `warn` | 2 | Recoverable issues: missing cookie fallback, deprecated API, partial failures |
| `error` | 3 | Failures: API errors, parse errors, rendering failures |

Default level: `info`. Override via `LOG_LEVEL` environment variable.

---

## Format

```
[ISO-timestamp] [LEVEL] message [args...]
```

Example output:
```
[2026-04-27T10:30:00.000Z] [INFO] 启动蓝湖 MCP 服务...
[2026-04-27T10:30:01.000Z] [INFO] Fetched design info: 云港智行
[2026-04-27T10:30:02.000Z] [ERROR] Failed to render Lanhu HTML Error: API request failed: 403
```

Object arguments are auto-serialized to JSON.

---

## Usage Patterns

```typescript
// Lifecycle (info)
logger.info('启动蓝湖 MCP 服务...');
logger.info('蓝湖 MCP 服务已启动');
logger.info(`Fetched design info: ${response.result.name}`);

// Debug details
logger.debug(`Request URL: ${url}`);
logger.debug(`Parsed ${layers.length} layers, ${assets.length} assets`);

// Recoverable issues (warn)
logger.warn('No cookie provided, using anonymous access');

// Errors (error) — always include the error object
logger.error('Failed to render Lanhu HTML', error);
logger.error('服务启动失败:', error);
```

---

## What NOT to Log

- **Cookies and authentication tokens** — use `cookie provided: true/false` instead
- **Full API response bodies** at info level — use debug only, and truncate
- **User file paths** that may contain personal info (e.g., home directory)
- **Sensitive design content** — log layer counts and sizes, not design names or content

---

## Forbidden Patterns

- **Never use `console.log`** — it writes to stdout and breaks MCP protocol
- **Never use `console.error` directly** — use `logger.error()` for consistent formatting and level filtering
- **Never log at error level without an Error object** — include the caught error as the second argument

