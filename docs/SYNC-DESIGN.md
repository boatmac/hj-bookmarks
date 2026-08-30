# 同步与备份设计

本文面向项目维护者，记录同步协议、提供商适配、浏览器安全边界和冲突处理策略。最终用户界面不展示本文件中的协议细节。

## 设计目标

- 保持零构建、零 Node.js 运行依赖。
- 支持从 `file://` 直接运行。
- 所有远端内容在上传前完成客户端加密。
- 凭据不写入源码或远端文件。
- 网络失败不得冻结书签浏览界面。
- 检测到语义冲突时不静默覆盖任何一侧。
- 本地备份与远端同步相互独立。

## 组件

```text
UI
├── IndexedDB 本地书签
├── 自动本地目录备份
├── 同步协调器
│   ├── 标准 WebDAV Adapter
│   └── Koofr REST Adapter
├── PBKDF2 + AES-GCM 加密层
└── 三方合并与冲突中心
```

## 数据库

数据库名称继续使用 `BookmarkDB_v3` 以兼容早期版本；当前 schema version 为 7。

| Object Store | 用途 |
|---|---|
| `bookmarks` | 本地书签和文件夹 |
| `settings` | 非敏感设置、设备 ID、提供商缓存 |
| `tombstones` | 删除墓碑及 30 天可恢复快照 |
| `syncBaselines` | 每个同步端点的最近成功基线及待确认远端状态 |
| `syncConflicts` | 持久化的冲突记录 |

书签使用本地数字 ID 作为 IndexedDB 主键，同时使用稳定 `syncId` UUID 进行跨设备识别。

墓碑包含 `deletedAt`、`updatedAt`、`modifiedBy`，并可携带删除时的同步实体快照 `item`。快照用于回收站，30 天后或用户永久删除时移除；最小墓碑继续存在以阻止离线设备复活旧数据。墓碑快照包含在加密远端数据中，因此其他设备也可以恢复。

同步 payload v2 引入可恢复墓碑；读取端兼容 v1 和 v2，写入端统一升级到 v2。旧版客户端只接受 v1，因此会拒绝而不是静默移除 v2 的恢复数据。启用回收站后应升级所有参与同步的设备。

## 远端格式

远端只保存加密信封：

```json
{
  "format": "bookmark-manager-encrypted-sync",
  "version": 1,
  "kdf": {
    "name": "PBKDF2",
    "hash": "SHA-256",
    "iterations": 250000,
    "salt": "base64"
  },
  "cipher": {
    "name": "AES-GCM",
    "iv": "base64",
    "data": "base64"
  }
}
```

解密后的同步数据包含：

```json
{
  "format": "bookmark-manager-sync",
  "version": 2,
  "updatedAt": "ISO-8601",
  "items": [],
  "tombstones": []
}
```

加密口令使用 NFKC 规范化后进入 PBKDF2。每次上传生成新的随机 salt 和 96-bit GCM IV。

## 凭据边界

长期保存在 IndexedDB：

- 同步地址
- 用户名
- 自动同步设置
- 最近同步时间
- Koofr Mount ID、名称及所属用户名（非敏感缓存）

默认只保存在 JavaScript 内存：

- WebDAV/Koofr 密码或应用密码
- 加密口令

用户明确开启“刷新本标签页时保留凭据”后，上述两个敏感值写入 `sessionStorage`。恢复时同时检查 Navigation Timing：

- `reload`：允许恢复；
- `navigate`：先删除再保持锁定；
- `back_forward`：先删除再保持锁定；
- 无法识别导航类型：按非刷新处理。

取消选项或移除同步配置时立即删除；不写入 IndexedDB 或 localStorage。这样即使浏览器复用了 sessionStorage，普通重新打开和会话恢复也不会自动解锁。

## 标准 WebDAV Adapter

请求流程：

1. `GET` 读取同步文件；
2. 文件不存在且启用自动建目录时，对最后一级目录执行 `MKCOL`；
3. 使用 `PUT` 写入加密内容；
4. 若服务暴露 ETag，则使用 `If-Match` / `If-None-Match`；
5. `412` 表示并发写入，重新读取并合并，最多重试三轮。

WebDAV 服务的 CORS 最低要求：

```text
Methods: GET, PUT, MKCOL, OPTIONS
Request headers: Authorization, Content-Type, If-Match, If-None-Match
Response expose headers: ETag
Allowed origin: 实际 HTTPS origin；file:// 页面通常为 null
```

访问私有网络时，部分 Chromium 版本还可能要求：

```text
Access-Control-Allow-Private-Network: true
```

前端不能绕过服务端 CORS。

## Koofr REST Adapter

`app.koofr.net/dav/...` 地址只用于用户熟悉的路径表达，实际请求自动切换为 Koofr REST API，因为 Koofr WebDAV 的未认证 OPTIONS 返回 401，而 REST API 允许 `Origin: null`。

主要端点：

```text
GET  /api/v2/mounts
GET  /api/v2/mounts/{mountId}/files/info
POST /api/v2/mounts/{mountId}/files/folder
GET  /content/api/v2/mounts/{mountId}/files/get
POST /content/api/v2/mounts/{mountId}/files/put
```

路径 `/dav/{mountName}/path/to/file` 被解析为 Mount 名称和相对路径。首次成功查找后，Mount ID 会缓存到 IndexedDB；后续直接访问文件 API，不重复查询 Mount 列表。用户名变化或同步地址变化时缓存失效。

Mount 列表请求不自动循环重试。网络失败后由用户明确点击“立即同步”再次尝试，避免长时间不可控等待。

Koofr 上传使用 multipart/form-data，并在覆盖时传递 `overwriteIfHash` 和 `overwriteIfModified`。HTTP 409 视为并发冲突并重新读取。

## 网络生命周期

- 每个网络请求有 20 秒超时。
- 界面显示准备、读取、建目录、合并、加密、写入、应用等阶段。
- 用户可主动取消，AbortController 会终止当前请求。
- 后台同步不会将整个应用设为 inert。
- 同步完整生命周期持有跨标签页 Web Lock。
- `sync-start` 和心跳通过 BroadcastChannel/localStorage 回退通道通知其他标签页。
- 同步期间所有标签页的浏览、搜索、导航和打开链接保持可用。
- 新增、编辑、删除、拖拽、导入等变更操作暂时阻止，避免本地状态在合并期间改变。
- 同步应用结果后广播 `data-changed`，其他标签页自动刷新 IndexedDB 快照。

## 三方合并

每次成功同步后保存基线。下一次同步比较：

```text
Base  = 上次成功同步结果
Local = 当前 IndexedDB 状态
Remote = 当前解密后的远端状态
```

自动合并规则：

- 仅一侧变化：采用变化侧；
- 双方结果相同：采用较新的元数据；
- 不同字段变化：字段级合并；
- tags：逐标签三方集合合并；
- 删除与未修改：删除传播；
- 双方删除：保留较新的墓碑。

人工冲突：

- 同一标量字段被双方改成不同值；
- 删除与编辑并发；
- 文件夹被并发移动到不同父目录。

检测到人工冲突时：

1. 不覆盖远端；
2. 保存双方实体和待确认远端数据；
3. 在应用冲突中心展示；
4. 用户可保留本机、保留远端、逐字段选择或对书签保留两个副本；
5. 解决完成后将待确认远端状态提升为新基线；
6. 将用户决策作为新的本机修改重新同步。

冲突记录保存在 `syncConflicts`，刷新后不会丢失。

## 本地备份

自动备份使用 File System Access API：

```text
backup-directory/
├── bookmarks-latest.json
└── history/
    └── bookmarks-{timestamp}.json
```

支持 7、30、90 份历史快照。删除或清空前会先尝试刷新备份。该备份是恢复机制，不替代同步协议。

## 安全约束

- 不使用用户数据构造 `innerHTML`。
- 拒绝 `javascript:`、`data:` 等链接协议。
- 远端明文只存在于当前页面内存。
- Client Secret、永久云 Access Key 不得加入前端。
- HTTP Basic 只建议配合 HTTPS。
- 日志和错误信息不得输出 Authorization、密码、加密口令或完整令牌。
