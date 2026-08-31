# HJ Bookmarks 部署与便携包

本文说明如何在不改变零构建运行方式的前提下发布线上版本，并通过 GitHub Actions 生成可下载的本地便携包。

## 部署产物

`scripts/prepare-static-package.mjs` 只复制运行和页面帮助需要的文件：

```text
{repository-name}-portable/
├── index.html
├── css/
├── js/
├── README.md
├── LICENSE
├── docs/
├── tests/
│   ├── index.html
│   ├── styles.css
│   └── test-runner.js
├── BUILD-INFO.txt
└── .nojekyll
```

不会包含 `.git`、`.github`、临时文件或 CI Node.js 脚本。解压后直接双击 `index.html` 即可使用；`tests/index.html` 仍可直接运行浏览器测试。

本地维护者如安装了 Node.js 22，可选择生成同样的目录：

```bash
node scripts/prepare-static-package.mjs dist/site
```

这只是文件筛选与复制，不转译、不压缩应用代码，也不产生运行时依赖。

## GitHub Actions 行为

`.github/workflows/browser-tests.yml` 在测试通过后执行以下动作：

1. 为每次 push、Pull Request 或手动运行生成 `{repository-name}-portable.zip`；
2. 生成对应的 `.zip.sha256`；
3. 将两者上传为保留 14 天的 Actions Artifact；
4. `main` 分支成功时发布同一套静态文件到 GitHub Pages；
5. 推送 `v*` 标签时创建或更新 GitHub Release，并附加 ZIP 和校验文件。

包名使用 GitHub 当前仓库名动态生成，未来重命名仓库后不需要修改工作流。

### Actions Artifact 与 Release 的区别

- **Actions Artifact**：每次测试都会生成，适合开发验证；通常需要登录 GitHub，且会按保留期自动清理。
- **GitHub Release Asset**：由版本标签触发，适合最终用户公开、长期下载。

## 首次启用 GitHub Pages

将仓库推送到 GitHub 后：

1. 打开仓库的 **Settings → Pages**；
2. 在 **Build and deployment** 中选择 **GitHub Actions**；
3. 打开 **Actions**，手动运行 `Test, package, and publish`，或向 `main` 推送一次提交；
4. `Deploy GitHub Pages` job 完成后，从 job 的 environment URL 打开网站。

GitHub Pages 默认项目地址通常类似：

```text
https://{account}.github.io/{repository}/
```

应用全部使用相对资源路径，可以部署在仓库子路径下。

## 创建可下载版本

项目确定一个版本号后创建标签：

```bash
git tag v0.1.0
git push origin v0.1.0
```

测试全部通过后，工作流会创建 `v0.1.0` Release，并附加：

```text
{repository-name}-portable.zip
{repository-name}-portable.zip.sha256
```

用户下载 ZIP、解压，然后双击其中的 `index.html` 即可。

### 校验下载文件

Linux/macOS 或 Git Bash：

```bash
sha256sum -c {repository-name}-portable.zip.sha256
```

Windows PowerShell：

```powershell
Get-FileHash .\{repository-name}-portable.zip -Algorithm SHA256
Get-Content .\{repository-name}-portable.zip.sha256
```

比较两边 SHA-256 值是否相同。

## 其他静态平台

当前应用无需改造即可部署到其他静态托管服务，平台专用的一键配置可以后续补充。

### Cloudflare Pages

连接 GitHub 仓库时可使用：

```text
Framework preset: None
Build command: exit 0
Build output directory: .
```

也可以上传 Actions 生成的便携目录。官方参考：<https://developers.cloudflare.com/pages/framework-guides/deploy-anything/>。

### Netlify

可以连接仓库并将发布目录设为 `.`，或直接拖放解压后的便携目录。公开仓库未来还可以加入 Deploy to Netlify 按钮。官方参考：<https://docs.netlify.com/deploy/create-deploys/>。

### Azure Static Web Apps

应用是纯前端，可使用 Azure Static Web Apps 的预构建前端模式并设置 `skip_app_build: true`。当前仓库尚未加入 Azure 资源与凭据配置；正式接入时应单独生成部署计划和验证工作流。官方参考：<https://learn.microsoft.com/azure/static-web-apps/faq>。

## 从本地版迁移到线上版

`file://` 与 HTTPS 网站属于不同浏览器数据空间。首次打开线上地址时，原本地 IndexedDB 不会自动出现。可以使用：

1. 本地版导出 JSON，线上版再导入；
2. 线上版重新选择原备份目录并恢复；
3. 两边配置相同的加密同步位置和口令。

不同托管域名和自定义域名也分别拥有独立的数据空间。稳定使用后，建议尽早确定主域名，迁移域名之前先创建备份。

## 浏览器与同步注意事项

- 自动目录备份及本地同步目录仍要求支持 File System Access API 的 Edge 或 Chrome；
- HTTPS 托管满足安全上下文要求，但不会扩大 Firefox/Safari 的目录 API 能力；
- 标准 WebDAV 服务必须允许线上站点的 Origin、请求方法和请求头；
- 从 `file://` 迁移到 HTTPS 后，Origin 从 `null` 变为实际网站地址，应重新验证 WebDAV CORS；
- 远端更新检查需要允许 `If-None-Match` 请求头并向浏览器暴露 `ETag`；未暴露 ETag 时会退回密文内容 hash 比较；
- 静态托管平台只分发应用文件，书签内容不会因为部署而自动上传到托管平台；
- 备份口令、同步密码和加密口令不得写入工作流、仓库或构建产物。

## 仓库重命名

仓库重命名后：

- 工作流和便携包名称会自动使用新仓库名；
- GitHub Pages 默认 URL 会改变；
- Release、提交历史和 Actions 配置继续保留；
- 需要更新本地 `origin`、README 外部链接、Pages 地址和任何部署按钮；
- 应继续保留 IndexedDB 名称、备份格式和同步协议中的内部兼容标识。
