/**
 * MCP Server 配置和工具注册
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { registerFetchDesignTool, registerParseSketchTool, registerSetCookieTool } from './tools/index.js';

/**
 * 创建并配置 MCP Server
 */
export function createServer(): McpServer {
  const server = new McpServer({
    name: 'lanhu-mcp',
    version: '1.0.0',
  });

  // 注册所有工具
  registerFetchDesignTool(server);
  registerParseSketchTool(server);
  registerSetCookieTool(server);

  return server;
}
