import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { cookieManager } from '../config/cookie-manager.js';
import { LanhuClient } from '../services/lanhu-client.js';
import { LanhuParser } from '../services/lanhu-parser.js';
import { OutputFormat, StyleExtractor } from '../services/style-extractor.js';
import { logger } from '../utils/logger.js';

export const parseSketchTool = {
  name: 'lanhu_parse_sketch',
  description: 'Parse Lanhu json_url into a normalized, artboard-relative restoration bundle.',
  inputSchema: {
    json_url: z.string().url().describe('Lanhu design json_url'),
    cookie: z.string().optional().describe('Optional Lanhu authentication cookie'),
    output_format: z.enum(['none', 'css', 'tailwind', 'react', 'vue']).optional().default('none').describe('Optional style/code output'),
    include_styles: z.boolean().optional().default(true).describe('Whether to keep style-rich layer fields'),
    include_invisible: z.boolean().optional().default(false).describe('Whether to include invisible layers'),
    normalize_to_artboard: z.boolean().optional().default(true).describe('Whether bounds.x/y are relative to artboard'),
    max_depth: z.number().min(1).max(30).optional().default(20).describe('Maximum layer tree depth'),
  },
};

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
      include_invisible?: boolean;
      normalize_to_artboard?: boolean;
      max_depth?: number;
    }) => {
      try {
        const cookie = params.cookie || (cookieManager.hasCookie() ? cookieManager.getCookie() : '');
        const client = new LanhuClient(cookie);
        const parser = new LanhuParser();
        const designData = await client.fetchSketchJson(params.json_url);
        const document = parser.parseDocument(designData);
        const artboard = parser.getArtboardInfo(document);
        const stats = parser.getDocumentStats(document);
        const layers = parser.buildLayerTree(document, params.max_depth || 20, {
          includeInvisible: params.include_invisible ?? false,
          normalizeToArtboard: params.normalize_to_artboard ?? true,
        });
        const restoration = parser.buildRestorationPlan(layers);
        const textLayers = parser.extractTextLayers(document, {
          includeInvisible: params.include_invisible ?? false,
          normalizeToArtboard: params.normalize_to_artboard ?? true,
        });
        const assets = parser.extractAssets(document, {
          includeInvisible: params.include_invisible ?? false,
          normalizeToArtboard: params.normalize_to_artboard ?? true,
        });
        const tokens = parser.extractDesignTokens(document, {
          includeInvisible: params.include_invisible ?? false,
          normalizeToArtboard: params.normalize_to_artboard ?? true,
        });

        const result: {
          success: boolean;
          data: {
            name: string;
            coordinateSpace: 'artboard' | 'absolute';
            artboard: typeof artboard;
            stats: typeof stats;
            layers: typeof layers;
            restoration: typeof restoration;
            textLayers: typeof textLayers;
            assets: typeof assets;
            tokens: typeof tokens;
            renderHints: string[];
            styles?: string;
          };
        } = {
          success: true,
          data: {
            name: document.board.name,
            coordinateSpace: (params.normalize_to_artboard ?? true) ? 'artboard' : 'absolute',
            artboard,
            stats,
            layers: params.include_styles === false ? stripStyles(layers) : layers,
            restoration,
            textLayers,
            assets,
            tokens,
            renderHints: [
              'bounds.x / bounds.y are artboard-relative by default, while bounds.absoluteX / bounds.absoluteY keep original design coordinates.',
              'assetUrl prefers the highest-density image exposed by Lanhu.',
              'shapeType、borderRadius、pathSummary、textStyleRanges、textMetrics 可用于更高保真地还原图标、圆角和文本字重混排。',
              'restoration.paintOrder / maskGroups / clippedLayerIds 显式给出了绘制顺序和 clipping mask 关系。',
              'boundsMetadata.frame / visual / original 需要按不同用途使用，不能再只依赖单一 bounds。',
            ],
          },
        };

        if (params.output_format && params.output_format !== 'none') {
          const extractor = new StyleExtractor();
          result.data.styles = extractor.extractBatchFromLanhu(layers, params.output_format as OutputFormat);
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
        logger.error('Failed to parse Lanhu sketch JSON', error);
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

function stripStyles(layers: any[]): any[] {
  return layers.map(layer => {
    const {
      fill,
      fills,
      stroke,
      textStyle,
      shadows,
      opacity,
      borderRadius,
      shapeType,
      assetUrl,
      assetUrls,
      ...rest
    } = layer;

    return {
      ...rest,
      children: stripStyles(rest.children || []),
    };
  });
}

