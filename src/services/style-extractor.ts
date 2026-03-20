/**
 * Style extraction helpers.
 */

import type { SimplifiedLayer } from '../types/lanhu.js';

export type OutputFormat = 'css' | 'tailwind' | 'react' | 'vue';

export class StyleExtractor {
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

  private lanhuNodeToCSS(node: SimplifiedLayer): string {
    const className = this.toClassName(node.name);
    const lines: string[] = [];
    const isContentWidth = node.sizeHint?.width === 'content';
    const isContentHeight = node.sizeHint?.height === 'content';
    const isFlex = node.layoutHint && node.layoutHint.mode !== 'absolute';
    const assetReference = this.getAssetReference(node);

    lines.push(`/* ${node.name} (${node.type}) */`);
    lines.push(`.${className} {`);
    lines.push('  box-sizing: border-box;');

    if (isFlex) {
      lines.push('  display: flex;');
      lines.push(`  flex-direction: ${node.layoutHint?.mode === 'flex-row' ? 'row' : 'column'};`);
      if (node.layoutHint?.gap !== undefined) {
        lines.push(`  gap: ${node.layoutHint.gap}px;`);
      }
      if (node.layoutHint?.justifyContent) {
        lines.push(`  justify-content: ${this.toCssFlexValue(node.layoutHint.justifyContent)};`);
      }
      if (node.layoutHint?.alignItems) {
        lines.push(`  align-items: ${this.toCssFlexValue(node.layoutHint.alignItems)};`);
      }
      if (node.layoutHint?.padding) {
        lines.push(`  padding: ${node.layoutHint.padding.top}px ${node.layoutHint.padding.right}px ${node.layoutHint.padding.bottom}px ${node.layoutHint.padding.left}px;`);
      }
    } else {
      lines.push('  position: absolute;');
      lines.push(`  left: ${node.bounds.x}px;`);
      lines.push(`  top: ${node.bounds.y}px;`);
    }
    if (!isContentWidth) {
      lines.push(`  width: ${node.bounds.width}px;`);
    }
    if (!isContentHeight) {
      lines.push(`  height: ${node.bounds.height}px;`);
    }

    if (node.opacity !== undefined) {
      lines.push(`  opacity: ${node.opacity};`);
    }

    if (assetReference) {
      lines.push(`  background-image: url('${assetReference}');`);
      lines.push('  background-repeat: no-repeat;');
      lines.push('  background-position: center;');
      lines.push('  background-size: contain;');
    } else if (node.fill) {
      if (node.fill.startsWith('linear-gradient') || node.fill.startsWith('radial-gradient')) {
        lines.push(`  background-image: ${node.fill};`);
      } else {
        lines.push(`  background-color: ${node.fill};`);
      }
    }

    if (node.stroke) {
      lines.push(`  border: ${node.stroke.width}px solid ${node.stroke.color};`);
    }

    if (node.borderRadius !== undefined) {
      const radius = Array.isArray(node.borderRadius)
        ? node.borderRadius.map(value => `${value}px`).join(' ')
        : `${node.borderRadius}px`;
      lines.push(`  border-radius: ${radius};`);
    }

    if (node.shadows && node.shadows.length > 0) {
      const shadowValue = node.shadows
        .map(shadow => `${shadow.type === 'innerShadow' ? 'inset ' : ''}${shadow.x}px ${shadow.y}px ${shadow.blur}px ${shadow.spread}px ${shadow.color}`)
        .join(', ');
      lines.push(`  box-shadow: ${shadowValue};`);
    }

    if (node.textStyle) {
      const style = node.textStyle;
      lines.push('  display: inline-block;');
      lines.push(`  font-size: ${style.fontSize}px;`);
      lines.push(`  font-family: '${style.fontFamily}';`);
      lines.push(`  font-weight: ${style.fontWeight || 400};`);
      lines.push(`  font-style: ${style.fontStyle || 'normal'};`);
      lines.push(`  color: ${style.color};`);
      lines.push(`  text-align: ${style.alignment};`);
      if (style.lineHeight) {
        lines.push(`  line-height: ${style.lineHeight}px;`);
      }
      if (style.letterSpacing !== undefined) {
        lines.push(`  letter-spacing: ${style.letterSpacing}px;`);
      }
    }

    lines.push('}');
    return lines.join('\n');
  }

  private lanhuNodeToTailwind(node: SimplifiedLayer): string {
    const classes: string[] = ['box-border'];
    if (node.layoutHint && node.layoutHint.mode !== 'absolute') {
      classes.push('flex');
      classes.push(node.layoutHint.mode === 'flex-row' ? 'flex-row' : 'flex-col');
      if (node.layoutHint.gap !== undefined) classes.push(`gap-[${node.layoutHint.gap}px]`);
      if (node.layoutHint.padding) {
        classes.push(`pt-[${node.layoutHint.padding.top}px]`);
        classes.push(`pr-[${node.layoutHint.padding.right}px]`);
        classes.push(`pb-[${node.layoutHint.padding.bottom}px]`);
        classes.push(`pl-[${node.layoutHint.padding.left}px]`);
      }
    } else {
      classes.push('absolute');
      classes.push(`left-[${node.bounds.x}px]`);
      classes.push(`top-[${node.bounds.y}px]`);
    }
    if (node.sizeHint?.width !== 'content') classes.push(`w-[${node.bounds.width}px]`);
    if (node.sizeHint?.height !== 'content') classes.push(`h-[${node.bounds.height}px]`);

    if (node.fill && !node.fill.startsWith('linear-gradient') && !node.fill.startsWith('radial-gradient')) {
      classes.push(`bg-[${node.fill}]`);
    }

    if (node.stroke) {
      classes.push(`border-[${node.stroke.width}px]`);
      classes.push(`border-[${node.stroke.color}]`);
    }

    if (typeof node.borderRadius === 'number') {
      classes.push(`rounded-[${node.borderRadius}px]`);
    }

    if (node.textStyle) {
      const style = node.textStyle;
      classes.push('inline-block');
      classes.push(`text-[${style.fontSize}px]`);
      classes.push(`text-[${style.color}]`);
      if (style.alignment === 'center') classes.push('text-center');
      if (style.alignment === 'right') classes.push('text-right');
    }

    return `<!-- ${node.name} (${node.type}) -->\n<div class="${classes.join(' ')}">${node.text || ''}</div>`;
  }

  private lanhuNodeToReact(node: SimplifiedLayer): string {
    const style = this.toInlineStyle(node);
    return `// ${node.name} (${node.type})\nexport function ${this.toComponentName(node.name)}() {\n  return (\n    <div style={${style}}>\n      ${node.text || ''}\n    </div>\n  );\n}`;
  }

  private lanhuNodeToVue(node: SimplifiedLayer): string {
    const style = this.toInlineStyle(node);
    return `<!-- ${node.name} (${node.type}) -->\n<template>\n  <div :style="${style}">${node.text || ''}</div>\n</template>\n\n<script setup>\ndefineOptions({ name: '${this.toComponentName(node.name)}' });\n</script>`;
  }

  private toInlineStyle(node: SimplifiedLayer): string {
    const style: Record<string, string | number> = {
      boxSizing: 'border-box',
    };
    const assetReference = this.getAssetReference(node);

    if (node.layoutHint && node.layoutHint.mode !== 'absolute') {
      style.display = 'flex';
      style.flexDirection = node.layoutHint.mode === 'flex-row' ? 'row' : 'column';
      if (node.layoutHint.gap !== undefined) style.gap = `${node.layoutHint.gap}px`;
      if (node.layoutHint.justifyContent) style.justifyContent = this.toCssFlexValue(node.layoutHint.justifyContent);
      if (node.layoutHint.alignItems) style.alignItems = this.toCssFlexValue(node.layoutHint.alignItems);
      if (node.layoutHint.padding) {
        style.padding = `${node.layoutHint.padding.top}px ${node.layoutHint.padding.right}px ${node.layoutHint.padding.bottom}px ${node.layoutHint.padding.left}px`;
      }
    } else {
      style.position = 'absolute';
      style.left = `${node.bounds.x}px`;
      style.top = `${node.bounds.y}px`;
    }
    if (node.sizeHint?.width !== 'content') style.width = `${node.bounds.width}px`;
    if (node.sizeHint?.height !== 'content') style.height = `${node.bounds.height}px`;

    if (node.opacity !== undefined) style.opacity = node.opacity;
    if (assetReference) {
      style.backgroundImage = `url(${assetReference})`;
      style.backgroundRepeat = 'no-repeat';
      style.backgroundPosition = 'center';
      style.backgroundSize = 'contain';
    } else if (node.fill) {
      if (node.fill.startsWith('linear-gradient') || node.fill.startsWith('radial-gradient')) {
        style.backgroundImage = node.fill;
      } else {
        style.backgroundColor = node.fill;
      }
    }
    if (node.stroke) style.border = `${node.stroke.width}px solid ${node.stroke.color}`;
    if (typeof node.borderRadius === 'number') style.borderRadius = `${node.borderRadius}px`;
    if (node.textStyle) {
      style.display = 'inline-block';
      style.fontSize = `${node.textStyle.fontSize}px`;
      style.fontFamily = node.textStyle.fontFamily;
      style.fontWeight = node.textStyle.fontWeight || 400;
      style.fontStyle = node.textStyle.fontStyle || 'normal';
      style.color = node.textStyle.color;
      style.textAlign = node.textStyle.alignment;
      if (node.textStyle.lineHeight) style.lineHeight = `${node.textStyle.lineHeight}px`;
      if (node.textStyle.letterSpacing !== undefined) style.letterSpacing = `${node.textStyle.letterSpacing}px`;
    }

    return JSON.stringify(style, null, 2);
  }

  private toClassName(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .substring(0, 50) || 'layer';
  }

  private toComponentName(name: string): string {
    return name
      .split(/[^a-zA-Z0-9]+/)
      .filter(Boolean)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join('')
      .substring(0, 50) || 'Layer';
  }

  private toCssFlexValue(value: 'start' | 'center' | 'end' | 'space-between' | 'stretch'): string {
    if (value === 'start') return 'flex-start';
    if (value === 'end') return 'flex-end';
    return value;
  }

  private getAssetReference(node: SimplifiedLayer): string | undefined {
    return node.localAssetPath || node.assetUrl;
  }

  extractBatchFromLanhu(layers: SimplifiedLayer[], format: OutputFormat = 'css'): string {
    const results: string[] = [];

    const walk = (nodes: SimplifiedLayer[]) => {
      for (const node of nodes) {
        results.push(this.extractFromLanhuNode(node, format));
        if (node.children && node.children.length > 0) {
          walk(node.children);
        }
      }
    };

    walk(layers);
    return results.join('\n\n');
  }

  extractBatch(layers: SimplifiedLayer[], format: OutputFormat = 'css'): string {
    return this.extractBatchFromLanhu(layers, format);
  }
}

export const styleExtractor = new StyleExtractor();
