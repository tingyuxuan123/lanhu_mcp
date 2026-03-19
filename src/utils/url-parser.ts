/**
 * 蓝湖 MCP 服务 - URL 解析工具
 * 从蓝湖设计图 URL 中提取关键参数
 */

import { InvalidUrlError } from './error.js';

/**
 * 解析后的蓝湖 URL 参数
 */
export interface ParsedLanhuUrl {
  /** 团队 ID (tid) */
  teamId: string;
  /** 项目 ID (pid) */
  projectId: string;
  /** 设计图 ID (image_id) */
  imageId: string;
}

/**
 * 从蓝湖 URL 中解析关键参数
 *
 * 支持的 URL 格式：
 * - https://lanhuapp.com/web/#/item/project/detailDetach?tid=xxx&pid=yyy&image_id=zzz
 * - https://lanhuapp.com/web/#/item/project/stage?tid=xxx&pid=yyy&image_id=zzz
 *
 * @param url 蓝湖设计图 URL
 * @returns 解析后的参数对象
 * @throws InvalidUrlError 如果 URL 格式无效
 */
export function parseLanhuUrl(url: string): ParsedLanhuUrl {
  try {
    const urlObj = new URL(url);

    // 检查是否是蓝湖域名
    if (!urlObj.hostname.includes('lanhuapp.com')) {
      throw new InvalidUrlError('URL 必须是蓝湖域名 (lanhuapp.com)');
    }

    // 从 hash 中提取查询参数
    // 格式: #/item/project/detailDetach?tid=xxx&pid=yyy&image_id=zzz
    const hash = urlObj.hash;

    if (!hash || !hash.includes('?')) {
      throw new InvalidUrlError('URL 缺少必要的查询参数');
    }

    // 提取 hash 中的查询字符串
    const queryString = hash.split('?')[1];
    const params = new URLSearchParams(queryString);

    const teamId = params.get('tid');
    const projectId = params.get('pid') || params.get('project_id');
    const imageId = params.get('image_id');

    // 验证必要参数
    if (!teamId || !projectId || !imageId) {
      const missing: string[] = [];
      if (!teamId) missing.push('tid (团队ID)');
      if (!projectId) missing.push('pid/project_id (项目ID)');
      if (!imageId) missing.push('image_id (设计图ID)');

      throw new InvalidUrlError(`URL 缺少必要参数: ${missing.join(', ')}`);
    }

    return {
      teamId,
      projectId,
      imageId,
    };
  } catch (error) {
    if (error instanceof InvalidUrlError) {
      throw error;
    }
    throw new InvalidUrlError(`无法解析 URL: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * 构建蓝湖 API URL
 */
export function buildApiUrl(params: ParsedLanhuUrl): string {
  const { teamId, projectId, imageId } = params;
  return `https://lanhuapp.com/api/project/image?dds_status=1&image_id=${imageId}&team_id=${teamId}&project_id=${projectId}&all_versions=0`;
}
