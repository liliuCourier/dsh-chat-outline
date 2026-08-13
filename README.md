# dsh-chat-outline — DeepSeek Harness Plugin

对话栏左侧的常驻对话大纲。按轮次列出每次提问与最终回复，点击即可跳转到对应位置。

## 中文文档

### 功能特性

- 覆盖完整会话历史，打开后自动加载，无需手动翻页
- 点击任意条目，聊天区平滑滚动到对应消息
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

### 使用

面板常驻在对话栏左侧。每条记录分「我」和「助手」两行，点击任意一行即可跳转。面板顶部的输入框支持按关键词过滤。

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

A persistent conversation outline on the left of the chat column, listing every question and its final reply by turn. Click any entry to jump to it.

### Features

- Covers the full session history and loads it automatically, no manual paging
- Click any entry to smoothly scroll the chat to the corresponding message
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

### Usage

The panel stays on the left of the conversation. Each entry has a "Me" row and an "AI" row; click either to jump. The input at the top filters the list by keyword.

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
