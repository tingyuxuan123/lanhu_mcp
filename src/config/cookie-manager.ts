/**
 * 蓝湖 MCP 服务 - Cookie 管理模块
 */

import { AuthenticationError } from '../utils/error.js';
import { logger } from '../utils/logger.js';

/**
 * Cookie 管理器
 * 管理蓝湖认证 Cookie
 */
export class CookieManager {
  private defaultCookie: string | null = null;

  constructor() {
    // 从环境变量加载默认 Cookie
    this.loadFromEnv();
  }

  /**
   * 从环境变量加载 Cookie
   */
  loadFromEnv(): void {
    const envCookie = process.env.LANHU_COOKIE;
    if (envCookie) {
      this.defaultCookie = envCookie;
      logger.debug('从环境变量加载 Cookie 成功');
    }
  }

  /**
   * 设置默认 Cookie
   */
  setDefaultCookie(cookie: string): void {
    this.defaultCookie = cookie;
    logger.info('默认 Cookie 已设置');
  }

  /**
   * 获取 Cookie
   * 优先使用传入的 Cookie，否则使用默认值
   *
   * @param providedCookie 调用时提供的 Cookie
   * @returns Cookie 字符串
   * @throws AuthenticationError 如果没有可用的 Cookie
   */
  getCookie(providedCookie?: string): string {
    const cookie = providedCookie || this.defaultCookie;

    if (!cookie) {
      throw new AuthenticationError(
        '未提供 Cookie。请通过参数传入或设置 LANHU_COOKIE 环境变量。\n' +
        '获取 Cookie 方法：\n' +
        '1. 登录蓝湖网页版 (lanhuapp.com)\n' +
        '2. 打开浏览器开发者工具 (F12)\n' +
        '3. 切换到 Network 标签页\n' +
        '4. 刷新页面，找到任意请求\n' +
        '5. 在请求头中复制 Cookie 值'
      );
    }

    return cookie;
  }

  /**
   * 验证 Cookie 格式
   * 基本验证，检查是否包含常见的蓝湖 Cookie 字段
   */
  validateCookie(cookie: string): boolean {
    // 检查是否包含常见的蓝湖认证字段
    const requiredFields = ['lanhu', 'user', 'session', 'token'];
    const hasValidField = requiredFields.some(field =>
      cookie.toLowerCase().includes(field)
    );

    if (!hasValidField) {
      logger.warn('Cookie 可能不包含有效的认证字段');
      return false;
    }

    return true;
  }

  /**
   * 检查是否有可用的 Cookie
   */
  hasCookie(): boolean {
    return this.defaultCookie !== null;
  }
}

// 单例实例
export const cookieManager = new CookieManager();
