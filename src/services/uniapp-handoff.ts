import type { UniAppRestorationRunResult } from './uniapp-restoration-runner.js';

export interface UniAppHandoffAssetFile {
  fileName?: string;
  localPath?: string;
  filePath?: string;
  sourceUrl?: string;
}

export interface UniAppSingleHandoffResult {
  mode: 'uniapp-sfc-assets';
  source: {
    pageUrl?: string;
    jsonUrl?: string;
    designName?: string;
    referenceImageUrl?: string;
  };
  vuePath?: string;
  bundlePath?: string;
  metaPath?: string;
  designWidth: number;
  artboard?: {
    name?: string;
    width?: number;
    height?: number;
  };
  assetDirectory?: string;
  assetPublicPathPrefix?: string;
  assetFiles: UniAppHandoffAssetFile[];
  handoffNotes: string[];
}

export function buildUniAppSingleHandoff(result: UniAppRestorationRunResult): UniAppSingleHandoffResult {
  return {
    mode: 'uniapp-sfc-assets',
    source: {
      pageUrl: result.source?.pageUrl,
      jsonUrl: result.source?.jsonUrl,
      designName: result.source?.designName,
      referenceImageUrl: result.source?.referenceImageUrl,
    },
    vuePath: result.vuePath,
    bundlePath: result.bundlePath,
    metaPath: result.metaPath,
    designWidth: result.designWidth,
    artboard: result.artboard,
    assetDirectory: result.localizedAssets?.outputDir,
    assetPublicPathPrefix: result.localizedAssets?.publicPathPrefix,
    assetFiles: toHandoffAssetFiles(result.localizedAssets?.files),
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
): UniAppHandoffAssetFile[] {
  return (files || []).map(file => ({
    fileName: file.fileName,
    localPath: file.localPath,
    filePath: file.filePath,
    sourceUrl: file.sourceUrl,
  }));
}

function buildHandoffNotes(): string[] {
  return [
    'This MCP hands off a static UniApp single-file component and localized image assets.',
    'Use vuePath as the primary delivery artifact, and treat assetFiles as the canonical image resources.',
    'The generated SFC is static and intended as a first-pass reconstruction baseline for downstream refinement.',
  ];
}