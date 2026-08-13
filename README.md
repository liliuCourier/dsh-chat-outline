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

### Compatibility

Works with DSH 0.1.0-rc.6. If you run into issues after a DSH upgrade, update the plugin.

### License

[MIT](./LICENSE)
