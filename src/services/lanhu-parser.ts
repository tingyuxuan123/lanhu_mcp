/**
 * Lanhu design JSON parser.
 */

import { ParseError } from '../utils/error.js';
import type {
  ArtboardInfo,
  AssetSummary,
  BuildLayerTreeOptions,
  DesignTokens,
  DocumentStats,
  LanhuBounds,
  LanhuColor,
  LanhuDocument,
  LanhuFill,
  LanhuGradientFill,
  LanhuLayer,
  SimplifiedFill,
  SimplifiedGradient,
  SimplifiedLayer,
  SimplifiedShadow,
  SimplifiedTextStyle,
  TextLayerSummary,
} from '../types/lanhu.js';
import { logger } from '../utils/logger.js';

export class LanhuParser {
  private document: LanhuDocument | null = null;

  parseDocument(data: unknown): LanhuDocument {
    try {
      if (!data || typeof data !== 'object') {
        throw new ParseError('Invalid Lanhu document payload');
      }

      const document = data as LanhuDocument;
      if (!document.board || !Array.isArray(document.board.layers)) {
        throw new ParseError('Lanhu document is missing board.layers');
      }

      this.document = document;
      logger.info(`Lanhu document parsed: ${document.board.name}`);
      return document;
    } catch (error) {
      if (error instanceof ParseError) {
        throw error;
      }
      throw new ParseError(`Failed to parse Lanhu document: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  getArtboardInfo(doc?: LanhuDocument): ArtboardInfo {
    const document = doc || this.document;
    if (!document) {
      throw new ParseError('No document loaded');
    }

    const rect = document.board.artboard?.artboardRect ?? {
      top: 0,
      left: 0,
      bottom: 0,
      right: 0,
    };

    return {
      name: document.board.name,
      x: rect.left,
      y: rect.top,
      width: rect.right - rect.left,
      height: rect.bottom - rect.top,
    };
  }

  buildLayerTree(doc?: LanhuDocument, maxDepth: number = 15, options: BuildLayerTreeOptions = {}): SimplifiedLayer[] {
    const document = doc || this.document;
    if (!document) {
      throw new ParseError('No document loaded');
    }

    const includeInvisible = options.includeInvisible ?? true;
    const normalizeToArtboard = options.normalizeToArtboard ?? true;
    const artboard = this.getArtboardInfo(document);
    let zIndex = 0;

    const buildNode = (layer: LanhuLayer, depth: number): SimplifiedLayer | null => {
      if (!includeInvisible && !layer.visible) {
        return null;
      }

      const fills = this.getFills(layer);
      const gradientFill = fills?.find(fill => fill.type === 'gradient')?.gradient;
      const primaryFill = fills?.find(fill => fill.type === 'solid')?.color
        ?? (gradientFill ? this.gradientToCss(gradientFill) : undefined);
      const assetUrls = this.getAssetUrls(layer);
      const bounds = this.getLayerBounds(layer, artboard, normalizeToArtboard);
      const shapeMetadata = this.getShapeMetadata(layer);
      const node: SimplifiedLayer = {
        id: layer.id,
        name: layer.name,
        type: this.getLayerTypeName(layer),
        sourceType: layer.type,
        visible: layer.visible,
        clipped: layer.clipped,
        isClippingMask: layer.isClippingMask,
        isAsset: layer.isAsset,
        zIndex: zIndex++,
        bounds,
        fill: primaryFill,
        fills,
        stroke: this.getStroke(layer),
        opacity: this.getOpacity(layer),
        borderRadius: shapeMetadata.borderRadius,
        shapeType: shapeMetadata.shapeType,
        shadows: this.getShadows(layer),
        assetUrl: this.pickBestAssetUrl(assetUrls),
        assetUrls: assetUrls && Object.keys(assetUrls).length > 0 ? assetUrls : undefined,
      };

      if (layer.text && layer.textInfo) {
        node.text = layer.textInfo.text;
        node.textStyle = this.extractTextStyle(layer.textInfo);
      }

      if (Array.isArray(layer.layers) && layer.layers.length > 0 && depth < maxDepth) {
        const children = layer.layers
          .map(child => buildNode(child, depth + 1))
          .filter((child): child is SimplifiedLayer => child !== null);

        if (children.length > 0) {
          node.children = children;
        }
      }

      return node;
    };

    return document.board.layers
      .map(layer => buildNode(layer, 0))
      .filter((layer): layer is SimplifiedLayer => layer !== null);
  }

  flattenLayers(doc?: LanhuDocument): LanhuLayer[] {
    const document = doc || this.document;
    if (!document) {
      throw new ParseError('No document loaded');
    }

    const result: LanhuLayer[] = [];
    const walk = (layers: LanhuLayer[]) => {
      for (const layer of layers) {
        result.push(layer);
        if (Array.isArray(layer.layers)) {
          walk(layer.layers);
        }
      }
    };

    walk(document.board.layers);
    return result;
  }

  extractTextLayers(doc?: LanhuDocument, options: BuildLayerTreeOptions = {}): TextLayerSummary[] {
    const document = doc || this.document;
    if (!document) {
      throw new ParseError('No document loaded');
    }

    const includeInvisible = options.includeInvisible ?? true;
    const normalizeToArtboard = options.normalizeToArtboard ?? true;
    const artboard = this.getArtboardInfo(document);
    const result: TextLayerSummary[] = [];

    const walk = (layers: LanhuLayer[]) => {
      for (const layer of layers) {
        if (!includeInvisible && !layer.visible) {
          continue;
        }

        if (layer.text && layer.textInfo) {
          result.push({
            id: layer.id,
            name: layer.name,
            text: layer.textInfo.text || '',
            bounds: this.getLayerBounds(layer, artboard, normalizeToArtboard),
            style: this.extractTextStyle(layer.textInfo),
          });
        }

        if (Array.isArray(layer.layers)) {
          walk(layer.layers);
        }
      }
    };

    walk(document.board.layers);
    return result;
  }

  extractAssets(doc?: LanhuDocument, options: BuildLayerTreeOptions = {}): AssetSummary[] {
    const document = doc || this.document;
    if (!document) {
      throw new ParseError('No document loaded');
    }

    const includeInvisible = options.includeInvisible ?? true;
    const normalizeToArtboard = options.normalizeToArtboard ?? true;
    const artboard = this.getArtboardInfo(document);
    const result: AssetSummary[] = [];

    const walk = (layers: LanhuLayer[]) => {
      for (const layer of layers) {
        if (!includeInvisible && !layer.visible) {
          continue;
        }

        const assetUrls = this.getAssetUrls(layer);
        const isImageLike = layer.type === 'smartObjectLayer' || layer.pixels || Boolean(assetUrls);

        if (isImageLike || layer.isAsset) {
          result.push({
            id: layer.id,
            name: layer.name,
            type: this.getLayerTypeName(layer),
            bounds: this.getLayerBounds(layer, artboard, normalizeToArtboard),
            assetUrl: this.pickBestAssetUrl(assetUrls),
            assetUrls: assetUrls && Object.keys(assetUrls).length > 0 ? assetUrls : undefined,
          });
        }

        if (Array.isArray(layer.layers)) {
          walk(layer.layers);
        }
      }
    };

    walk(document.board.layers);
    return result;
  }

  extractDesignTokens(doc?: LanhuDocument, options: BuildLayerTreeOptions = {}): DesignTokens {
    const layers = this.buildLayerTree(doc, 20, options);
    const colors = new Set<string>();
    const fonts = new Set<string>();
    const fontSizes = new Set<number>();
    const radii = new Set<number>();
    const shadowPresets = new Set<string>();

    const walk = (nodes: SimplifiedLayer[]) => {
      for (const node of nodes) {
        if (node.fill) {
          colors.add(node.fill);
        }
        if (node.stroke?.color) {
          colors.add(node.stroke.color);
        }
        for (const fill of node.fills || []) {
          if (fill.color) {
            colors.add(fill.color);
          }
          for (const stop of fill.gradient?.stops || []) {
            colors.add(stop.color);
          }
        }
        if (node.textStyle?.color) {
          colors.add(node.textStyle.color);
        }
        if (node.textStyle?.fontFamily) {
          fonts.add(node.textStyle.fontFamily);
        }
        if (node.textStyle?.fontSize) {
          fontSizes.add(node.textStyle.fontSize);
        }
        if (typeof node.borderRadius === 'number') {
          radii.add(node.borderRadius);
        }
        if (Array.isArray(node.borderRadius)) {
          node.borderRadius.forEach(radius => radii.add(radius));
        }
        for (const shadow of node.shadows || []) {
          shadowPresets.add(`${shadow.type}:${shadow.color}:${shadow.blur}:${shadow.distance}:${shadow.opacity}`);
+          colors.add(shadow.color);
        }
        if (node.children) {
          walk(node.children);
        }
      }
    };

    walk(layers);

    return {
      colors: [...colors],
      fonts: [...fonts],
      fontSizes: [...fontSizes].sort((left, right) => left - right),
      radii: [...radii].sort((left, right) => left - right),
      shadowPresets: [...shadowPresets],
    };
  }

  findLayerById(doc: LanhuDocument, id: number): LanhuLayer | null {
    const walk = (layers: LanhuLayer[]): LanhuLayer | null => {
      for (const layer of layers) {
        if (layer.id === id) {
          return layer;
        }
        if (Array.isArray(layer.layers)) {
          const found = walk(layer.layers);
          if (found) {
            return found;
          }
        }
      }
      return null;
    };

    return walk(doc.board.layers);
  }

  findLayersByName(doc: LanhuDocument, name: string): LanhuLayer[] {
    const result: LanhuLayer[] = [];
    const keyword = name.toLowerCase();

    const walk = (layers: LanhuLayer[]) => {
      for (const layer of layers) {
        if (layer.name.toLowerCase().includes(keyword)) {
          result.push(layer);
        }
        if (Array.isArray(layer.layers)) {
          walk(layer.layers);
        }
      }
    };

    walk(doc.board.layers);
    return result;
  }

  getDocumentStats(doc?: LanhuDocument): DocumentStats {
    const document = doc || this.document;
    if (!document) {
      throw new ParseError('No document loaded');
    }

    let totalLayers = 0;
    let textLayers = 0;
    let shapeLayers = 0;
    let imageLayers = 0;
    let groupLayers = 0;

    const walk = (layers: LanhuLayer[]) => {
      for (const layer of layers) {
        totalLayers += 1;
        switch (layer.type) {
          case 'textLayer':
            textLayers += 1;
            break;
          case 'shapeLayer':
            shapeLayers += 1;
            break;
          case 'layer':
          case 'smartObjectLayer':
            if (layer.pixels || layer.type === 'smartObjectLayer') {
              imageLayers += 1;
            }
            break;
          case 'layerSection':
          case 'artboardSection':
            groupLayers += 1;
            break;
        }

        if (Array.isArray(layer.layers)) {
          walk(layer.layers);
        }
      }
    };

    walk(document.board.layers);
    const artboard = this.getArtboardInfo(document);

    return {
      totalLayers,
      textLayers,
      shapeLayers,
      imageLayers,
      groupLayers,
      width: artboard.width,
      height: artboard.height,
    };
  }

  colorToHex(color: LanhuColor): string {
    const red = Math.round(color.r ?? color.red ?? 0);
    const green = Math.round(color.g ?? color.green ?? 0);
    const blue = Math.round(color.b ?? color.blue ?? 0);
    const alpha = color.alpha ?? 1;

    if (alpha < 1) {
      return `rgba(${red}, ${green}, ${blue}, ${alpha.toFixed(2)})`;
    }

    return `#${red.toString(16).padStart(2, '0')}${green.toString(16).padStart(2, '0')}${blue.toString(16).padStart(2, '0')}`;
  }

  private getLayerTypeName(layer: LanhuLayer): string {
    if (layer.type === 'smartObjectLayer') {
      return 'image';
    }
    if (layer.type === 'layer' && layer.pixels) {
      return 'image';
    }

    const typeMap: Record<string, string> = {
      artboardSection: 'artboard',
      layerSection: 'group',
      layer: 'layer',
      textLayer: 'text',
      shapeLayer: 'shape',
      adjustmentLayer: 'adjustment',
    };

    return typeMap[layer.type] || layer.type;
  }

  private getRawBounds(layer: LanhuLayer): { bounds: LanhuBounds; isAbsolute: boolean } | null {
    if (layer._orgBounds) {
      return { bounds: layer._orgBounds, isAbsolute: true };
    }

    if (layer.boundsWithFX) {
      return { bounds: layer.boundsWithFX, isAbsolute: true };
    }

    if (layer.path?.bounds) {
      return { bounds: layer.path.bounds, isAbsolute: true };
    }

    if (layer.bounds) {
      return { bounds: layer.bounds, isAbsolute: true };
    }

    if (layer.width !== undefined && layer.height !== undefined) {
      return {
        bounds: {
          top: layer.top || 0,
          left: layer.left || 0,
          bottom: (layer.top || 0) + layer.height,
          right: (layer.left || 0) + layer.width,
        },
        isAbsolute: false,
      };
    }

    return null;
  }

  private getLayerBounds(layer: LanhuLayer, artboard: ArtboardInfo, normalizeToArtboard: boolean): SimplifiedLayer['bounds'] {
    const raw = this.getRawBounds(layer);
    if (!raw) {
      return { x: 0, y: 0, width: 0, height: 0, absoluteX: 0, absoluteY: 0 };
    }

    const { bounds, isAbsolute } = raw;
    const absoluteX = isAbsolute ? bounds.left : artboard.x + bounds.left;
    const absoluteY = isAbsolute ? bounds.top : artboard.y + bounds.top;
    const x = normalizeToArtboard ? absoluteX - artboard.x : absoluteX;
    const y = normalizeToArtboard ? absoluteY - artboard.y : absoluteY;

    return {
      x,
      y,
      width: bounds.right - bounds.left,
      height: bounds.bottom - bounds.top,
      absoluteX,
      absoluteY,
    };
  }

  private extractTextStyle(textInfo: LanhuLayer['textInfo']): SimplifiedTextStyle | undefined {
    if (!textInfo) {
      return undefined;
    }

    const firstStyle = textInfo.textStyleRange?.[0]?.textStyle;
    const fontName = firstStyle?.fontName || textInfo.fontName || firstStyle?.fontPostScriptName || textInfo.fontPostScriptName || 'sans-serif';
    const fontDescriptor = `${textInfo.fontStyleName || ''} ${firstStyle?.fontStyleName || ''} ${textInfo.fontPostScriptName || ''}`.toLowerCase();

    return {
      fontSize: firstStyle?.size || textInfo.size || 14,
      fontFamily: fontName,
      fontWeight: this.inferFontWeight(fontDescriptor, Boolean(textInfo.bold)),
      fontStyle: textInfo.italic || fontDescriptor.includes('italic') ? 'italic' : 'normal',
      color: firstStyle?.color ? this.colorToHex(firstStyle.color) : textInfo.color ? this.colorToHex(textInfo.color) : '#000000',
      alignment: textInfo.justification || 'left',
      lineHeight: textInfo.leading ?? undefined,
      letterSpacing: textInfo.tracking ?? undefined,
    };
  }

  private inferFontWeight(fontDescriptor: string, isBold: boolean): number {
    if (isBold || /black|heavy/.test(fontDescriptor)) {
      return 900;
    }
    if (/extrabold|ultrabold/.test(fontDescriptor)) {
      return 800;
    }
    if (/semibold|demibold/.test(fontDescriptor)) {
      return 600;
    }
    if (/medium/.test(fontDescriptor)) {
      return 500;
    }
    if (/light/.test(fontDescriptor)) {
      return 300;
    }
    return 400;
  }

  private getFills(layer: LanhuLayer): SimplifiedFill[] | undefined {
    const fills: SimplifiedFill[] = [];

    if (layer.fill?.color) {
      fills.push({ type: 'solid', color: this.colorToHex(layer.fill.color) });
    }

    if (layer.fill?.gradientFill) {
      const gradient = this.extractGradient(layer.fill, layer.fill.gradientFill);
      if (gradient) {
        fills.push({ type: 'gradient', gradient });
      }
    }

    if (layer.layerEffects?.solidFill?.enabled && layer.layerEffects.solidFill.color) {
      fills.push({ type: 'solid', color: this.colorToHex(layer.layerEffects.solidFill.color) });
    }

    return fills.length > 0 ? fills : undefined;
  }

  private extractGradient(fill: LanhuFill, gradientFill: LanhuGradientFill): SimplifiedGradient | undefined {
    const stops = gradientFill.gradient?.colors || gradientFill.colors;
    if (!stops || stops.length === 0) {
      return undefined;
    }

    return {
      type: gradientFill.gradient?.type || gradientFill.type || gradientFill.gradientForm || fill.class || 'linear',
      angle: gradientFill.gradient?.angle || gradientFill.angle,
      stops: stops.map((stop, index) => ({
        position: typeof stop.location === 'number' ? stop.location / 4096 : index / Math.max(stops.length - 1, 1),
        color: stop.color ? this.colorToHex(stop.color) : '#000000',
        opacity: stop.opacity ? stop.opacity.value / 100 : undefined,
      })),
    };
  }

  private gradientToCss(gradient: SimplifiedGradient): string {
    const prefix = /radial/i.test(gradient.type) ? 'radial-gradient' : 'linear-gradient';
    const angle = prefix === 'linear-gradient' ? `${gradient.angle ?? 180}deg, ` : '';
    const stops = gradient.stops
      .map(stop => `${stop.color} ${Math.round(stop.position * 100)}%`)
      .join(', ');

    return `${prefix}(${angle}${stops})`;
  }

  private getStroke(layer: LanhuLayer): SimplifiedLayer['stroke'] | undefined {
    if (!layer.strokeStyle?.strokeEnabled || !layer.strokeStyle.strokeStyleContent?.color) {
      return undefined;
    }

    return {
      color: this.colorToHex(layer.strokeStyle.strokeStyleContent.color),
      width: layer.strokeStyle.strokeStyleLineWidth || 1,
      opacity: layer.strokeStyle.strokeStyleOpacity ? layer.strokeStyle.strokeStyleOpacity.value / 100 : undefined,
      alignment: layer.strokeStyle.strokeStyleLineAlignment,
    };
  }

  private getOpacity(layer: LanhuLayer): number | undefined {
    if (layer.blendOptions?.opacity) {
      return layer.blendOptions.opacity.value / 100;
    }
    if (layer.layerEffects?.solidFill?.opacity) {
      return layer.layerEffects.solidFill.opacity.value / 100;
    }
    return undefined;
  }

  private getShapeMetadata(layer: LanhuLayer): { shapeType?: string; borderRadius?: number | number[] } {
    const origin = layer.path?.pathComponents?.find(component => component.origin)?.origin;
    if (!origin) {
      return {};
    }

    return {
      shapeType: origin.type,
      borderRadius: origin.radii && origin.radii.length > 0
        ? origin.radii.length === 1 || origin.radii.every(radius => radius === origin.radii?.[0])
          ? origin.radii[0]
          : origin.radii
        : undefined,
    };
  }

  private getShadows(layer: LanhuLayer): SimplifiedShadow[] | undefined {
    const result: SimplifiedShadow[] = [];

    const pushShadow = (type: 'dropShadow' | 'innerShadow', effect?: NonNullable<LanhuLayer['layerEffects']>['dropShadow']) => {
      if (!effect?.enabled || !effect.color) {
        return;
      }

      const distance = effect.distance || 0;
      const angle = effect.localLightingAngle?.value;
      const radians = typeof angle === 'number' ? (angle * Math.PI) / 180 : undefined;
      const x = radians !== undefined ? Math.cos(radians) * distance : 0;
      const y = radians !== undefined ? Math.sin(radians) * distance : distance;

      result.push({
        type,
        color: this.colorToHex(effect.color),
        opacity: effect.opacity ? effect.opacity.value / 100 : 1,
        angle,
        distance,
        blur: effect.blur || 0,
        spread: effect.chokeMatte || 0,
        x: Number(x.toFixed(2)),
        y: Number(y.toFixed(2)),
        blendMode: effect.mode,
      });
    };

    pushShadow('dropShadow', layer.layerEffects?.dropShadow);
    pushShadow('innerShadow', layer.layerEffects?.innerShadow);

    return result.length > 0 ? result : undefined;
  }

  private getAssetUrls(layer: LanhuLayer): Record<string, string> | undefined {
    const urls: Record<string, string> = {
      ...(layer.images || {}),
      ...(layer.ddsImages || {}),
    };

    return Object.keys(urls).length > 0 ? urls : undefined;
  }

  private pickBestAssetUrl(assetUrls?: Record<string, string>): string | undefined {
    if (!assetUrls) {
      return undefined;
    }

    const priority = ['png_xxxhd', 'png_xxhd', 'png_xhd', 'png_hd', 'png', 'webp', 'jpeg', 'jpg'];
    for (const key of priority) {
      if (assetUrls[key]) {
        return assetUrls[key];
      }
    }

    return Object.values(assetUrls)[0];
  }
}

export const lanhuParser = new LanhuParser();

