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
  RestorationPlan,
  SimplifiedFill,
  SimplifiedGradient,
  SimplifiedLayer,
  SimplifiedClipMetadata,
  SimplifiedShadow,
  SimplifiedTextMetrics,
  SimplifiedTextStyle,
  SimplifiedTextStyleRange,
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

    const buildNodes = (
      layers: LanhuLayer[],
      depth: number,
      parentId?: number,
    ): SimplifiedLayer[] => {
      const clipRelationships = this.resolveClipRelationships(layers);

      return layers
        .map(layer => buildNode(layer, depth, parentId, clipRelationships))
        .filter((layer): layer is SimplifiedLayer => layer !== null);
    };

    const buildNode = (
      layer: LanhuLayer,
      depth: number,
      parentId: number | undefined,
      clipRelationships: Map<number, SimplifiedClipMetadata>,
    ): SimplifiedLayer | null => {
      if (!includeInvisible && !layer.visible) {
        return null;
      }

      const fills = this.getFills(layer);
      const gradientFill = fills?.find(fill => fill.type === 'gradient')?.gradient;
      const primaryFill = fills?.find(fill => fill.type === 'solid')?.color
        ?? (gradientFill ? this.gradientToCss(gradientFill) : undefined);
      const assetUrls = this.getAssetUrls(layer);
      const boundsMetadata = this.getBoundsMetadata(layer, artboard, normalizeToArtboard)!;
      const bounds = boundsMetadata.visual || boundsMetadata.original || boundsMetadata.frame;
      const shapeMetadata = this.getShapeMetadata(layer);
      const assetUrl = this.pickBestAssetUrl(assetUrls);
      const renderStrategy = this.getRenderStrategy(layer, assetUrl);
      const textStyle = layer.text && layer.textInfo ? this.extractTextStyle(layer.textInfo) : undefined;
      const pathData = this.getPathData(layer, artboard, normalizeToArtboard);
      const node: SimplifiedLayer = {
        id: layer.id,
        name: layer.name,
        type: this.getLayerTypeName(layer),
        sourceType: layer.type,
        visible: layer.visible,
        clipped: layer.clipped,
        isClippingMask: layer.isClippingMask,
        isAsset: layer.isAsset,
        parentId,
        depth,
        zIndex: zIndex++,
        bounds,
        boundsMetadata,
        intersectsArtboard: this.intersectsArtboard(bounds, artboard),
        partiallyOutsideArtboard: this.isPartiallyOutsideArtboard(bounds, artboard),
        fill: primaryFill,
        fills,
        stroke: this.getStroke(layer),
        opacity: this.getOpacity(layer),
        fillOpacity: this.getFillOpacity(layer),
        blendMode: layer.blendOptions?.mode,
        borderRadius: shapeMetadata.borderRadius,
        shapeType: shapeMetadata.shapeType,
        pathSummary: pathData ? {
          componentCount: pathData.componentCount,
          pointCount: pathData.pointCount,
          originType: pathData.originType,
          pathBounds: pathData.pathBounds,
          hasComplexGeometry: pathData.hasComplexGeometry,
        } : undefined,
        pathData,
        shadows: this.getShadows(layer),
        clip: this.getClipMetadata(layer, clipRelationships, artboard, normalizeToArtboard),
        adjustment: this.getAdjustment(layer),
        assetUrl,
        assetUrls: assetUrls && Object.keys(assetUrls).length > 0 ? assetUrls : undefined,
        renderStrategy,
        shouldRenderChildren: !(renderStrategy === 'asset' && Array.isArray(layer.layers) && layer.layers.length > 0),
      };

      if (layer.text && layer.textInfo) {
        node.text = layer.textInfo.text;
        node.textStyle = textStyle;
        node.textStyleRanges = this.extractTextStyleRanges(layer.textInfo);
        node.textMetrics = this.extractTextMetrics(layer.textInfo);
      }

      if (Array.isArray(layer.layers) && layer.layers.length > 0 && depth < maxDepth) {
        const children = buildNodes(layer.layers, depth + 1, layer.id);
        if (children.length > 0) {
          node.children = children;
        }
      }

      return node;
    };

    const tree = buildNodes(document.board.layers, 0);
    this.applyLayoutHints(tree);
    return tree;
  }

  buildRestorationPlan(layers: SimplifiedLayer[]): RestorationPlan {
    const rootIds: number[] = [];
    const paintOrder: Array<{ id: number; zIndex: number }> = [];
    const rasterAssetIds: number[] = [];
    const textLayerIds: number[] = [];
    const clippedLayerIds: number[] = [];
    const partiallyOutsideArtboardIds: number[] = [];
    const flexContainerIds: number[] = [];
    const textAutoSizeIds: number[] = [];
    const maskGroups = new Map<number, { targetIds: number[]; bounds?: SimplifiedLayer['bounds'] }>();

    const walk = (nodes: SimplifiedLayer[], isRoot: boolean) => {
      for (const node of nodes) {
        if (isRoot) {
          rootIds.push(node.id);
        }

        paintOrder.push({ id: node.id, zIndex: node.zIndex ?? 0 });

        if (node.renderStrategy === 'asset') {
          rasterAssetIds.push(node.id);
        }

        if (node.text) {
          textLayerIds.push(node.id);
        }

        if (node.clip?.clipped) {
          clippedLayerIds.push(node.id);
        }

        if (node.partiallyOutsideArtboard) {
          partiallyOutsideArtboardIds.push(node.id);
        }

        if (node.layoutHint && node.layoutHint.mode !== 'absolute') {
          flexContainerIds.push(node.id);
        }

        if (node.sizeHint?.width === 'content' || node.sizeHint?.height === 'content') {
          textAutoSizeIds.push(node.id);
        }

        if (node.clip?.isMask) {
          maskGroups.set(node.id, {
            targetIds: [...(node.clip.targetIds || [])],
            bounds: node.bounds,
          });
        }

        if (node.children?.length) {
          walk(node.children, false);
        }
      }
    };

    walk(layers, true);

    return {
      rootIds,
      paintOrder: paintOrder.sort((left, right) => right.zIndex - left.zIndex).map(entry => entry.id),
      rasterAssetIds,
      textLayerIds,
      clippedLayerIds,
      partiallyOutsideArtboardIds,
      flexContainerIds,
      textAutoSizeIds,
      maskGroups: [...maskGroups.entries()].map(([maskId, group]) => ({
        maskId,
        targetIds: group.targetIds,
        bounds: group.bounds,
      })),
      guidance: [
        'paintOrder 按从背景到前景排序，适合直接作为 DOM 追加顺序或 Canvas 绘制顺序使用。',
        'renderStrategy=asset 的节点优先直接使用 assetUrl，还原效果通常优于重建子图层。',
        'clip.maskId / maskGroups 明确给出了 sibling clipping mask 关系，不应再靠猜测推断。',
        'boundsMetadata.frame / visual / original 可以分别用于布局、投影效果和调试原始设计坐标。',
        'partiallyOutsideArtboardIds 表示节点虽超出画板，但仍可能通过裁剪参与最终画面。',
        'flexContainerIds 标记了适合优先用 flex/盒布局重建的容器，避免所有子节点都走 absolute。',
        'textAutoSizeIds 标记了建议使用内容自适应宽高的节点，文本容器不应强制写死 width/height。',
      ],
    };
  }

  private applyLayoutHints(nodes: SimplifiedLayer[]): void {
    const walk = (node: SimplifiedLayer) => {
      if (node.children?.length) {
        node.children.forEach(walk);
      }

      node.isTextOnlyContainer = this.isTextOnlyContainer(node);
      node.sizeHint = this.getSizeHint(node);
      node.layoutHint = this.inferLayoutHint(node);
      node.containerVisualSourceId = this.findContainerVisualSource(node);
    };

    nodes.forEach(walk);
  }

  private getSizeHint(node: SimplifiedLayer): SimplifiedLayer['sizeHint'] {
    if (node.text || node.isTextOnlyContainer) {
      return {
        width: 'content',
        height: 'content',
      };
    }

    return {
      width: 'fixed',
      height: 'fixed',
    };
  }

  private isTextOnlyContainer(node: SimplifiedLayer): boolean {
    if (!node.children?.length) {
      return false;
    }

    if (this.hasOwnVisual(node)) {
      return false;
    }

    const visibleChildren = node.children.filter(child => (
      child.visible !== false
      && !this.shouldIgnoreForLayout(child)
    ));
    if (visibleChildren.length === 0) {
      return false;
    }

    return visibleChildren.every(child => child.text || child.isTextOnlyContainer);
  }

  private inferLayoutHint(node: SimplifiedLayer): SimplifiedLayer['layoutHint'] {
    if (node.renderStrategy === 'asset' || node.shouldRenderChildren === false) {
      return undefined;
    }

    if (!node.children || node.children.length < 2) {
      return undefined;
    }

    const visibleChildren = node.children.filter(child => (
      child.visible !== false
      && !this.shouldIgnoreForLayout(child)
    ));
    if (visibleChildren.length < 2) {
      return undefined;
    }

    const overlayIds = visibleChildren
      .filter(child => this.isOverlayLikeChild(node, child))
      .map(child => child.id);
    const items = visibleChildren.filter(child => !overlayIds.includes(child.id));

    if (items.length < 2) {
      return undefined;
    }

    const rowLayout = this.measureLinearLayout(node, items, 'row');
    const columnLayout = this.measureLinearLayout(node, items, 'column');
    const chosen = [rowLayout, columnLayout]
      .filter((layout): layout is NonNullable<typeof layout> => layout !== null)
      .sort((left, right) => right.score - left.score)[0];

    if (chosen && chosen.score >= 1.2) {
      return {
        mode: chosen.direction === 'row' ? 'flex-row' : 'flex-column',
        itemIds: chosen.items.map(item => item.id),
        overlayIds,
        gap: chosen.gap,
        padding: chosen.padding,
        justifyContent: chosen.justifyContent,
        alignItems: chosen.alignItems,
        contentBounds: chosen.contentBounds,
      };
    }

    const stacked = this.measureStackedRowsLayout(node, items);
    if (!stacked || stacked.score < 2.4) {
      return undefined;
    }

    return {
      mode: 'flex-column',
      itemIds: stacked.items.map(item => item.id),
      overlayIds,
      gap: 0,
      padding: stacked.padding,
      justifyContent: 'start',
      alignItems: 'stretch',
      contentBounds: stacked.contentBounds,
      lines: stacked.lines,
    };
  }

  private findContainerVisualSource(node: SimplifiedLayer): number | undefined {
    if (this.hasOwnVisual(node) || !node.children?.length) {
      return undefined;
    }

    const candidates = node.children
      .filter(child => this.isContainerVisualSource(node, child))
      .sort((left, right) => this.getContainerVisualScore(node, right) - this.getContainerVisualScore(node, left));

    return candidates[0]?.id;
  }

  private shouldIgnoreForLayout(node: SimplifiedLayer): boolean {
    if (node.text || node.clip?.isMask || node.clip?.clipped) {
      return false;
    }

    return node.opacity !== undefined && node.opacity < 0.05;
  }

  private isContainerVisualSource(parent: SimplifiedLayer, child: SimplifiedLayer): boolean {
    if (
      !child.visible
      || child.text
      || child.clip?.clipped
      || child.clip?.isMask
      || child.children?.length
      || child.renderStrategy !== 'shape'
      || child.opacity === 0
      || child.opacity !== undefined && child.opacity < 0.05
      || !this.hasOwnVisual(child)
    ) {
      return false;
    }

    if (child.pathData?.hasComplexGeometry) {
      return false;
    }

    const toleranceX = Math.max(12, parent.bounds.width * 0.06);
    const toleranceY = Math.max(12, parent.bounds.height * 0.06);
    const parentRight = parent.bounds.x + parent.bounds.width;
    const parentBottom = parent.bounds.y + parent.bounds.height;
    const childRight = child.bounds.x + child.bounds.width;
    const childBottom = child.bounds.y + child.bounds.height;
    const widthCoverage = child.bounds.width / Math.max(parent.bounds.width, 1);
    const heightCoverage = child.bounds.height / Math.max(parent.bounds.height, 1);

    return widthCoverage >= 0.85
      && heightCoverage >= 0.78
      && Math.abs(child.bounds.x - parent.bounds.x) <= toleranceX
      && Math.abs(child.bounds.y - parent.bounds.y) <= toleranceY
      && Math.abs(childRight - parentRight) <= toleranceX
      && Math.abs(childBottom - parentBottom) <= toleranceY;
  }

  private getContainerVisualScore(parent: SimplifiedLayer, child: SimplifiedLayer): number {
    const widthCoverage = child.bounds.width / Math.max(parent.bounds.width, 1);
    const heightCoverage = child.bounds.height / Math.max(parent.bounds.height, 1);
    const edgeDelta = Math.abs(child.bounds.x - parent.bounds.x)
      + Math.abs(child.bounds.y - parent.bounds.y)
      + Math.abs((child.bounds.x + child.bounds.width) - (parent.bounds.x + parent.bounds.width))
      + Math.abs((child.bounds.y + child.bounds.height) - (parent.bounds.y + parent.bounds.height));

    return Number(((widthCoverage + heightCoverage) * 10 - edgeDelta / 10).toFixed(2));
  }

  private measureLinearLayout(
    node: SimplifiedLayer,
    children: SimplifiedLayer[],
    direction: 'row' | 'column',
  ): {
    direction: 'row' | 'column';
    items: SimplifiedLayer[];
    gap: number;
    padding: { top: number; right: number; bottom: number; left: number };
    justifyContent: 'start' | 'center' | 'end' | 'space-between';
    alignItems: 'start' | 'center' | 'end' | 'stretch';
    contentBounds: SimplifiedLayer['bounds'];
    score: number;
  } | null {
    if (children.length < 2) {
      return null;
    }

    const ordered = [...children].sort((left, right) => (
      direction === 'row'
        ? left.bounds.x - right.bounds.x || left.bounds.y - right.bounds.y
        : left.bounds.y - right.bounds.y || left.bounds.x - right.bounds.x
    ));

    const gaps: number[] = [];
    let overlapPenalty = 0;

    for (let index = 1; index < ordered.length; index += 1) {
      const previous = ordered[index - 1];
      const current = ordered[index];
      const previousEnd = direction === 'row'
        ? previous.bounds.x + previous.bounds.width
        : previous.bounds.y + previous.bounds.height;
      const currentStart = direction === 'row' ? current.bounds.x : current.bounds.y;
      const gap = currentStart - previousEnd;
      if (gap >= 0) {
        gaps.push(gap);
      } else {
        overlapPenalty += Math.abs(gap);
      }
    }

    const crossCenters = ordered.map(item => (
      direction === 'row'
        ? item.bounds.y + item.bounds.height / 2
        : item.bounds.x + item.bounds.width / 2
    ));
    const crossSizes = ordered.map(item => direction === 'row' ? item.bounds.height : item.bounds.width);
    const crossSpread = Math.max(...crossCenters) - Math.min(...crossCenters);
    const averageCrossSize = crossSizes.reduce((total, value) => total + value, 0) / crossSizes.length;
    const crossLimit = Math.max(14, averageCrossSize * 0.9);

    if (crossSpread > crossLimit) {
      return null;
    }

    const mainOverlapLimit = direction === 'row'
      ? node.bounds.width * 0.08
      : node.bounds.height * 0.08;
    if (overlapPenalty > mainOverlapLimit) {
      return null;
    }

    const contentBounds = this.getBoundingBounds(ordered);
    const padding = {
      left: Number((contentBounds.x - node.bounds.x).toFixed(2)),
      top: Number((contentBounds.y - node.bounds.y).toFixed(2)),
      right: Number((node.bounds.x + node.bounds.width - (contentBounds.x + contentBounds.width)).toFixed(2)),
      bottom: Number((node.bounds.y + node.bounds.height - (contentBounds.y + contentBounds.height)).toFixed(2)),
    };

    const gap = gaps.length > 0 ? Number(this.median(gaps).toFixed(2)) : 0;
    const leading = direction === 'row' ? padding.left : padding.top;
    const trailing = direction === 'row' ? padding.right : padding.bottom;
    const justifyContent = gap > 0
      && gaps.length === ordered.length - 1
      && Math.abs(leading - trailing) <= Math.max(12, gap * 1.2)
      && this.getVariance(gaps) <= Math.max(16, gap * 1.2)
      ? 'space-between'
      : 'start';

    const topOrLeftValues = ordered.map(item => direction === 'row' ? item.bounds.y : item.bounds.x);
    const endValues = ordered.map(item => direction === 'row'
      ? item.bounds.y + item.bounds.height
      : item.bounds.x + item.bounds.width);
    const startSpread = Math.max(...topOrLeftValues) - Math.min(...topOrLeftValues);
    const endSpread = Math.max(...endValues) - Math.min(...endValues);
    const alignItems = crossSpread <= Math.max(8, averageCrossSize * 0.45)
      ? 'center'
      : startSpread <= endSpread
        ? 'start'
        : 'end';

    const coverage = direction === 'row'
      ? contentBounds.width / Math.max(node.bounds.width, 1)
      : contentBounds.height / Math.max(node.bounds.height, 1);
    const score = Number((children.length + coverage * 1.5 - overlapPenalty / 20 - crossSpread / Math.max(averageCrossSize, 1)).toFixed(2));

    return {
      direction,
      items: ordered,
      gap,
      padding,
      justifyContent,
      alignItems,
      contentBounds,
      score,
    };
  }

  private measureStackedRowsLayout(
    node: SimplifiedLayer,
    children: SimplifiedLayer[],
  ): {
    items: SimplifiedLayer[];
    padding: { top: number; right: number; bottom: number; left: number };
    contentBounds: SimplifiedLayer['bounds'];
    lines: NonNullable<SimplifiedLayer['layoutHint']>['lines'];
    score: number;
  } | null {
    if (children.length < 2) {
      return null;
    }

    const lines = this.groupChildrenIntoRows(children);
    if (lines.length < 2) {
      return null;
    }

    const multiItemLineCount = lines.filter(line => line.length > 1).length;
    const semanticItemCount = children.filter(child => child.layoutHint || child.text || child.isTextOnlyContainer).length;
    if (multiItemLineCount === 0 && semanticItemCount < 3) {
      return null;
    }

    const contentBounds = this.getBoundingBounds(children);
    const padding = {
      left: Number((contentBounds.x - node.bounds.x).toFixed(2)),
      top: Number((contentBounds.y - node.bounds.y).toFixed(2)),
      right: Number((node.bounds.x + node.bounds.width - (contentBounds.x + contentBounds.width)).toFixed(2)),
      bottom: Number((node.bounds.y + node.bounds.height - (contentBounds.y + contentBounds.height)).toFixed(2)),
    };

    let overlapPenalty = 0;
    const rowMetadata = lines.map(lineItems => {
      const ordered = [...lineItems].sort((left, right) => left.bounds.x - right.bounds.x || left.bounds.y - right.bounds.y);
      const bounds = this.getBoundingBounds(ordered);
      const rowNode = {
        ...node,
        bounds: {
          ...bounds,
          x: contentBounds.x,
          width: contentBounds.width,
        },
      } as SimplifiedLayer;
      const rowLayout = ordered.length > 1
        ? this.measureLinearLayout(rowNode, ordered, 'row')
        : null;

      return {
        items: ordered,
        bounds,
        gap: rowLayout?.gap || 0,
        justifyContent: rowLayout?.justifyContent || 'start',
        alignItems: rowLayout?.alignItems || 'start',
      };
    });

    for (let index = 1; index < rowMetadata.length; index += 1) {
      const previous = rowMetadata[index - 1];
      const current = rowMetadata[index];
      const gap = current.bounds.y - (previous.bounds.y + previous.bounds.height);
      if (gap < -6) {
        overlapPenalty += Math.abs(gap);
      }
    }

    const verticalCoverage = contentBounds.height / Math.max(node.bounds.height, 1);
    const score = Number((
      lines.length
      + multiItemLineCount * 1.35
      + semanticItemCount * 0.2
      + verticalCoverage
      - overlapPenalty / 12
    ).toFixed(2));

    if (overlapPenalty > Math.max(18, node.bounds.height * 0.04)) {
      return null;
    }

    return {
      items: rowMetadata.flatMap(line => line.items),
      padding,
      contentBounds,
      lines: rowMetadata.map(line => ({
        itemIds: line.items.map(item => item.id),
        bounds: line.bounds,
        gap: line.gap,
        justifyContent: line.justifyContent,
        alignItems: line.alignItems,
      })),
      score,
    };
  }

  private groupChildrenIntoRows(children: SimplifiedLayer[]): SimplifiedLayer[][] {
    const ordered = [...children].sort((left, right) => left.bounds.y - right.bounds.y || left.bounds.x - right.bounds.x);
    const rows: SimplifiedLayer[][] = [];

    for (const child of ordered) {
      const currentRow = rows[rows.length - 1];
      if (!currentRow || !this.belongsToRow(currentRow, child)) {
        rows.push([child]);
        continue;
      }
      currentRow.push(child);
    }

    return rows;
  }

  private belongsToRow(row: SimplifiedLayer[], candidate: SimplifiedLayer): boolean {
    const rowBounds = this.getBoundingBounds(row);
    const rowCenterY = row.reduce((total, item) => total + item.bounds.y + item.bounds.height / 2, 0) / row.length;
    const candidateCenterY = candidate.bounds.y + candidate.bounds.height / 2;
    const minHeight = Math.min(
      candidate.bounds.height,
      ...row.map(item => item.bounds.height),
    );
    const centerTolerance = Math.max(12, minHeight * 0.7);
    const overlap = Math.min(
      rowBounds.y + rowBounds.height,
      candidate.bounds.y + candidate.bounds.height,
    ) - Math.max(rowBounds.y, candidate.bounds.y);

    return overlap >= -4 && Math.abs(candidateCenterY - rowCenterY) <= centerTolerance;
  }

  private hasOwnVisual(node: SimplifiedLayer): boolean {
    return Boolean(
      node.fill
      || node.stroke
      || node.assetUrl
      || node.shadows?.length
      || node.adjustment
      || (node.renderStrategy === 'shape' && node.pathData?.components?.length),
    );
  }

  private isOverlayLikeChild(parent: SimplifiedLayer, child: SimplifiedLayer): boolean {
    if (child.clip?.isMask || child.clip?.clipped) {
      return true;
    }

    if (child.sizeHint?.width === 'content' && child.sizeHint?.height === 'content') {
      return false;
    }

    const parentArea = Math.max(parent.bounds.width * parent.bounds.height, 1);
    const childArea = child.bounds.width * child.bounds.height;
    const coversParent = child.bounds.width >= parent.bounds.width * 0.82
      && child.bounds.height >= parent.bounds.height * 0.72;

    return this.hasOwnVisual(child) && (coversParent || childArea / parentArea > 0.62);
  }

  private getBoundingBounds(nodes: SimplifiedLayer[]): SimplifiedLayer['bounds'] {
    const minX = Math.min(...nodes.map(node => node.bounds.x));
    const minY = Math.min(...nodes.map(node => node.bounds.y));
    const maxX = Math.max(...nodes.map(node => node.bounds.x + node.bounds.width));
    const maxY = Math.max(...nodes.map(node => node.bounds.y + node.bounds.height));

    return {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
      absoluteX: nodes[0]?.bounds.absoluteX,
      absoluteY: nodes[0]?.bounds.absoluteY,
    };
  }

  private median(values: number[]): number {
    if (values.length === 0) {
      return 0;
    }

    const sorted = [...values].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0
      ? (sorted[middle - 1] + sorted[middle]) / 2
      : sorted[middle];
  }

  private getVariance(values: number[]): number {
    if (values.length === 0) {
      return 0;
    }

    const average = values.reduce((total, value) => total + value, 0) / values.length;
    return values.reduce((total, value) => total + Math.abs(value - average), 0) / values.length;
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
          colors.add(shadow.color);
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

    return this.normalizeBounds(raw.bounds, raw.isAbsolute, artboard, normalizeToArtboard);
  }

  private getBoundsMetadata(layer: LanhuLayer, artboard: ArtboardInfo, normalizeToArtboard: boolean): SimplifiedLayer['boundsMetadata'] {
    const frameRaw = this.getRawBounds(layer);
    const visual = layer.boundsWithFX ? this.normalizeBounds(layer.boundsWithFX, true, artboard, normalizeToArtboard) : undefined;
    const original = layer._orgBounds ? this.normalizeBounds(layer._orgBounds, true, artboard, normalizeToArtboard) : undefined;
    const path = layer.path?.bounds ? this.normalizeBounds(layer.path.bounds, true, artboard, normalizeToArtboard) : undefined;

    return {
      frame: frameRaw ? this.normalizeBounds(frameRaw.bounds, frameRaw.isAbsolute, artboard, normalizeToArtboard) : {
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        absoluteX: 0,
        absoluteY: 0,
      },
      visual,
      original,
      path,
    };
  }

  private normalizeBounds(
    bounds: LanhuBounds,
    isAbsolute: boolean,
    artboard: ArtboardInfo,
    normalizeToArtboard: boolean,
  ): SimplifiedLayer['bounds'] {
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

  private toRelativeRect(bounds?: LanhuBounds | null) {
    if (!bounds) {
      return undefined;
    }

    return {
      left: bounds.left,
      top: bounds.top,
      right: bounds.right,
      bottom: bounds.bottom,
      width: bounds.right - bounds.left,
      height: bounds.bottom - bounds.top,
    };
  }

  private intersectsArtboard(bounds: SimplifiedLayer['bounds'], artboard: ArtboardInfo): boolean {
    return bounds.x < artboard.width
      && bounds.y < artboard.height
      && bounds.x + bounds.width > 0
      && bounds.y + bounds.height > 0;
  }

  private isPartiallyOutsideArtboard(bounds: SimplifiedLayer['bounds'], artboard: ArtboardInfo): boolean {
    return this.intersectsArtboard(bounds, artboard) && (
      bounds.x < 0
      || bounds.y < 0
      || bounds.x + bounds.width > artboard.width
      || bounds.y + bounds.height > artboard.height
    );
  }

  private extractTextStyle(textInfo: LanhuLayer['textInfo']): SimplifiedTextStyle | undefined {
    if (!textInfo) {
      return undefined;
    }

    const firstStyle = textInfo.textStyleRange?.[0]?.textStyle;
    const fontSize = firstStyle?.size || textInfo.size || 14;
    const fontName = firstStyle?.fontName || textInfo.fontName || firstStyle?.fontPostScriptName || textInfo.fontPostScriptName || 'sans-serif';
    const fontDescriptor = `${textInfo.fontStyleName || ''} ${firstStyle?.fontStyleName || ''} ${textInfo.fontPostScriptName || ''} ${firstStyle?.fontPostScriptName || ''}`.toLowerCase();

    return {
      fontSize,
      fontFamily: fontName,
      fontWeight: this.inferFontWeight(fontDescriptor, Boolean(textInfo.bold)),
      fontStyle: textInfo.italic || fontDescriptor.includes('italic') ? 'italic' : 'normal',
      color: firstStyle?.color ? this.colorToHex(firstStyle.color) : textInfo.color ? this.colorToHex(textInfo.color) : '#000000',
      alignment: textInfo.justification || 'left',
      lineHeight: this.normalizeTextLineHeight(textInfo, fontSize),
      letterSpacing: textInfo.tracking ?? undefined,
    };
  }

  private normalizeTextLineHeight(textInfo: LanhuLayer['textInfo'], fontSize: number): number | undefined {
    const leading = textInfo?.leading ?? undefined;
    if (leading === undefined || leading === null || !Number.isFinite(leading) || leading <= 0) {
      return undefined;
    }

    const isSingleLine = !String(textInfo?.text || '').includes('\n');
    if (!isSingleLine) {
      return Number(leading.toFixed(2));
    }

    const boundsHeight = this.getRelativeRectHeight(textInfo?.bounds);
    const boundingBoxHeight = this.getRelativeRectHeight(textInfo?.boundingBox);
    const generousLimit = Math.max(
      fontSize * 1.35,
      boundsHeight ? boundsHeight * 1.15 : 0,
      boundingBoxHeight ? boundingBoxHeight * 1.35 : 0,
    );

    if (leading > generousLimit) {
      return undefined;
    }

    return Number(leading.toFixed(2));
  }

  private getRelativeRectHeight(bounds?: LanhuBounds | null): number {
    if (!bounds) {
      return 0;
    }

    return Math.max(bounds.bottom - bounds.top, 0);
  }

  private extractTextStyleRanges(textInfo: LanhuLayer['textInfo']): SimplifiedTextStyleRange[] | undefined {
    if (!textInfo?.textStyleRange?.length) {
      return undefined;
    }

    return textInfo.textStyleRange.map(range => {
      const descriptor = `${range.textStyle.fontStyleName || ''} ${range.textStyle.fontPostScriptName || ''}`.toLowerCase();
      return {
        from: range.from,
        to: range.to,
        fontSize: range.textStyle.size,
        fontFamily: range.textStyle.fontName || range.textStyle.fontPostScriptName,
        fontWeight: this.inferFontWeight(descriptor, false),
        fontStyle: /italic/.test(descriptor) ? 'italic' : 'normal',
        color: range.textStyle.color ? this.colorToHex(range.textStyle.color) : undefined,
      };
    });
  }

  private extractTextMetrics(textInfo: LanhuLayer['textInfo']): SimplifiedTextMetrics | undefined {
    if (!textInfo) {
      return undefined;
    }

    return {
      relativeBounds: this.toRelativeRect(textInfo.bounds),
      relativeBoundingBox: this.toRelativeRect(textInfo.boundingBox),
      antiAlias: textInfo.antiAlias,
      frameBaselineAlignment: textInfo.textShape?.[0]?.frameBaselineAlignment,
      baselineShift: textInfo.baselineShift ?? undefined,
      horizontalScale: textInfo.horizontalScale ?? undefined,
      verticalScale: textInfo.verticalScale ?? undefined,
      transformScaleX: textInfo._orgTransform?.xx,
      transformScaleY: textInfo._orgTransform?.yy,
    };
  }

  private inferFontWeight(fontDescriptor: string, isBold: boolean): number {
    if (isBold || /black|heavy/.test(fontDescriptor)) {
      return 900;
    }
    if (/extrabold|ultrabold/.test(fontDescriptor)) {
      return 800;
    }
    if (/bold/.test(fontDescriptor)) {
      return 700;
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
    if (/thin|hairline/.test(fontDescriptor)) {
      return 200;
    }
    return 400;
  }

  private getFills(layer: LanhuLayer): SimplifiedFill[] | undefined {
    const fills: SimplifiedFill[] = [];

    if (layer.fill?.color) {
      fills.push({ type: 'solid', color: this.colorToHex(layer.fill.color) });
    }

    if (layer.fill?.gradientFill || layer.fill?.gradient || layer.fill?.class === 'gradientLayer') {
      const gradient = this.extractGradient(layer.fill);
      if (gradient) {
        fills.push({ type: 'gradient', gradient });
      }
    }

    if (layer.layerEffects?.solidFill?.enabled && layer.layerEffects.solidFill.color) {
      fills.push({ type: 'solid', color: this.colorToHex(layer.layerEffects.solidFill.color) });
    }

    return fills.length > 0 ? fills : undefined;
  }

  private extractGradient(fill: LanhuFill, gradientFill?: LanhuGradientFill): SimplifiedGradient | undefined {
    const source = gradientFill || fill.gradientFill;
    const gradientSource = (fill.gradient || source?.gradient) as ({
      type?: string;
      angle?: number;
      colors?: Array<{
        location?: number;
        color?: LanhuColor;
        opacity?: { value: number; units: string };
      }>;
    } | undefined);
    const stops = gradientSource?.colors || source?.colors;
    const transparencies = fill.gradient?.transparency;
    if (!stops || stops.length === 0) {
      return undefined;
    }

    return {
      type: gradientSource?.type || source?.type || fill.type || fill.gradient?.gradientForm || source?.gradientForm || fill.class || 'linear',
      angle: this.normalizeGradientAngle(typeof source?.angle === 'number' ? source.angle : fill.angle?.value),
      stops: stops.map((stop, index) => ({
        position: typeof stop.location === 'number' ? stop.location / 4096 : index / Math.max(stops.length - 1, 1),
        color: stop.color ? this.colorToHex(stop.color) : '#000000',
        opacity: stop.opacity ? stop.opacity.value / 100 : transparencies?.[index]?.opacity ? transparencies[index].opacity.value / 100 : undefined,
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

  private normalizeGradientAngle(angle?: number): number | undefined {
    if (typeof angle !== 'number' || !Number.isFinite(angle)) {
      return undefined;
    }

    const normalized = 90 - angle;
    if (normalized === 0) {
      return 0;
    }

    return Number(normalized.toFixed(2));
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
    if (layer.blendOptions?.fillOpacity) {
      return layer.blendOptions.fillOpacity.value / 100;
    }
    if (layer.layerEffects?.solidFill?.opacity) {
      return layer.layerEffects.solidFill.opacity.value / 100;
    }
    return undefined;
  }

  private getFillOpacity(layer: LanhuLayer): number | undefined {
    if (layer.blendOptions?.fillOpacity) {
      return layer.blendOptions.fillOpacity.value / 100;
    }

    return undefined;
  }

  private getShapeMetadata(layer: LanhuLayer): { shapeType?: string; borderRadius?: number | number[] } {
    const origin = layer.path?.pathComponents?.find(component => component.origin)?.origin;
    if (!origin) {
      return {};
    }

    const radii = origin.radii && origin.radii.length > 0
      ? this.normalizeBorderRadii(origin.radii)
      : undefined;

    return {
      shapeType: origin.type,
      borderRadius: radii
        ? radii.length === 1 || radii.every(radius => radius === radii[0])
          ? radii[0]
          : radii
        : undefined,
    };
  }

  private normalizeBorderRadii(radii: number[]): number[] {
    if (radii.length < 4) {
      return [...radii];
    }

    // Lanhu/Sketch radii order is TR, BR, BL, TL; convert to CSS TL, TR, BR, BL.
    return [radii[3], radii[0], radii[1], radii[2]];
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

  private getClipMetadata(
    layer: LanhuLayer,
    clipRelationships: Map<number, SimplifiedClipMetadata>,
    artboard: ArtboardInfo,
    normalizeToArtboard: boolean,
  ): SimplifiedClipMetadata | undefined {
    const relationship = clipRelationships.get(layer.id);
    const beforeClipBounds = layer.beforeClippedFrame
      ? this.normalizeBounds(layer.beforeClippedFrame, true, artboard, normalizeToArtboard)
      : undefined;

    if (!relationship && !beforeClipBounds && !layer.isClippingMask && !layer.clipped) {
      return undefined;
    }

    return {
      clipped: layer.clipped,
      isMask: Boolean(layer.isClippingMask),
      maskId: relationship?.maskId,
      targetIds: relationship?.targetIds,
      beforeClipBounds,
    };
  }

  private resolveClipRelationships(layers: LanhuLayer[]): Map<number, SimplifiedClipMetadata> {
    const relationships = new Map<number, SimplifiedClipMetadata>();

    const appendTarget = (maskId: number, targetId: number) => {
      const current = relationships.get(maskId) || {
        clipped: false,
        isMask: true,
        targetIds: [],
      };
      current.targetIds = [...(current.targetIds || []), targetId];
      relationships.set(maskId, current);
    };

    const findMask = (start: number, direction: 1 | -1): LanhuLayer | undefined => {
      for (let index = start + direction; index >= 0 && index < layers.length; index += direction) {
        const candidate = layers[index];
        if (candidate.isClippingMask) {
          return candidate;
        }
        if (!candidate.clipped) {
          break;
        }
      }
      return undefined;
    };

    for (let index = 0; index < layers.length; index += 1) {
      const layer = layers[index];

      if (layer.isClippingMask) {
        relationships.set(layer.id, {
          clipped: false,
          isMask: true,
          targetIds: relationships.get(layer.id)?.targetIds || [],
        });
      }

      if (!layer.clipped) {
        continue;
      }

      const mask = findMask(index, 1) || findMask(index, -1);
      relationships.set(layer.id, {
        clipped: true,
        isMask: Boolean(layer.isClippingMask),
        maskId: mask?.id,
      });

      if (mask) {
        appendTarget(mask.id, layer.id);
      }
    }

    return relationships;
  }

  private getAdjustment(layer: LanhuLayer) {
    if (layer.type !== 'adjustmentLayer' || !layer.adjustment) {
      return undefined;
    }

    const adjustmentData = layer.adjustment as {
      class?: string;
      presetKind?: string;
      adjustment?: Array<{
        channel?: string;
        curve?: Array<{
          horizontal?: number;
          vertical?: number;
        }>;
      }>;
    };

    return {
      type: adjustmentData.class,
      presetKind: adjustmentData.presetKind,
      clipped: layer.clipped,
      curves: adjustmentData.adjustment?.map(item => ({
        channel: item.channel,
        points: (item.curve || []).map(point => ({
          x: point.horizontal || 0,
          y: point.vertical || 0,
        })),
      })),
    };
  }

  private getPathData(layer: LanhuLayer, artboard: ArtboardInfo, normalizeToArtboard: boolean) {
    const components = layer.path?.pathComponents || [];
    if (components.length === 0) {
      return undefined;
    }

    const pointCount = components.reduce((total, component) => (
      total + (component.subpathListKey || []).reduce((pointsTotal, subpath) => pointsTotal + subpath.points.length, 0)
    ), 0);
    const originType = components.find(component => component.origin?.type)?.origin?.type;

    return {
      componentCount: components.length,
      pointCount,
      originType,
      pathBounds: layer.path?.bounds ? this.normalizeBounds(layer.path.bounds, true, artboard, normalizeToArtboard) : undefined,
      hasComplexGeometry: pointCount > 16 || components.length > 1,
      components: components.map(component => ({
        operation: component.shapeOperation,
        originType: component.origin?.type,
        originBounds: component.origin?.bounds
          ? this.normalizeBounds(component.origin.bounds, true, artboard, normalizeToArtboard)
          : undefined,
        radii: component.origin?.radii,
          subpaths: (component.subpathListKey || []).map(subpath => ({
            closed: subpath.closedSubpath,
            points: subpath.points.map(point => ({
              anchor: this.normalizePoint(point.anchor, artboard, normalizeToArtboard),
              forward: this.normalizePoint(point.forward || point.anchor, artboard, normalizeToArtboard),
              backward: this.normalizePoint(point.backward || point.anchor, artboard, normalizeToArtboard),
              smooth: point.smooth,
            })),
          })),
        })),
    };
  }

  private normalizePoint(
    point: { x: number; y: number } | undefined,
    artboard: ArtboardInfo,
    normalizeToArtboard: boolean,
  ) {
    const safePoint = point || { x: artboard.x, y: artboard.y };
    return {
      x: Number((normalizeToArtboard ? safePoint.x - artboard.x : safePoint.x).toFixed(3)),
      y: Number((normalizeToArtboard ? safePoint.y - artboard.y : safePoint.y).toFixed(3)),
    };
  }

  private getRenderStrategy(layer: LanhuLayer, assetUrl?: string) {
    if (layer.type === 'adjustmentLayer') {
      return 'adjustment';
    }

    if (layer.text && layer.textInfo) {
      return 'text';
    }

    if (assetUrl && (layer.isAsset || layer.pixels || layer.type === 'smartObjectLayer' || layer.type === 'layerSection')) {
      return 'asset';
    }

    if (layer.type === 'shapeLayer') {
      return 'shape';
    }

    if (Array.isArray(layer.layers) && layer.layers.length > 0) {
      return 'group';
    }

    return 'layer';
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

