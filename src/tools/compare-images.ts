import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { imageCompareService } from '../services/image-compare.js';
import { logger } from '../utils/logger.js';

export const compareImagesTool = {
  name: 'lanhu_compare_images',
  description: 'Compare a candidate screenshot against the Lanhu reference image and report the biggest visual gaps.',
  inputSchema: {
    reference_image_url: z.string().url().optional().describe('Reference image URL, usually latestVersion.imageUrl'),
    reference_image_path: z.string().optional().describe('Local reference image path'),
    candidate_image_url: z.string().url().optional().describe('Candidate image URL'),
    candidate_image_path: z.string().optional().describe('Local candidate image path'),
    diff_output_path: z.string().optional().describe('Optional local path for writing a diff heatmap image'),
    resize_candidate: z.boolean().optional().default(true).describe('Auto-resize candidate to reference dimensions'),
    mismatch_threshold: z.number().min(0).max(1).optional().default(0.12).describe('Per-pixel mismatch threshold'),
    grid_rows: z.number().min(1).max(12).optional().default(6).describe('Grid rows for hotspot analysis'),
    grid_cols: z.number().min(1).max(12).optional().default(4).describe('Grid columns for hotspot analysis'),
  },
};

export function registerCompareImagesTool(server: McpServer): void {
  server.registerTool(
    compareImagesTool.name,
    {
      description: compareImagesTool.description,
      inputSchema: compareImagesTool.inputSchema,
    },
    async (params: {
      reference_image_url?: string;
      reference_image_path?: string;
      candidate_image_url?: string;
      candidate_image_path?: string;
      diff_output_path?: string;
      resize_candidate?: boolean;
      mismatch_threshold?: number;
      grid_rows?: number;
      grid_cols?: number;
    }) => {
      try {
        if (!params.reference_image_url && !params.reference_image_path) {
          throw new Error('reference_image_url or reference_image_path is required');
        }
        if (!params.candidate_image_url && !params.candidate_image_path) {
          throw new Error('candidate_image_url or candidate_image_path is required');
        }

        const result = await imageCompareService.compare({
          referenceImageUrl: params.reference_image_url,
          referenceImagePath: params.reference_image_path,
          candidateImageUrl: params.candidate_image_url,
          candidateImagePath: params.candidate_image_path,
          diffOutputPath: params.diff_output_path,
          resizeCandidate: params.resize_candidate,
          mismatchThreshold: params.mismatch_threshold,
          gridRows: params.grid_rows,
          gridCols: params.grid_cols,
        });

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ success: true, data: result }, null, 2),
            },
          ],
        };
      } catch (error) {
        logger.error('Failed to compare images', error);
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
