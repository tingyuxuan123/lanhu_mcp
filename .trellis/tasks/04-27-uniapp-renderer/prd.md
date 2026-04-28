# UniApp 渲染器 — 从蓝湖数据直接生成 UniApp SFC

## TL;DR

新增 MCP 工具 `lanhu_render_uniapp`，从 Lanhu 的 `SimplifiedLayer[]` 数据直接生成 UniApp SFC（`.vue` 文件），绕过 HTML 中间层。复用现有数据管线（解析、图层树、布局推断、资源本地化），新建独立的 UniApp 渲染运行时。

## Problem

当前 `lanhu_render_html` 输出的是像素级 HTML，大量 `position:absolute`、内联样式、`<div>` 堆砌。用 LLM 将 HTML 转成 UniApp 页面时效果不理想，因为 HTML 缺少语义信息，LLM 需要逆向推断设计意图。

## Solution

从 `SimplifiedLayer[]` 原始数据直接生成 UniApp SFC，完全绕过 HTML 中间层。LLM 的角色从"翻译 HTML"变为"优化 UniApp 代码"。

## 架构决策

### 为什么不改造现有 HTML 渲染器？

1. HTML 渲染器使用 SVG + JS 缩放逻辑，UniApp 需要不同处理（rpx 替代 JS 缩放、SVG 需要替代方案）
2. HTML 渲染器的 styleRegistry 和 CSS 类生成与 Vue scoped style 体系不同
3. 独立渲染器可以针对小程序做专属优化
4. 不影响现有 `lanhu_render_html` 的稳定性

### 复用什么

- ✅ `LanhuClient` — API 调用、Cookie 管理
- ✅ `LanhuParser` — 文档解析、图层树构建、`inferLayoutHint()`、`buildLayerTree()`
- ✅ `AssetLocalizer` — 资源下载、SHA1 去重、本地化
- ✅ `HtmlHandoff` — 结果打包
- ✅ `ImageCompare` — 截图对比
- ✅ `types/lanhu.ts` — `SimplifiedLayer` 及所有类型定义
- ❌ `html-restoration-runtime.mjs` — 不复用，新建 `uniapp-restoration-runtime.mjs`

---

## Requirements

### R1: 新建 UniApp 渲染运行时

创建 `src/runtime/uniapp-restoration-runtime.mjs`，导出 `runUniAppRestoration(options)`。

核心渲染函数：

| 函数 | 职责 | 输出 |
|------|------|------|
| `renderUniAppRoot(nodes, artboard)` | 根容器，生成 `<template>` + `<style>` | SFC 字符串 |
| `renderUniAppNode(node, ctx)` | 节点分发 | `<view>` 片段 |
| `renderFlexContainer(node, ctx)` | flex 布局容器 | `<view style="display:flex">` |
| `renderAbsoluteContainer(node, ctx)` | 绝对定位容器 | `<view style="position:absolute">` |
| `renderText(node, ctx)` | 文本节点 | `<text>` |
| `renderImage(node, ctx)` | 图片节点 | `<image>` |
| `renderShape(node, ctx)` | 形状节点 | `<view>` 或 `<image>` |
| `pxToRpx(px)` | 单位转换 | `rpx = px * (750 / designWidth)` |

### R2: Runner 类

创建 `src/services/uniapp-restoration-runner.ts`，与 `HtmlRestorationRunner` 结构一致，加载 `uniapp-restoration-runtime.mjs`。

### R3: MCP 工具

创建 `src/tools/render-uniapp.ts`，工具名 `lanhu_render_uniapp`，参数与 `lanhu_render_html` 一致，额外增加 `design_width`（默认 375）。

在 `src/tools/index.ts` 注册新工具。

### R4: 渲染差异（vs HTML）

| 特性 | 实现方式 |
|------|---------|
| 单位 | `rpx = px * (750 / designWidth)` |
| 元素映射 | `<div>` → `<view>`，`<img>` → `<image>`，纯文字 → `<text>` |
| Grid 布局 | 直接保留（小程序支持 CSS Grid） |
| SVG（简单） | `<view>` + CSS border-radius/clip-path |
| SVG（复杂） | `<image src="data:image/svg+xml,..."/>` |
| 响应式 | rpx 自动适配，无需 JS 缩放 |
| 图片 | `<image mode="widthFix">` / `mode="aspectFill"` / `mode="aspectFit"` |
| 渐变 | 直接使用 `linear-gradient` |
| 多行文本 | `<text>` 嵌套（UniApp 支持） |

### R5: SFC 输出结构

```vue
<template>
  <view class="page">
    <!-- 静态渲染所有图层 -->
  </view>
</template>
<script>
export default { name: 'LanhuRestoredPage' }
</script>
<style scoped>
.page { width: 750rpx; min-height: 1334rpx; }
/* rpx 样式类 */
</style>
```

第一版输出单文件 SFC，不做自动组件拆分。

### R6: 资源路径

本地化资源引用为 `/static/lanhu-assets/xxx.png`，可配置前缀。

---

## Out of Scope

- 自动组件拆分（第一版不做）
- 交互逻辑生成（第一版只输出静态页面）
- Vue 3 `<script setup>` 语法（第一版用 Options API）
- 破坏现有 HTML 工具

---

## Verification

1. `npm run build` 编译通过
2. 用 `tmp_sample.json` 跑 `lanhu_render_uniapp`，检查输出 SFC
3. 截图对比与 HTML 版本的还原度
4. 生成的 SFC 可在 UniApp 项目中编译运行
