/**
 * Live Lens Flow & Skill 产物生成编译器
 * 零 Schema 变更对齐现存 FlowData
 */

import { existsSync, mkdirSync, writeFileSync, rmSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createHash } from 'crypto';
import type { FlowData, FlowStep, FlowApi } from '../flow-compiler.js';
import { compileFlow } from '../flow-compiler.js';
import type { RawNetworkLogItem } from './sanitizer.js';
import type { ValueMatchDependency } from './value-flow-engine.js';
import { normalizeUrlPath } from './url-normalizer.js';

import { resolveWorkspace } from '../config.js';


const WORKSPACE = resolveWorkspace();

export interface FlowGenerateOptions {
  project: string;
  business: string;
  networkLogs: RawNetworkLogItem[];
  dependencies: ValueMatchDependency[];
  intentText?: string;
  clickEvents?: Array<{ timestamp?: number; screenshot?: string; tagName?: string; text?: string }>;
  session?: any;
  videoDataUrl?: string;
  gatewayUrl?: string;
  projectPrefix?: string;
}

export function generateLiveLensFlow(options: FlowGenerateOptions): {
  flowJsonPath: string;
  skillMdPath: string;
  flowData: FlowData;
} {
  const { project, business, networkLogs, dependencies, intentText, clickEvents, session, videoDataUrl, gatewayUrl, projectPrefix } = options;

  const targetDir = resolve(WORKSPACE, 'skills', project, 'flows', business);
  if (!existsSync(targetDir)) {
    mkdirSync(targetDir, { recursive: true });
  }

  // 保存 session.json 会话元数据
  if (session) {
    writeFileSync(join(targetDir, 'session.json'), JSON.stringify(session, null, 2), 'utf-8');
  }

  // 供 Flow Enhance 反向推导使用；networkLogs 已由 daemon 脱敏。
  writeFileSync(join(targetDir, 'capture.json'), JSON.stringify({
    version: 1,
    networkLogs,
    dependencies,
    intentText: intentText || '',
    capturedAt: new Date().toISOString(),
  }, null, 2), 'utf-8');

  const assetsDir = join(targetDir, 'assets');
  if (existsSync(assetsDir)) {
    try {
      rmSync(assetsDir, { recursive: true, force: true });
    } catch {
      // 容错
    }
  }


  // 保存真实录屏视频 video.webm
  if (videoDataUrl && videoDataUrl.startsWith('data:video/')) {
    if (!existsSync(assetsDir)) {
      mkdirSync(assetsDir, { recursive: true });
    }
    const base64Video = videoDataUrl.replace(/^data:video\/\w+;base64,/, '');
    const videoBuffer = Buffer.from(base64Video, 'base64');
    writeFileSync(join(assetsDir, 'video.webm'), videoBuffer);
  }

  // 1. 将截图保存至 assets 目录 (使用 MD5 哈希强力物理去重，剔除完全重复画面)
  if (clickEvents && clickEvents.length > 0) {
    const savedHashes = new Set<string>();
    let stepImgIndex = 1;

    clickEvents.forEach((evt) => {
      if (evt.screenshot && evt.screenshot.startsWith('data:image/')) {
        const base64Data = evt.screenshot.replace(/^data:image\/\w+;base64,/, '');
        const buffer = Buffer.from(base64Data, 'base64');
        const hash = createHash('md5').update(buffer).digest('hex');

        if (!savedHashes.has(hash)) {
          savedHashes.add(hash);
          if (!existsSync(assetsDir)) {
            mkdirSync(assetsDir, { recursive: true });
          }
          writeFileSync(join(assetsDir, `step-${stepImgIndex}.png`), buffer);
          stepImgIndex++;
        }
      }
    });
  }




  const flowName = `flow-${project}-${business}`;
  const title = `${business} 自动录制工作流`;

  const steps: FlowStep[] = [];
  const apis: FlowApi[] = [];

  if (networkLogs.length === 0 && intentText) {
    steps.push({
      id: 'step1',
      title: `步骤 1: 执行 ${business} 业务`,
      level: 1,
      parentId: null,
      conditional: false,
      condition: null,
      dependsOn: [],
      fieldRefs: [],
      content: `意图规则：${intentText}`,
    });
  }

  for (let i = 0; i < networkLogs.length; i++) {

    const log = networkLogs[i];
    const stepIndex = i + 1;
    const stepId = `step${stepIndex}`;

    const normalized = normalizeUrlPath(log.url, gatewayUrl, projectPrefix);
    const apiId = `${project}/${log.method.toUpperCase()}${normalized.normalizedPath}`;


    // 搜索当前步骤涉及的参数依赖
    const currentDeps = dependencies.filter((d) => d.targetStepIndex === stepIndex);
    let depContent = '';
    if (currentDeps.length > 0) {
      depContent = currentDeps
        .map(
          (d) =>
            `将参数 [${d.paramName}] 替换为第 ${d.sourceStepIndex} 步的返回值 (${d.sourceJsonPath})`
        )
        .join('; ');
    }

    let warningText = '';
    if (normalized.isCrossHost) {
      warningText = ` [⚠️ 警告: 该接口位于外部 Host ${normalized.origin}，不可通过项目网关自动 Replay]`;
    }

    const content = `调用接口 ${log.method.toUpperCase()} ${normalized.normalizedPath}${warningText}。${
      depContent ? `参数映射机制: ${depContent}。` : ''
    }`;

    steps.push({
      id: stepId,
      title: `步骤 ${stepIndex}: ${log.method.toUpperCase()} ${normalized.normalizedPath}`,
      level: 1,
      parentId: null,
      conditional: false,
      condition: null,
      dependsOn: stepIndex > 1 ? [`step${stepIndex - 1}`] : [],
      fieldRefs: [],
      content,
    });

    apis.push({
      id: apiId,
      purpose: `${log.method.toUpperCase()} ${normalized.normalizedPath}`,
      method: log.method.toUpperCase(),
      path: normalized.normalizedPath,
      description: `Live Lens 自动捕获接口 (${log.url})`,
      evidence: { source: 'capture' },
    });


  }

  const lastLog = networkLogs[networkLogs.length - 1];
  const lastNormalized = lastLog
    ? normalizeUrlPath(lastLog.url, gatewayUrl, projectPrefix)
    : { normalizedPath: '' };

  const flowData: FlowData = {
    version: 1,
    meta: {
      name: flowName,
      description: intentText || `基于 CLI-Anything-X Live Lens 自动录制的 ${business} 流程`,
      type: 'flow',
      triggers: [`自动执行 ${business}`, business],
    },
    title,
    businessGoal: intentText || `自动化执行 ${business} 交互链路`,
    scenarios: [`原系统 ${business} 自动化流程`],
    prerequisites: ['保持本地 Profile 会话有效'],
    steps,
    fieldGroups: [],
    apis,
    speechTemplates: [],
    agentStrategy: { prefillRules: [], mustAsk: [], forbidden: [] },
    endApi: {
      apiRef: lastLog ? `${project}/${lastLog.method.toUpperCase()}${lastNormalized.normalizedPath}` : undefined,
      method: lastLog ? lastLog.method.toUpperCase() : 'POST',
      path: lastNormalized.normalizedPath,
      bodyTemplate: lastLog?.postData || '{}',
      evidenceSource: 'capture',
    },

    errorHandling: [],
    successCriteria: ['链路上所有接口响应成功且符合契约'],
    domainKnowledge: [
      `本流程通过 Live Lens 于 ${new Date().toISOString()} 捕获产出。`,
    ],
    reference: { fields: '', examples: '', verify: '' },
  };

  const flowJsonPath = join(targetDir, 'flow.json');
  writeFileSync(flowJsonPath, JSON.stringify(flowData, null, 2), 'utf-8');

  const { skillMd } = compileFlow(flowData);
  const skillMdPath = join(targetDir, 'SKILL.md');
  writeFileSync(skillMdPath, skillMd, 'utf-8');

  return { flowJsonPath, skillMdPath, flowData };
}
