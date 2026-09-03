# dsh-terminal

为 DeepSeek Harness Web GUI（`dsh web`）提供的 VS Code 风格集成终端插件。

## 功能

- **下部 Panel 布局（参照 VS Code）**：终端以一条通栏面板停靠在窗口底部，可上下拖拽调整高度、双击面板头最大化/还原。
- **一键开关**：侧边栏底部（设置按钮旁）的终端按钮打开/收起面板；支持 `Ctrl+\`` 快捷键（可在设置中关闭）。
- **可配置字体**：设置 → 终端 页可设定终端字体族（留空跟随 dsh 代码字体）与字号（10–24px），改动即时生效并持久化。
- **常规终端能力**：
  - 多标签页：新建 / 关闭 / 切换，会话互不干扰；
  - 默认在**当前工作区目录**启动（跟随 GUI 当前会话所属工作区；无法解析时回退宿主策略/启动目录）；
  - 真实 PTY（node-pty），交互程序（vim、htop、python REPL 等）正常；
  - 列/行自适应：面板尺寸、窗口、字体变化时自动 fit 并回传服务端 resize；
  - 复制 / 粘贴（面板按钮，或终端聚焦时 `Ctrl+Shift+C` / `Ctrl+Shift+V`，右键菜单）；
  - 清屏（清空回滚缓冲）；5 000 行回滚缓冲；
  - 配色随 GUI 深浅主题自动切换；断线自动重连（新 shell）。

## 安装

需要 Node ≥ 20（推荐 22；node-pty 在安装时编译原生模块）。

```sh
# 1) 构建（在插件目录内）
npm install
npm run build
```

```sh
# 2) 安装到 web profile（在插件目录【外】执行，用绝对路径）
dsh plugin --profile web add /绝对/路径/dsh-terminal
```

> ⚠️ 路径必须是插件项目的真实路径，推荐绝对路径。在项目目录内执行 `add ./dsh-terminal` 会被解析成不存在的嵌套路径，插件不会激活。
> 安装成功后 `~/.dsh/profiles/web/package.json` 应出现 `"dsh-terminal": "link:…"`，且 `dsh.profile.bundles` 列表包含 `"dsh-terminal"`（由 reconcile 自动追加；如缺失请手动补上）。

```sh
# 3) 重启 dsh web，再硬刷新浏览器页面
```

## 使用

| 操作 | 位置/快捷键 |
| --- | --- |
| 打开/收起终端面板 | 侧边栏底部终端按钮；`Ctrl+\`` |
| 新建终端 | 面板头部 `＋`；打开空面板时自动新建第一个 |
| 关闭标签页 | 激活标签右侧的 `×`（会终止该 shell） |
| 调整面板高度 | 拖拽面板顶部细条 |
| 最大化/还原 | 双击面板头部或点最大化按钮 |
| 复制 / 粘贴 | 头部按钮；终端内 `Ctrl+Shift+C` / `Ctrl+Shift+V`；右键菜单 |
| 清屏 | 头部垃圾桶按钮 |
| 重开已结束会话 | 底部状态条“重新打开” |

面板隐藏时打开的会话保持运行（与 VS Code 一致）；关闭标签页或刷新页面/断开连接会终止对应 shell。

### 设置（设置 → 终端）

- **字体**：下拉预设 + “自定义…”输入任意 CSS font-family 栈；留空（默认）跟随 dsh 的代码字体。
- **字号**：10–24px。
- **快捷键**：`Ctrl+\`` 开关面板。

## 工作原理

- **服务端（`lib/`，Cordis 插件）**
  - 注册 `dsh-terminal` 设置命名空间（`fontFamily` / `fontSize` / `toggleKey`）；
  - 注册 WebSocket 升级路由 `/dsh-terminal/ws`：先做 Host/Origin 围栏（宿主 `requestRejection` 优先，另有 loopback Origin 自检兜底），再用 `ws` 升级握手；
  - 每个连接惰性创建 **node-pty** shell（`$SHELL`，缺省 `/bin/bash`，`TERM=xterm-256color`），输出以二进制帧下发、输入以 JSON 帧写入、支持 `resize`；shell 退出后连接保持，可“重新打开”；
  - 环境变量按宿主规则清洗（剔除含 KEY/PASSWORD/SECRET/TOKEN 与 `DSH_*` 的项）；cwd 优先取**客户端随 `open` 帧上报的当前工作区目录**（校验为真实目录后使用），否则回退 `sandboxPolicy.workspaceRoot`，缺省 `process.cwd()`；
  - 心跳 30s；插件卸载时终止全部会话。
- **客户端（`client/client.js`，浏览器插件）**
  - 挂载在宿主 `shell.overlay` 槽位（list, root）渲染底部坞；`sidebar.footer.action` 槽位放开关按钮；`settings.section` 槽位注册“终端”设置页；
  - xterm.js 内联进单文件 bundle（含其 CSS），配色读取 `--dsw-alias-*` 等设计令牌并订阅 `theme/change`；
  - 面板状态与按钮/快捷键共享同一份模块级 store；面板隐藏时标签仍存活。

## 开发

```sh
npm run typecheck    # 服务端 + 客户端类型检查
npm run build:server # tsc → lib/
npm run build:client # esbuild → client/client.js（xterm CSS 以文本内联）
npm run build        # 两者
node scripts/smoke-server.mjs   # 服务端链路冒烟（模拟宿主 webServer）
```

改动源码后重新 `npm run build`，并**重启 `dsh web`**（服务端半场与客户端产物都要重启才生效），随后硬刷新浏览器。

## 安全边界

本插件的终端是运行在宿主机器上的**真实交互 shell**，有意**绕过** dsh 的能力/权限审批模型（等价于在宿主机打开一个本地终端）。它只应被用在本机 loopback 的 `dsh web` 上：

- WebSocket 升级做了同源/loopback Origin 围栏；
- 传给 shell 的环境变量剔除了疑似密钥与 `DSH_*` 项；
- 不在沙箱内运行，不适用于远程/共享部署。

## 已知限制

- 底部坞是覆盖层（覆盖窗口底部条带），并不挤压聊天区——这是宿主布局插件的边界，不做真 dock 布局改造；
- 刷新页面/断线后会话重建（滚动历史丢失），与多数 Web 终端一致；
- 没有搜索/Web 链接/中键粘贴（可后续扩展）；
- 命名注记：宿主闭包另有面向 Agent 的 headless 终端包（`@deepseek-ai/dsh-terminal`、`dsh-terminal-bash`），与本插件的无作用域包名 `dsh-terminal` 不同源；若未来宿主把同名 entry 加入 web profile 造成重复 insert，改动 `cordis.patch.yml` 的 insert id 即可。

## License

MIT
