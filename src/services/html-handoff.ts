import type {
  HtmlRestorationBatchSummary,
  HtmlRestorationBatchSummaryItem,
  HtmlRestorationRunResult,
} from './html-restoration-batch-runner.js';

export interface HtmlHandoffAssetFile {
  fileName?: string;
  localPath?: string;
  filePath?: string;
  sourceUrl?: string;
}

export interface HtmlSingleHandoffResult {
  mode: 'html-assets-only';
  source: {
    pageUrl?: string;
    jsonUrl?: string;
    designName?: string;
    referenceImageUrl?: string;
  };
  htmlPath?: string;
  previewImagePath?: string;
  diffImagePath?: string;
  assetDirectory?: string;
  assetPublicPathPrefix?: string;
  assetFiles: HtmlHandoffAssetFile[];
  similarityScore?: number;
  handoffNotes: string[];
}

export interface HtmlBatchHandoffResult {
  mode: 'html-assets-only';
  outputDir: string;
  summaryPath: string;
  total: number;
  passed: number;
  failed: number;
  belowThreshold: number;
  minScore: number;
  items: Array<{
    prefix: string;
    status: HtmlRestorationBatchSummaryItem['status'];
    attempts: number;
    pageUrl?: string;
    jsonUrl?: string;
    referenceImageUrl?: string;
    htmlPath?: string;
    previewImagePath?: string;
    diffImagePath?: string;
    assetDirectory?: string;
    assetPublicPathPrefix?: string;
    assetFiles: HtmlHandoffAssetFile[];
    similarityScore?: number;
    error?: string;
  }>;
  handoffNotes: string[];
}

export function buildHtmlSingleHandoff(result: HtmlRestorationRunResult): HtmlSingleHandoffResult {
  return {
    mode: 'html-assets-only',
    source: {
      pageUrl: result.source?.pageUrl,
      jsonUrl: result.source?.jsonUrl,
      designName: result.source?.designName,
      referenceImageUrl: result.source?.referenceImageUrl,
    },
    htmlPath: result.htmlPath,
    previewImagePath: result.screenshotPath,
    diffImagePath: result.diffPath,
    assetDirectory: result.localizedAssets?.outputDir,
    assetPublicPathPrefix: result.localizedAssets?.publicPathPrefix,
    assetFiles: toHandoffAssetFiles(result.localizedAssets?.files),
    similarityScore: result.compare?.visualSimilarityScore,
    handoffNotes: buildHandoffNotes(),
  };
}

export function buildHtmlBatchHandoff(summary: HtmlRestorationBatchSummary): HtmlBatchHandoffResult {
  return {
    mode: 'html-assets-only',
    outputDir: summary.outputDir,
    summaryPath: summary.summaryPath,
    total: summary.total,
    passed: summary.passed,
    failed: summary.failed,
    belowThreshold: summary.belowThreshold,
    minScore: summary.minScore,
    items: summary.items.map(item => ({
      prefix: item.prefix,
      status: item.status,
      attempts: item.attempts,
      pageUrl: item.pageUrl,
      jsonUrl: item.jsonUrl,
      referenceImageUrl: item.referenceImageUrl,
      htmlPath: item.htmlPath,
      previewImagePath: item.screenshotPath,
      diffImagePath: item.diffPath,
      assetDirectory: item.assetDirectory,
      assetPublicPathPrefix: item.assetPublicPathPrefix,
      assetFiles: toHandoffAssetFiles(item.assetFiles),
      similarityScore: item.score,
      error: item.error,
    })),
    handoffNotes: buildHandoffNotes(),
  };
}

function toHandoffAssetFiles(
  files: Array<{
    fileName?: string;
    localPath?: string;
    filePath?: string;
    sourceUrl?: string;
  }> | undefined,
): HtmlHandoffAssetFile[] {
  return (files || []).map(file => ({
    fileName: file.fileName,
    localPath: file.localPath,
    filePath: file.filePath,
    sourceUrl: file.sourceUrl,
  }));
}

function buildHandoffNotes(): string[] {
  return [
    'This MCP only hands off HTML and localized image assets for downstream reconstruction.',
    'Use htmlPath as the visual/layout reference, and rebuild your target framework yourself from that HTML.',
    'Use assetDirectory and assetFiles as the canonical icon/image resources; do not re-fetch Lanhu assets when avoidable.',
  ];
}
