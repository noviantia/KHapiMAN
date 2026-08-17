# KHapiMAN

KHapiMAN 是一个全屏终端工作台，用于管理 API Profiles，并将它们安全地应用到 AI 编程客户端。它会尽可能避免把凭据写入普通客户端配置，在写入前展示变更预览，并为每次应用记录可回滚事务。

npm 包名和可执行命令均为 `khapiman`。

## 运行要求

- Windows、macOS 或 Linux
- Node.js 22 或更高版本
- npm

KHapiMAN 当前管理 Codex CLI、Claude Code、OpenCode 和 Aider；不管理 Cursor、Windsurf、Cline 和 Gemini。

## 安装

```shell
npm install --global khapiman
khapiman --version
khapiman
```

只要还有客户端使用 KHapiMAN 绑定，就应保留全局安装。Codex 可能调用 `khapiman` credential helper，其他受管客户端则通过 `khapiman run` 获取仅限当前进程的凭据。

## 全屏 TUI

在交互式终端中运行 `khapiman` 即可打开工作台。六个主视图覆盖日常管理流程：

| 视图         | 用途                                                           |
| ------------ | -------------------------------------------------------------- |
| Overview     | 汇总客户端健康状态、当前绑定、最近变更和下一步操作。           |
| API Profiles | 创建、检查、测试和删除可复用的中转 Profile；密钥始终遮罩显示。 |
| Clients      | 检测受支持客户端、预览安装命令，并为客户端分配兼容 Profile。   |
| Changes      | 查看配置预览和事务历史，并执行可用的回滚操作。                 |
| Doctor       | 检查 Node.js、凭据存储、客户端检测、Profile 和配置健康状态。   |
| Settings     | 查看固定端点和凭据后端，并切换界面语言。                       |

使用方向键移动导航焦点。`Enter` 打开或确认当前操作，`Esc` 返回上一层。任何客户端写入都会先展示经过脱敏的预览并要求确认。

字符显示受限的终端可强制使用紧凑标题：

```shell
khapiman --ascii
```

日志环境或不需要 ANSI 颜色的终端可使用 `khapiman --no-color`。

## CLI 快速上手

TUI 是默认体验；所有主要操作也提供命令行形式，便于脚本和远程终端使用。

先检查运行环境和已安装客户端：

```shell
khapiman doctor
khapiman status
khapiman install --dry-run
```

`install --dry-run` 只打印固定的第三方安装命令，不会执行。运行 `khapiman install` 可在审阅后确认安装，也可以明确选择客户端：

```shell
khapiman install --tool codex claude opencode aider --dry-run
khapiman install --tool codex opencode --yes
```

创建 Profile 时不要把 API Key 放进 shell 历史。Bash 和 zsh：

```shell
printf '%s' "$KHAPIMAN_SECRET" | khapiman profile add \
  --name "Primary Relay" \
  --model "relay-model-id"
unset KHAPIMAN_SECRET
```

PowerShell 7 或更高版本：

```powershell
$secret = Read-Host "Relay API key" -MaskInput
$secret | khapiman profile add `
  --name "Primary Relay" `
  --model "relay-model-id"
Remove-Variable secret
```

随后列出 Profile、预览分配并确认写入：

```shell
khapiman profile list
khapiman apply primary-relay --tool codex
khapiman apply primary-relay --tool claude opencode aider
```

`apply` 会先打印配置 diff。只有同一变更已经通过外部审阅时，才应加入 `--yes`。

受管客户端的启动方式如下：

```shell
# Codex 使用已配置的 credential helper。
codex

# 以下客户端仅在子进程中获得所选凭据。
khapiman run --trust-workspace claude
khapiman run --trust-workspace opencode
khapiman run --trust-workspace aider
```

使用 `--trust-workspace` 前必须审阅当前工作区。项目钩子、插件、可执行配置和子进程均属于信任边界。

## 命令参考

```text
khapiman                              打开全屏 TUI
khapiman status [--json]              查看客户端检测结果和当前绑定
khapiman install [options]            预览或安装受支持客户端
khapiman profile list [--json]        列出 API Profiles
khapiman profile add [options]        从 stdin 读取密钥并创建 Profile
khapiman profile remove <profile>     删除未被使用的 Profile
khapiman apply <profile> --tool ...   预览并应用客户端配置
khapiman doctor [--json]              检查运行环境和配置
khapiman test <profile> [--json]      不携带密钥测试可达性
khapiman rollback [transaction]       恢复已记录的事务
khapiman run <tool> [args...]         安全启动 Claude、OpenCode 或 Aider
khapiman export                       导出不含密钥值的 Profile 元数据
```

运行 `khapiman <command> --help` 可查看完整参数。

## 支持的客户端

| 客户端      | 协议                    | 持久配置                        | 凭据交付方式                          |
| ----------- | ----------------------- | ------------------------------- | ------------------------------------- |
| Codex CLI   | OpenAI Responses        | `config.toml` 中的受管 provider | `khapiman` credential helper          |
| Claude Code | Anthropic Messages      | 无敏感信息的管理标记            | 通过 `khapiman run` 提供进程级 helper |
| OpenCode    | OpenAI Chat Completions | OpenAI-compatible provider      | 通过 `khapiman run` 提供子进程环境    |
| Aider       | OpenAI Chat Completions | 无敏感信息的管理标记            | 通过 `khapiman run` 提供子进程环境    |

配置路径、安装器行为和客户端限制详见[兼容性说明](docs/compatibility.md)。

## 安全模型

- Profile 创建使用内置的 HTTPS 中转地址和经过认证的模型目录；基础 URL 不允许用户修改。
- KHapiMAN 优先使用操作系统 credential vault。原生 keyring 不可用时，会明确警告并回退到权限受限的明文文件。
- 密钥只能通过 TUI 遮罩输入框或 stdin 输入，不能作为普通 CLI 参数。
- 客户端写入使用全局锁、脱敏 diff、写入前哈希、原子替换和事务清单，并拒绝符号链接目标。
- 回滚前会校验当前文件和备份哈希。备份包含原始旧文件，可能保留文件中原本已有的敏感信息。
- `khapiman test` 只执行未认证的可达性检查，不会附带 Profile 密钥。
- KHapiMAN 不发送遥测。

使用生产凭据前请阅读完整的[安全模型](docs/security-model.md)。安全漏洞应按[安全策略](SECURITY.md)私下报告。

## 数据与回滚

KHapiMAN 默认把状态、事务备份和凭据 fallback 存放在 `~/.khapiman/`。可通过 `KHAPIMAN_HOME` 隔离开发或自动化环境：

```shell
KHAPIMAN_HOME=/tmp/khapiman-test khapiman doctor
```

```powershell
$env:KHAPIMAN_HOME = Join-Path $env:TEMP "khapiman-test"
khapiman doctor
```

请保留每次应用后打印的 rollback ID。恢复指定事务：

```shell
khapiman rollback <transaction-id>
```

## 卸载

卸载前先运行 `khapiman status`，按应用顺序的逆序回滚仍在使用的绑定，并确认客户端不再依赖 credential helper 或 `khapiman run`：

```shell
npm uninstall --global khapiman
```

卸载 npm 包不会删除 `~/.khapiman/`。在确认不再需要其中的凭据和原始备份前应保留该目录，之后再按工作站的数据保留策略处理。

## 开发

```shell
git clone https://github.com/noviantia/KHapiMAN.git
cd KHapiMAN
npm ci
npm run check
npm run format:check
```

更多信息见[贡献指南](CONTRIBUTING.md)和仅供维护者使用的[发布指南](docs/publishing.md)。

## 许可

[MIT](LICENSE)
