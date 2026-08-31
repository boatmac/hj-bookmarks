# HJ Bookmarks · Azure Blob 同步

HJ Bookmarks 可以把现有加密同步 payload 保存为单个 Azure Block Blob，不需要 Azure SDK、自建 API 或应用后端。浏览器直接调用 Azure Blob REST API；书签、回收站和设备名称仍在本机使用 AES-256-GCM 加密后上传。

## 支持范围

当前自动识别以下官方 Blob 数据平面域名：

- 全球 Azure：`{account}.blob.core.windows.net`
- 世纪互联运营的 Azure 中国区：`{account}.blob.core.chinacloudapi.cn`

公开文档和测试只使用合成账号：

```text
https://exampleaccount.blob.core.windows.net/example-container/
https://exampleaccount.blob.core.chinacloudapi.cn/example-container/
```

可以填写容器地址、虚拟目录地址或完整 `.json` Blob 地址。地址未以 `.json` 结尾时，应用会追加固定文件名 `bookmarks-sync.enc.json`。只支持 HTTPS；暂不自动识别自定义域名、Azurite、Azure Government 或 Data Lake `dfs` 端点。

## SAS 凭据

应用使用 SAS Token 直接授权 Blob REST 请求。不要把 Storage Account Key、Client Secret 或永久云访问密钥放入浏览器。

建议 SAS 最小权限：

- `r`：读取现有加密 Blob；
- `c`：首次创建 Blob；
- `w`：条件覆盖更新 Blob。

固定 Blob 不需要列表和删除权限。容器必须由管理员预先创建，HJ Bookmarks 不会创建或删除容器。

设置页把 Blob URL 与 SAS Token 分开处理：

- Blob URL 会作为必要连接位置保存在本机 IndexedDB；
- SAS Token 默认只保存在当前页面内存；
- 用户明确开启“刷新时保留凭据”后，Token 才会临时进入 `sessionStorage`；
- Token 不进入长期设置、书签导出、备份、远端加密文件、日志或公开文档。

如果粘贴完整 SAS URL，应用会立即在本机移除 URL 查询参数，把它们转入密码类型的 SAS 输入框。连接信息评审只显示不含 SAS 的基础地址。

Microsoft 推荐优先使用 User Delegation SAS，但对应委派密钥的起止时间必须在当前时间七天内；没有 Token 签发后端的纯静态应用需要手动更新。长期使用也可以由管理员在应用之外生成关联 Stored Access Policy 的 Service SAS，以便撤销和轮换。无论哪种方式，SAS 都是持有者凭据，泄露后应立即撤销或更换。

## Blob 服务 CORS

Azure Storage CORS 是浏览器访问许可，不是身份验证。容器仍应禁止匿名访问，所有数据请求仍需有效 SAS。

仅使用线上版本时，建议把 Allowed Origins 限制为实际 Origin。例如官方 Pages 的 Origin 是：

```text
https://boatmac.github.io
```

Origin 不包含 `/hj-bookmarks/` 路径。如果同时要求直接从 `file://` 使用，通常需要 `*` 允许特殊本地 Origin；此时必须使用 `credentials: omit`、最小权限 SAS 和 HTTPS，并完成真实浏览器验证。

建议 Blob 服务 CORS 至少允许：

```text
Methods:
GET, HEAD, PUT, OPTIONS

Allowed headers:
cache-control
content-type
if-match
if-none-match
pragma
x-ms-blob-type
x-ms-date
x-ms-version

Exposed headers:
etag
last-modified
content-length
x-ms-version-id
x-ms-request-id
```

如果浏览器无法读取 `ETag`，应用会停止同步并提示补充 Exposed Headers，而不是在缺少并发保护时继续覆盖。

## 并发与恢复

适配器复用现有三方合并流程：

1. `HEAD` 读取 ETag，轻量检查远端变化；
2. `GET` 下载并解密当前 Blob；
3. 首次写入使用 `If-None-Match: *`；
4. 后续 `PUT Blob` 使用 `If-Match: <ETag>` 和 `x-ms-blob-type: BlockBlob`；
5. HTTP `412` 视为并发更新，重新读取、合并并重试；
6. 合并成功后更新本机 IndexedDB 与同步基线。

建议在 Azure 侧启用 Blob Versioning、Blob Soft Delete 和 Container Soft Delete，并通过生命周期策略清理旧版本。每次同步写入都可能生成新版本；Azure 版本保护是额外恢复层，不能替代 HJ Bookmarks 的本地历史备份。

## 安全操作

- 不要在 Issue、截图、日志或聊天中提交实际账号、容器、Blob 地址或 SAS；
- 每位成员可以使用独立 SAS，以便单独撤销；
- SAS 过期、权限不足和容器不存在会显示通用错误，不回显 Token 或私人路径；
- 真实连接测试应由用户在自己的浏览器中完成；项目测试只使用合成 URL 和模拟 HTTP 响应。

相关官方文档：

- [Azure Storage CORS](https://learn.microsoft.com/rest/api/storageservices/cross-origin-resource-sharing--cors--support-for-the-azure-storage-services)
- [Azure Storage SAS overview](https://learn.microsoft.com/azure/storage/common/storage-sas-overview)
- [Put Blob REST API](https://learn.microsoft.com/rest/api/storageservices/put-blob)
- [Blob versioning](https://learn.microsoft.com/azure/storage/blobs/versioning-overview)
