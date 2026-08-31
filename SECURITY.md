# Security Policy / 安全策略

HJ Bookmarks 是本地优先的纯静态应用，没有由项目维护者运营的账号系统、业务后端或书签数据库。用户数据保存在浏览器、用户选择的本地目录或用户自己的 WebDAV 服务中。

## Supported versions / 支持版本

| Version | Support status |
| --- | --- |
| Latest published release | Supported |
| Current `main` branch | Supported for verification |
| Older releases | Upgrade before reporting unless the issue prevents it |

发布修复时可能同时更新线上版本和便携包。涉及同步协议或数据格式的安全修复会在 Release Notes 中说明兼容要求。

## Report a vulnerability / 报告漏洞

**请勿使用公开 Issue 报告尚未修复的安全漏洞。** 使用 GitHub 的私密漏洞报告入口：

<https://github.com/boatmac/hj-bookmarks/security/advisories/new>

报告中建议包含：

- 受影响的版本、提交或线上地址；
- 浏览器、操作系统以及使用 `file://` 还是 HTTPS；
- 可使用合成测试数据重现的最小步骤；
- 可能造成的影响；
- 已做脱敏处理的截图、控制台错误或网络状态。

维护者会通过同一私密 Advisory 协调确认、修复和披露。普通功能缺陷可以使用公开 Bug Report 模板。

## Never include secrets / 不要提交秘密

无论私密报告还是公开 Issue，都不要提交真实的：

- WebDAV 密码或应用密码；
- `Authorization` 请求头、Cookie 或访问令牌；
- 同步或备份加密口令；
- 包含私人书签的明文备份；
- 可访问个人云盘的目录、分享链接或日志。

请使用临时测试账号、虚构 URL 和合成书签复现。若秘密已经进入 Issue、日志或截图，应立即在对应服务撤销或轮换，而不是只删除文本。

## Security scope / 安全范围

特别欢迎报告以下问题：

- 导入文件、书签字段或远端数据造成的脚本执行；
- 密码或加密口令被意外持久化、上传或输出；
- 加密信封验证、口令派生或随机数使用错误；
- WebDAV 条件写入、冲突处理或共享库边界导致的数据泄露；
- 恶意备份绕过 URL、层级或格式校验；
- 不需要用户确认即可跨书签库合并数据的路径。

第三方浏览器、WebDAV 服务、桌面云盘客户端和静态托管平台自身的漏洞，应同时报告给对应供应商。

## Cryptography notice / 加密说明

远端同步和可选本地备份使用浏览器 Web Crypto API 提供的 PBKDF2-SHA-256 与 AES-256-GCM。加密能保护文件内容，但不能替代可信设备、强口令、WebDAV 访问控制和可靠备份。本项目尚未经过独立密码学安全审计。
