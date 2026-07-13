import type {
  SimplifiedBounds,
  SimplifiedLayer,
  SimplifiedLayoutHint,
  SimplifiedSpacing,
} from '../types/lanhu.js';

export type LayoutDecisionMode = 'absolute' | 'linear-flow' | 'stacked-lines';

export interface LayoutDecisionEvidence {
  readonly candidate: 'parser' | 'geometry';
  readonly residual: number;
  readonly reason?: string;
}

export interface LayoutDecision {
  readonly mode: LayoutDecisionMode;
  readonly layoutHint?: SimplifiedLayoutHint;
  readonly evidence: LayoutDecisionEvidence;
}

export interface LayoutRenderModel {
  readonly nodes: SimplifiedLayer[];
  readonly decisionsById: ReadonlyMap<number, LayoutDecision>;
}

interface LinearCandidate {
  readonly direction: 'row' | 'column';
  readonly items: SimplifiedLayer[];
  readonly overlays: SimplifiedLayer[];
  readonly source: LayoutDecisionEvidence['candidate'];
  readonly layout?: SimplifiedLayoutHint;
}

interface LinearMeasurement {
  readonly gap: number;
  readonly padding: SimplifiedSpacing;
  readonly justifyContent: NonNullable<SimplifiedLayoutHint['justifyContent']>;
  readonly alignItems: NonNullable<SimplifiedLayoutHint['alignItems']>;
  readonly residual: number;
}

const COORDINATE_TOLERANCE = 2;
const MAX_FLOW_ITEMS = 8;

export function buildLayoutRenderModel(nodes: SimplifiedLayer[]): LayoutRenderModel {
  const decisionsById = new Map<number, LayoutDecision>();
  const normalizedNodes = nodes.map(node => normalizeNode(node, decisionsById));

  return {
    nodes: normalizedNodes,
    decisionsById,
  };
}

export function getLayoutBounds(node: SimplifiedLayer): SimplifiedBounds {
  return node.layoutBounds || node.boundsMetadata?.original || node.boundsMetadata?.path || node.boundsMetadata?.frame || node.bounds;
}

function normalizeNode(node: SimplifiedLayer, decisionsById: Map<number, LayoutDecision>): SimplifiedLayer {
  const children = node.children?.map(child => normalizeNode(child, decisionsById));
  const nextNode = children ? { ...node, children } : { ...node };
  const decision = decideLayout(nextNode);
  decisionsById.set(nextNode.id, decision);

  return {
    ...nextNode,
    sourceLayoutHint: nextNode.layoutHint,
    layoutHint: decision.layoutHint,
    layoutDecision: decision,
  };
}

function decideLayout(node: SimplifiedLayer): LayoutDecision {
  const parserCandidate = toParserCandidate(node);
  const parserDecision = parserCandidate ? decideCandidate(node, parserCandidate) : null;
  if (parserDecision) {
    return parserDecision;
  }

  const geometryCandidate = deriveGeometryCandidate(node);
  const geometryDecision = geometryCandidate ? decideCandidate(node, geometryCandidate) : null;
  if (geometryDecision) {
    return geometryDecision;
  }

  return {
    mode: 'absolute',
    evidence: {
      candidate: parserCandidate ? 'parser' : 'geometry',
      residual: 0,
      reason: parserCandidate ? 'layout-candidate-violates-source-geometry' : 'no-lossless-linear-layout',
    },
  };
}

function toParserCandidate(node: SimplifiedLayer): LinearCandidate | null {
  const layout = node.layoutHint;
  if (!layout || layout.mode === 'absolute') {
    return null;
  }

  const childrenById = new Map((node.children || []).map(child => [child.id, child]));
  const items = layout.itemIds.map(id => childrenById.get(id)).filter(isDefined);
  const overlays = layout.overlayIds.map(id => childrenById.get(id)).filter(isDefined);
  if (items.length < 2 || items.length > MAX_FLOW_ITEMS) {
    return null;
  }

  return {
    direction: layout.mode === 'flex-row' ? 'row' : 'column',
    items,
    overlays,
    source: 'parser',
    layout,
  };
}

function deriveGeometryCandidate(node: SimplifiedLayer): LinearCandidate | null {
  const children = (node.children || []).filter(isLayoutParticipant);
  if (children.length < 2 || children.length > MAX_FLOW_ITEMS) {
    return null;
  }

  const overlays = (node.children || []).filter(child => !children.includes(child));
  const rowCandidate: LinearCandidate = {
    direction: 'row',
    items: sortItems(children, 'row'),
    overlays,
    source: 'geometry',
  };
  const columnCandidate: LinearCandidate = {
    direction: 'column',
    items: sortItems(children, 'column'),
    overlays,
    source: 'geometry',
  };

  const rowMeasurement = measureLinearCandidate(node, rowCandidate);
  const columnMeasurement = measureLinearCandidate(node, columnCandidate);
  if (!rowMeasurement && !columnMeasurement) {
    return null;
  }

  if (!columnMeasurement || rowMeasurement && rowMeasurement.residual <= columnMeasurement.residual) {
    return rowCandidate;
  }

  return columnCandidate;
}

function decideCandidate(node: SimplifiedLayer, candidate: LinearCandidate): LayoutDecision | null {
  if (candidate.layout?.lines?.length) {
    return decideStackedLines(node, candidate);
  }

  const measurement = measureLinearCandidate(node, candidate);
  if (!measurement) {
    return null;
  }

  return {
    mode: 'linear-flow',
    layoutHint: {
      mode: candidate.direction === 'row' ? 'flex-row' : 'flex-column',
      itemIds: candidate.items.map(item => item.id),
      overlayIds: candidate.overlays.map(item => item.id),
      gap: measurement.gap,
      padding: measurement.padding,
      justifyContent: measurement.justifyContent,
      alignItems: measurement.alignItems,
      contentBounds: getBounds(candidate.items),
    },
    evidence: {
      candidate: candidate.source,
      residual: measurement.residual,
    },
  };
}

function decideStackedLines(node: SimplifiedLayer, candidate: LinearCandidate): LayoutDecision | null {
  const sourceLines = candidate.layout?.lines || [];
  if (sourceLines.length < 2) {
    return null;
  }

  const byId = new Map(candidate.items.map(item => [item.id, item]));
  const confirmedLines: Array<{
    line: NonNullable<SimplifiedLayoutHint['lines']>[number];
    items: SimplifiedLayer[];
    measurement: Pick<LinearMeasurement, 'residual' | 'gap' | 'justifyContent' | 'alignItems'>;
  }> = [];
  for (const line of sourceLines) {
    const items = line.itemIds.map(id => byId.get(id)).filter(isDefined);
    if (items.length === 0) {
      return null;
    }

    const rowCandidate: LinearCandidate = {
      direction: 'row',
      items: sortItems(items, 'row'),
      overlays: [],
      source: candidate.source,
    };
    const measurement = items.length === 1
      ? { residual: 0, gap: 0, justifyContent: 'start' as const, alignItems: 'start' as const }
      : measureLinearCandidate({ ...node, bounds: line.bounds, layoutBounds: line.bounds }, rowCandidate);
    if (!measurement) {
      return null;
    }

    confirmedLines.push({ line, items, measurement });
  }

  const verticalResidual = confirmedLines.slice(1).reduce((maximum, entry, index) => {
    const previous = confirmedLines[index];
    const expectedTop = getLayoutBounds(previous.items[0]).y + getBounds(previous.items).height;
    const actualTop = getLayoutBounds(entry.items[0]).y;
    return Math.max(maximum, Math.abs(actualTop - expectedTop - Math.max(0, actualTop - expectedTop)));
  }, 0);
  const residual = Math.max(verticalResidual, ...confirmedLines.map(entry => entry.measurement.residual));
  if (residual > COORDINATE_TOLERANCE) {
    return null;
  }

  return {
    mode: 'stacked-lines',
    layoutHint: {
      mode: 'flex-column',
      itemIds: candidate.items.map(item => item.id),
      overlayIds: candidate.overlays.map(item => item.id),
      gap: 0,
      padding: spacingFromBounds(getLayoutBounds(node), getBounds(candidate.items)),
      justifyContent: 'start',
      alignItems: 'stretch',
      contentBounds: getBounds(candidate.items),
      lines: confirmedLines.map(entry => ({
        ...entry.line,
        itemIds: entry.items.map(item => item.id),
        gap: entry.measurement.gap,
        justifyContent: entry.measurement.justifyContent,
        alignItems: entry.measurement.alignItems,
      })),
    },
    evidence: {
      candidate: candidate.source,
      residual,
    },
  };
}

function measureLinearCandidate(node: SimplifiedLayer, candidate: LinearCandidate): LinearMeasurement | null {
  const parentBounds = getLayoutBounds(node);
  const items = candidate.items;
  if (!items.every(item => isWithinBounds(parentBounds, getLayoutBounds(item)))) {
    return null;
  }

  const bounds = items.map(getLayoutBounds);
  const mainStart = (boundsItem: SimplifiedBounds) => candidate.direction === 'row' ? boundsItem.x : boundsItem.y;
  const mainSize = (boundsItem: SimplifiedBounds) => candidate.direction === 'row' ? boundsItem.width : boundsItem.height;
  const crossStart = (boundsItem: SimplifiedBounds) => candidate.direction === 'row' ? boundsItem.y : boundsItem.x;
  const crossSize = (boundsItem: SimplifiedBounds) => candidate.direction === 'row' ? boundsItem.height : boundsItem.width;
  const orderedBounds = [...bounds].sort((left, right) => mainStart(left) - mainStart(right));
  const gaps = orderedBounds.slice(1).map((item, index) => mainStart(item) - (mainStart(orderedBounds[index]) + mainSize(orderedBounds[index])));
  if (gaps.some(gap => gap < -COORDINATE_TOLERANCE)) {
    return null;
  }

  const gap = median(gaps);
  const gapResidual = Math.max(0, ...gaps.map(value => Math.abs(value - gap)));
  const crossStarts = orderedBounds.map(crossStart);
  const crossEnds = orderedBounds.map(boundsItem => crossStart(boundsItem) + crossSize(boundsItem));
  const crossCenters = orderedBounds.map(boundsItem => crossStart(boundsItem) + crossSize(boundsItem) / 2);
  const startResidual = spread(crossStarts);
  const endResidual = spread(crossEnds);
  const centerResidual = spread(crossCenters);
  const alignment = minBy([
    { value: 'start' as const, residual: startResidual },
    { value: 'end' as const, residual: endResidual },
    { value: 'center' as const, residual: centerResidual },
  ], item => item.residual);
  const residual = Math.max(gapResidual, alignment.residual);
  if (residual > COORDINATE_TOLERANCE) {
    return null;
  }

  const contentBounds = getBounds(items);
  const padding = spacingFromBounds(parentBounds, contentBounds);
  if (Object.values(padding).some(value => value < -COORDINATE_TOLERANCE)) {
    return null;
  }

  return {
    gap: round(Math.max(0, gap)),
    padding: normalizeSpacing(padding),
    justifyContent: 'start',
    alignItems: alignment.value,
    residual: round(residual),
  };
}

function isLayoutParticipant(node: SimplifiedLayer): boolean {
  if (!node.visible || node.clip?.isMask || node.clip?.clipped) {
    return false;
  }
  if (node.opacity !== undefined && node.opacity < 0.05 && !node.text) {
    return false;
  }
  if (!node.text && isBackgroundCoverage(node)) {
    return false;
  }
  return true;
}

function isBackgroundCoverage(node: SimplifiedLayer): boolean {
  const bounds = getLayoutBounds(node);
  return Boolean(node.fill || node.assetUrl || node.stroke)
    && bounds.width * bounds.height > 0
    && !node.children?.length;
}

function isWithinBounds(parent: SimplifiedBounds, child: SimplifiedBounds): boolean {
  return child.x >= parent.x - COORDINATE_TOLERANCE
    && child.y >= parent.y - COORDINATE_TOLERANCE
    && child.x + child.width <= parent.x + parent.width + COORDINATE_TOLERANCE
    && child.y + child.height <= parent.y + parent.height + COORDINATE_TOLERANCE;
}

function spacingFromBounds(parent: SimplifiedBounds, content: SimplifiedBounds): SimplifiedSpacing {
  return {
    top: round(content.y - parent.y),
    right: round(parent.x + parent.width - (content.x + content.width)),
    bottom: round(parent.y + parent.height - (content.y + content.height)),
    left: round(content.x - parent.x),
  };
}

function getBounds(nodes: SimplifiedLayer[]): SimplifiedBounds {
  const bounds = nodes.map(getLayoutBounds);
  const minX = Math.min(...bounds.map(item => item.x));
  const minY = Math.min(...bounds.map(item => item.y));
  const maxX = Math.max(...bounds.map(item => item.x + item.width));
  const maxY = Math.max(...bounds.map(item => item.y + item.height));

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

function sortItems(items: SimplifiedLayer[], direction: 'row' | 'column'): SimplifiedLayer[] {
  return [...items].sort((left, right) => {
    const leftBounds = getLayoutBounds(left);
    const rightBounds = getLayoutBounds(right);
    return direction === 'row'
      ? leftBounds.x - rightBounds.x || leftBounds.y - rightBounds.y
      : leftBounds.y - rightBounds.y || leftBounds.x - rightBounds.x;
  });
}

function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function spread(values: number[]): number {
  return values.length === 0 ? 0 : Math.max(...values) - Math.min(...values);
}

function minBy<T>(items: T[], selector: (item: T) => number): T {
  return items.reduce((best, item) => selector(item) < selector(best) ? item : best);
}

function normalizeSpacing(spacing: SimplifiedSpacing): SimplifiedSpacing {
  return {
    top: round(Math.max(0, spacing.top)),
    right: round(Math.max(0, spacing.right)),
    bottom: round(Math.max(0, spacing.bottom)),
    left: round(Math.max(0, spacing.left)),
  };
}

function round(value: number): number {
  return Number(value.toFixed(2));
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}