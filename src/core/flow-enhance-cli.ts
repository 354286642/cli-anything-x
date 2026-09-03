import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import { spawn, spawnSync } from 'child_process';
import inquirer from 'inquirer';
import type { Command } from 'commander';
import { analyzeFlowEnd, buildFlowEnhancePrompt, FLOW_ENHANCE_SCHEMA, mergeEnhanceProposal, normalizeFlowForEnhance, parseEnhanceResult } from './flow-enhance.js';
import { enrichFlowData } from './live-lens/flow-enricher.js';

function brief(event: Record<string, unknown>): string | undefined {
  if (event.type === 'session.created') return '本地 Agent 会话已建立';
  if (event.type === 'agent_message') return String(event.message || '').replace(/\s+/g, ' ').slice(0, 240);
  const item = event.item as Record<string, unknown> | undefined;
  const detail = item && (item.path || item.command || item.name);
  return detail ? `${String(item.type || event.type)}：${String(detail).replace(/\s+/g, ' ').slice(0, 180)}` : undefined;
}

async function codexRun(args: string[], prompt: string, schemaFile: string, outputFile: string): Promise<{ sessionId?: string; raw: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('codex', args, { shell: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let buffer = ''; let stderr = ''; let sessionId: string | undefined; let lastMessage = '';
    child.stdout.on('data', (chunk) => {
      buffer += String(chunk);
      let index: number;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index).trim(); buffer = buffer.slice(index + 1);
        if (!line) continue;
        try {
          const event = JSON.parse(line) as Record<string, unknown>;
          sessionId ||= String(event.session_id || event.sessionId || (event.type === 'session.created' ? event.id : '') || '') || undefined;
          if (event.type === 'agent_message') lastMessage = String(event.message || '');
          const message = brief(event); if (message) process.stdout.write(`[分析] ${message}\n`);
        } catch { /* 不显示非结构化输出 */ }
      }
    });
    child.stderr.on('data', (chunk) => { stderr = (stderr + String(chunk)).slice(-1200); });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`codex 执行失败：${stderr.trim() || code}`));
      const raw = existsSync(outputFile) ? readFileSync(outputFile, 'utf8') : lastMessage;
      resolve({ sessionId, raw });
    });
    child.stdin.write(prompt); child.stdin.end();
  });
}

export async function runFlowEnhanceCli(root: string, flowPath: string, endApi: string, options: { apply?: boolean }): Promise<{ applied: boolean; warnings: string[] }> {
  const flowDir = join(root, flowPath);
  const file = join(flowDir, 'flow.json');
  if (!existsSync(file)) throw new Error(`未找到 flow.json: ${flowPath}`);
  if (spawnSync('codex', ['login', 'status'], { shell: true, stdio: 'ignore' }).status !== 0) throw new Error('codex 未登录，请先执行 codex login');
  const flow = normalizeFlowForEnhance(JSON.parse(readFileSync(file, 'utf8')));
  const captureFile = join(flowDir, 'capture.json');
  const capture = existsSync(captureFile) ? JSON.parse(readFileSync(captureFile, 'utf8')) : undefined;
  const selected = flow.apis.find((api) => api.id === endApi);
  const existingEnd = flow.endApi?.apiRef === endApi ? flow.endApi : undefined;
  if (!selected && !existingEnd) throw new Error(`结束接口不在 Flow API 清单中: ${endApi}`);
  const analysis = analyzeFlowEnd(flow, existingEnd || { apiRef: selected!.id, method: selected!.method, path: selected!.path, bodyTemplate: '{}', evidenceSource: selected!.evidence?.source }, capture);
  const id = randomUUID();
  const schemaFile = join(tmpdir(), `anycli-flow-enhance-${id}.schema.json`);
  const outputFile = join(tmpdir(), `anycli-flow-enhance-${id}.out.json`);
  writeFileSync(schemaFile, JSON.stringify(FLOW_ENHANCE_SCHEMA), 'utf8');
  try {
    let prompt = buildFlowEnhancePrompt(flow, analysis, capture);
    let args = ['exec', '-C', root, '-s', 'read-only', '--json', '--output-schema', schemaFile, '-o', outputFile];
    for (;;) {
      const response = await codexRun(args, prompt, schemaFile, outputFile);
      const result = parseEnhanceResult(response.raw, analysis);
      if (result.status === 'proposal') {
        const merged = mergeEnhanceProposal(flow, result.proposal);
        process.stdout.write(`${JSON.stringify({ endApi: merged.endApi, traces: analysis.traces, warnings: result.proposal.warnings }, null, 2)}\n`);
        if (options.apply) writeFileSync(file, `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
        return { applied: Boolean(options.apply), warnings: result.proposal.warnings };
      }
      const answers = await inquirer.prompt(result.questions.map((question) => ({ type: question.options?.length ? 'list' : 'input', name: question.id, message: question.question, choices: question.options, default: question.recommended })));
      prompt = `用户对流程反推问题的回答：\n${JSON.stringify(answers)}\n请基于以上回答继续，按约定 JSON 输出最终提案或下一轮问题。`;
      args = response.sessionId ? ['exec', 'resume', response.sessionId, '--json', '--output-schema', schemaFile, '-o', outputFile] : args;
    }
  } finally {
    for (const tmp of [schemaFile, outputFile]) try { if (existsSync(tmp)) unlinkSync(tmp); } catch { /* ignore */ }
  }
}

/** 作为 flow 命令的后置扩展注册，避免旧 enrich 的无参数用法破坏兼容性。 */
export function registerFlowEnhanceCommands(program: Command, root: string): void {
  const flow = program.commands.find((command) => command.name() === 'flow');
  if (!flow) return;
  // 旧 init 尚未感知 endApi；在其成功写入骨架后立即迁移，保证新骨架不再落 submitCommand。
  flow.hook('postAction', (_parent, action) => {
    if (action.name() !== 'init') return;
    const [project, business] = action.processedArgs as [string, string];
    const file = join(root, 'skills', project, 'flows', business, 'flow.json');
    if (!existsSync(file)) return;
    const created = JSON.parse(readFileSync(file, 'utf8'));
    if (!created.endApi && created.submitCommand) {
      created.endApi = created.submitCommand;
      delete created.submitCommand;
      writeFileSync(file, `${JSON.stringify(created, null, 2)}\n`, 'utf8');
    }
  });
  const run = async (flowPath: string, options: { endApi?: string; apply?: boolean }) => {
    if (!options.endApi) throw new Error('请通过 --end-api 指定由用户确认的流程结束接口');
    const result = await runFlowEnhanceCli(root, flowPath, options.endApi, options);
    process.stdout.write(result.applied ? '已应用提案；请继续执行 anycli flow build 完成编译与接地校验。\n' : '仅输出提案预览；使用 --apply 才会写入 flow.json。\n');
  };
  flow.command('enhance')
    .description('从用户确认的流程结束接口反向完善 Flow（支持多轮本地 Codex 提问）')
    .argument('<flow-path>', '工作流目录路径')
    .requiredOption('--end-api <api-id>', '流程结束接口 apiRef（不限定为提交接口）')
    .option('--apply', '确认后写入 flow.json；默认仅预览')
    .action(run);
  const enrich = flow.commands.find((command) => command.name() === 'enrich');
  enrich?.description('兼容入口：带 --end-api 时按流程结束接口反向完善；未带参数保持旧补全行为')
    .option('--end-api <api-id>', '流程结束接口 apiRef')
    .option('--apply', '确认后写入 flow.json；默认仅预览')
    .action(async (flowPath: string, options: { endApi?: string; apply?: boolean }) => {
      if (options.endApi) return run(flowPath, options);
      const legacy = enrichFlowData(flowPath);
      process.stdout.write(`兼容补全完成：${legacy.flowJsonPath}\n`);
    });
}
