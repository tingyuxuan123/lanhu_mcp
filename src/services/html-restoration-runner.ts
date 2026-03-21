import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export interface HtmlRestorationOptions {
  pageUrl?: string;
  jsonUrl?: string;
  cookie?: string;
  referenceImageUrl?: string;
  outputDir?: string;
  outputPrefix?: string;
  statusTime?: string;
  statusApp?: string;
}

export class HtmlRestorationRunner {
  private readonly scriptUrl: string;

  constructor() {
    const currentDir = path.dirname(fileURLToPath(import.meta.url));
    const scriptPath = path.resolve(currentDir, '../runtime/html-restoration-runtime.mjs');
    this.scriptUrl = pathToFileURL(scriptPath).href;
  }

  async run(options: HtmlRestorationOptions): Promise<unknown> {
    const module = await import(this.scriptUrl);
    if (typeof module.runHtmlRestoration !== 'function') {
      throw new Error('html-restoration-runtime.mjs does not export runHtmlRestoration');
    }

    return module.runHtmlRestoration({
      pageUrl: options.pageUrl,
      jsonUrl: options.jsonUrl,
      cookie: options.cookie,
      referenceImageUrl: options.referenceImageUrl,
      outputDir: options.outputDir,
      outputPrefix: options.outputPrefix,
      statusTime: options.statusTime,
      statusApp: options.statusApp,
    });
  }
}

export const htmlRestorationRunner = new HtmlRestorationRunner();
