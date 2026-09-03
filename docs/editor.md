# 统一编辑器

在线可视化编辑门户，集成 Skill 编辑器和 Flow 编辑器，统一入口管理所有技能和流程。

## 启动

```bash
anycli edit              # 默认 http://localhost:3200
anycli edit -p 8080      # 自定义端口
```

启动后自动打开浏览器。按 Ctrl+C 退出。

## 门户首页

- 技能卡片按项目分组，显示版本、接口数、操作分级统计
- 全局搜索（`/` 快捷键聚焦），跨名称/触发词/命令过滤
- 点击原子 Skill → Skill 编辑器
- 点击流程 Skill → Flow 编辑器
- 深/浅主题切换（记忆偏好）

## Skill 编辑器

路径：`/skill/{project}/{module}`

左右分栏布局：左侧编辑，右侧 SKILL.md 实时预览。

### 编辑 Tab

| Tab | 内容 |
|-----|------|
| 基本信息 | 模块 ID、版本、描述、触发词、枚举引用 |
| 接口列表 | 增删改接口（method/path/level/params/bodyTemplate/notes） |
| 枚举 | 查看共享枚举（来自 `_shared/`） |
| 自定义区 | 编辑 customSections（原样输出到 SKILL.md） |
| JSON | 直接编辑注册表 JSON 源码 |

### 操作

- **保存** — 写入 `apis/{project}/{module}.json`
- **Build** — 生成 `skills/{project}/{module}/SKILL.md`
- **预览** — 右侧渲染生成的 Markdown（不写入文件）
- **可执行技能包下载** — 下载需要手动填写 `sessionId` 的自包含技能包
- **飞书执行技能包下载** — 下载通过 MCP「kol-mcp服务 / 获取KOL用户sessionId」动态获取 `sessionId` 的自包含技能包，不生成本地配置文件

## Flow 编辑器

路径：`/flow/{project}/flows/{flowName}`

### 编辑 Tab

| Tab | 内容 |
|-----|------|
| 步骤 | 拖拽排序、编辑标题/说明/apiRefs/dependsOn |
| 接口 | 查看 flow 内定义的接口列表 |
| 字段 | 查看字段分组和依赖关系 |
| 元信息 | 标题、业务目标、触发词、前置条件 |

### 操作

- **保存** — 写入 `flow.json`
- **Build + 校验** — 编译 SKILL.md + 接地校验（检查 apiRef 引用）
- **从已有 Skill/API 生成步骤** — 在「步骤」页打开目录弹框，按项目 → 模块 → 接口多选并排序；自动生成步骤、接口列表、字段定义、前置条件、策略、错误处理和 reference 初稿

首次导入信息来源于 `apis/{project}/{module}.json`。可自动带入接口参数、默认值、参数来源、输出字段、前置条件、提示、示例、错误处理和 Skill 触发词；无法确定的业务映射保留人工确认提示。

## 技术栈

- 服务端：纯 Node.js http 模块（零依赖）
- 前端：Tailwind CSS + Alpine.js（CDN）
- Markdown 渲染：marked.js
- 拖拽排序：SortableJS
- 代码编辑：原生 textarea + JSON 校验

## API 端点

| 端点 | 方法 | 用途 |
|------|------|------|
| `/api/portal` | GET | 门户数据（skills + flows + projects） |
| `/api/skills` | GET | 列出所有模块注册表 |
| `/api/skill-catalog` | GET | Flow 编辑器按项目/模块/API 展示的接口目录（独立 Flow 编辑器服务提供） |
| `/api/skills/:p/:m` | GET | 获取模块注册表 + 共享枚举 |
| `/api/skills/:p/:m` | PUT | 保存模块注册表 |
| `/api/skills/:p/:m/build` | POST | 生成 SKILL.md |
| `/api/skills/:p/:m/preview` | POST | 预览 SKILL.md（不写入） |
| `/api/skills/:p/:m/export` | GET | 下载普通可执行技能包 |
| `/api/skills/:p/:m/feishu-export` | GET | 下载通过 MCP 获取 sessionId 的飞书执行技能包 |
| `/api/flows` | GET | 列出所有流程 |
| `/api/flows/:id` | GET/PUT | 读写 flow.json |
| `/api/flows/:id/build` | POST | 编译 + 接地校验 |
| `/api/enums/:project` | GET | 列出共享枚举 |
