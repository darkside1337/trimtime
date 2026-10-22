# Design system adoption — 2026-10-15

TrimTime's Soft Welcome exploration now supplies the shared light theme, Base UI/shadcn components, logo, and project icons. [DESIGN.md](../DESIGN.md) records the measured tokens and usage. The design-system page imports the shared components and retains its specimen layout locally.

## Visual evidence

Matching 1280 × 577 desktop and 390 × 844 mobile captures: [desktop before](design-system-baseline/desktop-before.png), [desktop after](design-system-baseline/desktop-after.png), [mobile before](design-system-baseline/mobile-before.png), [mobile after](design-system-baseline/mobile-after.png). The layout, scale, illustrations, and logo remain consistent. Copy identifying the temporary exploration was updated to describe the shared design system.

## Verification

- `node_modules/.bin/eslint .` — passed.
- `node_modules/.bin/tsc --noEmit --incremental false` — passed.
- `node_modules/.bin/next build` — passed with network access for configured Google fonts. The sandboxed build stalled during compilation without diagnostics.
- Official `@google/design.md` linter — zero errors, ten orphaned-token warnings. These are color primitives and semantic roles used by CSS for borders, focus, accents, and component states but not expressible as references in the document's ten schema component examples; no artificial examples were added solely to silence the warnings.
- Browser WCAG 2 A/AA scan on `/design-system` — zero violations. Axe left 22 FullCalendar contrast nodes for manual review because it could not resolve their layered backgrounds. Computed color pair checks gave 4.50:1 for the palest muted text pair, 5.11–6.20:1 for tinted event text, and at least 13.40:1 for ink event text.
- Browser checks covered mobile dialog focus and Escape restoration, keyboard select operation, menu opening, responsive rendering, shared status colors, and metadata/icon requests.
- Approved symbol and horizontal SVG source hashes match the recorded brand masters and served copies. ICO contains 16, 32, and 48 px frames; PNG icons are 512 and 180 px.

## Limits

There is no configured automated product test suite yet. The browser checks cover the design-system specimens, not the future booking journeys. The linter warnings and axe's calendar review items remain visible above.
