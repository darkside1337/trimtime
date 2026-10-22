---
version: alpha
name: TrimTime Soft Welcome
description: The established light visual system for the TrimTime barber-booking demo.
colors:
  ink: "#242424"
  paper: "#FFFFFF"
  cloud: "#F7F7F5"
  pebble: "#72726E"
  mist: "#E6E6E2"
  blue-wash: "#EAF5FF"
  sky: "#62C3FF"
  mint: "#B9EED4"
  butter: "#FFE5A3"
  lilac: "#D8CBF4"
  success: "#21734F"
  success-surface: "#E4F5EB"
  warning: "#986411"
  warning-surface: "#FFF4D9"
  destructive: "#C44636"
  destructive-text: "#BD4234"
  destructive-surface: "#FCEAE7"
  primary: "{colors.ink}"
  on-primary: "{colors.paper}"
  background: "{colors.paper}"
  foreground: "{colors.ink}"
  surface: "{colors.cloud}"
  muted-foreground: "{colors.pebble}"
  border: "{colors.mist}"
  secondary: "{colors.blue-wash}"
  on-secondary: "#254F6B"
  accent: "{colors.blue-wash}"
  focus: "{colors.sky}"
typography:
  display:
    fontFamily: Manrope
    fontSize: 72px
    fontWeight: 700
    lineHeight: 1.07
    letterSpacing: -0.04em
  heading:
    fontFamily: Manrope
    fontSize: 40px
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: -0.03em
  section:
    fontFamily: Manrope
    fontSize: 32px
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: -0.03em
  title:
    fontFamily: Manrope
    fontSize: 20px
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: -0.02em
  body:
    fontFamily: Inter
    fontSize: 15px
    fontWeight: 400
    lineHeight: 1.6
    letterSpacing: 0em
  label:
    fontFamily: Inter
    fontSize: 13px
    fontWeight: 500
    lineHeight: 1.54
    letterSpacing: 0em
  token:
    fontFamily: Geist Mono
    fontSize: 11px
    fontWeight: 400
    lineHeight: 1.65
    letterSpacing: 0em
rounded:
  small: 8px
  control: 12px
  base: 15px
  surface: 20px
  pill: 999px
spacing:
  1: 4px
  2: 8px
  3: 12px
  4: 16px
  6: 24px
  8: 32px
  12: 48px
  16: 64px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    height: 44px
  button-secondary:
    backgroundColor: "{colors.secondary}"
    textColor: "{colors.on-secondary}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    height: 44px
  button-destructive:
    backgroundColor: "{colors.destructive-surface}"
    textColor: "{colors.destructive-text}"
    rounded: "{rounded.pill}"
    height: 44px
  input:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    height: 44px
  input-invalid:
    backgroundColor: "{colors.destructive-surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    height: 44px
  surface:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.surface}"
  badge-success:
    backgroundColor: "{colors.success-surface}"
    textColor: "{colors.success}"
    rounded: "{rounded.pill}"
  badge-warning:
    backgroundColor: "{colors.warning-surface}"
    textColor: "{colors.warning}"
    rounded: "{rounded.pill}"
  dialog:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.surface}"
  tooltip:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    rounded: "{rounded.small}"
---

## Overview

Soft Welcome is the approved TrimTime identity: generous white space, warm charcoal, quiet neutral surfaces, and playful sky, mint, butter, and lilac accents. The values above are measured from the established `/design-system` CSS and rendered desktop/mobile page, then promoted into `app/globals.css`. Use the existing components and artwork; this document is guidance for adoption, not permission to reinterpret them.

### Logo

`brand/soft-welcome/symbol-primary.svg` and `horizontal-primary.svg` are the approved masters. The other source SVGs preserve their geometry and lettering through color substitution or group translation, as recorded in `brand/soft-welcome/README.md`. Matching files under `public/brand/soft-welcome/` are served copies. Use `TrimTimeLogo` for product UI and choose only its supported arrangement/treatment combinations.

Use primary charcoal/mint on white or Cloud; mono ink on mint; reversed white/mint or one-color white on ink. The horizontal, stacked, symbol-only, and wordmark-only artwork each has an established use. The symbol's visible bounds leave roughly 28 units of horizontal and 30 units of top clear space in its 256-unit canvas; retain that built-in space and avoid crowding it with adjacent content. The 16 px symbol has been inspected as an icon; use a larger lockup where the lettering must be read. An icon's white canvas is a browser-background treatment, not a new logo configuration.

## Colors

The YAML color tokens are normative. `ink`, `paper`, `cloud`, `pebble`, `mist`, and the four accent colors are primitives. Semantic aliases carry foreground/background intent: primary/on-primary, background/foreground, secondary/on-secondary, and surface/foreground. Success and warning pair with their pale surfaces; avoid using light accents as small text on white. Sky is the visible focus color. The established destructive red stays `#C44636`; the closely related `destructive-text` is an accessibility adjustment for its pale surface because the original pair measured only 4.22:1.

CSS uses `--tt-*` for primitives, shadcn's `--background`, `--primary`, `--border`, etc. for semantic roles, and Tailwind v4 `@theme inline` to expose `bg-primary`, `text-foreground`, and related utilities. The document's `on-primary` corresponds to CSS `--primary-foreground`; `on-secondary` to `--secondary-foreground`; `focus` to `--ring`. The approved application theme is light. Dark charcoal panels are isolated logo presentation surfaces.

## Typography

Manrope is the locally loaded heading face, Inter is the body/interface face, and Geist Mono is reserved for values and token samples. The scale in YAML records the desktop specimens; the display heading uses `clamp(48px, 5.7vw, 72px)` in the exploration and 54 px on its narrow layout. The body is 15/24 px; mobile text-entry controls use 16 px to avoid browser zoom. Headings generally use 600–700 weight and slightly negative tracking; interface copy stays at 400–600. Preserve the approved live-text Manrope inside wordmark SVGs.

## Layout

The measured spacing rhythm is 4, 8, 12, 16, 24, 32, 48, and 64 px. The specimen content area is 1120 px max with 28 px side padding, reduced to 20 px at ≤640 px. The exploration changes its two-column hero and component grids to one column at ≤640 px; it also adjusts intermediate layouts at ≤1000 px. These are existing responsive conventions, not universal page templates. Keep comfortable touch targets and prevent horizontal clipping in menus, forms, and calendar content.

## Elevation & Depth

Surface borders are 1 px Mist. Text-entry and select boundaries use Pebble so empty controls remain distinguishable against Paper, matching the Doop setup reference. Resting surfaces use `0 2px 8px rgb(36 36 36 / 5%)`; floating overlays use `0 8px 28px rgb(36 36 36 / 10%)`. Keep elevation subtle and let spacing and surface color establish hierarchy first.

## Shapes

Use 8 px for small items, 12 px for controls, 15 px as the shadcn base radius, 20 px for surfaces/dialogs, and 999 px for pills. The Soft Welcome SVG geometry is fixed; do not alter its paths, wordmark proportions, tracking, or embedded font.

## Components

Shared Base UI/shadcn components live in `components/ui`; the design-system page must import those same components. The component entries in YAML cover the properties recognized by Google's schema. Borders, shadows, motion, and accessibility states below remain in prose because the schema has no matching component fields.

Buttons are pill shaped with a 44 px default target, 36 px small target, ink primary, blue-wash secondary, and restrained destructive treatment. Inputs, textareas, and selects are 44 px high with a 12 px radius. Checked checkbox/switch controls use success green. Portaled selects, menus, dialogs, and tooltips retain the same tokens outside the page DOM subtree. Hover, active, selected, checked, disabled, invalid, loading, and open states must remain visible and keyboard operable; use the shared component APIs rather than page-only CSS copies.

### Motion and focus

Feedback is 120 ms, transitions are 240 ms, and the soft exit curve is `cubic-bezier(0.16, 1, 0.3, 1)`. Use motion to confirm state changes rather than decorate routine content. Focus-visible combines a 2 px Ink outline with a Sky halo, matching the Doop sign-in reference; Sky alone does not provide sufficient contrast on Paper. Controls use a 2 px offset, links 3 px. The exploration retains its stronger primary-navigation treatment. Under `prefers-reduced-motion: reduce`, animations and transitions are effectively removed while final states remain visible.

### Accessibility

Pair meaningful logos with the accessible name “TrimTime”; use empty alt text when adjacent text already names the brand. Preserve Base UI's roles, labels, focus management, Escape handling, and keyboard selection. Do not rely on accent color alone for status or validation. Check contrast on each actual foreground/background pairing and verify overlays on desktop and mobile.

## Do's and Don'ts

- Do use the approved assets, semantic tokens, and shared controls.
- Do keep specimen-only layout and decorative art within `/design-system`.
- Do test computed styles and rendered states after token changes.
- Don't introduce an application dark theme from a reversed logo sample.
- Don't redraw the logo, invent variants, or substitute a new font.
- Don't treat a successful token export or document lint as visual acceptance.

## Doop visual references

The [TrimTime canvas](http://localhost:4300/c/i6lCZ9U4mi) is the visual reference project. Use the UI reference groups below with this guide, registered tokens, and existing controls; PRD/SPEC/ARCHITECTURE and APP_ROUTES retain their documented authority. A design does not approve a proposed route, settle an open policy, or expand phase scope. Render only the capabilities introduced by the current phase and its declared prerequisites, even when a reference depicts the finished product.

Links target the local Doop instance and require it to be running with access to this canvas. The `?frame=` parameter selects a frame; retain its exact name and ID when sharing references or moving the instance. Confirm the current frame before implementation; a link is not a frozen design version. Exact state names retain labels such as “illustrative” and “source fixture” so their evidence limits stay visible.

### Shared page references

Use this index for responsive variants instead of repeating all three links in each phase. Desktop names are exact; tablet/mobile names append ` · tablet` / ` · mobile` to the page name. Base layouts use 1440 px desktop, 768 px tablet, and 390 px mobile in the inspected sign-in/Settings examples; check each selected frame's actual dimensions rather than assuming every state has all sizes. The [Design system](http://localhost:4300/c/i6lCZ9U4mi?frame=ah9Cu1FIKj) (`ah9Cu1FIKj`) is a separate 1280 px specimen.

| Page / frame name        | Desktop                                                           | Tablet                                                             | Mobile                                                             |
| ------------------------ | ----------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Marketing homepage       | [Y2VSLZNRGs](http://localhost:4300/c/i6lCZ9U4mi?frame=Y2VSLZNRGs) | [tbUtEbXKK6](http://localhost:4300/c/i6lCZ9U4mi?frame=tbUtEbXKK6)  | [PcnFu28jqT](http://localhost:4300/c/i6lCZ9U4mi?frame=PcnFu28jqT)  |
| Google sign-in           | [aJ6U098tXQ](http://localhost:4300/c/i6lCZ9U4mi?frame=aJ6U098tXQ) | [ItLmNd-jyW](http://localhost:4300/c/i6lCZ9U4mi?frame=ItLmNd-jyW)  | [otK67wvMSW](http://localhost:4300/c/i6lCZ9U4mi?frame=otK67wvMSW)  |
| Create and prepare shop  | [od9vamduSk](http://localhost:4300/c/i6lCZ9U4mi?frame=od9vamduSk) | [HibdAq-Djw](http://localhost:4300/c/i6lCZ9U4mi?frame=HibdAq-Djw)  | [Xf6vOkTB6i](http://localhost:4300/c/i6lCZ9U4mi?frame=Xf6vOkTB6i)  |
| Owner dashboard          | [cViOjxBc2N](http://localhost:4300/c/i6lCZ9U4mi?frame=cViOjxBc2N) | [gPetuHijS4](http://localhost:4300/c/i6lCZ9U4mi?frame=gPetuHijS4)  | [hr8okhwAkF](http://localhost:4300/c/i6lCZ9U4mi?frame=hr8okhwAkF)  |
| Owner appointments · new | [ahZKowgSi9](http://localhost:4300/c/i6lCZ9U4mi?frame=ahZKowgSi9) | [6XTAZq7fC1](http://localhost:4300/c/i6lCZ9U4mi?frame=6XTAZq7fC1)  | [BSwXi-G2dw](http://localhost:4300/c/i6lCZ9U4mi?frame=BSwXi-G2dw)  |
| Appointment details      | [K1LWaU0Sic](http://localhost:4300/c/i6lCZ9U4mi?frame=K1LWaU0Sic) | [B3AjN3exrJ](http://localhost:4300/c/i6lCZ9U4mi?frame=B3AjN3exrJ)  | [dEMlnML7Hs](http://localhost:4300/c/i6lCZ9U4mi?frame=dEMlnML7Hs)  |
| Services                 | [iMFu82SzaU](http://localhost:4300/c/i6lCZ9U4mi?frame=iMFu82SzaU) | [bptmLfLwQQ](http://localhost:4300/c/i6lCZ9U4mi?frame=bptmLfLwQQ)  | [J42zgoIbiG](http://localhost:4300/c/i6lCZ9U4mi?frame=J42zgoIbiG)  |
| Barbers                  | [nEQYSkgucP](http://localhost:4300/c/i6lCZ9U4mi?frame=nEQYSkgucP) | [0ETHJJgJrb](http://localhost:4300/c/i6lCZ9U4mi?frame=0ETHJJgJrb)  | [bG9uwzGfev](http://localhost:4300/c/i6lCZ9U4mi?frame=bG9uwzGfev)  |
| Availability             | [K9VtwUYjES](http://localhost:4300/c/i6lCZ9U4mi?frame=K9VtwUYjES) | [\_7hC8N6BCn](http://localhost:4300/c/i6lCZ9U4mi?frame=_7hC8N6BCn) | [gDAtYGAbQ\_](http://localhost:4300/c/i6lCZ9U4mi?frame=gDAtYGAbQ_) |
| Settings                 | [g1GkbadNik](http://localhost:4300/c/i6lCZ9U4mi?frame=g1GkbadNik) | [x1ckjeGF0p](http://localhost:4300/c/i6lCZ9U4mi?frame=x1ckjeGF0p)  | [5Ri8RS-PhP](http://localhost:4300/c/i6lCZ9U4mi?frame=5Ri8RS-PhP)  |
| Activity                 | [74SKM1CMOP](http://localhost:4300/c/i6lCZ9U4mi?frame=74SKM1CMOP) | [hioPaob1KK](http://localhost:4300/c/i6lCZ9U4mi?frame=hioPaob1KK)  | [6-wDzcpgGQ](http://localhost:4300/c/i6lCZ9U4mi?frame=6-wDzcpgGQ)  |
| Customer booking         | [YycaHBhASN](http://localhost:4300/c/i6lCZ9U4mi?frame=YycaHBhASN) | [A1xpx3zfm8](http://localhost:4300/c/i6lCZ9U4mi?frame=A1xpx3zfm8)  | [6fuB7YQc8p](http://localhost:4300/c/i6lCZ9U4mi?frame=6fuB7YQc8p)  |
| Manage booking           | [12OOpkJbh5](http://localhost:4300/c/i6lCZ9U4mi?frame=12OOpkJbh5) | [eBB5f6-eWs](http://localhost:4300/c/i6lCZ9U4mi?frame=eBB5f6-eWs)  | [-kfTRH_NRt](http://localhost:4300/c/i6lCZ9U4mi?frame=-kfTRH_NRt)  |

### Visual verification for every UI phase

- During phase planning, select the relevant base layouts, state frames, viewport dimensions, and any unresolved gaps. Reuse this index for shared pages. Inventory coverage is not a completed visual/accessibility audit.
- Compare the running implementation with its linked references on desktop, tablet, and phone, using the frame widths where available. Check intermediate widths and content fit as needed; missing state variants do not waive responsive verification.
- Capture browser screenshots of the relevant normal, empty/loading, validation, saving/failure, conflict, disabled, and overlay states the phase introduces. Review typography, spacing, content hierarchy, labels, clipping, navigation, and action placement. Verify keyboard/focus, dismissal/history, contrast, and reduced motion through the existing DESIGN/SPEC checks; screenshots alone cannot establish them.
- Record frame names/IDs, actual viewport sizes, comparison screenshots, differences, and unresolved checks in the phase's existing `docs/reports/` evidence. Explain any approved deviation. UI work passes G8 only after the applicable comparisons and functional checks pass; reference availability alone cannot complete a phase.
- Prototype actions, local fixtures/storage, simulated provider results, and static screenshots are illustrative. Rebuild required behavior using the approved architecture and verify persistence, authorization, concurrency, history, integrations, and delivery independently. Never reproduce a prototype shortcut as a product guarantee.

### Known conflicts and reference gaps

- **Messaging:** Settings contains SMS copy/counts, which are outside the approved email/restricted-WhatsApp scope. Its “Resets midnight EDT” copy does not settle OQ-003/OTQ-008. Use its layout with truthful channel/budget information; do not copy those claims or turn demo values into shop-level budget rules.
- **Service duration:** Marketing's illustrative 15-minute beard trim conflicts with the approved minimum 30-minute service duration. Preserve layout guidance while following PRD values/validation; a marketing example cannot change the service rule.
- **Branding:** Owner/TrimTime surfaces follow Soft Welcome. Customer booking/manage references retain the previously approved SharpCut tenant styling. This reference distinction does not approve a configurable branding feature or replace DESIGN's shared implementation authority; resolve any required token/component conflict before implementing it.
- **Scope and paths:** Specimen counters, bells, profile actions, exports, preferences, form constraints, and `.html` links are not additional requirements or approved routes. Implement only documented capabilities; preserve proposed route status and existing open-question IDs.
- **Illustrative evidence:** “Customer booking — 08 · Booking receipt · source fixture,” “Customer booking — cancel dialog · source markup only,” and “Activity — Reminder delivered after local cron simulation” are presentation references, not booking, cancellation, cron, or delivery proof. Actual message templates/recipients still need their own approval and provider evidence.
- **Coverage:** Detailed retry/unknown-result, restoration-denial, resend/revocation, and cleanup-specific presentations are not established by the inspected inventory. UI reference groups below identify affected gaps; confirm coverage during planning and resolve policy-dependent states in their owning documents. Do not create new pages solely to fill these gaps.

## UI reference groups

Use the shared page index for base desktop/tablet/mobile layouts. Each group below lists additional state frames once; phase guidance identifies how the same screens are used at different delivery stages. Phase numbers refer to [ROADMAP](ROADMAP.md), which owns scope, sequencing, blockers, and completion. These notes preserve reference context and do not approve product behavior.

- [Foundation](#foundation)
- [Owner entry and shop setup](#owner-entry-and-shop-setup)
- [Services and barbers](#services-and-barbers)
- [Availability](#availability)
- [Publication and shop sharing](#publication-and-shop-sharing)
- [Customer booking and management](#customer-booking-and-management)
- [Owner calendar and appointments](#owner-calendar-and-appointments)
- [Activity and messaging](#activity-and-messaging)
- [Shop address updates](#shop-address-updates)
- [Historical cleanup](#historical-cleanup)

### Foundation

- [Design system](http://localhost:4300/c/i6lCZ9U4mi?frame=ah9Cu1FIKj) (`ah9Cu1FIKj`)

**Phase 00 reference context:** Design system for the existing theme, assets, and shared controls.

**Coverage and evidence limits:** Preserve the rendered baseline; this phase introduces no product screens. The specimen is not acceptance evidence for later journeys.

### Owner entry and shop setup

- [Google sign-in — connecting · illustrative](http://localhost:4300/c/i6lCZ9U4mi?frame=mPaJu_SQ7g) (`mPaJu_SQ7g`)
- [Google sign-in — failed with retry · illustrative](http://localhost:4300/c/i6lCZ9U4mi?frame=h4UeLd7Wh3) (`h4UeLd7Wh3`)
- [Shop setup — validation errors · illustrative](http://localhost:4300/c/i6lCZ9U4mi?frame=BfZECGS8xd) (`BfZECGS8xd`)
- [Settings — before first booking and publication · illustrative](http://localhost:4300/c/i6lCZ9U4mi?frame=i-EqNPzspA) (`i-EqNPzspA`)
- [Owner dashboard — 04 · Empty schedule](http://localhost:4300/c/i6lCZ9U4mi?frame=v8uLzCjHPw) (`v8uLzCjHPw`)

**Phase 01 reference context:** Marketing homepage; Google sign-in; Create and prepare shop; Settings; use only the modest entry/setup/basic-settings portions.

**Coverage and evidence limits:** Sign-in connecting/failure have mobile variants; pre-booking Settings has tablet/mobile variants in the canvas. The setup error frame does not establish missing field bounds/subdomain rules. OAuth and draft persistence require real verification; full calendar/navigation and publication remain later work.

### Services and barbers

- [Services — add service dialog open](http://localhost:4300/c/i6lCZ9U4mi?frame=yOUn1tsLjJ) (`yOUn1tsLjJ`)
- [Services — Edit Classic cut dialog](http://localhost:4300/c/i6lCZ9U4mi?frame=O_Ce2Y8flA) (`O_Ce2Y8flA`)
- [Barbers — add barber dialog open](http://localhost:4300/c/i6lCZ9U4mi?frame=N89Qhb2gew) (`N89Qhb2gew`)
- [Barbers — Edit Amal dialog](http://localhost:4300/c/i6lCZ9U4mi?frame=Fz5KO4zONL) (`Fz5KO4zONL`)
- [Barbers — varying profiles and service counts](http://localhost:4300/c/i6lCZ9U4mi?frame=Y-JavuOA2R) (`Y-JavuOA2R`)
- [Service form — invalid name, price and duration · illustrative](http://localhost:4300/c/i6lCZ9U4mi?frame=6AvKeaM1qA) (`6AvKeaM1qA`)
- [Service — save failed, input preserved · illustrative](http://localhost:4300/c/i6lCZ9U4mi?frame=ILorhaE6LE) (`ILorhaE6LE`)
- [Barber — save failed, input preserved · illustrative](http://localhost:4300/c/i6lCZ9U4mi?frame=AP26cYim2t) (`AP26cYim2t`)

**Phase 02 reference context:** Services and Barbers for lists, create/edit forms, and explicit service assignments.

**Coverage and evidence limits:** Saving/failure has mobile counterparts. Empty collections need confirmation during planning. Booking-bearing archive conflicts belong to 06/09; fixtures cannot add field constraints or staff accounts.

### Availability

- [Barbers — working hours dialog open](http://localhost:4300/c/i6lCZ9U4mi?frame=wS5tV9mWUI) (`wS5tV9mWUI`)
- [Availability — add recurring break dialog open](http://localhost:4300/c/i6lCZ9U4mi?frame=KkApOqqegI) (`KkApOqqegI`)
- [Working hours — invalid time range · illustrative](http://localhost:4300/c/i6lCZ9U4mi?frame=NpuG7KtqCi) (`NpuG7KtqCi`)
- [Recurring break — invalid time range · illustrative](http://localhost:4300/c/i6lCZ9U4mi?frame=SYtIRh21BS) (`SYtIRh21BS`)
- [Availability — add exception dialog open](http://localhost:4300/c/i6lCZ9U4mi?frame=01kHWI1PlU) (`01kHWI1PlU`)
- [Availability — Edit existing exception dialog](http://localhost:4300/c/i6lCZ9U4mi?frame=nILbVUCGSh) (`nILbVUCGSh`)
- [Availability — Leila custom hours override](http://localhost:4300/c/i6lCZ9U4mi?frame=-LsMrVGlXD) (`-LsMrVGlXD`)
- [Availability — safe evening block](http://localhost:4300/c/i6lCZ9U4mi?frame=67R-oXqBVJ) (`67R-oXqBVJ`)
- [Calendar exception — missing date and reason · illustrative](http://localhost:4300/c/i6lCZ9U4mi?frame=nrgLBn9sC5) (`nrgLBn9sC5`)
- [Availability — save failed, input preserved · illustrative](http://localhost:4300/c/i6lCZ9U4mi?frame=MJicTTONDx) (`MJicTTONDx`)

**Phase 03 reference context:** Availability for recurring shop/barber schedules and breaks; use Customer booking only as selection/slot-label context, not as an implemented public flow.

**Coverage and evidence limits:** A dedicated owner slot-preview/DST-fold presentation is not established. Plan missing offset/zone labels after OTQ-007 decisions; public booking and dated edits are later phases.

**Phase 04 reference context:** Availability for date-specific restrictions, replacement hours, and explicit blocks.

**Coverage and evidence limits:** A fixture making “reason” required does not approve that validation. Reopening/precedence explanations await OQ-011. Booking-bearing conflict fixtures are reserved for the later 06/09 protections.

### Publication and shop sharing

- [Settings — unpublish guard](http://localhost:4300/c/i6lCZ9U4mi?frame=wCR1XZYpmL) (`wCR1XZYpmL`)
- [Settings — customer booking preview](http://localhost:4300/c/i6lCZ9U4mi?frame=0lN4r34smA) (`0lN4r34smA`)
- [Customer booking — 07 · Online booking paused](http://localhost:4300/c/i6lCZ9U4mi?frame=mDo0SOcCaV) (`mDo0SOcCaV`)
- [Unknown shop — clean 404 · illustrative](http://localhost:4300/c/i6lCZ9U4mi?frame=gTLvdOj2e3) (`gTLvdOj2e3`)

**Phase 05 reference context:** Settings for readiness, publication, booking link and QR; Customer booking for published read/slot presentation only.

**Coverage and evidence limits:** Pre-booking Settings and 404 have tablet/mobile variants. “Online booking paused” is a candidate visual reference, not resolution of OQ-010. Contact forms, quota/provider counters and exports shown in Settings do not expand this phase; QR/hostname behavior still needs real proof.

### Customer booking and management

- [Customer booking — 02 · Choose a barber](http://localhost:4300/c/i6lCZ9U4mi?frame=8pT75H67UH) (`8pT75H67UH`)
- [Customer booking — 03 · Choose date and time](http://localhost:4300/c/i6lCZ9U4mi?frame=_6riWG5575) (`_6riWG5575`)
- [Customer booking — 04 · Customer details](http://localhost:4300/c/i6lCZ9U4mi?frame=g18msY-JCg) (`g18msY-JCg`)
- [Customer booking — 05 · No available times](http://localhost:4300/c/i6lCZ9U4mi?frame=a0erixewgj) (`a0erixewgj`)
- [Customer booking — 06 · No bookable services](http://localhost:4300/c/i6lCZ9U4mi?frame=P98nwXKq9S) (`P98nwXKq9S`)
- [Customer booking — 08 · Booking receipt · source fixture](http://localhost:4300/c/i6lCZ9U4mi?frame=ybGP9dIbNv) (`ybGP9dIbNv`)
- [Customer booking — verification pending · illustrative](http://localhost:4300/c/i6lCZ9U4mi?frame=72UIhuzDvB) (`72UIhuzDvB`)
- [Customer booking — verification failed · illustrative](http://localhost:4300/c/i6lCZ9U4mi?frame=aE7yrcFoxz) (`aE7yrcFoxz`)
- [Customer booking — attempt limit reached · illustrative](http://localhost:4300/c/i6lCZ9U4mi?frame=aiWM9SZJcv) (`aiWM9SZJcv`)
- [Customer booking — selected slot just taken · illustrative](http://localhost:4300/c/i6lCZ9U4mi?frame=Q8mdAgwh_S) (`Q8mdAgwh_S`)
- [Manage booking — 04 · Unavailable private link](http://localhost:4300/c/i6lCZ9U4mi?frame=cFSgce-8pd) (`cFSgce-8pd`)
- [Manage booking — cancel appointment dialog open](http://localhost:4300/c/i6lCZ9U4mi?frame=arJUzqqR3o) (`arJUzqqR3o`)
- [Manage booking — inside twelve-hour cutoff · illustrative](http://localhost:4300/c/i6lCZ9U4mi?frame=UG8HPiZb3q) (`UG8HPiZb3q`)
- [Manage booking — cancelled and view-only · illustrative](http://localhost:4300/c/i6lCZ9U4mi?frame=QICJiw91eE) (`QICJiw91eE`)
- [Manage booking — 02 · Edit appointment](http://localhost:4300/c/i6lCZ9U4mi?frame=3JiiYy2vHU) (`3JiiYy2vHU`)
- [Manage booking — 03 · Review proposed change](http://localhost:4300/c/i6lCZ9U4mi?frame=FrkWeiQXn5) (`FrkWeiQXn5`)
- [Manage booking — 03 · Review proposed change · mobile](http://localhost:4300/c/i6lCZ9U4mi?frame=YjamDNvVdW) (`YjamDNvVdW`)
- [Manage booking — discard changes dialog open](http://localhost:4300/c/i6lCZ9U4mi?frame=2uvPDhRsxF) (`2uvPDhRsxF`)
- [Manage booking — replacement slot taken, original kept · illustrative](http://localhost:4300/c/i6lCZ9U4mi?frame=yixt6cKW9C) (`yixt6cKW9C`)
- [Manage booking — replacement slot taken, original kept · mobile · illustrative](http://localhost:4300/c/i6lCZ9U4mi?frame=wx1jIowxmh) (`wx1jIowxmh`)
- [Appointment details — edit customer dialog open](http://localhost:4300/c/i6lCZ9U4mi?frame=9VhZdJp0RT) (`9VhZdJp0RT`)
- [Edit customer dialog — validation errors · illustrative](http://localhost:4300/c/i6lCZ9U4mi?frame=IfmlkuG2z-) (`IfmlkuG2z-`)
- [Customer contact — save failed, input preserved · illustrative](http://localhost:4300/c/i6lCZ9U4mi?frame=nYQdedErjG) (`nYQdedErjG`)
- [Customer contact — save failed, input preserved · mobile · illustrative](http://localhost:4300/c/i6lCZ9U4mi?frame=5aQtouUu9w) (`5aQtouUu9w`)

**Phase 06 reference context:** Customer booking and Manage booking for the account-free creation flow and initial booking-scoped read view.

**Coverage and evidence limits:** Validation, verification, limit and slot-conflict frames have mobile variants; inspect each selected size. Lost-response/replay and stale-offer outcomes await their existing decisions. Receipt/verification fixtures prove neither bot integration nor commitment/delivery. Customer mutation controls wait for 10/11; existing catalog/schedule guards still activate here.

**Phase 10 reference context:** Manage booking for explicit cancellation and contact guidance.

**Coverage and evidence limits:** Cutoff and cancelled view-only frames have mobile variants. Repeated/stale cancellation and unavailable-link wording still need the existing policy decisions. Do not use the unrelated source-markup-only cancellation frame as functional evidence.

**Phase 11 reference context:** Manage booking for replacement, reusing phase 06 selection patterns.

**Coverage and evidence limits:** Confirm same-service saved values versus different-service current values and immediate-cutoff disclosure after the existing stale-offer/original-service decisions. Illustrative preservation of the original is not transaction/concurrency proof.

**Phase 17 reference context:** Appointment details for owner contact editing and assisted recovery; reuse Activity for send outcomes.

**Coverage and evidence limits:** Explicit old-link revocation/replacement, cleared/fresh consent and resend limit/budget outcomes are not established. Plan them after OQ-005/OTQ-018/OTQ-020; do not infer save-triggered sends, public recovery, or new consent actions from a form.

### Owner calendar and appointments

- [Owner dashboard — 02 · Week calendar](http://localhost:4300/c/i6lCZ9U4mi?frame=rZNzZkmA1x) (`rZNzZkmA1x`)
- [Owner dashboard — 03 · Amal barber filter](http://localhost:4300/c/i6lCZ9U4mi?frame=u63Z722qgJ) (`u63Z722qgJ`)
- [Owner dashboard — 05 · Schedule loading](http://localhost:4300/c/i6lCZ9U4mi?frame=qNsO-a4tF5) (`qNsO-a4tF5`)
- [Owner dashboard — 06 · Recoverable load error](http://localhost:4300/c/i6lCZ9U4mi?frame=WoCbetBEtQ) (`WoCbetBEtQ`)
- [Owner dashboard — 07 · Appointment details dialog](http://localhost:4300/c/i6lCZ9U4mi?frame=2JZIVIZMXH) (`2JZIVIZMXH`)
- [Owner dashboard — 08 · New appointment dialog](http://localhost:4300/c/i6lCZ9U4mi?frame=PNo-O8viA7) (`PNo-O8viA7`)
- [Owner dashboard — 09 · Mobile navigation open](http://localhost:4300/c/i6lCZ9U4mi?frame=yW4pUfANbm) (`yW4pUfANbm`)
- [New appointment — discard changes dialog open](http://localhost:4300/c/i6lCZ9U4mi?frame=OYZH4b6k7Y) (`OYZH4b6k7Y`)
- [Owner appointments · new — server conflict error · values preserved](http://localhost:4300/c/i6lCZ9U4mi?frame=Cg2VvaHdwv) (`Cg2VvaHdwv`)
- [Appointment details — Move appointment dialog open](http://localhost:4300/c/i6lCZ9U4mi?frame=mRD-GIGD2T) (`mRD-GIGD2T`)
- [Appointment details — cancel confirmation open](http://localhost:4300/c/i6lCZ9U4mi?frame=de1jYQ3-fM) (`de1jYQ3-fM`)
- [Appointment details — discard changes dialog open](http://localhost:4300/c/i6lCZ9U4mi?frame=50O06ydioP) (`50O06ydioP`)
- [Services — archive conflict dialog open](http://localhost:4300/c/i6lCZ9U4mi?frame=zyA4onstsQ) (`zyA4onstsQ`)
- [Barbers — archive conflict fixture (Amal)](http://localhost:4300/c/i6lCZ9U4mi?frame=9gK6xvdamw) (`9gK6xvdamw`)
- [Availability — close-today conflict fixture](http://localhost:4300/c/i6lCZ9U4mi?frame=CY8ZW6zu1B) (`CY8ZW6zu1B`)
- [Availability — shop-block conflict fixture](http://localhost:4300/c/i6lCZ9U4mi?frame=chMh-Lo623) (`chMh-Lo623`)
- [Appointment details — Cancelled future — Lina](http://localhost:4300/c/i6lCZ9U4mi?frame=MRzYFrh6m-) (`MRzYFrh6m-`)
- [Appointment details — restore appointment dialog open](http://localhost:4300/c/i6lCZ9U4mi?frame=m7eoel28d3) (`m7eoel28d3`)

**Phase 08 reference context:** Owner dashboard; Owner appointments · new; Appointment details for calendar navigation and both appointment presentations.

**Coverage and evidence limits:** Use the explicit mobile details Dialog variant as well as the shared page sizes. Verify creation validation, optional-contact walk-ins and exact-minute fields in both presentations. A static Dialog cannot prove Back/Forward, retained calendar context, dirty dismissal, focus restoration, or persisted reservations. Move/cancel/restore/attendance/contact recovery controls remain later work.

**Phase 09 reference context:** Appointment details for explicit move/cancel; reuse Services, Barbers and Availability from the shared index for protected-edit feedback.

**Coverage and evidence limits:** Late-state permissions and stale-edit outcomes stay unresolved. Confirm failed replacement/input-preservation presentation in both Dialog and standalone views; fixture conflict lists do not prove real conflict resolution.

**Phase 12 reference context:** Appointment details for future cancelled details and restoration in both presentations.

**Coverage and evidence limits:** Dedicated occupied-original-slot, inactive/ineligible-barber, invalid-hours and past-time denial states are not established; plan their explanations without adding a different-time restore flow. A restoration fixture does not prove locking or eligibility.

### Activity and messaging

- [Activity — delivery receipt details open](http://localhost:4300/c/i6lCZ9U4mi?frame=6ur8k_3xSe) (`6ur8k_3xSe`)
- [Appointment details — Past unmarked — Nadia](http://localhost:4300/c/i6lCZ9U4mi?frame=_6ciOgQxgH) (`_6ciOgQxgH`)
- [Appointment details — Completed — Karim](http://localhost:4300/c/i6lCZ9U4mi?frame=co1X0kY8c1) (`co1X0kY8c1`)
- [Activity search — no matching records · illustrative](http://localhost:4300/c/i6lCZ9U4mi?frame=M43JgFDvYS) (`M43JgFDvYS`)
- [Activity — Reminder delivered after local cron simulation](http://localhost:4300/c/i6lCZ9U4mi?frame=T4Ll_lqXHv) (`T4Ll_lqXHv`)

**Phase 07 reference context:** Activity for truthful message evidence; reuse the phase 06 receipt and Appointment details only where message status is relevant.

**Coverage and evidence limits:** Confirm acceptance/delivery/failure/budget-skip and unavailable-delivery presentations during planning. Detailed templates are not established by these page references. Email can introduce Activity before calendar phase 08; expose only available event producers and capabilities.

**Phase 13 reference context:** Appointment details; Owner dashboard; Activity for past/unmarked status, attendance actions and booking events.

**Coverage and evidence limits:** Confirm owner no-show/correction and rejected/early-write feedback; customer no-show view-only is not an owner correction reference. End equality remains open. Do not infer analytics, new audit categories, or customer notifications.

**Phase 14 reference context:** Activity for per-channel attempt and outcome evidence.

**Coverage and evidence limits:** Dedicated retrying/exhausted/permanent/unknown/recovered-claim states are not established. Define labels after OTQ-010–OTQ-012; avoid a new worker-control page. Provider and scheduled-job evidence remain separate from reference screenshots.

**Phase 15 reference context:** Activity and the existing appointment message-status presentation for current-schedule reminders.

**Coverage and evidence limits:** The linked local simulation is illustrative. Due, suppressed/obsolete, too-late and rescheduled reminder states need confirmation after identity decisions. No timing preferences or actual cron/provider success may be inferred from the fixture.

**Phase 16 reference context:** Customer booking for channel disclosure/consent and Activity for independent channel outcomes.

**Coverage and evidence limits:** Confirm no-consent, non-test-recipient, unavailable-template and mixed-channel outcomes. Actual confirmation/update/reminder payloads and verified-recipient delivery are not established by the designs. Keep the shared SMS conflict exclusion and do not add preference permissions.

### Shop address updates

- [Settings — address-change confirmation](http://localhost:4300/c/i6lCZ9U4mi?frame=plaQzNHEqU) (`plaQzNHEqU`)
- [Settings — Address-change confirmation · mobile](http://localhost:4300/c/i6lCZ9U4mi?frame=XZcUyvbVAZ) (`XZcUyvbVAZ`)
- [Settings — save failed, input preserved · illustrative](http://localhost:4300/c/i6lCZ9U4mi?frame=Vnccg5E1bc) (`Vnccg5E1bc`)
- [Settings — save failed, input preserved · mobile · illustrative](http://localhost:4300/c/i6lCZ9U4mi?frame=1vCdOImOI4) (`1vCdOImOI4`)

**Phase 18 reference context:** Settings for address editing; Manage booking for current shop address and Activity for attributable update results.

**Coverage and evidence limits:** Confirm targeted/per-recipient failure and budget-skip presentation without copying prototype counts or SMS claims. Address-message wording/validation remain their existing decisions; name/contact edits must not become broadcasts.

### Historical cleanup

- [Manage booking — 05 · Stored data load error](http://localhost:4300/c/i6lCZ9U4mi?frame=DNngDbdX8k) (`DNngDbdX8k`)

**Phase 19 reference context:** Owner dashboard, Activity and the existing linked-booking denial layout for the visible effects of cleanup.

**Coverage and evidence limits:** No dedicated cleanup UI is required. Search-no-matches and load-error frames are contextual references, not claims that cleanup causes errors or selects deleted-record wording. Confirm retained future records, removed history and safe unavailable-link feedback after retention/presentation decisions; destructive verification stays on disposable data.
