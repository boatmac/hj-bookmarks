# 同步与备份设计

本文面向项目维护者，记录同步协议、提供商适配、浏览器安全边界和冲突处理策略。最终用户界面不展示本文件中的协议细节。

## 设计目标

- 保持零构建、零 Node.js 运行依赖。
- 支持从 `file://` 直接运行。
- 所有远端内容在上传前完成客户端加密，本地目录备份可选择加密。
- 凭据不写入源码、长期设置、远端文件或备份文件。
- 网络失败不得冻结书签浏览界面。
- 检测到语义冲突时不静默覆盖任何一侧。
- 本地备份与远端同步相互独立。

## 组件

```text
UI
├── IndexedDB 本地书签
├── 可选 AES-GCM 加密的本地目录备份
├── 同步设置向导（只选择远端同步或本地目录）
├── 同步协调器
│   ├── LocalFolder Adapter
│   ├── Remote Version Watcher
│   └── Remote Adapter Resolver
│       ├── 标准 WebDAV Adapter
│       └── Koofr REST Compatibility Adapter
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

向导不把 Koofr、Nextcloud 或 NAS 暴露为并列的用户同步类型。用户只选择远端同步或本地目录；远端 Resolver 根据用户填写的地址和服务能力选择兼容 Adapter。服务名称、CORS、Mount ID、REST 路径和条件写入令牌均属于适配层实现细节，仅在维护文档或高级错误诊断中出现。

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
  "tombstones": [],
  "devices": [
    {
      "deviceId": "uuid",
      "name": "Design team laptop",
      "updatedAt": "ISO-8601"
    }
  ]
}
```

`devices` 是 payload v2 的可选兼容字段。设备名称按 `deviceId` 合并，并以名称的 `updatedAt` 选择较新版本；旧客户端忽略或移除它时，新客户端会从同步基线和本机身份重新补回。它只是加密后的友好显示元数据，不是成员身份、权限或认证凭据。

加密口令使用 NFKC 规范化后进入 PBKDF2。每次上传生成新的随机 salt 和 96-bit GCM IV。

可选加密备份使用独立信封：

```json
{
  "format": "bookmark-manager-encrypted-backup",
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

`cipher.data` 解密后是完整的 `bookmark-manager` v2 备份 payload。信封不保存标题、URL、标签、项目数或导出时间；历史文件名仍会暴露快照时间。每个文件使用独立随机 salt 和 96-bit GCM IV。

## 凭据边界

长期保存在 IndexedDB：

- 同步地址
- 用户名
- 自动同步设置
- 最近同步时间
- Koofr Mount ID、名称及所属用户名（非敏感缓存）

默认只保存在 JavaScript 内存：

- WebDAV/Koofr 密码或应用密码
- 同步加密口令
- 可选的本地备份加密口令
- 恢复加密快照时临时输入的口令

同步与备份使用相互独立的口令和 `sessionStorage` key。用户明确开启“刷新本标签页时保留”后，对应敏感值才写入当前标签页会话；恢复向导还要求口令至少成功解密一份快照后才可写入。恢复时同时检查 Navigation Timing：

- `reload`：允许恢复；
- `navigate`：先删除再保持锁定；
- `back_forward`：先删除再保持锁定；
- 无法识别导航类型：按非刷新处理。

取消选项、关闭备份加密或移除对应配置时立即删除；不写入 IndexedDB 或 localStorage。备份长期设置仅包含 `encryptionEnabled` 与随机 `encryptionProfileId`，会话口令必须与该 ID 匹配。这样即使浏览器复用了 sessionStorage，普通重新打开和会话恢复也不会自动解锁。

## 本地云盘目录 Adapter

本地目录模式使用 File System Access API，将用户选择的 OneDrive、Google Drive、Dropbox 或 Syncthing 本地目录作为传输层：

```text
selected-folder/
└── devices/
    └── {deviceId}.enc.json
```

每台设备只写以自身稳定设备 ID 命名的文件，避免云盘客户端对同一个文件执行最后写入覆盖。同步时枚举 `devices` 中所有 `.enc.json`，逐个解密并聚合，再使用与远端同步相同的基线三方合并和冲突中心。

触发条件：

- 本机数据变化后 1.8 秒防抖；
- 页面可见时每 15 秒轮询文件名、大小和 `lastModified`；
- `visibilitychange` 回到前台；
- 用户点击“立即同步”。

如果目录签名和本地数据 hash 都未改变，后台轮询不会重复解密或写入。目录句柄存储于 IndexedDB；浏览器重启后可能需要用户重新授权。加密口令遵守同一 sessionStorage 策略。

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

单次请求内部不立即循环重试，避免在持有数据写锁时长时间等待。自动同步遇到超时、网络中断、HTTP 408/425/429 或常见 5xx 时，会先释放写锁，再按 5 秒、15 秒、45 秒、2 分钟和最多 5 分钟的间隔渐进重试；手动同步仍立即返回错误并由用户决定是否重试。

Koofr 上传使用 multipart/form-data，并在覆盖时传递 `overwriteIfHash` 和 `overwriteIfModified`。HTTP 409 视为并发冲突并重新读取。

## 加入共享书签库

普通设置向导既可创建新的远端同步文件，也可连接已有位置；专用“加入共享书签库”意图只接受远端 WebDAV，并要求目标同步文件已经存在，避免地址填错后静默创建一个孤立的新库。它不预填当前远端地址或任何秘密，自动同步默认开启，成员需要填写自己的 WebDAV 凭据、共享加密口令和本机设备名称。

首次加入与普通同步使用同一个数据写锁和 `runWebDavSync`。本机已有项目时，验证步骤必须显式确认这些项目会参与首次合并；远端读取、AES-GCM 解密、基线建立、三方合并和条件 PUT 全部成功后才保存新配置。失败时恢复进入向导前的端点、设备注册表、凭据偏好和本地目录状态。该流程没有邀请账号或服务端成员表，访问控制仍由 WebDAV 目录权限与共享加密口令共同承担。

## 共享库远端版本检查

远端模式在自动同步已开启、凭据已解锁、页面可见且无冲突时，每 60 秒执行一次只读版本检查。窗口重新获得焦点、页面从后台恢复或浏览器重新联网时会提前检查；页面隐藏、离线、凭据锁定或存在冲突时不轮询。

标准 WebDAV 使用带 `If-None-Match` 的条件 GET：服务返回 `304` 时不读取响应体；没有可用 ETag 或服务忽略条件请求时，只计算加密信封文本 hash，不执行 PBKDF2 解密。Koofr 只调用 `files/info` 获取远端 hash、修改时间和大小。版本相同不会进入数据写锁，也不会上传新密文；只有版本变化才调用既有 `runWebDavSync`，继续使用三方合并、墓碑、冲突中心和条件写入。

成功写入后，标准 WebDAV 从 PUT 响应记录 ETag 和本次密文 hash；Koofr 再读取一次轻量文件信息。非敏感版本摘要和最近检查时间保存在同步偏好中。多个同源标签页使用短时 Web Lock、BroadcastChannel 及 localStorage 检查时间共享结果，避免同时高频访问同一个远端。

探测遇到临时网络错误时使用 5 秒至 5 分钟的渐进重试，不弹出重复错误；认证或其他永久错误会停止轮询并要求用户重新处理。探测本身不会解密远端内容，因此损坏或错误口令仍在真正同步阶段由 AES-GCM 和 payload 校验拒绝。

## 网络生命周期

- 每个网络请求有 20 秒超时。
- 刷新恢复会话凭据后延迟 1.8 秒启动首次自动同步，避免与页面和网络初始化争用。
- 自动同步的暂时性网络错误进入非阻塞重试状态，不记录为永久失败，也不反复弹出通知。
- 浏览器恢复联网时会提前执行已排队的重试。
- 面向用户的错误只描述服务状态，不显示 REST 路径、Mount ID 等适配层信息；完整请求上下文仅保留在开发者控制台。
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
├── bookmarks-latest.json | bookmarks-latest.enc.json
├── history/
│   └── bookmarks-{timestamp}[.enc].json
└── emergency/
    └── bookmarks-before-restore-{timestamp}[.enc].json
```

支持 7、30、90 份历史快照，明文与加密文件统一计入保留数量。默认写明文；启用加密后，完整 payload 使用 PBKDF2-SHA-256（250,000 次）与 AES-256-GCM 加密。格式切换时先写入新的 latest 和 history 并完成读取验证，再删除另一格式的旧 latest；历史快照不立即迁移，之后按保留策略逐步清理。删除或清空前会先尝试刷新备份。该备份是恢复机制，不替代同步协议。

每次写入都会重新打开 latest 与本次 history 文件，执行原始文本一致性检查、JSON/加密信封解析、AES-GCM 解密及完整 payload 比对。只有两份文件都通过后才保存成功 hash。设置页显示最近验证时间、保护格式和历史文件数量，并允许手动检查；已验证状态会在 24 小时后安排只读复检。当前数据或加密配置改变时标记为待更新，缺失、格式不符、内容落后、损坏或权限失败时显示健康警告。旧历史可能使用不同口令，因此健康检查只计数旧历史，不尝试批量解密。

备份目录写入、健康检查和口令更换共享独立的跨标签页备份文件锁；取得锁后会重新读取持久化配置 ID，旧标签页检测到口令已在别处更换时会清除自身旧口令并停止。口令更换还持有数据写锁，确保转换期间当前书签快照不变化。

更换备份口令有两种范围。仅用于今后时，程序先把当前 latest 复制并验证为 history 快照，再以新口令强制写入当前数据。选择同时重新加密时，所有可由当前口令解开的 latest、history、emergency 以及明文快照都会先生成不同名称的新口令副本；新副本逐个通过写后解密验证，且整个预处理阶段不删除原件。随后创建新口令 latest，成功后才清理对应历史原件。口令更换过程本身不执行数量裁剪，避免新增安全副本把被跳过的旧快照立即挤出；下一次常规备份再按保留策略清理。无法使用当前口令读取的更旧快照不会猜测、覆盖或删除，用户仍需保留对应旧口令。电源中断时允许暂时保留重复快照，以恢复安全优先于目录整洁。

恢复向导扫描并校验最新、历史和紧急快照。明文文件立即完成内容校验；加密文件扫描时只校验信封并保持锁定，输入正确口令后才验证明文 payload。两种格式可以混合浏览，然后按稳定 `syncId` 计算新增、有差异、相同及当前独有项目。它支持安全合并、逐项选择恢复和完整替换：安全合并不覆盖当前修改；选择恢复只覆盖用户明确勾选的项目并自动补齐必要父文件夹；完整替换才会为当前独有项目写入墓碑。

任何模式开始写入 IndexedDB 前都必须先成功创建紧急备份，最多保留 10 份。当前自动备份设置为加密，或所选快照本身为加密时，紧急备份也使用对应口令加密。错误口令、损坏密文或紧急备份失败都在 IndexedDB 事务前终止。获取数据写锁后还会重新核对预览时的本地签名，避免其他标签页的最新修改被过期恢复计划覆盖。恢复项目统一更新 `updatedAt` 和 `modifiedBy`，因此之后的三方同步会将恢复识别为明确的本机修改，而不是让较新的远端状态静默覆盖恢复结果。

## 安全约束

- 不使用用户数据构造 `innerHTML`。
- 拒绝 `javascript:`、`data:` 等链接协议。
- 远端及加密备份的明文只存在于当前页面内存。
- Client Secret、永久云 Access Key 不得加入前端。
- HTTP Basic 只建议配合 HTTPS。
- 日志和错误信息不得输出 Authorization、密码、加密口令或完整令牌。
- 最终用户错误不得显示内部 API 路径、Mount ID 或条件写入参数。
