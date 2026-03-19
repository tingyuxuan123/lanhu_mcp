/**
 * 蓝湖 Sketch JSON 数据结构类型定义
 * 这是蓝湖特有的格式，不同于标准 Sketch 格式
 */

/**
 * 蓝湖颜色（RGB 0-255 范围）
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

/**
 * 边界信息
 */
export interface LanhuBounds {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

/**
 * 艺术板矩形
 */
export interface LanhuArtboardRect {
  top: number;
  left: number;
  bottom: number;
  right: number;
}

/**
 * 文本样式范围
 */
export interface LanhuTextStyleRange {
  from: number;
  to: number;
  textStyle: {
    fontName: string;
    fontStyleName: string;
    size: number;
    fontPostScriptName: string;
    color?: LanhuColor;
    fontTechnology?: number;
  };
}

/**
 * 文本信息
 */
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
  fontName?: string;
  fontStyleName?: string;
  textStyleRange?: LanhuTextStyleRange[];
  bounds?: LanhuBounds;
}

/**
 * 填充样式
 */
export interface LanhuFill {
  color?: LanhuColor;
  class?: string;
}

/**
 * 描边样式
 */
export interface LanhuStrokeStyle {
  strokeStyleVersion?: number;
  strokeEnabled?: boolean;
  fillEnabled?: boolean;
  strokeStyleLineWidth?: number;
  strokeStyleContent?: {
    color?: LanhuColor;
  };
}

/**
 * 图层效果
 */
export interface LanhuLayerEffects {
  solidFill?: {
    enabled: boolean;
    present: boolean;
    showInDialog: boolean;
    mode: string;
    color: LanhuColor;
    opacity: { value: number; units: string };
  };
}

/**
 * 混合选项
 */
export interface LanhuBlendOptions {
  mode?: string;
  fillOpacity?: { value: number; units: string };
  opacity?: { value: number; units: string };
}

/**
 * 路径组件
 */
export interface LanhuPathComponent {
  shapeOperation?: string;
  subpathListKey?: Array<{
    closedSubpath: boolean;
    points: Array<{
      anchor: { x: number; y: number };
      forward: { x: number; y: number };
      backward: { x: number; y: number };
      smooth: boolean;
    }>;
  }>;
}

/**
 * 图层类型
 */
export type LanhuLayerType =
  | 'artboardSection'
  | 'layerSection'
  | 'layer'
  | 'textLayer'
  | 'shapeLayer'
  | 'smartObjectLayer';

/**
 * 蓝湖图层
 */
export interface LanhuLayer {
  id: number;
  type: LanhuLayerType;
  name: string;
  visible: boolean;
  clipped: boolean;
  layers?: LanhuLayer[];
  boundsWithFX?: LanhuBounds;
  _orgBounds?: LanhuBounds;
  width?: number;
  height?: number;
  top?: number;
  left?: number;

  // 文本图层特有
  text?: boolean;
  textInfo?: LanhuTextInfo;

  // 形状图层特有
  fill?: LanhuFill;
  strokeStyle?: LanhuStrokeStyle;
  path?: { pathComponents: LanhuPathComponent[] };

  // 普通图层特有
  layerEffects?: LanhuLayerEffects;
  pixels?: boolean;
  blendOptions?: LanhuBlendOptions;

  // 其他
  generatorSettings?: boolean;
  isAsset?: boolean;
  isSlice?: boolean;
}

/**
 * 艺术板信息
 */
export interface LanhuArtboard {
  artboardRect: LanhuArtboardRect;
}

/**
 * 蓝湖画板（文档根节点）
 */
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

/**
 * 蓝湖文档
 */
export interface LanhuDocument {
  board: LanhuBoard;
}

/**
 * 简化的图层数据（用于工具返回）
 */
export interface SimplifiedLayer {
  id: number;
  name: string;
  type: string;
  visible: boolean;
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  text?: string;
  textStyle?: {
    fontSize: number;
    fontFamily: string;
    color: string;
    alignment: string;
  };
  fill?: string;
  stroke?: {
    color: string;
    width: number;
  };
  children?: SimplifiedLayer[];
}

/**
 * 文档统计信息
 */
export interface DocumentStats {
  totalLayers: number;
  textLayers: number;
  shapeLayers: number;
  imageLayers: number;
  groupLayers: number;
  width: number;
  height: number;
}
