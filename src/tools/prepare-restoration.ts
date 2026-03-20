import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { cookieManager } from '../config/cookie-manager.js';
import { LanhuClient } from '../services/lanhu-client.js';
import { LanhuParser } from '../services/lanhu-parser.js';
import { extractDesignInfo } from '../types/api.js';
import { logger } from '../utils/logger.js';
import { parseLanhuUrl } from '../utils/url-parser.js';

export const prepareRestorationTool = {
  name: 'lanhu_prepare_restoration',
  description: 'Fetch Lanhu page metadata, resolve the latest json_url, and return a complete UI restoration bundle.',
  inputSchema: {
    url: z.string().url().describe('Full Lanhu page URL'),
    cookie: z.string().optional().describe('Optional Lanhu authentication cookie'),
    include_invisible: z.boolean().optional().default(false).describe('Whether to include invisible layers'),
    max_depth: z.number().min(1).max(30).optional().default(20).describe('Maximum layer tree depth'),
  },
};

export function registerPrepareRestorationTool(server: McpServer): void {
  server.registerTool(
    prepareRestorationTool.name,
    {
      description: prepareRestorationTool.description,
      inputSchema: prepareRestorationTool.inputSchema,
    },
    async (params: { url: string; cookie?: string; include_invisible?: boolean; max_depth?: number }) => {
      try {
        const cookie = cookieManager.getCookie(params.cookie);
        const urlParams = parseLanhuUrl(params.url);
        const client = new LanhuClient(cookie);
        const parser = new LanhuParser();
        const imageInfo = await client.getImageInfo(urlParams);
        const latestVersion = client.getLatestVersion(imageInfo);
        const designData = await client.fetchSketchJson(latestVersion.json_url);
        const document = parser.parseDocument(designData);
        const artboard = parser.getArtboardInfo(document);
        const stats = parser.getDocumentStats(document);
        const layers = parser.buildLayerTree(document, params.max_depth || 20, {
          includeInvisible: params.include_invisible ?? false,
          normalizeToArtboard: true,
        });
        const restoration = parser.buildRestorationPlan(layers);
        const textLayers = parser.extractTextLayers(document, {
          includeInvisible: params.include_invisible ?? false,
          normalizeToArtboard: true,
        });
        const assets = parser.extractAssets(document, {
          includeInvisible: params.include_invisible ?? false,
          normalizeToArtboard: true,
        });
        const tokens = parser.extractDesignTokens(document, {
          includeInvisible: params.include_invisible ?? false,
          normalizeToArtboard: true,
        });
        const designInfo = extractDesignInfo(imageInfo);
        const scaleX = artboard.width > 0 ? imageInfo.width / artboard.width : 1;
        const scaleY = artboard.height > 0 ? imageInfo.height / artboard.height : 1;

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  success: true,
                  data: {
                    design: designInfo,
                    latestVersion: {
                      id: latestVersion.id,
                      versionInfo: latestVersion.version_info,
                      jsonUrl: latestVersion.json_url,
                      imageUrl: latestVersion.url,
                    },
                    artboard,
                    stats,
                    scale: {
                      designToReferenceX: Number(scaleX.toFixed(4)),
                      designToReferenceY: Number(scaleY.toFixed(4)),
                    },
                    layers,
                    restoration,
                    textLayers,
                    assets,
                    tokens,
                    renderHints: [
                      '先按 artboard.width / artboard.height 还原布局，再按 designToReferenceX / Y 缩放到蓝湖页面展示尺寸。',
                      '优先使用 latestVersion.imageUrl 作为最终对比图。',
                      '坐标已归一到画板左上角，absoluteX / absoluteY 保留原始设计坐标；boundsMetadata 额外提供 frame / visual / original。',
                      'restoration.paintOrder / maskGroups / clippedLayerIds 可直接指导页面从背景到前景的还原顺序。',
                      'assetUrl 可直接作为图标/位图资源来源，shapeType / borderRadius / textStyleRanges / textMetrics / shadows 可用于高保真还原。',
                    ],
                  },
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (error) {
        logger.error('Failed to prepare Lanhu restoration bundle', error);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) }, null, 2),
            },
          ],
          isError: true,
        };
      }
    },
  );
}
