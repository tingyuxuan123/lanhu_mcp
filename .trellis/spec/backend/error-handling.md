# Error Handling

> How errors are caught, classified, and reported in this project.

---

## Error Hierarchy

All custom errors extend `LanhuMcpError` (defined in `src/utils/error.ts`):

```
LanhuMcpError (base)
├── InvalidUrlError      (code: INVALID_URL)    — bad Lanhu URL format
├── AuthenticationError  (code: AUTH_REQUIRED)   — cookie missing/expired
├── ApiError             (code: API_ERROR)       — HTTP request failure (has statusCode, responseBody)
├── ParseError           (code: PARSE_ERROR)     — JSON parse failure
└── LayerNotFoundError   (code: LAYER_NOT_FOUND) — expected layer missing in tree
```

All errors have a `toJSON()` method:
```typescript
{ success: false, error: { code: ErrorCode, message: string } }
```

---

## MCP Tool Error Response Pattern

Every MCP tool handler follows this exact pattern (from `src/tools/render-html.ts`):

```typescript
async (params) => {
  try {
    // ... validate params ...
    // ... call service ...
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({ success: true, data: result }, null, 2),
      }],
    };
  } catch (error) {
    logger.error('Failed to render Lanhu HTML', error);
    return {
      content: [{
        type: 'text' as const,
        text: JSON.stringify({
          success: false,
          error: error instanceof Error ? error.message : String(error),
        }, null, 2),
      }],
      isError: true,  // ← MCP error flag
    };
  }
}
```

**Rules:**
- Always wrap the handler body in `try/catch`
- On success: return `{ success: true, data: ... }` as JSON text
- On failure: return `{ success: false, error: string }` as JSON text with `isError: true`
- Always log the error before returning: `logger.error('...', error)`

---

## Service Error Handling (HTTP Requests)

From `src/services/lanhu-client.ts`:

```typescript
private async request<T>(url: string, headers: Record<string, string>): Promise<T> {
  try {
    const response = await fetch(url, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(this.timeout), // 30000ms
    });

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      if (response.status === 401 || response.status === 403) {
        throw new AuthenticationError(`Cookie authentication failed (${response.status})`);
      }
      throw new ApiError(`API request failed: ${response.status}...`, response.status, body);
    }

    const text = await response.text();
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new ParseError(`Failed to parse JSON response: ${text.slice(0, 200)}...`);
    }
  } catch (error) {
    // Re-throw known errors unchanged
    if (error instanceof AuthenticationError || error instanceof ApiError || error instanceof ParseError) {
      throw error;
    }
    // Wrap unknown errors
    if (error instanceof Error) {
      if (error.name === 'AbortError' || error.message.includes('timeout')) {
        throw new ApiError('Request timeout', 0);
      }
      throw new ApiError(`Network request failed: ${error.message}`, 0);
    }
    throw new ApiError(`Unknown request error: ${String(error)}`, 0);
  }
}
```

**Key rules:**
- Known errors (`LanhuMcpError` subclasses) are re-thrown as-is
- Unknown errors are wrapped in `ApiError` with `statusCode: 0`
- Timeout detection checks both `AbortError` name and message string
- Response body is always captured for debugging (truncated to 200 chars)

---

## When to Use Each Error Type

| Situation | Error Class |
|-----------|------------|
| User provides invalid Lanhu URL | `InvalidUrlError` |
| Cookie missing or 401/403 response | `AuthenticationError` |
| HTTP request fails (non-auth) | `ApiError(message, statusCode, body)` |
| JSON response can't be parsed | `ParseError` |
| Expected layer not found in tree | `LayerNotFoundError` |
| Unexpected internal failure | `new LanhuMcpError(msg, 'INTERNAL_ERROR')` |

---

## Forbidden Patterns

- **Never swallow errors silently** — always log with `logger.error()` before returning
- **Never throw plain `Error`** — use `LanhuMcpError` subclasses so error codes are preserved
- **Never include sensitive data** (cookies, tokens) in error messages
- **Never use `console.error` directly** — use `logger.error()` for consistent formatting
