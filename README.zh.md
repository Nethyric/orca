<p align="center">
  <img src="assets/logo.png" alt="ORCA" width="120">
</p>

<h1 align="center">ORCA</h1>

<p align="center">
  开源的桌面自主 AI 智能体。可接入任意模型——或不接入任何模型。
</p>

<p align="center">
  <a href="https://github.com/Nethyric/orca/releases/latest"><img alt="Release" src="https://img.shields.io/github/v/release/Nethyric/orca?style=flat-square&color=5e6ad2"></a>
  <a href="https://github.com/Nethyric/orca/actions/workflows/release.yml"><img alt="Build" src="https://img.shields.io/github/actions/workflow/status/Nethyric/orca/release.yml?style=flat-square"></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-MIT-blue?style=flat-square"></a>
  <a href="https://github.com/Nethyric/orca/releases/latest"><img alt="Downloads" src="https://img.shields.io/github/downloads/Nethyric/orca/total?style=flat-square"></a>
</p>

<p align="center">
  <a href="#安装">安装</a> ·
  <a href="docs/README.md">文档</a> ·
  <a href="docs/providers.md">提供商</a> ·
  <a href="docs/api.md">API</a> ·
  <a href="CHANGELOG.md">更新日志</a>
</p>

<p align="center">
  <a href="README.md">English</a> · <a href="README.ru.md">Русский</a> · <b>中文</b> · <a href="docs/README.fa.md">فارسی</a> ·
  <a href="https://nethyric.github.io/orca/">文档网站</a>
</p>

---

ORCA 是一款桌面智能体：它在你的机器上、你的文件里做规划、写代码、运行代码、读取报错并修复问题。内置模型开箱即用；也可以接入 200+ 提供商或任意 OpenAI 兼容端点，使用你自己的密钥。

- **默认自主。** 46 个真实工具：shell、Node/Python、文件编辑、网页搜索、HTTP、无头浏览器检查、Office 文档、媒体、OCR、图像与视频生成、后台进程、子智能体。建站类请求会先按合理的默认值直接构建——只有当工作真正被卡住时（例如缺少机器人令牌）才会提问，且只在代码已经存在之后。
- **任意模型。** 内置模型支持自动故障转移，也可添加自己的提供商（云端或本地）。密钥永不离开你的设备。
- **整站生成。** 由模型撰写内容——文案、条目、价格、FAQ、用户评价——`scaffold_site` 一步将其渲染为完整的现代多页站点（设计令牌、深浅色主题、hero、卡片、统计、带筛选与购物车的目录、带校验的表单、需要时的 RTL 布局），随后每个页面都会在无头浏览器中验证。没有占位符，没有半成品页面。
- **运行自己构建的东西。** 机器人、开发服务器和工作进程以后台进程启动，跨回合存活，带有实时日志、探测到的端口和进程面板中的停止按钮。图像与视频生成可接入任意 Images API / Videos API 提供商（OpenAI、Routeway、Together、xAI、Sora、Replicate、fal.ai），设置中提供测试按钮。
- **知道自己能做什么。** 问「你能做什么？」，答案来自对当前安装的实时能力检查——已连接的模型、存在的二进制、启用的引擎——而不是固定话术。
- **决策引擎（可选）。** 接入一个 System One 模型，ORCA 即可在约 0.2 秒内获得校准判断：更智能的自动路由、语义级命令风险审查、对每条回答的校验（乱码、承诺未兑现、语言错误）、搜索结果重排。
- **三种对话方式。** 直接对话、并排对比、或带有本地排行榜的盲测对战。
- **检查点与差异对比。** 每次文件变更都会快照；任意一步可一键恢复。
- **为长时间工作而生。** 输出截断会被透明地续写，长粘贴自动转为文件，被停止的回答可以继续，置顶、备注与分支让长对话保持条理。
- **四种语言。** English、Русский、中文、فارسی——并配有相应的排版。
- **隐私。** 无账户、无遥测。一切存储在你掌控的本地数据目录中。

## 安装

从 [Releases](https://github.com/Nethyric/orca/releases/latest) 下载适合你系统的构建：

| 平台 | 文件 | 运行 |
|---|---|---|
| Windows 10/11 x64 | `ORCA-Agent-<version>-win-x64.zip` | 解压后运行 `ORCA.exe`（便携版，无需管理员权限） |
| macOS 12+（Apple Silicon） | `ORCA-Agent-<version>-mac-arm64.dmg` / `.zip` | 拖入 Applications；首次启动：右键 → 打开 |
| macOS 12+（Intel） | `ORCA-Agent-<version>-mac-x64.dmg` / `.zip` | 同上 |
| Linux x64 | `ORCA-Agent-<version>-linux-x64.AppImage` / `.tar.gz` / `.deb` | `chmod +x` 后运行，或 `sudo apt install ./ORCA-Agent-*.deb` |

构建未经过代码签名；每个发行版都附带 `SHA256SUMS`。应用会自我更新：检查发行通道，在后台下载与你的系统/CPU 匹配的安装包（支持断点续传，GitHub 被屏蔽时启用镜像），校验 SHA-256 后在重启时完成安装——无需浏览器（设置 → 更新）。

**从源码运行**（Windows、macOS、Linux）：

```bash
git clone https://github.com/Nethyric/orca.git
cd orca
npm install
npm start          # 桌面应用
npm run web        # 或：浏览器界面 http://localhost:7860
```

> [!TIP]
> 发行版构建中内置模型可直接使用。源码检出没有保管库密钥，请在**设置 → 模型**中添加提供商（维护者可设置 `ORCA_VAULT_KEY`）。参见 [docs/setup.md](docs/setup.md)。

## MCP（Model Context Protocol）

ORCA 内置一个极简、零依赖的 MCP 客户端：在 设置 → MCP 中连接外部工具服务器（也可以直接粘贴 Claude Desktop 的 `mcpServers` 配置）。两种传输方式均受支持——`stdio`（本地子进程）与 Streamable HTTP（兼容旧版 SSE 回退）。服务器惰性启动、静默重连；所有结果都按不可信内容处理，工具清单会生成指纹以发现悄然的重定义，每个工具都可按服务器单独开关。使用 `compact` 模式可将服务器的 schema 保留在上下文之外，直到智能体按需发现它们。

## 提供商

打开**设置 → 模型 → 添加提供商**，从目录中选择一个提供商（或选择 *Custom* 接入任意 OpenAI 兼容 URL），粘贴密钥，点击 **Discover** 列出其模型，然后 **Test**、**Save**。密钥仅存储在你本地的 `config.json` 中。

Anthropic 风格与 OpenAI 风格的 API 均受支持，本地服务器（Ollama、LM Studio、vLLM、llama.cpp）也可以。完整指南：[docs/providers.md](docs/providers.md)。

## 文档

| | |
|---|---|
| **[文档网站](https://nethyric.github.io/orca/)** | 相同指南的网页版——带搜索与深色模式 |
| [概览](docs/README.md) | ORCA 是什么、一次运行如何工作、界面 |
| [安装](docs/setup.md) | 安装、源码构建、数据目录、环境变量 |
| [配置](docs/configuration.md) | `config.json` 的每个键、规则、人设、自主级别 |
| [提供商](docs/providers.md) | 添加提供商与模型、本地模型、密钥排障 |
| [工具](docs/tools.md) | 全部 46 个智能体工具的参考 |
| [HTTP API](docs/api.md) | 界面使用的本地 REST + SSE API（脚本亦可调用） |
| [内置模型与保管库](docs/vault.md) | 内置密钥如何分发、轮换与保护 |
| [决策引擎](docs/decision-engine.md) | 可选的 System One 模型：路由、命令风险审查、回答校验与搜索重排 |
| [MCP](docs/mcp.md) | 连接外部工具服务器（stdio / HTTP、预设、安全） |
| [更新与发行](docs/updates.md) | 自我更新机制、发行通道、手动安装 |
| [故障排查](docs/troubleshooting.md) | 常见问题与解决办法 |
| [安全](SECURITY.md) | 威胁模型、报告方式 |

## 构建 ORCA

```bash
npm run fetch-bins   # ffmpeg、yt-dlp、OCR 数据（不在 git 中）
npm run dist:win     # release/ORCA-Agent-<version>-win-x64.zip
npm run dist:mac     # release/ORCA-Agent-<version>-mac-{x64,arm64}.{zip,dmg}   （在 macOS 上）
npm run dist:linux   # release/ORCA-Agent-<version>-linux-x64.{AppImage,tar.gz,deb}
```

发行版由 GitHub Actions 在每个 `v*` 标签上构建。维护者请参见 [docs/setup.md#maintainers](docs/setup.md#maintainers) 了解发行与密钥轮换流程。

## 参与贡献

欢迎提交 Issue 与 Pull Request。报告任何与密钥相关的问题前请先阅读 [SECURITY.md](SECURITY.md)，并通过 [bug report](.github/ISSUE_TEMPLATE/bug.yml) 提交，附上 ORCA 版本与日志片段。

## 许可证

[MIT](LICENSE) © Nethyric
