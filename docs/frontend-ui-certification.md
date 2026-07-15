# Frontend viewport and accessibility certification

Status: **Passed**  
Certification date: **July 15, 2026**  
Browser engine: **Google Chrome 143 / Chromium**  
Command: `pnpm test:ui-cert`

This automated certification exercises the agent profile and Android AI model library, one of the
widest and most interactive authenticated frontend surfaces. API responses and long merchant/model
names are deterministic so layout regressions are reproducible.

## Screen-category matrix

| Category                      | Simulated viewport |
| ----------------------------- | -----------------: |
| Legacy compact phone          |          280 × 653 |
| Small phone, portrait         |          320 × 568 |
| Android phone, portrait       |          360 × 800 |
| Modern phone, portrait        |          390 × 844 |
| Large phone, portrait         |          430 × 932 |
| Phone, landscape              |          844 × 390 |
| Foldable cover / small tablet |          540 × 720 |
| Tablet, portrait              |         768 × 1024 |
| Tablet, landscape             |         1024 × 768 |
| Small laptop                  |         1280 × 720 |
| Desktop                       |         1440 × 900 |
| Full HD                       |        1920 × 1080 |
| Ultrawide                     |        2560 × 1080 |

Every viewport must have no document-level horizontal overflow and no visible interactive control
outside the viewport.

## Accessibility gates

- axe-core automated rules tagged WCAG 2.0 A/AA, WCAG 2.1 A/AA, and WCAG 2.2 AA at representative
  phone, large-phone, tablet, and desktop widths.
- 200% root text size with WCAG text-spacing overrides.
- Keyboard-only traversal with a visible focus indicator.
- WCAG 2.2 minimum 24 × 24 CSS-pixel activation targets.
- `prefers-reduced-motion: reduce` and forced-colors mode.
- Semantic role/name queries for primary navigation and model-library actions.

The passing baseline is 18 browser tests. The suite is part of GitHub Actions and blocks changes
that reintroduce a covered viewport or accessibility regression.

## Certification boundary

This certifies the screen categories and automated accessibility criteria above. Automated testing
cannot replace periodic manual testing with TalkBack, VoiceOver, NVDA, switch controls, unusual
vendor WebViews, or future browser engines. Those combinations should remain part of release-device
acceptance testing when native devices are available.
