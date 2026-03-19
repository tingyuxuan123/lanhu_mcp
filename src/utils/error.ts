/**
 * 蓝湖 MCP 服务 - 自定义错误类
 */

export type ErrorCode =
  | 'INVALID_URL'
  | 'AUTH_REQUIRED'
  | 'API_ERROR'
  | 'TIMEOUT'
  | 'PARSE_ERROR'
  | 'LAYER_NOT_FOUND'
  | 'INTERNAL_ERROR';

/**
 * 蓝湖 MCP 基础错误类
 */
export class LanhuMcpError extends Error {
  constructor(
    message: string,
    public readonly code: ErrorCode
  ) {
    super(message);
    this.name = 'LanhuMcpError';
  }

  toJSON() {
    return {
      success: false,
      error: {
        code: this.code,
        message: this.message,
      },
    };
  }
}

/**
 * URL 格式无效错误
 */
export class InvalidUrlError extends LanhuMcpError {
  constructor(message: string = '无效的蓝湖 URL 格式') {
    super(message, 'INVALID_URL');
    this.name = 'InvalidUrlError';
  }
}

/**
 * 认证错误
 */
export class AuthenticationError extends LanhuMcpError {
  constructor(message: string = '需要提供有效的蓝湖 Cookie') {
    super(message, 'AUTH_REQUIRED');
    this.name = 'AuthenticationError';
  }
}

/**
 * API 请求错误
 */
export class ApiError extends LanhuMcpError {
  constructor(
    message: string,
    public readonly statusCode?: number,
    public readonly responseBody?: string
  ) {
    super(message, 'API_ERROR');
    this.name = 'ApiError';
  }
}

/**
 * 解析错误
 */
export class ParseError extends LanhuMcpError {
  constructor(message: string = 'JSON 解析失败') {
    super(message, 'PARSE_ERROR');
    this.name = 'ParseError';
  }
}

/**
 * 图层未找到错误
 */
export class LayerNotFoundError extends LanhuMcpError {
  constructor(layerId: string) {
    super(`未找到图层: ${layerId}`, 'LAYER_NOT_FOUND');
    this.name = 'LayerNotFoundError';
  }
}
