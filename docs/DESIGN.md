# Hotshot — UI Design Specification

Version 1.0 · still capture only (video/GIF is v1.1 and is out of scope here)
Companion document to `docs/BRIEF.md`. Every constraint in the brief is binding.

---

## 1. Design thesis

Hotshot should feel like a **measuring instrument**, not an app. A Vernier
caliper, a Leica viewfinder, a loupe on a lightbox: dense, metal-cold, numeric,
disappearing into the hand once known. The references are Swiss technical
drafting — DIN dimension lines with tick serifs — lab instrument faces, and the
keyboard-first density of Linear and Raycast. Rejected: the consumer "delight"
register of springs, mascot rounding and pastel reassurance; and equally the
lazy brutalist grid, which is just as much a costume.

The overlay is the hard problem — it sits on someone else's pixels, on a page we
have never seen. So the signature move is subtractive. **Hotshot desaturates the
world and leaves the shot in colour.** Everything outside the selection is
greyscaled and washed; inside stays true. That reads instantly on a white doc and
on a black terminal, where a dim wash alone does nothing. All chrome touching the
page is **opaque graphite with a hairline** — never translucent, because
translucency over unknown content is illegible — and geometry is drawn as a
**black/white rule pair**, which cannot fall below 4.58:1 against any backdrop.

---

## 2. Design tokens

Prefix: `--hs-`. All overlay tokens are injected into a closed shadow root so
the host page cannot restyle them and we cannot leak into the host page.

### 2.1 Neutral ramp — "Graphite" (warm)

The neutral is yellow-shifted, not blue-shifted. Rationale: every browser
extension and SaaS panel on earth uses cool slate; a warm graphite reads as
pencil and paper stock, and separates Hotshot's chrome from Chrome's own UI and
from the host page's typical cool greys.

| Token | Hex | Use |
|---|---|---|
| `--hs-g-0`   | `#FFFFFF` | pure white; rule-pair inner stroke only |
| `--hs-g-25`  | `#F7F7F5` | light surface / page background |
| `--hs-g-50`  | `#EFEEEA` | light raised surface, hover fill |
| `--hs-g-100` | `#E3E1DC` | light divider, input fill |
| `--hs-g-200` | `#D0CDC6` | light border |
| `--hs-g-300` | `#B2AEA5` | light disabled text, dark-mode tertiary |
| `--hs-g-400` | `#8C8880` | placeholder, axis labels, DARK-MODE TERTIARY TEXT FLOOR |
| `--hs-g-500` | `#6B6862` | dark-mode non-text glyphs, hollow status dots, light-mode secondary text |
| `--hs-g-600` | `#514F4A` | dark-mode border (raised) |
| `--hs-g-700` | `#3A3936` | dark-mode border (base) |
| `--hs-g-800` | `#262524` | dark-mode raised surface |
| `--hs-g-900` | `#171716` | dark-mode base surface |
| `--hs-g-950` | `#0E0E0D` | dark-mode sunken surface / overlay chrome |
| `--hs-g-1000`| `#060605` | scrim base, rule-pair outer stroke |

### 2.2 Signal colours

| Token | Hex | Notes |
|---|---|---|
| `--hs-flare`        | `#FF5A00` | THE accent. Dark surfaces only. One meaning: *live / armed / primary*. |
| `--hs-flare-ink`    | `#D93E00` | Same accent tuned for light surfaces (4.53:1 on `--hs-g-25`). |
| `--hs-flare-wash`   | `#2A1408` | Dark-mode accent fill behind flare text. |
| `--hs-flare-wash-l` | `#FCE9DF` | Light-mode accent fill. |
| `--hs-ok`           | `#3FA46A` | Shipped / connected. Dark. |
| `--hs-ok-ink`       | `#1E7A48` | Light-surface variant (4.98:1 on `--hs-g-25`). |
| `--hs-warn`         | `#D9A400` | Token expiring, partial stitch. |
| `--hs-warn-ink`     | `#8A6A00` | Light-surface variant. |
| `--hs-err`          | `#F2604C` | Dark. |
| `--hs-err-ink`      | `#C4321E` | Light-surface variant (5.12:1 on `--hs-g-25`). |
| `--hs-redact`       | `#111111` | Destructive redaction fill. Literal pixel replacement. |

There is exactly **one** accent hue in the product. Rationale: a tool with two
accents has no accent. Flare is reserved for state that is *happening now*;
using it for decoration would spend the only signal we have.

### 2.3 On-page rule pair (the guaranteed-legibility primitive)

| Token | Value |
|---|---|
| `--hs-rule-outer` | `1px solid rgba(6,6,5,0.92)` |
| `--hs-rule-inner` | `1px solid #FFFFFF` |
| `--hs-rule` | 2px total: outer stroke sits outboard of inner |

Every geometric mark drawn over unknown page pixels — selection frame, resize
handles, element highlight, magnifier bezel, dimension rules, crosshair — uses
this pair. Rationale and proof in §8.1: worst case is 4.58:1, at the exact
backdrop luminance where white and black are equally bad.

### 2.4 Scrim (the desaturation veil)

| Token | Value |
|---|---|
| `--hs-veil-filter` | `grayscale(100%) contrast(0.92)` |
| `--hs-veil-wash` | `rgba(6,6,5,0.44)` |
| `--hs-veil-lift` | `rgba(255,255,255,0.06)` composited *under* the wash |
| `--hs-veil-total-transition` | `none` |

Applied to the four rectangles surrounding the selection (never as a single
full-screen layer with a hole, so the selection is never composited through
anything). The lift layer means a pure-black page still shows a visible
difference between veiled and unveiled area; the wash means a pure-white page
does too. Colour is the primary cue on everything in between.

### 2.5 Typography

- **UI / prose:** `IBM Plex Sans`, fallback `"IBM Plex Sans", "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif`
- **Numerals, measurements, tokens, code:** `IBM Plex Mono`, fallback `"IBM Plex Mono", "SF Mono", "Cascadia Mono", Consolas, "Liberation Mono", monospace`

Rationale: Plex was drawn for engineering documentation — the sheared terminals
and the flared `a` give it a machined character that Inter deliberately sands
off. Both weights ship bundled with the extension (`.woff2`, subset to Latin +
`×`, `→`, `↵`, `⌘`, `⇧`, `⌥`, `⌃`), so nothing is fetched at runtime and the
overlay never reflows on font load.

**Hard rule: every number the user reads is Plex Mono with `font-variant-numeric:
tabular-nums`.** Dimensions must not shimmy as they change during a drag.

| Token | Size / line-height / weight / tracking | Use |
|---|---|---|
| `--hs-t-mono-xs` | 10px / 12px / 500 / +0.04em | dimension ticks, kbd hints |
| `--hs-t-mono-sm` | 11px / 14px / 500 / +0.02em | readout chip, hex values |
| `--hs-t-mono-md` | 13px / 18px / 450 / 0 | token fields, history metadata |
| `--hs-t-xs`      | 11px / 14px / 500 / +0.03em, uppercase | section labels, table heads |
| `--hs-t-sm`      | 12px / 16px / 450 / 0 | secondary body, help text |
| `--hs-t-md`      | 13px / 20px / 450 / 0 | default body, list rows |
| `--hs-t-lg`      | 15px / 22px / 500 / -0.005em | panel titles, popup primary rows |
| `--hs-t-xl`      | 19px / 26px / 500 / -0.012em | page titles (settings, onboarding) |
| `--hs-t-2xl`     | 26px / 32px / 500 / -0.02em | onboarding step headline (left-aligned) |

There is no larger step. Nothing in Hotshot is a hero.

### 2.6 Spacing

4px base. `--hs-s-1: 2px`, `-2: 4px`, `-3: 6px`, `-4: 8px`, `-5: 12px`,
`-6: 16px`, `-7: 20px`, `-8: 24px`, `-9: 32px`, `-10: 40px`, `-11: 56px`.

Overlay chrome uses only `-2` through `-5`. App surfaces use `-4` through `-9`.
Rationale: the overlay is an instrument face and should be tight; the settings
page is a document and can breathe.

### 2.7 Radii

`--hs-r-0: 0px` · `--hs-r-1: 2px` · `--hs-r-2: 3px` · `--hs-r-3: 5px` · `--hs-r-full: 999px`

Ceiling is 5px. Selection frame, dimension rules and the magnifier are `0`.
Buttons and chips are `2`. Panels are `3`. `--hs-r-full` exists for exactly two
things: the numbered step badge and the colour swatch dot. Rationale: rounding
is a softness signal; a caliper is not soft.

### 2.8 Borders

`--hs-bw-hair: 1px` · `--hs-bw-emphasis: 2px` (focus ring, armed toolbar tool)

- `--hs-border-dark: 1px solid #3A3936`
- `--hs-border-dark-raised: 1px solid #514F4A`
- `--hs-border-light: 1px solid #D0CDC6`
- `--hs-border-inset-dark: inset 0 1px 0 rgba(255,255,255,0.05)` — a single top highlight, the only "material" effect in the system.

### 2.9 Elevation

No soft ambient blooms. Elevation = hairline + a tight contact shadow. Rationale:
shadow is a separator here, not decoration; a 40px blurred halo over an unknown
page just looks like grime.

| Token | Value |
|---|---|
| `--hs-e-0` | `none` |
| `--hs-e-1` | `0 1px 0 rgba(6,6,5,0.55)` — dividers, chips |
| `--hs-e-2` | `0 1px 0 rgba(6,6,5,0.55), 0 6px 16px -10px rgba(6,6,5,0.85)` — toolbar, popover |
| `--hs-e-3` | `0 1px 0 rgba(6,6,5,0.6), 0 14px 32px -18px rgba(6,6,5,0.9)` — modal, destination picker |

### 2.10 Motion

| Token | Value |
|---|---|
| `--hs-d-0`    | `0ms` |
| `--hs-d-snap` | `90ms` |
| `--hs-d-ui`   | `140ms` |
| `--hs-d-settle` | `220ms` |
| `--hs-e-enter` | `cubic-bezier(0, 0, 0.2, 1)` |
| `--hs-e-exit`  | `cubic-bezier(0.4, 0, 1, 1)` |
| `--hs-e-std`   | `cubic-bezier(0.2, 0, 0, 1)` |

Full motion policy in §5.

### 2.11 Z-index and containment

Overlay root: `2147483646`, `position: fixed`, closed shadow root, `all: initial`
reset at the host boundary, `color-scheme: dark` locked. One index below max so
a page's own max-z element is still beatable but we never trap a user above a
browser-injected surface.

---

## 3. Screens

### 3.1 Capture overlay

```
┌────────────────────────────────────────────────────────────────────────────────┐
│▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒ veiled: greyscale + 44% wash ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒│
│▒▒▒▒▒▒▒▒▒▒▒┌───────────┬───────────┬───────────┬───────────┐▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒│
│▒▒▒▒▒▒▒▒▒▒▒│ ▣  Region │ ▤  Page   │ ⌗ Element │ ◔ Delay 3s│▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒│
│▒▒▒▒▒▒▒▒▒▒▒│    R      │    F      │    E      │    D      │▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒│
│▒▒▒▒▒▒▒▒▒▒▒└───────────┴───────────┴───────────┴───────────┘▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒│
│▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒│
│▒▒▒▒▒▒▒▒                                                          ▒▒▒▒▒▒▒▒▒▒▒▒▒│
│▒▒▒▒▒▒▒▒ ■──────────────────────■──────────────────────■         ▒▒▒▒▒▒▒▒▒▒▒▒▒│
│▒▒▒▒▒▒▒▒ │                                             │         ▒▒▒▒▒▒▒▒▒▒▒▒▒│
│▒▒▒▒▒▒▒▒ │        page pixels, FULL COLOUR, undimmed   │         ▒▒▒▒▒▒▒▒▒▒▒▒▒│
│▒▒▒▒▒▒▒▒ ■                                             ■         ▒▒▒▒▒▒▒▒▒▒▒▒▒│
│▒▒▒▒▒▒▒▒ │                                             │         ▒▒▒▒▒▒▒▒▒▒▒▒▒│
│▒▒▒▒▒▒▒▒ │                                             │  ┌─────────────────┐ │
│▒▒▒▒▒▒▒▒ ■──────────────────────■──────────────────────■  │ ·  ·  ·  ·  ·  · │ │
│▒▒▒▒▒▒▒▒ ├┄┄┄┄┄┄┄┄┄┄┄┄┄┄ 1024 ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┤  │ ·  ·  ┼──·  ·  · │ │
│▒▒▒▒▒▒▒▒                                                  │ ·  ·  │  ·  ·  · │ │
│▒▒▒▒▒▒▒▒        ┌────────────────────────────────┐        │ ·  ·  ·  ·  ·  · │ │
│▒▒▒▒▒▒▒▒        │ 1024 × 576   x844 y212   @2x   │        ├─────────────────┤ │
│▒▒▒▒▒▒▒▒        └────────────────────────────────┘        │ #1F6FEB  844,212│ │
│▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒└─────────────────┘ │
│▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒│
│  drag to select · space to move · ⇧ constrain · ⌥ from centre · esc cancel     │
└────────────────────────────────────────────────────────────────────────────────┘
```

**Layout.** Four veil rectangles (top/right/bottom/left of the selection) rather
than one masked layer — the selected pixels are never composited through
anything, so what you see is exactly what gets captured.

**Selection frame.** 2px rule pair, `--hs-r-0`. No dashes, no marching-ants
animation: motion on a frame you are actively dragging is noise, and animated
strokes cost a repaint per frame on a page that may already be janky.

**Handles.** 8 handles: 4 corner (7×7px), 4 edge midpoint (7×7px). Filled
`#FFFFFF` with the 1px `--hs-rule-outer` ring. Hit target is 16×16 (invisible
padding). Corner handles render as filled squares; edge handles as filled
squares too — no diamonds, no circles. Hover: handle grows to 9×9 with no
transition (`--hs-d-0`).

**Dimension rule.** Below the selection, offset 6px: a horizontal rule pair with
2px outward tick serifs at both ends and the width value centred in
`--hs-t-mono-xs`, drawn in the rule-pair treatment so the number is legible over
anything. A matching vertical rule sits to the left of the selection. This is
the DIN-drawing quotation and it is the single most characteristic mark in the
product. Suppressed when the selection is under 64px on that axis (the rule
would be longer than the thing it measures).

**Readout chip.** Opaque `--hs-g-950`, `--hs-border-dark-raised`, `--hs-r-1`,
`--hs-e-2`, padding `4px 8px`, `--hs-t-mono-sm`, colour `--hs-g-25`. Contents:
`W × H`, then origin `x… y…` in `--hs-g-400`, then the device pixel ratio badge
`@2x` in `--hs-flare` when DPR ≠ 1 (because a 1024-wide selection producing a
2048px PNG surprises people). Docks 6px below the selection's bottom-centre;
flips above if it would leave the viewport; pins to the selection's inner
bottom-right corner if both fail. Never overlaps the dimension rule.

**Magnifier (loupe).** Appears only while a drag is in progress or while a
handle has keyboard focus. 132×132px, square, `--hs-r-0`, rule-pair bezel.
Shows a 11×11 source-pixel neighbourhood at 12× with a 1px `rgba(255,255,255,.14)`
pixel grid and a rule-pair crosshair on the target pixel. Footer strip 20px
tall, `--hs-g-950`: the hex under the cursor (`--hs-t-mono-sm`, with an 8px
swatch square) and the absolute page coordinate. Square, not circular:
circles are the default and a square loupe actually aligns with the pixel grid
it is magnifying. Position: 16px diagonally from the cursor, in whichever
quadrant has room, evaluated per-frame with no animation.

**Mode switcher.** Segmented rail, pinned top-centre, 40px from the viewport
top, `--hs-g-950` fill, `--hs-border-dark-raised`, `--hs-r-2`, `--hs-e-2`. Four
segments, each 96px wide: label in `--hs-t-xs`, key hint below in
`--hs-t-mono-xs` `--hs-g-400`. Active segment: fill `--hs-flare-wash`, text
`--hs-g-25`, plus a 2px `--hs-flare` bar along the segment's bottom edge.
Delay mode's segment carries an inline stepper — `D` cycles 3s → 5s → 10s → off.
The rail fades to 25% opacity while the pointer is inside the top 120px of the
page and the user is dragging near it, so it never blocks a selection at the top
of the viewport; it returns to full opacity on drag end.

**Element mode.** No drag. As the pointer moves, the smallest sensible element
under it is outlined with the rule pair at its exact `getBoundingClientRect()`
bounds; the veil re-cuts to that rectangle live. The readout chip additionally
shows a compact selector path (`main > article > figure.hero`) truncated from
the left at 44 chars, `--hs-t-mono-sm`. `[` and `]` walk to parent / first
child, so you can climb out of a `<span>` into the card that contains it. Click
or `Enter` captures.

**Full-page mode.** This is a *slow* operation and is designed as one. Chrome
throttles `chrome.tabs.captureVisibleTab` to roughly 2 calls per second, so a
14-screen page takes about 7 seconds — multi-second stitching is the normal
case, not an edge case. The veil covers the whole viewport, the page scrolls
under it, and a determinate stitch panel (§6.1) reports tiles captured of total,
elapsed time and an estimate. `Esc` stops and *keeps* what has been captured;
a second `Esc` discards. Scroll position is restored either way.

**States.** `idle` (crosshair cursor, no selection, hint bar visible) ·
`dragging` (magnifier on, toolbar hidden, hint bar swaps to live modifiers) ·
`settled` (toolbar in, handles active) · `moving` (space held, or arrow keys —
frame translates, dimensions frozen) · `resizing` · `capturing` (veil holds,
everything else hidden for one frame so no chrome is captured) · `aborted`.

**Cursor.** Custom 21×21 crosshair drawn as a rule pair with a 3px centre gap,
so the exact target pixel is never covered by the cursor itself.

**Hint bar.** Bottom-centre, 28px tall, `--hs-g-950` at full opacity,
`--hs-t-mono-xs`, `--hs-g-300` text with key names in `--hs-g-25`. Contents
change by state. It is a real bar, not a tooltip; discoverability of a
keyboard-first tool is a permanent job, not an onboarding job.

---

### 3.2 Annotation toolbar

```
        ┌──────────────────────── selection ────────────────────────┐
        │                                                           │
        │                                                           │
        └───────────────────────────────────────────────────────────┘
              ▲ 8px gutter
        ┌───────────────────────────────────────────────────────────┐
        │ ▤  ○  ↗  ▬  ①  T  ✎  ▩  ⌦ │ ■ ▪ ▫ │ ●  │  ⏎ Ship   ⌘⏎ │
        │ V  B  A  L  N  T  P  H  K │ 2 4 6 │    │              │
        └───────────────────────────────────────────────────────────┘
             tools                    weight   colour   commit
```

**Anatomy.** Height 36px. Fill `--hs-g-950`, `--hs-border-dark-raised`,
`--hs-r-2`, `--hs-e-2`. Tool buttons 28×28, `--hs-r-1`, 16px icon centred, 2px
gaps. Group dividers: 1px `--hs-g-700`, 20px tall, 6px margin. Every button
carries a single-letter key hint rendered in `--hs-t-mono-xs` `--hs-g-400` at
the button's bottom-right, 1px inset — permanently visible, not on hover.
Rationale: the whole product's claim is keyboard-first; hiding the keys until
hover makes that claim untestable.

**Tools.** Select/move `V` · Box `B` · Arrow `A` · Line `L` · Numbered step `N` ·
Text `T` · Pen `P` · Highlight `H` · Redact `K`. Then stroke weight (2/4/6px),
then colour (a single swatch button opening a 6-swatch popover: `#FF5A00`,
`#F2604C`, `#D9A400`, `#3FA46A`, `#1F6FEB`, `#0E0E0D`), then the commit group:
`Ship ⏎` (primary, `--hs-flare` fill, `#0E0E0D` text) and an overflow `⌘⏎`
caret opening the destination picker directly.

**Active tool.** Fill `--hs-flare-wash`, icon `--hs-flare`, plus a 2px
`--hs-flare` underline inside the button's bottom edge. Two redundant cues
because a single colour cue fails for the ~8% of users with a red-green
deficiency and flare is orange.

**Redact is destructive.** The `K` tool paints `--hs-redact` opaque rectangles
onto the bitmap at export time — pixels are replaced, not filtered. The tooltip
says so: *"Redact — replaces pixels. Cannot be undone after export."*

**Positioning algorithm.** Evaluated on every selection change, synchronously,
no animation. Let `G = 8px` gutter, `M = 8px` viewport margin, `T` = toolbar
rect.

1. **Below-outside** — `T.top = sel.bottom + G`, `T.centerX = sel.centerX`.
2. **Above-outside** — `T.bottom = sel.top - G`. Chosen if (1) overflows the viewport bottom.
3. **Right-outside** — toolbar rotates to a vertical 36px-wide stack, `T.left = sel.right + G`, top-aligned to `sel.top`. Chosen when the selection is short and wide against both horizontal edges.
4. **Left-outside** — mirror of (3).
5. **Inside bottom-right** — `T.right = sel.right - G`, `T.bottom = sel.bottom - G`. Only when the selection is ≥ `T.width + 2G` wide and ≥ 120px tall. The toolbar is excluded from the capture raster, so "inside" never contaminates the output.
6. **Viewport-docked** — full-width bar pinned to the viewport bottom edge, `--hs-r-0` on its bottom corners. Last resort, used when the selection is nearly the whole viewport.

In every slot, `T.centerX` is then clamped to `[M + T.width/2, viewport.width - M - T.width/2]` so the toolbar can slide along the selection edge but never leaves the screen. Slot changes are instantaneous — a toolbar that animates between slots while you resize is a toolbar you can't hit.

**Overflow.** If the viewport is narrower than 560px, the weight and colour
groups collapse into a single `⋯` button opening a 2-row popover.

**States.** `hidden` (during drag) · `default` · `tool-active` · `disabled`
(during export; whole bar drops to 45% opacity, pointer-events none, Ship shows
a 2px determinate `--hs-flare` progress line along its bottom edge).

---

### 3.3 Editor / preview surface

Opens in a Chrome tab (`editor.html`) after capture, or `Esc`-free inline if the
user shipped directly. Dark by default; follows `prefers-color-scheme`.

```
┌───────────────────────────────────────────────────────────────────────────────┐
│ HOTSHOT  Screenshot 2026-09-02 14:22:07   [ Pin ⌘⇧⏎ ] [ Copy ⌘C ] [ Ship ⌘⏎ ] │
├──────┬────────────────────────────────────────────────────┬───────────────────┤
│      │                                                    │ CONTEXT           │
│  V   │   ┌────────────────────────────────────────────┐   │ ───────────────── │
│  B   │   │                                            │   │ URL               │
│  A   │   │                                            │   │ app.acme.io/…/47  │
│  L   │   │            ①                               │   │ Title             │
│  N   │   │                 canvas                     │   │ Billing · Invoice │
│  T   │   │                                     ②      │   │ Viewport          │
│  P   │   │                                            │   │ 1512×860 @2x      │
│  H   │   │  ▓▓▓▓▓▓▓ (redacted)                        │   │ UA                │
│  K   │   │                                            │   │ Chrome 141 · macOS│
│      │   └────────────────────────────────────────────┘   │                   │
│ ──── │                                                    │ [x] attach context│
│  ⤺   │        1024 × 576  ·  PNG  ·  318 KB               │                   │
│  ⤻   │                                                    │ LAYERS            │
│      │                                                    │ ───────────────── │
│      │                                                    │ ② Arrow    ⌫      │
│      │                                                    │ ① Step     ⌫      │
│      │                                                    │ ▓ Redact   ⌫      │
├──────┴────────────────────────────────────────────────────┴───────────────────┤
│ V move · B box · N step · K redact · ⌘Z undo · ⌘C copy · ⌘⏎ ship              │
└───────────────────────────────────────────────────────────────────────────────┘
```

**Layout.** Fixed 48px left tool rail (vertical, same icon set and key hints as
the overlay toolbar — one muscle memory, two surfaces), fluid centre canvas,
fixed 260px right inspector. Canvas sits on `--hs-g-900` with an 8px
checkerboard only where the image has alpha. Image is centred, never upscaled
past 100%; zoom `⌘+ / ⌘- / ⌘0`, fit `⌘9`.

**Metadata strip** under the canvas: dimensions, format, byte size, all
`--hs-t-mono-sm` `--hs-g-400`. Byte size updates live as annotations are added,
because "why is my screenshot 4MB" is a real question.

**Context panel.** Auto-captured URL, page title, viewport + DPR, browser/OS.
Each row is individually toggleable; the master checkbox controls whether the
block is appended to the destination as a metadata table. Values are shown
verbatim so the user can see exactly what would leave the machine — this is the
privacy affordance, and it is visible by default rather than buried in settings.

**Pin.** `Pin ⌘⇧⏎` in the header closes the editor and lays the capture onto the
tab it came from as a pin (§3.9). It sits left of Copy because it is a *keep*
action, not a *send* action, and grouping it with Ship would imply it leaves the
machine. It does not.

**Layers list.** Reverse-chronological annotation stack. Hover reveals a delete
glyph; click selects on canvas. Numbered steps renumber automatically on delete.

**States.** `loading` (canvas area shows a 1px flare progress line at the top of
the frame, no spinner) · `ready` · `dirty` (title gains a `--hs-flare` dot) ·
`exporting` (Ship disabled with inline progress) · `error`.

---

### 3.4 Destination picker

Opens as a popover anchored to the Ship button; `⌘⏎` from anywhere in the editor.

```
┌──────────────────────────────────────────────────┐
│ SHIP TO                                     esc  │
├──────────────────────────────────────────────────┤
│ ⌾ LAST USED                                      │
│  1  ◧  Jira · ACME  ▸  Bugs                      │
│        Invoice total renders as NaN              │
│        Task ▾   Unassigned ▾   P3 ▾               │
├──────────────────────────────────────────────────┤
│  2  ◧  Jira        ▸  choose project…            │
│  3  ▤  Notion      ▸  Bug Intake DB              │
│  4  ◨  ClickUp     ▸  Design ▸ QA                │
├──────────────────────────────────────────────────┤
│ ⌘C  ⧉  Copy image to clipboard                   │
│ ⌘S  ⤓  Download PNG  (invoice-nan-2026-09-02.png)│
│ ⌘⇧M ⤓  Download + copy markdown link             │
│ ⌘⇧⏎ ⊞  Pin to screen                             │
├──────────────────────────────────────────────────┤
│ ☑ attach page context     ☑ open after shipping  │
│                              [ Ship  ⏎ ]         │
└──────────────────────────────────────────────────┘
```

**Layout.** 420px wide, `--hs-g-900`, `--hs-border-dark-raised`, `--hs-r-3`,
`--hs-e-3`. Rows 40px, 48px for the expanded last-used row.

**"Remembers your last project."** The top row is the *resolved* last
destination — service, site/workspace, project/database, and the field values
used last time — rendered as an editable summary, not a link to a form. Pressing
`1` then `⏎` ships with exactly those settings, two keystrokes from the editor.
The title field is pre-filled from a per-destination template
(default `{{page.title}} — {{selection.w}}×{{selection.h}}`), selected on focus
so typing replaces it. A `⌾` pin glyph marks the row; clicking it freezes this
destination so subsequent sends don't reorder the list. Persistence lives in
`chrome.storage.local` under `destinations.recent[]`, capped at 5, keyed by
`{service, siteId, containerId}`, never containing the token.

**Row anatomy.** Number key (mono, `--hs-g-400`) · service mark 16px ·
service name · `▸` · container name in `--hs-g-300`. A destination with no token
configured renders the container slot as `not connected` in `--hs-warn` and its
number key opens Settings at that service instead of shipping.

**No bare letter is ever bound in this popover.** Destinations are digits
`1`–`5`; every other action carries a modifier. Rationale and the collision
history behind this rule are in §7.2 — the previously specified bare `C` / `S` /
`M` are withdrawn because they collide with the annotation tool letters that
remain live on the surface underneath.

**States.** `idle` · `row-focused` (2px `--hs-flare` left edge on the row, fill
`--hs-g-800`) · `submitting` (row shows an inline determinate bar; the rest of
the list dims to 45%) · `success` (row flips to `--hs-ok` with the created key,
e.g. `ACME-4412 →`, and the popover holds for 900ms before closing) ·
`error` (row goes `--hs-err`, message inline, list stays open).

---

### 3.5 Extension popup

360 × auto, max 480px tall. Opens on the toolbar icon or `⌘⇧U`.

```
┌────────────────────────────────────────────┐
│ HOTSHOT                          ⚙   ⧉     │
├────────────────────────────────────────────┤
│  ▣  Region                        ⌘⇧S      │
│  ▤  Full page                     ⌘⇧P      │
│  ⌗  Element                       ⌘⇧E      │
│  ◔  Delayed        3s ▾           ⌘⇧D      │
├────────────────────────────────────────────┤
│ RECENT                                     │
│ ┌────┐ Invoice total NaN            2m     │
│ │thmb│ ACME-4412 · Jira                    │
│ └────┘                                     │
│ ┌────┐ Settings nav overflow        1h     │
│ │thmb│ Notion · Bug Intake                 │
│ └────┘                                     │
│ ┌────┐ Untitled capture             3h     │
│ │thmb│ not shipped                         │
│ └────┘                                     │
├────────────────────────────────────────────┤
│ Open library ⌘L        Jira ● Notion ● CU ○│
└────────────────────────────────────────────┘
```

**Layout.** Four capture rows at 44px each — the primary job, at the top,
one press each. Icon 18px, label `--hs-t-md`, shortcut right-aligned in
`--hs-t-mono-sm` `--hs-g-400`. Delay row carries an inline segmented `3/5/10`
stepper. Rows are keyboard-navigable with `↑↓` and fire on `⏎`; typing `R`, `F`,
`E`, `D` fires directly.

**Recent.** Three most recent captures, 48×32 thumbnail with a 1px
`--hs-g-700` border, title, relative time, and shipped-destination line. Click
opens the editor; `⌥`-click re-ships to the same destination.

**Footer.** Connection dots per service: filled `--hs-ok` = token present and
last call succeeded; hollow `--hs-g-500` = not configured; `--hs-err` ring =
last call failed auth. Clicking a dot opens Settings scrolled to that service.

**No hero, no logo lockup, no marketing.** The wordmark is 11px letterspaced
`--hs-g-400` in the corner. A popup that spends 80px on branding is a popup that
made you scroll to take a screenshot.

---

### 3.6 Settings / token management

Full page (`options.html`), 880px max content width, left-aligned, left nav.

```
┌───────────────────────────────────────────────────────────────────────────────┐
│ HOTSHOT   Settings                                                            │
├─────────────────┬─────────────────────────────────────────────────────────────┤
│ Capture         │  INTEGRATIONS                                               │
│ Annotation      │  Tokens are stored with chrome.storage.local on this device │
│ ▸ Integrations  │  only. Hotshot has no server. Nothing is sent anywhere       │
│ Shortcuts       │  except the service you pick, at the moment you pick it.     │
│ Privacy         │                                                             │
│ About           │  ┌───────────────────────────────────────────────────────┐  │
│                 │  │ ◧  JIRA                                    ● connected│  │
│                 │  │ Site      https://acme.atlassian.net                  │  │
│                 │  │ Email     sam@acme.io                                 │  │
│                 │  │ API token ••••••••••••••••••••••••  9f2c   [reveal]   │  │
│                 │  │ Added 12 Aug 2026 · last used 2m ago                  │  │
│                 │  │           [ Test connection ]  [ Replace ]  [ Remove ]│  │
│                 │  └───────────────────────────────────────────────────────┘  │
│                 │  ┌───────────────────────────────────────────────────────┐  │
│                 │  │ ▤  NOTION                                  ○ not set  │  │
│                 │  │ Internal integration token                            │  │
│                 │  │ ┌─────────────────────────────────────────┐           │  │
│                 │  │ │ secret_…                                │  [ Save ] │  │
│                 │  │ └─────────────────────────────────────────┘           │  │
│                 │  │ Create one at notion.so/my-integrations, then share    │  │
│                 │  │ the target database with it. ↗                        │  │
│                 │  └───────────────────────────────────────────────────────┘  │
│                 │  ┌───────────────────────────────────────────────────────┐  │
│                 │  │ ◨  CLICKUP                                 ○ not set  │  │
│                 │  └───────────────────────────────────────────────────────┘  │
└─────────────────┴─────────────────────────────────────────────────────────────┘
```

**Token field.** Type `password`, `--hs-t-mono-md`, `autocomplete="off"`,
`spellcheck="false"`. Once saved it is **never re-rendered in full** — the row
shows a fixed 24-dot mask plus the last 4 characters, which is enough to
identify which token this is without displaying it. `[reveal]` requires a
deliberate 400ms press-and-hold and re-masks after 10s. `[Replace]` clears and
focuses an empty field; there is no edit-in-place, because partially editing a
secret is how people corrupt secrets.

**Test connection** does one authenticated read (`/myself`, `/users/me`) and
reports inline: `● Connected as Sam Okafor` in `--hs-ok`, or the verbatim error
from §6. Never silently.

**Privacy pane** lists, as a plain table, every network destination the
extension can contact, the trigger, and the payload — and offers "Erase all
local data" with a typed confirmation (`erase`).

**Capture pane — download filename template.** Lives above the format and
scale controls, because "why is my Downloads folder full of `image (14).png`"
is the single most common screenshot complaint.

```
DOWNLOAD FILENAME
┌────────────────────────────────────────────────────────────┬──────┐
│ {host}-{title}-{date}-{time}                               │ .png │
└────────────────────────────────────────────────────────────┴──────┘
 insert   [{title}] [{host}] [{date}] [{time}] [{n}]        [ reset ]

 preview  app.acme.io-invoice-total-renders-as-nan-2026-09-02-142207.png
          ↑ from your most recent capture
```

**The input is a plain `<input type="text">`, not a pill/token editor.**
Rationale: a `contenteditable` field with atomic token chips looks better in a
screenshot of a settings page and breaks IME composition, native undo, select-all
and paste — and this is a field people paste into. The tokens are literal text,
so the whole template can be copied between machines as a string.

**Token insertion.** The five token buttons are 24px chips, `--hs-t-mono-sm`,
`--hs-g-800` fill, `--hs-r-1`. Clicking one inserts at the caret (replacing any
selection) and returns focus to the input with the caret after the insertion.
They are `<button>`s in tab order, so the whole control is keyboard-operable.

**Tokens (exhaustive; there is no sixth):**

| Token | Value | Example |
|---|---|---|
| `{title}` | Page title, slugified | `invoice-total-renders-as-nan` |
| `{host}` | Hostname, no scheme, no `www.` | `app.acme.io` |
| `{date}` | Local date, ISO | `2026-09-02` |
| `{time}` | Local time, 24h, no separators | `142207` |
| `{n}` | Zero-padded 2-digit collision counter | `02` |

**Live preview** updates on every keystroke (debounced 80ms) against the most
recent capture in the Library; with an empty Library it uses a fixed sample and
labels it `↑ sample — you have no captures yet`. The preview shows the *final,
sanitised* string, not the raw substitution, so the sanitiser is never a
surprise: lowercased, spaces and `/ \ : * ? " < > |` collapsed to `-`, runs of
`-` collapsed to one, leading/trailing `-` stripped, truncated to 120 chars on a
word boundary. If the resulting name already exists, `-{n}` is appended
automatically even when `{n}` is not in the template; the preview says so with a
second line: `collision → …-142207-02.png`.

**States and errors.**
- *Empty:* the field cannot be saved empty. Inline, `--hs-err-ink`:
  > **Filename template can't be empty.** Use at least one token or some plain
  > text. `[ Reset to {host}-{date}-{time} ]`
- *Unknown token:* the offending token is underlined 2px `--hs-err-ink` in the
  input; inline message:
  > **`{user}` isn't a token.** Available: `{title}` `{host}` `{date}` `{time}`
  > `{n}`. Everything else is used literally.
- *Unbalanced brace:* 
  > **Unclosed `{` at position 14.** Braces are only special in pairs; write
  > `{{` for a literal brace.
- *Resolves to nothing:* (e.g. template is `{title}` and the page has no title)
  > **This template can produce an empty filename.** `{title}` falls back to
  > `untitled` — the file will be saved as `untitled.png`. Add `{date}` or
  > `{host}` to keep names distinct.
- *Valid:* no green tick, no "Saved!" toast. The preview updating **is** the
  confirmation; a settings field that announces its own success is a settings
  field that does not trust its preview.
- Persisted to `chrome.storage.local` on blur and on `⏎`. `Esc` reverts to the
  last saved value.

**Shortcuts pane** mirrors `chrome://extensions/shortcuts` values read-only with
a deep link, plus the in-overlay bindings (§7.2) which we own and which *are*
rebindable here.

---

### 3.7 Capture history / library

Full page (`library.html`). Dense table, not a card grid.

```
┌───────────────────────────────────────────────────────────────────────────────┐
│ HOTSHOT   Library          ⌕ search…                    [ ▤ list ] [ ▦ grid ] │
├───────────────────────────────────────────────────────────────────────────────┤
│ ☐  PREVIEW  TITLE                        SOURCE            SIZE     SHIPPED   │
├───────────────────────────────────────────────────────────────────────────────┤
│ ☐  ▭▭▭▭    Invoice total renders as NaN  app.acme.io       1024×576  ACME-4412│
│            2 minutes ago                                   318 KB   Jira ●    │
├───────────────────────────────────────────────────────────────────────────────┤
│ ☐  ▭▭▭▭    Settings nav overflow         app.acme.io       880×410   Bug Intake│
│            1 hour ago                                      204 KB   Notion ●  │
├───────────────────────────────────────────────────────────────────────────────┤
│ ☐  ▭▭▭▭    Untitled capture              docs.acme.io      1512×860  —        │
│            3 hours ago                                     1.1 MB   not shipped│
├───────────────────────────────────────────────────────────────────────────────┤
│ 3 captures · 1.6 MB of 50 MB local quota                                      │
└───────────────────────────────────────────────────────────────────────────────┘
```

**Layout.** 56px rows, 72×40 thumbnail, two-line primary cell (title over
relative time), monospace columns for dimensions and size so they align. Grid
view is available and is *not* the default: a list tells you what a thing is; a
grid makes you recognise it.

**Interaction.** `j/k` or `↑↓` move, `⏎` opens the editor, `space` peeks
(full-size preview overlay, `space` again to dismiss), `x` toggles selection,
`⌘A` all, `⌫` delete with a single-level undo toast, `⌘⏎` re-ship selection to
the last destination. Search filters on title, URL and destination key.

**Retention.** Footer states the quota plainly. Default policy (editable in
Settings > Privacy): keep 30 days or 50 MB, whichever comes first, evicting
oldest-unshipped first. The number is shown, not hidden, because silent eviction
of someone's screenshots is a betrayal.

---

### 3.8 First-run onboarding

Opens once, in a tab, after install. Three panes, left-aligned, no carousel dots,
no illustration of a smiling person.

```
┌───────────────────────────────────────────────────────────────────────────────┐
│ HOTSHOT                                                             1 · 2 · 3 │
├───────────────────────────────────────────────────────────────────────────────┤
│                                                                               │
│  Take a shot without leaving the keyboard.                                    │
│                                                                               │
│  Press ⌘⇧S on any page. Drag a region, or press E to let                      │
│  Hotshot snap to the element under your cursor.                               │
│                                                                               │
│   ┌─────────────────────────────────────────────────┐                         │
│   │  ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒  │                         │
│   │  ▒▒▒▒ ■─────────────────────■ ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒  │  ← live practice pane   │
│   │  ▒▒▒▒ │  try it right here  │ ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒  │    (real overlay, real  │
│   │  ▒▒▒▒ ■─────────────────────■ ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒  │     drag, no capture)   │
│   │  ▒▒▒▒ ├┄┄┄┄┄┄ 420 ┄┄┄┄┄┄┄┄┄┄┤ ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒  │                         │
│   └─────────────────────────────────────────────────┘                         │
│                                                                               │
│   ✓ you selected a region        [ Next — connect a destination  → ]  skip    │
└───────────────────────────────────────────────────────────────────────────────┘
```

**Pane 1 — Capture.** A real, sandboxed instance of the overlay inside a bordered
practice area. The checkmark line only turns `--hs-ok` once the user actually
completes a drag. Learn by doing; nobody reads a feature tour.

**Pane 2 — Destination.** The three integration cards from Settings, inline, with
"I'll do this later" as an equal-weight text button. Connecting is genuinely
optional — the brief says integrations are secondary — so the copy is
*"Hotshot works fully without any of these. Copy and download are always
available."*

**Pane 3 — Shortcut.** Shows the assigned shortcut, detects a conflict with an
existing Chrome binding, and deep-links to `chrome://extensions/shortcuts`.
Ends with a single button: `Take your first shot`, which closes the tab and arms
region mode on the previously active tab.

Progress is `1 · 2 · 3` in mono, top-right. No progress bar, no confetti.


### 3.9 Pin-to-screen (P0)

A pin is a captured image laid onto the live page as a persistent, draggable
plate, so the user can read values out of one thing while typing into another.
It is the feature most likely to define how Hotshot *feels*, because unlike
every other surface it is measured in minutes of coexistence rather than
seconds of use. It is not a floating `<img>`; it is a physical object with a
resting state, a handling state, and a defined death.

```
   page content …………………………………………………………………………………………………………………………
   ┌──────────────────────────┐                    ┌───────────────────────┐
   │ Invoice                  │                    │ Amount due            │
   │                          │                    │ ┌───────────────────┐ │
  ┏┓────────────────────────┏┓                     │ │                   │ │
  ┃│  PINNED CAPTURE (rest)  │┃  ← rule pair, 2px  │ └───────────────────┘ │
   │  full colour, no chrome  │     + 9px corner   │ Currency              │
   │  no titlebar, no shadow  │       brackets     │ ┌───────────────────┐ │
  ┃│                         │┃                    │ │                   │ │
  ┗┛────────────────────────┗┛                     │ └───────────────────┘ │
                                                   └───────────────────────┘

   ── on hover / focus ──────────────────────────────────────────────────────
  ┏┓────────────────────────┏┓
  ┃│                        │┃   ◆ = resize handle (corners only)
   │                        │
  ┃│                        │┃
  ┗┛────────────────────────┗┛
  ◆                          ◆        ▲ 8px gutter — bar is OUTSIDE the image
  ┌───────────────────────────────────────────────────────┐
  │ 2 │ ▁▂▃▄▅▆▇█ 100%  │ ◐ ghost G │ 62% │ ⤒ F │ ⤓ ⇧F │ × │
  └───────────────────────────────────────────────────────┘
       opacity            ghost      scale  front  back  close
```

**Resting appearance — the decision.** The overlay and the pin share the
unknown-backdrop problem but have opposite time signatures: the overlay is
transient and must command; the pin is persistent and must recede. Those
pressures are resolved by **buying legibility with geometry rather than with
luminance, colour or area.** At rest a pin shows *exactly 2px of chrome and
nothing else*: the same `--hs-rule` pair from §2.3 — 1px `rgba(6,6,5,0.92)`
outboard, 1px `#FFFFFF` inboard — around all four edges, plus four 9px L-shaped
corner brackets in the same pair, inset 3px, quoting the registration marks on
a drafting plate. Guaranteed ≥ 4.58:1 against any page colour by the proof in
§7.1, and it costs no accent, no shadow bloom, no titlebar, no label and no
button. There is **no title bar at rest** because the whole plate is the drag
handle; a chrome strip you look at all day to occasionally grab is a bad trade.
Elevation at rest is `--hs-e-1` only (`0 1px 0 rgba(6,6,5,0.55)`) — a contact
shadow that says "laid on top", not a halo.

The one exception: when **two or more pins exist**, each shows a 16×16 index
chip (`--hs-g-950`, `--hs-t-mono-xs`, rule-pair edge) overlapping its top-left
corner by 4px. With a single pin there is nothing to disambiguate, so nothing
is drawn. The chip is what makes `⌥⇧2` usable, so it earns its pixels.

**Grabbing and dragging.** The entire pin surface is the handle. `cursor: grab`
on hover, `grabbing` while dragging. `⇧` during a drag constrains to the
dominant axis. Pins snap to viewport edges and to each other's edges within 6px
(hard snap, no easing). Drag tracks the pointer at `0ms` — see §5.1.

**Hover / focus chrome.** A 28px control bar appears after a 120ms hover intent
delay, positioned by the *same slot algorithm as the annotation toolbar* (§3.2:
below → above → right → left → inside-bottom → viewport-docked, always with an
8px gutter, always clamped into the viewport). It never covers the image —
that is the whole point of a pin. Contents left to right: index chip, opacity
slider, ghost toggle, scale readout, bring-to-front, send-to-back, close.
Four corner resize handles (7×7, rule pair) appear at the same moment. The bar
and handles are removed on `pointerleave` after 400ms, or immediately on
`Esc`.

**Resize.** Corner handles only — no edge handles, because a screenshot has one
correct aspect and edge handles imply otherwise. **Aspect ratio is locked,
always.** `⇧`-drag on a corner does *not* unlock aspect; it **crops** (reveals
or hides pixels at that edge at the current scale), which is the operation
people actually want when a pin is slightly too tall. Scale is reported live in
the control bar and in a rule-pair readout chip beside the dragged corner
(`62% · 634 × 380`).

**Small sizes.** Three bands, because a pin you cannot read is worse than no
pin:
- **≥ 240px long edge** — normal. Rendered from a mipmap generated once at pin
  time via `createImageBitmap(..., {resizeQuality:'high'})` at 2×, 1×, 0.5×, so
  downscaled text stays legible instead of aliasing into grey mush.
- **96–239px** — *dense mode*. Corner brackets shrink to 6px and the index chip
  moves fully outside the frame so it never sits on image content.
- **< 96px long edge** — the pin **collapses to a chip**: a 104 × 28 graphite
  bar with the index, a 40 × 22 thumbnail and the title, `--hs-t-mono-xs`. It
  is still draggable and still expands with `0` or a double-click. Hotshot
  refuses to render an illegible 40px smear and says so by changing form.

Minimum drag size is therefore enforced at 96px; the resize handles stop there.

**Opacity and ghost mode.** Two separate controls, deliberately.
- **Opacity**: 100% → 25% in 5% steps on the slider, 10% steps on `[` / `]`.
  Floor is 25%, not 0%: below that you can no longer tell a pin is there and
  you start clicking at ghosts.
- **Ghost mode** (`G`, or the ◐ toggle): a single-key state that sets opacity to
  35% **and** `pointer-events: none`, so clicks, selection and scroll pass
  straight through to the form underneath. This is usually the real reason
  someone pins a screenshot next to a field.
- **Critical rule: the rule-pair border and corner brackets never fade.** At 25%
  image opacity the frame is still drawn at 100%. You always know precisely
  where a ghost is and precisely what it contains the bounds of — a faded
  outline is how a ghost becomes lost furniture.
- Because a ghost ignores the pointer, a single 20×20 **grab tab** at its
  top-left corner retains `pointer-events: auto`. That tab is the only way back
  in with a mouse; `⌥⇧<n>` is the way back in without one.
- `Space` held on a focused pin momentarily restores 100% opacity and pointer
  events — peek-through, for reading one number.

**Multiple pins.** Maximum **8** concurrent, stated in the UI when you hit it
(§6.8). New pins cascade +24px x/y from the last, clamped 16px inside the
viewport. Z-order is last-focused-on-top; `F` brings to front, `⇧F` sends to
back. The **focused** pin is the only one carrying accent: a 2px `--hs-flare`
ring at 2px offset, outboard of the rule pair — which is also its focus ring,
so focus and "the pin I am driving" are the same signal rather than two.
Unfocused pins are told apart by their index chip and their content; Hotshot
does not tint pins different colours, because tinting a screenshot is lying
about its pixels.

**Scrolling.** Pins are `position: fixed` and **do not scroll with the page.**
The alternative — anchoring a pin to the document — was considered and rejected:
the entire use case is "hold this still while I work somewhere else", and a
reference that scrolls away is not a reference. The pin stays put; the page
moves beneath it. Nothing about a pin changes during scroll — no parallax, no
opacity shift, no shrink-on-scroll.

**Navigation — designing the disappearance.** A content script does not survive
navigation, so pins genuinely die. Rather than blinking out (which reads as a
crash and as data loss), on `beforeunload` every pin fades `opacity → 0` over
120ms with `--hs-e-exit`. This is the **only fade-out in the product** and it is
justified: an object that vanishes between frames was destroyed; an object that
fades was dismissed. On the next page, a **restore strip** appears bottom-left
for 6 seconds, `--hs-g-950`, rule-pair edge, `--hs-t-mono-sm`:

> `3 pins closed on navigation · ⌥⇧R to restore`

Restoration is real, not a consolation: the bitmaps live in the Library, so
`⌥⇧R` re-creates all of them at their previous positions, sizes, opacities and
z-order, which are persisted per-origin in `chrome.storage.local` under
`pins.lastSession[]`. It converts "I lost my pins" into "I pressed one key."
The strip never reappears after those 6 seconds; the Library is the durable
path.

**States.** `resting` · `hover` (control bar + handles) · `focused` (flare ring)
· `dragging` · `resizing` · `cropping` (`⇧`-resize) · `ghost` · `peek` (space
held) · `collapsed` (< 96px) · `orphaned` (bitmap evicted, §6.8) ·
`dismissing`.

**Dismissal.** Close `×` on the bar, `⌫` on a focused pin, or `⌥⇧⌫` to dismiss
all. Every dismissal (including dismiss-all) posts an undo strip in the same
slot as the restore strip for 6 seconds: `Pin 2 closed · ⌘Z to undo`. `Esc` on
a focused pin **releases focus back to the page and does not dismiss** —
reflexive `Esc` must never destroy something the user spent a capture on.

---

## 4. Iconography

**The system.**

- **Grid:** 16×16, with a 1px keyline margin — all artwork lives in a 14×14 box.
- **Stroke:** 1.5px, drawn on the half-pixel (`translate(0.25, 0.25)` on even
  strokes) so nothing renders as a 2px grey smear at 100% zoom.
- **Caps:** square. **Joins:** miter, limit 4. No round caps anywhere.
- **Corners:** 0.5px radius — enough to kill the razor point of a true miter,
  not enough to read as rounded. Consistent with the `--hs-r` ceiling.
- **Fill:** none, except where a filled shape *is* the meaning (redaction block,
  step badge, colour swatch, pie-timer wedge). Two-value system: `currentColor`
  stroke and, where filled, `currentColor` at 100% — no 40% ghost fills.
- **Optical alignment:** every icon is optically centred, not
  bounding-box-centred; the arrow and the pen are visually heavy on one diagonal
  and get nudged 0.5px against it.
- **No perspective, no isometric tricks, no icon that is a tiny illustration.**

**Sizes:** 16px (toolbars, rows), 18px (popup capture rows), 20px (settings
service marks). Only 16px is hand-hinted; 18 and 20 are the same geometry scaled,
which is acceptable because they are never adjacent to a 16px instance.

### 4.1 Capture-mode icons — the 16px distinctness problem

The four modes must be tellable apart at a glance in a 96px segment, in a
peripheral-vision moment, at the top of a page. The discipline is that the four
**silhouettes** differ before any detail does: a landscape rectangle, a portrait
rectangle, a landscape rectangle with an intruding pointer, and a circle.

**▣ Region.** A 12w × 9h rectangle centred in the box. The top and bottom edges
are drawn as 2px dashes with 2px gaps; the left and right edges likewise. Over
that, four solid 3.5px L-shaped corner brackets, each hugging one corner with a
1px inward offset. Reads as "marquee". The dash/solid contrast is the only place
in the icon set where a dashed line appears, so it is uniquely identifying.

**▤ Full page.** A 9w × 13h portrait rectangle, top edge flush with the keyline.
Inside: three 5px horizontal lines at 1/4, 1/2 and 3/4 height, left-aligned with
a 1.5px inset — content. A vertical arrow starts at the rectangle's vertical
centre, exits through the bottom edge and terminates 1.5px *below* the shape with
a 4px chevron head. The arrow overlaps and breaks the bottom edge (1.5px gap in
the rectangle's stroke where the shaft crosses) — that break is what says
"continues past what you can see".

**⌗ Element.** A 12w × 9h rectangle, solid stroke, plus a 2.5px tick centred on
each of the four edges pointing *outward* — the technical-drawing datum marks,
tying it to the dimension rules on the overlay. Inside the bottom-right quadrant
sits a 5px arrow cursor (a classic two-line pointer with a filled tail),
overlapping the rectangle's inner corner. Silhouette differs from Region because
of the protruding ticks and the pointer breaking the rectangle's interior.

**◔ Delay.** A Ø12.5 circle, 1.5px stroke, with a filled wedge from 12 o'clock
clockwise to 3 o'clock (a quarter pie). A 1.5px radial hand runs from centre to
the 12 o'clock position, extending 1px past the circle as a tick. Only round
shape in the set; unmistakable at any size. The delay *duration* is never drawn
into the icon — it lives as `3s` text beside it, because a numeral inside a
12px circle is a smudge.

### 4.2 Annotation tool icons

| Tool | Key | Description |
|---|---|---|
| Select / move | `V` | Standard arrow pointer, 5w × 11h, filled tail, drawn on the box's leading diagonal. |
| Box | `B` | 11 × 8 rectangle, 1.5px stroke, empty. |
| Arrow | `A` | Straight shaft from lower-left to upper-right at 45°, 4px open chevron head, 90° included angle. Head is open, not filled — distinguishes it from the pointer. |
| Line | `L` | **A standalone tool, not a headless arrow.** A single unbroken 45° stroke running corner to corner across the full 14px live area, no head at either end. It is the only *single-path, two-point* icon in the set, and therefore the only one whose silhouette is a bare diagonal — that minimality is what makes it read at 16px next to Arrow, whose shaft stops 3px short to make room for a 4px open chevron. Behaviourally distinct too: Line has no direction, so it has no head to place, and `⇧` snaps it to 0° / 45° / 90° for rules and underlines. Where Arrow points at a thing, Line separates or connects two things. |
| Numbered step | `N` | Ø11 filled disc with a knocked-out `1` in Plex Mono 8px. The only glyph-bearing icon; the only `--hs-r-full` shape. |
| Text | `T` | A slab `T`: 11px crossbar, 11px stem, plus 2px feet on the stem. The feet stop it reading as a plus sign. |
| Pen | `P` | 11px nib body at 45°, chisel tip (a 3px angled cut at the lower-left), 2px bevel line across the barrel. |
| Highlight | `H` | Same nib body, but with a 4px-wide flat chisel and a 5 × 2 filled block trailing from the tip. Silhouette is heavier at the tip than Pen. |
| Redact | `K` | A 12 × 8 rectangle with the left 60% filled solid and the right 40% stroked-empty, split on a hard vertical edge. Reads as "pixels replaced", and being half-filled it is the heaviest icon in the row — appropriate for a destructive tool. |
| Undo / Redo | `⌘Z` | 3/4 circular arc with a 3px chevron head, mirrored for redo. The only arcs in the tool set. |

### 4.3 Service marks

Jira, Notion and ClickUp are represented by **neutral geometric marks in
`currentColor`**, not by the vendors' brand logos: `◧` a square with the left
half filled (Jira), `▤` a square with three interior rules (Notion), `◨` a
square with the right half filled (ClickUp), each on the same 16px grid with the
same 1.5px stroke. Rationale: brand logos would break the icon system's
grammar on every surface they appear, and reproducing vendor marks inside a
third-party extension is a trademark problem we do not need. The service name is
always written next to the mark, so nothing depends on recognising the glyph.

---

## 5. Motion

**Principle: a capture tool that animates its overlay in is a slow capture tool.**
Agreed, and stated as a rule. The user has already decided to take a screenshot
before they pressed the key; every millisecond between the keypress and a usable
crosshair is the product failing. Motion in Hotshot is permitted only where it
carries information that would otherwise be lost, and never on the critical path.

### 5.1 What does NOT animate — and why

| Thing | Duration | Why |
|---|---|---|
| Overlay appearance (veil + crosshair) | `0ms` | It must be usable on the same frame the key fires. Any fade means the first 100ms of drag happens against a half-drawn UI. |
| Selection frame during drag | `0ms` | The frame must track the pointer with zero lag; a transition on `width/height` would literally make the rectangle trail the cursor. |
| Dimension readout numbers | `0ms` | No count-up, no interpolation. A measurement that lies for 140ms is worse than no measurement. |
| Magnifier position | `0ms` | Same reason. It is an optical instrument, not a follower. |
| Toolbar slot changes (below → above → docked) | `0ms` | Animating a repositioning toolbar means aiming at a moving target. |
| Marching ants on the selection | never | Perpetual animation on the user's page costs a compositor frame forever and adds nothing the rule pair doesn't already say. |
| Element-mode highlight moving between elements | `0ms` | Interpolating between two DOM rects makes the highlight briefly wrong, which is the one thing it must never be. |
| Veil recut on resize | `0ms` | Consistency with the frame. |
| Pin drag, resize, crop | `0ms` | A pin is a physical plate under your finger. Any transition on `transform` makes it lag the pointer, which is the single fastest way to make an object feel cheap. |
| Pin z-order change (`F` / `⇧F`) | `0ms` | Stacking is a fact, not an event. |
| Pin opacity step (`[` / `]`, `G`) | `0ms` | These are held-and-repeated keys; a 140ms transition on each step turns a 4-press adjustment into a smear. |
| Pin appearing when created | `0ms` | You asked for it and you are looking at it. |
| Pin snap to edge / to another pin | `0ms` | A snap that animates is not a snap. |

### 5.2 What DOES animate

| Thing | Property | Duration | Easing | Why |
|---|---|---|---|---|
| Annotation toolbar first appearance after a drag settles | `opacity 0→1` only | `--hs-d-snap` (90ms) | `--hs-e-enter` | It appears where your hand isn't; a hard pop reads as a glitch. Opacity only — it does not slide, so its final position is knowable from frame one. |
| Toolbar disappearance on re-drag | `opacity 1→0` | `--hs-d-0` | — | Getting out of the way is always instant. |
| Tool button hover / active fill | `background-color` | `--hs-d-snap` | `--hs-e-std` | Confirms the hit without flicker during fast traversal. |
| Popover / destination picker open | `opacity 0→1`, `translateY(-4px)→0` | `--hs-d-ui` (140ms) | `--hs-e-enter` | 4px, not 12px. Establishes the anchor relationship; anything longer is theatre. |
| Popover close | `opacity 1→0` | `--hs-d-snap` | `--hs-e-exit` | Exits are always faster than entrances. |
| Ship progress bar | `width` | linear, real | linear | It is data, not decoration. Determinate only — we know the bytes. |
| Success row flip in the picker | `background-color`, `color` | `--hs-d-settle` (220ms) | `--hs-e-std` | The one place a slower beat is right: it is the receipt, and it holds for 900ms before the popover closes so the issue key is readable. |
| Library row delete | `height → 0`, `opacity → 0` | `--hs-d-settle` | `--hs-e-exit` | Shows *which* row went, which matters when you multi-select. |
| Full-page stitch progress | `width` of the determinate bar + tile-ledger segments | linear, real | linear | Multi-second by necessity (≈2 tiles/s). It is the one long-running thing in the product, so its progress must be literal and continuously moving — a stalled bar is diagnostic information. |
| Pin fade-out on page navigation | `opacity 1→0` | 120ms | `--hs-e-exit` | The only fade-out in the product. An object that vanishes between frames reads as a crash; an object that fades reads as dismissed. 120ms is enough to register and short enough not to delay the unload. |
| Restore / undo strip in / out | `opacity`, `translateY(4px)→0` | `--hs-d-ui` | `--hs-e-enter` | It appears in peripheral vision after the user's attention has moved; it needs the movement to be noticed at all. |
| Pin collapse to chip / expand | `width`, `height` | `--hs-d-snap` | `--hs-e-std` | The one pin transition that is kept, because the plate changes *form*, and a form change with no transit looks like one object being swapped for another. |
| Onboarding pane change | `opacity` cross-fade | `--hs-d-ui` | `--hs-e-std` | No horizontal slide; it is not a carousel. |
| Focus ring | `outline-color` | `--hs-d-0` | — | Focus must never lag the key. |

### 5.3 Motion policy

- Nothing in Hotshot springs, bounces, or overshoots. There are no spring
  physics and no easing curve with a control point outside `[0,1]`.
- Nothing loops. There are no shimmer skeletons and no indeterminate spinners
  anywhere in the product (see §6).
- Maximum duration in the system is 220ms. There is no `--hs-d-slow`.
- `@media (prefers-reduced-motion: reduce)` sets every duration to `0ms` and
  disables the success-row colour flip in favour of an immediate state swap.
  Nothing is lost, because nothing load-bearing was in the motion.

---

## 6. Empty, loading and error states

House style for error copy, applied throughout: **say what happened, say what it
means, say what to do next, in that order; never apologise; never say
"something went wrong"; never blame the user; include the machine-readable
detail (status code, field name) because the person reading it is usually the
person who can fix it.** Copy below is verbatim, ready to paste into the
strings file.

### 6.1 Capture overlay

- **Empty (idle, no selection):** no empty state — the hint bar carries it:
  `drag to select · space to move · ⇧ constrain · ⌥ from centre · esc cancel`
- **Loading (region / element):** none exists. The overlay is synchronous by
  design.
- **Loading (full page) — designed for a genuinely slow operation.** Chrome
  throttles `captureVisibleTab` to ~2 calls/second, so a 14-screen page takes
  ≈7s and 5s+ is the *normal* case. There is no spinner and no indeterminate
  state anywhere in this flow; we know the tile count before the first capture
  because we measure `scrollHeight / innerHeight` up front. Two coordinated
  affordances:

```
   right edge of viewport ─┐            bottom-centre, 360 × 72
                           ▼
                          ┌─┐  ┌──────────────────────────────────────────┐
                          │█│  │ STITCHING FULL PAGE                      │
                          │█│  │ ███████████████░░░░░░░░░░░  7 / 14 tiles │
                          │█│  │ 3.4s elapsed · ~3.5s left · esc to stop  │
                          │█│  └──────────────────────────────────────────┘
                          │█│  ← tile ledger: one segment per screen,
                          │▓│    filling top-to-bottom so you can see
                          │░│    WHERE in the page we are, not just
                          │░│    how far along
                          └─┘
```

  - **Stitch panel**, bottom-centre, `--hs-g-950`, rule-pair edge, `--hs-e-2`.
    Line 1: `STITCHING FULL PAGE` in `--hs-t-xs`. Line 2: a determinate bar
    (`--hs-flare` fill on `--hs-g-800` track, 6px, `--hs-r-0`) plus
    `7 / 14 tiles` in `--hs-t-mono-sm` — the count is the honest unit, not a
    percentage, because tiles are what is actually happening. Line 3: elapsed
    and remaining in `--hs-t-mono-xs` `--hs-g-400`. The estimate is computed
    from the measured mean interval of completed tiles, not from a constant, and
    is shown with a `~` and rounded to 0.5s so it never pretends to precision.
  - **Tile ledger**, a 6px column pinned to the viewport's right edge, one
    segment per screen with 1px gaps. Filled segments `--hs-flare`, in-flight
    segment `--hs-flare` at 40%, pending `--hs-g-700`. Spatial progress: the
    user can see the capture walking down their page. This is the thing that
    makes a 7-second wait feel like work being done rather than a hang.
  - **If a tile takes > 1.5s** (throttle backoff, or a page that re-lays-out),
    line 3 changes to `waiting for the page to settle…` in `--hs-warn` — the
    bar does not fake movement. Silence during a stall is how progress bars
    lose trust.
  - **`Esc` stops and keeps.** Line 3 becomes
    `Stop and keep 7 of 14 screens?  esc again to discard  ·  ⏎ to keep`.
    Aborting a 5-second operation must never silently bin 5 seconds of work.
  - **`prefers-reduced-motion`** does not disable this; a determinate bar
    reporting real progress is information, not decoration. It is exempt.
- **Error — page cannot be captured:** a single 36px bar, top-centre, `--hs-err`
  left rule, opaque `--hs-g-950`:
  > **Chrome blocks capture on this page.** Extension, Web Store and `chrome://`
  > pages are off limits to every extension, including this one. Try a normal
  > tab.
- **Error — capture permission not granted this tab:**
  > **Hotshot needs this tab's permission for one capture.** Click the Hotshot
  > icon in the toolbar, then press ⌘⇧S again. Permission lasts until you leave
  > the page.
- **Error — full-page stitch incomplete:**
  > **Captured 8 of 11 screens.** The page changed height while scrolling — a
  > lazy-loaded list or a sticky element usually does this. Keep what we have,
  > or retry with the page fully scrolled once first.
  > `[ Keep 8 screens ]  [ Retry ]`
- **Error — element bounds unresolvable:**
  > **That element has no size.** It's collapsed, hidden, or zero-height. Press
  > `[` to select its parent.

### 6.2 Editor

- **Empty (no annotations):** the layers list shows
  `No annotations. Press B for a box, N for a numbered step.` in `--hs-t-sm`
  `--hs-g-400` — an instruction, not a shrug.
- **Loading (decoding a large capture):** the canvas frame renders at final size
  immediately with a 1px `--hs-flare` determinate bar along its top edge. No
  skeleton shimmer, no spinner. Rationale: we know the byte count, so a
  determinate bar is honest and a spinner would be a lie about our knowledge.
- **Error — decode failed:**
  > **This capture didn't decode.** The stored image is truncated — usually a
  > browser crash during save. The file is unrecoverable; delete it and take
  > the shot again. `[ Delete capture ]`
- **Error — storage quota:**
  > **Local storage is full (50 MB).** Hotshot keeps captures on this device
  > only, so nothing is deleted for you. Free space in the Library, or raise
  > the limit in Settings → Privacy. `[ Open Library ]`

### 6.3 Destination picker

- **Empty (no integrations configured):**
  > **No destinations connected yet.**
  > Copy and download work right now — `⌘C` and `⌘S`, and `⌘⇧⏎` pins the
  > capture to the page. To send captures straight
  > into Jira, Notion or ClickUp, add a personal API token. It stays on this
  > device. `[ Connect a service ]`
- **Loading (fetching projects/databases):** the container name cell shows
  `loading…` in `--hs-t-mono-sm` `--hs-g-400`; the row stays selectable and the
  keyboard number still works — we resolve the container before sending.
- **Submitting:** determinate bar inside the row; label changes to
  `Creating issue…` / `Creating page…` / `Creating task…`.
- **Error — 401/403:**
  > **Jira rejected the token (401).** The token was revoked, expired, or
  > belongs to a different site. Replace it in Settings → Integrations. Nothing
  > was sent. `[ Open Settings ]`
- **Error — 404 container gone:**
  > **Project `ACME` no longer exists (404).** It was renamed, archived, or
  > your account lost access. Pick a different project below.
- **Error — 413 too large:**
  > **The image is larger than Jira accepts (10 MB limit; this is 14.2 MB).**
  > Crop it, or download the PNG and attach it manually. `[ Download PNG ]`
- **Error — 429:**
  > **Rate limited by Notion. Retrying in 8s.** Nothing was lost — the capture
  > is saved locally. `[ Cancel ]`
- **Error — network:**
  > **Couldn't reach api.clickup.com.** Check your connection or VPN. The
  > capture is saved in your Library; press ⌘⏎ to try again.
- **Error — unknown 5xx:**
  > **Jira returned 503 and no detail.** That's the service, not your token.
  > The capture is in your Library. `[ Retry ]  [ Copy error detail ]`

### 6.4 Settings

- **Empty (no tokens):** each service card renders in its input state with the
  provider-specific instruction line (see §3.6). No illustration, no "get
  started" banner.
- **Loading (Test connection):** the button label becomes `Testing…`, disabled,
  no spinner.
- **Success:** `● Connected as Sam Okafor · ACME` in `--hs-ok`.
- **Error — malformed token:**
  > **That doesn't look like a Notion internal integration token.** They start
  > with `secret_` or `ntn_` and are about 50 characters. Nothing was saved.
- **Error — wrong site URL:**
  > **`acme.atlassian.net/jira` isn't a site root.** Use
  > `https://acme.atlassian.net` — no path.
- **Error — token stored but unusable:**
  > **Token saved, but the test call failed (403: `Forbidden`).** In Notion,
  > the database also has to be shared with your integration — open the
  > database, `···` → Connections → add Hotshot.

### 6.5 Library

- **Empty (never captured):**
  > **Nothing captured yet.**
  > Press ⌘⇧S on any page to take your first shot. Captures live on this
  > device and are never uploaded.
- **Empty (search returned nothing):**
  > **No captures match `invoice`.** Search covers titles, page URLs and
  > destination keys. `[ Clear search ]`
- **Loading:** rows render as their real geometry with `--hs-g-800` blocks in
  place of thumbnails, held for a maximum of one frame; no shimmer.
- **Error — index corrupt:**
  > **The capture index couldn't be read.** Your image files are intact. Rebuild
  > the index to recover them — titles and destinations may be lost.
  > `[ Rebuild index ]`

### 6.6 Popup

- **Empty (no recent captures):** the RECENT section is omitted entirely; the
  popup is just the four capture rows plus the footer. Rationale: an empty
  section with a placeholder is worse than a shorter popup.
- **Error — unsupported page:** the four capture rows are disabled at 45%
  opacity with a single line beneath:
  > **This page can't be captured.** Chrome blocks extensions on
  > `chrome://` and Web Store pages.

### 6.7 Onboarding

- **Error — shortcut conflict:**
  > **⌘⇧S is already taken by another extension.** Chrome gives the key to
  > whichever extension claimed it first. Reassign it here:
  > `[ Open Chrome shortcut settings ]`

### 6.8 Pins

- **Empty:** a pin has no empty state — it is created from an image or it does
  not exist. There is no "pin placeholder".
- **Loading:** a pin appears only once its bitmap is decoded, so there is no
  intermediate frame. From `⌘⇧⏎` to a visible plate is one frame for anything
  already in memory; for a Library re-pin, the source row carries its own 1px
  determinate bar and the pin appears when ready. Never an empty frame with a
  spinner in it — an empty pin is indistinguishable from a broken one.
- **Orphaned (bitmap evicted from local storage):** the pin does not vanish —
  vanishing would look like a bug. It becomes a graphite plate at its existing
  size, rule-pair border intact, with left-aligned `--hs-t-mono-sm` copy inset
  12px:
  > **This capture is gone.** It was evicted when local storage filled up
  > (Settings → Privacy sets the limit). The pin can't be restored.
  > `[ Dismiss ]`
- **Error — pin limit:** attempting a ninth pin does not fail silently; the
  restore/undo strip slot shows:
  > **8 pins is the limit.** Close one to pin another — `⌥⇧⌫` closes them all.
- **Error — page forbids overlays:** where the content script cannot run
  (`chrome://`, Web Store), the Pin row in the destination picker is disabled
  with the reason inline:
  > **Can't pin here.** Chrome blocks extensions on this page. Download or copy
  > instead.
- **Navigation notice (not an error):**
  > `3 pins closed on navigation · ⌥⇧R to restore`
- **Dismissal notice:**
  > `Pin 2 closed · ⌘Z to undo`
- **Ghost-mode reminder** (shown once, the first time `G` is used, for 4s):
  > `Ghost: clicks pass through. G to return, ⌥⇧2 to focus.`

---

## 7. Accessibility

### 7.1 Contrast — measured against the tokens in §2

All values are WCAG 2.1 contrast ratios computed from the exact hex values.

**Dark surfaces (base `--hs-g-900 #171716`):**

| Pair | Ratio | Requirement | Verdict |
|---|---|---|---|
| `--hs-g-25 #F7F7F5` text | **16.72:1** | 4.5 | pass AAA |
| `--hs-g-300 #B2AEA5` secondary text | **8.11:1** | 4.5 | pass AAA |
| `--hs-g-400 #8C8880` tertiary text / key hints (10px) | **5.08:1** | 4.5 | pass AA |
| `--hs-flare #FF5A00` on `--hs-g-900` | **5.73:1** | 4.5 | pass AA |
| `--hs-flare #FF5A00` on `--hs-flare-wash #2A1408` | **5.59:1** | 4.5 | pass AA |
| `--hs-ok #3FA46A` | **5.75:1** | 4.5 | pass AA |
| `--hs-warn #D9A400` | **7.91:1** | 4.5 | pass AAA |
| `--hs-err #F2604C` | **5.59:1** | 4.5 | pass AA |
| `--hs-flare` focus ring on `--hs-g-950 #0E0E0D` | **6.18:1** | 3.0 | pass |
| `--hs-g-700 #3A3936` internal divider | **1.55:1** | — | decorative only; never the sole carrier of a boundary. Stated honestly: this fails 3:1 and is used only where a divider is redundant with spacing. |

`--hs-g-500 #6B6862` measures **3.23:1** on `--hs-g-900` and is therefore
**banned as text on dark surfaces**; it is permitted only for non-text glyphs
(hollow status dots), where 3:1 applies and it passes.

**Light surfaces (base `--hs-g-25 #F7F7F5`):**

| Pair | Ratio | Verdict |
|---|---|---|
| `--hs-g-950 #0E0E0D` body text | **17.0:1** | AAA |
| `--hs-g-600 #514F4A` secondary text | **7.63:1** | AAA |
| `--hs-g-500 #6B6862` tertiary text | **5.18:1** | AA |
| `--hs-flare-ink #D93E00` | **4.53:1** | AA |
| `--hs-ok-ink #1E7A48` | **4.98:1** | AA |
| `--hs-warn-ink #8A6A00` | **4.73:1** | AA |
| `--hs-err-ink #C4321E` | **5.12:1** | AA |
| `--hs-flare #FF5A00` on light | **2.92:1** | **fails** — hence `--hs-flare-ink` exists and `--hs-flare` is forbidden on light surfaces. |
| `--hs-g-400 #8C8880` on light | **3.29:1** | **fails for text** — permitted only for borders and non-text marks on light. |

**On unknown page pixels (the overlay).** Contrast cannot be computed against an
unknown backdrop, so the rule pair (§2.3) is used instead. Proof: for any
backdrop luminance `L`, `contrast(white, L) = 1.05/(L+0.05)` and
`contrast(black, L) = (L+0.05)/0.05`. These cross at `L = 0.1791`, where both
equal **4.58:1**. Since the pair always presents both a white and a black
stroke, **the better of the two is never worse than 4.58:1 against any possible
colour** — comfortably above the 3:1 required for non-text graphics, and above
4.5:1 as well. Every mark drawn over the page uses the pair: selection frame,
handles, crosshair, dimension rules and their numerals, element highlight,
magnifier bezel, the outer edge of the toolbar and readout chip panels, and
**every edge of a pin** — its border, its corner brackets, its index chip, its
resize handles and its control bar. The pin extends the primitive rather than
inventing a second treatment, and it is the surface that most needs it: a pin
may sit on the same unknown pixels for an hour. Note the deliberate consequence
for ghost mode — the image drops to 25–35% opacity but the rule pair is drawn at
100%, so the frame's 4.58:1 floor holds even when the content behind it is
almost fully visible. The `--hs-flare` focus ring on the focused pin measures
6.18:1 against its own graphite chip and is *additional* to the rule pair, never
a replacement for it, so focus stays visible on a page of any colour.

**Colour is never the only channel.** The active tool carries both a fill change
and a 2px underline. The active capture mode carries a fill change and a bottom
bar. Connection status carries both a colour and a word (`connected` / `not set`
/ `auth failed`). Destination errors carry an icon, a colour and a sentence.

### 7.2 Keyboard model — complete and collision-checked

Every action in Hotshot is reachable without a mouse. Bindings are given as an
exhaustive table by **scope**, because the only way to reason about collisions is
to know which scopes can be live at the same moment. Two bindings collide **only
if they share a key and their scopes can be simultaneously active.**

**Scopes.**

| Scope | Live when | Simultaneous with |
|---|---|---|
| `S0` Chrome commands | always | all |
| `S1` Overlay, no selection | capture overlay open, nothing selected | S0 |
| `S2` Overlay, selection settled | overlay open, annotation toolbar shown | S0 |
| `S3` Editor tab | editor focused | S0 |
| `S4` Destination picker | modal popover open over S2 or S3 | S0 (swallows S2/S3) |
| `S5` Library tab | library focused | S0 |
| `S6` Pin focused | a pin has DOM focus, in-page | S0, S7 |
| `S7` Page focused, pins exist | in-page, no pin focused | S0 |

S4 is modal and swallows all bare keys of the scope beneath it. S1 and S2 are
mutually exclusive by definition. S6 and S7 exist only when no overlay is open.

#### S0 — Chrome commands (user-rebindable in `chrome://extensions/shortcuts`)

| Key | Action | Collision |
|---|---|---|
| `⌘⇧S` / `Ctrl+Shift+S` | Region capture | Contested with other extensions, not within Hotshot. Onboarding detects and reports it (§6.7). |
| `⌘⇧P` / `Ctrl+Shift+P` | Full-page capture | — |
| `⌘⇧E` / `Ctrl+Shift+E` | Element capture | — |
| `⌘⇧D` / `Ctrl+Shift+D` | Delayed capture | — |
| `⌘⇧U` / `Ctrl+Shift+U` | Open popup | — |

#### S1 — Capture overlay, no selection

| Key | Action | Collision |
|---|---|---|
| `R` | Region mode | — |
| `F` | Full-page mode | — |
| `E` | Element mode | — |
| `D` | Delay mode (cycles 3 → 5 → 10 → off) | — |
| `M` | Toggle magnifier locked-on | — |
| `⌘A` | Select the entire viewport | **Was bare `A`. Changed** — see contested keys below. |
| `[` / `]` | Element mode only: parent / first child | scope-split, see below |
| `Arrows` | Move the origin caret 1px (`⇧` = 10px) | — |
| `Tab` | Focus mode rail | — |
| `Esc` | Cancel capture | — |

#### S2 — Capture overlay, selection settled (annotation live)

Mode keys and tool keys are both live here, so this is the scope where every
bare letter must be unique. It is.

| Key | Action | Group |
|---|---|---|
| `R` `F` `E` `D` | Switch capture mode | mode |
| `V` | Select / move | tool |
| `B` | Box | tool |
| `A` | Arrow | tool |
| `L` | **Line** (standalone; no head, `⇧` snaps to 0/45/90°) | tool |
| `N` | Numbered step | tool |
| `T` | Text | tool |
| `P` | Pen | tool |
| `H` | Highlight | tool |
| `K` | Redact (destructive) | tool — **was `R`. Changed.** |
| `M` | Toggle magnifier | overlay |
| `1`–`6` | Annotation colour | style |
| `[` / `]` | Stroke weight − / + | style |
| `Space` (hold) | Drag the whole selection | geometry |
| `Arrows` | Move selection 1px (`⇧` 10px) | geometry |
| `⌥ + Arrows` | Resize from focused edge 1px (`⇧⌥` 10px) | geometry |
| `⇧` / `⌥` during drag | Constrain square / draw from centre | geometry |
| `⌘A` | Select entire viewport | geometry |
| `Tab` / `⇧Tab` | mode rail → selection → handles (clockwise) → toolbar | focus |
| `⌘Z` / `⌘⇧Z` | Undo / redo annotation | edit |
| `⌫` | Delete selected annotation | edit |
| `Enter` | Commit → editor | commit |
| `⌘Enter` | Commit → destination picker | commit |
| `⌘⇧Enter` | Commit → **pin to screen** | commit |
| `⌘⇧C` | Commit → copy to clipboard, close everything | commit |
| `Esc` | Disarm tool; if no tool armed, cancel capture | — |

Bare-letter set used in S2: `A B D E F H K L M N P R T V` — 14 keys, all
distinct. Free bare letters remaining: `C G I J O Q S U W X Y Z`.

#### S3 — Editor tab

Identical to S2's tool, style and edit rows (one muscle memory, two surfaces),
minus the mode and geometry rows, plus:

| Key | Action |
|---|---|
| `⌘C` | Copy image to clipboard |
| `⌘S` | Download PNG (using the §3.6 filename template) |
| `⌘⇧M` | Download + copy markdown link |
| `⌘Enter` | Open destination picker |
| `⌘⇧Enter` | Pin to screen |
| `⌘+` / `⌘-` / `⌘0` / `⌘9` | Zoom in / out / 100% / fit |
| `Tab` | Cycle annotations on canvas |
| `Esc` | Return to the select tool |

#### S4 — Destination picker (modal)

**Rule: no bare letter is ever bound in this scope.** This is the permanent fix
for the `c` / `n` class of conflict, and it should be adopted in the PRD as a
constraint rather than a one-off patch.

| Key | Action |
|---|---|
| `1`–`5` | Fire destination *n* (digits are unambiguous here because the picker is modal and swallows S2/S3's colour digits) |
| `⌘C` | Copy image |
| `⌘S` | Download PNG |
| `⌘⇧M` | Download + copy markdown link |
| `⌘⇧Enter` | Pin to screen |
| `↑` / `↓` | Move selection |
| `Enter` | Ship to the selected row |
| `Esc` | Close; focus returns to the Ship button |

#### S5 — Library

| Key | Action |
|---|---|
| `j` / `k` / `↑` / `↓` | Move |
| `Enter` | Open in editor |
| `Space` | Peek (full-size preview; `Space` again dismisses) |
| `x` | Toggle row selection |
| `⌘A` | Select all |
| `⌫` | Delete (single-level undo strip) |
| `⌘Enter` | Re-ship to last destination |
| `⌘⇧Enter` | Pin selection to the active tab |
| `/` | Focus search |

#### S6 — A pin has focus (in-page)

Bare letters here are safe because they fire **only when the pin element itself
holds DOM focus**; the page's own inputs are never shadowed.

| Key | Action |
|---|---|
| `Arrows` | Move pin 1px |
| `⇧ + Arrows` | Move pin 10px |
| `⌥ + Arrows` | Resize (aspect locked) 1px; `⇧⌥` 10px |
| `X` | Toggle crop mode; while on, `⌥ + Arrows` crops the focused edge instead of scaling. Keeps cropping reachable without a pointer. |
| `+` / `-` | Scale ±10% |
| `0` | Reset to 100% (expands a collapsed chip) |
| `[` / `]` | Opacity −10% / +10% (floor 25%) |
| `G` | Toggle ghost mode (35% + click-through) |
| `Space` (hold) | Peek: 100% opacity and pointer events while held |
| `F` / `⇧F` | Bring to front / send to back |
| `Enter` | Enter the control bar; `Tab` walks its buttons, `Esc` exits back to the pin |
| `⌫` | Dismiss this pin (undo strip, `⌘Z`) |
| `Esc` | **Release focus back to the page. Does not dismiss.** |
| `Tab` | Leave the pin and continue the page's tab order — pins are never a focus trap |

#### S7 — Page has focus and pins exist (in-page)

All `⌥⇧` to stay clear of page and browser bindings.

| Key | Action |
|---|---|
| `⌥⇧1` … `⌥⇧8` | Focus pin *n* |
| `⌥⇧P` | Cycle focus through pins |
| `⌥⇧G` | Toggle ghost on every pin at once |
| `⌥⇧R` | Restore pins closed by the last navigation |
| `⌥⇧⌫` | Dismiss all pins (undo strip) |

#### Contested keys — explicit register

| Key | Conflict | Status |
|---|---|---|
| `R` | Region mode (S1/S2) vs Redact tool (S2/S3) — **a real collision**, both live in S2 | **Resolved: Redact moves to `K`.** Mode keys win because they are needed before anything else exists on the surface, and a tool key must never depend on which state you are in. `K` for "mask / black out". |
| `A` | Select-entire-viewport (S1/S2) vs Arrow tool (S2/S3) — **a real collision** | **Resolved: viewport-select moves to `⌘A`,** matching Library's `⌘A` and the platform meaning of select-all. |
| `C` / `N` | The double-binding the PRD is resolving between annotation tools and destination shortcuts | **Structurally removed.** `N` is the numbered-step tool and nothing else; `C` is not bound bare anywhere (copy is always `⌘C`). The picker uses digits plus modifiers only. **Recommendation to the PRD: adopt "no bare letters in the destination picker" as a rule, not a fix** — otherwise this collision returns the next time a service is added. |
| `M` | Magnifier (S1/S2) vs markdown-link (previously bare `M` in S4) | **Resolved: markdown link moves to `⌘⇧M`** under the picker's no-bare-letters rule. |
| `[` / `]` | Element parent/child (S1) · stroke weight (S2/S3) · pin opacity (S6) | **Not a collision** — the three scopes are mutually exclusive. **Flagged as the one to watch:** it is triple-loaded, so if any of those scopes ever overlap, this is the binding that breaks first. The hint bar always states the current meaning. |
| `F` | Full-page mode (S1/S2) vs bring-pin-to-front (S6) | **Not a collision** — S6 requires a focused pin, which requires the overlay to be closed. |
| `Space` | Move-selection (S2) · peek (S5, S6) | **Not a collision** — three exclusive scopes; the meaning is "temporarily show/move the thing under my hand" in all three, so the mnemonic is consistent. |
| `1`–`6` | Colour (S2/S3) vs destination (S4) | **Not a collision** — S4 is modal and swallows the scope beneath it. Noted because it *looks* like one in a flat list, which is exactly why this table is by scope. |
| `⌘⇧P` | Hotshot full-page capture (S0) vs other extensions | Contested outside our control; detected and surfaced in onboarding. |

**Commit ladder** — the one family worth memorising, and the reason pinning
needed no new letter:
`Enter` → editor · `⌘Enter` → ship · `⌘⇧Enter` → pin · `⌘⇧C` → copy.

**Settings and onboarding** use native `Tab` order in DOM order, with no custom
traps and no bare-letter bindings at all.

### 7.3 Focus treatment

`outline: 2px solid var(--hs-flare); outline-offset: 2px; border-radius: inherit`
on dark surfaces; `--hs-flare-ink` on light. Never `outline: none`.
`:focus-visible` governs, so pointer users don't see rings, but the ring is
*additionally* forced on for every element inside the capture overlay regardless
of input modality — during a capture the user genuinely needs to know where the
keyboard is, even mid-mouse-drag. Focus order is DOM order everywhere except the
overlay, where it is spatial (mode rail → selection → handles clockwise →
toolbar), which is documented in the hint bar.

At `prefers-contrast: more`, the ring goes to 3px and `--hs-g-700` dividers are
promoted to `--hs-g-500`.

### 7.4 Screen reader behaviour — capture overlay and pins

The overlay root is `role="application"` with
`aria-label="Hotshot capture overlay"` — deliberate, because the arrow keys are
remapped and a document-mode reader would fight us for them. Inside it:

- **On open**, an `aria-live="assertive"` region announces:
  *"Hotshot capture. Region mode. Drag or use arrow keys to select. Press R, F,
  E or D to change mode. Escape to cancel."*
- **A `aria-live="polite"` region carries the measurement**, throttled to one
  announcement per 400ms and only on a settled value (announced on
  `keyup`/`pointerup`, not during continuous motion, so it never floods):
  *"1024 by 576 at 844, 212."*
- **Mode change:** *"Element mode. Move the pointer or press Tab to walk the
  page. Left bracket for parent."*
- **Element mode hover** announces the resolved target from its own accessible
  name where one exists: *"Selected: figure, Invoice summary chart. 640 by 380."*
- **On commit:** *"Captured 1024 by 576. Opening editor."*
- **Toolbar** is a `role="toolbar"` with `aria-orientation`, roving tabindex,
  and each button `aria-pressed`. The active tool announces
  *"Numbered step, pressed."*
- **Magnifier** is `aria-hidden="true"` — it is purely optical and its
  information (coordinate, hex) is already in the polite live region on demand
  via `M`.
- **On cancel:** *"Capture cancelled."* Focus is restored to the element that
  held it before the overlay opened.
- The host page is `inert` while the overlay is open, so a reader cannot wander
  into content that is currently being framed.

**Pins — a different contract.** A pin coexists with a live page the user is
typing into, so unlike the overlay it must be maximally *quiet*:

- Each pin is a `role="group"` with `tabindex="0"` and
  `aria-label="Pinned capture 2 of 3. Invoice summary. 640 by 380. Enter for
  controls."` It is appended last in `document.body`, so it lands at the **end**
  of the page's tab order and never interrupts the form the user is filling in.
- **Pinning never moves focus.** Creating a pin announces once, politely:
  *"Pinned. Option Shift 2 to focus it."* Focus stays wherever it was. Stealing
  focus from a half-typed field to a decorative-by-default object would be the
  single worst thing this feature could do.
- **A pin is never a focus trap.** `Tab` from a focused pin continues the page's
  tab order. The control bar's buttons are reachable only after an explicit
  `Enter`, which creates a small deliberate sub-scope that `Esc` exits — so a
  screen reader user passing through with `Tab` encounters one stop per pin, not
  seven.
- Position, size and opacity changes announce politely and throttled to one per
  400ms on settle: *"Pin 2. 62 percent. 634 by 380."* Continuous drags do not
  announce.
- Ghost mode announces its consequence, because it is invisible otherwise:
  *"Pin 2 ghosted. Clicks pass through to the page. G to restore."*
- The pin's image carries the capture's stored description as `alt` where one
  exists, and `alt=""` otherwise — a screen reader is told the pin is there and
  what it is called, never given a fabricated description of pixels.
- **Navigation:** *"3 pins closed. Option Shift R to restore."* announced once,
  politely, on the new page. Dismissal: *"Pin 2 closed. Command Z to undo."*
- An orphaned pin announces its state in its label:
  *"Pinned capture 2. Image unavailable. Enter for controls."*
- `prefers-reduced-motion` removes the 120ms navigation fade; pins simply stop
  existing, and the restore strip carries the whole message.

Every announcement is a plain sentence; no `aria-label` in the product contains
a glyph, a shortcut symbol, or the word "button".

---

## 8. Anti-pattern audit

Honest self-check against the banned list in the brief.

| Banned pattern | Status | How |
|---|---|---|
| Purple/indigo → pink gradients | **Avoided outright** | There is no gradient anywhere in the product — not in a button, not in a header, not in a progress bar. The single accent is `#FF5A00`, an orange, used flat. The only non-flat fill in the system is the checkerboard behind image alpha, which is functional. |
| Glassmorphism | **Avoided, with a functional argument** | Every panel is opaque. `backdrop-filter: blur()` appears zero times. The one filter in the system is `grayscale(100%)` on the veil, which is a *legibility* device, not a material one — it removes information from the un-selected area rather than smearing it. |
| Inter + rounded-2xl + drop-shadow card soup | **Avoided** | Typeface is IBM Plex Sans / Mono, not Inter. Radius ceiling is 5px; the common case is 2–3px. Elevation is a hairline plus a ≤32px contact shadow used as a separator, and there are no floating cards on any surface — the Library is a table, Settings is a document with bordered service blocks, the popup is a list. |
| Emoji as iconography | **Avoided** | The icon set is a hand-specified 16px, 1.5px-stroke geometric system (§4). The ASCII glyphs in the wireframes above (`▣ ▤ ⌗ ◔`) are stand-ins for drawing, and §4 gives the real geometry for each. No emoji ships in any string, label, or empty state. |
| Centered gradient hero headline | **Avoided** | No surface in the product is centre-aligned. Onboarding is left-aligned at 26px — the largest type in the whole product — with the practice pane doing the work instead of a headline. The popup's wordmark is 11px in a corner. |
| Sparkle / "AI" motifs | **Avoided** | There is no AI in this product and nothing implies there is. "Smart element capture" is named for DOM awareness, and the copy in onboarding says exactly that; no wand, no star, no shimmer. |
| Friendly pastel palette | **Avoided** | The neutral ramp is a warm graphite that bottoms out at `#060605`, and the semantic colours are saturated signal colours (`#FF5A00`, `#C4321E`), not tints. Nothing in the palette sits in the pastel band (high lightness + low chroma). |
| Lazy brutalist black-and-white grid | **Avoided, but this is the one to watch** | *Borderline and worth naming.* The design is achromatic-plus-one-accent, hairline-bordered and square-cornered, which shares surface features with the brutalist cliché. The differences are deliberate and load-bearing: the neutral is warm, not pure black/white; the type is a humanist grotesque with a proper 9-step scale, not oversized Helvetica; borders carry real hierarchy (`g-700` divider vs `g-600` raised vs rule-pair on-page) rather than uniform 2px black; and the layout is dense and information-first rather than performatively empty. If it drifts, the tell will be borders all becoming the same weight — that is the thing to review. |
| Generic AI "product page" feel | **Avoided** | Every screen shows real data at real density: the Library is a 5-column table with monospace numerics, the editor has a live byte count, the picker shows the resolved last destination with its actual field values. |

**Pin-to-screen, audited against the same list.** A persistent floating panel
is exactly where glassmorphism and drop-shadow card soup normally arrive. This
one has no blur, no translucent panel material, no shadow beyond a 1px contact
line, no title bar, no rounded corners, and no accent colour at rest — its
entire resting chrome is 2px of black-and-white rule plus four 9px brackets. Its
one translucency is *content* opacity, which is a user-driven function
(see-through-to-the-form-beneath), not a material effect. The borderline call to
name: ghost mode plus a fully opaque frame is an unusual combination and could
read as a rendering bug on first encounter, which is why the one-time reminder
strip in §6.8 exists.

**One further self-criticism, offered rather than hidden:** IBM Plex is itself a
widely used open typeface, so it is not an exotic choice. It is defended on
fitness — it was drawn for technical documentation, its mono is genuinely good
at tabular figures, and it is licensable and bundleable with no runtime fetch —
rather than on rarity. If a licensed face is ever budgeted, the slot to replace
is Plex Sans; Plex Mono should stay, because the numerals are the product.

