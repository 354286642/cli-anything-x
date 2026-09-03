# cli-anything-x Agent 工作守则（AGENTS.md）

> 任何 AI Agent（Codex、Claude Code、Cursor 等）在本仓库工作必须先读本文件。

## 项目简介

cli-anything-x（命令名 anycli）：系统 CLI 化、流程 Skill 化、员工 Agent 化。TypeScript + Commander.js，Node >= 18。
- `src/core/` 核心（auth/client/config/java-parser/skill-builder/flow-compiler/grounding 等）
- `src/commands/` CLI 命令（auth/config/request/skill/flow/gen/init/edit）
- `apis/{project}/{module}.json` 接口注册表（单一事实来源，人工字段 merge 时不可覆盖）
- `skills/` 由注册表生成的 AI Skill 与流程 Skill
- 目录约定见 `DIRECTORY.md`，流程规范见 `FLOW-SPEC.md`

## 常用命令

```bash
npm install                       # 安装依赖
npm run build                     # tsc 编译
npm test                          # vitest（基线：172 项）
npx tsx src/index.ts --help       # 开发模式运行（免编译）
```

## 行为变更的验证门禁

- `npm test` 全绿（基线 172 项）
- `npm run build` 零错误
- `npx tsx src/index.ts skill build` 幂等重建后存量产物零 diff
  （唯一允许的 diff：docs/skills.html 的 generatedAt 时间戳）
- 有意的行为变更必须在提交说明中逐条登记，不允许出现未登记的 diff

## 其他约定

- 分支前缀 `feature/`。
- 本仓库为开源公开仓：**禁止**提交任何个人 / 公司标识（账号、域名、内网地址、真实项目代号等）；
  业务示例一律使用合成数据（demo 项目或 `cli-anything-x` 示例项目）。
- 涉及真实业务的数据（接口注册表、流程 Skill）请放入配套私有数据仓，通过 Workspace 机制接入，
  不要提交到本公开仓。