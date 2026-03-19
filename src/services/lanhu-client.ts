/**
 * 蓝湖 API 客户端
 * 封装所有蓝湖 API 调用
 */

import { ApiError, AuthenticationError, ParseError } from '../utils/error.js';
import { logger } from '../utils/logger.js';
import { buildApiUrl, ParsedLanhuUrl } from '../utils/url-parser.js';
import type { LanhuApiResponse, ImageResult, LanhuDocument } from '../types/index.js';

/**
 * 蓝湖 API 客户端
 */
export class LanhuClient {
  private cookie: string;
  private baseUrl = 'https://lanhuapp.com';
  private timeout = 30000; // 30秒超时

  constructor(cookie: string) {
    this.cookie = cookie;
  }

  /**
   * 设置 Cookie
   */
  setCookie(cookie: string): void {
    this.cookie = cookie;
  }

  /**
   * 获取通用请求头
   */
  private getHeaders(): Record<string, string> {
    return {
      'Cookie': this.cookie,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Referer': 'https://lanhuapp.com/web/',
    };
  }

  /**
   * 发起 HTTP 请求
   */
  private async request<T>(url: string): Promise<T> {
    logger.debug(`请求 URL: ${url}`);

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: this.getHeaders(),
        signal: AbortSignal.timeout(this.timeout),
      });

      logger.debug(`响应状态: ${response.status}`);

      // 检查响应状态
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        if (response.status === 401 || response.status === 403) {
          throw new AuthenticationError(`认证失败，请检查 Cookie 是否有效 (状态码: ${response.status})`);
        }
        throw new ApiError(
          `API 请求失败: ${response.status} ${response.statusText}`,
          response.status,
          body
        );
      }

      // 解析 JSON
      const text = await response.text();
      try {
        return JSON.parse(text) as T;
      } catch (e) {
        throw new ParseError(`JSON 解析失败: ${text.substring(0, 200)}...`);
      }
    } catch (error) {
      if (error instanceof AuthenticationError || error instanceof ApiError || error instanceof ParseError) {
        throw error;
      }

      // 超时或网络错误
      if (error instanceof Error) {
        if (error.name === 'AbortError' || error.message.includes('timeout')) {
          throw new ApiError('请求超时，请稍后重试', 0);
        }
        throw new ApiError(`网络请求失败: ${error.message}`, 0);
      }

      throw new ApiError(`未知错误: ${String(error)}`, 0);
    }
  }

  /**
   * 获取设计图信息
   */
  async getImageInfo(params: ParsedLanhuUrl): Promise<ImageResult> {
    const url = buildApiUrl(params);
    logger.info(`获取设计图信息: ${params.imageId}`);

    const response = await this.request<LanhuApiResponse<ImageResult>>(url);

    // 检查业务状态码
    if (response.code !== '00000') {
      if (response.code === '40001' || response.code === '40003') {
        throw new AuthenticationError(`认证失败: ${response.msg || '请检查 Cookie 是否有效'}`);
      }
      throw new ApiError(`业务错误: ${response.msg || response.code}`, 0);
    }

    logger.info(`获取成功: ${response.result.name}, 尺寸: ${response.result.width}x${response.result.height}`);
    return response.result;
  }

  /**
   * 获取蓝湖 JSON 数据
   */
  async fetchSketchJson(jsonUrl: string): Promise<LanhuDocument> {
    logger.info(`获取蓝湖 JSON: ${jsonUrl.substring(0, 50)}...`);

    try {
      const response = await fetch(jsonUrl, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Accept-Encoding': 'gzip, deflate',
        },
        signal: AbortSignal.timeout(this.timeout),
      });

      if (!response.ok) {
        throw new ApiError(`获取 JSON 失败: ${response.status}`, response.status);
      }

      const text = await response.text();
      try {
        const data = JSON.parse(text);
        logger.debug('蓝湖 JSON 解析成功');
        return data as LanhuDocument;
      } catch (e) {
        throw new ParseError(`蓝湖 JSON 解析失败`);
      }
    } catch (error) {
      if (error instanceof ApiError || error instanceof ParseError) {
        throw error;
      }
      throw new ApiError(`获取蓝湖 JSON 失败: ${error instanceof Error ? error.message : String(error)}`, 0);
    }
  }

  /**
   * 验证 Cookie 有效性
   */
  async validateCookie(): Promise<boolean> {
    try {
      // 尝试访问一个需要认证的接口来验证 Cookie
      const response = await fetch(`${this.baseUrl}/api/user/info`, {
        method: 'GET',
        headers: this.getHeaders(),
        signal: AbortSignal.timeout(10000),
      });

      return response.ok;
    } catch {
      return false;
    }
  }
}
