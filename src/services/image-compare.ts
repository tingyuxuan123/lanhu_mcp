import { mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { Jimp, diff as jimpDiff, intToRGBA } from 'jimp';

export interface CompareImagesParams {
  referenceImageUrl?: string;
  referenceImagePath?: string;
  candidateImageUrl?: string;
  candidateImagePath?: string;
  diffOutputPath?: string;
  resizeCandidate?: boolean;
  mismatchThreshold?: number;
  gridRows?: number;
  gridCols?: number;
}

export interface CompareImagesResult {
  referenceSize: { width: number; height: number };
  candidateSize: { width: number; height: number };
  resizedCandidate: boolean;
  visualDiffPercent: number;
  pixelMismatchPercent: number;
  meanAbsoluteDiffPercent: number;
  weightedDiffPercent: number;
  visualSimilarityScore: number;
  mismatchBounds: { x: number; y: number; width: number; height: number } | null;
  worstRegions: Array<{
    row: number;
    col: number;
    x: number;
    y: number;
    width: number;
    height: number;
    diffPercent: number;
    weightedDiffPercent: number;
  }>;
  suggestions: string[];
  diffImagePath?: string;
}

export class ImageCompareService {
  async compare(params: CompareImagesParams): Promise<CompareImagesResult> {
    const referenceSource = params.referenceImageUrl || params.referenceImagePath;
    if (!referenceSource) {
      throw new Error('referenceImageUrl or referenceImagePath is required');
    }

    const reference = await this.loadImage(referenceSource);
    const candidateSource = params.candidateImageUrl || params.candidateImagePath;
    if (!candidateSource) {
      throw new Error('candidateImageUrl or candidateImagePath is required');
    }

    const candidateOriginal = await this.loadImage(candidateSource);
    const referenceWidth = reference.bitmap.width;
    const referenceHeight = reference.bitmap.height;
    const originalCandidateSize = {
      width: candidateOriginal.bitmap.width,
      height: candidateOriginal.bitmap.height,
    };

    let candidate = candidateOriginal.clone();
    let resizedCandidate = false;
    if ((candidate.bitmap.width !== referenceWidth || candidate.bitmap.height !== referenceHeight) && (params.resizeCandidate ?? true)) {
      candidate = candidate.resize({ w: referenceWidth, h: referenceHeight });
      resizedCandidate = true;
    }

    if (candidate.bitmap.width !== referenceWidth || candidate.bitmap.height !== referenceHeight) {
      throw new Error('Reference and candidate image sizes do not match. Enable resizeCandidate to auto-resize.');
    }

    const diffResult = jimpDiff(reference, candidate, params.mismatchThreshold ?? 0.1);
    const analysis = this.analyzePixels(
      reference,
      candidate,
      params.mismatchThreshold ?? 0.12,
      params.gridRows ?? 6,
      params.gridCols ?? 4,
    );

    let diffImagePath: string | undefined;
    if (params.diffOutputPath) {
      diffImagePath = resolve(params.diffOutputPath);
      await mkdir(dirname(diffImagePath), { recursive: true });
      await diffResult.image.write(diffImagePath);
    }

    return {
      referenceSize: { width: referenceWidth, height: referenceHeight },
      candidateSize: originalCandidateSize,
      resizedCandidate,
      visualDiffPercent: Number((diffResult.percent * 100).toFixed(2)),
      pixelMismatchPercent: Number(analysis.pixelMismatchPercent.toFixed(2)),
      meanAbsoluteDiffPercent: Number(analysis.meanAbsoluteDiffPercent.toFixed(2)),
      weightedDiffPercent: Number(analysis.weightedDiffPercent.toFixed(2)),
      visualSimilarityScore: Number(analysis.visualSimilarityScore.toFixed(2)),
      mismatchBounds: analysis.mismatchBounds,
      worstRegions: analysis.worstRegions,
      suggestions: this.buildSuggestions(analysis.worstRegions, analysis.mismatchBounds, referenceWidth, referenceHeight, resizedCandidate),
      diffImagePath,
    };
  }

  private async loadImage(source: string): Promise<any> {
    if (/^https?:\/\//i.test(source)) {
      const response = await fetch(source, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          Accept: '*/*',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to load image: ${response.status} ${response.statusText}`);
      }

      const buffer = Buffer.from(await response.arrayBuffer());
      return Jimp.read(buffer);
    }

    return Jimp.read(resolve(source));
  }

  private analyzePixels(reference: any, candidate: any, mismatchThreshold: number, gridRows: number, gridCols: number) {
    const width = reference.bitmap.width;
    const height = reference.bitmap.height;
    const tiles = Array.from({ length: gridRows * gridCols }, () => ({
      mismatch: 0,
      total: 0,
      weightedDiff: 0,
      weightTotal: 0,
    }));
    let mismatchPixels = 0;
    let diffSum = 0;
    let weightedDiffSum = 0;
    let weightSum = 0;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const referencePixel = intToRGBA(reference.getPixelColor(x, y));
        const candidatePixel = intToRGBA(candidate.getPixelColor(x, y));
        const diff = this.getPixelDiff(referencePixel, candidatePixel);
        const tileRow = Math.min(gridRows - 1, Math.floor((y / height) * gridRows));
        const tileCol = Math.min(gridCols - 1, Math.floor((x / width) * gridCols));
        const tile = tiles[tileRow * gridCols + tileCol];
        const weight = this.getPixelWeight(reference, x, y);
        tile.total += 1;
        tile.weightTotal += weight;
        tile.weightedDiff += diff * weight;
        diffSum += diff;
        weightedDiffSum += diff * weight;
        weightSum += weight;

        if (diff >= mismatchThreshold) {
          tile.mismatch += 1;
          mismatchPixels += 1;
          if (x < minX) minX = x;
          if (y < minY) minY = y;
          if (x > maxX) maxX = x;
          if (y > maxY) maxY = y;
        }
      }
    }

    const worstRegions = tiles
      .map((tile, index) => {
        const row = Math.floor(index / gridCols);
        const col = index % gridCols;
        const x = Math.floor((col / gridCols) * width);
        const y = Math.floor((row / gridRows) * height);
        const regionWidth = Math.ceil(width / gridCols);
        const regionHeight = Math.ceil(height / gridRows);

        return {
          row,
          col,
          x,
          y,
          width: Math.min(regionWidth, width - x),
          height: Math.min(regionHeight, height - y),
          diffPercent: tile.total === 0 ? 0 : Number(((tile.mismatch / tile.total) * 100).toFixed(2)),
          weightedDiffPercent: tile.weightTotal === 0 ? 0 : Number(((tile.weightedDiff / tile.weightTotal) * 100).toFixed(2)),
        };
      })
      .sort((left, right) => right.weightedDiffPercent - left.weightedDiffPercent)
      .slice(0, 5);

    return {
      pixelMismatchPercent: (mismatchPixels / (width * height)) * 100,
      meanAbsoluteDiffPercent: (diffSum / (width * height)) * 100,
      weightedDiffPercent: weightSum === 0 ? 0 : (weightedDiffSum / weightSum) * 100,
      visualSimilarityScore: Math.max(0, 100 - (weightSum === 0 ? 0 : (weightedDiffSum / weightSum) * 100)),
      mismatchBounds: maxX >= 0
        ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
        : null,
      worstRegions,
    };
  }

  private getPixelWeight(image: any, x: number, y: number) {
    const center = this.getLuminance(intToRGBA(image.getPixelColor(x, y)));
    const right = this.getLuminance(intToRGBA(image.getPixelColor(Math.min(image.bitmap.width - 1, x + 1), y)));
    const bottom = this.getLuminance(intToRGBA(image.getPixelColor(x, Math.min(image.bitmap.height - 1, y + 1))));
    const edgeStrength = (Math.abs(center - right) + Math.abs(center - bottom)) / (255 * 2);

    return 1 + edgeStrength * 4;
  }

  private getLuminance(pixel: { r: number; g: number; b: number }) {
    return 0.299 * pixel.r + 0.587 * pixel.g + 0.114 * pixel.b;
  }

  private getPixelDiff(left: { r: number; g: number; b: number; a: number }, right: { r: number; g: number; b: number; a: number }) {
    return (
      Math.abs(left.r - right.r)
      + Math.abs(left.g - right.g)
      + Math.abs(left.b - right.b)
      + Math.abs(left.a - right.a)
    ) / (255 * 4);
  }

  private buildSuggestions(
    worstRegions: CompareImagesResult['worstRegions'],
    mismatchBounds: CompareImagesResult['mismatchBounds'],
    width: number,
    height: number,
    resizedCandidate: boolean,
  ): string[] {
    const suggestions: string[] = [];

    if (!mismatchBounds || worstRegions.every(region => region.diffPercent === 0)) {
      return ['当前候选图和参考图已经完全一致。'];
    }

    if (resizedCandidate) {
      suggestions.push('候选图尺寸和参考图不一致，已自动缩放；优先先对齐截图尺寸再做视觉比较。');
    }

    if (mismatchBounds) {
      if (mismatchBounds.y < height * 0.2) {
        suggestions.push('顶部区域差异明显，优先检查状态栏、导航栏、顶部背景和搜索框。');
      }
      if (mismatchBounds.y + mismatchBounds.height > height * 0.8) {
        suggestions.push('底部区域差异明显，优先检查 TabBar、高亮态和底部留白。');
      }
      if (mismatchBounds.width > width * 0.85 && mismatchBounds.height > height * 0.85) {
      suggestions.push('差异覆盖几乎整张图，通常是整体缩放、主背景色或容器宽高不一致。');
      }
    }

    for (const region of worstRegions.slice(0, 3)) {
      suggestions.push(`重点修正区域：第 ${region.row + 1} 行第 ${region.col + 1} 列，加权差异约 ${region.weightedDiffPercent}%。`);
    }

    if (suggestions.length === 0) {
      suggestions.push('整体差异较小，可以继续微调字体、阴影和圆角。');
    }

    return suggestions;
  }
}

export const imageCompareService = new ImageCompareService();

