# CLI-Anything-X 工作流可视化编辑器

`flow.json` 的 Web 可视化编辑器：以表单方式编辑工作流结构，实时预览编译出的 SKILL.md，保存后写回 `skills/{project}/flows/{business}/flow.json`。

## 启动

```bash
# 方式一：CLI（如已实现 flow 命令）
anycli flow edit

# 方式二：直接运行
node tools/flow-editor/server.mjs [--port 3210]
```

浏览器打开 http://localhost:3210

## 功能概览

- **工作流管理**：下拉切换 / 新建工作流（自动创建目录与 flow.json 骨架）/ 保存（Ctrl+S）
- **流程步骤内接口编排**：在「流程步骤」页面点击按钮，从 `apis/{project}/{module}.json` 注册表按项目/Skill/API 多选接口、调整执行顺序，一次生成流程步骤、接口列表和建议的流程结束接口
- **首次导入自动补全**：同步带入 Skill 描述/触发词、请求字段、必填参数、参数来源、前置条件、输出字段、接口提示、错误处理、示例和验证脚本；不确定的业务映射保留待确认提示
- **四大编辑分组**
- 基本：基本信息（name / title / triggers / sourceRefs / businessGoal / scenarios / endApi）、前置条件、成功标准
  - 流程：流程步骤（卡片式设计器，支持子步骤、条件步骤、拖拽排序、依赖/字段/接口关联）、字段定义（分组表格 + 自动依赖图）、接口列表
  - 话术：话术模板、Agent 引导策略（预填规则 / 必须追问 / 严禁行为）
  - 附录：错误处理、领域知识、参考文件（fields / examples / verify 三个 Markdown 分栏编辑）
- **实时预览**：右侧面板将 flow.json 编译为 SKILL.md，提供「渲染 / 源码」两个视图与一键复制
- **撤销 / 重做**：Ctrl+Z / Ctrl+Y，最多 50 步快照
- **拖拽排序**：步骤卡片、列表项、表格行均可拖拽（SortableJS）

### 首次导入会生成什么

从「流程步骤」页选择接口后，编辑器会从注册表自动生成一份可继续编辑的流程初稿：

| 注册表信息 | Flow 初稿位置 |
|------------|---------------|
| Skill `description` / `triggers` | `meta.description` / `meta.triggers` |
| `queryParams` / `bodyParams` | `fieldGroups`、步骤 `fieldRefs` |
| `paramSources` / 参数默认值 | `agentStrategy.prefillRules`、字段说明 |
| 必填参数 | `agentStrategy.mustAsk`（上游来源参数除外） |
| `prerequisites` | `prerequisites` |
| `outputFields` / `tips` / `notes` | 步骤说明、`domainKnowledge` |
| `avoidWhen` | `agentStrategy.forbidden` |
| 模块/API 错误信息、`enrichment` | `errorHandling`、领域知识 |
| `examples` | `reference/examples.md` |
| 参数和请求模板 | `reference/fields.md`、`reference/verify.md` |

接口之间的业务字段映射、条件分支、业务成功状态和自然语言话术可点击“完善流程”由本地 Codex 反推提案；CLI 也可使用 `anycli flow enhance <path> --end-api <api-id>` 预览，增加 `--apply` 后写入。

## REST API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/workflows` | 扫描 `skills/*/flows/*/flow.json`，返回列表 |
| GET | `/api/skill-catalog` | 扫描 `apis/{project}/{module}.json`，返回可用于流程编排的项目/Skill/API 目录 |
| GET | `/api/workflows/:id` | 读取指定 flow.json（id 如 `demo/flows/create-sample-requirement`） |
| PUT | `/api/workflows/:id` | 写入 flow.json |
| POST | `/api/workflows` | 新建工作流（body: `{project, business}`） |
| POST | `/api/workflows/:id/build` | 触发编译（当前仅校验源文件，实际编译由 `anycli flow build` 执行） |

## 注意事项

- **`flow.json` 是源文件，`SKILL.md` 是编译产物**：编辑器只写 flow.json；SKILL.md 由编译器生成，请勿手工修改编译产物。
- 编辑器内的预览是前端简化版编译器输出，最终 SKILL.md 以 CLI 编译结果为准。
- `reference/` 目录下的 fields.md / examples.md / verify.md 内容保存在 flow.json 的 `reference` 字段中，编译时落盘。
- 静态资源（vendor/sortable.min.js、vendor/marked.min.js）均为本地文件，无 CDN 依赖，可离线使用。
- 服务仅监听本地，无鉴权，请勿暴露到公网。
