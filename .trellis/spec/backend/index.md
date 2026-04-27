# Backend Development Guidelines

> Development conventions for this MCP Server project.

---

## Overview

This project is a **MCP Server** (Node.js TypeScript) — not a traditional REST API backend. These guidelines document the actual patterns used in the codebase.

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Directory Structure](./directory-structure.md) | Module organization, file layout, entry points | ✅ Filled |
| [Database Guidelines](./database-guidelines.md) | External services & data (Lanhu API, assets, file I/O) | ✅ Filled |
| [Error Handling](./error-handling.md) | LanhuMcpError hierarchy, MCP tool error pattern | ✅ Filled |
| [Quality Guidelines](./quality-guidelines.md) | TypeScript config, testing, naming, forbidden patterns | ✅ Filled |
| [Logging Guidelines](./logging-guidelines.md) | Logger singleton, stderr output, log levels | ✅ Filled |

---

## Quick Reference

```bash
npm run build     # Compile TypeScript + copy runtime to dist/
npm test          # Build + run all tests
npm start         # Run compiled MCP server
npm run dev       # Watch mode
```

---

**Language**: All documentation is written in **English**.
