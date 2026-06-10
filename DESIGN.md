# Design

## Theme

**Calibrated instrument.** The site reads like telemetry from a working clinical system: deep cobalt instrument fields, pure white documentation surfaces, and a single ECG-trace green reserved for live signals and the primary action. Confidence through precision, never volume.

## Color

OKLCH throughout. Composed around brand seed `oklch(0.541 0.122 248.2)` (cobalt).

| Token | Value | Role |
|---|---|---|
| `--bg` | `oklch(1 0 0)` | Body background — literal pure white |
| `--ink` | `oklch(0.22 0.025 250)` | Headings, primary text |
| `--ink-2` | `oklch(0.40 0.030 250)` | Secondary text on white (≥4.5:1) |
| `--cobalt` | `oklch(0.541 0.122 248.2)` | Brand primary |
| `--cobalt-link` | `oklch(0.46 0.115 248)` | Cobalt darkened for text-size use on white |
| `--field` | `oklch(0.27 0.075 252)` | Dark instrument panels (hero, platform, CTA, case visuals) |
| `--field-deep` | `oklch(0.22 0.060 252)` | Telemetry strip, footer |
| `--on-field` / `--on-field-2` | `oklch(0.95/0.80 …)` | Text on dark fields |
| `--trace` | `oklch(0.87 0.19 152)` | ECG green. **Reserved**: live indicators (`.trace-dot`), primary CTA (`.btn--trace`), one live element per 3D scene. Never decorative. |

Strategy: **Committed** — cobalt fields carry roughly 40% of the page; white carries the reading surfaces.

## Typography

Single family, committed weight contrast: **Schibsted Grotesk** (400–900, variable).

- Display: 800, letter-spacing −0.025em, `text-wrap: balance`
- Hero: `clamp(2.5rem, 1.5rem + 4.6vw, 4.5rem)`; section heads `--step-4`
- Body: 400 at 1rem / 1.65, max ~58ch, `text-wrap: pretty`
- Numerals in telemetry, chrome labels, and metrics: `font-variant-numeric: tabular-nums`

## Components

- **Chrome label** (`.chrome-label`, `.case__chrome`): the one named kicker system — monitor-style readout (`TESA·MON NN — FUNCTION`) with a pulsing trace dot. Used **only** on dark instrument panels; white sections get plain headings.
- **Telemetry strip**: proof metrics as an inline instrument readout under the hero, not stat blocks.
- **Ledger** (`.ledger`): services as full-width ruled rows with hover fill + arrow travel — not cards.
- **Case** (`.case`): alternating feature rows; live WebGL panel on a cobalt field opposite prose with metrics bolded inline.
- **Spec list** (`.spec-list`): ruled checklist with green tick-dash, on dark fields.
- **Tabs** (`.ai__deck`): Applied-AI capabilities as an accessible tablist (roving arrow keys), not a card grid.
- **Buttons**: 8px radius rectangles. Primary = trace green with dark-green ink. Secondary = underlined quiet link.

## Motion

- Hero: choreographed load — two headline lines rise with `overflow: hidden` clip, sub/actions fade up, delays 0/0.12/0.35s. Ease: `cubic-bezier(0.16, 1, 0.3, 1)`.
- Scroll reveals (`[data-reveal]`, optional `left|right`): gated behind a `.js` class so content is fully visible without JavaScript.
- Telemetry counters render final values in HTML; they animate only when motion is allowed.
- All animation is disabled under `prefers-reduced-motion`; WebGL renders a single calm frame.

## WebGL scenes (js/three-scenes.js)

Palette constants: `COBALT 0x4a7fc1 · COBALT_DIM 0x2c5587 · PORCELAIN 0xe9eff8 · TRACE 0x4fe3a3 · FIELD 0x16304f`. Every scene contains exactly one trace-green "live" element:

1. **Hero** — DNA double helix, white/cobalt strands, green pulse travelling one backbone; sparse white measurement points; pointer-parallax camera.
2. **Platform** — fibonacci-sphere node network with a beating green core.
3. **Case panels** — `spine` (articulated joint chain), `blocks` (pipeline of code blocks), `globe` (enrollment globe + site beacons), `conduit` (record packets flowing between two systems).
4. **CTA** — ECG sweep: a green spike travelling across a calm cobalt point grid.

Scenes pause when off-screen (IntersectionObserver); pixel ratio capped at 2.

## Bans honored (impeccable)

No gradient text, no glassmorphism, no section eyebrows, no big-number stat blocks, no identical icon-card grids, no side-stripe borders, no numbered scaffolding (process numbers are an actual sequence). Fonts avoid the reflex-reject list.
