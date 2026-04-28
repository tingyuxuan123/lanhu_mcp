# brainstorm: readable uniapp output

## Goal

Improve UniApp page generation so the output is maintainable by humans, not only visually restorable by machines. The generated SFC should be easier to read, easier to refactor downstream, and lighter in DOM/CSS without causing a large fidelity regression.

## What I already know

* The current UniApp pipeline emits mostly geometry-driven classes such as `node-14307`.
* The current renderer still uses many absolute-positioned nodes as the default fallback layout.
* The user wants to optimize for readability and maintainability, not only first-pass visual fidelity.
* The user explicitly requires high generality, not a narrowly tuned single-page solution.
* The chosen architecture direction is:
  * pattern whitelist + generic engine
  * first-wave coverage targets homepage/dashboard-like pages
* The user wants both section-level and repeated item-level semantic naming, not only top-level section wrappers.
* The user wants semantic output to retain design traceability metadata for debugging and round-trip inspection.
* The requested directions are:
  * remove as much absolute positioning as possible and prefer Flex/Grid
  * rename classes to semantic names
  * unify icon handling and support CSS variables / design tokens
  * remove useless empty nodes
  * reduce redundant / repeated styles
* Current implementation centers in:
  * `src/services/uniapp-renderer.ts`
  * `src/runtime/uniapp-restoration-runtime.mjs`
* Current output contract includes:
  * `.vue`
  * `*-bundle.json`
  * `*-meta.json`
  * localized image assets

## Assumptions (temporary)

* Full removal of absolute positioning for all nodes is not realistic in one step without hurting layout fidelity.
* The chosen direction is a balanced hybrid strategy:
  * semantic block extraction for obvious sections
  * retain absolute positioning only for overlays / ambiguous geometry
* High generality should be achieved through a generic normalization/fallback pipeline plus extensible pattern inference, not through one monolithic heuristic that tries to solve all pages at once.
* Semantic naming must come from heuristics and structure inference, not from raw Lanhu layer names alone.

## Open Questions

* None currently blocking.

## Requirements (evolving)

* Generated UniApp output must become more readable than the current geometry-only output.
* Repeated style declarations should be deduplicated into shared utility / tokenized rules where possible.
* Empty nodes that do not carry layout or visual value should be removed.
* Absolute positioning should be reduced where the structure can be inferred safely.
* Overlay / decoration / ambiguous nodes may remain absolutely positioned as a controlled fallback.
* Icons should be normalized under a single rendering strategy instead of mixed ad hoc handling.
* The optimization strategy must remain highly generalizable across pages.
* Generality should come from a layered architecture:
  * generic normalization
  * pattern registry / white-listed structure transforms
  * safe absolute fallback for low-confidence cases
* The first-wave pattern whitelist should prioritize homepage/dashboard structures such as:
  * tab bars
  * function-entry rows / feature shortcuts
  * stat summary cards
  * announcement bars
  * primary recommendation / activity cards
* Semantic naming must cover:
  * section wrappers
  * repeated items inside recognized sections
* Generated semantic nodes should retain traceability metadata back to original design nodes, for example original node ids.

## Acceptance Criteria (evolving)

* [ ] Generated output contains fewer absolute-positioned nodes for structurally regular sections.
* [ ] Generated class names are more descriptive than raw numeric node ids for key page sections.
* [ ] Repeated colors / spacing / radii can be centralized into variables or shared declarations.
* [ ] Empty non-visual wrapper nodes are reduced without breaking layout.
* [ ] Existing renderer tests are updated and new structure-oriented tests are added.
* [ ] Semantic output retains lightweight traceability back to original design nodes.

## Definition of Done (team quality bar)

* Tests added/updated (unit/integration where appropriate)
* Lint / typecheck / CI green
* Docs/notes updated if behavior changes
* Rollout/rollback considered if risky

## Out of Scope (explicit)

* Pixel-perfect semantic reconstruction for every arbitrary Lanhu page in one pass
* Rewriting the entire parser and renderer stack at once
* Solving all downstream business-component decomposition in this task

## Technical Notes

* Current renderer is still mostly node-by-node emission with local heuristics.
* `layoutHint` already provides a foothold for flow layout restoration.
* `bundle.json` remains useful as a machine-readable debug artifact even if `.vue` becomes more semantic.
* Key trade-off:
  * more semantic output usually requires stronger structural inference, which increases heuristic complexity and regression risk.

## Decision (ADR-lite)

**Context**: The current UniApp output is visually usable but hard to maintain because it relies heavily on absolute positioning, numeric class names, repeated declarations, and redundant wrapper nodes.

**Decision**: Use a balanced strategy. Convert recognized primary structure into flow layout, keep overlays and ambiguous geometry as absolute fallback, and improve readability incrementally through semantic section extraction, node cleanup, and style deduplication.

**Consequences**:

* Lower regression risk than a full layout rewrite
* Better maintainability than the current geometry-first emitter
* Some nodes will intentionally remain non-semantic or absolute when inference confidence is low
* High generality will be pursued through a generic core plus extensible pattern layers, not through a one-shot fully generic semantic rewrite
* Semantic output will still carry lightweight trace metadata so maintainability gains do not come at the cost of debuggability

## Current Convergence

* Architecture:
  * generic normalization pipeline
  * pattern whitelist / registry
  * low-confidence absolute fallback
* First-wave scope:
  * homepage/dashboard pages first
* Immediate value targets:
  * section readability
  * item readability inside recognized sections
  * DOM cleanup
  * style deduplication
  * reduced absolute positioning in recognized primary structures
  * preserve node-to-design traceability during debugging
