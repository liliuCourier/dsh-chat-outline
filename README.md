# dsh-chat-outline — DeepSeek Harness Plugin

[![awesome · DSH plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)

对话一长就没法一直往上翻了。这个插件在对话栏左侧常驻一个对话大纲：按轮次列出每次提问和该轮最后一条回复，点击任意一条即可跳回对应位置，按住 Ctrl/Shift 再点击则直接切到轨迹视图的同一位置。蓝框会始终标记你当前读到哪，随滚动跟随；顶部的输入框可以按关键词过滤。它读取全部历史来生成完整大纲，但只保留精简信息，不会把整个会话加载进内存。

![dsh-chat-outline 演示](docs/gif4.gif)

## 中文文档

### 功能特性

- 覆盖完整会话历史，打开后自动加载，无需手动翻页
- 点击任意条目，聊天区平滑滚动到对应消息
- 按住 Ctrl/Shift 点击条目，直接切到轨迹视图并定位到对应位置
- 蓝框标记当前阅读位置，随滚动跟随
- 支持按关键词过滤
- 跟随 DSH 明暗主题

### 安装

通过 npm 安装：

```sh
dsh plugin --profile web add dsh-chat-outline
```

或者从 GitHub 安装：

```sh
dsh plugin --profile web add github:liliuCourier/dsh-chat-outline
```

然后在 `$DSH_HOME/profiles/web/cordis.patch.yml` 中加入：

```yaml
- insert:
    - id: dsh-chat-outline
      name: dsh-chat-outline
```

最后刷新浏览器页面即可生效。

> 从 0.1.6 起包内已含 `dsh.bundle`，通过 npm / GitHub 安装会自动激活，无需手动追加上面的 insert；手动 insert 仅对旧版本或源码目录安装适用。

### 使用

面板常驻在对话栏左侧。每条记录分「我」和「助手」两行，点击任意一行即可跳转。按住 Ctrl/Shift 再点击，会切到轨迹视图并定位到同一位置。面板顶部的输入框支持按关键词过滤。

### 对话与轨迹的跳转关系

对话和轨迹是同一个会话的两种视图：对话按轮次展示内容，轨迹按请求、工具调用和时间线展示执行过程。大纲面板里的每条记录都对应会话中的一个位置，两种跳转方式落点是同一个：

- **单击**：在对话视图里滚动定位到对应消息；
- **按住 Ctrl 或 Shift 单击**：切到轨迹视图，定位到同一位置。提问行落在轨迹中的用户消息行，回复行落在这轮最后一条回复所在行。

两个视图共用同一套事件编号，所以无论当前在哪个视图，跳转后看到的都是同一条内容。

### 常见问题

- **Windows 下 Git 报 SSL 凭据错误**：`fatal: schannel: AcquireCredentialsHandle failed: SEC_E_NO_CREDENTIALS`。这是 Windows Git 的 schannel 后端问题，改用 OpenSSL 后端即可：

  ```sh
  git -c http.sslBackend=openssl clone https://github.com/liliuCourier/dsh-chat-outline.git
  ```

  或者直接使用 npm 方式安装，不经过 Git。
- **安装时提示 peer dependency 警告**：pnpm 报 `unmet peer dependency` 属正常，DSH 的 web bundle 已包含这些模块，不影响使用。
- **安装后看不到面板**：先刷新浏览器页面，必要时重启 `dsh web`。服务端清单会即时更新，但已经打开的页面需要刷新一次才会加载插件。

### 兼容性

适配 DSH 0.1.0-rc.6。DSH 升级后如遇异常，请更新插件。

### 许可证

[MIT](./LICENSE)

---

## English Documentation

Long conversations make scrolling back painful. This plugin keeps a persistent outline on the left of the chat column: every question and its final reply, listed by turn, with one-click jump to any of them — hold Ctrl/Shift while clicking to jump straight to the same spot in the Trajectory view. A blue frame always marks where you are reading and follows the scroll, and the input at the top filters by keyword. It scans the full history to build a complete outline while keeping only compact data — the whole session is never loaded into memory.

### Features

- Covers the full session history and loads it automatically, no manual paging
- Click any entry to smoothly scroll the chat to the corresponding message
- Ctrl/Shift+click an entry to jump straight to that position in the Trajectory view
- A blue frame marks your current reading position and follows the scroll
- Filter by keyword
- Follows the DSH light/dark theme

### Installation

Via npm:

```sh
dsh plugin --profile web add dsh-chat-outline
```

Or from GitHub:

```sh
dsh plugin --profile web add github:liliuCourier/dsh-chat-outline
```

Then add the following to `$DSH_HOME/profiles/web/cordis.patch.yml`:

```yaml
- insert:
    - id: dsh-chat-outline
      name: dsh-chat-outline
```

Finally, refresh the browser page.

> Since 0.1.6 the package ships a `dsh.bundle` manifest, so npm / GitHub installs activate automatically — the manual insert above is only needed for older versions or source-folder installs.

### Usage

The panel stays on the left of the conversation. Each entry has a "Me" row and an "AI" row; click either to jump. Hold Ctrl/Shift and click to switch to the Trajectory view at the same position. The input at the top filters the list by keyword.

### How chat and trajectory jumps relate

Chat and Trajectory are two views of the same session: Chat lays out the conversation by turns, while Trajectory shows the execution by requests, tool calls and a timeline. Every outline entry maps to one position in the session, and the two jump styles land on the same spot:

- **Click**: scroll the chat to the corresponding message.
- **Ctrl/Shift+click**: switch to the Trajectory view at the same position. A question entry lands on the user message row; a reply entry lands on the last assistant row of that turn.

Both views share the same event numbering, so no matter which view you jump from, you end up on the same piece of content.

### Troubleshooting

- **Git SSL credential error on Windows**: `fatal: schannel: AcquireCredentialsHandle failed: SEC_E_NO_CREDENTIALS`. This is a Git-on-Windows schannel issue; switch to the OpenSSL backend:

  ```sh
  git -c http.sslBackend=openssl clone https://github.com/liliuCourier/dsh-chat-outline.git
  ```

  Or simply install via npm, which does not go through Git.
- **Peer dependency warnings during install**: pnpm may report `unmet peer dependency`; these are expected and harmless — the DSH web bundle already includes those modules.
- **Panel not visible after install**: refresh the browser page first, and restart `dsh web` if necessary. The server manifest updates immediately, but an already-open page needs a refresh to load the plugin.

### Compatibility

Works with DSH 0.1.0-rc.6. If you run into issues after a DSH upgrade, update the plugin.

### License

[MIT](./LICENSE)
