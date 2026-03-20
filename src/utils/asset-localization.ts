import crypto from 'node:crypto';
import path from 'node:path';

export function slugifyPathSegment(value: string): string {
  return String(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function buildDefaultAssetOutputDir(name: string, seed: string, baseDir = path.resolve('artifacts', 'mcp-assets')): string {
  const safeName = slugifyPathSegment(name) || 'design';
  const suffix = crypto.createHash('sha1').update(seed).digest('hex').slice(0, 8);
  return path.resolve(baseDir, `${safeName}-${suffix}-assets`);
}

export function buildAssetPublicPath(outputDir: string, override?: string): string {
  if (override) {
    return override;
  }

  return `./${path.basename(outputDir).replace(/\\/g, '/')}`;
}
