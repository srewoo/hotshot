# Hotshot — Technical Architecture Design

**Date:** 2026-09-02 · **Status:** Draft for approval · **Scope decision:** full v1.0 (~44 engineer-weeks)

Companion documents, all binding:
- `docs/BRIEF.md` — hard constraints
- `docs/PRD.md` — FR-1..FR-44, budgets, integration specs
- `docs/DESIGN.md` — visual system, `§7.2` is the **normative keymap**
- `docs/reviews/PRD-review.md` — the hostile review this design answers

This document covers only what those three do not: **module boundaries, process
topology, data flow, and the test strategy**. It does not restate requirements.

---

## 1. The governing constraint

Hotshot is not one program. Manifest V3 forces the work across **three isolated
JavaScript realms** that share no memory and can only exchange structured-cloned
messages:

| Realm | Lifetime | Has DOM | Can reach the page | Holds |
|---|---|---|---|---|
| **Service worker** | Terminated after ~30 s idle | No | No | Orchestration, network, storage |
| **Content script** | Per-tab, dies on navigation | Yes (page's) | Yes | Overlay, annotation canvas, pins |
| **Offscreen document** | One per extension, we manage it | Yes (isolated) | No | Stitching, encoding |

Almost every hard bug in this product will come from a mistaken assumption about
which realm owns a piece of state. The architecture's primary job is to make
realm boundaries **explicit and typed** rather than implicit and discovered.

**Rule: the service worker owns no durable in-memory state.** It may be
terminated between any two events. Anything that must survive lives in
`chrome.storage.local` or IndexedDB, and is re-read on demand.

---

## 2. Process topology

```
   ┌──────────────────────────────────────────────────────────────┐
   │  chrome.commands / action click                              │
   └───────────────────────────┬──────────────────────────────────┘
                               │ (grants activeTab, this tab only)
                   ┌───────────▼────────────┐
                   │    SERVICE WORKER      │
                   │  capture-orchestrator  │
                   └──┬──────────┬──────────┘
        inject/RPC    │          │  captureVisibleTab (2/sec)
                      │          └──────────────┐
          ┌───────────▼──────────┐              │
          │   CONTENT SCRIPT     │              │
          │  ─ overlay (canvas)  │              │
          │  ─ element picker    │              │
          │  ─ annotation editor │              │
          │  ─ pin host (shadow) │              │
          │  ─ clipboard write ◄─┼── must be in-gesture, focused (FR-42)
          └───────────┬──────────┘              │
                      │ ImageBitmap / Blob      │
          ┌───────────▼─────────────────────────▼─────────┐
          │            OFFSCREEN DOCUMENT                 │
          │  ─ tile scheduler (owns the 500 ms cadence)   │
          │  ─ streaming PNG encoder (≤180 MB, FR-43)     │
          │  ─ JPEG re-encode / downscale (OQ-5)          │
          └───────────┬───────────────────────────────────┘
                      │ Blob
          ┌───────────▼───────────┐      ┌──────────────────┐
          │  integration layer    │─────►│ Jira/Notion/ClickUp │
          │  (IntegrationProvider)│      └──────────────────┘
          └───────────┬───────────┘
                      │
          ┌───────────▼───────────┐
          │  IndexedDB (history)  │  chrome.storage.local (settings, tokens)
          └───────────────────────┘
```

**Why the tile scheduler lives in the offscreen document, not the service
worker.** A 20,000 px stitch takes ~17 s (PRD §6). A service worker can be
terminated mid-operation; an offscreen document we keep alive cannot. The SW
starts the job and gets out of the way.

**Why clipboard lives in the content script.** Resolved in PRD B5: an offscreen
document can never take focus, so `navigator.clipboard` throws
`NotAllowedError`. The only reliable image-clipboard path is an in-gesture write
from a focused document — the page. This is the one place where the *page's*
realm is load-bearing for a non-UI reason.

---

## 3. Module boundaries

Per CLAUDE.md: no file > 300 lines, no function > 50, one export per file for
services. Directory layout:

```
src/
  manifest.config.ts          # typed manifest, single source of permissions
  shared/
    messaging/
      protocol.ts             # zod schemas for EVERY cross-realm message
      bus.ts                  # typed send/receive, no raw chrome.runtime calls
    geometry/
      device-rect.ts          # cssRect × zoom × dpr  (FR-40) — pure, heavily tested
      canvas-limits.ts        # per-axis + area caps, per-DPR max height (B4)
    model/                    # zod schemas + inferred types, no logic
      capture.ts  annotation.ts  destination.ts  settings.ts
    result.ts                 # Result<T,E>; no thrown errors across realms
  worker/
    index.ts                  # event wiring only
    capture-orchestrator.ts   # decides mode, grants, delegates
    restricted-page-guard.ts  # FR-30 three-layer surface
  content/
    overlay/
      overlay-host.ts         # closed shadow root, z-index containment
      selection-controller.ts # drag, 8 handles, move, clamp (FR-34/35)
      element-picker.ts       # DOM walk, [ / ], shadow DOM (FR-3)
      dimension-rule.ts       # the DIN mark (DESIGN §3.1)
      magnifier.ts            # 132×132 @12× off the frozen bitmap (B2)
      rule-pair.ts            # the 1px black + 1px white primitive
    annotate/
      command-list.ts         # undo as commands, NOT raster snapshots (FR-10)
      tools/                  # one file per tool; arrow line rect ellipse text
      redact.ts               # destructive; pixels overwritten (FR-9)
    pin/
      pin-host.ts  pin-controller.ts  pin-restore.ts   # FR-37/38
    clipboard.ts              # in-gesture, image/png (FR-42)
  offscreen/
    index.ts
    tile-scheduler.ts         # owns the 500 ms cadence; determinate progress
    stream-encoder.ts         # ≤2 resident tiles (FR-43)
    reencode.ts               # JPEG q0.9 / downscale above 8 MB (OQ-5)
  integrations/
    provider.ts               # interface only
    jira/    notion/    clickup/     # one dir each: client, schemas, mapper
    registry.ts
  storage/
    settings-repo.ts  token-repo.ts  history-repo.ts   # one export each
  ui/                         # Preact: popup, settings, library, editor chrome
```

**Framework decision.** Zero framework in `content/` — the overlay is
hand-written DOM + Canvas to hold the ≤120 KB content-script budget (PRD §6).
**Preact** (~3 KB) for `ui/` only: popup, settings, library. Two rendering
idioms is a real cost; it is paid because the budget is real and the surfaces
never share components.

**Build:** Vite + `@crxjs/vite-plugin`, TypeScript `strict`. Boring and proven,
per CLAUDE.md §0.

---

## 4. The three interfaces that matter

Everything else is detail. These three carry the architecture.

### 4.1 `MessageBus` — the realm boundary

Every cross-realm message is a zod-validated discriminated union in
`protocol.ts`. No module ever calls `chrome.runtime.sendMessage` directly.

```ts
type Envelope =
  | { kind: 'capture/begin';    mode: CaptureMode; tabId: number }
  | { kind: 'capture/tile';     index: number; total: number; bitmap: ImageBitmap }
  | { kind: 'capture/progress'; captured: number; total: number; etaMs: number }
  | { kind: 'capture/abort';    reason: AbortReason }   // keeps partial (FR-31)
  | { kind: 'ship/request';     provider: ProviderId; blob: Blob; meta: CaptureMeta }
  ...
```

Rationale: the reviewer found four keybinding collisions and a wrong-crop bug by
reading carefully. A typed, validated boundary finds that class of defect at
compile time instead.

### 4.2 `IntegrationProvider` — the OAuth seam

```ts
interface IntegrationProvider {
  readonly id: ProviderId
  testConnection(): Promise<Result<Identity, AuthError>>
  listTargets(): Promise<Result<Target[], ProviderError>>
  createItem(meta: CaptureMeta): Promise<Result<TargetRef, ProviderError>>
  attachImage(target: TargetRef, blob: Blob, meta: CaptureMeta): Promise<Result<ItemRef, ProviderError>>
}
```

v2's OAuth migration must touch **only** each provider's auth-header
construction. If a v2 change forces edits outside `integrations/*/client.ts`,
this interface was drawn wrong.

Every response body is `zod`-parsed before use. Notion's three-step upload
(create → send → patch) lives entirely inside `notion/client.ts`; the interface
above does not leak that it takes three round-trips.

### 4.3 `deviceRect` — the correctness kernel

```ts
// The single most defect-prone expression in the product (FR-40 / B8).
deviceRect = cssRect × chrome.tabs.getZoom(tabId) × devicePixelRatio
```

A pure function in `shared/geometry/device-rect.ts`, with both factors sampled
once at capture start and an abort if either changes mid-capture. It is pure
precisely so the 18-cell regression matrix (6 zoom × 3 DPR) can test it without
a browser.

---

## 5. Data flow: the two capture paths

**Region / element (single-shot).** Command → SW grants `activeTab`, injects
content script → CS builds overlay, requests ONE `captureVisibleTab` for the
frozen backdrop (this bitmap serves the magnifier *and* the crop, per B2) → user
selects → CS crops in `deviceRect` space → annotate → ship or pin.

**Full page (multi-shot).** Command → SW creates/reuses the offscreen document →
tile scheduler computes `total = ceil(scrollHeight / innerHeight)` and emits
determinate progress from tile zero → per tile: CS freezes `position: fixed`
elements, scrolls, waits ≤250 ms for lazy content, SW captures (throttled to one
per 500 ms), bitmap streams to the encoder → encoder writes PNG incrementally,
never materialising a full-height canvas → `Esc` stops **and keeps** the partial.

The 250 ms settle runs *inside* the 500 ms throttle gap (370 < 500), so it is
absorbed, not additive — the correction the PM made to the reviewer's arithmetic.

---

## 6. Failure model

Errors cross realms as `Result<T, E>`, never as thrown exceptions — a structured
clone loses an `Error`'s prototype and stack, so throwing across a realm
degrades to `"[object Object]"` at exactly the moment you need the detail.

Fail loudly (CLAUDE.md §1) has a specific meaning here:

| Situation | Behaviour |
|---|---|
| Zoom or DPR changes mid-capture | **Abort with a named error.** Never deliver a crop we cannot prove correct. |
| Page exceeds the per-DPR canvas cap | Refuse before starting, state the actual limit for this display. |
| Tile capture throttled | Expected; the scheduler is built on the throttle. Not an error path. |
| Stitch aborted by user | Keep the partial. Second `Esc` discards. |
| Ship fails | Capture stays in history; toast carries the HTTP status and the service's own message. |
| Pin cannot be positioned (ancestor `transform`/`contain`) | Refuse to pin, say why. Never render a broken pin. |

**Never logged, ever:** token values, and any response body that could echo one.

---

## 7. Test strategy

Every change ships with unit tests (CLAUDE.md §1). What matters most:

1. **Pure-function core, browser-free.** `device-rect`, `canvas-limits`, the
   filename sanitiser, the command-list undo model, and every zod schema are
   pure and tested in `vitest`. This is deliberate: the highest-severity defect
   found in review (wrong crop at 150% zoom) is a pure-arithmetic bug.
2. **The 18-cell zoom × DPR matrix**, asserting ±1 device px, plus a
   mixed-DPI abort case. A release gate, not a nice-to-have.
3. **Redaction is verified destructively**: decode the exported PNG and assert
   the redacted region's variance ≈ 0. A visual check cannot prove this.
4. **Element-capture fixture suite** — 25 real pages (Gmail, Salesforce, Figma
   web, a Datadog dashboard, a shadow-DOM design system) as a regression gate.
   This is the wedge; 80% reliability fails publicly.
5. **Memory regression test**: four full-page stitches pinned simultaneously,
   asserting the ≤180 MB encoder ceiling and the 64 MB/tab pin cap.
6. **Integration contract tests** against recorded fixtures, with zod failing
   loudly on schema drift. No live API calls in CI.

Playwright drives the extension for E2E; the three realms make traditional
unit-testing of orchestration low-value, so orchestration is tested end-to-end
and the *logic* is pushed down into pure modules that can be tested properly.

---

## 8. Build order

Sequenced so the riskiest unknowns resolve first and each stage is demoable.

| # | Stage | Resolves |
|---|---|---|
| 0 | Skeleton: manifest, build, typed bus, storage repos, CI | — |
| 1 | **`deviceRect` + canvas-limits + the 18-cell matrix** | The correctness kernel, before any UI depends on it |
| 2 | Region capture → crop → download | The whole pipeline end-to-end, thinnest possible |
| 3 | **Notion CORS spike (timeboxed, 3 days)** | R-1 — the largest schedule variance |
| 4 | Overlay: selection, handles, rule pair, dimension rule, magnifier | The 200/450 ms two-phase budget |
| 5 | **Element picker + fixture suite** | The wedge. If it fails here, §3 of the PRD is wrong |
| 6 | Annotation: command list, then tools | Undo model before tools, not after |
| 7 | Clipboard (in-gesture) + pin + restore | The zero-integration product is now complete |
| 8 | Offscreen: tile scheduler, streaming encoder, progress | Full-page |
| 9 | Integrations: Jira → ClickUp → Notion | Riskiest last, informed by stage 3 |
| 10 | Settings, library, onboarding | |

**Stage 3 is the checkpoint.** If the Notion spike fails, we revisit scope with
real information rather than estimates — which is the answer to the schedule
risk the full-scope decision accepted.

---

## 9. Decisions this document makes

1. Tile scheduler in the offscreen document, not the service worker.
2. Clipboard write in the content script, in-gesture. No offscreen fallback.
3. No framework in `content/`; Preact in `ui/` only.
4. `Result<T,E>` across realms; exceptions never cross a boundary.
5. Undo is a command list, not raster snapshots.
6. The PNG encoder streams; a full-height canvas is never materialised.
7. `DESIGN.md` §7.2 is the single normative keymap. The PRD records resolutions
   only. Duplicating the table is how the two documents drift apart.
8. Line/arrow constrain to **15°** — resolving the PRD/DESIGN divergence.
9. **zod does not enter the content script.** Discovered in build, not design:
   importing it to validate the three-field backdrop response cost 54 KB of the
   120 KB content-script budget (6.7 → 60.5 KB). `shared/messaging/backdrop.ts`
   validates by hand instead, keeping its full test suite as the equivalence
   proof. This is the single documented exception to "zod for all external
   input"; every other realm still uses zod, and `scripts/check-budget.mjs`
   fails the build if the content script crosses 120 KB again.

## 10. Open items carried in

Unchanged from the PRD, listed so the plan can schedule them: 16 `VERIFY`
markers (Jira `createmeta`, the `Notion-Version` pin, ClickUp's attachment size
limit, `openPopup()` availability, `execCommand` image-blob behaviour), plus
OQ-6 (should a pin survive a same-document SPA route change — leaning yes) and
OQ-7 (is 4 pins right, or is 2 enough).
