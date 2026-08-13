# `dsh` CLI（命令行界面）行为参考

[English](README.md) | 中文

本参考定义 profile、web 别名、插件管理和配置 dump 命令模式。参数由 [`src/args.ts`](../src/args.ts) 统一解析，[`src/bin.ts`](../src/bin.ts) 只动态导入选中的运行器。

## Profile 启动

`dsh --profile <name>` 启动位于 `$DSH_HOME/profiles/<name>` 的 profile。生效配置树在空根节点之上按以下顺序逐层组合：profile manifest（元数据清单）的 `dsh.profile.bundles` 列表所列的各个组合包 patch、profile 自身的 `cordis.patch.yml`、home 级的 `$DSH_HOME/cordis.patch.yml`（各 profile 共享的机器本地偏好，因此优先级高于逐 profile 的层）、以及按 argv 顺序的各个 `--patch <path>` overlay。后应用的层按行胜出；patch 替换目标行完整的 `config` 值，而不是深度合并各键，并且可以插入新行。配置解析、schema 校验、模块解析或插件启动失败会得到报告并以非零状态退出。收到 SIGINT 或 SIGTERM 时，挂载的根节点会先 dispose（资源释放）再退出。

组合包名称先从 dsh 安装解析，再从 profile 目录解析。因此内置组合包（`@deepseek-ai/dsh-base`、`@deepseek-ai/dsh-web-app`、`@deepseek-ai/dsh-headless`）总是来自与正在运行的 `dsh` 相同的安装；树外组合包来自 profile 由 pnpm 管理的 `node_modules`。任何 patch 行中的裸插件 `name` 通过 profile 目录的 Node 父目录逐级查找解析，该查找可达到持续维护的安装后备目录 `$DSH_HOME/profiles/node_modules`（安装的应用和组合包所依赖的每个包对应一个符号链接，每次启动时修复）。

`web` 和 `headless` profile 首次使用时会从随附模板自动初始化（`web`：base + web-app；`headless`：base + headless）。其他缺失的 profile 会显式报错，并提示运行 `dsh plugin --profile <name> add <package>`。

### 应用参数

启动器自己的 flag 写在最前面,并在它不认识的第一个 token 处结束;从那里开始的一切都通过 `ctx.cmdlineArgs` 原样交给启动起来的 profile,任何注入它的应用插件都可以解析([`dsh-cmdline`](../../../packages/boot/cmdline/README.md))。因此 `dsh --profile web --port 8080` 到达的是 web 应用的 `--port`,`dsh --profile web --help` 打印的是该应用的 help 且什么也不启动,而 `dsh --help`(没有可以交付的 profile)打印的是启动器自己的 help。`-V`/`--version` 写在应用参数边界之前时会打印启动器的版本。

一套组合只挂载一次。普通插件注入 `cmdlineArgs`、解析本应用参数，并把结果作为服务提供出去；由 flag 配置的每一行都会注入该服务，Loader 会等服务激活后再求值该行配置（`port: !!js ctx.webStartup.port ?? 3080`），因此 flag 胜过写在它旁边的值。该优先级要求配置行保留这一表达式；若用户 patch 用字面量替换整份 `config`，运行时读取也会随之消失。help 和被拒绝的参数会请求退出——拒绝时以非零状态，help 时以 0——且不会激活依赖提供方服务的行。在线编辑 `cordis.patch.yml` 会针对仍然在线的服务重新求值表达式，因此不会重置已在服务的端口。

启动器的 flag 必须写在应用参数之前，且启动器的解析器会消耗掉一个 `--`：必须以字面量 `--` 送达应用的参数需要写成 `-- --`。如果应用的第一个参数恰好等于 `web` 或 `plugin`，会选择对应的子命令。`ctx.cmdlineArgs.get()` 是共享的不可变读取：多个插件可以解析同一份快照，没有读取方的 profile 则会忽略自己的应用参数。

随附的各应用持有这些命令行：

| Profile | 参数 |
|---|---|
| `web` | `--host`、`--port`、可重复的 `--trusted-host` |
| `headless` | 任务文本，作为位置参数 |

一次性任务（`dsh --profile headless "run the tests"`）通过核心注册表创建一个全新的持久化 Agent（智能体），提交任务、等待完全停稳并对会话执行 flush，再从其持久化事件区间中推导最后一个非空 assistant 文本与最终 `turn/end` 原因。它在 stdout 打印文本，并在原因为 `completed` 时以 0 退出，否则以 1 退出。没有任务的调用是该应用的用法错误。随附 headless profile 不挂载 ApiProxy、Host、HTTP 服务器、Web 运行时或浏览器客户端；成功运行不会向 stderr 写入任何内容，也不会打开监听端口。

可在不启动的情况下检查组合出的配置树：

```sh
dsh --profile web --dump-default-config
dsh --profile web --patch ./extra.yml --dump-config
```

`--dump-default-config` 只打印组合包各层；`--dump-config` 额外加上 profile 的 `cordis.patch.yml`、home 级的 `$DSH_HOME/cordis.patch.yml` 和 `--patch` overlay。两者都会打印注释，标明每行由哪个文件提供，以及哪些 overlay 修改过它；`!!js` 表达式保持未求值，找不到目标的 patch 会报告到 stderr。dump 从不运行应用命令行提供方，因此它展示的是任何应用参数被解析之前的组合配置树，并拒绝携带应用参数的调用。

## 插件管理

`dsh plugin --profile <name> <args...>` 在 profile 缺失时先初始化它（有随附模板的用模板，其他名称只装 `@deepseek-ai/dsh-base`），然后以 profile 目录为工作目录，把 `<args...>` 转发给 `pnpm`：`add`、`remove`、`why`、`update` 及其他所有 pnpm 子命令都照常可用；pnpm 必须在 PATH 上。相对路径 spec（`.`、`../plugin` 及其 `file:`/`link:` 形式）会先锚定到调用目录，因此在插件 checkout 中执行 `add .` 安装的是该 checkout，而不是 profile。每次成功运行后，`dsh.profile.bundles` 都会与已安装状态对齐：每个解析到 manifest 中声明了 `"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }` 的包的依赖加入层栈（因此让包获得该声明的 `update` 会将其激活），没有组合包声明的依赖保持为普通依赖并给出一次性警告，已移除的依赖则退出层栈。

```sh
dsh plugin --profile tui add github:deepseek-harness/turtle-ui
dsh plugin --profile tui remove turtle-ui
dsh --profile tui
```

Git 托管、随附源码的插件在安装期间通过其 `prepare` 脚本构建，而 pnpm ≥10 在消费方允许之前会阻止该脚本：首次 `add` 会失败并给出 pnpm 的 `allowBuilds` 提示（以及 dsh 指向该 profile 的 `pnpm-workspace.yaml` 的指引）；把打印出的键复制到那里并重新运行即可。安装已构建的 tarball 或本地 checkout 不需要任何允许。

## Web 别名

`dsh web` 是 `--profile web` 的硬编码别名；写在它之后的 flag 属于 web 应用，由组合包中的普通提供方解析。`--host` 和 `--port` 覆盖承载它们的那些行的组合取值，可重复的 `--trusted-host` 通过 `ctx.webRuntime.trustedHosts` 提供本次调用的 authority（部署表达式会拼接自己的 authority），客户端插件 HMR（热模块替换）接收器始终挂载，在单独运行的 `pnpm run dev:web` watcher 重建客户端 bundle 之前保持空闲。

```sh
dsh web
dsh web --patch ./extra.cordis.yml
dsh web --dump-config
dsh web --help
```

生产 Web 运行器需要已构建的包和前端产物（`pnpm run build`）。默认服务地址是 `http://127.0.0.1:3080`。绑定所有网络接口时，还会信任机器自动发现的 LAN IP 字面量；`--trusted-host` 可添加 `/api` 浏览器信任围栏接受的具名 authority。

进程关闭时会给插件树最多 5 秒完成 dispose。第一次 `SIGINT`/`SIGTERM` 启动该优雅排空——`SIGTERM` 是监督进程的普通停止请求，在所有 surface 上以 0 退出，`SIGINT` 报告 130；第二次信号强制立即退出。如果一次性运行正常结束时已经卡在 dispose 中，第一次 `Ctrl+C` 就会升格并立即退出，而不会被吞掉。

所有模式都将调用目录作为默认 workspace 根目录，以 65,536 字节渲染预算加载适用的 `AGENTS.md` 或 `CLAUDE.md` 指令，并使用内存 SQLite 会话内容索引。每次 profile 启动都监视两个 `cordis.patch.yml` 层（profile 与 home）的有效编辑并以事务方式重新应用；一次性 surface 经由有界关闭退出，关闭会先 dispose 监视器。

新会话默认使用 `workspace-write` 权限预设。Bash 和文件系统修改仅限于会话 workspace 与平台临时根目录；读取、网络访问和进程可见性不受限制。`DSH_PERMISSION_MODE` 更改进程后备值。General settings 中存储的权限影响后续 Web 会话，不改变已打开的会话。

`DSH_TOOLS_MODE` 为进程选择 `native`、`code` 或 `both`；其他值会导致启动失败。随附的 `minimal` agent preset 会保留该部署的呈现方式，将完整系统提示词固定为 `You are a helpful software engineer assistant.`，并且仅组合持久 `bash` 和 `str_replace_editor`。创建 Web 会话时请选择极简模式；该 agent 不包含任何其他提示词段落或面向模型的插件，而共享的浏览器、workspace、持久化、沙箱与权限宿主保持不变。

## 共享部署行为

基础组合包挂载原生 DeepSeek 适配器、settings 与凭据提供方、稳定的 `web_search` 和已禁用的会话遥测。提供方凭据依次从继承环境、`$DSH_HOME/.credentials.yaml`、调用目录的 `.env` 和 `$DSH_HOME/.env` 解析；受管文档从不物化进 `process.env`，而两个 `.env` 文件都是普通启动环境层。搜索使用 `DEEPSEEK_API_KEY` 并接受 `DEEPSEEK_SEARCH_BASE_URL`；只有 patch 层插入提供方并启用 `web_fetch` 后，该工具才可用。

会话遥测默认留在本地。`DSH_TELEMETRY_MODE=FULL` 将每条已投影会话事件作为 OTLP/HTTP 日志流式发送，`DSH_TELEMETRY_MODE=FEEDBACK_ONLY` 则仅在记录反馈时上传会话日志后缀。`DSH_TELEMETRY_OTLP_URL` 选择其他 collector，任何非空 `DSH_TELEMETRY_DISABLED` 仍是具有最高优先级的硬性退出开关。随附基础配置没有遥测脱敏规则，因此显式启用的导出可能包含消息文本、工具参数与结果以及 workspace 路径；该部署决策由[默认关闭 Agent Note](../../../.agents/notes/implemented/feature/2026-08-10-telemetry-default-off.md)负责。


通过 `dsh plugin --profile <name> add <package-or-git-spec>` 安装外部插件组合包。安装的包拥有其依赖，并贡献其声明的 `cordis.patch.yml` 层。CLI 还随附 `@deepseek-ai/dsh-mcp-client` 作为供 patch 层使用的依赖，但默认不启用 MCP 服务器，因为每条服务器命令都是 agent（智能体）沙箱之外的受信任可执行代码。

## 源码执行

请在仓库根目录中，于全新 checkout 之后及产物需要更新时单独运行 `pnpm run build`，然后使用 `pnpm dsh <args...>`。`package.json` 中的脚本不会构建，而是通过 `node --import tsx/esm` 启动 `apps/cli/src/bin.ts`，并转发所有参数。Typert Host 产物缺失时，profile 启动会因不含构建指引的模块解析错误而失败。这些 Host 产物存在后，如果前端或 Client plugin 组合包缺失，启动会失败并提示运行 `pnpm run build`。启动器不会检查产物是否为最新，因此已有的陈旧组合包可能继续运行旧版浏览器代码，直至重新构建。该进程会继承启动环境；当支持环境代理的 Node 版本必须遵循 `HTTP_PROXY` 和 `HTTPS_PROXY` 时，请设置 `NODE_USE_ENV_PROXY=1`。安装形式会直接启动构建后的 `apps/cli/lib/bin.js`，不会重新构建仓库。
