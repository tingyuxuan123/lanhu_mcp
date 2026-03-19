import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { cookieManager } from '../config/cookie-manager.js';
import { LanhuClient } from '../services/lanhu-client.js';
import { parseLanhuUrl } from '../utils/url-parser.js';
import { logger } from '../utils/logger.js';
import { extractDesignInfo } from '../types/api.js';

export const fetchDesignTool = {
  name: 'lanhu_fetch_design',
  description: 'Fetch Lanhu design metadata from a web URL and expose the latest version json_url/image_url.',
  inputSchema: {
    url: z.string().url().describe('Full Lanhu page URL'),
    cookie: z.string().optional().describe('Optional Lanhu authentication cookie'),
  },
};

export function registerFetchDesignTool(server: McpServer): void {
  server.registerTool(
    fetchDesignTool.name,
    {
      description: fetchDesignTool.description,
      inputSchema: fetchDesignTool.inputSchema,
    },
    async (params: { url: string; cookie?: string }) => {
      try {
        const cookie = cookieManager.getCookie(params.cookie);
        const urlParams = parseLanhuUrl(params.url);
        const client = new LanhuClient(cookie);
        const result = await client.getImageInfo(urlParams);
        const designInfo = extractDesignInfo(result);

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ success: true, data: designInfo }, null, 2),
            },
          ],
        };
      } catch (error) {
        logger.error('Failed to fetch Lanhu design info', error);
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
