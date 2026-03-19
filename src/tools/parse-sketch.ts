/**
 * 解析蓝湖设计数据工具
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { cookieManager } from '../config/cookie-manager.js';
import { LanhuClient } from '../services/lanhu-client.js';
import { LanhuParser } from '../services/lanhu-parser.js';
import { StyleExtractor, OutputFormat } from '../services/style-extractor.js';
import { logger } from '../utils/logger.js';

/**
 * 工具定义
 */
export const parseSketchTool = {
  name: 'lanhu_parse_sketch',
  description: `解析蓝湖设计图的设计数据。

从 json_url 获取并解析设计数据，返回：
- 完整的图层树结构
- 每个图层的位置、尺寸、样式信息
- 文本内容和样式
- 可选：生成的 CSS/Tailwind/React/Vue 代码

参数说明：
- json_url: 从 lanhu_fetch_design 获取的 json_url
- output_format: 输出格式（可选）
  - "none": 仅返回图层数据（默认）
  - "css": 返回 CSS 样式代码
  - "tailwind": 返回 Tailwind 类名
  - "react": 返回 React 组件代码
  - "vue": 返回 Vue 组件代码
- include_styles: 是否包含样式信息（默认 true）
- max_depth: 图层树最大深度（默认 15）`,
  inputSchema: {
    json_url: z.string().url().describe('设计数据 JSON URL（从 lanhu_fetch_design 获取）'),
    cookie: z.string().optional().describe('蓝湖认证 Cookie（可选）'),
    output_format: z.enum(['none', 'css', 'tailwind', 'react', 'vue']).optional().default('none').describe('输出格式'),
    include_styles: z.boolean().optional().default(true).describe('是否包含样式信息'),
    max_depth: z.number().min(1).max(20).optional().default(15).describe('图层树最大深度'),
  },
};

/**
 * 注册工具到 MCP Server
 */
export function registerParseSketchTool(server: McpServer): void {
  server.registerTool(
    parseSketchTool.name,
    {
      description: parseSketchTool.description,
      inputSchema: parseSketchTool.inputSchema,
    },
    async (params: {
      json_url: string;
      cookie?: string;
      output_format?: 'none' | 'css' | 'tailwind' | 'react' | 'vue';
      include_styles?: boolean;
      max_depth?: number;
    }) => {
      try {
        logger.info(`解析设计数据: ${params.json_url.substring(0, 50)}...`);

        // 获取 Cookie（可选）
        const cookie = cookieManager.getCookie(params.cookie);

        // 创建客户端并获取 JSON 数据
        const client = new LanhuClient(cookie);
        const designData = await client.fetchSketchJson(params.json_url);

        // 使用蓝湖解析器
        const parser = new LanhuParser();
        const doc = parser.parseDocument(designData);

        // 获取统计信息
        const stats = parser.getDocumentStats(doc);

        // 构建图层树
        const maxDepth = params.max_depth || 15;
        const layerTree = parser.buildLayerTree(doc, maxDepth);

        // 提取文本图层
        const textLayers = parser.extractTextLayers(doc);

        // 准备结果
        const result: {
          success: boolean;
          data: {
            name: string;
            stats: typeof stats;
            layers: typeof layerTree;
            textLayers: typeof textLayers;
            styles?: string;
          };
        } = {
          success: true,
          data: {
            name: doc.board.name,
            stats,
            layers: params.include_styles !== false ? layerTree : stripStyles(layerTree),
            textLayers,
          },
        };

        // 生成样式代码
        if (params.output_format && params.output_format !== 'none') {
          const extractor = new StyleExtractor();
          result.data.styles = extractor.extractBatchFromLanhu(layerTree, params.output_format as OutputFormat);
        }

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        logger.error('解析设计数据失败:', error);

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

/**
 * 移除图层树中的样式信息（用于减少输出大小）
 */
function stripStyles(layers: any[]): any[] {
  return layers.map(layer => {
    const { fill, stroke, textStyle, ...rest } = layer;
    return {
      ...rest,
      children: stripStyles(rest.children || []),
    };
  });
}
