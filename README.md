# Sheetwise · 学习与考试 Cheatsheet

根据用户的复习目标与文档，提炼可以编辑、核对出处和打印的复习速查表。

网页入口：[GitHub Pages](https://dns0129.github.io/Make_Your_CheatSheet/)。GitHub Pages 版提供原文提炼、资料上传、编辑和导出，所有资料在浏览器内处理。

[Pi 云端版](https://sheetwise-study.dennis20070129.chatgpt.site)提供服务端 Pi 生成接口，需要站点拥有者登录以及完成 GPT 订阅授权。当前订阅 OAuth 换票尚未完成，AI 生成暂未启用。

## 第一版功能

- 添加文字版 PDF、DOCX、TXT、Markdown，或直接粘贴学习资料。
- 填写复习目标与关键词，选择覆盖全篇或仅保留关键词匹配内容。
- 将原文条目归入核心知识、公式与定理、解题步骤、易错提醒。
- 精简、标准、详细分别最多保留 16、28、44 条；每种所选类型保留一定数量，再按匹配度补足。
- 对照引用原句，保留 PDF 原始页码与提取文本行号；数学上标、下标不做兼容归一化。
- 编辑、删除条目，切换单栏、双栏、三栏，导出 Markdown，通过 A4 打印另存为 PDF。
- 点击保存到本机可保存一个生成结果；引用原句随结果保存，原始文件不保存。
- 提供可直接试用的概率论示例。

## 实现与边界

原文提炼模式采用原文提取、规则分类和关键词排序。Pi 智能整理模式通过 Pi Agent 使用 `openai/gpt-6.1-sol` 与 `medium` 推理，账号必须使用 ChatGPT 订阅 OAuth 授权，不能用 API key 自动替代。

文档解析和原文提炼在浏览器运行。选择 Pi 智能整理时，资料与复习目标发送到服务端与 GPT；服务不保存学习资料、提示或生成结果。模型输出必须有真实证据 ID，引用原句和页码由服务端从资料映射，模型不能自由编造引用。所有用户文字通过 DOM `textContent` 渲染。解析库随站点打包，不依赖运行时 CDN。

最多 8 个文件，单个 10 MB，单份 30 万字符、全部合计 50 万字符，PDF 最多 150 页。扫描 PDF 需要先 OCR；图片、复杂表格、复杂数学排版不保证完整提取，应对照原文核对。A4 打印页数取决于内容长度与浏览器设置，不承诺压缩为一页。

## 本地运行

需要 Node.js 24.5+ 和 Python 3。浏览器源文件位于 `dist/`。仅原文提炼可直接用静态服务器运行；完整 Pi 功能用 Node 服务运行：

```bash
npm ci
npm run pi:login
npm start
```

`pi:login` 使用 Pi 官方的 Sign in with ChatGPT OAuth 流程，请允许使用订阅额度。远程环境回调无法自动送达时，将最终回调 URL 粘贴进登录终端。凭据只保存到被 Git 忽略的 `.sites-runtime/pi/auth.json`，目录权限为 0700。`npm run pi:status` 只打印模型、推理级别及登录状态，不输出凭据。

网络必须允许 `auth.openai.com` 与 `api.openai.com`。命令使用 Node 的 `--use-env-proxy` 保留环境代理和 CA 信任；网络规则阻断时不会尝试绕过代理。云环境配置更新需要在新任务中使用已重新发布的环境。

```bash
python3 -m http.server 4173 --bind 127.0.0.1 --directory dist
```

打开 `http://127.0.0.1:4173`。不要用 `file://` 打开；浏览器模块与 PDF worker 需要 HTTP。

更新解析库时：

```bash
npm ci
npm run vendor
```

测试与语法检查：

```bash
npm test
node --check dist/app.mjs
node --check dist/parser.mjs
```

解析器版本固定为 pdfjs-dist 4.10.38 与 mammoth 1.11.0。第三方许可证位于 `dist/vendor/`。

## 云端托管

### GitHub Pages

`.github/workflows/pages.yml` 在推送 `main` 时运行测试、打包静态网页并部署到 Pages。首次启用需在仓库 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**。

```bash
npm run build:pages
```

产物位于 `.sites-runtime/pages/`。仅浏览器资源会发布，Node/Worker 代码与账户凭据不进入 Pages 产物。Pages 使用项目子目录，所有解析器与模块使用相对资源路径。Pi 选项在 Pages 中禁用，并提供云端版入口。

### Sites Worker

`.openai/hosting.json` 记录原站点 ID 和 `BUCKET` 绑定。`npm run build` 将界面、解析器、Pi Agent 和 Pi OpenAI provider 打包成 Sites Worker；访问保留原私有权限。站点源码与部署包保持同一提交。`server/` 是用于账户授权和本地开发的 Pi Coding Agent SDK 服务，线上使用 Pi Agent Core。

云端需要通过 Sites 的秘密变量配置 `PI_CHATGPT_OAUTH`（Pi 授权返回的完整 OAuth 凭据）和 `PI_AUTH_ENCRYPTION_KEY`（32 字节随机 AES 密钥的十六进制表示）。这些值不得写入源码、浏览器或托管清单。初始凭据由平台秘密变量注入，后续刷新结果通过 AES-GCM 加密保存在 R2；刷新使用条件写入的租约锁，避免多实例同时刷新并丢失轮换凭据。当前账户授权若未完成，AI 选项保持禁用。

AI 输入合计最多 6 万字符、600 个可引用条目；输出条目最多 16 / 28 / 44 个。每次生成最多 150 秒，支持取消；没有外部工具执行权限，也没有自动反复请求模型的重试循环。OAuth 和额度检查、真实模型生成需要连通的运行环境及本人订阅授权，测试夹具不代表真实模型调用成功。
