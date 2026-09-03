/**
 * 本地脱敏过滤器 (Local Sanitizer)
 * 保护底层网络报文中的 Cookie、Authorization、x-session-id 等敏感信息绝不出本地环境。
 */

export interface RawNetworkLogItem {
  requestId: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  postData?: string | null;
  status?: number;
  responseHeaders?: Record<string, string>;
  responseBody?: string | null;
  timestamp: number;
  resourceType: string;
}

const DEFAULT_ERASE_HEADERS = new Set([
  'cookie',
  'authorization',
  'x-session-id',
  'sec-ch-ua',
  'sec-ch-ua-mobile',
  'sec-ch-ua-platform',
]);

const SENSITIVE_BODY_KEYS = ['password', 'passwd', 'secret', 'userToken', 'accessToken'];
const API_PATH_SEGMENT = '/api';

/** 仅保留非 OPTIONS 且路径中含有 /api 段的实际业务接口。 */
export function isExcludedLiveLensRequest(url: string, method: string): boolean {
  if (method.toUpperCase() === 'OPTIONS') return true;

  try {
    const pathname = new URL(url).pathname;
    return pathname !== API_PATH_SEGMENT && !pathname.includes(`${API_PATH_SEGMENT}/`);
  } catch {
    return true;
  }
}

export function sanitizeNetworkLogs(
  logs: RawNetworkLogItem[],
  customHeaderKeepList: string[] = []
): RawNetworkLogItem[] {
  const keepListLower = new Set(customHeaderKeepList.map((h) => h.toLowerCase()));

  return logs.filter((log) => !isExcludedLiveLensRequest(log.url, log.method)).map((log) => {
    // 1. 脱敏 Request Headers
    const sanitizedReqHeaders: Record<string, string> = {};
    if (log.headers) {
      for (const [key, val] of Object.entries(log.headers)) {
        const lowerKey = key.toLowerCase();
        if (DEFAULT_ERASE_HEADERS.has(lowerKey) && !keepListLower.has(lowerKey)) {
          sanitizedReqHeaders[key] = '{{SESSION_ID}}';
        } else {
          sanitizedReqHeaders[key] = val;
        }
      }
    }

    // 2. 脱敏 Request Body
    let sanitizedPostData = log.postData;
    if (sanitizedPostData) {
      sanitizedPostData = sanitizeJsonString(sanitizedPostData);
    }

    // 3. 脱敏 Response Body
    let sanitizedResponseBody = log.responseBody;
    if (sanitizedResponseBody) {
      sanitizedResponseBody = sanitizeJsonString(sanitizedResponseBody);
    }

    return {
      ...log,
      headers: sanitizedReqHeaders,
      postData: sanitizedPostData,
      responseBody: sanitizedResponseBody,
    };
  });
}

function sanitizeJsonString(raw: string): string {
  try {
    const obj = JSON.parse(raw);
    maskSensitiveObject(obj);
    return JSON.stringify(obj);
  } catch {
    // 如果不是 JSON，尝试用简单的正则做脱敏
    let result = raw;
    for (const key of SENSITIVE_BODY_KEYS) {
      const reg = new RegExp(`("${key}"\\s*:\\s*")([^"]+)(")`, 'gi');
      result = result.replace(reg, `$1***$3`);
    }
    return result;
  }
}

function maskSensitiveObject(obj: unknown): void {
  if (!obj || typeof obj !== 'object') return;

  if (Array.isArray(obj)) {
    for (const item of obj) {
      maskSensitiveObject(item);
    }
    return;
  }

  const record = obj as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    const lowerKey = key.toLowerCase();
    if (SENSITIVE_BODY_KEYS.some((k) => lowerKey.includes(k.toLowerCase()))) {
      record[key] = '***';
    } else if (typeof record[key] === 'object') {
      maskSensitiveObject(record[key]);
    }
  }
}

