# Rendering Quality Guidelines

> This project has **no frontend UI**. This file documents rendering output quality standards and verification procedures.

---

## Overview

The project generates HTML and UniApp SFC files from Lanhu design data. Quality is measured by visual fidelity and delivery integrity — the output must both look correct and be directly consumable by downstream projects.

---

## Visual Fidelity

### Screenshot Comparison

The `lanhu_compare_images` tool provides automated visual diff:

- **Similarity score:** 0–100 (100 = pixel-perfect match)
- **Grid-based analysis:** 8×4 grid default for regional mismatch detection
- **Diff image:** Highlights mismatched pixels

**Target:** ≥ 85% similarity for most pages. Complex designs with many effects may score lower.

### Manual Verification Checklist

- [ ] All visible layers are present in output
- [ ] Text content matches design (no missing/extra characters)
- [ ] Colors are accurate (no unexpected shifts)
- [ ] Layout matches design (elements in correct positions)
- [ ] Font sizes and weights are correct
- [ ] Images are properly localized and loading
- [ ] Border radius matches design
- [ ] Opacity/transparency is correct
- [ ] Gradients render correctly
- [ ] Shadow effects are visible
- [ ] UniApp output uses `rpx` sizing derived from `design_width`
- [ ] UniApp asset URLs point to the configured public path prefix
- [ ] Rich text segments preserve mixed font sizes/weights instead of flattening to one style

---

## Known Limitations

These are accepted limitations — not bugs:

| Feature | Status | Notes |
|---------|--------|-------|
| SVG complex paths | Partial | HTML may use inline SVG; UniApp falls back to data-URI image for complex geometry |
| Blend modes | Limited | Most blend modes map to CSS equivalents |
| Adjustment layers | Limited | Blur/brightness may not fully replicate |
| Text overflow | Approximate | Multi-line text wrapping may differ |
| Very small text (<10px) | May blur | Depends on rendering engine |

---

## Rendering Strategies

The HTML runtime uses several heuristic strategies for specific UI patterns:

- **Icon detection:** Nodes ≤48px max dimension → vector icon candidate
- **Ellipse dots pattern:** Multiple aligned ellipses → flex row of circles
- **Ellipse ring:** Outer + inner circles → CSS border ring + center dot
- **Asset flow layout:** Vertical stacking → flex column
- **Centered asset layout:** Background + centered foreground → flex center

If a new pattern is needed, add detection logic in the runtime's `renderContainer()` function.

---

## Quality Regression

When making changes to the rendering pipeline:

1. Run `npm run validate:sample` to verify sample output
2. Run `npm test` to verify renderer/service contracts
3. For UniApp, run a smoke generation against `tmp_sample.json`
4. Compare screenshots before/after the change when HTML output changes
5. Check that similarity score does not decrease when HTML output changes
6. Verify no new visual regressions in:
   - Text rendering
   - Layout positioning
   - Asset loading
   - Shadow/gradient effects
   - SFC structure (`<template>`, `<script>`, `<style scoped>`)

(To be filled by the team)
