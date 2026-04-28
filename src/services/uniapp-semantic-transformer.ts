import type {
  ArtboardInfo,
  SimplifiedBounds,
  SimplifiedLayer,
  SimplifiedLayoutHint,
  SimplifiedSpacing,
} from '../types/lanhu.js';

interface SemanticHint {
  readonly baseClass: string;
  readonly semanticClasses: string[];
  readonly role: string;
}

interface PatternMatch extends SemanticHint {
  readonly childHints?: Map<number, SemanticHint>;
  readonly layoutOverride?: SimplifiedLayoutHint;
}

export interface UniAppSemanticMetadata {
  readonly primaryClass: string;
  readonly semanticClasses: string[];
  readonly role: string;
}

export interface UniAppRenderModel {
  readonly nodes: SimplifiedLayer[];
  readonly metadataById: Map<number, UniAppSemanticMetadata>;
}

const SECTION_NAME_PATTERNS = /菜单|数据|通知|公告|推荐|车源|标签栏|footer|tab|banner|快捷/i;

export function buildUniAppRenderModel(
  nodes: SimplifiedLayer[],
  artboard: ArtboardInfo,
): UniAppRenderModel {
  const normalizedNodes = nodes
    .map(node => normalizeRenderNode(node, artboard))
    .filter((node): node is SimplifiedLayer => Boolean(node));
  const metadataById = new Map<number, UniAppSemanticMetadata>();
  const classUsage = new Map<string, number>();

  normalizedNodes.forEach(node => {
    annotateRenderNode(node, artboard, metadataById, classUsage);
  });

  return {
    nodes: normalizedNodes,
    metadataById,
  };
}

function normalizeRenderNode(node: SimplifiedLayer, artboard: ArtboardInfo): SimplifiedLayer | null {
  const originalChildren = node.children || [];
  const normalizedEntries = originalChildren.map(child => ({
    originalId: child.id,
    node: normalizeRenderNode(child, artboard),
  }));
  const normalizedChildren = normalizedEntries
    .map(entry => entry.node)
    .filter((child): child is SimplifiedLayer => Boolean(child));
  const childIdAliases = new Map<number, number>();
  for (const entry of normalizedEntries) {
    if (entry.node && entry.node.id !== entry.originalId) {
      childIdAliases.set(entry.originalId, entry.node.id);
    }
  }

  const remappedLayoutHint = remapChildLayoutHint(
    node.layoutHint,
    childIdAliases,
    new Set(normalizedChildren.map(child => child.id)),
  );
  const childrenChanged = normalizedChildren.length !== originalChildren.length
    || normalizedChildren.some((child, index) => child !== originalChildren[index]);
  const layoutHintChanged = !isSameLayout(node.layoutHint, remappedLayoutHint);
  const nextNode = childrenChanged || layoutHintChanged
    ? {
        ...node,
        children: normalizedChildren.length > 0 ? normalizedChildren : undefined,
        layoutHint: remappedLayoutHint,
      }
    : node;

  if (shouldPruneNode(nextNode)) {
    return null;
  }

  if (shouldFlattenNode(nextNode)) {
    return nextNode.children?.[0] || null;
  }

  const inferredLayout = inferReadableLayout(nextNode, artboard);
  const inferredNode = inferredLayout && !isSameLayout(nextNode.layoutHint, inferredLayout)
    ? {
        ...nextNode,
        layoutHint: inferredLayout,
      }
    : nextNode;
  const patternLayoutOverride = detectPattern(inferredNode, artboard)?.layoutOverride;
  if (!patternLayoutOverride || isSameLayout(inferredNode.layoutHint, patternLayoutOverride)) {
    return inferredNode;
  }

  return {
    ...inferredNode,
    layoutHint: patternLayoutOverride,
  };
}

function annotateRenderNode(
  node: SimplifiedLayer,
  artboard: ArtboardInfo,
  metadataById: Map<number, UniAppSemanticMetadata>,
  classUsage: Map<string, number>,
  inheritedHint?: SemanticHint,
): void {
  const match = detectPattern(node, artboard);
  const hint = inheritedHint || match || inferFallbackHint(node, artboard);
  const primaryClass = allocateClassName(hint.baseClass, classUsage);

  metadataById.set(node.id, {
    primaryClass,
    semanticClasses: dedupe(hint.semanticClasses),
    role: hint.role,
  });

  const childHints = match?.childHints || new Map<number, SemanticHint>();
  for (const child of node.children || []) {
    annotateRenderNode(child, artboard, metadataById, classUsage, childHints.get(child.id));
  }
}

function detectPattern(node: SimplifiedLayer, artboard: ArtboardInfo): PatternMatch | null {
  return matchTabBar(node, artboard)
    || matchStatsPanel(node)
    || matchFeatureGrid(node, artboard)
    || matchNoticeBar(node)
    || matchRecommendationList(node)
    || matchPromoCardList(node)
    || matchPageStack(node, artboard);
}

function matchTabBar(node: SimplifiedLayer, artboard: ArtboardInfo): PatternMatch | null {
  const rowNode = node.layoutHint?.mode === 'flex-row'
    ? node
    : (node.children || []).find(child => isTabBarRowCandidate(child, artboard));
  if (!rowNode || !isTabBarRowCandidate(rowNode, artboard)) {
    return null;
  }

  const childHints = new Map<number, SemanticHint>();
  if (rowNode.id !== node.id) {
    childHints.set(rowNode.id, {
      baseClass: 'tab-bar__menu',
      semanticClasses: ['section-row'],
      role: 'tab-bar__menu',
    });
  }
  for (const item of getLayoutItems(rowNode)) {
    childHints.set(item.id, {
      baseClass: 'tab-bar__item',
      semanticClasses: ['section-item'],
      role: 'tab-bar__item',
    });
  }

  return {
    baseClass: 'tab-bar',
    semanticClasses: ['section'],
    role: 'tab-bar',
    childHints,
    layoutOverride: rowNode.id === node.id
      ? undefined
      : buildLinearLayoutHint(node, [rowNode], 'column', collectOverlayIds(node, [rowNode])),
  };
}

function matchFeatureGrid(node: SimplifiedLayer, artboard: ArtboardInfo): PatternMatch | null {
  const directItems = getLayoutItems(node);
  const rows = (node.children || []).filter(child => isFeatureGridRow(child));
  const isDirectGrid = node.layoutHint?.mode === 'flex-row'
    && directItems.length >= 3
    && directItems.length <= 5
    && directItems.filter(item => item.layoutHint?.mode === 'flex-column').length >= 3
    && node.bounds.y < artboard.height * 0.72;
  if (rows.length < 2 && !isDirectGrid) {
    return null;
  }

  const looksLikeFeatureGrid = /菜单|快捷|功能|feature/i.test(node.name)
    || isDirectGrid
    || rows.every(row => getLayoutItems(row).length >= 3);
  if (!looksLikeFeatureGrid) {
    return null;
  }

  const childHints = new Map<number, SemanticHint>();
  if (isDirectGrid) {
    for (const item of directItems) {
      childHints.set(item.id, {
        baseClass: 'feature-grid__item',
        semanticClasses: ['section-item'],
        role: 'feature-grid__item',
      });
    }
  } else {
    for (const row of rows) {
      childHints.set(row.id, {
        baseClass: 'feature-grid__row',
        semanticClasses: ['section-row'],
        role: 'feature-grid__row',
      });
      for (const item of getLayoutItems(row)) {
        childHints.set(item.id, {
          baseClass: 'feature-grid__item',
          semanticClasses: ['section-item'],
          role: 'feature-grid__item',
        });
      }
    }
  }

  return {
    baseClass: 'feature-grid',
    semanticClasses: ['section'],
    role: 'feature-grid',
    childHints,
  };
}

function matchStatsPanel(node: SimplifiedLayer): PatternMatch | null {
  const items = getStatsPanelItems(node);
  if (items.length < 3) {
    return null;
  }
  const hasStatsName = /数据|统计|概览|看板|排行|stats/i.test(node.name);
  if (items.length !== 3 && !hasStatsName) {
    return null;
  }

  const childHints = new Map<number, SemanticHint>();
  for (const item of items) {
    childHints.set(item.id, {
      baseClass: 'stats-panel__item',
      semanticClasses: ['section-item'],
      role: 'stats-panel__item',
    });
  }

  return {
    baseClass: 'stats-panel',
    semanticClasses: ['section'],
    role: 'stats-panel',
    childHints,
    layoutOverride: buildLinearLayoutHint(node, items, 'row', collectOverlayIds(node, items)),
  };
}

function matchNoticeBar(node: SimplifiedLayer): PatternMatch | null {
  if (node.bounds.height > 120) {
    return null;
  }

  const contentChild = getSinglePrimaryFlowChild(node);
  if (!contentChild) {
    return null;
  }

  const hasNoticeName = /通知|公告|notice/i.test(node.name);
  const isCompactBanner = node.bounds.width >= 480 && node.bounds.height <= 90;
  if (!hasNoticeName && !isCompactBanner) {
    return null;
  }

  return {
    baseClass: 'notice-bar',
    semanticClasses: ['section'],
    role: 'notice-bar',
    childHints: new Map<number, SemanticHint>([
      [contentChild.id, {
        baseClass: 'notice-bar__item',
        semanticClasses: ['section-item'],
        role: 'notice-bar__item',
      }],
    ]),
    layoutOverride: buildLinearLayoutHint(node, [contentChild], 'row', collectOverlayIds(node, [contentChild])),
  };
}

function matchRecommendationList(node: SimplifiedLayer): PatternMatch | null {
  const repeatedCards = getRepeatedFlexCards(node);
  if (repeatedCards.length < 2) {
    return null;
  }

  const hasRecommendationName = /推荐|recommend|activity|列表/i.test(node.name);
  if (!hasRecommendationName && node.bounds.height < 420) {
    return null;
  }

  const childHints = new Map<number, SemanticHint>();
  for (const item of repeatedCards) {
    childHints.set(item.id, {
      baseClass: 'recommendation-list__item',
      semanticClasses: ['section-item'],
      role: 'recommendation-list__item',
    });
  }

  return {
    baseClass: 'recommendation-list',
    semanticClasses: ['section'],
    role: 'recommendation-list',
    childHints,
    layoutOverride: buildLinearLayoutHint(node, repeatedCards, 'column', collectOverlayIds(node, repeatedCards)),
  };
}

function matchPromoCardList(node: SimplifiedLayer): PatternMatch | null {
  const bodyCandidates = getPromoBodyCandidates(node);
  if (bodyCandidates.length !== 1) {
    return null;
  }
  const bodyChild = bodyCandidates[0];
  const headerTextCount = (node.children || []).filter(child => Boolean(child.text)).length;

  const hasPromoName = /车源|card|活动|banner|专单|推荐/i.test(node.name);
  if (!hasPromoName && headerTextCount < 2) {
    return null;
  }

  return {
    baseClass: 'promo-card-list',
    semanticClasses: ['section'],
    role: 'promo-card-list',
    childHints: new Map<number, SemanticHint>([
      [bodyChild.id, {
        baseClass: 'promo-card',
        semanticClasses: ['section-item'],
        role: 'promo-card',
      }],
    ]),
    layoutOverride: buildLinearLayoutHint(node, [bodyChild], 'column', collectOverlayIds(node, [bodyChild])),
  };
}

function matchPageStack(node: SimplifiedLayer, artboard: ArtboardInfo): PatternMatch | null {
  if (node.layoutHint?.mode !== 'flex-column') {
    return null;
  }

  const items = getLayoutItems(node);
  if (items.length < 3) {
    return null;
  }

  const largeSections = items.filter(item => isSectionStackCandidate(node, item, artboard));
  if (largeSections.length < 3) {
    return null;
  }

  return {
    baseClass: 'page-stack',
    semanticClasses: ['page-content'],
    role: 'page-stack',
  };
}

function inferFallbackHint(node: SimplifiedLayer, artboard: ArtboardInfo): SemanticHint {
  if (node.text) {
    return inferTextHint(node);
  }

  if (isIconLike(node)) {
    return {
      baseClass: 'icon-node',
      semanticClasses: ['icon-node'],
      role: 'icon-node',
    };
  }

  if (node.assetUrl || node.renderStrategy === 'asset') {
    return {
      baseClass: node.bounds.width >= artboard.width * 0.6 ? 'media-block' : 'image-node-block',
      semanticClasses: ['media-node'],
      role: node.bounds.width >= artboard.width * 0.6 ? 'media-block' : 'image-node-block',
    };
  }

  if (isLineLikeNode(node)) {
    return {
      baseClass: 'shape-divider',
      semanticClasses: ['divider-node'],
      role: 'shape-divider',
    };
  }

  if (node.layoutHint?.mode === 'flex-row') {
    return {
      baseClass: 'row-group',
      semanticClasses: ['group-node'],
      role: 'row-group',
    };
  }

  if (node.layoutHint?.mode === 'flex-column') {
    return {
      baseClass: 'stack-group',
      semanticClasses: ['group-node'],
      role: 'stack-group',
    };
  }

  if (hasOwnVisual(node) && looksLikeSection(node, artboard)) {
    return {
      baseClass: 'surface-section',
      semanticClasses: ['section'],
      role: 'surface-section',
    };
  }

  return {
    baseClass: node.children?.length ? 'group-block' : 'layer-node',
    semanticClasses: [node.children?.length ? 'group-node' : 'layer-node'],
    role: node.children?.length ? 'group-block' : 'layer-node',
  };
}

function inferReadableLayout(node: SimplifiedLayer, artboard: ArtboardInfo): SimplifiedLayoutHint | undefined {
  if (node.layoutHint) {
    return node.layoutHint;
  }

  const stackedSections = inferVerticalSectionStack(node, artboard);
  if (stackedSections) {
    return stackedSections;
  }

  const statsLayout = inferStatsPanelLayout(node);
  if (statsLayout) {
    return statsLayout;
  }

  return inferSingleFlowChildLayout(node);
}

function inferVerticalSectionStack(node: SimplifiedLayer, artboard: ArtboardInfo): SimplifiedLayoutHint | undefined {
  const items = (node.children || []).filter(child => isSectionStackCandidate(node, child, artboard));
  if (items.length < 3) {
    return undefined;
  }

  const ordered = [...items].sort((left, right) => left.bounds.y - right.bounds.y);
  let overlapPenalty = 0;
  for (let index = 1; index < ordered.length; index += 1) {
    const gap = ordered[index].bounds.y - (ordered[index - 1].bounds.y + ordered[index - 1].bounds.height);
    if (gap < -12) {
      overlapPenalty += Math.abs(gap);
    }
  }
  if (overlapPenalty > 24) {
    return undefined;
  }

  return buildLinearLayoutHint(node, ordered, 'column', collectOverlayIds(node, ordered));
}

function inferStatsPanelLayout(node: SimplifiedLayer): SimplifiedLayoutHint | undefined {
  const items = getStatsPanelItems(node);
  if (items.length < 3) {
    return undefined;
  }

  return buildLinearLayoutHint(node, items, 'row', collectOverlayIds(node, items));
}

function inferSingleFlowChildLayout(node: SimplifiedLayer): SimplifiedLayoutHint | undefined {
  const contentChild = getSinglePrimaryFlowChild(node);
  if (!contentChild) {
    return undefined;
  }

  return buildLinearLayoutHint(node, [contentChild], 'row', collectOverlayIds(node, [contentChild]));
}

function getSinglePrimaryFlowChild(node: SimplifiedLayer): SimplifiedLayer | undefined {
  const backgroundId = node.containerVisualSourceId;
  const renderableChildren = (node.children || []).filter(child => child.id !== backgroundId);
  const flowChildren = renderableChildren.filter(child => Boolean(child.layoutHint));
  if (flowChildren.length !== 1) {
    return undefined;
  }

  const otherChildren = renderableChildren.filter(child => child.id !== flowChildren[0].id);
  if (otherChildren.some(child => !isDecorationLikeNode(child))) {
    return undefined;
  }

  return flowChildren[0];
}

function getPromoBodyCandidates(node: SimplifiedLayer): SimplifiedLayer[] {
  return (node.children || [])
    .filter(child => child.layoutHint?.mode === 'flex-column')
    .filter(child => child.bounds.height >= node.bounds.height * 0.5)
    .sort((left, right) => right.bounds.height - left.bounds.height);
}

function getStatsPanelItems(node: SimplifiedLayer): SimplifiedLayer[] {
  const items = (node.children || [])
    .filter(child => child.layoutHint?.mode === 'flex-column')
    .filter(child => child.bounds.width >= node.bounds.width * 0.2)
    .filter(child => child.bounds.height >= node.bounds.height * 0.65);
  if (items.length < 3 || !areSizesSimilar(items, 0.28)) {
    return [];
  }
  if (!areItemsLinear(items, 'row', 20)) {
    return [];
  }

  return [...items].sort((left, right) => left.bounds.x - right.bounds.x);
}

function getRepeatedFlexCards(node: SimplifiedLayer): SimplifiedLayer[] {
  const groups = (node.children || [])
    .filter(child => child.layoutHint?.mode === 'flex-column')
    .filter(child => child.bounds.width >= node.bounds.width * 0.75)
    .filter(child => child.bounds.height >= 180);
  if (groups.length < 2 || !areSizesSimilar(groups, 0.18)) {
    return [];
  }

  return [...groups].sort((left, right) => left.bounds.y - right.bounds.y);
}

function isFeatureGridRow(node: SimplifiedLayer): boolean {
  const items = getLayoutItems(node);
  return node.layoutHint?.mode === 'flex-row'
    && items.length >= 3
    && areSizesSimilar(items, 0.2);
}

function isTabBarRowCandidate(node: SimplifiedLayer, artboard: ArtboardInfo): boolean {
  const items = getLayoutItems(node);
  return node.layoutHint?.mode === 'flex-row'
    && items.length >= 3
    && items.length <= 5
    && node.bounds.y >= artboard.height * 0.72
    && items.filter(item => item.layoutHint?.mode === 'flex-column').length >= 3;
}

function isSectionStackCandidate(parent: SimplifiedLayer, child: SimplifiedLayer, artboard: ArtboardInfo): boolean {
  if (child.text || isIconLike(child) || isLineLikeNode(child)) {
    return false;
  }
  if (!child.children?.length && !child.assetUrl && !hasOwnVisual(child)) {
    return false;
  }
  if (isFullBleedBackgroundNode(parent, child, artboard)) {
    return false;
  }

  const parentWidth = Math.max(parent.bounds.width, artboard.width);
  return child.bounds.width >= parentWidth * 0.55
    && child.bounds.height >= 48
    && Math.abs(child.bounds.x - parent.bounds.x) <= Math.max(36, parent.bounds.width * 0.08);
}

function buildLinearLayoutHint(
  node: SimplifiedLayer,
  items: SimplifiedLayer[],
  direction: 'row' | 'column',
  overlayIds: number[],
): SimplifiedLayoutHint {
  const ordered = [...items].sort((left, right) => (
    direction === 'row'
      ? left.bounds.x - right.bounds.x
      : left.bounds.y - right.bounds.y
  ));
  const contentBounds = getBoundingBounds(ordered);
  const padding = {
    top: clampSpacing(contentBounds.y - node.bounds.y),
    right: clampSpacing(node.bounds.x + node.bounds.width - (contentBounds.x + contentBounds.width)),
    bottom: clampSpacing(node.bounds.y + node.bounds.height - (contentBounds.y + contentBounds.height)),
    left: clampSpacing(contentBounds.x - node.bounds.x),
  };
  const gaps = ordered.slice(1).map((child, index) => {
    const previous = ordered[index];
    return direction === 'row'
      ? child.bounds.x - (previous.bounds.x + previous.bounds.width)
      : child.bounds.y - (previous.bounds.y + previous.bounds.height);
  }).filter(value => value > 0);
  const gap = gaps.length > 0
    ? Number(median(gaps).toFixed(2))
    : 0;

  return {
    mode: direction === 'row' ? 'flex-row' : 'flex-column',
    itemIds: ordered.map(item => item.id),
    overlayIds,
    gap,
    padding,
    justifyContent: shouldUseSpaceBetween(node, ordered, direction, gap) ? 'space-between' : 'start',
    alignItems: inferAlignItems(node, ordered, direction),
    contentBounds,
  };
}

function shouldPruneNode(node: SimplifiedLayer): boolean {
  if (node.text || node.assetUrl || hasOwnVisual(node)) {
    return false;
  }

  return !node.children?.length;
}

function shouldFlattenNode(node: SimplifiedLayer): boolean {
  if (node.layoutHint || node.clip?.clipped || node.clip?.isMask || node.text || node.assetUrl || hasOwnVisual(node)) {
    return false;
  }

  if (!node.children || node.children.length !== 1) {
    return false;
  }

  const child = node.children[0];
  return node.isTextOnlyContainer
    || isBoundsMostlyEqual(node.bounds, child.bounds)
    || child.bounds.width >= node.bounds.width * 0.9 && child.bounds.height >= node.bounds.height * 0.9;
}

function inferTextHint(node: SimplifiedLayer): SemanticHint {
  const fontSize = node.textStyle?.fontSize || 14;
  const fontWeight = node.textStyle?.fontWeight || 400;
  if (fontSize >= 28 || fontWeight >= 700) {
    return {
      baseClass: 'text-hero',
      semanticClasses: ['text-node-role'],
      role: 'text-hero',
    };
  }
  if (fontSize >= 18 || fontWeight >= 600) {
    return {
      baseClass: 'text-heading',
      semanticClasses: ['text-node-role'],
      role: 'text-heading',
    };
  }
  if (fontSize <= 12) {
    return {
      baseClass: 'text-caption',
      semanticClasses: ['text-node-role'],
      role: 'text-caption',
    };
  }

  return {
    baseClass: 'text-body',
    semanticClasses: ['text-node-role'],
    role: 'text-body',
  };
}

function isBoundsMostlyEqual(left: SimplifiedBounds, right: SimplifiedBounds): boolean {
  return Math.abs(left.x - right.x) <= 6
    && Math.abs(left.y - right.y) <= 6
    && Math.abs(left.width - right.width) <= 6
    && Math.abs(left.height - right.height) <= 6;
}

function areItemsLinear(items: SimplifiedLayer[], direction: 'row' | 'column', tolerance: number): boolean {
  if (items.length < 2) {
    return false;
  }

  const centers = items.map(item => (
    direction === 'row'
      ? item.bounds.y + item.bounds.height / 2
      : item.bounds.x + item.bounds.width / 2
  ));
  return Math.max(...centers) - Math.min(...centers) <= tolerance;
}

function areSizesSimilar(items: SimplifiedLayer[], toleranceRatio: number): boolean {
  if (items.length < 2) {
    return false;
  }

  const widths = items.map(item => item.bounds.width);
  const heights = items.map(item => item.bounds.height);
  const widthRatio = (Math.max(...widths) - Math.min(...widths)) / Math.max(...widths, 1);
  const heightRatio = (Math.max(...heights) - Math.min(...heights)) / Math.max(...heights, 1);
  return widthRatio <= toleranceRatio && heightRatio <= toleranceRatio;
}

function getLayoutItems(node: SimplifiedLayer): SimplifiedLayer[] {
  const orderedChildren = node.children || [];
  const itemIds = node.layoutHint?.itemIds || [];
  if (itemIds.length === 0) {
    return [];
  }

  const childById = new Map(orderedChildren.map(child => [child.id, child]));
  return itemIds
    .map(itemId => childById.get(itemId))
    .filter((child): child is SimplifiedLayer => Boolean(child));
}

function collectOverlayIds(node: SimplifiedLayer, items: SimplifiedLayer[]): number[] {
  const itemIds = new Set(items.map(item => item.id));
  const backgroundId = node.containerVisualSourceId;
  return (node.children || [])
    .filter(child => child.id !== backgroundId)
    .filter(child => !itemIds.has(child.id))
    .map(child => child.id);
}

function remapChildLayoutHint(
  layoutHint: SimplifiedLayoutHint | undefined,
  childIdAliases: Map<number, number>,
  availableChildIds: Set<number>,
): SimplifiedLayoutHint | undefined {
  if (!layoutHint) {
    return undefined;
  }

  const itemIds = remapChildIds(layoutHint.itemIds, childIdAliases, availableChildIds);
  if (itemIds.length === 0) {
    return undefined;
  }

  const itemIdSet = new Set(itemIds);
  const overlayIds = remapChildIds(layoutHint.overlayIds, childIdAliases, availableChildIds)
    .filter(id => !itemIdSet.has(id));
  const lines = (layoutHint.lines || [])
    .map(line => ({
      ...line,
      itemIds: remapChildIds(line.itemIds, childIdAliases, availableChildIds),
    }))
    .filter(line => line.itemIds.length > 0);

  return {
    ...layoutHint,
    itemIds,
    overlayIds,
    lines: lines.length > 0 ? lines : undefined,
  };
}

function remapChildIds(
  ids: number[] | undefined,
  childIdAliases: Map<number, number>,
  availableChildIds: Set<number>,
): number[] {
  if (!ids?.length) {
    return [];
  }

  const seen = new Set<number>();
  const mapped: number[] = [];
  for (const id of ids) {
    const nextId = childIdAliases.get(id) || id;
    if (!availableChildIds.has(nextId) || seen.has(nextId)) {
      continue;
    }
    seen.add(nextId);
    mapped.push(nextId);
  }
  return mapped;
}

function getBoundingBounds(nodes: SimplifiedLayer[]): SimplifiedBounds {
  const minX = Math.min(...nodes.map(node => node.bounds.x));
  const minY = Math.min(...nodes.map(node => node.bounds.y));
  const maxX = Math.max(...nodes.map(node => node.bounds.x + node.bounds.width));
  const maxY = Math.max(...nodes.map(node => node.bounds.y + node.bounds.height));

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
    absoluteX: minX,
    absoluteY: minY,
  };
}

function shouldUseSpaceBetween(
  node: SimplifiedLayer,
  items: SimplifiedLayer[],
  direction: 'row' | 'column',
  gap: number,
): boolean {
  if (gap <= 0 || items.length < 2) {
    return false;
  }

  const first = items[0];
  const last = items[items.length - 1];
  const leading = direction === 'row'
    ? first.bounds.x - node.bounds.x
    : first.bounds.y - node.bounds.y;
  const trailing = direction === 'row'
    ? node.bounds.x + node.bounds.width - (last.bounds.x + last.bounds.width)
    : node.bounds.y + node.bounds.height - (last.bounds.y + last.bounds.height);

  return Math.abs(leading - trailing) <= Math.max(18, gap * 1.5);
}

function inferAlignItems(
  node: SimplifiedLayer,
  items: SimplifiedLayer[],
  direction: 'row' | 'column',
): NonNullable<SimplifiedLayoutHint['alignItems']> {
  if (direction === 'column') {
    const leftEdges = items.map(item => item.bounds.x);
    const rightEdges = items.map(item => item.bounds.x + item.bounds.width);
    const leftSpread = Math.max(...leftEdges) - Math.min(...leftEdges);
    const rightSpread = Math.max(...rightEdges) - Math.min(...rightEdges);
    if (leftSpread <= 12 && rightSpread <= 12) {
      return 'stretch';
    }
  }

  const centers = items.map(item => (
    direction === 'row'
      ? item.bounds.y + item.bounds.height / 2
      : item.bounds.x + item.bounds.width / 2
  ));
  return Math.max(...centers) - Math.min(...centers) <= Math.max(12, (direction === 'row' ? node.bounds.height : node.bounds.width) * 0.12)
    ? 'center'
    : 'start';
}

function isLineLikeNode(node: SimplifiedLayer): boolean {
  return node.bounds.width <= 3
    || node.bounds.height <= 3
    || /line|divider/i.test(node.name);
}

function isDecorationLikeNode(node: SimplifiedLayer): boolean {
  return isLineLikeNode(node)
    || isIconLike(node)
    || (node.opacity !== undefined && node.opacity < 0.12);
}

function isIconLike(node: SimplifiedLayer): boolean {
  const maxSize = Math.max(node.bounds.width, node.bounds.height);
  const minSize = Math.min(node.bounds.width, node.bounds.height);
  return maxSize <= 64
    && minSize > 0
    && /icon|arrow|more|badge|dot/i.test(node.name || '')
    || maxSize <= 52 && !node.text && Boolean(node.assetUrl || node.pathData?.hasComplexGeometry);
}

function looksLikeSection(node: SimplifiedLayer, artboard: ArtboardInfo): boolean {
  return SECTION_NAME_PATTERNS.test(node.name)
    || node.bounds.width >= artboard.width * 0.6 && node.bounds.height >= 60;
}

function isFullBleedBackgroundNode(parent: SimplifiedLayer, child: SimplifiedLayer, artboard: ArtboardInfo): boolean {
  if (child.text || isIconLike(child) || isLineLikeNode(child)) {
    return false;
  }

  const widthReference = Math.max(parent.bounds.width, artboard.width, 1);
  const heightReference = Math.max(parent.bounds.height, artboard.height, 1);
  return Math.abs(child.bounds.x - parent.bounds.x) <= Math.max(24, parent.bounds.width * 0.06)
    && Math.abs(child.bounds.y - parent.bounds.y) <= Math.max(24, parent.bounds.height * 0.06)
    && child.bounds.width >= widthReference * 0.92
    && child.bounds.height >= heightReference * 0.78;
}

function hasOwnVisual(node: SimplifiedLayer): boolean {
  return Boolean(
    node.fill
    || node.stroke
    || node.shadows?.length
    || node.assetUrl
    || node.adjustment
    || node.borderRadius !== undefined,
  );
}

function isSameLayout(
  left: SimplifiedLayoutHint | undefined,
  right: SimplifiedLayoutHint | undefined,
): boolean {
  if (!left || !right) {
    return !left && !right;
  }

  return left.mode === right.mode
    && compareNumberArrays(left.itemIds, right.itemIds)
    && compareNumberArrays(left.overlayIds, right.overlayIds)
    && left.gap === right.gap
    && compareSpacing(left.padding, right.padding);
}

function compareNumberArrays(left: number[] | undefined, right: number[] | undefined): boolean {
  const safeLeft = left || [];
  const safeRight = right || [];
  return safeLeft.length === safeRight.length
    && safeLeft.every((value, index) => value === safeRight[index]);
}

function compareSpacing(left: SimplifiedSpacing | undefined, right: SimplifiedSpacing | undefined): boolean {
  if (!left || !right) {
    return false;
  }

  return left.top === right.top
    && left.right === right.right
    && left.bottom === right.bottom
    && left.left === right.left;
}

function allocateClassName(baseClass: string, classUsage: Map<string, number>): string {
  const nextCount = (classUsage.get(baseClass) || 0) + 1;
  classUsage.set(baseClass, nextCount);
  return nextCount === 1
    ? baseClass
    : `${baseClass}-${nextCount}`;
}

function dedupe(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function median(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  }
  return sorted[middle];
}

function clampSpacing(value: number): number {
  return Number(Math.max(0, value).toFixed(2));
}
