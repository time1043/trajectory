# Trajectory

记录一个人的成长路径——所有的人格潜力，都在他与 AI 的对话中。

本地 Vite dev tool（形似 vitest-ui）：读取本地 AI 对话导出数据（目前支持 DeepSeek，插件式扩展），提供活跃度热力图、时段分布、会话检索、文档流阅读、变体切换与时间线视图。数据完全在本地，不出机器。

## 快速开始

```bash
pnpm install
./scripts/init-data-dir.sh   # 软链 data/ 到本地数据仓库（或手动 ln -s）
pnpm dev
```

打开终端提示的地址（默认 http://localhost:5173）。`data/web/deepseek/` 放 DeepSeek 官方导出的 `conversations.json` 与 `user.json`。

## 架构

依赖方向强制单向：`domain ← adapters ← app ← routes/components`。

```
plugins/trajectory-data.ts   # vite 插件：只做文件系统（manifest / 字节流 / watch-HMR）
src/
├── domain/                  # 【第 0 层】零依赖纯领域层（不 import react/jotai/vite/node）
│   ├── model/               #   Trajectory 聚合根：message 树（真相层）+ activePath
│   ├── ports/               #   SourceAdapter / Sanitizer / DataHost 契约
│   └── services/            #   turn-builder（分析读模型）document-view（阅读读模型）
│                            #   growth-analytics（streak/热力图口径）topics（字典匹配）
├── adapters/                # 【第 1 层】外部实现
│   ├── sources/deepseek/    #   DeepSeek 导出格式 → 领域模型（角色推断/时区折算/PII 掩码）
│   ├── sanitize/            #   RegexSanitizer（预备实现，默认关闭）
│   └── topics/              #   主题关键词字典
├── app/                     # 【第 2 层】jotai 世界 + ingest 管道
│   ├── ingest.ts            #   parse → sanitize → invariants 校验 → 深冻结
│   ├── derive.ts            #   列表轻量行 / ⌘K 检索文本 / 主题
│   └── stores/              #   data(加载层) detail(变体) growth(统计) sessions(筛选) theme
└── routes/ components/      # 【第 3 层】UI（antfu 风格 design tokens 见 index.css）
```

### 核心领域决策

- **message 树是真相，Turn/DocumentView 是读模型**。消息树保留全部分支（改写重发与重新生成统一为 variant）；`activePath` 按导出实测归纳（每个分支点取时间末位 child）；顶层分支（root 的多个孩子）视为"虚拟 root"的变体。
- **多来源合并索引**。`TrajectoryId = ${sourceId}:${rawId}` 在领域层 namespaced；全部已识别 source 并行加载进同一列表，provider 只以品牌色圆点出现在数据维度。
- **不可变性**。ingest 管道出口深冻结（React Compiler 的 memo 前提）；变体切换等一切"变化"都是纯函数返回新值。
- **citation 两级解析**。实测编号是"轮内搜索窗口"的 1-based 索引：轮内窗口 → 会话级注册表 → 降级纯文本，不丢内容。
- **诊断而非崩溃**。未知 fragment 类型进 `unknown` 桶计数、不变量违例进 `diagnostics`，格式漂移第一时间可见。

### 新增一个数据源（如 ChatGPT / Claude / 本地 CLI）

1. `data/<group>/<provider>/` 放入导出文件（`web/chatgpt/…`、`local/…` 均可）
2. 新建 `src/adapters/sources/chatgpt/`：实现 `SourceAdapter`（`detect(manifest)` 认领目录 + `parse()` 映射到领域模型，纯同构函数，只经 `fetchFile` 取字节）
3. 在 `src/adapters/sources/index.ts` 注册一行

vite 插件自动发现目录并生成 manifest；未被认领的目录在侧栏显示为未识别而非报错。

### 脱敏（预留钩子）

`Sanitizer` 端口位于 ingest 管道（adapter 之后、store 之前）收口。`PersonaProfile` 类型层面不含明文 PII（adapter 就地掩码）；`createRegexSanitizer` 已备好 email/手机号/身份证正则，"脱敏分享"落地时在 `stores/data.ts` 打开 `sanitizeText` 即可。

## 交互

| 按键 | 作用 |
| --- | --- |
| `⌘K` | 命令面板（标题 + 首条提问检索） |
| `j` / `k` | 会话列表上/下移动 |
| 热力图格子 | 点击按当日 Turn 活动筛选会话 |

## 开发

```bash
pnpm dev      # 本地开发
pnpm build    # tsc -b + vite build
pnpm lint     # oxlint
pnpm fmt      # oxfmt
```

技术栈：Vite 8 · React 19（React Compiler）· TanStack Router（文件路由）· Jotai 3 · Tailwind CSS 4 · shiki（懒加载双主题高亮）· react-markdown
