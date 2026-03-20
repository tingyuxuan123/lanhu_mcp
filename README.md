# Lanhu MCP

用于从蓝湖设计页获取最新版本 `json_url`，解析 Sketch JSON，并输出适合页面还原的结构化数据。

当前仓库同时包含两部分能力：

- MCP Server：给 Claude Code / 其他 MCP Client 提供蓝湖解析工具
- 本地验证脚本：把解析结果渲染成 HTML，再和参考图做自动对比

## 当前状态

截至 2026-03-20，仓库内这条真实蓝湖样例链路已经验证通过：

- 页面 URL 会解析出 `project_id`、`image_id`
- 当 URL 里没有 `team_id` 时，会自动请求 `/api/account/user_settings?settings_type=web_main` 解析当前团队
- 会自动取 `versions[0]` 对应的最新 `json_url`
- 会生成 HTML、截图、diff 图和对比元数据

当前 HTML 生成器的输出特性：

- 样式集中写入 `<style>`，不再使用内联 `style=""`
- class 名按语义前缀生成，例如 `root-flow-row-*`、`status-bar-*`、`text-layer-*`
- 优先使用 flex / 盒模型排版
- 对纯文本容器尽量不强写宽高
- 当前真实样例输出中 `position:absolute = 0`、`position:relative = 0`

## 安装

```bash
npm install
npm run build
```

## 可用脚本

```bash
npm run build
npm run test
npm run validate:sample
npm run render:lanhu
npm run restore:loop
```

说明：

- `npm run test`：编译并执行 `tests/*.test.mjs`
- `npm run validate:sample`：基于仓库内 `tmp_sample.json` 和 `tmp_sample.png` 跑本地还原验证
- `npm run render:lanhu`：和 `validate:sample` 使用同一个渲染脚本，但通常配合环境变量跑真实蓝湖页面
- `npm run restore:loop`：循环执行蓝湖还原流程，便于连续调试

## MCP 工具

Server 启动后会注册以下工具：

- `lanhu_fetch_design`
  - 输入蓝湖页面 URL
  - 返回设计元数据、最新版本信息、`json_url`、`image_url`

- `lanhu_prepare_restoration`
  - 输入蓝湖页面 URL
  - 直接返回完整还原 bundle
  - 包含 `artboard`、`layers`、`restoration`、`assets`、`tokens`、`renderHints`

- `lanhu_parse_sketch`
  - 输入 `json_url`
  - 返回标准化后的图层树和还原计划
  - 支持 `output_format=css|tailwind|react|vue`

- `lanhu_compare_images`
  - 对比候选图和参考图
  - 输出差异百分比、热点区域、建议、diff 图路径

- `lanhu_set_cookie`
  - 设置默认 Cookie，后续工具调用可不重复传

## 启动 MCP Server

```bash
npm run build
node dist/index.js
```

也可以在 MCP Client 配置中接入：

```json
{
  "mcpServers": {
    "lanhu": {
      "command": "node",
      "args": ["D:/project/lanhu_mcp/dist/index.js"],
      "env": {
        "LANHU_COOKIE": "your-cookie"
      }
    }
  }
}
```

## Cookie 说明

真实蓝湖页面接口依赖登录态。Cookie 可以通过两种方式提供：

- 环境变量 `LANHU_COOKIE`
- MCP 工具 `lanhu_set_cookie`

建议：

- 只在本地环境变量或 MCP 会话里传递
- 不要把 Cookie 写入代码库
- 不要把 Cookie 提交到 issue、日志或截图里

## 蓝湖 URL 解析逻辑

支持类似下面的页面地址：

```text
https://lanhuapp.com/web/#/item/project/detailDetach?pid=...&project_id=...&image_id=...&fromEditor=true
```

解析逻辑：

1. 从 hash query 中提取 `pid/project_id` 和 `image_id`
2. 如果 URL 缺少 `tid/team_id`，自动请求：

```text
https://lanhuapp.com/api/account/user_settings?settings_type=web_main
```

3. 从返回的 `teamStatus.team_id` 中补齐团队 ID
4. 请求：

```text
https://lanhuapp.com/api/project/image?dds_status=1&image_id=...&project_id=...&team_id=...
```

5. 从 `result.versions[0].json_url` 获取最新设计 JSON
6. 从 `result.url` 或 `versions[0].url` 获取参考图

## 本地还原验证

核心脚本：

- [scripts/validate-sample-restoration.mjs](/D:/project/lanhu_mcp/scripts/validate-sample-restoration.mjs)

它支持三种输入模式：

### 1. 本地样例

默认使用仓库根目录下：

- `tmp_sample.json`
- `tmp_sample.png`

直接执行：

```bash
npm run validate:sample
```

### 2. 直接输入 json_url

```bash
set LANHU_JSON_URL=https://...
set LANHU_REFERENCE_IMAGE_URL=https://...
node scripts/validate-sample-restoration.mjs
```

### 3. 真实蓝湖页面 URL

```bash
set LANHU_PAGE_URL=https://lanhuapp.com/web/#/item/project/detailDetach?pid=...&project_id=...&image_id=...
set LANHU_COOKIE=your-cookie
node scripts/validate-sample-restoration.mjs
```

常用环境变量：

- `LANHU_PAGE_URL`
- `LANHU_COOKIE`
- `LANHU_JSON_URL`
- `LANHU_REFERENCE_IMAGE_URL`
- `LANHU_OUTPUT_DIR`
- `RESTORATION_OUTPUT_PREFIX`
- `SAMPLE_JSON_PATH`
- `SAMPLE_REFERENCE_PATH`
- `SAMPLE_STATUS_TIME`
- `SAMPLE_STATUS_APP`

## 输出产物

验证脚本会输出：

- `*.html`：还原后的 HTML
- `*.png`：HTML 截图
- `*-diff.png`：候选图和参考图的差异热力图
- `*-meta.json`：对比结果、文件路径、参考图信息
- `*-bundle.json`：解析后的 artboard / layers / restoration bundle

默认输出目录：

- 本地样例：`artifacts/sample-validation`
- 蓝湖页面：`artifacts/lanhu-restoration`

## HTML 生成策略

当前渲染器是“保真优先，但尽量不用定位”的策略：

- 根节点优先拆成背景层和内容层
- 内容层优先转成 flow row，再用 margin / padding 排版
- 已识别的行列容器优先走 flex
- 图标和矢量优先保留 shape / path 信息
- 遮罩关系使用 `maskGroups` 和 `clip` 信息还原
- 仍需保真的复杂图形，使用 `clip-path:path(...)`

当前样式输出策略：

- 所有动态样式统一注册到 `<style>`
- DOM 上只保留 class，不写内联 `style`
- class 名会按用途生成前缀，例如：
  - `root-background-layer-*`
  - `root-content-layer-*`
  - `root-flow-row-*`
  - `status-bar-*`
  - `text-layer-*`
  - `container-layer-*`
  - `shape-layer-*`

## 已验证结果

### 真实蓝湖样例

使用页面：

```text
https://lanhuapp.com/web/#/item/project/detailDetach?pid=99c9fbd1-d50d-41f8-a8c0-7ab825b0570e&project_id=99c9fbd1-d50d-41f8-a8c0-7ab825b0570e&image_id=a22621e1-2b15-4e09-9856-a5fadd06977d&fromEditor=true
```

2026-03-20 实测结果：

- 最新版本：`版本4`
- 输出文件：[a22621e1.html](/D:/project/lanhu_mcp/artifacts/example-a22621e1/a22621e1.html)
- 视觉相似度：`97.70`
- `style=""` 数量：`0`
- `position:absolute` 数量：`0`
- `position:relative` 数量：`0`

### 本地样例

使用：

- [tmp_sample.json](/D:/project/lanhu_mcp/tmp_sample.json)
- [tmp_sample.png](/D:/project/lanhu_mcp/tmp_sample.png)

当前基线结果：

- 输出文件：[sample-restoration.html](/D:/project/lanhu_mcp/artifacts/sample-validation/sample-restoration.html)
- 视觉相似度：`90.03`

## 目录结构

```text
lanhu_mcp/
├─ src/
│  ├─ config/
│  │  └─ cookie-manager.ts
│  ├─ services/
│  │  ├─ image-compare.ts
│  │  ├─ lanhu-client.ts
│  │  ├─ lanhu-parser.ts
│  │  └─ style-extractor.ts
│  ├─ tools/
│  │  ├─ compare-images.ts
│  │  ├─ fetch-design.ts
│  │  ├─ parse-sketch.ts
│  │  ├─ prepare-restoration.ts
│  │  └─ set-cookie.ts
│  ├─ utils/
│  │  ├─ error.ts
│  │  ├─ logger.ts
│  │  └─ url-parser.ts
│  ├─ index.ts
│  └─ server.ts
├─ scripts/
│  ├─ run-lanhu-loop.mjs
│  └─ validate-sample-restoration.mjs
├─ tests/
│  ├─ lanhu-client.test.mjs
│  ├─ lanhu-parser.test.mjs
│  └─ url-parser.test.mjs
├─ artifacts/
├─ tmp_sample.json
├─ tmp_sample.png
└─ README.md
```

## 开发建议

- 每次改解析逻辑后先跑 `npm run test`
- 渲染逻辑改动后，再跑一次 `npm run validate:sample`
- 调整真实案例时，同时关注：
  - 圆角是否丢失
  - 渐变角度是否正确
  - 图标是否缺失
  - 是否又引入了 `absolute/relative`
  - 文本容器是否被写死宽高

## MCP asset localization

`lanhu_prepare_restoration` and `lanhu_parse_sketch` now support local asset export:

- `download_assets`
  - default: `true`
  - when enabled, remote Lanhu image URLs are downloaded locally and `assetUrl` is rewritten to the local public path

- `asset_output_dir`
  - optional local directory for downloaded asset files

- `asset_public_path`
  - optional public path prefix written back into `assetUrl` / `localAssetPath`

When asset localization is enabled, response payloads also include:

- `localizedAssets`
  - downloaded file manifest
  - content hash, local path, source URL, failure list

- `remoteAssetUrl`
  - original Lanhu asset URL kept on each layer / asset node

- `localAssetPath`
  - local public path used by generated HTML / CSS / code output

- `localAssetFilePath`
  - absolute local file path on disk

## License

MIT
