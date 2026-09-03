/**
 * URL 归一化与跨 Host 野生接口检测模块
 */

export interface NormalizedUrlResult {
  /** 原始 URL */
  rawUrl: string;
  /** 归一化后的相对 path（如 /api/user/list） */
  normalizedPath: string;
  /** 是否跨 Host（野生接口/外部服务） */
  isCrossHost: boolean;
  /** 解析出的 origin */
  origin: string;
}

export function normalizeUrlPath(
  rawUrl: string,
  gatewayUrl?: string,
  projectPrefix?: string
): NormalizedUrlResult {
  let origin = '';
  let pathname = rawUrl;

  try {
    const parsed = new URL(rawUrl);
    origin = parsed.origin;
    pathname = parsed.pathname;
  } catch {
    // 相对路径直接使用
  }

  // 1. 判断是否跨 Host
  let isCrossHost = false;
  if (gatewayUrl && origin) {
    try {
      const gwParsed = new URL(gatewayUrl);
      if (gwParsed.origin.toLowerCase() !== origin.toLowerCase()) {
        isCrossHost = true;
      }
    } catch {
      // ignore
    }
  }

  // 2. 剥离 project prefix
  let normalizedPath = pathname;
  if (projectPrefix) {
    const cleanPrefix = projectPrefix.replace(/^\/+|\/+$/g, '');
    if (cleanPrefix) {
      const prefixPattern = new RegExp(`^/${cleanPrefix}(/.*)$`, 'i');
      const match = normalizedPath.match(prefixPattern);
      if (match) {
        normalizedPath = match[1];
      }
    }
  }

  return {
    rawUrl,
    normalizedPath,
    isCrossHost,
    origin,
  };
}
