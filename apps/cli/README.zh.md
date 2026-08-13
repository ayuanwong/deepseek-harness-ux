# `@deepseek-ai/dsh`

[English](README.md) | 中文

`dsh` 命令是 profile 的产品启动器：profile 是按序叠放的插件组合包 patch 层，之上再叠加用户自己的覆盖层。[`src/args.ts`](src/args.ts) 负责命令语法，[`src/bin.ts`](src/bin.ts) 只加载选中的运行器。无效命令、来自其他模式的选项、配置错误和启动失败都会以非零状态退出。

## 入口模式

| 命令 | 用途 |
|---|---|
| `dsh --profile <name>` | 启动位于 `$DSH_HOME/profiles/<name>` 的指定 profile。 |
| `dsh --profile headless "job"` | 运行一个新的持久化会话，打印最终答案并退出。 |
| `dsh web` | `--profile web` 的别名。 |
| `dsh plugin --profile <name> <pnpm args>` | 通过在 profile 目录中转发给 pnpm 来管理该 profile 的插件。 |

调用目录是默认 workspace 根目录。`web` 和 `headless` profile 在首次使用时会从随附模板自动初始化；其他任何 profile 都必须通过 `dsh plugin` 创建。

## 应用参数

启动器只解析属于自己的 flag,并把其后的一切交给启动起来的 profile,任何注入它的应用插件都可以解析这份共享的不可变快照([`dsh-cmdline`](../../packages/boot/cmdline/README.md))。因此启动器的 flag 必须写在前面,而启动器不认识的第一个 token 就是应用参数的起点:

```sh
dsh --profile web --port 8080       # --port belongs to the web app
dsh --profile tui --resume <id>     # example, assuming the tui profile is installed; --resume belongs to the terminal app
dsh --profile headless "run the tests"
dsh --profile web --help            # the web app's flags, not the launcher's
dsh --help                          # the launcher's own help
```

## Profile

profile 目录包含一个 `package.json`（树外插件依赖，加上 profile manifest（元数据清单）`dsh.profile` 及其有序的 `bundles` 列表）和一个 `cordis.patch.yml`（用户自己的 patch 层）。

配置树在空根之上组合：
- 先按 `dsh.profile.bundles` 顺序应用各组合包的 patch
- 然后是 profile 的 `cordis.patch.yml`，然后是 home 级的 `$DSH_HOME/cordis.patch.yml`
- 最后是 `--patch` overlay

`dsh.profile.bundles` 中列出的组合包先从 dsh 安装目录解析（`@deepseek-ai/dsh-base`、`@deepseek-ai/dsh-web-app`、`@deepseek-ai/dsh-headless`），再从 profile 自己的 `node_modules` 解析；pnpm 把树外插件安装在后者。

使用 `--dump-default-config` 和 `--dump-config` 可在不启动的情况下检查组合后的配置树。

[CLI（命令行界面）行为参考](reference/README.md)负责确切的层优先级、flag、关闭行为、部署默认值和源码执行。

## 开发

生产运行需要已构建的包与前端产物。请在仓库根目录单独运行 `pnpm run build`，然后使用 `pnpm dsh <args...>` 运行 TypeScript 入口并转发所有参数；模块解析约定由[源码执行参考](reference/README.md#source-execution)负责。
