/**
 * 样式提取服务
 * 将蓝湖图层样式转换为 CSS/组件代码
 */

import type { SimplifiedLayer } from '../types/lanhu.js';

export type OutputFormat = 'css' | 'tailwind' | 'react' | 'vue';

/**
 * 样式提取器
 */
export class StyleExtractor {

  /**
   * 从蓝湖图层树节点提取样式
   */
  extractFromLanhuNode(node: SimplifiedLayer, format: OutputFormat = 'css'): string {
    switch (format) {
      case 'tailwind':
        return this.lanhuNodeToTailwind(node);
      case 'react':
        return this.lanhuNodeToReact(node);
      case 'vue':
        return this.lanhuNodeToVue(node);
      case 'css':
      default:
        return this.lanhuNodeToCSS(node);
    }
  }

  /**
   * 转换为 CSS
   */
  private lanhuNodeToCSS(node: SimplifiedLayer): string {
    const lines: string[] = [];
    const className = this.toClassName(node.name);

    lines.push(`/* ${node.name} (${node.type}) */`);
    lines.push(`.${className} {`);
    lines.push(`  /* 位置: ${node.bounds.x}, ${node.bounds.y} */`);
    lines.push(`  width: ${node.bounds.width}px;`);
    lines.push(`  height: ${node.bounds.height}px;`);

    // 填充
    if (node.fill) {
      lines.push(`  background-color: ${node.fill};`);
    }

    // 边框
    if (node.stroke) {
      lines.push(`  border: ${node.stroke.width}px solid ${node.stroke.color};`);
    }

    // 文本样式
    if (node.textStyle) {
      const ts = node.textStyle;
      lines.push(`  font-size: ${ts.fontSize}px;`);
      if (ts.fontFamily) lines.push(`  font-family: '${ts.fontFamily}';`);
      if (ts.color) lines.push(`  color: ${ts.color};`);
      if (ts.alignment) lines.push(`  text-align: ${ts.alignment};`);
    }

    lines.push('}');
    return lines.join('\n');
  }

  /**
   * 转换为 Tailwind 类名
   */
  private lanhuNodeToTailwind(node: SimplifiedLayer): string {
    const classes: string[] = [];

    // 尺寸
    classes.push(`w-[${node.bounds.width}px]`);
    classes.push(`h-[${node.bounds.height}px]`);

    // 填充
    if (node.fill) {
      classes.push(`bg-[${node.fill}]`);
    }

    // 边框
    if (node.stroke) {
      classes.push(`border-[${node.stroke.width}px]`);
      classes.push(`border-[${node.stroke.color}]`);
    }

    // 文本样式
    if (node.textStyle) {
      const ts = node.textStyle;
      classes.push(`text-[${ts.fontSize}px]`);
      if (ts.color) classes.push(`text-[${ts.color}]`);
      if (ts.alignment === 'center') classes.push('text-center');
      if (ts.alignment === 'right') classes.push('text-right');
    }

    const content = node.text || '';
    return `<!-- ${node.name} (${node.type}) -->\n<div class="${classes.join(' ')}">${content}</div>`;
  }

  /**
   * 转换为 React 组件
   */
  private lanhuNodeToReact(node: SimplifiedLayer): string {
    const componentName = this.toComponentName(node.name);
    const className = this.toClassName(node.name);

    return `// ${node.name} (${node.type})
// Position: (${node.bounds.x}, ${node.bounds.y})
// Size: ${node.bounds.width}x${node.bounds.height}
export function ${componentName}() {
  return (
    <div className="${className}" style={{ width: ${node.bounds.width}, height: ${node.bounds.height} }}>
      ${node.text || '/* content */'}
    </div>
  );
}`;
  }

  /**
   * 转换为 Vue 组件
   */
  private lanhuNodeToVue(node: SimplifiedLayer): string {
    const componentName = this.toComponentName(node.name);
    const className = this.toClassName(node.name);

    return `<!-- ${node.name} (${node.type}) -->
<!-- Position: (${node.bounds.x}, ${node.bounds.y}) -->
<!-- Size: ${node.bounds.width}x${node.bounds.height} -->
<template>
  <div class="${className}" :style="{ width: '${node.bounds.width}px', height: '${node.bounds.height}px' }">
    ${node.text || '<slot></slot>'}
  </div>
</template>

<script setup>
defineOptions({ name: '${componentName}' });
</script>`;
  }

  /**
   * 名称转 CSS 类名
   */
  private toClassName(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 50) || 'layer';
  }

  /**
   * 名称转组件名
   */
  private toComponentName(name: string): string {
    return name
      .split(/[^a-zA-Z0-9]+/)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join('')
      .substring(0, 50) || 'Layer';
  }

  /**
   * 批量提取样式（从蓝湖图层树）
   */
  extractBatchFromLanhu(layers: SimplifiedLayer[], format: OutputFormat = 'css'): string {
    const results: string[] = [];

    const traverse = (nodes: SimplifiedLayer[], depth: number = 0) => {
      for (const node of nodes) {
        const indent = '  '.repeat(depth);
        results.push(`${indent}${this.extractFromLanhuNode(node, format)}`);

        if (node.children && node.children.length > 0) {
          traverse(node.children, depth + 1);
        }
      }
    };

    traverse(layers);
    return results.join('\n\n');
  }

  // 保留旧方法以兼容
  extractBatch(layers: any[], format: OutputFormat = 'css'): string {
    return this.extractBatchFromLanhu(layers as SimplifiedLayer[], format);
  }
}

// 单例实例
export const styleExtractor = new StyleExtractor();
