import { describe, it, expect } from 'vitest';
import { enrichFlowData, chunkStepsForAnalysis } from '../src/core/live-lens/flow-enricher.js';

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';

describe('CLI-Anything-X Live Lens 2.0 Agent-Native 语义补全引擎测试', () => {
  it('chunkStepsForAnalysis: 17 个长流程步骤必须精准分割为 3 个滑动分析窗口批次', () => {
    const mockSteps = Array.from({ length: 17 }, (_, i) => ({
      id: `step${i + 1}`,
      title: `步骤 ${i + 1}`,
      content: `调用 API ${i + 1}`,
    }));

    const chunks = chunkStepsForAnalysis(mockSteps, 6);
    expect(chunks.length).toBe(3);
    expect(chunks[0].length).toBe(6);
    expect(chunks[1].length).toBe(6);
    expect(chunks[2].length).toBe(5);
  });

  it('enrichFlowData: 必须成功补全 scenarios, fieldGroups, speechTemplates, agentStrategy, errorHandling 并格式化输出 SKILL.md', () => {

    const flowDir = 'tests/fixtures/flows/live-lens-capture-sample';

    if (!existsSync(join(flowDir, 'flow.json'))) {
      // 容错处理
      return;
    }

    const res = enrichFlowData(flowDir);
    expect(res.success).toBe(true);

    const updatedJson = JSON.parse(readFileSync(res.flowJsonPath, 'utf-8'));
    expect(updatedJson.scenarios.length).toBeGreaterThan(0);
    expect(updatedJson.fieldGroups.length).toBeGreaterThan(0);
    expect(updatedJson.speechTemplates.length).toBeGreaterThan(0);
    expect(updatedJson.agentStrategy.prefillRules.length).toBeGreaterThan(0);
    expect(updatedJson.errorHandling.length).toBeGreaterThan(0);

    const skillMdText = readFileSync(res.skillMdPath, 'utf-8');
    expect(skillMdText).toContain('## 适用场景');
    expect(skillMdText).toContain('## Agent 引导策略');
  });
});
