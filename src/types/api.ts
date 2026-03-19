/**
 * 蓝湖 API 响应类型定义
 */

/**
 * 蓝湖 API 通用响应结构
 */
export interface LanhuApiResponse<T> {
  code: string;
  msg?: string;
  result: T;
}

/**
 * 设计图版本信息
 */
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

/**
 * 设计图信息响应
 */
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

/**
 * 设计图基本信息（简化版，用于工具返回）
 */
export interface DesignInfo {
  id: string;
  name: string;
  width: number;
  height: number;
  latestVersion: string;
  versions: {
    id: string;
    versionInfo: string;
    jsonUrl: string;
    width: number;
    height: number;
  }[];
  createTime: string;
  updateTime: string;
}

/**
 * 从 ImageResult 提取简化信息
 */
export function extractDesignInfo(result: ImageResult): DesignInfo {
  return {
    id: result.id,
    name: result.name,
    width: result.width,
    height: result.height,
    latestVersion: result.latest_version,
    versions: result.versions.map(v => ({
      id: v.id,
      versionInfo: v.version_info,
      jsonUrl: v.json_url,
      width: v.width,
      height: v.height,
    })),
    createTime: result.create_time,
    updateTime: result.update_time,
  };
}
