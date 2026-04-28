# Lanhu MCP

蓝湖设计还原 MCP。

当前仓库现在支持两条交付链路：

- 输入蓝湖页面 URL 或 `json_url`
- 输出高保真 HTML 页面 + 图片资源
- 或直接输出静态 UniApp SFC + 图片资源

其中 HTML 交付物仍然适合下游二次重构；UniApp 工具则适合直接生成首版 `.vue` 页面骨架。

## 当前能力

当前默认暴露的 MCP 工具有 5 个：

- `lanhu_set_cookie`
  - 设置蓝湖登录 Cookie
- `lanhu_render_html`
  - 单页输出 HTML 交付物
- `lanhu_render_uniapp`
  - 单页输出静态 UniApp SFC 交付物
- `lanhu_render_batch`
  - 批量输出 HTML 交付物并生成验收 summary
- `lanhu_compare_images`
  - 比较实现图和参考图，输出 diff 和相似度

## 适用场景

这个 MCP 适合下面这种工作流：

1. 设计在蓝湖里
2. 通过 MCP 拉取页面
3. 选择生成 HTML 或 UniApp SFC 以及图片资源
4. 交给别的项目或别的 Agent
5. 对方根据交付物继续重构或直接落地：
   - uniapp
   - 微信小程序
   - React
   - Vue
   - 原生 H5
6. 最后再拿实现截图回来做对比验收

## 安装

```bash
npm install
npm run build
```

## 启动 MCP Server

```bash
node dist/index.js
```

也可以在 MCP Client 中配置：

```json
{
  "mcpServers": {
    "lanhu": {
      "command": "node",
      "args": ["E:/project/lanhu_mcp/dist/index.js"],
      "env": {
        "LANHU_COOKIE": "your-lanhu-cookie"
      }
    }
  }
}
```

## Cookie 说明

蓝湖接口依赖登录态。

Cookie 可以通过两种方式提供：

- 环境变量 `LANHU_COOKIE`
- MCP 工具 `lanhu_set_cookie`

建议：

- 只在本地环境变量或 MCP 会话里传递 Cookie
- 不要把 Cookie 写入仓库
- 不要把 Cookie 发到 issue、日志或截图里

## 常用脚本

```bash
npm run build
npm run test
npm run validate:sample
npm run render:lanhu
npm run restore:loop
```

说明：

- `npm run test`
  - 编译并执行测试
- `npm run validate:sample`
  - 运行单页 HTML 还原验证
- `npm run render:lanhu`
  - 与 `validate:sample` 使用同一条 HTML 还原链路
- `npm run restore:loop`
  - 运行批量 HTML 还原和 summary 验收

## MCP 工具

### `lanhu_set_cookie`

设置蓝湖 Cookie，后续工具无需重复传入。

输入：

```json
{
  "cookie": "your-cookie"
}
```

### `lanhu_render_html`

把一个蓝湖页面或 `json_url` 还原成单页 HTML 交付物。

输入：

```json
{
  "url": "https://lanhuapp.com/web/#/item/project/detailDetach?...",
  "cookie": "optional-cookie",
  "output_dir": "artifacts/single-page",
  "output_prefix": "profile-page"
}
```

或：

```json
{
  "json_url": "https://alipic.lanhuapp.com/...",
  "reference_image_url": "https://alipic.lanhuapp.com/...",
  "output_dir": "artifacts/single-page",
  "output_prefix": "profile-page"
}
```

输出格式为 `html-assets-only`：

```json
{
  "success": true,
  "data": {
    "mode": "html-assets-only",
    "source": {
      "pageUrl": "...",
      "jsonUrl": "...",
      "designName": "...",
      "referenceImageUrl": "..."
    },
    "htmlPath": "E:/project/.../profile-page.html",
    "previewImagePath": "E:/project/.../profile-page.png",
    "diffImagePath": "E:/project/.../profile-page-diff.png",
    "assetDirectory": "E:/project/.../profile-page-assets",
    "assetPublicPathPrefix": "./profile-page-assets",
    "assetFiles": [
      {
        "fileName": "icon-user.png",
        "localPath": "./profile-page-assets/icon-user.png",
        "filePath": "E:/project/.../icon-user.png",
        "sourceUrl": "https://..."
      }
    ],
    "similarityScore": 96.75,
    "handoffNotes": [
      "This MCP only hands off HTML and localized image assets for downstream reconstruction."
    ]
  }
}
```

你真正需要交给下游项目的就是：

- `htmlPath`
- `assetDirectory`
- `assetFiles`

### `lanhu_render_uniapp`

把一个蓝湖页面或 `json_url` 直接还原成静态 UniApp 单文件组件。

输入：

```json
{
  "json_url": "https://alipic.lanhuapp.com/...",
  "output_dir": "artifacts/uniapp-page",
  "output_prefix": "profile-page",
  "design_width": 375,
  "asset_public_path": "/static/lanhu-assets"
}
```

输出格式为 `uniapp-sfc-assets`：

```json
{
  "success": true,
  "data": {
    "mode": "uniapp-sfc-assets",
    "source": {
      "jsonUrl": "...",
      "referenceImageUrl": "..."
    },
    "vuePath": "E:/project/.../profile-page.vue",
    "bundlePath": "E:/project/.../profile-page-bundle.json",
    "metaPath": "E:/project/.../profile-page-meta.json",
    "designWidth": 375,
    "artboard": {
      "name": "Profile",
      "width": 375,
      "height": 812
    },
    "assetDirectory": "E:/project/.../profile-page-assets",
    "assetPublicPathPrefix": "/static/lanhu-assets",
    "assetFiles": [
      {
        "fileName": "icon-user.png",
        "localPath": "/static/lanhu-assets/icon-user.png",
        "filePath": "E:/project/.../icon-user.png",
        "sourceUrl": "https://..."
      }
    ]
  }
}
```

你真正需要交给下游项目的就是：

- `vuePath`
- `assetDirectory`
- `assetFiles`

### `lanhu_render_batch`

批量输出 HTML 交付物。

输入支持三种形式：

1. `urls`

```json
{
  "urls": [
    "https://lanhuapp.com/web/#/item/project/detailDetach?...image_id=aaa",
    "https://lanhuapp.com/web/#/item/project/detailDetach?...image_id=bbb"
  ],
  "output_dir": "artifacts/batch",
  "min_score": 95
}
```

2. `json_urls`

```json
{
  "json_urls": [
    "https://alipic.lanhuapp.com/a",
    "https://alipic.lanhuapp.com/b"
  ],
  "output_dir": "artifacts/batch"
}
```

3. `targets`

```json
{
  "targets": [
    {
      "url": "https://lanhuapp.com/web/#/item/project/detailDetach?...image_id=aaa",
      "prefix": "page-a"
    },
    {
      "json_url": "https://alipic.lanhuapp.com/b",
      "reference_image_url": "https://alipic.lanhuapp.com/b.png",
      "prefix": "page-b"
    }
  ],
  "output_dir": "artifacts/batch",
  "min_score": 95,
  "max_attempts": 3
}
```

输出会生成：

- 每个页面自己的 HTML 和资源目录
- 一个批量 summary 文件

summary 返回字段同样只保留 HTML 交付信息：

- `htmlPath`
- `assetDirectory`
- `assetFiles`
- `previewImagePath`
- `diffImagePath`
- `similarityScore`

### `lanhu_compare_images`

把你的实现截图和参考图做对比，输出：

- 相似度分数
- diff 图
- 重点差异区域

这个工具适合在下游项目重构完成后做回归验收。

## 推荐工作流

### 给别的项目交付 UI 参考

1. 调 `lanhu_set_cookie`
2. 调 `lanhu_render_html` 或 `lanhu_render_batch`
3. 把下面这些交给下游项目：
   - HTML 文件
   - 图片资源目录
   - 图片资源清单
4. 下游项目自己根据 HTML 重构成目标界面
5. 实现完后截图
6. 用 `lanhu_compare_images` 做验收

### uniapp / 微信小程序项目怎么用

正确方式不是“让这个 MCP 直接生成 uniapp 页面”。

正确方式是：

1. 用这个 MCP 拿到 HTML 和资源
2. 在 uniapp 项目中根据 HTML 自己拆成 `view / text / image`
3. 尺寸、层级、资源引用按 HTML 对齐
4. 页面完成后截图
5. 再回到这个 MCP 做图像对比

也就是：

- 本 MCP 负责交付设计参考
- 你的业务项目负责真正实现页面

## 输出产物

单页一般会生成：

- `*.html`
  - 还原后的 HTML 页面
- `*.png`
  - HTML 预览图
- `*-diff.png`
  - 与参考图的差异图
- `*-meta.json`
  - 内部详细元数据
- `*-bundle.json`
  - 内部详细 bundle
- `*-assets/`
  - 本地化后的图片资源目录

默认情况下，对外 MCP 返回不会把内部详细 bundle 作为主要交付内容，只返回 HTML handoff 信息。

## 命令行批量使用

### 单页

```bash
set LANHU_PAGE_URL=https://lanhuapp.com/web/#/item/project/detailDetach?pid=...&image_id=...
set LANHU_COOKIE=your-cookie
set LANHU_OUTPUT_DIR=artifacts/single
set RESTORATION_OUTPUT_PREFIX=single-page
node scripts/validate-sample-restoration.mjs
```

### 批量

```bash
set LANHU_COOKIE=your-cookie
set LANHU_PAGE_URLS=https://lanhuapp.com/web/#/item/project/detailDetach?...image_id=aaa,https://lanhuapp.com/web/#/item/project/detailDetach?...image_id=bbb
set LANHU_OUTPUT_DIR=artifacts/batch
set RESTORATION_MIN_SCORE=95
set LANHU_TARGET_MAX_ATTEMPTS=3
node scripts/run-lanhu-loop.mjs
```

也支持：

- `LANHU_TARGETS_FILE`
- `LANHU_JSON_URL`
- `LANHU_REFERENCE_IMAGE_URL`

## 当前约束

当前版本有一个明确约束：

- 对外只交付 HTML 和图片资源

这意味着：

- 不承诺直接输出 uniapp 页面
- 不承诺直接输出微信小程序页面
- 不承诺直接输出 React/Vue 业务组件

如果你要做这些，应该在下游项目里消费 `htmlPath + assetDirectory + assetFiles` 自己重构。

## 仓库结构

```text
src/
  services/
    html-restoration-runner.ts
    html-restoration-batch-runner.ts
    html-handoff.ts
  tools/
    render-html.ts
    render-html-batch.ts
    compare-images.ts
    set-cookie.ts
  runtime/
    html-restoration-runtime.mjs

scripts/
  validate-sample-restoration.mjs
  run-lanhu-loop.mjs
  copy-runtime-to-dist.mjs

tests/
  *.test.mjs
```

## 当前建议

如果你的目标是“别的开发项目拿去做页面”，请统一按下面方式接入：

1. `lanhu_render_html`
2. 读取 `htmlPath`
3. 读取 `assetDirectory` 和 `assetFiles`
4. 按 HTML 自己重构
5. 用 `lanhu_compare_images` 验收

不要再把这个 MCP 当成“直接吐目标框架代码生成器”。
它现在的职责就是稳定输出 HTML handoff。
