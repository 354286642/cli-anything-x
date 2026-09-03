/**
 * 本地确定性依赖搜寻匹配引擎 (Value-Flow Engine)
 * 前后 API 步骤间的数据依赖推导算法
 */

import type { RawNetworkLogItem } from './sanitizer.js';

export interface ValueMatchDependency {
  /** 当前参数绑定的目标 API 索引 (1-indexed) */
  targetStepIndex: number;
  /** 参数名称 (如 userId 或 id) */
  paramName: string;
  /** 依赖的前序 API 索引 (1-indexed) */
  sourceStepIndex: number;
  /** 前序 API 响应中的 JSON 路径 (如 $.data.list[0].id) */
  sourceJsonPath: string;
  /** 匹配到的真实物理值 */
  matchedValue: unknown;
}

export function inferValueFlowDependencies(logs: RawNetworkLogItem[]): ValueMatchDependency[] {
  const dependencies: ValueMatchDependency[] = [];
  if (logs.length < 2) return dependencies;

  // 保存前序步骤的解析后的 Response JSON
  const parsedResponses: Array<{ stepIndex: number; data: unknown }> = [];

  for (let i = 0; i < logs.length; i++) {
    const stepIndex = i + 1;
    const currentLog = logs[i];

    // 1. 如果有前序响应，尝试对当前请求的 Body/Query 字段做匹配
    if (parsedResponses.length > 0) {
      const currentReqBody = tryParseJson(currentLog.postData);
      if (currentReqBody && typeof currentReqBody === 'object') {
        findMatchesInObject(currentReqBody, stepIndex, parsedResponses, dependencies);
      }
    }

    // 2. 将当前步骤的 Response 解析保存供后续步骤检索
    const currentResBody = tryParseJson(currentLog.responseBody);
    if (currentResBody) {
      parsedResponses.push({ stepIndex, data: currentResBody });
    }
  }

  return dependencies;
}

function findMatchesInObject(
  reqObj: unknown,
  targetStepIndex: number,
  previousResponses: Array<{ stepIndex: number; data: unknown }>,
  results: ValueMatchDependency[]
): void {
  if (!reqObj || typeof reqObj !== 'object') return;

  const entries = Object.entries(reqObj as Record<string, unknown>);
  for (const [key, val] of entries) {
    if (val === null || val === undefined) continue;
    // 仅针对具有辨识度的字符串或非零数字做依匹配（忽略过短字符串或布尔值）
    if (typeof val === 'string' && val.length < 2) continue;
    if (typeof val === 'boolean') continue;

    // 从最近的前序步骤向前搜索
    for (let r = previousResponses.length - 1; r >= 0; r--) {
      const { stepIndex: sourceStepIndex, data: resData } = previousResponses[r];
      const matchPath = searchPathInJson(resData, val, '$');
      if (matchPath) {
        results.push({
          targetStepIndex,
          paramName: key,
          sourceStepIndex,
          sourceJsonPath: matchPath,
          matchedValue: val,
        });
        break; // 找到最近的来源即可
      }
    }
  }
}

function searchPathInJson(target: unknown, searchValue: unknown, currentPath: string): string | null {
  if (target === searchValue) return currentPath;
  if (!target || typeof target !== 'object') return null;

  if (Array.isArray(target)) {
    for (let i = 0; i < target.length; i++) {
      const res = searchPathInJson(target[i], searchValue, `${currentPath}[${i}]`);
      if (res) return res;
    }
    return null;
  }

  const record = target as Record<string, unknown>;
  for (const [key, val] of Object.entries(record)) {
    const res = searchPathInJson(val, searchValue, `${currentPath}.${key}`);
    if (res) return res;
  }

  return null;
}

function tryParseJson(raw?: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
