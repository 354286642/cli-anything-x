/**
 * Agent-Native 流程 Skill 深度语义补全引擎 (Flow Enricher)
 * 在基础抓包 Flow 骨架之上，通过真正的 Codex CLI / AI Agent 联动，将 capture 数据与意图翻译为完备的 Skill
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join, resolve } from 'path';
import { execSync } from 'child_process';
import type { FlowData } from '../flow-compiler.js';
import { compileFlow } from '../flow-compiler.js';
import { validateFlowGrounding } from '../grounding.js';
import { loadModuleRegistry, listRegistryModules } from '../skill-builder.js';

export interface EnrichResult {
  success: boolean;
  flowJsonPath: string;
  skillMdPath: string;
  promptPath?: string;
  flowData: FlowData;
  warnings: string[];
  usedCodexCli: boolean;
}

/**
 * 检查本机环境变量中是否存在 codex 或 claude 命令行
 */
function detectCodexCli(): string | null {
  try {
    execSync('codex --version', { stdio: 'ignore' });
    return 'codex';
  } catch {
    try {
      execSync('claude --version', { stdio: 'ignore' });
      return 'claude';
    } catch {
      return null;
    }
  }
}

/**
 * 针对超长流程的滑动窗口分段函数 (Sliding Window Chunking)
 * 将步骤划分为多批窗口（每批最多 6 个步骤），避免大模型 Context 溢出
 */
export function chunkStepsForAnalysis(steps: Array<{ id: string; title: string; content: string }>, chunkSize: number = 6): Array<Array<{ id: string; title: string; content: string }>> {
  const chunks: Array<Array<{ id: string; title: string; content: string }>> = [];
  for (let i = 0; i < steps.length; i += chunkSize) {
    chunks.push(steps.slice(i, i + chunkSize));
  }
  return chunks;
}

export function enrichFlowData(flowDirPath: string): EnrichResult {
  const absDir = resolve(process.cwd(), flowDirPath);
  const flowJsonPath = join(absDir, 'flow.json');
  const skillMdPath = join(absDir, 'SKILL.md');
  const promptPath = join(absDir, 'enrich-prompt.md');

  if (!existsSync(flowJsonPath)) {
    throw new Error(`未找到 flow.json 配置文件: ${flowJsonPath}`);
  }

  const rawJson = readFileSync(flowJsonPath, 'utf-8');
  const flowData: FlowData = JSON.parse(rawJson);
  const warnings: string[] = [];

  // 从 Flow 名称中推导 project
  const nameParts = flowData.meta.name.split('-');
  const project = nameParts.length >= 2 ? nameParts[1] : 'default';

  // 1. 自动加载接口注册表规范并建立 API ID -> Java 代码源文件索引
  const loadedRegistries: Array<NonNullable<ReturnType<typeof loadModuleRegistry>>> = [];
  const apiCodeMap = new Map<string, { summary?: string; controllerFile?: string }>();
  try {
    const modules = listRegistryModules(project);
    for (const mod of modules) {
      const reg = loadModuleRegistry(project, mod);
      if (reg) {
        loadedRegistries.push(reg);
        if (reg.apis) {
          for (const api of reg.apis) {
            apiCodeMap.set(api.id, {
              summary: api.summary,
              controllerFile: (api as any).enrichment?.controllerFile || (api as any).controllerFile,
            });
            // 兼容 path 索引
            apiCodeMap.set(`${api.method.toUpperCase()} ${api.path}`, {
              summary: api.summary,
              controllerFile: (api as any).enrichment?.controllerFile || (api as any).controllerFile,
            });
          }
        }
      }
    }
  } catch {
    warnings.push(`未找到项目 ${project} 的接口注册表，将基于标准启发式规则构建 Prompt。`);
  }

  // 2. 检查视轨视频资产
  const videoExists = existsSync(join(absDir, 'assets', 'video.webm'));

  // 3. 长流程物理滑动窗口分段 (Sliding Window Chunking)
  const stepChunks = chunkStepsForAnalysis(flowData.steps, 6);

  // 4. 映射 API 步骤与后端 Java 源码路径
  const mappedApiSteps = flowData.steps
    .map((s, idx) => {
      const codeInfo = apiCodeMap.get(s.id) || Array.from(apiCodeMap.entries()).find(([k]) => s.title.includes(k))?.[1];
      const codePathStr = codeInfo?.controllerFile ? `\n  └─ 💻 后端 Java 源码: \`${codeInfo.controllerFile}\`` : '';
      return `${idx + 1}. [${s.id}] ${s.title}: ${s.content}${codePathStr}\n  └─ 📷 视轨物理截图: \`assets/${s.id.replace('step', 'step-')}.png\``;
    })
    .join('\n');

  // 5. 构造专门给 Codex Agent 阅读分析的智能 Prompt 上下文
  const enrichPromptContent = `# Live Lens 2.0 Skill 深度语义补全任务

你是一个高级 Agent 流程架构师。请针对以下抓包生成的 \`flow.json\` 原始骨架、后端 Java 源码与视轨多模态资产，进行业务语义补全。

## 目标 Flow
- **名称**: ${flowData.meta.name}
- **标题**: ${flowData.title}
- **项目**: ${project}
- **总捕获 API 步骤数**: ${flowData.steps.length} 个 (已划分为 ${stepChunks.length} 个滑动分析窗口)

## 🎥 视轨视频与物理资产 (Video & Screenshots)
- **录像视频文件**: ${videoExists ? '`assets/video.webm` (包含全流程视轨录像，分析连续交互或过渡动画时可调阅)' : '未产生视频文件'}
- **截图资产目录**: \`assets/\` (如 \`assets/step-1.png\`)

## 💻 捕获 API 步骤与后端 Java 源码关联
${mappedApiSteps}

## 任务要求

请阅读并分析上述 **后端 Java Controller 源码文件** 以及前端截图/视频，结合业务逻辑更新 \`flow.json\`，补充与重构以下结构：

1. **步骤顺序重排 (Action Flow Re-ordering)**:
   - **不要单纯按 Ajax 报文响应顺序！** 请结合截屏/视频中人类在界面上的物理点击顺序（如：选择客户 -> 填写参数 -> 提交订单）对步骤进行重新排序；
   - 过滤掉无意义的打点/日志接口 (如 tracker-service)，为核心步骤赋予具备人类可读性的名称（如 *'步骤 1: 选择目标客户'*、*'步骤 2: 创建订单'*）。
2. **scenarios**: 结合 Controller 业务功能与 Prompt 触发词补充适用场景。
3. **fieldGroups**: 查阅 Java DTO 实体类中的校验注解 (如 @NotNull, @NotBlank, @Pattern)，提取精确字段校验组。
4. **speechTemplates**: 补充二次确认与成功汇报模板。
5. **agentStrategy**: 结合 Java 业务校验规则补充 prefillRules、mustAsk 与 forbidden 禁忌。
6. **errorHandling**: 结合 Java 抛出的 Exception 和 ErrorCode 补充异常自愈处理。

处理完毕后请直接将更新后的完整 JSON 写回 \`flow.json\`！

`;

  writeFileSync(promptPath, enrichPromptContent, 'utf-8');



  // 3. 检查本机是否可以直接唤起 Codex CLI
  const cliTool = detectCodexCli();
  let usedCodexCli = false;

  if (cliTool === 'codex') {
    try {
      execSync(`codex exec "请读取 ${promptPath} 并自动完成 ${flowJsonPath} 的语义补全"`, {
        cwd: process.cwd(),
        stdio: 'inherit',
      });
      usedCodexCli = true;
    } catch {
      warnings.push(`自动唤起 codex cli 失败，回退到本地确定性增强模式。`);
    }
  }

  // 4. 基础确定性规则兜底（确保没有 Codex CLI 时也能有完备结构）
  if (!flowData.scenarios || flowData.scenarios.length === 0) {
    flowData.scenarios = [
      `原系统 ${flowData.title} 自动化操作`,
      `当 Agent 收到指令："${flowData.meta.triggers.join(' / ')}" 时自动复跑`,
    ];
  }

  if (!flowData.fieldGroups || flowData.fieldGroups.length === 0) {
    flowData.fieldGroups = [
      {
        name: '流程核心入参校验',
        fields: [
          { name: 'projectId', type: 'string', required: false, condition: null, options: null, description: '项目 ID' },
          { name: 'recordId', type: 'string', required: false, condition: null, options: null, description: '记录 ID' },
        ],
      },
    ];
  }

  if (!flowData.speechTemplates || flowData.speechTemplates.length === 0) {
    flowData.speechTemplates = [
      {
        name: '执行确认',
        template: `准备为您自动执行流程【${flowData.title}】，捕获 ${flowData.steps.length} 个接口，请确认是否继续？`,
        note: '提交前播报',
      },
      {
        name: '结果汇报',
        template: `🎉 流程【${flowData.title}】已顺利执行完成！`,
        note: '结束时播报',
      },
    ];
  }

  if (!flowData.agentStrategy || !flowData.agentStrategy.prefillRules || flowData.agentStrategy.prefillRules.length === 0) {
    flowData.agentStrategy = {
      prefillRules: [
        '优先从前序步骤 API 响应中提取关联映射参数',
        '缺少 projectId 时使用当前 Profile 绑定的默认项目',
      ],
      mustAsk: ['触发敏感修改或删除接口时必须请用户确认'],
      forbidden: ['严禁伪造不存在的 recordId'],
    };
  }

  if (!flowData.errorHandling || flowData.errorHandling.length === 0) {
    flowData.errorHandling = [
      { scenario: '接口返回 401 Unauthorized', handling: '提示用户 SessionId 过期，建议运行 anycli auth login。' },
      { scenario: '依赖的前序 API 返回空', handling: '终止流程并汇报“未找到匹配数据”。' },
    ];
  }

  // 5. 校验与重新编译 SKILL.md
  try {
    const groundingRes = validateFlowGrounding(flowData);
    if (!groundingRes.valid) {
      warnings.push(...groundingRes.issues.map((i) => `[Grounding Warning] ${i.message}`));
    }
  } catch {
    // 门禁校验容错
  }

  writeFileSync(flowJsonPath, JSON.stringify(flowData, null, 2), 'utf-8');

  const { skillMd } = compileFlow(flowData);
  writeFileSync(skillMdPath, skillMd, 'utf-8');

  return {
    success: true,
    flowJsonPath,
    skillMdPath,
    promptPath,
    flowData,
    warnings,
    usedCodexCli,
  };
}
