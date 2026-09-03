import { Command } from 'commander';
import inquirer from 'inquirer';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'fs';
import { join, dirname, resolve, relative } from 'path';
import { fileURLToPath } from 'url';
import { success, info, warn, output } from '../core/output.js';
import { compileFlow, writeFlowFiles } from '../core/flow-compiler.js';
import { validateFlowGrounding, validateFlowFieldGrounding } from '../core/grounding.js';
import { loadModuleRegistry } from '../core/skill-builder.js';
import { buildFlowFromChain } from '../core/chain-to-flow.js';
import type { FlowData } from '../core/flow-compiler.js';
import { updateAnycliRouting } from '../core/routing.js';
import { generateSkillDocs } from '../core/skill-docs.js';
import { startLiveLensDaemon, launchDevChromeSandbox, getProjectConfig, getGatewayUrl, enrichFlowData } from '../core/index.js';


import { resolveWorkspace } from '../core/config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PACKAGE_ROOT = resolve(__dirname, '../..');
const WORKSPACE = resolveWorkspace();

function getSkillsDir(): string {
  return join(WORKSPACE, 'skills');
}

interface FlowEntry {
  id: string;
  name: string;
  title: string;
  path: string;
}

function collectFlows(): FlowEntry[] {
  const skillsDir = getSkillsDir();
  const entries: FlowEntry[] = [];
  if (!existsSync(skillsDir)) return entries;

  for (const projectDir of readdirSync(skillsDir, { withFileTypes: true })) {
    if (!projectDir.isDirectory()) continue;
    const flowsDir = join(skillsDir, projectDir.name, 'flows');
    if (!existsSync(flowsDir)) continue;

    for (const flowDir of readdirSync(flowsDir, { withFileTypes: true })) {
      if (!flowDir.isDirectory()) continue;
      const flowJsonPath = join(flowsDir, flowDir.name, 'flow.json');
      const skillMdPath = join(flowsDir, flowDir.name, 'SKILL.md');
      const id = `${projectDir.name}/flows/${flowDir.name}`;

      let name = id;
      let title = flowDir.name;

      if (existsSync(flowJsonPath)) {
        try {
          const data = JSON.parse(readFileSync(flowJsonPath, 'utf-8')) as FlowData;
          name = data.meta?.name ?? id;
          title = data.title ?? flowDir.name;
        } catch { /* ignore parse errors */ }
      } else if (existsSync(skillMdPath)) {
        try {
          const raw = readFileSync(skillMdPath, 'utf-8');
          const nameMatch = raw.match(/^name:\s*(.+)\s*$/m);
          if (nameMatch) name = nameMatch[1].replace(/^['"]|['"]$/g, '').trim();
          const titleMatch = raw.match(/^#\s+(.+)\s*$/m);
          if (titleMatch) title = titleMatch[1];
        } catch { /* ignore */ }
      }

      entries.push({ id, name, title, path: join(flowsDir, flowDir.name) });
    }
  }

  entries.sort((a, b) => a.id.localeCompare(b.id));
  return entries;
}

function createEmptyFlowData(name: string, title: string, description: string, triggers: string[]): FlowData {
  return {
    version: 1,
    meta: { name, description, type: 'flow', triggers },
    title,
    businessGoal: '',
    scenarios: [],
    prerequisites: [],
    steps: [],
    fieldGroups: [],
    apis: [],
    speechTemplates: [],
    agentStrategy: { prefillRules: [], mustAsk: [], forbidden: [] },
    submitCommand: { method: 'POST', path: '', bodyTemplate: '{}' },
    errorHandling: [],
    successCriteria: [],
    domainKnowledge: [],
    reference: { fields: '', examples: '', verify: '' },
  };
}

function refreshSkillDocs(): void {
  try {
    const docsPath = generateSkillDocs({ quiet: true });
    if (docsPath) {
      const relPath = relative(WORKSPACE, docsPath).replace(/\\/g, '/');
      success(`已更新技能总览页面: ${relPath}`);
    }
  } catch (error) {
    warn(`技能总览页面更新失败: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function registerFlowCommands(program: Command): void {
  const flow = program.command('flow').description('工作流管理（流程 Skill 可视化编辑）');

  flow
    .command('record')
    .description('开启 Live Lens 2.0 录制流程器（抓包 + 确定性推理 + 自动生成 flow.json）')
    .argument('<project>', '所属项目标识（如 demo）')
    .argument('<business>', '流程业务标识（如 employee-onboard）')
    .option('-p, --port <port>', '本地 Daemon 端口', '19877')
    .option('--dev', '开发模式：自动查找 Chrome 并唤起带有 Live Lens 插件的调试沙盒')
    .action(async (project: string, business: string, options: { port: string; dev?: boolean }) => {
      const port = parseInt(options.port, 10);

      info(`[Live Lens 2.0] 正在启动本地接收 Daemon (127.0.0.1:${port})...`);

      let projectConfig;
      try {
        projectConfig = getProjectConfig(project);
      } catch {
        // 项目配置可选
      }

      const gatewayUrl = getGatewayUrl();
      const projectPrefix = projectConfig?.prefix;

      const server = startLiveLensDaemon({
        port,
        project,
        business,
        gatewayUrl,
        projectPrefix,
        onSuccess: (res: { flowJsonPath: string; skillMdPath: string; stepCount?: number }) => {
          if (res.stepCount === 0) {
            warn(`\n⚠️ 录制完成，但未捕获到任何底层 Ajax/Fetch 网络接口请求！`);
            info(`📌 核心提示：`);
            info(`   1. 请在点击「开始录制」后，在网页上进行真实操作（如点击搜索按钮、提交表单等，触发 HTTP 接口调用）；`);
            info(`   2. 扩展插件程序更新后，请在 chrome://extensions/ 页面点击小刷新图标 🔄 重新载入扩展后再测试！`);
          } else {
            success(`\n🎉 Live Lens 录制流程解析编译完成！(捕获 ${res.stepCount} 个接口)`);
          }
          info(`- flow.json: ${res.flowJsonPath}`);
          info(`- SKILL.md: ${res.skillMdPath}`);
          info(`提示：运行 'anycli skill build --force' 即可快速重编译并热加载！`);
        },

      });

      success(`[Live Lens 2.0] Daemon 服务就绪。请在 Chrome 插件点击「开始录制」完成抓包！`);

      if (options.dev) {
        info(`[Live Lens 2.0] 正在尝试自动唤起开发模式 Chrome 沙盒...`);
        const launched = launchDevChromeSandbox('https://google.com');
        if (launched) {
          success(`已自动拉起 Chrome 沙盒！`);
          info(`📌 如果扩展未自动显示（常见于后台已存在其他 Chrome 进程）：`);
          info(`   ① 在 Chrome 访问: chrome://extensions/`);
          info(`   ② 勾选右上角「开发者模式」开关`);
          info(`   ③ 点击「加载已解压的扩展程序」，选择目录: C:\\code\\cli-anything-x\\tools\\lens-extension`);
        } else {
          warn(`未能在系统常见路径中找到 Chrome。请手动打开浏览器并在开发者模式中装载 tools/lens-extension 扩展。`);
        }
      } else {


        info(`请在日常 Chrome 中打开插件并点击「开始录制」。按 Ctrl+C 退出 Daemon 监听。`);
      }

      process.on('SIGINT', () => {
        server.close();
        process.exit(0);
      });
    });

  flow
    .command('enrich')
    .description('对录制或创建的 Flow 进行 Agent-Native 语义深度补全（场景/校验字段/话术/策略/异常分支）')
    .argument('<flow-path>', '工作流目录路径（如 skills/demo/flows/test-flow）')
    .action((flowPath: string) => {
      try {
        const res = enrichFlowData(flowPath);
        success(`🎉 流程 Skill 深度语义补全成功！`);
        info(`- flow.json: ${res.flowJsonPath}`);
        info(`- SKILL.md: ${res.skillMdPath}`);
        if (res.warnings.length > 0) {
          for (const w of res.warnings) {
            warn(`  ${w}`);
          }
        }
      } catch (err: unknown) {
        warn(`补全失败: ${err instanceof Error ? err.message : String(err)}`);
      }
    });

  flow

    .command('list')

    .description('列出所有工作流')
    .action(() => {
      const flows = collectFlows();
      if (flows.length === 0) {
        info('未找到任何工作流，请检查 skills/*/flows/ 目录');
        return;
      }
      output({
        total: flows.length,
        flows: flows.map((f) => ({
          id: f.id,
          name: f.name,
          title: f.title,
          hasFlowJson: existsSync(join(f.path, 'flow.json')),
        })),
      });
    });

  flow
    .command('init')
    .description('交互式创建新工作流骨架')
    .argument('<project>', '项目名（如 demo）')
    .argument('<business>', '业务名（如 create-sample-requirement）')
    .action(async (project: string, business: string) => {
      const flowDir = join(getSkillsDir(), project, 'flows', business);
      if (existsSync(flowDir)) {
        warn(`目录已存在: skills/${project}/flows/${business}`);
        return;
      }

      const answers = await inquirer.prompt([
        {
          type: 'input',
          name: 'title',
          message: '工作流中文标题:',
          default: business,
        },
        {
          type: 'input',
          name: 'description',
          message: '一句话描述业务目标:',
          default: `业务流程：${business}`,
        },
        {
          type: 'input',
          name: 'triggers',
          message: '触发词（逗号分隔）:',
          default: business,
        },
      ]);

      const skillName = `flow-${project}-${business}`;
      const triggers = answers.triggers.split(/[,，]/).map((t: string) => t.trim()).filter(Boolean);
      const flowData = createEmptyFlowData(skillName, answers.title, answers.description, triggers);

      mkdirSync(flowDir, { recursive: true });
      mkdirSync(join(flowDir, 'reference'), { recursive: true });
      writeFileSync(join(flowDir, 'flow.json'), JSON.stringify(flowData, null, 2), 'utf-8');

      success(`已创建工作流骨架: skills/${project}/flows/${business}/`);

      const intentDesc = `${triggers.join('、')}（业务流程）`;
      if (updateAnycliRouting(intentDesc, skillName)) {
        success('已更新 anycli 路由表 (skills/anycli/SKILL.md)');
      }

      info('');
      info('下一步:');
      info(`  anycli flow edit skills/${project}/flows/${business}  # 打开可视化编辑器`);
      info(`  anycli flow build skills/${project}/flows/${business} # 编译生成 SKILL.md`);
    });

  flow
    .command('edit')
    .description('启动 Web 可视化编辑器')
    .argument('[flow-path]', '工作流目录路径（相对项目根目录）')
    .option('-p, --port <port>', '服务端口', '3210')
    .action(async (flowPath: string | undefined, options: { port: string }) => {
      const port = parseInt(options.port, 10);
      const editorDir = join(PACKAGE_ROOT, 'tools', 'flow-editor');
      const serverFile = join(editorDir, 'server.mjs');

      if (!existsSync(serverFile)) {
        warn(`编辑器文件不存在: tools/flow-editor/server.mjs`);
        return;
      }

      const { execSync, spawn } = await import('child_process');
      const serverProcess = spawn('node', [serverFile, '--port', String(port), '--root', PACKAGE_ROOT], {
        stdio: 'inherit',
        env: { ...process.env, FLOW_EDITOR_ROOT: PACKAGE_ROOT },
      });

      serverProcess.on('error', (err) => {
        warn(`启动编辑器失败: ${err.message}`);
      });

      await new Promise((resolvePromise) => setTimeout(resolvePromise, 1000));

      const deepLink = flowPath
        ? '/flow/' + flowPath.split(/[\\/]/).filter(Boolean).map(encodeURIComponent).join('/')
        : '';
      const url = `http://localhost:${port}${deepLink}`;
      success(`编辑器已启动: ${url}`);
      info('按 Ctrl+C 退出');

      try {
        const { default: open } = await import('open');
        await open(url);
      } catch {
        info('请手动在浏览器中打开上述地址');
      }

      process.on('SIGINT', () => {
        serverProcess.kill();
        process.exit(0);
      });
    });

  flow
    .command('build')
    .description('编译 flow.json → SKILL.md + reference/')
    .argument('[flow-path]', '工作流目录路径（相对项目根目录）')
    .option('--all', '编译所有工作流')
    .option('--skip-grounding', '跳过接地校验')
    .action(async (flowPath: string | undefined, options: { all?: boolean; skipGrounding?: boolean }) => {
      if (options.all) {
        const flows = collectFlows();
        let built = 0;
        for (const flowEntry of flows) {
          const flowJsonPath = join(flowEntry.path, 'flow.json');
          if (!existsSync(flowJsonPath)) {
            warn(`跳过 ${flowEntry.id}（无 flow.json）`);
            continue;
          }
          buildSingleFlow(flowEntry.path, flowEntry.id, { skipGrounding: options.skipGrounding });
          built++;
        }
        success(`已编译 ${built} 个工作流`);
      } else if (flowPath) {
        const absPath = resolve(WORKSPACE, flowPath);
        if (!existsSync(join(absPath, 'flow.json'))) {
          warn(`未找到 flow.json: ${flowPath}`);
          return;
        }
        buildSingleFlow(absPath, flowPath, { skipGrounding: options.skipGrounding });
      } else {
        warn('请指定工作流路径或使用 --all');
        info('示例: anycli flow build skills/demo/flows/create-order');
      }

      refreshSkillDocs();
      info('');
      info('提示: 执行 anycli skill install --force 将更新安装到 Agent 目录');
    });

  flow
    .command('import')
    .description('将现有 SKILL.md 导入为 flow.json')
    .argument('<skill-md-path>', 'SKILL.md 文件路径（相对项目根目录）')
    .action(async (skillMdPath: string) => {
      const absPath = resolve(WORKSPACE, skillMdPath);
      if (!existsSync(absPath)) {
        warn(`文件不存在: ${skillMdPath}`);
        return;
      }

      const { parseSkillMd, loadReferenceFiles } = await import('../core/flow-parser.js');
      const content = readFileSync(absPath, 'utf-8');
      const flowDir = dirname(absPath);

      const flowData = parseSkillMd(content, flowDir);

      const refData = loadReferenceFiles(flowDir);
      flowData.reference = refData;

      const outPath = join(flowDir, 'flow.json');
      writeFileSync(outPath, JSON.stringify(flowData, null, 2), 'utf-8');
      success(`已导入: ${relative(WORKSPACE, outPath)}`);

      if (flowData._parseWarnings && flowData._parseWarnings.length > 0) {
        warn('解析警告（建议人工校验）:');
        for (const warning of flowData._parseWarnings) {
          info(`  - ${warning}`);
        }
      }

      info('');
      info(`下一步: anycli flow edit ${relative(WORKSPACE, flowDir)}  # 打开编辑器校验`);
    });

  flow
    .command('from-chain')
    .description('F-6：从注册表处理链生成 flow 骨架（steps 接地到注册表 api id）')
    .argument('<project>', '项目名（如 demo）')
    .argument('<module>', '模块名（如 sample）')
    .argument('<chain>', 'chain 序号（从 0 开始）或名称片段')
    .argument('[business]', '业务名（目录名与 meta.name 后缀），默认取 chain 末尾 api id')
    .action((project: string, module: string, chainRef: string, business?: string) => {
      const registry = loadModuleRegistry(project, module);
      if (!registry) {
        warn(`注册表不存在: apis/${project}/${module}.json`);
        return;
      }
      const chains = registry.chains || [];
      if (chains.length === 0) {
        warn(`注册表无 chains。chains 由 gen 依据 outputFields 自动推断 —— 请先 anycli gen 更新注册表，或在 apis/${project}/${module}.json 手工补充 chains。`);
        return;
      }

      let chainIndex = /^\d+$/.test(chainRef) ? parseInt(chainRef, 10) : -1;
      if (chainIndex < 0 || chainIndex >= chains.length) {
        chainIndex = chains.findIndex((c) => c.name.includes(chainRef));
      }
      if (chainIndex < 0 || chainIndex >= chains.length) {
        warn(`未找到 chain: ${chainRef}。可用 chains：`);
        chains.forEach((c, i) => info(`  ${i}: ${c.name}（${c.steps.join(' → ')}）`));
        return;
      }
      const chain = chains[chainIndex];

      let built;
      try {
        built = buildFlowFromChain(project, registry, chain, business);
      } catch (error) {
        warn(error instanceof Error ? error.message : String(error));
        return;
      }

      const flowDir = join(getSkillsDir(), project, 'flows', built.business);
      if (existsSync(flowDir)) {
        warn(`目录已存在: skills/${project}/flows/${built.business}（换 business 名或先清理旧目录）`);
        return;
      }
      mkdirSync(flowDir, { recursive: true });
      const flowJsonPath = join(flowDir, 'flow.json');
      writeFileSync(flowJsonPath, JSON.stringify(built.flowData, null, 2), 'utf-8');
      success(`已生成 flow 骨架: ${relative(WORKSPACE, flowJsonPath)}`);

      const buildResult = buildSingleFlow(flowDir, `${project}/flows/${built.business}`);
      if (!buildResult.ok) return;

      info('');
      info('骨架含「骨架占位」内容，发布前请人工补充：');
      info('  - meta.triggers 触发词（必填，空 triggers 不会登记路由表）');
      info('  - businessGoal / scenarios / prerequisites');
      info('  - fieldGroups 字段字典与各 step 的 fieldRefs');
      info('  - speechTemplates 话术模板 + agentStrategy 预填策略（FLOW-SPEC §5/§6）');
      info('  - reference/verify.md 验证脚本骨架（占位已自动生成，填入真实步骤）');
      refreshSkillDocs();
    });
}

export interface FlowBuildResult {
  ok: boolean;
  message: string;
}

export function buildSingleFlow(flowDir: string, flowId: string, options?: { skipGrounding?: boolean }): FlowBuildResult {
  const flowJsonPath = join(flowDir, 'flow.json');
  try {
    const raw = readFileSync(flowJsonPath, 'utf-8');
    const flowData = JSON.parse(raw) as FlowData;

    if (!options?.skipGrounding) {
      const grounding = validateFlowGrounding(flowData);
      if (!grounding.valid) {
        warn(`接地校验失败 ${flowId}（${grounding.issues.length} 个问题）:`);
        for (const issue of grounding.issues) {
          warn(`  [${issue.stepId}] ${issue.stepTitle}: ${issue.message}`);
        }
        warn('使用 --skip-grounding 跳过校验强制编译');
        return {
          ok: false,
          message: `接地校验失败（${grounding.issues.length} 个问题）：` + grounding.issues.map((issue) => `[${issue.stepId}] ${issue.stepTitle}: ${issue.message}`).join('；'),
        };
      }
      if (grounding.checkedRefs > 0) {
        info(`接地校验通过: ${grounding.checkedRefs} 个 apiRef 全部可解析`);
      }

      // F-7：字段级接地（warning，不阻断编译）
      const fieldGrounding = validateFlowFieldGrounding(flowData);
      if (fieldGrounding.warnings.length > 0) {
        warn(`字段级接地警告 ${flowId}（${fieldGrounding.warnings.length} 项，不阻断编译）:`);
        for (const fieldWarning of fieldGrounding.warnings) {
          warn(`  - ${fieldWarning}`);
        }
      }
    }

    writeFlowFiles(flowDir, flowData);
    bumpFlowVersion(flowDir, `flow build: compile flow.json → SKILL.md`);
    success(`已编译: ${flowId}`);

    if (flowData.meta.triggers.length > 0) {
      const intentDesc = flowData.meta.triggers.join('、') + '（业务流程）';
      updateAnycliRouting(intentDesc, flowData.meta.name);
    }
    return { ok: true, message: `已编译: ${flowId}（SKILL.md + reference/ 已生成）` };
  } catch (error) {
    warn(`编译失败 ${flowId}: ${error instanceof Error ? error.message : String(error)}`);
    return { ok: false, message: `编译失败: ${error instanceof Error ? error.message : String(error)}` };
  }
}

// ── 版本管理子命令（追加注册） ──

import { bumpFlowVersion, loadFlowVersion, getFlowHistory } from '../core/flow-version.js';

export function registerFlowVersionCommands(program: Command): void {
  const flow = program.commands.find((cmd) => cmd.name() === 'flow');
  if (!flow) return;

  flow
    .command('version')
    .description('查看工作流版本信息')
    .argument('<flow-path>', '工作流目录路径')
    .action((flowPath: string) => {
      const absPath = resolve(WORKSPACE, flowPath);
      if (!existsSync(join(absPath, 'flow.json'))) {
        warn(`未找到 flow.json: ${flowPath}`);
        return;
      }
      const meta = loadFlowVersion(absPath);
      output({
        path: flowPath,
        currentVersion: meta.currentVersion,
        totalRevisions: meta.revisions.length,
        latestRevisions: meta.revisions.slice(-5).reverse(),
      });
    });

  flow
    .command('history')
    .description('查看工作流编辑历史')
    .argument('<flow-path>', '工作流目录路径')
    .option('-n, --limit <n>', '显示条数', '10')
    .action((flowPath: string, options: { limit: string }) => {
      const absPath = resolve(WORKSPACE, flowPath);
      const history = getFlowHistory(absPath, parseInt(options.limit, 10));
      if (history.length === 0) {
        info('暂无编辑历史');
        return;
      }
      output({ path: flowPath, history });
    });
}
