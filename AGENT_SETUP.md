# CLI-Anything-X 安装与配置指引（AI Agent 专用）

> 本文档供 AI Agent（Codex、Claude Code、Cursor、Trae 等）阅读并自动执行。
> 用户只需将下方提示词复制给 Agent 即可完成安装。

## 用户提示词

```
帮我安装和配置 CLI-Anything-X，按照当前仓库根目录下 AGENT_SETUP.md 的指引操作。
```

---

## Agent 执行步骤

请严格按以下步骤顺序执行，每步完成后验证结果再继续。

### 第 1 步：安装前检查

**原则**：先执行检查；若 **Node / npm / 网络** 任一不满足下文要求，Agent 应 **在本机终端内主动完成安装或配置**（例如升级 Node、修复 npm 等），再继续 anycli 安装。仅在无权限或环境无法自动化时，再向用户说明原因并请其配合。

1. **Node.js**
   - 要求 **>= 18**（与 package.json engines 一致），执行 `node -v` 确认。
   - 未安装或版本不足：由 Agent 自行安装或升级 Node（https://nodejs.org/ 或 nvm）。

2. **npm**（**唯一**允许的包管理器）
   - 执行 `npm -v` 确认可用。
   - 即使本机已安装 `pnpm`、`yarn` 等，**也仅用于其它项目**；安装 anycli 必须用 `npm`。
   - 未安装或不可用：由 Agent **安装或修复 npm** 后再继续。

3. **网络**
   - 需能访问公共 npm 仓库，执行 `npm view cli-anything-x version` 确认。

### 第 2 步：安装 CLI-Anything-X

```bash
npm install -g cli-anything-x
```

验证：

```bash
npm view cli-anything-x version
anycli --version
```

`anycli --version` 应与上一条查询到的版本一致。

> 如果 `anycli` 命令不可用，先执行 `npm config get prefix` 检查全局安装目录。在 Windows PowerShell 中还可执行 `Get-Command anycli -All`；默认命令目录通常为 `%APPDATA%\npm`，需确保已加入 PATH。
> 开发者从源码安装：`git clone <公开仓库地址> && cd <仓库目录> && npm install && npm run build && npm link`

### 第 3 步：初始化配置

```bash
anycli config init
```

交互式选择：
- **环境**：正式环境 (prod)（推荐）或 测试环境 (test)
- **输出格式**：json（推荐）
- **网关地址**：业务网关统一入口（整个工程一份）
- **登录页地址**：session-id 授权登录页（整个工程一份）

如果用户无法交互，可以直接设置：

```bash
anycli config set env prod
anycli config set defaultFormat json
anycli config set gateway-url https://gateway.example.com
anycli config set login-url https://login.example.com
```

验证：

```bash
anycli config list
```

确认 `env`、`gatewayUrl` 等字段有值。如需调用业务接口或开启 SessionId 自动刷新，当前 Profile 还必须有项目配置，可执行 `anycli config add-project` 配置项目网关前缀、租户标识等。

### 第 4 步：登录认证

**方式一：浏览器自动授权（推荐）**

```bash
anycli auth login
```

命令会启动本地登录服务（端口 `19876`），打开浏览器并跳转到登录授权页。授权完成后，浏览器回调会将 SessionId 保存到**当前 Profile**。若浏览器未自动完成授权，在该命令仍运行时打开终端提示的地址（通常为 `http://localhost:19876/manual`），粘贴 SessionId 后完成登录。

> 端口固定为 `19876`。端口被占用时，关闭占用程序后重试；不要自行假定其他端口。

**方式二：Bearer Token（OpenAPI 风格接口）**

```bash
anycli auth token <project>            # 交互输入 token 并写入项目配置
anycli auth token <project> --token xxxx   # 或直接传入
```

**方式三：直接设置 SessionId（脚本、CI 或无法使用浏览器时）**

```bash
anycli auth login --session-id <sessionId>
# 或
anycli auth set-session <sessionId>
```

也可执行 `anycli auth login --manual`：命令会打开业务系统登录页，并在终端要求粘贴 SessionId。

验证：

```bash
anycli auth status
```

预期输出 `loggedIn: true`，并显示当前 Profile 和环境。

#### SessionId 定时自动刷新

使用默认 `anycli auth login` 登录成功后（包括通过本地 manual 页面回退成功的情况），CLI 会询问：`是否需要开启 SessionId 定时自动刷新（每8小时一次）？`。选择确认后，Windows 会创建计划任务，macOS/Linux 会写入 crontab。仅对配置了 `auth.refreshUrl` 的项目生效（按项目配置，非全局）。

使用 `--session-id` 或 `--manual` 登录时不会出现该询问；需要保活时可手动管理：

```bash
anycli auth scheduler install    # 每 8 小时刷新一次
anycli auth scheduler uninstall  # 移除定时任务
anycli auth refresh --silent     # 手动执行一次静默刷新
```

#### 多 Profile 使用

环境、SessionId 和业务项目配置均按 Profile 隔离。需要操作非当前 Profile 时，在命令前添加全局参数：

```bash
anycli --profile test-main auth login
anycli --profile test-main auth status
anycli config profile list
```

### 第 5 步：安装 Skill

```bash
anycli skill install
```

这会将 Skill 文档安装到 `~/.agents/skills/`，让 AI Agent 能自动识别 Anycli 的命令能力。

验证：

```bash
anycli skill list
```

预期看到已安装的 Skill 列表。

### 第 6 步：验证功能

用一个简单查询验证整体链路（业务接口统一通过通用 `anycli request` 调用，项目名以实际配置为准，以下为示例）：

```bash
anycli request demo POST /api/order/listPage --body '{"pageNum":1,"pageSize":3,"data":{"keyword":""}}'
```

---

## 安装完成后

安装完成后，AI Agent 可以直接使用 anycli 命令操作业务系统。
Agent 应读取 `~/.agents/skills/` 下对应的 SKILL.md 了解可用命令和参数。

### 常用命令

业务接口统一通过通用命令 `anycli request <project> <METHOD> <path>` 调用，参数结构以 `~/.agents/skills/` 下各模块 SKILL.md 为准：

```bash
# 列表查询（示例）
anycli request demo POST /api/order/listPage --body '{"pageNum":1,"pageSize":20,"data":{"keyword":""}}'
# 详情（参数走 query）
anycli request demo GET /api/order/get --query '{"id":"O001"}'
anycli config list                                              # 查看配置
anycli auth status                                              # 登录状态
anycli auth scheduler install                                  # 开启每 8 小时自动刷新
```

---

## 常见问题

| 问题 | 解决方案 |
|------|----------|
| npm 不可达 | 检查网络，或配置可用的 npm registry 后重试 |
| `anycli: command not found` | 重新执行 `npm install -g cli-anything-x`，或检查 PATH |
| `anycli --version` 与 npm 最新版本不一致 | 执行 `npm view cli-anything-x version` 核对，再重新安装指定版本 |
| `AUTH_EXPIRED` | `anycli auth login` 重新登录 |
| `CONFIG_MISSING` | 确认当前 Profile 有网关地址与业务项目配置；未获配置参数时联系管理员，获授权后执行 `anycli config add-project` |
| 定时刷新安装或刷新失败 | 确认当前 Profile 已登录且有配置了 `auth.refreshUrl` 的项目；原 SessionId 已失效时重新登录 |
| `FORBIDDEN` | 检查账号权限 |
| Skill 未生效 | `anycli skill install --force` 重新安装 |
