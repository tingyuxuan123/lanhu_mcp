import fs from 'node:fs/promises';
import path from 'node:path';
import { htmlRestorationRunner, type HtmlRestorationOptions } from './html-restoration-runner.js';

export interface HtmlRestorationBatchTarget {
  pageUrl?: string;
  jsonUrl?: string;
  referenceImageUrl?: string;
  prefix?: string;
}

export interface HtmlRestorationBatchOptions {
  targets: HtmlRestorationBatchTarget[];
  outputDir?: string;
  minScore?: number;
  maxAttempts?: number;
  cookie?: string;
}

export interface HtmlRestorationWorstRegion {
  row?: number;
  col?: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  diffPercent?: number;
  weightedDiffPercent?: number;
}

export interface HtmlRestorationCompareSummary {
  visualSimilarityScore?: number;
  visualDiffPercent?: number;
  pixelMismatchPercent?: number;
  weightedDiffPercent?: number;
  worstRegions?: HtmlRestorationWorstRegion[];
}

export interface HtmlRestorationLocalizedAssetFile {
  fileName?: string;
  localPath?: string;
  filePath?: string;
  sourceUrl?: string;
}

export interface HtmlRestorationLocalizedAssets {
  outputDir?: string;
  publicPathPrefix?: string;
  files?: HtmlRestorationLocalizedAssetFile[];
}

export interface HtmlRestorationRunResult {
  source?: {
    pageUrl?: string;
    jsonUrl?: string;
    designName?: string;
    referenceImageUrl?: string;
  };
  htmlPath?: string;
  screenshotPath?: string;
  diffPath?: string;
  compare?: HtmlRestorationCompareSummary;
  localizedAssets?: HtmlRestorationLocalizedAssets;
}

export interface HtmlRestorationBatchSummaryItem {
  prefix: string;
  status: 'passed' | 'below-threshold' | 'failed';
  attempts: number;
  pageUrl?: string;
  jsonUrl?: string;
  referenceImageUrl?: string;
  score?: number;
  visualDiffPercent?: number;
  pixelMismatchPercent?: number;
  weightedDiffPercent?: number;
  worstRegions?: HtmlRestorationWorstRegion[];
  htmlPath?: string;
  screenshotPath?: string;
  diffPath?: string;
  assetDirectory?: string;
  assetPublicPathPrefix?: string;
  assetFiles?: HtmlRestorationLocalizedAssetFile[];
  metaPath?: string;
  error?: string;
}

export interface HtmlRestorationBatchSummary {
  generatedAt: string;
  minScore: number;
  targetMaxAttempts: number;
  outputDir: string;
  summaryPath: string;
  total: number;
  passed: number;
  failed: number;
  belowThreshold: number;
  items: HtmlRestorationBatchSummaryItem[];
}

type RunHtmlRestoration = (options: HtmlRestorationOptions) => Promise<HtmlRestorationRunResult>;
interface NormalizedBatchTarget extends HtmlRestorationBatchTarget {
  prefix: string;
}

export class HtmlRestorationBatchRunner {
  constructor(
    private readonly runSingle: RunHtmlRestoration = options =>
      htmlRestorationRunner.run(options) as Promise<HtmlRestorationRunResult>,
  ) {}

  async run(options: HtmlRestorationBatchOptions): Promise<HtmlRestorationBatchSummary> {
    const normalizedTargets = uniquifyTargetPrefixes(
      options.targets.map((target, index) => normalizeTarget(target, index)),
    );

    if (normalizedTargets.length === 0) {
      throw new Error('No Lanhu targets provided.');
    }

    const outputDir = path.resolve(options.outputDir || process.env.LANHU_OUTPUT_DIR || 'artifacts/loop');
    const minScore = resolveNumber(options.minScore, process.env.RESTORATION_MIN_SCORE, 95);
    const targetMaxAttempts = Math.max(
      1,
      Math.trunc(resolveNumber(options.maxAttempts, process.env.LANHU_TARGET_MAX_ATTEMPTS, 3)),
    );
    const summaryPath = path.join(outputDir, 'restoration-summary.json');

    await fs.mkdir(outputDir, { recursive: true });

    const summary: HtmlRestorationBatchSummary = {
      generatedAt: new Date().toISOString(),
      minScore,
      targetMaxAttempts,
      outputDir,
      summaryPath,
      total: normalizedTargets.length,
      passed: 0,
      failed: 0,
      belowThreshold: 0,
      items: [],
    };

    for (const target of normalizedTargets) {
      const targetOutputDir = path.join(outputDir, target.prefix);
      await fs.mkdir(targetOutputDir, { recursive: true });

      try {
        const { attempts, result } = await this.runTargetWithRetry(
          target,
          targetOutputDir,
          targetMaxAttempts,
          options.cookie,
        );
        const score = Number(result.compare?.visualSimilarityScore || 0);
        const passed = score >= minScore;

        if (passed) {
          summary.passed += 1;
        } else {
          summary.belowThreshold += 1;
        }

        summary.items.push({
          prefix: target.prefix,
          status: passed ? 'passed' : 'below-threshold',
          attempts,
          pageUrl: target.pageUrl || undefined,
          jsonUrl: target.jsonUrl || undefined,
          referenceImageUrl: result.source?.referenceImageUrl || target.referenceImageUrl || undefined,
          score,
          visualDiffPercent: result.compare?.visualDiffPercent,
          pixelMismatchPercent: result.compare?.pixelMismatchPercent,
          weightedDiffPercent: result.compare?.weightedDiffPercent,
          worstRegions: result.compare?.worstRegions?.slice(0, 5),
          htmlPath: result.htmlPath,
          screenshotPath: result.screenshotPath,
          diffPath: result.diffPath,
          assetDirectory: result.localizedAssets?.outputDir,
          assetPublicPathPrefix: result.localizedAssets?.publicPathPrefix,
          assetFiles: result.localizedAssets?.files,
          metaPath: path.join(targetOutputDir, `${target.prefix}-meta.json`),
        });
      } catch (error) {
        summary.failed += 1;
        summary.items.push({
          prefix: target.prefix,
          status: 'failed',
          attempts: targetMaxAttempts,
          pageUrl: target.pageUrl || undefined,
          jsonUrl: target.jsonUrl || undefined,
          referenceImageUrl: target.referenceImageUrl || undefined,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    await fs.writeFile(summaryPath, JSON.stringify(summary, null, 2), 'utf8');
    return summary;
  }

  private async runTargetWithRetry(
    target: NormalizedBatchTarget,
    targetOutputDir: string,
    maxAttempts: number,
    cookie?: string,
  ): Promise<{ attempts: number; result: HtmlRestorationRunResult }> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const result = await this.runSingle({
          pageUrl: target.pageUrl,
          jsonUrl: target.jsonUrl,
          cookie,
          referenceImageUrl: target.referenceImageUrl,
          outputDir: targetOutputDir,
          outputPrefix: target.prefix,
        });

        return { attempts: attempt, result };
      } catch (error) {
        lastError = error;
        if (attempt >= maxAttempts) {
          break;
        }

        await wait(300 * attempt);
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }
}

export async function resolveBatchTargetsFromEnv(): Promise<HtmlRestorationBatchTarget[]> {
  const targetsFile = process.env.LANHU_TARGETS_FILE;
  if (targetsFile) {
    const raw = await fs.readFile(path.resolve(targetsFile), 'utf8');
    return parseBatchTargets(raw);
  }

  const pageUrls = process.env.LANHU_PAGE_URLS;
  if (pageUrls) {
    return parseBatchTargetList(pageUrls).map(pageUrl => ({ pageUrl }));
  }

  const pageUrl = process.env.LANHU_PAGE_URL;
  if (pageUrl) {
    return [{ pageUrl }];
  }

  const jsonUrl = process.env.LANHU_JSON_URL;
  if (jsonUrl) {
    return [{
      jsonUrl,
      referenceImageUrl: process.env.LANHU_REFERENCE_IMAGE_URL || undefined,
      prefix: process.env.RESTORATION_OUTPUT_PREFIX || undefined,
    }];
  }

  return [];
}

export function parseBatchTargets(raw: string): HtmlRestorationBatchTarget[] {
  const trimmed = String(raw || '').trim();
  if (!trimmed) {
    return [];
  }

  if (trimmed.startsWith('[')) {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) {
      throw new Error('LANHU_TARGETS_FILE must contain a JSON array.');
    }

    return parsed.map(item => {
      if (typeof item === 'string') {
        return { pageUrl: item };
      }

      return {
        pageUrl: item?.pageUrl,
        jsonUrl: item?.jsonUrl,
        referenceImageUrl: item?.referenceImageUrl,
        prefix: item?.prefix,
      };
    });
  }

  return parseBatchTargetList(trimmed).map(pageUrl => ({ pageUrl }));
}

export function parseBatchTargetList(raw: string): string[] {
  return String(raw || '')
    .split(/[\r\n,]+/)
    .map(item => item.trim())
    .filter(Boolean);
}

function normalizeTarget(
  target: HtmlRestorationBatchTarget,
  index: number,
): NormalizedBatchTarget {
  if (!target || typeof target !== 'object') {
    throw new Error(`Invalid target at index ${index}`);
  }

  const normalized = {
    pageUrl: target.pageUrl,
    jsonUrl: target.jsonUrl,
    referenceImageUrl: target.referenceImageUrl,
    prefix: target.prefix,
  };

  if (!normalized.pageUrl && !normalized.jsonUrl) {
    throw new Error(`Target ${index + 1} is missing pageUrl/jsonUrl`);
  }

  if (normalized.pageUrl && normalized.jsonUrl) {
    throw new Error(`Target ${index + 1} cannot include both pageUrl and jsonUrl`);
  }

  return {
    pageUrl: normalized.pageUrl || undefined,
    jsonUrl: normalized.jsonUrl || undefined,
    referenceImageUrl: normalized.referenceImageUrl || undefined,
    prefix: normalized.prefix || derivePrefix(normalized, index),
  };
}

function derivePrefix(target: HtmlRestorationBatchTarget, index: number): string {
  if (target.pageUrl) {
    try {
      const parsedUrl = new URL(target.pageUrl);
      const hash = parsedUrl.hash.startsWith('#')
        ? parsedUrl.hash.slice(1)
        : parsedUrl.hash;
      const queryString = hash.includes('?')
        ? hash.split('?')[1]
        : parsedUrl.searchParams.toString();
      const params = new URLSearchParams(queryString);
      const imageId = params.get('image_id');
      if (imageId) {
        return imageId.slice(0, 8);
      }
    } catch {
      // fall back to index-based prefix
    }
  }

  if (target.jsonUrl) {
    try {
      const parsedUrl = new URL(target.jsonUrl);
      const basename = path.basename(parsedUrl.pathname).replace(/[^a-z0-9]+/gi, '');
      if (basename) {
        return basename.slice(0, 12);
      }
    } catch {
      // fall back to index-based prefix
    }
  }

  return `target-${String(index + 1).padStart(2, '0')}`;
}

function uniquifyTargetPrefixes(
  targets: NormalizedBatchTarget[],
): NormalizedBatchTarget[] {
  const seenCounts = new Map<string, number>();

  return targets.map(target => {
    const seen = seenCounts.get(target.prefix) || 0;
    seenCounts.set(target.prefix, seen + 1);

    if (seen === 0) {
      return target;
    }

    return {
      ...target,
      prefix: `${target.prefix}-${String(seen + 1).padStart(2, '0')}`,
    };
  });
}

function resolveNumber(value: number | undefined, envValue: string | undefined, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  const parsedEnv = Number(envValue);
  if (Number.isFinite(parsedEnv)) {
    return parsedEnv;
  }

  return fallback;
}

function wait(ms: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(resolve, ms);
  });
}

export const htmlRestorationBatchRunner = new HtmlRestorationBatchRunner();
