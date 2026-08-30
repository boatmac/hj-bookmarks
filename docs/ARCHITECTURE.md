# 项目架构

## 运行约束

本项目的核心约束是：最终环境只需要现代浏览器，不需要 Node.js、npm、打包器或开发服务器。

由于部分浏览器限制 `file://` 页面加载 ES Module，生产代码使用按顺序加载的经典脚本：

```html
<script src="js/core/translations.js" defer></script>
<script src="js/core/config.js" defer></script>
...
<script src="js/app.js" defer></script>
```

所有脚本都在同一个浏览器全局词法环境中运行。每个文件只声明函数和状态，不在加载期间执行异步业务；`js/app.js` 最后注册或执行初始化。

## 目录职责

```text
js/
├── core/
│   ├── translations.js  中英文词典
│   ├── config.js        常量、全局状态和基础翻译函数
│   ├── coordination.js  Web Locks、BroadcastChannel 与标签页状态
│   ├── storage.js       IndexedDB schema 与事务操作
│   └── utils.js         URL、层级、日期、DOM 与顶层提示工具
├── data/
│   └── transfer.js      JSON/HTML 导入导出和清空流程
├── sync/
│   ├── backup.js        File System Access 自动备份、加密设置与口令生命周期
│   ├── local-folder.js  桌面云盘本地目录双向同步
│   ├── coordinator.js   同步生命周期、凭据和冲突中心
│   ├── providers.js     标准 WebDAV 与 Koofr Adapter
│   ├── crypto.js        同步与备份的 PBKDF2 + AES-GCM 信封
│   └── merge.js         数据集规范化、三方合并与本地应用
├── ui/
│   ├── render.js        导航、文件夹和书签卡片渲染
│   ├── bookmarks.js     表单、拖拽和书签交互
│   ├── recovery.js      回收站渲染、恢复与永久清除
│   ├── help.js          页面内最终用户帮助
│   ├── backup-restore.js 备份发现、差异预览与三种安全恢复模式
│   └── sync-wizard.js   面向同步位置的首次设置向导
├── app.js               DOM 缓存、国际化应用和事件绑定
└── script.js            旧版单脚本入口的兼容加载器
```

## 加载顺序

1. `translations.js` 提供 `TRANSLATIONS`。
2. `config.js` 创建常量、`state` 和 `ui`。
3. 存储与同步模块声明底层函数。
4. UI 与数据模块声明上层操作。
5. `utils.js` 提供运行时通用函数。
6. `app.js` 在所有依赖声明完成后启动应用。

经典脚本的跨文件函数会被单文件 lint 误判为未使用，因此模块头部包含局部 `no-unused-vars` 说明。语法、运行时和浏览器测试仍会检查真实调用链。

## 状态边界

`state` 是唯一运行时状态根：

- `state.items`：当前书签快照；
- `state.view`：当前筛选和目录；
- `state.backup`：本地备份状态；
- `state.sync`：远端同步、凭据、基线和冲突状态；
- `state.persistence`：浏览器持久存储状态；
- `state.coordination`：当前标签页 ID、跨标签页消息、写锁和同步心跳。

长期数据必须通过 `storage.js` 写入 IndexedDB。密码和加密口令不得进入长期设置。`state.backup.passphrase` 与 `state.sync.passphrase` 是相互独立的内存凭据；长期备份设置只保存是否启用加密及随机配置 ID。

## 备份加密边界

`backup.js` 决定新快照使用明文还是加密文件名，并把完整 `bookmark-manager` payload 交给 `crypto.js` 加密。加密信封不包含书签摘要或导出时间；文件名仍携带历史快照时间。切换格式时只在新文件成功写入后删除另一格式的 `bookmarks-latest`，历史文件继续按统一保留数量清理。

备份口令默认只在 `state.backup` 中保留。用户明确选择刷新保留后，口令才写入独立 `sessionStorage` key，并同时绑定随机配置 ID；初始化仅在 Navigation Timing 为 `reload` 时恢复。恢复向导使用另一个 session key，且只有口令成功解密过快照后才允许持久到刷新会话。两者都不会进入 IndexedDB。

## 备份恢复边界

恢复向导接受受支持的明文 `format: bookmark-manager` JSON，或 `format: bookmark-manager-encrypted-backup` 加密信封。扫描阶段只验证加密信封结构并显示锁定状态；用户选中后才执行 PBKDF2 和内容校验。解密后的 payload 继续验证 URL、重复记录 ID、父项类型和层级循环。目录扫描逐文件让出主线程，快照内容只在选中时转换为恢复记录，避免同时保留所有历史文件的完整对象。

`backup-restore.js` 使用稳定 `syncId` 比较快照与当前数据，并为旧备份提供 URL 与文件夹位置回退匹配，生成“新增 / 有差异 / 相同 / 当前独有”四类结果。安全合并只插入缺少内容并复用同位置同名文件夹；选择恢复将用户勾选的新增或差异项目转换为同步实体，自动补齐缺少的上级文件夹；完整替换通过 `storage.js` 中的单个 IndexedDB 事务重建书签，同时为快照中不存在的当前项目写入删除墓碑。

三种模式在事务前都必须先成功写入 `emergency/` 紧急备份。自动备份当前已启用加密或所选恢复快照本身已加密时，紧急备份也必须加密；加密或写入失败即终止，不触碰 IndexedDB。所有恢复项目都会写入当前时间和当前设备 ID，以便下一次同步把恢复视为明确的本机修改。预览保存当前数据签名；获取 Web Lock 后会重新读取 IndexedDB，如果签名变化则终止本轮并要求用户审阅刷新后的差异。

恢复操作与普通修改使用同一个 Web Lock，成功后广播数据变化，并分别触发自动备份和已解锁的自动同步。

## 多标签页协调

所有书签变更通过同一个 `bookmark-manager-data-write-v1` Web Lock 执行；远端同步在读取、合并、上传和应用本地结果的完整生命周期内持有该锁。用户修改使用 `ifAvailable` 模式，锁被占用时不排队执行陈旧操作，而是提示重试。

标签页通过 `BroadcastChannel` 广播 `data-changed`、`sync-start`、`sync-heartbeat` 和 `sync-end`。localStorage storage event 作为回退通道。同步心跳携带 6.5 秒租约，异常关闭后其他标签页会自动移除过期状态。

外部变更通知会在 120 ms 内合并刷新；当前标签页正在同步或持有写锁时延后到操作结束。

## 兼容加载器

旧缓存中的 `index.html` 可能仍引用 `js/script.js`。该文件不再包含应用实现，只按生产顺序动态加载模块。`app.js` 同时支持在 DOMContentLoaded 前后启动，因此兼容加载器不会造成初始化丢失。

新代码不得加入兼容加载器；它只维护模块列表和缓存版本。

## 测试架构

`tests/index.html` 是无依赖浏览器测试入口：

- 设置独立的 `BOOKMARK_TEST_DB_NAME`；
- 只加载被测模块，不加载生产 UI 启动器；
- 顺序执行同步和异步测试；
- 使用 DOM 展示结果；
- 将机器可读结果写入 `window.__TEST_RESULTS__`；
- 测试结束后关闭并删除临时数据库。

自动化环境可以用任意支持 DevTools Protocol 的浏览器读取 `window.__TEST_RESULTS__`，但这不是最终用户运行应用的前置条件。

仓库还提供两个仅用于维护和 CI 的零 npm 依赖脚本：

- `tests/static-checks.mjs`：执行 JavaScript 语法、HTML ID、DOM 缓存、双语词典、本地资源和缓存版本检查；
- `tests/run-browser-tests.mjs`：查找本机 Edge/Chrome/Chromium，通过 DevTools Protocol 打开测试页并读取结果。

`.github/workflows/browser-tests.yml` 在 push、pull request 和手动触发时使用 Node.js 22 与 GitHub Ubuntu runner 自带的 Chrome 执行上述检查。Node.js 只属于可选 CI harness，不进入应用加载链，不引入 npm 包、构建产物或最终用户运行要求。

## 修改准则

- 新的纯算法优先放在独立模块并增加浏览器测试。
- 用户数据只使用 `textContent` 或属性 API 渲染。
- 新的远端提供商实现放入 `sync/providers.js`，凭据生命周期由 `coordinator.js` 管理。
- schema 变更必须递增 `DB_VERSION` 并增加迁移测试。
- 同步协议变化必须兼容旧远端格式或明确提供迁移路径。
- 修改脚本后同步更新 `index.html` 和兼容加载器中的缓存版本。
