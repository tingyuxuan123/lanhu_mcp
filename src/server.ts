/**
 * MCP server setup.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  registerCompareImagesTool,
  registerFetchDesignTool,
  registerParseSketchTool,
  registerPrepareRestorationTool,
  registerSetCookieTool,
} from './tools/index.js';

export function createServer(): McpServer {
  const server = new McpServer({
    name: 'lanhu-mcp',
    version: '1.1.0',
  });

  registerFetchDesignTool(server);
  registerPrepareRestorationTool(server);
  registerParseSketchTool(server);
  registerCompareImagesTool(server);
  registerSetCookieTool(server);

  return server;
}
