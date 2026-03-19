#!/usr/bin/env node

/**
 * 蓝湖 MCP 服务入口
 *
 * 提供蓝湖设计图还原功能：
 * - lanhu_fetch_design: 获取设计图信息
 * - lanhu_parse_sketch: 解析 Sketch JSON 数据
 * - lanhu_set_cookie: 设置认证 Cookie
 */

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';
import { logger } from './utils/logger.js';

async function main() {
  logger.info('启动蓝湖 MCP 服务...');

  // 创建 Server
  const server = createServer();

  // 连接 stdio 传输
  const transport = new StdioServerTransport();
  await server.connect(transport);

  logger.info('蓝湖 MCP 服务已启动');
}

main().catch((error) => {
  logger.error('服务启动失败:', error);
  process.exit(1);
});
