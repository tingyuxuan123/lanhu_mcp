import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  AssetLocalizationFailure,
  AssetLocalizationResult,
  AssetSummary,
  LocalizedAssetFile,
  SimplifiedBounds,
  SimplifiedLayer,
} from '../types/lanhu.js';

export interface AssetBinaryPayload {
  buffer: Buffer;
  contentType?: string;
}

export type AssetDownloadFn = (sourceUrl: string) => Promise<AssetBinaryPayload>;

export interface AssetLocalizerOptions {
  outputDir: string;
  publicPathPrefix?: string;
}

interface AssetReference {
  id?: number;
  name?: string;
  bounds?: SimplifiedBounds;
  assetUrl?: string;
  remoteAssetUrl?: string;
  localAssetPath?: string;
  localAssetFilePath?: string;
}

interface LocalizedAssetRecord {
  localPath: string;
  filePath?: string;
  fileName?: string;
  contentHash?: string;
  error?: string;
}

export class AssetLocalizer {
  constructor(private readonly downloader: AssetDownloadFn = defaultAssetDownloader) {}

  async localize(
    layers: SimplifiedLayer[],
    assets: AssetSummary[] = [],
    options: AssetLocalizerOptions,
  ): Promise<AssetLocalizationResult> {
    const outputDir = path.resolve(options.outputDir);
    const publicPathPrefix = options.publicPathPrefix || `./${path.basename(outputDir)}`;
    const references = [
      ...this.collectLayerReferences(layers),
      ...assets.filter(asset => this.getRemoteAssetUrl(asset)),
    ];

    if (references.length === 0) {
      return {
        directory: null,
        outputDir: null,
        publicPathPrefix: null,
        localizedAssetCount: 0,
        downloadedFileCount: 0,
        files: [],
        failures: [],
      };
    }

    await fs.mkdir(outputDir, { recursive: true });

    const files: LocalizedAssetFile[] = [];
    const failures: AssetLocalizationFailure[] = [];
    const bySourceUrl = new Map<string, LocalizedAssetRecord>();
    const byContentKey = new Map<string, LocalizedAssetRecord>();
    let localizedReferenceCount = 0;

    for (const reference of references) {
      const sourceUrl = this.getRemoteAssetUrl(reference);
      if (!sourceUrl) {
        continue;
      }

      let record = bySourceUrl.get(sourceUrl);
      if (!record) {
        try {
          const { buffer, contentType } = await this.downloader(sourceUrl);
          const contentHash = crypto.createHash('sha1').update(buffer).digest('hex');
          const extension = this.detectAssetExtension(buffer, contentType, sourceUrl);
          const contentKey = `${contentHash}.${extension}`;
          record = byContentKey.get(contentKey);

          if (!record) {
            const fileName = `${this.inferAssetStem(reference)}-${contentHash.slice(0, 12)}.${extension}`;
            const filePath = path.join(outputDir, fileName);
            await fs.writeFile(filePath, buffer);

            record = {
              localPath: this.joinPublicPath(publicPathPrefix, fileName),
              filePath,
              fileName,
              contentHash,
            };
            byContentKey.set(contentKey, record);
            files.push({
              fileName,
              localPath: record.localPath,
              filePath,
              contentHash,
              contentType,
              sourceUrl,
              size: buffer.length,
            });
          }

          bySourceUrl.set(sourceUrl, record);
        } catch (error) {
          record = {
            localPath: sourceUrl,
            error: error instanceof Error ? error.message : String(error),
          };
          bySourceUrl.set(sourceUrl, record);
          failures.push({
            sourceUrl,
            layerId: reference.id,
            layerName: reference.name,
            error: record.error || 'Unknown asset localization error',
          });
        }
      }

      this.applyLocalizedRecord(reference, sourceUrl, record);
      if (!record.error && record.filePath) {
        localizedReferenceCount += 1;
      }
    }

    return {
      directory: path.basename(outputDir),
      outputDir,
      publicPathPrefix,
      localizedAssetCount: localizedReferenceCount,
      downloadedFileCount: files.length,
      files,
      failures,
    };
  }

  private collectLayerReferences(nodes: SimplifiedLayer[], bucket: SimplifiedLayer[] = []): SimplifiedLayer[] {
    for (const node of nodes) {
      if (this.getRemoteAssetUrl(node)) {
        bucket.push(node);
      }

      if (node.children?.length) {
        this.collectLayerReferences(node.children, bucket);
      }
    }

    return bucket;
  }

  private getRemoteAssetUrl(reference: AssetReference): string | undefined {
    const candidate = reference.remoteAssetUrl || reference.assetUrl;
    return candidate && /^https?:\/\//i.test(candidate)
      ? candidate
      : undefined;
  }

  private applyLocalizedRecord(reference: AssetReference, sourceUrl: string, record: LocalizedAssetRecord): void {
    reference.remoteAssetUrl = sourceUrl;
    reference.assetUrl = record.localPath;
    reference.localAssetPath = record.localPath.startsWith('./') || record.localPath.startsWith('../')
      ? record.localPath
      : undefined;
    reference.localAssetFilePath = record.filePath;
  }

  private joinPublicPath(prefix: string, fileName: string): string {
    const normalizedPrefix = String(prefix || '.')
      .replace(/\\/g, '/')
      .replace(/\/+$/g, '');

    if (!normalizedPrefix || normalizedPrefix === '.') {
      return `./${fileName}`;
    }

    return `${normalizedPrefix}/${fileName}`;
  }

  private inferAssetStem(reference: AssetReference): string {
    const nameSlug = this.slugify(reference.name || '');
    if (nameSlug) {
      return nameSlug;
    }

    const width = Math.max(0, Number(reference.bounds?.width) || 0);
    const height = Math.max(0, Number(reference.bounds?.height) || 0);
    const maxDimension = Math.max(width, height);
    const aspectRatio = height > 0 ? width / height : 1;

    if (maxDimension <= 96) {
      return 'icon';
    }
    if (aspectRatio >= 2.4) {
      return 'banner';
    }
    if (aspectRatio <= 0.75) {
      return 'portrait';
    }

    return 'image';
  }

  private slugify(value: string): string {
    const normalized = String(value)
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

    return normalized;
  }

  private detectAssetExtension(buffer: Buffer, contentType: string | undefined, sourceUrl: string): string {
    return this.getExtensionFromMimeType(contentType)
      || this.getExtensionFromBuffer(buffer)
      || this.getExtensionFromUrl(sourceUrl)
      || 'img';
  }

  private getExtensionFromMimeType(contentType?: string): string {
    const normalized = String(contentType || '')
      .split(';')[0]
      .trim()
      .toLowerCase();
    const mimeToExt = new Map([
      ['image/png', 'png'],
      ['image/jpeg', 'jpg'],
      ['image/jpg', 'jpg'],
      ['image/webp', 'webp'],
      ['image/gif', 'gif'],
      ['image/svg+xml', 'svg'],
      ['image/avif', 'avif'],
      ['image/bmp', 'bmp'],
      ['image/x-icon', 'ico'],
      ['image/vnd.microsoft.icon', 'ico'],
    ]);

    return mimeToExt.get(normalized) || '';
  }

  private getExtensionFromUrl(sourceUrl: string): string {
    try {
      const parsedUrl = new URL(sourceUrl);
      const extension = path.extname(parsedUrl.pathname).replace(/^\./, '').toLowerCase();

      return /^(png|jpg|jpeg|webp|gif|svg|avif|bmp|ico)$/.test(extension)
        ? extension === 'jpeg'
          ? 'jpg'
          : extension
        : '';
    } catch {
      return '';
    }
  }

  private getExtensionFromBuffer(buffer: Buffer): string {
    if (!Buffer.isBuffer(buffer) || buffer.length < 4) {
      return '';
    }

    if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
      return 'png';
    }
    if (buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) {
      return 'jpg';
    }
    if (buffer.subarray(0, 6).toString('ascii') === 'GIF87a' || buffer.subarray(0, 6).toString('ascii') === 'GIF89a') {
      return 'gif';
    }
    if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WEBP') {
      return 'webp';
    }
    if (buffer.subarray(0, 4).toString('ascii') === 'BM') {
      return 'bmp';
    }
    if (buffer.subarray(0, 4).equals(Buffer.from([0x00, 0x00, 0x01, 0x00]))) {
      return 'ico';
    }

    const sample = buffer.subarray(0, Math.min(buffer.length, 256)).toString('utf8').trimStart();
    if (sample.startsWith('<svg') || sample.startsWith('<?xml')) {
      return 'svg';
    }

    return '';
  }
}

async function defaultAssetDownloader(sourceUrl: string): Promise<AssetBinaryPayload> {
  const response = await fetch(sourceUrl, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      Accept: '*/*',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to download asset: ${response.status} ${response.statusText}`);
  }

  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    contentType: response.headers.get('content-type') || '',
  };
}

export const assetLocalizer = new AssetLocalizer();
