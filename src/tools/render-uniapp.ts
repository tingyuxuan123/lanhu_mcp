import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { cookieManager } from '../config/cookie-manager.js';
import { buildUniAppSingleHandoff } from '../services/uniapp-handoff.js';
import { uniAppRestorationRunner } from '../services/uniapp-restoration-runner.js';
import { logger } from '../utils/logger.js';

export const renderUniAppTool = {
  name: 'lanhu_render_uniapp',
  description: 'Render a Lanhu page or json_url into a static UniApp single-file component plus localized image assets.',
  inputSchema: {
    url: z.string().url().optional().describe('Full Lanhu page URL'),
    json_url: z.string().url().optional().describe('Direct Lanhu json_url; use when page metadata is already known'),
    cookie: z.string().optional().describe('Optional Lanhu authentication cookie; falls back to stored cookie'),
    reference_image_url: z.string().url().optional().describe('Optional reference image URL for downstream validation metadata'),
    output_dir: z.string().optional().describe('Optional output directory for vue/json/assets artifacts'),
    output_prefix: z.string().optional().describe('Optional file name prefix for generated artifacts'),
    status_time: z.string().optional().describe('Accepted for parity with lanhu_render_html; ignored by UniApp output'),
    status_app: z.string().optional().describe('Accepted for parity with lanhu_render_html; ignored by UniApp output'),
    design_width: z.number().positive().optional().describe('Optional design draft width used for px -> rpx conversion; defaults to the Lanhu artboard width when omitted'),
    asset_public_path: z.string().optional().describe('Optional public path prefix for localized assets, e.g. /static/lanhu-assets'),
  },
};

export function registerRenderUniAppTool(server: McpServer): void {
  server.registerTool(
    renderUniAppTool.name,
    {
      description: renderUniAppTool.description,
      inputSchema: renderUniAppTool.inputSchema,
    },
    async (params: {
      url?: string;
      json_url?: string;
      cookie?: string;
      reference_image_url?: string;
      output_dir?: string;
      output_prefix?: string;
      status_time?: string;
      status_app?: string;
      design_width?: number;
      asset_public_path?: string;
    }) => {
      try {
        if (!params.url && !params.json_url) {
          throw new Error('url or json_url is required');
        }

        if (params.url && params.json_url) {
          throw new Error('url and json_url are mutually exclusive');
        }

        const cookie = params.url
          ? cookieManager.getCookie(params.cookie)
          : (params.cookie || (cookieManager.hasCookie() ? cookieManager.getCookie() : ''));
        const result = await uniAppRestorationRunner.run({
          pageUrl: params.url,
          jsonUrl: params.json_url,
          cookie,
          referenceImageUrl: params.reference_image_url,
          outputDir: params.output_dir,
          outputPrefix: params.output_prefix,
          statusTime: params.status_time,
          statusApp: params.status_app,
          designWidth: params.design_width,
          assetPublicPath: params.asset_public_path,
        });
        const handoff = buildUniAppSingleHandoff(result as Parameters<typeof buildUniAppSingleHandoff>[0]);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ success: true, data: handoff }, null, 2),
            },
          ],
        };
      } catch (error) {
        logger.error('Failed to render Lanhu UniApp SFC', error);
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
