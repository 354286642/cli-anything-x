# CLI-Anything-X Live Lens

> ⚠️ **测试中功能**：Live Lens 目前可能还不完善，录制结果需要人工检查和调整。建议先在测试环境、低风险流程中试用，不要直接用于生产环境或无人审核的写操作。

## 概述

Live Lens 是 CLI-Anything-X 的浏览器流程录制工具。它通过 Chrome 扩展同时收集：

- 浏览器页面中的点击事件和操作截图；
- 页面触发的 Ajax / Fetch 网络请求及部分响应信息；
- 可选的当前标签页录屏视频；
- 录制结束时人工补充的业务意图和条件规则。

CLI 在本地接收录制数据后，会清洗网络日志、推导步骤间的参数依赖，并在当前仓库的 `skills/<project>/flows/<business>/` 下生成 `flow.json` 和 `SKILL.md`。

## 前置条件

- Node.js >= 18，并已完成 CLI-Anything-X 的安装或本地构建；
- Google Chrome；
- 当前仓库中存在目标项目配置，或至少能提供项目标识；
- 目标网页可正常访问。涉及登录态时，请先在 Chrome 中完成登录；
- 浏览器扩展目录：`tools/lens-extension`。

## 快速开始

### 1. 启动 Live Lens Daemon

在 CLI-Anything-X 仓库根目录执行：

```bash
anycli flow record <project> <business>
```

例如：

```bash
anycli flow record demo order-onboard
```

默认在 `127.0.0.1:19877` 启动本地接收服务。也可以指定端口：

```bash
anycli flow record demo order-onboard --port 19878
```

使用 `--dev` 时，CLI 会尝试自动启动一个 Chrome 调试沙盒：

```bash
anycli flow record demo order-onboard --dev
```

如果自动启动失败，请手动打开 Chrome，并在 `chrome://extensions/` 中开启“开发者模式”，选择“加载已解压的扩展程序”，目录选择：

```text
<仓库根目录>/tools/lens-extension
```

### 2. 开始录制并操作页面

1. 打开目标业务页面，并确认当前页面是要录制的标签页。
2. 点击 Chrome 工具栏中的 **CLI-Anything-X Live Lens** 扩展。
3. 点击“开始录制”。如 CLI 端配置了配对 Token，再在扩展中填写相同 Token；通常可以留空。
4. 在页面中按真实业务顺序操作，例如搜索、选择、填写和提交。应尽量触发实际的 Ajax / Fetch 请求。
5. 再次打开扩展，填写业务意图、条件规则或需要人工说明的字段。
6. 点击“结束录制并提交”。

### 3. 检查生成结果

录制提交成功后，CLI 会输出产物路径：

```text
skills/<project>/flows/<business>/flow.json
skills/<project>/flows/<business>/SKILL.md
```

如果页面录制到了截图、视频或会话元数据，还可能生成：

```text
skills/<project>/flows/<business>/assets/step-*.png
skills/<project>/flows/<business>/assets/video.webm
skills/<project>/flows/<business>/session.json
```

录制生成的是流程初稿。请重点检查接口路径、请求方法、请求体、参数依赖、步骤顺序和业务条件，不要因为生成成功就直接认为流程可执行。

### 4. 补全流程语义

对生成的流程执行 Agent-Native 语义补全：

```bash
anycli flow enrich skills/<project>/flows/<business>
```

该命令会结合项目接口注册表补充场景、字段分组、话术模板、Agent 策略和错误处理等内容，并重新生成 `SKILL.md`。补全后仍需人工复核。

## 命令参数

| 命令 | 说明 |
|------|------|
| `anycli flow record <project> <business>` | 启动本地 Daemon，等待 Chrome 扩展上传录制数据 |
| `anycli flow record <project> <business> --port <port>` | 使用指定本地端口 |
| `anycli flow record <project> <business> --dev` | 尝试自动启动带扩展调试沙盒的 Chrome |
| `anycli flow enrich <flow-path>` | 对已有 `flow.json` 做语义补全并生成 `SKILL.md` |

## 工作原理

```text
Chrome 页面操作
    ├─ 点击事件 / 截图
    ├─ Ajax / Fetch 网络请求
    └─ 可选 Tab 视频
            ↓
Chrome 扩展 POST 127.0.0.1:19877/api/upload
            ↓
Live Lens Daemon
    ├─ 本地脱敏清洗
    ├─ URL 归一化
    ├─ 参数值流依赖推导
    └─ flow.json / SKILL.md 生成
```

Daemon 仅监听本机回环地址 `127.0.0.1`。扩展上传接口为 `POST /api/upload`；录制数据默认在本地处理，生成的流程文件写入当前工作目录下的 `skills/`。

## 常见问题

### 录制完成但提示未捕获接口

请确认：

- 点击“开始录制”后才进行页面操作；
- 操作确实触发了 Ajax / Fetch 请求，而不是只改变了前端本地状态；
- Chrome 扩展已在 `chrome://extensions/` 中重新加载；
- CLI Daemon 仍在运行，且端口与扩展上传地址一致；
- 页面没有被浏览器权限、跨域策略或扩展限制阻止。

### 扩展提交失败或无法连接 CLI

确认 `anycli flow record` 未退出，并检查端口是否被占用。默认端口为 `19877`；如启动时使用了 `--port`，当前版本的扩展仍使用默认上传端口时可能无法连接，需要先使用默认端口测试。

### 生成的流程不准确

这是测试中功能的已知风险。请人工核对并修改 `flow.json`，必要时重新录制更短、更清晰的业务链路；对已有流程可再运行 `anycli flow enrich`，但不能替代接口和业务规则复核。

### 录制视频或截图缺失

视频捕获和截图依赖 Chrome 的 `tabCapture`、`offscreen`、调试器权限以及当前页面状态。媒体缺失不一定影响网络流程生成，但会减少后续人工复核所需的上下文。

## 安全与使用边界

- 录制可能包含页面业务数据、请求头、请求体、响应体、截图和视频，请勿把生成的资产上传到不受信任的位置；
- 录制前确认当前标签页和账号环境，避免采集无关用户数据；
- 不要在生产环境执行真实提交、删除或其他高风险操作；
- 生成的 `flow.json` 和 `SKILL.md` 属于初稿，必须经过人工审核、测试和必要的脱敏后才能提交。

