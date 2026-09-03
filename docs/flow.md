# 工作流管理

流程 Skill 的完整生命周期：创建 → 编辑 → 编译 → 接地校验 → 版本管理。

## 概念

- **flow.json**：流程的结构化数据源（步骤、字段、接口、话术、策略）
- **SKILL.md**：编译产物，Agent 执行时读取
- **reference/**：流程独有资料（字段词典、示例、校验脚本），按需加载
- **flow.version.json**：版本历史（自动生成）

## 命令

### 列出所有工作流

```bash
anycli flow list
```

### 创建新工作流

```bash
anycli flow init demo create-order
# 交互式输入标题、描述、触发词
# 生成 skills/demo/flows/create-order/flow.json 骨架
```

### 可视化编辑

```bash
anycli flow edit skills/demo/flows/create-sample-requirement
# 启动 Web 编辑器 http://localhost:3210
# 自定义端口: anycli flow edit <path> -p 8080
```

编辑器支持：步骤拖拽排序、字段依赖图、接口关联、话术模板、Agent 策略配置。

#### 从已有 Skill/API 生成流程初稿

打开工作流后进入「流程步骤」页面，点击：

```text
从已有 Skill/API 生成步骤
```

弹框按目录层级展示已注册的接口：

```text
demo
├── order
│   ├── 订单列表
│   └── 订单详情
└── effect
    └── 效果汇总
```

接口整行可点击，多选后在右侧调整执行顺序。点击「生成流程步骤」后，最后一个接口作为提交动作，所有选中接口同时写入 Flow 的接口列表。

首次导入会根据 `apis/{project}/{module}.json` 自动填充流程初稿：

- Skill 描述和触发词 → 基本信息；
- query/body 参数 → 字段分组、字段类型、必填标记和步骤字段引用；
- `paramSources`、默认值和分页参数 → 参数来源、预填规则和必须追问项；
- `prerequisites` → 前置条件；
- `outputFields`、`tips`、`notes` → 步骤说明和领域知识；
- `avoidWhen` → Agent 禁止行为；
- `errorHandling`、`enrichment.errorScenarios` → 错误处理；
- `examples` → `reference/examples.md`；
- 参数和接口信息 → `reference/fields.md`、`reference/verify.md`。

其中跨接口的字段映射、业务目标、条件分支和成功状态无法仅由接口注册表确定，生成结果会保留「请人工确认」提示。完善接口注册表的 `paramSources`、`outputFields` 和 `enrichment` 后重新导入，可以获得更完整的流程初稿。

统一编辑器 `anycli edit` 和独立 Flow 编辑器均支持该功能。目录优先读取 `/api/skill-catalog`，统一编辑器入口会兼容回退到已有的 `/api/skills`。

## 完善流程：从结束接口反向推导

导入接口或完成 Live Lens 录制后，在“流程步骤”页点击“完善流程”。先人工确认**流程结束接口**（它可以是查询、校验或写入接口），本地 Codex 再从其必填字段、DTO/service 校验和抓包参数依赖反向追溯上游来源，生成流程步骤、字段策略、话术和异常处理提案。

- 页面实时展示分析阶段、已读取代码和安全摘要；不会展示模型内部思维。
- 证据不足时 Agent 会提出结构化问题，回答后在同一会话继续分析；关闭弹框不会取消会话。
- 已登记接口读取注册表和后端代码；未登记的 Live Lens 接口使用脱敏 `capture.json`；仅有名称/路径时不会伪造字段契约。
- 提案仅在点击“应用提案”后进入编辑器待保存状态。`meta.name`、接口清单和确认的结束接口受到保护。

CLI 入口：

```bash
anycli flow enrich skills/demo/flows/example --end-api api-id
anycli flow enhance skills/demo/flows/example --end-api api-id --apply
```

默认是预览模式，`--apply` 才写入 `flow.json` 和编译产物。

### 编译

```bash
# 编译单个
anycli flow build skills/demo/flows/create-sample-requirement

# 编译所有
anycli flow build --all

# 跳过接地校验
anycli flow build --all --skip-grounding
```

编译流程：
1. 读取 flow.json
2. **接地校验**（检查所有 apiRef 可解析）
3. 生成 SKILL.md + reference/ 文件
4. 记录版本（自动 bump）
5. 更新 anycli 路由表
6. 刷新技能总览页

### 导入现有 SKILL.md

```bash
anycli flow import skills/demo/flows/create-sample-requirement/SKILL.md
# 反解为 flow.json（一次性迁移用）
```

## 接地校验

编译时自动校验 flow.json 中所有 step 的 `apiRef` / `apiRefs`：

```
✓ 接地校验通过: 5 个 apiRef 全部可解析
```

校验规则（按优先级）：
1. 引用在 flow 内部 `apis[]` 中定义 → 通过
2. 引用在接口注册表 `apis/` 中可解析 → 通过
3. 以上都不满足 → 编译失败，列出具体问题

失败示例：
```
⚠ 接地校验失败 skills/demo/flows/xxx（1 个问题）:
  [step-3] 选择样品类型: apiRef "nonexistent-api" 未在 flow.apis[] 中定义，也未在接口注册表 (apis/) 中找到
⚠ 使用 --skip-grounding 跳过校验强制编译
```

这确保 FLOW-SPEC.md 第 7 节「接地要求」从人肉约定变成机器强制。

## 版本管理

每次 `anycli flow build` 成功后自动记录版本到 `flow.version.json`：

```json
{
  "currentVersion": 3,
  "revisions": [
    { "version": 2, "timestamp": "2026-08-01T10:00:00Z", "author": "hj", "message": "flow build: compile flow.json → SKILL.md" },
    { "version": 3, "timestamp": "2026-08-02T15:07:51Z", "author": "hj", "message": "flow build: compile flow.json → SKILL.md" }
  ]
}
```

### 查看版本

```bash
anycli flow version skills/demo/flows/create-sample-requirement
```

输出：
```json
{
  "path": "skills/demo/flows/create-sample-requirement",
  "currentVersion": 2,
  "totalRevisions": 1,
  "latestRevisions": [...]
}
```

### 查看编辑历史

```bash
anycli flow history skills/demo/flows/create-sample-requirement
anycli flow history <path> -n 20   # 显示最近 20 条
```

版本历史保留最近 50 条记录。

## flow.json 结构概览

```json
{
  "version": 1,
  "meta": { "name": "flow-demo-create-sample", "type": "flow", "triggers": [...] },
  "title": "创建样品需求",
  "businessGoal": "...",
  "scenarios": [...],
  "prerequisites": [...],
  "steps": [{ "id": "step-1", "title": "选择品牌", "apiRefs": ["api-1"], ... }],
  "fieldGroups": [...],
  "apis": [{ "id": "api-1", "purpose": "获取品牌列表", "method": "POST", "path": "..." }],
  "speechTemplates": [...],
  "agentStrategy": { "prefillRules": [...], "mustAsk": [...], "forbidden": [...] },
  "endApi": { "apiRef": "api-1", "method": "POST", "path": "...", "bodyTemplate": "..." },
  "errorHandling": [...],
  "successCriteria": [...],
  "reference": { "fields": "...", "examples": "...", "verify": "..." }
}
```

完整规范见仓库根目录 [FLOW-SPEC.md](../FLOW-SPEC.md)。
