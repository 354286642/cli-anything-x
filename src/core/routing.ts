import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { resolveWorkspace } from './config.js';

const WORKSPACE = resolveWorkspace();

/**
 * 向 skills/anycli/SKILL.md 路由表追加/更新条目。
 * 供 gen.ts（原子 Skill）和 flow.ts（流程 Skill）共用。
 */
export function updateAnycliRouting(intentDescription: string, skillName: string): boolean {
  const anycliSkillFile = join(WORKSPACE, 'skills', 'anycli', 'SKILL.md');
  if (!existsSync(anycliSkillFile)) return false;

  let content = readFileSync(anycliSkillFile, 'utf-8');

  if (content.includes(skillName)) return false;

  const routingPattern = /(\| \u7528\u6237\u610f\u56fe \| \u52a0\u8f7d Skill \|\n\|[-|]+\|\n(?:\|[^\n]+\|\n)*)/;
  const match = content.match(routingPattern);
  if (match) {
    const newRow = `| ${intentDescription} | ${skillName} |\n`;
    content = content.replace(routingPattern, match[1] + newRow);
    writeFileSync(anycliSkillFile, content, 'utf-8');
    return true;
  }

  return false;
}
