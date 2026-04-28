import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export interface UniAppRestorationOptions {
  pageUrl?: string;
  jsonUrl?: string;
  cookie?: string;
  referenceImageUrl?: string;
  outputDir?: string;
  outputPrefix?: string;
  statusTime?: string;
  statusApp?: string;
  designWidth?: number;
  assetPublicPath?: string;
}

export interface UniAppRestorationLocalizedAssetFile {
  fileName?: string;
  localPath?: string;
  filePath?: string;
  sourceUrl?: string;
}

export interface UniAppRestorationLocalizedAssets {
  outputDir?: string;
  publicPathPrefix?: string;
  files?: UniAppRestorationLocalizedAssetFile[];
}

export interface UniAppRestorationRunResult {
  source?: {
    pageUrl?: string;
    jsonUrl?: string;
    designName?: string;
    referenceImageUrl?: string;
  };
  artboard?: {
    name?: string;
    width?: number;
    height?: number;
  };
  designWidth: number;
  vuePath?: string;
  metaPath?: string;
  bundlePath?: string;
  localizedAssets?: UniAppRestorationLocalizedAssets;
}

export class UniAppRestorationRunner {
  private readonly scriptUrl: string;

  constructor() {
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    const scriptPath = path.resolve(currentDir, '../runtime/uniapp-restoration-runtime.mjs');
    this.scriptUrl = pathToFileURL(scriptPath).href;
  }

  async run(options: UniAppRestorationOptions): Promise<unknown> {
    const module = await import(this.scriptUrl);
    if (typeof module.runUniAppRestoration !== 'function') {
      throw new Error('uniapp-restoration-runtime.mjs does not export runUniAppRestoration');
    }

    return module.runUniAppRestoration({
      pageUrl: options.pageUrl,
      jsonUrl: options.jsonUrl,
      cookie: options.cookie,
      referenceImageUrl: options.referenceImageUrl,
      outputDir: options.outputDir,
      outputPrefix: options.outputPrefix,
      statusTime: options.statusTime,
      statusApp: options.statusApp,
      designWidth: options.designWidth,
      assetPublicPath: options.assetPublicPath,
    });
  }
}

export const uniAppRestorationRunner = new UniAppRestorationRunner();