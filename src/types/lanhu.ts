/**
 * Lanhu design document types and normalized restoration models.
 */

export interface LanhuColor {
  red?: number;
  green?: number;
  blue?: number;
  r?: number;
  g?: number;
  b?: number;
  alpha?: number;
}

export interface LanhuBounds {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

export interface LanhuArtboardRect {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

export interface LanhuUnitValue {
  value: number;
  units: string;
}

export interface LanhuTextStyleRange {
  from: number;
  to: number;
  textStyle: {
    fontName?: string;
    fontStyleName?: string;
    size?: number;
    fontPostScriptName?: string;
    color?: LanhuColor;
    fontTechnology?: number;
  };
}

export interface LanhuTextInfo {
  text: string;
  color?: LanhuColor;
  size?: number;
  fontPostScriptName?: string;
  bold?: boolean;
  italic?: boolean;
  justification?: 'left' | 'center' | 'right';
  leading?: number | null;
  tracking?: number | null;
  baselineShift?: number | null;
  horizontalScale?: number | null;
  verticalScale?: number | null;
  fontName?: string;
  fontStyleName?: string;
  antiAlias?: string;
  _orgTransform?: {
    xx: number;
    xy: number;
    yx: number;
    yy: number;
    tx: number;
    ty: number;
  };
  textStyleRange?: LanhuTextStyleRange[];
  bounds?: LanhuBounds;
  boundingBox?: LanhuBounds;
  textShape?: Array<{
    char?: string;
    orientation?: string;
    transform?: {
      xx: number;
      xy: number;
      yx: number;
      yy: number;
      tx: number;
      ty: number;
    };
    rowCount?: number;
    columnCount?: number;
    rowMajorOrder?: boolean;
    rowGutter?: number;
    columnGutter?: number;
    spacing?: number;
    frameBaselineAlignment?: string;
    firstBaselineMinimum?: number;
    base?: {
      horizontal?: number;
      vertical?: number;
    };
  }>;
}

export interface LanhuGradientStop {
  location?: number;
  midpoint?: number;
  color?: LanhuColor;
  opacity?: LanhuUnitValue;
}

export interface LanhuGradientFill {
  type?: string;
  angle?: number;
  gradientForm?: string;
  gradient?: {
    type?: string;
    angle?: number;
    colors?: LanhuGradientStop[];
  };
  colors?: LanhuGradientStop[];
}

export interface LanhuFill {
  color?: LanhuColor;
  class?: string;
  gradientFill?: LanhuGradientFill;
  angle?: LanhuUnitValue;
  type?: string;
  gradient?: {
    name?: string;
    gradientForm?: string;
    interfaceIconFrameDimmed?: number;
    colors?: LanhuGradientStop[];
    transparency?: Array<{
      opacity?: LanhuUnitValue;
      location?: number;
      midpoint?: number;
    }>;
  };
}

export interface LanhuStrokeStyle {
  strokeStyleVersion?: number;
  strokeEnabled?: boolean;
  fillEnabled?: boolean;
  strokeStyleLineWidth?: number;
  strokeStyleLineAlignment?: string;
  strokeStyleOpacity?: LanhuUnitValue;
  strokeStyleContent?: {
    color?: LanhuColor;
  };
}

export interface LanhuShadowEffect {
  enabled?: boolean;
  present?: boolean;
  showInDialog?: boolean;
  mode?: string;
  color?: LanhuColor;
  opacity?: LanhuUnitValue;
  useGlobalAngle?: boolean;
  localLightingAngle?: LanhuUnitValue;
  distance?: number;
  chokeMatte?: number;
  blur?: number;
  layerConceals?: boolean;
}

export interface LanhuLayerEffects {
  solidFill?: {
    enabled: boolean;
    present: boolean;
    showInDialog: boolean;
    mode: string;
    color: LanhuColor;
    opacity: LanhuUnitValue;
  };
  masterFXSwitch?: boolean;
  dropShadow?: LanhuShadowEffect;
  innerShadow?: LanhuShadowEffect;
}

export interface LanhuBlendOptions {
  mode?: string;
  fillOpacity?: LanhuUnitValue;
  opacity?: LanhuUnitValue;
}

export interface LanhuPathComponent {
  shapeOperation?: string;
  subpathListKey?: Array<{
    closedSubpath: boolean;
    points: Array<{
      anchor: { x: number; y: number };
      forward: { x: number; y: number };
      backward: { x: number; y: number };
      smooth?: boolean;
    }>;
  }>;
  origin?: {
    type?: string;
    bounds?: LanhuBounds;
    radii?: number[];
  };
}

export type LanhuLayerType =
  | 'artboardSection'
  | 'layerSection'
  | 'layer'
  | 'textLayer'
  | 'shapeLayer'
  | 'smartObjectLayer'
  | 'adjustmentLayer';

export interface LanhuLayer {
  id: number;
  index?: number;
  type: LanhuLayerType;
  name: string;
  visible: boolean;
  clipped: boolean;
  layers?: LanhuLayer[];
  bounds?: LanhuBounds;
  boundsWithFX?: LanhuBounds;
  _orgBounds?: LanhuBounds;
  width?: number;
  height?: number;
  top?: number;
  left?: number;
  text?: boolean;
  textInfo?: LanhuTextInfo;
  fill?: LanhuFill;
  strokeStyle?: LanhuStrokeStyle;
  path?: {
    pathComponents?: LanhuPathComponent[];
    bounds?: LanhuBounds;
    defaultFill?: boolean;
  };
  layerEffects?: LanhuLayerEffects;
  pixels?: boolean;
  blendOptions?: LanhuBlendOptions;
  generatorSettings?: boolean;
  isAsset?: boolean;
  isSlice?: boolean;
  isClippingMask?: boolean;
  images?: Record<string, string>;
  ddsImages?: Record<string, string>;
  blur?: Record<string, unknown>;
  adjustment?: Record<string, unknown>;
  mask?: Record<string, unknown>;
  beforeClippedFrame?: LanhuBounds;
}

export interface LanhuArtboard {
  artboardRect: LanhuArtboardRect;
}

export interface LanhuBoard {
  id: number;
  index?: number;
  type: LanhuLayerType;
  name: string;
  visible: boolean;
  clipped: boolean;
  generatorSettings?: boolean;
  artboard?: LanhuArtboard;
  layers: LanhuLayer[];
}

export interface LanhuAssetSummary {
  name: string;
  id: number;
  isAsset: boolean;
  isSlice: boolean;
  bounds: LanhuBounds;
  scaleType?: number;
}

export interface LanhuDocument {
  board: LanhuBoard;
  assets?: LanhuAssetSummary[];
}

export interface SimplifiedBounds {
  x: number;
  y: number;
  width: number;
  height: number;
  absoluteX?: number;
  absoluteY?: number;
}

export interface SimplifiedRelativeRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface SimplifiedTextStyle {
  fontSize: number;
  fontFamily: string;
  fontWeight?: number;
  fontStyle?: 'normal' | 'italic';
  color: string;
  alignment: string;
  lineHeight?: number;
  letterSpacing?: number;
}

export interface SimplifiedGradientStop {
  position: number;
  color: string;
  opacity?: number;
}

export interface SimplifiedGradient {
  type: string;
  angle?: number;
  stops: SimplifiedGradientStop[];
}

export interface SimplifiedFill {
  type: 'solid' | 'gradient';
  color?: string;
  gradient?: SimplifiedGradient;
}

export interface SimplifiedStroke {
  color: string;
  width: number;
  opacity?: number;
  alignment?: string;
}

export interface SimplifiedShadow {
  type: 'dropShadow' | 'innerShadow';
  color: string;
  opacity: number;
  angle?: number;
  distance: number;
  blur: number;
  spread: number;
  x: number;
  y: number;
  blendMode?: string;
}

export interface SimplifiedTextStyleRange {
  from: number;
  to: number;
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: number;
  fontStyle?: 'normal' | 'italic';
  color?: string;
}

export interface SimplifiedTextMetrics {
  relativeBounds?: SimplifiedRelativeRect;
  relativeBoundingBox?: SimplifiedRelativeRect;
  antiAlias?: string;
  frameBaselineAlignment?: string;
  baselineShift?: number;
  horizontalScale?: number;
  verticalScale?: number;
  transformScaleX?: number;
  transformScaleY?: number;
}

export interface SimplifiedClipMetadata {
  clipped: boolean;
  isMask: boolean;
  maskId?: number;
  targetIds?: number[];
  beforeClipBounds?: SimplifiedBounds;
}

export interface SimplifiedAdjustment {
  type?: string;
  presetKind?: string;
  clipped?: boolean;
  curves?: Array<{
    channel?: string;
    points: Array<{
      x: number;
      y: number;
    }>;
  }>;
}

export interface SimplifiedPathSummary {
  componentCount: number;
  pointCount: number;
  originType?: string;
  pathBounds?: SimplifiedBounds;
  hasComplexGeometry: boolean;
}

export interface SimplifiedPathPointHandle {
  x: number;
  y: number;
}

export interface SimplifiedPathPointData {
  anchor: SimplifiedPathPointHandle;
  forward: SimplifiedPathPointHandle;
  backward: SimplifiedPathPointHandle;
  smooth?: boolean;
}

export interface SimplifiedPathSubpathData {
  closed: boolean;
  points: SimplifiedPathPointData[];
}

export interface SimplifiedPathComponentData {
  operation?: string;
  originType?: string;
  originBounds?: SimplifiedBounds;
  radii?: number[];
  subpaths: SimplifiedPathSubpathData[];
}

export interface SimplifiedPathGeometry extends SimplifiedPathSummary {
  components: SimplifiedPathComponentData[];
}

export interface SimplifiedBoundsMetadata {
  frame: SimplifiedBounds;
  visual?: SimplifiedBounds;
  original?: SimplifiedBounds;
  path?: SimplifiedBounds;
}

export type SimplifiedRenderStrategy = 'asset' | 'text' | 'shape' | 'group' | 'adjustment' | 'layer';

export interface SimplifiedSpacing {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface SimplifiedLayoutHint {
  mode: 'absolute' | 'flex-row' | 'flex-column';
  itemIds: number[];
  overlayIds: number[];
  gap?: number;
  padding?: SimplifiedSpacing;
  justifyContent?: 'start' | 'center' | 'end' | 'space-between';
  alignItems?: 'start' | 'center' | 'end' | 'stretch';
  contentBounds?: SimplifiedBounds;
}

export interface SimplifiedSizeHint {
  width: 'fixed' | 'content';
  height: 'fixed' | 'content';
}

export interface SimplifiedLayer {
  id: number;
  name: string;
  type: string;
  sourceType?: LanhuLayerType;
  visible: boolean;
  clipped?: boolean;
  isClippingMask?: boolean;
  isAsset?: boolean;
  parentId?: number;
  depth?: number;
  zIndex?: number;
  bounds: SimplifiedBounds;
  boundsMetadata?: SimplifiedBoundsMetadata;
  intersectsArtboard?: boolean;
  partiallyOutsideArtboard?: boolean;
  text?: string;
  textStyle?: SimplifiedTextStyle;
  textStyleRanges?: SimplifiedTextStyleRange[];
  textMetrics?: SimplifiedTextMetrics;
  fill?: string;
  fills?: SimplifiedFill[];
  stroke?: SimplifiedStroke;
  opacity?: number;
  fillOpacity?: number;
  blendMode?: string;
  borderRadius?: number | number[];
  shapeType?: string;
  pathSummary?: SimplifiedPathSummary;
  pathData?: SimplifiedPathGeometry;
  shadows?: SimplifiedShadow[];
  clip?: SimplifiedClipMetadata;
  adjustment?: SimplifiedAdjustment;
  assetUrl?: string;
  assetUrls?: Record<string, string>;
  renderStrategy?: SimplifiedRenderStrategy;
  shouldRenderChildren?: boolean;
  layoutHint?: SimplifiedLayoutHint;
  sizeHint?: SimplifiedSizeHint;
  isTextOnlyContainer?: boolean;
  containerVisualSourceId?: number;
  children?: SimplifiedLayer[];
}

export interface ArtboardInfo {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface TextLayerSummary {
  id: number;
  name: string;
  text: string;
  bounds: SimplifiedBounds;
  style?: SimplifiedTextStyle;
}

export interface AssetSummary {
  id: number;
  name: string;
  type: string;
  bounds: SimplifiedBounds;
  assetUrl?: string;
  assetUrls?: Record<string, string>;
}

export interface DesignTokens {
  colors: string[];
  fonts: string[];
  fontSizes: number[];
  radii: number[];
  shadowPresets: string[];
}

export interface BuildLayerTreeOptions {
  includeInvisible?: boolean;
  normalizeToArtboard?: boolean;
}

export interface DocumentStats {
  totalLayers: number;
  textLayers: number;
  shapeLayers: number;
  imageLayers: number;
  groupLayers: number;
  width: number;
  height: number;
}

export interface RestorationMaskGroup {
  maskId: number;
  targetIds: number[];
  bounds?: SimplifiedBounds;
}

export interface RestorationPlan {
  rootIds: number[];
  paintOrder: number[];
  rasterAssetIds: number[];
  textLayerIds: number[];
  clippedLayerIds: number[];
  partiallyOutsideArtboardIds: number[];
  flexContainerIds: number[];
  textAutoSizeIds: number[];
  maskGroups: RestorationMaskGroup[];
  guidance: string[];
}
