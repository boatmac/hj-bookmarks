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
│   ├── storage.js       IndexedDB schema 与事务操作
│   └── utils.js         URL、层级、日期和 DOM 通用工具
├── data/
│   └── transfer.js      JSON/HTML 导入导出和清空流程
├── sync/
│   ├── backup.js        File System Access 自动备份
│   ├── coordinator.js   同步生命周期、凭据和冲突中心
│   ├── providers.js     标准 WebDAV 与 Koofr Adapter
│   ├── crypto.js        PBKDF2 + AES-GCM
│   └── merge.js         数据集规范化、三方合并与本地应用
├── ui/
│   ├── render.js        导航、文件夹和书签卡片渲染
│   ├── bookmarks.js     表单、拖拽和书签交互
│   └── recovery.js      回收站渲染、恢复与永久清除
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
- `state.persistence`：浏览器持久存储状态。

长期数据必须通过 `storage.js` 写入 IndexedDB。密码和加密口令不得进入长期设置。

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

## 修改准则

- 新的纯算法优先放在独立模块并增加浏览器测试。
- 用户数据只使用 `textContent` 或属性 API 渲染。
- 新的远端提供商实现放入 `sync/providers.js`，凭据生命周期由 `coordinator.js` 管理。
- schema 变更必须递增 `DB_VERSION` 并增加迁移测试。
- 同步协议变化必须兼容旧远端格式或明确提供迁移路径。
- 修改脚本后同步更新 `index.html` 和兼容加载器中的缓存版本。
