import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { cookieManager } from '../config/cookie-manager.js';
import { buildHtmlBatchHandoff } from '../services/html-handoff.js';
import { htmlRestorationBatchRunner, type HtmlRestorationBatchTarget } from '../services/html-restoration-batch-runner.js';
import { logger } from '../utils/logger.js';

const batchTargetSchema = z.object({
  url: z.string().url().optional().describe('Full Lanhu page URL for this target'),
  json_url: z.string().url().optional().describe('Direct Lanhu json_url for this target'),
  reference_image_url: z.string().url().optional().describe('Optional reference image URL for this target'),
  prefix: z.string().optional().describe('Optional output prefix for this target'),
});

export const renderHtmlBatchTool = {
  name: 'lanhu_render_batch',
  description: 'Render multiple Lanhu pages/json_urls into HTML handoff packages and write a batch summary for downstream reconstruction.',
  inputSchema: {
    urls: z.array(z.string().url()).optional().describe('List of Lanhu page URLs'),
    json_urls: z.array(z.string().url()).optional().describe('List of direct Lanhu json_url targets'),
    targets: z.array(batchTargetSchema).optional().describe('Explicit batch target objects with per-target overrides'),
    cookie: z.string().optional().describe('Optional Lanhu authentication cookie; falls back to stored cookie'),
    output_dir: z.string().optional().describe('Optional root output directory for batch artifacts'),
    min_score: z.number().min(0).max(100).optional().describe('Minimum acceptable similarity score; defaults to 95'),
    max_attempts: z.number().int().min(1).max(10).optional().describe('Retry attempts per target; defaults to 3'),
  },
};

export function registerRenderHtmlBatchTool(server: McpServer): void {
  server.registerTool(
    renderHtmlBatchTool.name,
    {
      description: renderHtmlBatchTool.description,
      inputSchema: renderHtmlBatchTool.inputSchema,
    },
    async (params: {
      urls?: string[];
      json_urls?: string[];
      targets?: Array<{
        url?: string;
        json_url?: string;
        reference_image_url?: string;
        prefix?: string;
      }>;
      cookie?: string;
      output_dir?: string;
      min_score?: number;
      max_attempts?: number;
    }) => {
      try {
        const targets = buildBatchTargets(params);
        if (targets.length === 0) {
          throw new Error('urls, json_urls, or targets is required');
        }

        const requiresCookie = targets.some(target => Boolean(target.pageUrl));
        const cookie = requiresCookie
          ? cookieManager.getCookie(params.cookie)
          : (params.cookie || (cookieManager.hasCookie() ? cookieManager.getCookie() : ''));
        const result = await htmlRestorationBatchRunner.run({
          targets,
          outputDir: params.output_dir,
          minScore: params.min_score,
          maxAttempts: params.max_attempts,
          cookie,
        });
        const handoff = buildHtmlBatchHandoff(result);

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ success: true, data: handoff }, null, 2),
            },
          ],
        };
      } catch (error) {
        logger.error('Failed to batch render Lanhu HTML', error);
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

function buildBatchTargets(params: {
  urls?: string[];
  json_urls?: string[];
  targets?: Array<{
    url?: string;
    json_url?: string;
    reference_image_url?: string;
    prefix?: string;
  }>;
}): HtmlRestorationBatchTarget[] {
  const targets: HtmlRestorationBatchTarget[] = [];

  for (const url of params.urls || []) {
    targets.push({ pageUrl: url });
  }

  for (const jsonUrl of params.json_urls || []) {
    targets.push({ jsonUrl });
  }

  for (const target of params.targets || []) {
    if (!target.url && !target.json_url) {
      throw new Error('Each target must include url or json_url');
    }

    if (target.url && target.json_url) {
      throw new Error('Each target can include only one of url or json_url');
    }

    targets.push({
      pageUrl: target.url,
      jsonUrl: target.json_url,
      referenceImageUrl: target.reference_image_url,
      prefix: target.prefix,
    });
  }

  return targets;
}
