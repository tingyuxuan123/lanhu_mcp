/**
 * 设置 Cookie 工具
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { cookieManager } from '../config/cookie-manager.js';
import { logger } from '../utils/logger.js';

/**
 * 工具定义
 */
export const setCookieTool = {
  name: 'lanhu_set_cookie',
  description: `设置蓝湖认证 Cookie。

设置用于 API 认证的 Cookie，设置后后续调用无需重复传入。

如何获取 Cookie：
1. 登录蓝湖网页版 (lanhuapp.com)
2. 打开浏览器开发者工具 (F12)
3. 切换到 Network 标签页
4. 刷新页面，找到任意请求
5. 在请求头中复制 Cookie 值

注意：Cookie 包含敏感信息，请勿泄露给他人。`,
  inputSchema: {
    cookie: z.string().min(1).describe('蓝湖认证 Cookie'),
  },
};

/**
 * 注册工具到 MCP Server
 */
export function registerSetCookieTool(server: McpServer): void {
  server.registerTool(
    setCookieTool.name,
    {
      description: setCookieTool.description,
      inputSchema: setCookieTool.inputSchema,
    },
    async (params: { cookie: string }) => {
      try {
        logger.info('设置 Cookie');

        // 验证 Cookie 格式
        const isValid = cookieManager.validateCookie(params.cookie);

        if (!isValid) {
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(
                  {
                    success: false,
                    warning: 'Cookie 可能不包含有效的认证字段，请确认是否正确复制了完整的 Cookie 值',
                  },
                  null,
                  2
                ),
              },
            ],
          };
        }

        // 设置 Cookie
        cookieManager.setDefaultCookie(params.cookie);

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  success: true,
                  message: 'Cookie 设置成功，后续调用无需重复传入',
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        logger.error('设置 Cookie 失败:', error);

        const errorMessage = error instanceof Error ? error.message : String(error);

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  success: false,
                  error: errorMessage,
                },
                null,
                2
              ),
            },
          ],
          isError: true,
        };
      }
    }
  );
}
