# TrimTime — Soft Welcome

The user approved **Soft Welcome** and requested a showcase of that exact identity. These files derive from the approved mark and lockup, without creative refinement or redesign.

## Authority and preservation

- `symbol-primary.svg` is the exact approved symbol master, copied byte for byte.
- `horizontal-primary.svg` is the exact approved horizontal master, copied byte for byte.
- Other files only substitute fill colors, extract the existing wordmark group, or translate untouched groups to compose a stacked arrangement.
- Every path, rectangle, radius, coordinate, glyph string, font attribute, tracking value, and embedded Manrope font remains unchanged. There is no outlining, redrawing, optical adjustment, or alternate typography.
- The SVGs are self-contained. Their embedded font requires no old concept folder or external font file.

SHA-256 master hashes and dimensions are recorded in `asset-metadata.json`. The approved masters here are the authority for subsequent derivations.

## Files and dimensions

| Composition | Canvas     | Treatments                             |
| ----------- | ---------- | -------------------------------------- |
| Symbol      | 256 × 256  | `primary`, `mono`, `reversed`, `white` |
| Horizontal  | 1000 × 256 | `primary`, `mono`, `reversed`, `white` |
| Wordmark    | 512 × 256  | `ink`, `white`                         |
| Stacked     | 600 × 480  | `primary`, `mono`, `reversed`, `white` |

The horizontal canvas intentionally preserves the approved source's spacing and right-hand canvas area. Wordmark-only uses an outer translation of `(-254, 0)` to crop the source lettering with a 16-unit left inset. Stacked uses translation only: symbol `(172, 16)`, wordmark `(-203.774, 232)`; individual element sizes and relative proportions are unchanged.

## Color treatments

- Primary: charcoal `#242424` with mint `#B9EED4`, for white or warm-light surfaces.
- Mono / ink: charcoal `#242424`, including use on mint surfaces.
- Reversed: white `#FFFFFF` with the same mint interval, for charcoal surfaces.
- White: one-color white `#FFFFFF`, for charcoal surfaces.

All backgrounds belong to the showcase layout rather than the SVG artwork.

## Verification

Derivation assertions verified byte-identical primary copies, identical shape attributes across every symbol-bearing asset, identical live-text/font attributes and embedded font data across every wordmark-bearing asset, and identical public/source copies. Chrome measured the source wordmark at approximately 467.55 units wide before the crop/stacked translations.

A local contact sheet was rendered and visually inspected across all 14 assets on light, charcoal, and mint grounds, including genuine 16/32/64/128 px symbol samples. No clipped lettering, missing font, changed geometry, or misplaced mint treatment was observed. All four symbol treatments pass the logo skill's structural audit with 100/100 heuristic scores.

The approved wordmark remains live SVG text with its embedded Manrope WOFF2. This intentionally preserves the approved master; it is not an outlined print master. Typeface conversion was outside this request.
