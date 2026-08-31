# Changelog

HJ Bookmarks 的重要变更记录在此文件中。版本号遵循 [Semantic Versioning](https://semver.org/)，分类方式参考 [Keep a Changelog](https://keepachangelog.com/)。

## [Unreleased]

- 暂无。

## [1.0.0-rc.2] - 2026-08-31

隐私防泄漏与发布保护候选版本。

### Added

- 新增零依赖公开内容审计，覆盖当前文件、可达 Git 历史、Pages 和便携包。
- 新增可选 Git 提交/推送前审计 Hook，以及完整隐私与数据边界文档。
- 新增长期设置、标签页存储、协调摘要、导出文件和诊断脱敏浏览器测试。

### Changed

- 生产错误日志统一输出脱敏摘要，不再附带 URL、WebDAV 路径、本机用户目录、错误堆栈、底层 `cause` 或自定义请求目标。

### Security

- CI 会拒绝常见认证头、访问令牌、私钥、URL 内嵌凭据、私有网络地址、非示例远端地址和未包装的生产错误日志。

## [1.0.0-rc.1] - 2026-08-31

首个公开发布候选版本。

### Added

- 书签与多级文件夹的新增、编辑、拖拽、收藏、标签、搜索和排序。
- 中文与 English 自动识别和手动切换，以及深色、浅色响应式界面。
- 基于 IndexedDB 的本地优先持久化和浏览器持久存储请求。
- 浏览器书签 HTML 与完整 JSON 的双向导入导出。
- 自动本地目录备份、7/30/90 份历史快照、写后验证和健康检查。
- PBKDF2-SHA-256 与 AES-256-GCM 加密备份，以及安全的备份口令更换和历史重加密。
- 快照差异预览、安全合并、选择恢复、完整替换和恢复前紧急备份。
- 30 天回收站、批量恢复、永久清除和可同步删除墓碑。
- 标准 WebDAV 与 Koofr 兼容连接的加密双向同步。
- OneDrive、Google Drive、Dropbox 和 Syncthing 桌面目录的每设备加密文件同步。
- ETag/Hash 远端变化探测、前台恢复检查和多标签页请求节流。
- 稳定 UUID、同步基线、三方字段级合并和应用内冲突中心。
- Web Locks、BroadcastChannel 和同步心跳实现的多标签页协调。
- 友好设备名称与加密设备注册表。
- 可信小组“加入共享书签库”向导和现有远端验证。
- 单同步位置锁定，防止把地址变更误解为安全的工作区切换。
- 零 npm 依赖的静态检查、浏览器测试、便携 ZIP、SHA-256、GitHub Pages 和 Release 工作流。

### Security

- 密码和加密口令默认仅保存在内存；用户明确选择时仅允许在真正刷新当前标签页后恢复。
- 所有书签内容使用安全 DOM API 渲染，导入和恢复会拒绝危险 URL 与无效层级。
- 加入已有共享库时要求远端文件存在；本机非空时必须明确确认首次合并。
- 恢复、同步和备份写入失败时不会提前覆盖可恢复数据。

### Compatibility

- 继续保留 `BookmarkDB_v3`、`bookmark-manager.*`、备份格式和同步协议标识，避免品牌更新破坏已有数据。
- 生产脚本继续使用有序的经典 `<script defer>`，支持直接通过 `file://` 打开。

[Unreleased]: https://github.com/boatmac/hj-bookmarks/compare/v1.0.0-rc.2...HEAD
[1.0.0-rc.2]: https://github.com/boatmac/hj-bookmarks/releases/tag/v1.0.0-rc.2
[1.0.0-rc.1]: https://github.com/boatmac/hj-bookmarks/releases/tag/v1.0.0-rc.1
