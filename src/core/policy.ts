import { appendFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export type ApiLevel = 'read' | 'write' | 'dangerous';

export interface PolicyContext {
  project: string;
  apiId: string;
  method: string;
  path: string;
  level: ApiLevel;
  profile: string;
  env: string;
}

export interface PolicyDecision {
  allowed: boolean;
  reason?: string;
  requireConfirm?: boolean;
}

const AUDIT_DIR = join(homedir(), '.anycli');
const AUDIT_FILE = join(AUDIT_DIR, 'audit.jsonl');

/**
 * 评估操作策略：prod 环境下 write 需确认，dangerous 需确认 + 审计
 */
export function evaluatePolicy(ctx: PolicyContext, nonInteractive: boolean): PolicyDecision {
  if (ctx.level === 'read') {
    return { allowed: true };
  }

  if (ctx.env === 'prod') {
    if (ctx.level === 'dangerous') {
      if (nonInteractive) {
        return { allowed: false, reason: `prod 环境下 dangerous 操作 (${ctx.apiId}) 在非交互模式下被拒绝` };
      }
      return { allowed: true, requireConfirm: true, reason: `⚠️  prod 环境 dangerous 操作: ${ctx.method} ${ctx.path}` };
    }

    if (ctx.level === 'write') {
      if (nonInteractive) {
        return { allowed: false, reason: `prod 环境下 write 操作 (${ctx.apiId}) 在非交互模式下被拒绝` };
      }
      return { allowed: true, requireConfirm: true, reason: `prod 环境 write 操作: ${ctx.method} ${ctx.path}` };
    }
  }

  return { allowed: true };
}

/**
 * 写入审计日志（append-only JSONL）
 */
export function writeAuditLog(ctx: PolicyContext, status: number, durationMs: number): void {
  try {
    if (!existsSync(AUDIT_DIR)) mkdirSync(AUDIT_DIR, { recursive: true });
    const entry = {
      ts: new Date().toISOString(),
      project: ctx.project,
      api: ctx.apiId,
      method: ctx.method,
      path: ctx.path,
      level: ctx.level,
      profile: ctx.profile,
      env: ctx.env,
      status,
      durationMs,
    };
    appendFileSync(AUDIT_FILE, JSON.stringify(entry) + '\n', 'utf-8');
  } catch {
    // audit is best-effort
  }
}
