const LEGACY_LANHU_ASSET_HOSTS = new Set([
  'alipic.lanhuapp.com',
  'lanhu-oss-proxy.lanhuapp.com',
]);

const CANONICAL_LANHU_ASSET_HOST = 'assets.lanhuapp.com';

export function normalizeLanhuAssetUrl(sourceUrl: string): string {
  try {
    const url = new URL(sourceUrl);
    if (!LEGACY_LANHU_ASSET_HOSTS.has(url.hostname.toLowerCase())) {
      return sourceUrl;
    }

    url.protocol = 'https:';
    url.host = CANONICAL_LANHU_ASSET_HOST;
    return url.toString();
  } catch {
    return sourceUrl;
  }
}