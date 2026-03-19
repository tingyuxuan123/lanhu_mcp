# 蓝湖 MCP 服务

通过 Model Context Protocol (MCP) 为 Claude Code 等AI工具提供蓝湖设计图还原功能。

## 功能

- **lanhu_fetch_design**: 获取蓝湖设计图信息
- **lanhu_parse_sketch**: 解析设计数据，提取图层树和样式
- **lanhu_set_cookie**: 设置认证 Cookie

## 安装

```bash
npm install
npm run build
```

## 配置

### 方式一：环境变量

```bash
export LANHU_COOKIE="your-cookie-here"
```

### 方式二：MCP 配置文件

在 Claude Desktop 配置文件中添加：

```json
{
  "mcpServers": {
    "lanhu": {
      "command": "node",
      "args": ["/path/to/lanhu_mcp/dist/index.js"],
      "env": {
        "LANHU_COOKIE": "your-cookie-here"
      }
    }
  }
}
```

## 使用

### 1. 获取 Cookie

1. 登录蓝湖网页版 (lanhuapp.com)
2. 打开浏览器开发者工具 (F12)
3. 切换到 Network 标签页
4. 刷新页面，找到任意请求
5. 在请求头中复制 Cookie 值

### 2. 使用工具

#### 设置 Cookie

```
使用 lanhu_set_cookie 工具设置 Cookie
```

#### 获取设计图信息

```
使用 lanhu_fetch_design 工具，传入蓝湖设计图 URL
```

#### 解析设计数据

```
使用 lanhu_parse_sketch 工具，传入上一步获取的 json_url
可指定 output_format 生成代码（css/tailwind/react/vue）
```

## 蓝湖数据格式

蓝湖使用特有的 JSON 格式，主要结构：

```json
{
  "board": {
    "id": 23729,
    "name": "设计图名称",
    "artboard": { "artboardRect": { "top": 0, "left": 0, "bottom": 812, "right": 375 } },
    "layers": [
      {
        "id": 24610,
        "type": "layerSection",
        "name": "图层名称",
        "visible": true,
        "boundsWithFX": { "top": 0, "left": 0, "bottom": 100, "right": 200 },
        "layers": [...],
        "textInfo": { "text": "文本内容", "size": 14, "color": {...} },
        "fill": { "color": { "red": 255, "green": 0, "blue": 0 } }
      }
    ]
  }
}
```

### 图层类型

| 类型 | 说明 |
|------|------|
| `artboardSection` | 画板 |
| `layerSection` | 图层组 |
| `layer` | 普通图层/图片 |
| `textLayer` | 文本图层 |
| `shapeLayer` | 形状图层 |
| `smartObjectLayer` | 智能对象 |

### 返回数据结构

```json
{
  "success": true,
  "data": {
    "name": "设计图名称",
    "stats": {
      "totalLayers": 100,
      "textLayers": 20,
      "shapeLayers": 30,
      "imageLayers": 10,
      "groupLayers": 40,
      "width": 375,
      "height": 812
    },
    "layers": [
      {
        "id": 12345,
        "name": "标题",
        "type": "text",
        "visible": true,
        "bounds": { "x": 20, "y": 50, "width": 200, "height": 24 },
        "text": "标题文本",
        "textStyle": {
          "fontSize": 18,
          "fontFamily": "PingFang SC",
          "color": "#333333",
          "alignment": "left"
        },
        "fill": "#ffffff",
        "children": []
      }
    ],
    "textLayers": [...],
    "styles": "生成的CSS代码..."
  }
}
```

## 项目结构

```
lanhu_mcp/
├── src/
│   ├── index.ts              # 入口
│   ├── server.ts             # MCP Server 配置
│   ├── config/
│   │   └── cookie-manager.ts # Cookie 管理
│   ├── services/
│   │   ├── lanhu-client.ts   # API 客户端
│   │   ├── lanhu-parser.ts   # 蓝湖数据解析
│   │   └── style-extractor.ts # 样式提取
│   ├── tools/
│   │   ├── fetch-design.ts   # 获取设计图
│   │   ├── parse-sketch.ts   # 解析设计数据
│   │   └── set-cookie.ts     # 设置 Cookie
│   ├── types/
│   │   ├── api.ts            # API 类型
│   │   └── lanhu.ts          # 蓝湖数据类型
│   └── utils/
│       ├── error.ts          # 错误类
│       ├── logger.ts         # 日志
│       └── url-parser.ts     # URL 解析
└── dist/                     # 编译输出
```

## 许可证

MIT
