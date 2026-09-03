/** Flow Enhance 的共享 HTTP/SSE 会话管理器，供 flow-editor 与统一编辑器复用。 */
import { appendFileSync, existsSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

function sendSseHeaders(res) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'Access-Control-Allow-Origin': '*' });
}
function event(res, type, data) { if (!res.writableEnded) res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`); }
function brief(evt) {
  if (evt.type === 'session.created') return '本地 Agent 会话已建立';
  if (evt.type === 'agent_message' && evt.message) return String(evt.message).replace(/\s+/g, ' ').slice(0, 300);
  const item = evt.item && typeof evt.item === 'object' ? evt.item : null;
  if (item) {
    const detail = item.path || item.command || item.name || '';
    if (detail) return `${item.type || evt.type}：${String(detail).replace(/\s+/g, ' ').slice(0, 220)}`;
  }
  return null;
}
function sourceRoot(root, flow) {
  const project = String(flow?.meta?.name || '').split('-')[1] || '';
  const cfg = path.join(root, 'apis', project, 'gen.json');
  try {
    const javaRoot = JSON.parse(readFileSync(cfg, 'utf8')).javaSourceRoot;
    if (javaRoot && existsSync(javaRoot)) return javaRoot;
  } catch { /* registry/code evidence is optional */ }
  return root;
}
function stopProcessTree(child) {
  if (!child?.pid) return;
  try {
    if (process.platform === 'win32') spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', shell: true });
    else child.kill('SIGTERM');
  } catch { /* 进程可能已退出 */ }
}
function codexFailureMessage(stderr, code) {
  const useful = String(stderr || '').split(/\r?\n/)
    .filter((line) => line.trim() && !/codex_memories_write|Phase 2 no changes|\bWARN\b/i.test(line))
    .slice(-3).join(' ');
  return useful || `Codex 未生成可用结果（退出码 ${code}）。请稍后重试；若持续出现，请检查本地 Codex 登录与日志。`;
}
function resolveCodexCommand() {
  if (process.env.CODEX_CLI_PATH && existsSync(process.env.CODEX_CLI_PATH)) return process.env.CODEX_CLI_PATH;
  if (process.platform !== 'win32') return 'codex';
  const packageRoot = path.join(process.env.APPDATA || '', 'npm', 'node_modules', '@openai', 'codex', 'node_modules', '@openai');
  try {
    for (const packageName of readdirSync(packageRoot).filter((name) => name.startsWith('codex-win32-'))) {
      const vendorRoot = path.join(packageRoot, packageName, 'vendor');
      for (const vendorName of readdirSync(vendorRoot)) {
        const executable = path.join(vendorRoot, vendorName, 'bin', 'codex.exe');
        if (existsSync(executable)) return executable;
      }
    }
  } catch { /* 回退到 PATH 中的可执行文件 */ }
  return 'codex';
}
const CODEX_COMMAND = resolveCodexCommand();
function appendDiagnostic(task, label, content) {
  if (!task.logFile || !content) return;
  try { appendFileSync(task.logFile, `\n[${new Date().toISOString()}] ${label}\n${String(content)}\n`, 'utf8'); } catch { /* 诊断写入不影响主流程 */ }
}

export function createFlowEnhanceManager({ root, readBody, sendError, sendJson }) {
  const tasks = new Map();
  let busy = false;

  async function core() { return import(pathToFileURL(path.join(root, 'dist', 'core', 'flow-enhance.js')).href); }
  async function parseBody(req) { try { return JSON.parse((await readBody(req)) || '{}'); } catch { throw new Error('请求体不是合法 JSON'); } }
  function cleanTmp(task) { for (const file of [task.schemaFile, task.outputFile]) try { if (file && existsSync(file)) unlinkSync(file); } catch { /* ignore */ } }

  async function run(task, res, prompt, resume = false) {
    const c = await core();
    task.status = 'running'; task.child = null; busy = true;
    task.logFile = path.join(tmpdir(), `anycli-flow-enhance-${task.id}.log`);
    writeFileSync(task.logFile, `[${new Date().toISOString()}] Flow Enhance started\n`, 'utf8');
    sendSseHeaders(res);
    event(res, 'stage', { message: resume ? '正在恢复本地 Agent 会话…' : '正在检查 Codex 登录态并建立分析会话…' });
    const login = spawnSync(CODEX_COMMAND, ['login', 'status'], { encoding: 'utf8', timeout: 20000 });
    appendDiagnostic(task, 'codex login status', `${login.stdout || ''}\n${login.stderr || ''}`);
    if (login.status !== 0) { event(res, 'error', { id: task.id, message: `codex 未登录，请先执行 codex login。诊断日志：${task.logFile}` }); res.end(); busy = false; return; }
    task.schemaFile = path.join(tmpdir(), `anycli-flow-enhance-schema-${task.id}.json`);
    task.outputFile = path.join(tmpdir(), `anycli-flow-enhance-out-${task.id}.json`);
    writeFileSync(task.schemaFile, JSON.stringify(c.FLOW_ENHANCE_SCHEMA, null, 2), 'utf8');
    const cwd = sourceRoot(root, task.flow);
    const args = resume && task.codexSessionId
      ? ['exec', 'resume', task.codexSessionId, '--json', '--output-schema', task.schemaFile, '-o', task.outputFile]
      : ['exec', '-C', cwd, '-s', 'read-only', '--json', '--output-schema', task.schemaFile, '-o', task.outputFile];
    event(res, 'stage', { message: `开始反向分析流程结束接口：${task.analysis.endApi.method} ${task.analysis.endApi.path}` });
    let buffer = ''; let stderr = ''; let lastMessage = '';
    appendDiagnostic(task, 'command', `${CODEX_COMMAND} ${args.join(' ')}`);
    const child = spawn(CODEX_COMMAND, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    task.child = child;
    const timer = setTimeout(() => stopProcessTree(child), 10 * 60 * 1000);
    const heartbeat = setInterval(() => event(res, 'heartbeat', { message: '本地 Agent 分析中…' }), 15000);
    child.stdout.on('data', (chunk) => {
      const text = String(chunk);
      appendDiagnostic(task, 'stdout', text);
      buffer += text;
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index).trim(); buffer = buffer.slice(index + 1);
        if (!line) continue;
        try {
          const parsed = JSON.parse(line);
          task.codexSessionId ||= parsed.session_id || parsed.sessionId || parsed.session?.id || parsed.thread_id || (parsed.type === 'session.created' ? parsed.id : null);
          if (parsed.type === 'agent_message' && parsed.message) lastMessage = parsed.message;
          const text = brief(parsed); if (text) event(res, 'progress', { message: text });
        } catch { /* non-json output is deliberately not shown */ }
      }
    });
    child.stderr.on('data', (chunk) => { const text = String(chunk); stderr = (stderr + text).slice(-1600); appendDiagnostic(task, 'stderr', text); });
    const disconnected = () => { if (task.status === 'running') stopProcessTree(child); };
    res.on('close', disconnected);
    child.on('close', async (code) => {
      clearTimeout(timer); clearInterval(heartbeat); task.child = null; busy = false;
      appendDiagnostic(task, 'exit', `code=${code}`);
      if (task.status === 'cancelled') { event(res, 'cancelled', { id: task.id }); if (!res.writableEnded) res.end(); return; }
      const hasOutput = existsSync(task.outputFile) && readFileSync(task.outputFile, 'utf8').trim().length > 0;
      if (code !== 0 && !hasOutput) {
        task.status = 'failed';
        event(res, 'error', { id: task.id, message: `${codexFailureMessage(stderr, code)} 诊断日志：${task.logFile}` });
        if (!res.writableEnded) res.end();
        return;
      }
      if (code !== 0) event(res, 'progress', { message: 'Codex 会话记录异常，但已获得模型输出，正在继续解析提案…' });
      try {
        const raw = hasOutput ? readFileSync(task.outputFile, 'utf8') : lastMessage;
        const result = c.parseEnhanceResult(raw, task.analysis);
        task.result = result;
        if (result.status === 'needs_input') { task.status = 'waiting_input'; event(res, 'question', { id: task.id, questions: result.questions, analysis: { traces: task.analysis.traces, warnings: task.analysis.warnings } }); }
        else {
          result.proposal.flow = c.mergeEnhanceProposal(task.flow, result.proposal);
          task.status = 'ready'; event(res, 'proposal', { id: task.id, proposal: result.proposal });
        }
      } catch (error) { task.status = 'failed'; event(res, 'error', { id: task.id, message: `${error instanceof Error ? error.message : String(error)}。诊断日志：${task.logFile}` }); }
      if (!res.writableEnded) res.end();
    });
    child.stdin.write(prompt); child.stdin.end();
  }

  return {
    async start(req, res, flow, capture) {
      if (busy) return sendError(res, 409, '已有 Flow 完善任务正在分析，请等待完成或取消');
      let body;
      try { body = await parseBody(req); } catch (error) { return sendError(res, 400, error.message); }
      try {
        const c = await core();
        const analysis = c.analyzeFlowEnd(body.flow || flow, body.endApi, capture);
        const task = { id: randomUUID(), flow: body.flow || flow, analysis, capture, businessGoalContext: String(body.businessGoalContext || '').trim(), status: 'created', result: null, codexSessionId: null, child: null };
        tasks.set(task.id, task);
        const prompt = c.buildFlowEnhancePrompt(task.flow, analysis, capture, task.businessGoalContext);
        await run(task, res, prompt);
      } catch (error) { sendError(res, 400, error instanceof Error ? error.message : String(error)); }
    },
    async answer(req, res, id) {
      const task = tasks.get(id);
      if (!task) return sendError(res, 404, 'Flow 完善会话不存在或已取消');
      if (task.status !== 'waiting_input') return sendError(res, 409, '当前会话未在等待回答');
      if (busy) return sendError(res, 409, '已有 Flow 完善任务正在分析');
      let body;
      try { body = await parseBody(req); } catch (error) { return sendError(res, 400, error.message); }
      const answers = body.answers && typeof body.answers === 'object' ? body.answers : {};
      const prompt = `以下是用户对你上一轮问题的回答：\n${JSON.stringify(answers, null, 2)}\n请继续从流程结束接口反向分析，并按既定 JSON Schema 输出 needs_input 或 proposal。`;
      await run(task, res, prompt, true);
    },
    status(_req, res, id) {
      const task = tasks.get(id);
      if (!task) return sendError(res, 404, 'Flow 完善会话不存在或已取消');
      return sendJson(res, 200, { id: task.id, status: task.status, result: task.result, analysis: task.analysis });
    },
    cancel(_req, res, id) {
      const task = tasks.get(id);
      if (!task) return sendError(res, 404, 'Flow 完善会话不存在或已取消');
      task.status = 'cancelled'; try { task.child?.kill(); } catch { /* ignore */ }
      tasks.delete(id); cleanTmp(task);
      return sendJson(res, 200, { ok: true, id });
    },
  };
}
