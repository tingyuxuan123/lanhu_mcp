/**
 * 获取设计图信息工具
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { cookieManager } from '../config/cookie-manager.js';
import { LanhuClient } from '../services/lanhu-client.js';
import { parseLanhuUrl } from '../utils/url-parser.js';
import { logger } from '../utils/logger.js';
import { extractDesignInfo } from '../types/api.js';

/**
 * 工具定义
 */
export const fetchDesignTool = {
  name: 'lanhu_fetch_design',
  description: `获取蓝湖设计图信息。

根据蓝湖设计图 URL 获取设计图的详细信息，包括：
- 设计图名称、尺寸
- 所有版本信息
- Sketch JSON 数据地址 (json_url)

如何获取 Cookie：
1. 登录蓝湖网页版 (lanhuapp.com)
2. 打开浏览器开发者工具 (F12)
3. 切换到 Network 标签页
4. 刷新页面，找到任意请求
5. 在请求头中复制 Cookie 值

使用示例：
- url: https://lanhuapp.com/web/#/item/project/detailDetach?tid=xxx&pid=yyy&image_id=zzz
- cookie: (可选，如未配置环境变量则必须提供)`,
  inputSchema: {
    url: z.string().url().describe('蓝湖设计图完整 URL'),
    cookie: z.string().optional().describe('蓝湖认证 Cookie（可选，未配置环境变量时必须提供）'),
  },
};

/**
 * 注册工具到 MCP Server
 */
export function registerFetchDesignTool(server: McpServer): void {
  server.registerTool(
    fetchDesignTool.name,
    {
      description: fetchDesignTool.description,
      inputSchema: fetchDesignTool.inputSchema,
    },
    async (params: { url: string; cookie?: string }) => {
      try {
        logger.info(`获取设计图信息: ${params.url}`);

        // 获取 Cookie
        const cookie = cookieManager.getCookie(params.cookie);

        // 解析 URL
        const urlParams = parseLanhuUrl(params.url);
        logger.debug('URL 参数:', urlParams);

        // 创建客户端并获取设计图信息
        const client = new LanhuClient(cookie);
        const result = await client.getImageInfo(urlParams);

        // 提取简化信息
        const designInfo = extractDesignInfo(result);

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  success: true,
                  data: designInfo,
                },
                null,
                2
              ),
            },
          ],
        };
      } catch (error) {
        logger.error('获取设计图信息失败:', error);

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
