/**
 * 蓝湖数据解析器
 * 解析蓝湖特有的 JSON 数据格式
 */

import { ParseError } from '../utils/error.js';
import type {
  LanhuDocument,
  LanhuLayer,
  LanhuColor,
  SimplifiedLayer,
  DocumentStats,
} from '../types/lanhu.js';
import { logger } from '../utils/logger.js';

/**
 * 蓝湖解析器
 */
export class LanhuParser {
  private document: LanhuDocument | null = null;

  /**
   * 解析蓝湖文档
   */
  parseDocument(data: unknown): LanhuDocument {
    try {
      if (!data || typeof data !== 'object') {
        throw new ParseError('无效的文档数据');
      }

      const doc = data as LanhuDocument;
      if (!doc.board || !doc.board.layers) {
        throw new ParseError('文档缺少 board 或 layers 字段');
      }

      this.document = doc;
      logger.info(`文档解析成功: ${doc.board.name}, 图层数: ${this.countLayers(doc.board.layers)}`);
      return doc;
    } catch (error) {
      if (error instanceof ParseError) {
        throw error;
      }
      throw new ParseError(`文档解析失败: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * 计算图层数量
   */
  private countLayers(layers: LanhuLayer[]): number {
    let count = 0;
    for (const layer of layers) {
      count++;
      if (layer.layers) {
        count += this.countLayers(layer.layers);
      }
    }
    return count;
  }

  /**
   * 构建简化的图层树
   */
  buildLayerTree(doc?: LanhuDocument, maxDepth: number = 15): SimplifiedLayer[] {
    const document = doc || this.document;
    if (!document) {
      throw new ParseError('未加载文档');
    }

    const buildNode = (layer: LanhuLayer, depth: number): SimplifiedLayer => {
      const bounds = this.getLayerBounds(layer);
      const node: SimplifiedLayer = {
        id: layer.id,
        name: layer.name,
        type: this.getLayerTypeName(layer.type),
        visible: layer.visible,
        bounds,
      };

      // 处理文本
      if (layer.text && layer.textInfo) {
        node.text = layer.textInfo.text;
        node.textStyle = this.extractTextStyle(layer.textInfo);
      }

      // 处理填充
      const fillColor = this.getFillColor(layer);
      if (fillColor) {
        node.fill = fillColor;
      }

      // 处理描边
      const stroke = this.getStroke(layer);
      if (stroke) {
        node.stroke = stroke;
      }

      // 递归处理子图层
      if (layer.layers && layer.layers.length > 0 && depth < maxDepth) {
        node.children = layer.layers.map(child => buildNode(child, depth + 1));
      }

      return node;
    };

    return document.board.layers.map(layer => buildNode(layer, 0));
  }

  /**
   * 获取图层边界
   */
  private getLayerBounds(layer: LanhuLayer): { x: number; y: number; width: number; height: number } {
    // 优先使用 _orgBounds
    if (layer._orgBounds) {
      const b = layer._orgBounds;
      return {
        x: b.left,
        y: b.top,
        width: b.right - b.left,
        height: b.bottom - b.top,
      };
    }

    // 其次使用 boundsWithFX
    if (layer.boundsWithFX) {
      const b = layer.boundsWithFX;
      return {
        x: b.left,
        y: b.top,
        width: b.right - b.left,
        height: b.bottom - b.top,
      };
    }

    // 最后使用 width/height/top/left
    if (layer.width !== undefined && layer.height !== undefined) {
      return {
        x: layer.left || 0,
        y: layer.top || 0,
        width: layer.width,
        height: layer.height,
      };
    }

    return { x: 0, y: 0, width: 0, height: 0 };
  }

  /**
   * 获取图层类型名称
   */
  private getLayerTypeName(type: string): string {
    const typeMap: Record<string, string> = {
      artboardSection: 'artboard',
      layerSection: 'group',
      layer: 'layer',
      textLayer: 'text',
      shapeLayer: 'shape',
      smartObjectLayer: 'image',
    };
    return typeMap[type] || type;
  }

  /**
   * 提取文本样式
   */
  private extractTextStyle(textInfo: LanhuLayer['textInfo']): SimplifiedLayer['textStyle'] {
    if (!textInfo) return undefined as unknown as SimplifiedLayer['textStyle'];

    const style: SimplifiedLayer['textStyle'] = {
      fontSize: textInfo.size || 14,
      fontFamily: textInfo.fontName || textInfo.fontPostScriptName || 'unknown',
      color: textInfo.color ? this.colorToHex(textInfo.color) : '#000000',
      alignment: textInfo.justification || 'left',
    };

    // 优先从 textStyleRange 获取更精确的信息
    if (textInfo.textStyleRange && textInfo.textStyleRange.length > 0) {
      const firstStyle = textInfo.textStyleRange[0].textStyle;
      if (firstStyle) {
        style.fontSize = firstStyle.size || style.fontSize;
        style.fontFamily = firstStyle.fontName || style.fontFamily;
        if (firstStyle.color) {
          style.color = this.colorToHex(firstStyle.color);
        }
      }
    }

    return style;
  }

  /**
   * 获取填充颜色
   */
  private getFillColor(layer: LanhuLayer): string | undefined {
    // 形状图层的填充
    if (layer.fill && layer.fill.color) {
      return this.colorToHex(layer.fill.color);
    }

    // 图层效果的填充
    if (layer.layerEffects?.solidFill?.enabled && layer.layerEffects.solidFill.color) {
      return this.colorToHex(layer.layerEffects.solidFill.color);
    }

    return undefined;
  }

  /**
   * 获取描边
   */
  private getStroke(layer: LanhuLayer): { color: string; width: number } | undefined {
    if (layer.strokeStyle?.strokeEnabled && layer.strokeStyle.strokeStyleContent?.color) {
      return {
        color: this.colorToHex(layer.strokeStyle.strokeStyleContent.color),
        width: layer.strokeStyle.strokeStyleLineWidth || 1,
      };
    }
    return undefined;
  }

  /**
   * 颜色转十六进制
   */
  colorToHex(color: LanhuColor): string {
    // 处理 r/g/b 格式
    const r = Math.round(color.r ?? color.red ?? 0);
    const g = Math.round(color.g ?? color.green ?? 0);
    const b = Math.round(color.b ?? color.blue ?? 0);
    const a = color.alpha ?? 1;

    if (a < 1) {
      return `rgba(${r}, ${g}, ${b}, ${a.toFixed(2)})`;
    }

    return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
  }

  /**
   * 获取所有图层（扁平化）
   */
  flattenLayers(doc?: LanhuDocument): LanhuLayer[] {
    const document = doc || this.document;
    if (!document) {
      throw new ParseError('未加载文档');
    }

    const result: LanhuLayer[] = [];
    const traverse = (layers: LanhuLayer[]) => {
      for (const layer of layers) {
        result.push(layer);
        if (layer.layers) {
          traverse(layer.layers);
        }
      }
    };
    traverse(document.board.layers);
    return result;
  }

  /**
   * 提取所有文本图层
   */
  extractTextLayers(doc?: LanhuDocument): Array<{
    id: number;
    name: string;
    text: string;
    bounds: { x: number; y: number; width: number; height: number };
    style?: SimplifiedLayer['textStyle'];
  }> {
    const document = doc || this.document;
    if (!document) {
      throw new ParseError('未加载文档');
    }

    const result: Array<{
      id: number;
      name: string;
      text: string;
      bounds: { x: number; y: number; width: number; height: number };
      style?: SimplifiedLayer['textStyle'];
    }> = [];

    const traverse = (layers: LanhuLayer[]) => {
      for (const layer of layers) {
        if (layer.text && layer.textInfo) {
          result.push({
            id: layer.id,
            name: layer.name,
            text: layer.textInfo.text || '',
            bounds: this.getLayerBounds(layer),
            style: this.extractTextStyle(layer.textInfo),
          });
        }
        if (layer.layers) {
          traverse(layer.layers);
        }
      }
    };
    traverse(document.board.layers);
    return result;
  }

  /**
   * 按 ID 查找图层
   */
  findLayerById(doc: LanhuDocument, id: number): LanhuLayer | null {
    const search = (layers: LanhuLayer[]): LanhuLayer | null => {
      for (const layer of layers) {
        if (layer.id === id) {
          return layer;
        }
        if (layer.layers) {
          const found = search(layer.layers);
          if (found) return found;
        }
      }
      return null;
    };

    return search(doc.board.layers);
  }

  /**
   * 按名称搜索图层
   */
  findLayersByName(doc: LanhuDocument, name: string): LanhuLayer[] {
    const result: LanhuLayer[] = [];
    const searchName = name.toLowerCase();

    const search = (layers: LanhuLayer[]) => {
      for (const layer of layers) {
        if (layer.name.toLowerCase().includes(searchName)) {
          result.push(layer);
        }
        if (layer.layers) {
          search(layer.layers);
        }
      }
    };

    search(doc.board.layers);
    return result;
  }

  /**
   * 获取文档统计信息
   */
  getDocumentStats(doc?: LanhuDocument): DocumentStats {
    const document = doc || this.document;
    if (!document) {
      throw new ParseError('未加载文档');
    }

    let totalLayers = 0;
    let textLayers = 0;
    let shapeLayers = 0;
    let imageLayers = 0;
    let groupLayers = 0;

    const count = (layers: LanhuLayer[]) => {
      for (const layer of layers) {
        totalLayers++;
        switch (layer.type) {
          case 'textLayer':
            textLayers++;
            break;
          case 'shapeLayer':
            shapeLayers++;
            break;
          case 'layer':
            if (layer.pixels) {
              imageLayers++;
            }
            break;
          case 'layerSection':
          case 'artboardSection':
            groupLayers++;
            break;
        }
        if (layer.layers) {
          count(layer.layers);
        }
      }
    };

    count(document.board.layers);

    // 获取画板尺寸
    const artboardRect = document.board.artboard?.artboardRect;
    const width = artboardRect ? artboardRect.right - artboardRect.left : 0;
    const height = artboardRect ? artboardRect.bottom - artboardRect.top : 0;

    return {
      totalLayers,
      textLayers,
      shapeLayers,
      imageLayers,
      groupLayers,
      width,
      height,
    };
  }
}

// 单例实例
export const lanhuParser = new LanhuParser();
