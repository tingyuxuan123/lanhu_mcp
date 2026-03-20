/**
 * Lanhu API client.
 */

import { ApiError, AuthenticationError, ParseError } from '../utils/error.js';
import { logger } from '../utils/logger.js';
import { buildApiUrl, ParsedLanhuUrl } from '../utils/url-parser.js';
import type { ImageResult, ImageVersion, LanhuApiResponse, LanhuDocument, UserSettingsResult } from '../types/index.js';
import { getLatestVersion } from '../types/api.js';

export class LanhuClient {
  private cookie: string;
  private readonly baseUrl = 'https://lanhuapp.com';
  private readonly timeout = 30000;

  constructor(cookie: string) {
    this.cookie = cookie;
  }

  setCookie(cookie: string): void {
    this.cookie = cookie;
  }

  private getHeaders(): Record<string, string> {
    return {
      Cookie: this.cookie,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      Referer: 'https://lanhuapp.com/web/',
    };
  }

  private async request<T>(url: string, headers: Record<string, string> = this.getHeaders()): Promise<T> {
    logger.debug(`Request URL: ${url}`);

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers,
        signal: AbortSignal.timeout(this.timeout),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        if (response.status === 401 || response.status === 403) {
          throw new AuthenticationError(`Cookie authentication failed (${response.status})`);
        }
        throw new ApiError(`API request failed: ${response.status} ${response.statusText}`, response.status, body);
      }

      const text = await response.text();
      try {
        return JSON.parse(text) as T;
      } catch {
        throw new ParseError(`Failed to parse JSON response: ${text.slice(0, 200)}...`);
      }
    } catch (error) {
      if (error instanceof AuthenticationError || error instanceof ApiError || error instanceof ParseError) {
        throw error;
      }

      if (error instanceof Error) {
        if (error.name === 'AbortError' || error.message.includes('timeout')) {
          throw new ApiError('Request timeout', 0);
        }
        throw new ApiError(`Network request failed: ${error.message}`, 0);
      }

      throw new ApiError(`Unknown request error: ${String(error)}`, 0);
    }
  }

  async getImageInfo(params: ParsedLanhuUrl): Promise<ImageResult> {
    const resolvedParams = params.teamId
      ? params
      : {
          ...params,
          teamId: await this.getCurrentTeamId(),
        };
    const url = buildApiUrl(resolvedParams);
    const response = await this.request<LanhuApiResponse<ImageResult>>(url);

    if (response.code !== '00000') {
      if (response.code === '40001' || response.code === '40003') {
        throw new AuthenticationError(response.msg || 'Cookie authentication failed');
      }
      throw new ApiError(`Lanhu business error: ${response.msg || response.code}`, 0);
    }

    logger.info(`Fetched design info: ${response.result.name}`);
    return response.result;
  }

  async getCurrentTeamId(): Promise<string> {
    const response = await this.request<LanhuApiResponse<string>>(
      `${this.baseUrl}/api/account/user_settings?settings_type=web_main`,
    );

    if (response.code !== '00000') {
      if (response.code === '40001' || response.code === '40003') {
        throw new AuthenticationError(response.msg || 'Cookie authentication failed');
      }
      throw new ApiError(`Failed to fetch Lanhu user settings: ${response.msg || response.code}`, 0);
    }

    let settings: UserSettingsResult;
    try {
      settings = typeof response.result === 'string'
        ? JSON.parse(response.result) as UserSettingsResult
        : response.result as unknown as UserSettingsResult;
    } catch (error) {
      throw new ParseError(`Failed to parse user settings JSON: ${error instanceof Error ? error.message : String(error)}`);
    }

    const teamId = settings.teamStatus?.team_id;
    if (!teamId) {
      throw new ApiError('Lanhu user settings missing teamStatus.team_id', 0);
    }

    logger.debug(`Resolved team ID from user settings: ${teamId}`);
    return teamId;
  }

  getLatestVersion(result: ImageResult): ImageVersion {
    const latestVersion = getLatestVersion(result);
    if (!latestVersion) {
      throw new ApiError('No design versions found in Lanhu response', 0);
    }

    return latestVersion;
  }

  async fetchSketchJson(jsonUrl: string): Promise<LanhuDocument> {
    const response = await this.request<LanhuDocument>(jsonUrl, {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      Accept: 'application/json, text/plain, */*',
    });

    logger.debug('Lanhu JSON fetched successfully');
    return response;
  }

  async fetchBinary(url: string): Promise<Buffer> {
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          Accept: '*/*',
        },
        signal: AbortSignal.timeout(this.timeout),
      });

      if (!response.ok) {
        throw new ApiError(`Binary request failed: ${response.status} ${response.statusText}`, response.status);
      }

      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      if (error instanceof ApiError) {
        throw error;
      }
      throw new ApiError(`Failed to download binary: ${error instanceof Error ? error.message : String(error)}`, 0);
    }
  }

  async validateCookie(): Promise<boolean> {
    try {
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
