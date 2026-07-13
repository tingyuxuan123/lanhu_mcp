import type {
  ArtboardInfo,
  SimplifiedLayer,
  SimplifiedLayoutHint,
  SimplifiedPathGeometry,
  SimplifiedShadow,
  SimplifiedSpacing,
  SimplifiedTextStyle,
  SimplifiedTextStyleRange,
} from '../types/lanhu.js';
import {
  buildUniAppRenderModel,
  type UniAppSemanticMetadata,
} from './uniapp-semantic-transformer.js';

export interface UniAppRendererOptions {
  designWidth?: number;
  componentName?: string;
}

interface RenderState {
  readonly designWidth: number;
  readonly componentName: string;
  readonly cssRules: Map<string, string[]>;
  readonly skippedNodeIds: Set<number>;
  readonly metadataById: Map<number, UniAppSemanticMetadata>;
}

interface RenderNodeContext {
  readonly artboard: ArtboardInfo;
  readonly state: RenderState;
  readonly parent?: SimplifiedLayer;
  readonly positionMode: 'absolute' | 'flow';
  readonly indent: number;
}

interface TextSegment {
  readonly className?: string;
  readonly text: string;
}

const DEFAULT_COMPONENT_NAME = 'LanhuRestoredPage';
const DEFAULT_DESIGN_WIDTH = 375;
const PREVIEW_CAPSULE_NAME = '标题+小程序';

export function renderUniAppRoot(
  nodes: SimplifiedLayer[],
  artboard: ArtboardInfo,
  options: UniAppRendererOptions = {},
): string {
  const designWidth = normalizeDesignWidth(options.designWidth, artboard.width);
  const componentName = normalizeComponentName(options.componentName || artboard.name || DEFAULT_COMPONENT_NAME);
  const renderModel = buildUniAppRenderModel(nodes, artboard);
  const state: RenderState = {
    designWidth,
    componentName,
    cssRules: new Map(),
    skippedNodeIds: new Set(),
    metadataById: renderModel.metadataById,
  };

  registerRule(state, 'page', [
    'position: relative',
    `width: ${pxToRpx(artboard.width, designWidth)}`,
    `min-height: ${pxToRpx(artboard.height, designWidth)}`,
    'box-sizing: border-box',
    'overflow: hidden',
    'background-color: #ffffff',
  ]);
  registerRule(state, 'text-node', [
    'display: inline-block',
    'vertical-align: top',
    'overflow: visible',
  ]);
  registerRule(state, 'text-node-role', [
    'display: inline-block',
  ]);
  registerRule(state, 'image-node', [
    'display: block',
  ]);
  registerRule(state, 'box-node', [
    'box-sizing: border-box',
  ]);
  registerRule(state, 'absolute-node', [
    'position: absolute',
  ]);
  registerRule(state, 'flow-node', [
    'position: relative',
    'flex: 0 0 auto',
  ]);
  registerRule(state, 'layout-row', [
    'display: flex',
    'flex-direction: row',
  ]);
  registerRule(state, 'layout-column', [
    'display: flex',
    'flex-direction: column',
  ]);
  registerRule(state, 'media-node', [
    'display: block',
  ]);
  registerRule(state, 'divider-node', [
    'display: block',
  ]);

  const renderedNodes = sortByPaint(renderModel.nodes)
    .map(node => renderUniAppNode(node, {
      artboard,
      state,
      positionMode: 'absolute',
      indent: 4,
    }))
    .filter(Boolean)
    .join('\n');
  applyCssTokens(state);
  const css = [...state.cssRules.entries()]
    .map(([className, declarations]) => `.${className} { ${declarations.join('; ')}; }`)
    .join('\n');

  return [
    '<template>',
    '  <view class="page">',
    renderedNodes,
    '  </view>',
    '</template>',
    '<script>',
    `export default { name: '${componentName}' }`,
    '</script>',
    '<style scoped>',
    css,
    '</style>',
  ].join('\n');
}

export function renderUniAppNode(node: SimplifiedLayer, context: RenderNodeContext): string {
  if (!isRenderableNode(node, context.state, context.artboard)) {
    return '';
  }

  const promotedChild = getPromotedAbsoluteChild(node, context);
  if (promotedChild) {
    return renderUniAppNode(promotedChild, context);
  }

  if (shouldRenderAsImage(node)) {
    return renderImage(node, context);
  }

  if (node.text && (!node.children || node.children.length === 0)) {
    return renderText(node, context);
  }

  if (node.layoutHint && (node.layoutHint.mode === 'flex-row' || node.layoutHint.mode === 'flex-column')) {
    return renderFlexContainer(node, context);
  }

  if (node.children?.length && node.shouldRenderChildren !== false) {
    return renderAbsoluteContainer(node, context);
  }

  return renderShape(node, context);
}

export function renderFlexContainer(node: SimplifiedLayer, context: RenderNodeContext): string {
  const className = primaryClassName(node, context.state);
  const backgroundSource = consumeBackgroundSource(node, context.state);
  const declarations = buildBoxDeclarations(node, context);
  applyVisualDeclarations(declarations, node, context.state.designWidth, backgroundSource);
  applyFlexDeclarations(declarations, node.layoutHint, context.state.designWidth);
  registerRule(context.state, className, declarations);

  const overlayIds = new Set(node.layoutHint?.overlayIds || []);
  const orderedChildren = orderChildren(sortByPaint(node.children || []), node.layoutHint?.itemIds || []);
  const flowChildren = orderedChildren.filter(child => !overlayIds.has(child.id));
  const overlayChildren = orderedChildren.filter(child => overlayIds.has(child.id));
  const childrenMarkup = renderFlexChildren(node, flowChildren, overlayChildren, context);
  const classNames = nodeClassList(node, context.state, context.positionMode, [
    layoutUtilityClass(node.layoutHint),
  ]);

  return [
    indentLine(`<view ${composeTagAttributes(node, classNames, context.state)}>`, context.indent),
    childrenMarkup,
    indentLine('</view>', context.indent),
  ].filter(Boolean).join('\n');
}

export function renderAbsoluteContainer(node: SimplifiedLayer, context: RenderNodeContext): string {
  const className = primaryClassName(node, context.state);
  const backgroundSource = consumeBackgroundSource(node, context.state);
  const declarations = buildBoxDeclarations(node, context);
  applyVisualDeclarations(declarations, node, context.state.designWidth, backgroundSource);
  registerRule(context.state, className, declarations);

  const orderedChildren = sortByPaint(node.children || [])
    .filter(child => isRenderableNode(child, context.state, context.artboard));
  const { backgroundOverlays, foregroundOverlays } = splitOverlayChildren(node, orderedChildren);
  const childrenMarkup = [...backgroundOverlays, ...foregroundOverlays]
    .map(child => renderUniAppNode(child, {
      artboard: context.artboard,
      state: context.state,
      parent: node,
      positionMode: 'absolute',
      indent: context.indent + 2,
    }))
    .filter(Boolean)
    .join('\n');
  const classNames = nodeClassList(node, context.state, context.positionMode);

  return [
    indentLine(`<view ${composeTagAttributes(node, classNames, context.state)}>`, context.indent),
    childrenMarkup,
    indentLine('</view>', context.indent),
  ].filter(Boolean).join('\n');
}

export function renderText(node: SimplifiedLayer, context: RenderNodeContext): string {
  const className = primaryClassName(node, context.state);
  const declarations = buildBoxDeclarations(node, context, {
    omitWidth: context.positionMode === 'flow' && node.sizeHint?.width === 'content',
    omitHeight: context.positionMode === 'flow' && node.sizeHint?.height === 'content',
  });
  applyTextDeclarations(declarations, node.textStyle, context.state.designWidth);
  applyTextLayoutDeclarations(declarations, node);
  registerRule(context.state, className, declarations);

  const segments = buildTextSegments(node, context.state);
  const content = segments.length === 0
    ? escapeText(node.text || '')
    : segments.map(segment => {
        if (!segment.className) {
          return escapeText(segment.text);
        }

        return `<text class="${escapeAttribute(segment.className)}">${escapeText(segment.text)}</text>`;
      }).join('');

  return indentLine(
    `<text ${composeTagAttributes(node, nodeClassList(node, context.state, context.positionMode, ['text-node']), context.state)}>${content}</text>`,
    context.indent,
  );
}

export function renderImage(node: SimplifiedLayer, context: RenderNodeContext): string {
  const className = primaryClassName(node, context.state);
  const declarations = buildBoxDeclarations(node, context);
  applyImageVisualDeclarations(declarations, node, context.state.designWidth);
  registerRule(context.state, className, declarations);
  const src = node.assetUrl || buildComplexShapeDataUri(node) || '';
  const mode = selectImageMode(node);
  const extraClasses = ['image-node'];
  if (isIconLikeNode(node)) {
    extraClasses.push('icon-node');
  }

  return indentLine(
    `<image ${composeTagAttributes(node, nodeClassList(node, context.state, context.positionMode, extraClasses), context.state)} src="${escapeAttribute(src)}" mode="${mode}" />`,
    context.indent,
  );
}

export function renderShape(node: SimplifiedLayer, context: RenderNodeContext): string {
  if (node.pathData?.hasComplexGeometry) {
    const src = buildComplexShapeDataUri(node);
    if (src) {
      const className = primaryClassName(node, context.state);
      const declarations = buildBoxDeclarations(node, context);
      applyImageVisualDeclarations(declarations, node, context.state.designWidth, {
        includeStroke: false,
      });
      registerRule(context.state, className, declarations);
      const extraClasses = ['image-node'];
      if (isIconLikeNode(node)) {
        extraClasses.push('icon-node');
      }
      return indentLine(
        `<image ${composeTagAttributes(node, nodeClassList(node, context.state, context.positionMode, extraClasses), context.state)} src="${escapeAttribute(src)}" mode="aspectFit" />`,
        context.indent,
      );
    }
  }

  const className = primaryClassName(node, context.state);
  const declarations = buildBoxDeclarations(node, context);
  applyVisualDeclarations(declarations, node, context.state.designWidth);
  registerRule(context.state, className, declarations);
  const extraClasses = isLineLikeNode(node)
    ? ['divider-node']
    : [];
  return indentLine(`<view ${composeTagAttributes(node, nodeClassList(node, context.state, context.positionMode, extraClasses), context.state)}></view>`, context.indent);
}

export function pxToRpx(px: number, designWidth: number = DEFAULT_DESIGN_WIDTH): string {
  const ratio = 750 / normalizeDesignWidth(designWidth);
  return `${trimNumber(px * ratio)}rpx`;
}

function renderFlexChildren(
  node: SimplifiedLayer,
  flowChildren: SimplifiedLayer[],
  overlayChildren: SimplifiedLayer[],
  context: RenderNodeContext,
): string {
  const { backgroundOverlays, foregroundOverlays } = splitOverlayChildren(node, overlayChildren);
  const backgroundMarkup = backgroundOverlays
    .map(child => renderUniAppNode(child, {
      artboard: context.artboard,
      state: context.state,
      parent: node,
      positionMode: 'absolute',
      indent: context.indent + 2,
    }))
    .filter(Boolean)
    .join('\n');
  const lineMarkup = renderFlexLines(node, flowChildren, context);
  const content = lineMarkup || flowChildren
    .map(child => renderUniAppNode(child, {
      artboard: context.artboard,
      state: context.state,
      parent: node,
      positionMode: 'flow',
      indent: context.indent + 2,
    }))
    .filter(Boolean)
    .join('\n');
  const overlays = foregroundOverlays
    .map(child => renderUniAppNode(child, {
      artboard: context.artboard,
      state: context.state,
      parent: node,
      positionMode: 'absolute',
      indent: context.indent + 2,
    }))
    .filter(Boolean)
    .join('\n');

  return [backgroundMarkup, content, overlays].filter(Boolean).join('\n');
}

function renderFlexLines(node: SimplifiedLayer, flowChildren: SimplifiedLayer[], context: RenderNodeContext): string {
  const lines = node.layoutHint?.lines || [];
  if (lines.length === 0) {
    return '';
  }

  const childrenById = new Map(flowChildren.map(child => [child.id, child]));
  const lineGap = inferLineGap(lines);
  const className = primaryClassName(node, context.state);
  if (lineGap > 0) {
    registerRule(context.state, className, [
      ...((context.state.cssRules.get(className)) || []),
      `row-gap: ${pxToRpx(lineGap, context.state.designWidth)}`,
    ]);
  }

  const rendered = lines
    .map((line, index) => {
      const lineClassName = `${className}-line-${index + 1}`;
      const declarations = [
        'width: 100%',
      ];
      if (typeof line.gap === 'number' && line.gap > 0) {
        declarations.push(`column-gap: ${pxToRpx(line.gap, context.state.designWidth)}`);
      }
      if (line.justifyContent) {
        declarations.push(`justify-content: ${mapJustifyContent(line.justifyContent)}`);
      }
      if (line.alignItems) {
        declarations.push(`align-items: ${mapAlignItems(line.alignItems)}`);
      }
      registerRule(context.state, lineClassName, declarations);

      const children = orderChildren(
        line.itemIds
          .map(itemId => childrenById.get(itemId))
          .filter((child): child is SimplifiedLayer => Boolean(child)),
        line.itemIds,
      );
      const markup = children
        .map(child => renderUniAppNode(child, {
          artboard: context.artboard,
          state: context.state,
          parent: node,
          positionMode: 'flow',
          indent: context.indent + 4,
        }))
        .filter(Boolean)
        .join('\n');

      return [
        indentLine(`<view class="${escapeAttribute(joinClasses('box-node', 'flow-node', 'layout-row', lineClassName))}">`, context.indent + 2),
        markup,
        indentLine('</view>', context.indent + 2),
      ].join('\n');
    })
    .join('\n');

  return rendered;
}

function buildBoxDeclarations(
  node: SimplifiedLayer,
  context: RenderNodeContext,
  options: { omitWidth?: boolean; omitHeight?: boolean } = {},
): string[] {
  const declarations: string[] = [];

  if (context.positionMode === 'absolute') {
    const offsetX = node.bounds.x - (context.parent?.bounds.x || 0);
    const offsetY = node.bounds.y - (context.parent?.bounds.y || 0);
    declarations.push(`left: ${pxToRpx(offsetX, context.state.designWidth)}`);
    declarations.push(`top: ${pxToRpx(offsetY, context.state.designWidth)}`);
  }

  const shouldOmitWidth = options.omitWidth ?? (context.positionMode === 'flow' && node.sizeHint?.width === 'content');
  const shouldOmitHeight = options.omitHeight ?? (context.positionMode === 'flow' && node.sizeHint?.height === 'content');

  if (!shouldOmitWidth) {
    declarations.push(`width: ${pxToRpx(node.bounds.width, context.state.designWidth)}`);
  }
  if (!shouldOmitHeight) {
    declarations.push(`height: ${pxToRpx(node.bounds.height, context.state.designWidth)}`);
  }
  if (node.opacity !== undefined && node.opacity < 1) {
    declarations.push(`opacity: ${trimNumber(node.opacity)}`);
  }
  if (node.blendMode) {
    declarations.push(`mix-blend-mode: ${node.blendMode}`);
  }
  if (node.borderRadius !== undefined || node.clip?.clipped) {
    declarations.push('overflow: hidden');
  }

  return declarations;
}

function applyVisualDeclarations(
  declarations: string[],
  node: SimplifiedLayer,
  designWidth: number,
  backgroundSource?: SimplifiedLayer,
  options: {
    includeFill?: boolean;
    includeStroke?: boolean;
  } = {},
): void {
  const includeFill = options.includeFill ?? true;
  const includeStroke = options.includeStroke ?? true;
  const fill = node.fill || backgroundSource?.fill;
  if (includeFill && fill) {
    if (fill.startsWith('linear-gradient(')) {
      declarations.push(`background-image: ${fill}`);
    } else {
      declarations.push(`background-color: ${fill}`);
    }
  }

  const stroke = node.stroke || backgroundSource?.stroke;
  if (includeStroke && stroke && stroke.width > 0) {
    declarations.push(`border: ${pxToRpx(stroke.width, designWidth)} solid ${stroke.color}`);
  }

  const borderRadius = node.borderRadius ?? backgroundSource?.borderRadius;
  if (borderRadius !== undefined) {
    declarations.push(`border-radius: ${formatBorderRadius(borderRadius, designWidth)}`);
  }

  const shadows = node.shadows?.length ? node.shadows : backgroundSource?.shadows;
  if (shadows && shadows.length > 0) {
    declarations.push(`box-shadow: ${formatBoxShadow(shadows, designWidth)}`);
  }
}

function applyImageVisualDeclarations(
  declarations: string[],
  node: SimplifiedLayer,
  designWidth: number,
  options: {
    includeStroke?: boolean;
  } = {},
): void {
  applyVisualDeclarations(declarations, node, designWidth, undefined, {
    includeFill: false,
    includeStroke: options.includeStroke,
  });
}

function applyFlexDeclarations(declarations: string[], layoutHint: SimplifiedLayoutHint | undefined, designWidth: number): void {
  if (!layoutHint) {
    return;
  }

  if (typeof layoutHint.gap === 'number' && layoutHint.gap > 0) {
    declarations.push(`gap: ${pxToRpx(layoutHint.gap, designWidth)}`);
  }
  if (layoutHint.padding) {
    declarations.push(`padding: ${formatSpacing(layoutHint.padding, designWidth)}`);
  }
  if (layoutHint.justifyContent) {
    declarations.push(`justify-content: ${mapJustifyContent(layoutHint.justifyContent)}`);
  }
  if (layoutHint.alignItems) {
    declarations.push(`align-items: ${mapAlignItems(layoutHint.alignItems)}`);
  }
}

function applyTextDeclarations(declarations: string[], textStyle: SimplifiedTextStyle | undefined, designWidth: number): void {
  if (!textStyle) {
    return;
  }

  declarations.push(`font-size: ${pxToRpx(textStyle.fontSize, designWidth)}`);
  declarations.push(`color: ${textStyle.color}`);
  declarations.push(`font-family: ${quoteFontFamily(textStyle.fontFamily)}`);
  declarations.push(`text-align: ${textStyle.alignment}`);
  if (textStyle.fontWeight) {
    declarations.push(`font-weight: ${textStyle.fontWeight}`);
  }
  if (textStyle.fontStyle) {
    declarations.push(`font-style: ${textStyle.fontStyle}`);
  }
  if (textStyle.lineHeight) {
    declarations.push(`line-height: ${pxToRpx(textStyle.lineHeight, designWidth)}`);
  }
  if (textStyle.letterSpacing) {
    declarations.push(`letter-spacing: ${pxToRpx(textStyle.letterSpacing, designWidth)}`);
  }
}

function applyTextLayoutDeclarations(declarations: string[], node: SimplifiedLayer): void {
  const singleLine = isSingleLineText(node.text || '');
  declarations.push(`white-space: ${singleLine ? 'nowrap' : 'pre-wrap'}`);
  declarations.push(`word-break: ${singleLine ? 'keep-all' : 'break-word'}`);
}

function buildTextSegments(node: SimplifiedLayer, state: RenderState): TextSegment[] {
  const text = node.text || '';
  const ranges = normalizeTextRanges(node.textStyleRanges || [], text.length);
  if (ranges.length === 0) {
    return [{ text }];
  }

  const segments: TextSegment[] = [];
  let cursor = 0;
  const baseClassName = primaryClassName(node, state);

  ranges.forEach((range, index) => {
    if (range.from > cursor) {
      segments.push({
        text: text.slice(cursor, range.from),
      });
    }

    const className = `${baseClassName}-seg-${index + 1}`;
    const declarations: string[] = [];
    applyTextDeclarations(
      declarations,
      {
        fontSize: range.fontSize || node.textStyle?.fontSize || 14,
        fontFamily: range.fontFamily || node.textStyle?.fontFamily || 'sans-serif',
        fontWeight: range.fontWeight,
        fontStyle: range.fontStyle,
        color: range.color || node.textStyle?.color || '#000000',
        alignment: node.textStyle?.alignment || 'left',
      },
      state.designWidth,
    );
    registerRule(state, className, declarations);

    segments.push({
      className,
      text: text.slice(range.from, range.to),
    });
    cursor = Math.max(cursor, range.to);
  });

  if (cursor < text.length) {
    segments.push({
      text: text.slice(cursor),
    });
  }

  return segments.filter(segment => segment.text.length > 0);
}

function normalizeTextRanges(ranges: SimplifiedTextStyleRange[], textLength: number): SimplifiedTextStyleRange[] {
  return [...ranges]
    .map(range => ({
      ...range,
      from: Math.max(0, Math.min(textLength, range.from || 0)),
      to: Math.max(0, Math.min(textLength, range.to || 0)),
    }))
    .filter(range => range.to > range.from)
    .sort((left, right) => left.from - right.from);
}

function shouldRenderAsImage(node: SimplifiedLayer): boolean {
  if (node.assetUrl && (node.renderStrategy === 'asset' || node.shouldRenderChildren === false)) {
    return true;
  }

  return Boolean(node.pathData?.hasComplexGeometry && !node.children?.length);
}

function consumeBackgroundSource(node: SimplifiedLayer, state: RenderState): SimplifiedLayer | undefined {
  const sourceId = node.containerVisualSourceId;
  if (!sourceId || !node.children?.length) {
    return undefined;
  }

  const source = node.children.find(child => child.id === sourceId);
  if (!source) {
    return undefined;
  }

  state.skippedNodeIds.add(source.id);
  return source;
}

function isRenderableNode(node: SimplifiedLayer, state: RenderState, artboard?: ArtboardInfo): boolean {
  if (state.skippedNodeIds.has(node.id)) {
    return false;
  }
  if (!node.visible) {
    return false;
  }
  if (node.clip?.isMask) {
    return false;
  }
  if (node.bounds.width <= 0 || node.bounds.height <= 0) {
    return false;
  }
  if (node.intersectsArtboard === false) {
    return false;
  }
  if (artboard && isPreviewChromeNode(node, artboard)) {
    return false;
  }
  if (node.opacity !== undefined && node.opacity <= 0.001 && !node.text && !node.assetUrl && !node.children?.length) {
    return false;
  }

  return true;
}

function getPromotedAbsoluteChild(node: SimplifiedLayer, context: RenderNodeContext): SimplifiedLayer | undefined {
  if (context.positionMode !== 'absolute') {
    return undefined;
  }
  if (node.layoutHint || hasOwnVisual(node) || node.clip?.clipped || node.clip?.isMask) {
    return undefined;
  }

  const children = sortByPaint(node.children || []).filter(child => isRenderableNode(child, context.state, context.artboard));
  if (children.length !== 1) {
    return undefined;
  }

  return children[0];
}

function splitOverlayChildren(
  parent: SimplifiedLayer,
  overlayChildren: SimplifiedLayer[],
): {
  backgroundOverlays: SimplifiedLayer[];
  foregroundOverlays: SimplifiedLayer[];
} {
  const backgroundOverlays: SimplifiedLayer[] = [];
  const foregroundOverlays: SimplifiedLayer[] = [];

  for (const child of overlayChildren) {
    if (isBackgroundLikeOverlay(parent, child)) {
      backgroundOverlays.push(child);
      continue;
    }
    foregroundOverlays.push(child);
  }

  return { backgroundOverlays, foregroundOverlays };
}

function isPreviewChromeNode(node: SimplifiedLayer, artboard: ArtboardInfo): boolean {
  return isTopStatusBarPath(node, artboard) || isTopMiniProgramCapsule(node, artboard);
}

function isBackgroundLikeOverlay(parent: SimplifiedLayer, child: SimplifiedLayer): boolean {
  if (child.text || isIconLikeNode(child) || isLineLikeNode(child)) {
    return false;
  }

  const widthReference = Math.max(parent.bounds.width, 1);
  const heightReference = Math.max(parent.bounds.height, 1);
  return Math.abs(child.bounds.x - parent.bounds.x) <= Math.max(24, parent.bounds.width * 0.06)
    && Math.abs(child.bounds.y - parent.bounds.y) <= Math.max(24, parent.bounds.height * 0.06)
    && child.bounds.width >= widthReference * 0.9
    && child.bounds.height >= heightReference * 0.55
    && (hasOwnVisual(child) || Boolean(child.children?.length));
}

function isTopStatusBarPath(node: SimplifiedLayer, artboard: ArtboardInfo): boolean {
  if (normalizeNodeName(node.name) !== 'Path') {
    return false;
  }
  if (node.text || node.assetUrl) {
    return false;
  }

  const topLimit = Math.max(12, Math.min(48, artboard.height * 0.08));
  const heightLimit = Math.max(12, Math.min(24, artboard.height * 0.05));
  return node.bounds.y <= topLimit
    && node.bounds.height <= heightLimit
    && node.bounds.width >= artboard.width * 0.85
    && node.bounds.x <= Math.max(24, artboard.width * 0.08);
}

function isTopMiniProgramCapsule(node: SimplifiedLayer, artboard: ArtboardInfo): boolean {
  const name = normalizeNodeName(node.name);
  const isCapsuleWrapper = name === PREVIEW_CAPSULE_NAME;
  const isCapsuleVariant = /^小程序(?:[-+].+)?$/.test(name);
  if (!isCapsuleWrapper && !isCapsuleVariant) {
    return false;
  }

  const topLimit = Math.min(160, artboard.height * 0.18);
  if (node.bounds.y > topLimit) {
    return false;
  }

  if (isCapsuleVariant && node.bounds.x + node.bounds.width < artboard.width * 0.7) {
    return false;
  }

  return true;
}

function normalizeNodeName(value: string | undefined): string {
  return String(value || '').trim();
}

function orderChildren(children: SimplifiedLayer[], itemIds: number[]): SimplifiedLayer[] {
  if (itemIds.length === 0) {
    return [...children];
  }

  const childrenById = new Map(children.map(child => [child.id, child]));
  const ordered: SimplifiedLayer[] = [];
  const seen = new Set<number>();
  for (const itemId of itemIds) {
    const child = childrenById.get(itemId);
    if (child) {
      ordered.push(child);
      seen.add(itemId);
    }
  }
  for (const child of children) {
    if (!seen.has(child.id)) {
      ordered.push(child);
    }
  }
  return ordered;
}

function primaryClassName(node: SimplifiedLayer, state: RenderState): string {
  return getNodeMetadata(node, state).primaryClass;
}

function nodeClassList(
  node: SimplifiedLayer,
  state: RenderState,
  positionMode: RenderNodeContext['positionMode'],
  extraClasses: Array<string | undefined> = [],
): string[] {
  const metadata = getNodeMetadata(node, state);
  return dedupeClassNames([
    ...metadata.semanticClasses,
    metadata.primaryClass,
    'box-node',
    positionMode === 'absolute' ? 'absolute-node' : 'flow-node',
    ...extraClasses,
  ]);
}

function composeTagAttributes(node: SimplifiedLayer, classes: string[], state: RenderState): string {
  const metadata = getNodeMetadata(node, state);
  const attributes = [
    `class="${escapeAttribute(classes.join(' '))}"`,
    `data-node-id="${node.id}"`,
    `data-node-role="${escapeAttribute(metadata.role)}"`,
    `data-node-name="${escapeAttribute(node.name || '')}"`,
  ];
  return attributes.join(' ');
}

function getNodeMetadata(node: SimplifiedLayer, state: RenderState): UniAppSemanticMetadata {
  return state.metadataById.get(node.id) || {
    primaryClass: `node-${node.id}`,
    semanticClasses: [],
    role: 'node',
  };
}

function layoutUtilityClass(layoutHint: SimplifiedLayoutHint | undefined): string | undefined {
  if (!layoutHint) {
    return undefined;
  }

  return layoutHint.mode === 'flex-row'
    ? 'layout-row'
    : 'layout-column';
}

function registerRule(state: RenderState, className: string, declarations: string[]): void {
  const current = state.cssRules.get(className) || [];
  const merged = new Set<string>(current);
  for (const declaration of declarations) {
    if (declaration) {
      merged.add(declaration);
    }
  }
  state.cssRules.set(className, [...merged]);
}

function sortByPaint(nodes: SimplifiedLayer[]): SimplifiedLayer[] {
  return [...nodes].sort((left, right) => {
    const zDelta = (right.zIndex || 0) - (left.zIndex || 0);
    if (zDelta !== 0) {
      return zDelta;
    }

    return left.id - right.id;
  });
}

function normalizeDesignWidth(value?: number, fallbackWidth?: number): number {
  if (value && Number.isFinite(value) && value > 0) {
    return value;
  }

  if (fallbackWidth && Number.isFinite(fallbackWidth) && fallbackWidth > 0) {
    return fallbackWidth;
  }

  return DEFAULT_DESIGN_WIDTH;
}

function normalizeComponentName(value: string): string {
  const raw = String(value || DEFAULT_COMPONENT_NAME)
    .replace(/[^a-zA-Z0-9]+/g, ' ')
    .trim();

  if (!raw) {
    return DEFAULT_COMPONENT_NAME;
  }

  const pascal = raw
    .split(/\s+/)
    .filter(Boolean)
    .map(segment => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join('');

  return /^[A-Za-z]/.test(pascal)
    ? pascal
    : DEFAULT_COMPONENT_NAME;
}

function formatBorderRadius(value: number | number[], designWidth: number): string {
  if (Array.isArray(value)) {
    return value.map(item => pxToRpx(item, designWidth)).join(' ');
  }

  if (value >= 9999) {
    return '9999rpx';
  }

  return pxToRpx(value, designWidth);
}

function formatBoxShadow(shadows: SimplifiedShadow[], designWidth: number): string {
  return shadows.map(shadow => {
    const parts = [
      shadow.type === 'innerShadow' ? 'inset' : '',
      pxToRpx(shadow.x, designWidth),
      pxToRpx(shadow.y, designWidth),
      pxToRpx(shadow.blur, designWidth),
      pxToRpx(shadow.spread, designWidth),
      shadow.color,
    ].filter(Boolean);

    return parts.join(' ');
  }).join(', ');
}

function formatSpacing(spacing: SimplifiedSpacing, designWidth: number): string {
  return [spacing.top, spacing.right, spacing.bottom, spacing.left]
    .map(value => pxToRpx(value, designWidth))
    .join(' ');
}

function mapJustifyContent(value: NonNullable<SimplifiedLayoutHint['justifyContent']>): string {
  if (value === 'space-between') {
    return 'space-between';
  }

  return mapEdgeAlignment(value);
}

function mapAlignItems(value: NonNullable<SimplifiedLayoutHint['alignItems']>): string {
  if (value === 'stretch') {
    return 'stretch';
  }

  return mapEdgeAlignment(value);
}

function mapEdgeAlignment(value: 'start' | 'center' | 'end'): string {
  switch (value) {
    case 'center':
      return 'center';
    case 'end':
      return 'flex-end';
    default:
      return 'flex-start';
  }
}

function selectImageMode(node: SimplifiedLayer): string {
  if (node.sizeHint?.height === 'content') {
    return 'widthFix';
  }
  if (node.clip?.clipped || node.borderRadius !== undefined) {
    return 'aspectFill';
  }

  return 'aspectFit';
}

function isIconLikeNode(node: SimplifiedLayer): boolean {
  const maxSize = Math.max(node.bounds.width, node.bounds.height);
  const minSize = Math.min(node.bounds.width, node.bounds.height);
  const hasImageContent = Boolean(node.assetUrl || node.pathData?.hasComplexGeometry);
  return (maxSize <= 64 && /icon|arrow|more|badge|dot/i.test(node.name || ''))
    || (maxSize <= 52 && minSize > 0 && !node.text && hasImageContent);
}

function isLineLikeNode(node: SimplifiedLayer): boolean {
  return node.bounds.width <= 3
    || node.bounds.height <= 3
    || /line|divider/i.test(node.name);
}

function hasOwnVisual(node: SimplifiedLayer): boolean {
  return Boolean(
    node.fill
    || node.stroke
    || node.assetUrl
    || node.shadows?.length
    || node.adjustment
    || (node.renderStrategy === 'shape' && node.pathData?.components?.length),
  );
}

function isSingleLineText(value: string): boolean {
  return !/[\r\n]/.test(value);
}

function applyCssTokens(state: RenderState): void {
  const tokenCandidates = collectTokenCandidates(state.cssRules);
  if (tokenCandidates.length === 0) {
    return;
  }

  registerRule(state, 'page', tokenCandidates.map(token => `${token.name}: ${token.value}`));

  for (const [className, declarations] of state.cssRules.entries()) {
    state.cssRules.set(className, declarations.map(declaration => replaceDeclarationToken(declaration, tokenCandidates)));
  }
}

function collectTokenCandidates(cssRules: Map<string, string[]>): Array<{ name: string; property: string; value: string }> {
  const counts = new Map<string, { property: string; value: string; count: number }>();

  for (const declarations of cssRules.values()) {
    for (const declaration of declarations) {
      const parsed = parseDeclaration(declaration);
      if (!parsed || parsed.value.includes('var(')) {
        continue;
      }
      if (!isTokenizableProperty(parsed.property)) {
        continue;
      }

      const key = `${parsed.property}::${parsed.value}`;
      const current = counts.get(key) || {
        property: parsed.property,
        value: parsed.value,
        count: 0,
      };
      current.count += 1;
      counts.set(key, current);
    }
  }

  const familyCounts = new Map<string, number>();
  return [...counts.values()]
    .filter(entry => entry.count >= 2)
    .sort((left, right) => right.count - left.count)
    .map(entry => {
      const family = tokenFamily(entry.property);
      const nextIndex = (familyCounts.get(family) || 0) + 1;
      familyCounts.set(family, nextIndex);
      return {
        name: `--${family}-${nextIndex}`,
        property: entry.property,
        value: entry.value,
      };
    });
}

function replaceDeclarationToken(
  declaration: string,
  tokens: Array<{ name: string; property: string; value: string }>,
): string {
  const parsed = parseDeclaration(declaration);
  if (!parsed) {
    return declaration;
  }

  const token = tokens.find(item => item.property === parsed.property && item.value === parsed.value);
  return token
    ? `${parsed.property}: var(${token.name})`
    : declaration;
}

function parseDeclaration(declaration: string): { property: string; value: string } | null {
  const separatorIndex = declaration.indexOf(':');
  if (separatorIndex <= 0) {
    return null;
  }

  return {
    property: declaration.slice(0, separatorIndex).trim(),
    value: declaration.slice(separatorIndex + 1).trim(),
  };
}

function isTokenizableProperty(property: string): boolean {
  return property === 'background-color'
    || property === 'color'
    || property === 'border-radius'
    || property === 'gap'
    || property === 'row-gap'
    || property === 'column-gap'
    || property === 'padding';
}

function tokenFamily(property: string): string {
  if (property === 'background-color' || property === 'color') {
    return 'color';
  }
  if (property === 'border-radius') {
    return 'radius';
  }
  return 'space';
}

function buildComplexShapeDataUri(node: SimplifiedLayer): string {
  const pathData = node.pathData;
  if (!pathData) {
    return '';
  }

  const referenceX = pathData.pathBounds?.x ?? node.bounds.x;
  const referenceY = pathData.pathBounds?.y ?? node.bounds.y;
  const width = Math.max(1, Math.round(node.bounds.width));
  const height = Math.max(1, Math.round(node.bounds.height));
  const paths = pathData.components
    .map(component => component.subpaths.map(subpath => buildSvgSubpath(subpath.points, subpath.closed, referenceX, referenceY)).join(' '))
    .filter(Boolean)
    .join(' ');

  if (!paths) {
    return '';
  }

  const fill = node.fill && !node.fill.startsWith('linear-gradient(')
    ? node.fill
    : 'transparent';
  const stroke = node.stroke?.color || 'none';
  const strokeWidth = node.stroke?.width || 0;
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">`,
    `<path d="${paths}" fill="${fill}" stroke="${stroke}" stroke-width="${trimNumber(strokeWidth)}" />`,
    '</svg>',
  ].join('');

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function buildSvgSubpath(
  points: SimplifiedPathGeometry['components'][number]['subpaths'][number]['points'],
  closed: boolean,
  referenceX: number,
  referenceY: number,
): string {
  if (points.length === 0) {
    return '';
  }

  const commands: string[] = [];
  const first = points[0];
  commands.push(`M ${trimNumber(first.anchor.x - referenceX)} ${trimNumber(first.anchor.y - referenceY)}`);

  for (let index = 1; index < points.length; index += 1) {
    const current = points[index - 1];
    const next = points[index];
    commands.push(buildSvgSegment(current, next, referenceX, referenceY));
  }

  if (closed && points.length > 1) {
    commands.push(buildSvgSegment(points[points.length - 1], first, referenceX, referenceY));
    commands.push('Z');
  }

  return commands.join(' ');
}

function buildSvgSegment(
  fromPoint: SimplifiedPathGeometry['components'][number]['subpaths'][number]['points'][number],
  toPoint: SimplifiedPathGeometry['components'][number]['subpaths'][number]['points'][number],
  referenceX: number,
  referenceY: number,
): string {
  const isStraight = isSamePoint(fromPoint.forward, fromPoint.anchor) && isSamePoint(toPoint.backward, toPoint.anchor);
  if (isStraight) {
    return `L ${trimNumber(toPoint.anchor.x - referenceX)} ${trimNumber(toPoint.anchor.y - referenceY)}`;
  }

  return [
    'C',
    trimNumber(fromPoint.forward.x - referenceX),
    trimNumber(fromPoint.forward.y - referenceY),
    trimNumber(toPoint.backward.x - referenceX),
    trimNumber(toPoint.backward.y - referenceY),
    trimNumber(toPoint.anchor.x - referenceX),
    trimNumber(toPoint.anchor.y - referenceY),
  ].join(' ');
}

function isSamePoint(left: { x: number; y: number }, right: { x: number; y: number }): boolean {
  return Math.abs(left.x - right.x) < 0.001 && Math.abs(left.y - right.y) < 0.001;
}

function inferLineGap(lines: NonNullable<SimplifiedLayoutHint['lines']>): number {
  if (lines.length < 2) {
    return 0;
  }

  const gaps: number[] = [];
  for (let index = 1; index < lines.length; index += 1) {
    const previous = lines[index - 1];
    const current = lines[index];
    const gap = current.bounds.y - (previous.bounds.y + previous.bounds.height);
    if (gap > 0) {
      gaps.push(gap);
    }
  }

  if (gaps.length === 0) {
    return 0;
  }

  return gaps.reduce((sum, value) => sum + value, 0) / gaps.length;
}

function joinClasses(...values: Array<string | undefined>): string {
  return values.filter(Boolean).join(' ');
}

function quoteFontFamily(value: string): string {
  if (!value) {
    return 'sans-serif';
  }

  return /\s/.test(value)
    ? `"${value}"`
    : value;
}

function indentLine(line: string, indent: number): string {
  return `${' '.repeat(indent)}${line}`;
}

function escapeText(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeAttribute(value: string): string {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function trimNumber(value: number): string {
  const rounded = Number(value.toFixed(3));
  return Number.isInteger(rounded)
    ? String(rounded)
    : String(rounded);
}

function dedupeClassNames(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter(Boolean) as string[])];
}
