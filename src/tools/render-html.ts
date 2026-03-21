import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { cookieManager } from '../config/cookie-manager.js';
import { buildHtmlSingleHandoff } from '../services/html-handoff.js';
import { htmlRestorationRunner } from '../services/html-restoration-runner.js';
import { logger } from '../utils/logger.js';

export const renderHtmlTool = {
  name: 'lanhu_render_html',
  description: 'Render a Lanhu page or json_url into a handoff package: HTML page, localized image assets, and preview artifacts for downstream UI reconstruction.',
  inputSchema: {
    url: z.string().url().optional().describe('Full Lanhu page URL'),
    json_url: z.string().url().optional().describe('Direct Lanhu json_url; use when page metadata is already known'),
    cookie: z.string().optional().describe('Optional Lanhu authentication cookie; falls back to stored cookie'),
    reference_image_url: z.string().url().optional().describe('Optional reference image URL for diff comparison'),
    output_dir: z.string().optional().describe('Optional output directory for html/png/diff artifacts'),
    output_prefix: z.string().optional().describe('Optional file name prefix for generated artifacts'),
    status_time: z.string().optional().describe('Optional status bar time label for top chrome restoration'),
    status_app: z.string().optional().describe('Optional status bar app label for top chrome restoration'),
  },
};

export function registerRenderHtmlTool(server: McpServer): void {
  server.registerTool(
    renderHtmlTool.name,
    {
      description: renderHtmlTool.description,
      inputSchema: renderHtmlTool.inputSchema,
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
        const result = await htmlRestorationRunner.run({
          pageUrl: params.url,
          jsonUrl: params.json_url,
          cookie,
          referenceImageUrl: params.reference_image_url,
          outputDir: params.output_dir,
          outputPrefix: params.output_prefix,
          statusTime: params.status_time,
          statusApp: params.status_app,
        });
        const handoff = buildHtmlSingleHandoff(result as Parameters<typeof buildHtmlSingleHandoff>[0]);
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ success: true, data: handoff }, null, 2),
            },
          ],
        };
      } catch (error) {
        logger.error('Failed to render Lanhu HTML', error);
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
