# Hotshot — Shared Brief (source of truth for PRD + UI design)

## What
A Chrome extension (Manifest V3) for screen capture, annotation, and one-click
routing into Jira, Notion, and ClickUp.

## Hard constraints (non-negotiable)
1. **Zero reference to the Flameshot codebase.** Flameshot is GPL-3.0 and is a
   *conceptual* inspiration only (fast region select + an inline annotation
   toolbar that appears at the selection edge). No code, no assets, no icon
   shapes, no string copying. Everything is designed and built from scratch.
2. **No backend.** No server, no hosted service, no vendor OAuth apps.
   Integration auth is a user-supplied personal API token per service, stored
   in `chrome.storage.local`. Nothing leaves the user's machine except the
   direct HTTPS call to the service the user explicitly chose.
3. **Must not look AI-generated.** Explicitly forbidden: purple/indigo→pink
   gradients, generic glassmorphism, Inter+shadow+rounded-2xl card soup,
   emoji as iconography, centered hero layouts with a gradient headline,
   "Powered by AI" sparkle motifs. The UI must read as a *tool* — opinionated,
   dense where density helps, with a real point of view.
4. **Chrome MV3 reality**: service worker (no persistent background page),
   content scripts for the capture overlay, `chrome.tabs.captureVisibleTab`,
   `chrome.scripting`, `chrome.storage`, `offscreen` document for encoding.
   Minimum permissions. No `<all_urls>` if `activeTab` can do the job.

## Product decisions already made
- **Name**: Hotshot
- **Primary user**: general-purpose capture — anyone taking screenshots daily.
  Integrations are a strong secondary, not the wedge. Differentiation must
  therefore come from **speed and craft**, not from a niche workflow.
- **Auth**: user-supplied API tokens, v1. Connectors sit behind a shared
  `IntegrationProvider` interface so OAuth can drop in later untouched.
- **Capture modes (all four approved by the user)**:
  - Region drag-select
  - Full scrolling page (stitched)
  - Smart element capture (hover a DOM element, exact bounds highlight, click
    to capture) — this is the standout differentiator; a desktop tool
    structurally cannot do it because it has no DOM
  - Delayed capture (3/5/10s) for hover states and disappearing menus
  - Video/GIF recording — approved, but PHASE AS v1.1. v1.0 = still capture.

## Engineering standards (from the user's global CLAUDE.md)
- TypeScript strict, no `any`, `zod` for external input validation
- No file > 300 lines, no function > 50 lines
- One export per file for services/controllers/repositories
- Every change ships with unit tests
- Fail loudly, never swallow errors
- Security: no secrets in code, output encoding, explicit CORS/host allowlist

## What "unique" has to mean here
The market is crowded (Awesome Screenshot, GoFullPage, Nimbus, Loom). A prettier
clone loses. Differentiation must be defensible and concrete. Candidate angles
worth arguing for or killing:
- Smart element capture (DOM-aware — desktop tools cannot copy this)
- Keyboard-first operation: capture → annotate → ship without touching a mouse
- Auto-captured context (URL, page title, viewport, browser/OS) travelling with
  the image into the destination ticket/page
- Annotation primitives that are actually useful vs. decorative: numbered step
  badges, redaction/blur that is *destructive* (pixels gone, not CSS-blurred),
  auto-cropped callouts
- Destination routing that remembers: last project, last Notion DB, templated
  ticket titles

## Deliverable expectations
Both artifacts must be concrete and reviewable, not generic. Anything that could
be pasted into any other product's doc unchanged is a failure.
