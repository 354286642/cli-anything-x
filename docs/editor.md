# 统一编辑器

在线可视化编辑门户，集成 Skill 编辑器和 Flow 编辑器，统一入口管理所有技能和流程。

## 启动

```bash
anycli workbench         # 默认 http://127.0.0.1:3200
anycli workbench -p 8080 # 自定义端口
# 兼容旧命令
anycli edit
```

启动后自动打开浏览器。按 Ctrl+C 退出。

服务仅监听本机回环地址，不对局域网开放。

## 本地工作台

门户顶部可以查看并切换 Profile；环境配置可修改环境、网关、登录页和授权方式，凭证只显示是否已配置。点击「授权登录」会按当前 Profile 的登录地址和授权方式打开浏览器，回调凭证只保存到发起登录时的 Profile。也可以创建 Profile；项目弹窗列出当前 Profile 已有配置，并支持编辑请求前缀、独立网关和额外请求头。

「获取接口」通过本机路径扫描 Java Controller。选择项目后可选择已有模块或输入新模块名；预览会区分新增接口和已存在接口，已存在接口默认不勾选，勾选后会覆盖更新解析字段并保留人工维护字段。确认后更新 `apis/{project}/{module}.json`、构建 Skill、更新路由表和技能总览页。扫描与写入都发生在本地 Workspace。

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
| `/api/workbench` | GET | 当前 Workspace、Profile 和脱敏配置状态 |
| `/api/auth/login` | POST | 为当前 Profile 启动浏览器授权回调 |
| `/api/auth/login/status` | GET | 查询本次授权状态，不返回凭证 |
| `/api/profiles` | POST | 创建 Profile |
| `/api/profiles/use` | POST | 切换当前 Profile |
| `/api/profiles/:name` | PUT | 更新 Profile 环境与连接设置 |
| `/api/projects` | POST | 接入项目到当前 Profile |
| `/api/projects/:name` | PUT | 更新当前 Profile 的项目配置 |
| `/api/projects/:name/modules` | GET | 获取项目现有模块选项 |
| `/api/ingest/scan` | POST | 扫描 Java Controller 并预览接口 |
| `/api/ingest/commit` | POST | 将选中接口写入注册表并构建 Skill |
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
