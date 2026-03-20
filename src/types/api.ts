/**
 * Lanhu API response types.
 */

export interface LanhuApiResponse<T> {
  code: string;
  msg?: string;
  result: T;
}

export interface UserSettingsResult {
  teamStatus?: {
    team_id?: string;
  };
  [key: string]: unknown;
}

export interface ImageVersion {
  id: string;
  type: 'image';
  height: number;
  width: number;
  create_time: string;
  version_info: string;
  url: string;
  json_url: string;
  d2c_url: string | null;
  version_layout_data: string;
  md5: string | null;
  updated: boolean;
  editor_info: {
    nickname: string;
    avatar: string;
    color: string;
  };
  comments: unknown[];
}

export interface ImageResult {
  batch: string;
  category_cover: unknown[];
  create_time: string;
  dds_jump_status: number;
  group: unknown[];
  height: number;
  home: boolean;
  id: string;
  is_replaced: boolean;
  last_version_num: number;
  lat: unknown[];
  latest_version: string;
  layout_data: string;
  name: string;
  order: number;
  pinyinname: string;
  position_x: number;
  position_y: number;
  positions: unknown[];
  pre: unknown[];
  share_id: string;
  sketch_id: string;
  source: boolean;
  text_scale: string | null;
  trash_recovery: boolean;
  type: 'image';
  update_time: string;
  url: string;
  user_id: string;
  user_in_project: boolean;
  versions: ImageVersion[];
  width: number;
}

export interface DesignVersionSummary {
  id: string;
  versionInfo: string;
  jsonUrl: string;
  imageUrl: string;
  width: number;
  height: number;
  createTime: string;
  updated: boolean;
}

export interface DesignInfo {
  id: string;
  name: string;
  width: number;
  height: number;
  latestVersion: string;
  latestVersionInfo: DesignVersionSummary | null;
  latestJsonUrl: string | null;
  latestImageUrl: string | null;
  versions: DesignVersionSummary[];
  createTime: string;
  updateTime: string;
}

export function getLatestVersion(result: ImageResult): ImageVersion | null {
  const matched = result.versions.find(version => version.id === result.latest_version);
  if (matched) {
    return matched;
  }

  if (result.versions.length === 0) {
    return null;
  }

  return [...result.versions].sort((left, right) => {
    const leftTime = Date.parse(left.create_time);
    const rightTime = Date.parse(right.create_time);
    return Number.isNaN(rightTime) || Number.isNaN(leftTime) ? 0 : rightTime - leftTime;
  })[0];
}

export function extractDesignInfo(result: ImageResult): DesignInfo {
  const latestVersion = getLatestVersion(result);
  const versions: DesignVersionSummary[] = result.versions.map(version => ({
    id: version.id,
    versionInfo: version.version_info,
    jsonUrl: version.json_url,
    imageUrl: version.url,
    width: version.width,
    height: version.height,
    createTime: version.create_time,
    updated: version.updated,
  }));

  return {
    id: result.id,
    name: result.name,
    width: result.width,
    height: result.height,
    latestVersion: result.latest_version,
    latestVersionInfo: latestVersion
      ? {
          id: latestVersion.id,
          versionInfo: latestVersion.version_info,
          jsonUrl: latestVersion.json_url,
          imageUrl: latestVersion.url,
          width: latestVersion.width,
          height: latestVersion.height,
          createTime: latestVersion.create_time,
          updated: latestVersion.updated,
        }
      : null,
    latestJsonUrl: latestVersion?.json_url ?? null,
    latestImageUrl: latestVersion?.url ?? null,
    versions,
    createTime: result.create_time,
    updateTime: result.update_time,
  };
}
