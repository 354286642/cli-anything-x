import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

export interface FlowRevision {
  version: number;
  timestamp: string;
  author: string;
  message: string;
}

export interface FlowVersionMeta {
  currentVersion: number;
  revisions: FlowRevision[];
}

const VERSION_FILE = 'flow.version.json';

/**
 * 读取 flow 版本元数据
 */
export function loadFlowVersion(flowDir: string): FlowVersionMeta {
  const versionPath = join(flowDir, VERSION_FILE);
  if (!existsSync(versionPath)) {
    return { currentVersion: 1, revisions: [] };
  }
  try {
    return JSON.parse(readFileSync(versionPath, 'utf-8')) as FlowVersionMeta;
  } catch {
    return { currentVersion: 1, revisions: [] };
  }
}

/**
 * 记录一次 flow 编辑操作，递增版本号
 */
export function bumpFlowVersion(flowDir: string, message: string, author?: string): FlowVersionMeta {
  const meta = loadFlowVersion(flowDir);
  meta.currentVersion += 1;
  meta.revisions.push({
    version: meta.currentVersion,
    timestamp: new Date().toISOString(),
    author: author || process.env.USER || 'unknown',
    message,
  });

  if (meta.revisions.length > 50) {
    meta.revisions = meta.revisions.slice(-50);
  }

  writeFileSync(join(flowDir, VERSION_FILE), JSON.stringify(meta, null, 2), 'utf-8');
  return meta;
}

/**
 * 获取 flow 当前版本号
 */
export function getFlowVersion(flowDir: string): number {
  return loadFlowVersion(flowDir).currentVersion;
}

/**
 * 查看 flow 版本历史
 */
export function getFlowHistory(flowDir: string, limit = 10): FlowRevision[] {
  const meta = loadFlowVersion(flowDir);
  return meta.revisions.slice(-limit).reverse();
}
