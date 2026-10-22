# Phase 01 UI fidelity follow-up

**Date:** 2026-10-22 (Africa/Algiers).

**Authorization:** Apply the preceding review's suggestions. Preserve Phase 01 scope and the existing dirty working tree. No Doop frames, authentication contracts, database schemas, ownership rules, publication behavior, or routes were changed.

## Delivered

- Sign-in follows Doop's desktop/tablet two-column composition, phone stack, responsive heading scale, 472px maximum card, 52px primary action and 16px primary-action label. Restored “Welcome in.”, linked brand, footer and keyboard-operable skip-to-sign-in control. Functional OAuth and truthful demo disclosures remain.
- Setup restores name/address-first grouping, paired contact/time-zone controls on wider screens, required markers and semantics, contact/time-zone examples, plain-language validation, a wrapping illustrative booking-address preview, and the prominent permanence warning before the submit action. Preview is explicitly not live. Creation still produces a private draft; name/contact remain editable independently of the first-appointment time-zone lock.
- Settings wraps the complete read-only address, groups read-only values with adjacent explanations, and exposes draft status above the form on phones. Address editing remains deferred.
- Shared text-entry/select boundaries use existing Pebble; focus combines Ink with a Sky halo. Connected the existing destructive-text token to Tailwind and aligned default button text with the documented 13px label size. Updated DESIGN guidance to record the approved accessibility treatment.
- Marketing visibly identifies the fictional portfolio demo. Today identifies the shop time zone and replaces development-phase language with the unpublished/public-booking state.

## Reference and browser evidence

Originals were retrieved and visually inspected through Doop MCP during the preceding review; this follow-up uses the same references, without editing them:

- Sign-in: `aJ6U098tXQ`, `ItLmNd-jyW`, `otK67wvMSW`; connecting/failure: `mPaJu_SQ7g`, `_qKUeXQWNm`.
- Setup: `od9vamduSk`, `HibdAq-Djw`, `Xf6vOkTB6i`, validation `BfZECGS8xd`.
- Settings: `g1GkbadNik`, pre-booking `i-EqNPzspA` and `lmHDTesqUh`.
- Marketing: `Y2VSLZNRGs`; empty owner reference: `v8uLzCjHPw` (calendar/navigation excluded).

Direct Playwright inspection of the running HTTPS owner app covered sign-in widths 320, 390, 768, 1024 and 1440px, loaded fonts and horizontal overflow. At 768×900 the entire Google action is visible at approximately y=392, versus approximately y=395 in Doop and y=860 before the fix. The HTTP address is not the configured development protocol.

Production-browser screenshots cover marketing, sign-in normal/connecting/failure, setup normal/validation/keyboard, Today, and settings success/failure/keyboard across the existing desktop/tablet/phone projects. Normal desktop setup/sign-in, tablet sign-in, phone setup/settings/Today, long-address and representative failure/focus captures were visually inspected. These are rendered application captures, not source-only verification.

Selected evidence in [the screenshot directory](2026-10-22-phase-01-ui-fidelity/):

- [Live HTTPS tablet sign-in](2026-10-22-phase-01-ui-fidelity/live-https-sign-in-tablet.png)
- [Setup desktop](2026-10-22-phase-01-ui-fidelity/desktop-chromium-setup.png)
- [Setup phone](2026-10-22-phase-01-ui-fidelity/phone-chromium-setup.png)
- [Settings long address on phone](2026-10-22-phase-01-ui-fidelity/desktop-chromium-settings-long-address.png)
- [Keyboard focus](2026-10-22-phase-01-ui-fidelity/desktop-chromium-setup-keyboard.png)
- [Settings failure on phone](2026-10-22-phase-01-ui-fidelity/phone-chromium-settings-failure.png)

The explicit tablet-action and phone-address regression checks override their viewport; their filenames retain the invoking project's name.

## Verification

- `pnpm lint` passed.
- `pnpm exec tsc --noEmit --incremental false` passed.
- `pnpm test`: 13 passed.
- Final `pnpm test:e2e`: production build and 51 Chromium checks passed, including setup/settings persistence, invalid input, real database save-failure/retry, keyboard/reduced-motion, provider-state UI and existing owner isolation checks.
- Added coverage for tablet primary-action visibility, skip-link focus transfer, required semantics, normalized illustrative preview, minimum multiline setup-address height, and complete long read-only address visibility on phones.
- `git diff --check` passed.
- Disposable database cleanup check returned 0 users and 0 shops; its container was removed. Persistent development data was not used for test writes.

The first run caught exact label lookups including an in-label required marker; placing the decorative marker beside the label fixed the regression. Screenshot inspection also caught a shallow setup textarea and a suppressed focus halo; both were corrected. One incremental production build emitted previous CSS despite the source edit; a subsequent build emitted current styles. The final browser run includes the multiline-height assertion and regenerated captures. No cache configuration was changed or underlying framework root cause assumed.

Pre-completion audit: normal/pending/error/success and readonly presentation verified; existing server validation, error envelopes, transactions and authorization retained; shared controls contain no feature logic; tests use real Better Auth sessions and the owned disposable database. New mutation-accounting/concurrency mechanisms are inapplicable to these presentation changes. Neighboring design-system behavior is included in the browser suite. Production captures have no development indicator.

## Limits and retained source concerns

Doop's prototype-only “does not connect to Google” copy and internal illustrative/requirement annotations were not copied into the functional app. Split phone/email settings, address editing, publication/QR/calendar/navigation and the complete marketing page remain outside Phase 01. No redesigned Doop references or new color tokens were introduced.

Safari, physical-device interaction, screen-reader speech and hosted behavior were not verified. Real Google provider authorization was not repeated; provider error/connecting UI uses controlled browser responses. This follow-up does not replace the existing deployment exception or claim whole-product accessibility certification. The review was performed by the implementing agent, not a separate reviewer.
