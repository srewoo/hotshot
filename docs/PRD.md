# Hotshot — Product Requirements Document

**Status:** Draft for review · **Owner:** Product · **Target:** v1.0 Chrome Web Store listing
**Source of truth:** `docs/BRIEF.md`. Where this document and the brief disagree, the brief wins.

---

## 1. Problem & positioning

### Who hurts

People who screenshot **many times a day inside a browser** and then have to do something with the result: a support engineer attaching evidence to a ticket, a QA analyst filing a repro, a designer marking up a staging build, a PM pasting a before/after into a spec. For them a screenshot is not the artifact — the *annotated, contextualised, delivered* screenshot is. Today the capture takes 1 second and the delivery takes 90.

### Why the incumbents fail

- **macOS Cmd-Shift-4 / Windows Snipping Tool** are the real competition — they are instant and always available. They fail at everything after the pixel: no scrolling capture, no numbered steps, no redaction that actually removes pixels, no destination. The file lands on the Desktop and the user then hunts for it in an upload dialog. Snipping Tool's editor is a toy; Preview markup is buried.
- **GoFullPage** does exactly one thing (full-page stitch) well and nothing else. No region select, no element capture, annotation is an afterthought behind a paywall, and the free tier watermarks nothing but also does nothing.
- **Awesome Screenshot** is the feature-complete option and has become bloated: a heavyweight extension that requests broad host permissions, pushes an account signup, and routes captures through its own cloud by default. It has repeatedly been the subject of privacy scrutiny for the breadth of what its content scripts can see. Its annotation UI is mouse-only and slow.
- **Nimbus Capture** is Awesome Screenshot with a heavier account gate. Its editor opens in a new tab, which destroys the fast path — you lose the page you were looking at.
- **Loom** is not a screenshot tool. It is video-first, cloud-mandatory, and the recipient gets a link, not an image. It is excellent at asynchronous explanation and useless for "put this PNG on ticket ABC-412".

The shared failure: **nobody has made the last mile fast.** Every one of these ends at "image on clipboard or disk." The user then switches app, finds the ticket, opens the attach dialog, retypes the URL they were on, and types a title.

### Positioning statement

**Hotshot is a keyboard-driven Chrome capture tool that takes a pixel-exact screenshot of any element on a page, lets you annotate and pin it without leaving the tab, and never sends a byte anywhere — no account, no server, no cloud. When you do have somewhere to put it, it files itself into Jira, Notion, or ClickUp with the URL already attached.**

Two sentences on purpose. The first is the product for everyone; the second is the upsell for the professional tail. Earlier drafts led with the integrations and were wrong to — see §4's fourth persona and the decision recorded in §3.

---

## 2. Competitive landscape

"Speed to first pixel" = keypress → capture UI usable. Measured, not claimed; incumbent figures are our own bench estimates on a mid-2021 M1 with 40 tabs open and should be re-measured before launch.

| | Speed to first pixel | Annotation quality | DOM awareness | Destination routing | Privacy / data handling | Price |
|---|---|---|---|---|---|---|
| **Hotshot** | ~200 ms p50 to overlay; ~450 ms to pixel-exact (§6, R-8) | Numbered steps, destructive redaction, arrows, callout crop — all keyboard-reachable | **Yes** — element hover with exact bounds; auto-context (URL/title/viewport/UA) | Jira, Notion, ClickUp direct; remembers last project/DB/list | No backend. Tokens in `chrome.storage.local`. `activeTab` only | Free |
| **Awesome Screenshot** | ~600 ms–1.5 s (popup + editor tab) | Broad toolset, mouse-only, dated | No | Own cloud, Slack, Trello, Jira (paid tiers) | Cloud-default, account required for most sharing, broad host permissions | Free tier; ~$5–8/user/mo |
| **GoFullPage** | ~400 ms, but full-page only | Minimal; editor is paid | Partial (scroll stitching only) | Download / Drive / print | No account for basic use; good posture | Free; ~$2–5/mo Pro |
| **Nimbus Capture** | ~800 ms–2 s (opens editor tab) | Good editor, heavy, mouse-first | No | Nimbus Note, Drive, Slack | Account gate, cloud-default | Free tier; ~$5/mo |
| **Loom** | ~2–4 s (recorder warm-up) | N/A (video), drawing only during record | No | Loom link only | Mandatory cloud, all media hosted by Loom | Free tier capped; $12.50–15/user/mo |
| **OS tools (Cmd-Shift-4 / Snipping Tool)** | **~50–100 ms — the benchmark** | Weak (Preview markup / Snipping Tool editor) | No — structurally impossible | None; file to disk | Perfect (fully local) | Free, bundled |

### Where Hotshot wins

1. **Privacy as a shipped property, not a policy page.** No backend means there is nothing to leak. This is deliberately first: it is the only claim here a well-funded incumbent **structurally cannot match**, because their business model requires the cloud. Awesome Screenshot and Nimbus cannot copy this without dismantling their revenue.
2. **Element capture.** A desktop tool cannot do it. It has no DOM. (Honest caveat added after review: the *80% version* — `elementFromPoint` + `getBoundingClientRect` + crop — is a sprint for a competitor. The last 20% — shadow DOM, CSS transforms, cross-origin iframes, canvas-rendered apps — is the hard part, and a competitor shipping the cheap version captures the demo without paying for the difficult part. R-7's "2–3 quarters" was generous to ourselves and has been corrected.)
3. **Pin-to-screen inside the page.** A pinned reference image lives *in the document*, so it can sit beside the very form the user is typing into and scroll-lock to the viewport. A desktop always-on-top window can float above the browser but cannot be positioned relative to page content, cannot be occluded correctly by page chrome, and is lost the moment the user alt-tabs. This is a real structural advantage of being an extension, and — critically — it is what makes the product *complete* for a user who never configures an integration (§4, Sam).
4. **Keyboard completeness.** Capture → annotate → ship without a mouse. Awesome Screenshot and Nimbus are mouse-first by construction. Honest limitation: this is a real moat but it is **invisible in a store listing**. It converts nobody at install time and only pays off around capture #50, by which point retention has already been decided. It is a retention weapon, not an acquisition one, and §9's targets are set accordingly.
5. **The last mile.** Nobody free-and-local routes to three issue trackers with auto-context. Ranked last on purpose: §9 forecasts that ~75% of active users will never configure an integration, so this is the claim that matters to the fewest people even though it is the most impressive on a slide.

### Where we lose, and accept it

- **Raw speed vs. the OS shortcut.** We are **2–4× slower** to a usable overlay than Cmd-Shift-4 (~200 ms vs ~50–100 ms), because `activeTab` forbids pre-injection and the service worker is cold on a p50 capture, and **4–9× slower** to a pixel-exact overlay because the magnifier and the frozen backdrop need a `captureVisibleTab` round-trip (FR-1, §6). We accept this; we win on what happens next, not on the first 60 ms.
- **Non-browser capture.** We cannot capture your terminal, Figma desktop, or a native dialog. If your work is outside Chrome, use the OS tool. We will say so in the store listing.
- **Video and async explanation.** Loom owns this. v1.1 adds short GIF/clip recording for bug repros; we are not building a video CMS, viewer analytics, or transcript search, ever.
- **Team features.** No shared libraries, no team billing, no admin console, no SSO. A single-user tool with no backend cannot offer these and we will not pretend otherwise.
- **Cross-browser.** Chrome/Chromium (incl. Edge, Arc, Brave) only. No Safari, no Firefox in v1.
- **Cloud-hosted links.** We produce files and attachments, not `hotshot.io/abc123` URLs. Users who want a shareable link should use their destination's own link.

---

## 3. Differentiation thesis

Five candidate wedges were on the table. Three survive.

### KEEP — Wedge 1: Smart element capture (DOM-aware)

The only wedge that is *structurally* uncopyable by the category leaders in desktop capture, and expensive for extension competitors to match well (exact bounds, sticky/fixed-element handling, shadow DOM, scrolled-out-of-view elements). It also produces objectively better output: a card, a modal, a table row captured at its exact box, at devicePixelRatio, with no eyeballed drag. This is the demo that sells the extension in eight seconds.

### KEEP — Wedge 2: Keyboard-first end-to-end

The full loop — hotkey, select, annotate, choose destination, ship — with zero mouse. This is a *craft* wedge: it is not hard to describe and it is very hard to retrofit into a mouse-first editor, which is what every incumbent has. It compounds with the brief's positioning ("speed and craft, not niche workflow") and it is the thing daily users will feel on capture #50.

### KEEP — Wedge 3: Auto-captured context that travels

URL, page title, viewport dimensions, devicePixelRatio, browser/OS, and capture timestamp attached to the destination automatically. Cheap to build, disproportionately valuable to the highest-intent segment (bug filing), and it is the reason the destination integration is more than a file upload. A ticket that arrives with the repro URL already in it saves a round-trip with the reporter.

### KILL — Wedge 4: "Annotation primitives that are actually useful"

Numbered step badges, destructive redaction, and callout crop **ship in v1.0** — they are table stakes for a credible editor and destructive redaction is a genuine correctness fix over CSS-blur. But they are **not a wedge**. Any competitor can add them in a sprint, and Awesome Screenshot already has most of them. Positioning the product on annotation features is a losing argument. They are FRs, not the thesis.

### KILL — Wedge 5: "Destination routing that remembers"

Remembering the last Jira project and Notion DB ships in v1.0 (FR-19) because not remembering is a bug. But "it remembers" is not a differentiator worth a line in the store listing — it is a two-day feature and every integration-having competitor either has it or will. Do not spend design or marketing budget defending it.

**The one-line thesis:** Hotshot wins because it is the only capture tool that understands the *page*, not just the pixels, and gets you from keypress to done without your hands leaving the keyboard — with nothing leaving your machine.

### Positioning decision (round 3) — we keep "general-purpose", option (b)

Review found a real contradiction: the brief names general-purpose capture as primary and says integrations are explicitly *not* the wedge, yet the previous positioning statement was ~90% integrations, all three personas were professional/technical, and §9 forecast that only ~25% of actives would ever configure a tracker — leaving ~75% of users with no persona, no flow, no metric, and no store-listing angle. The two ways out were (a) own the bug-filing professional openly and tell the user their "general-purpose" framing was wrong, or (b) keep general-purpose and actually write the missing 75%.

**Decision: (b), and it is not a close call.** Three reasons, in order of weight.

1. **The integration-free product is no longer a stub, and that is new information.** When the round-1 draft was written, a user with no token got "a PNG on the clipboard" — genuinely Cmd-Shift-4 with an install step, and (a) would have been the honest call. FR-37 (pin-to-screen) changed the arithmetic: element capture + destructive redaction + pin + clipboard is a complete daily tool that no OS shortcut offers. We should not overrule a stated user decision on the basis of a gap we have since closed.
2. **The wedges survive the reframe; only the *ordering* was wrong.** Element capture and keyboard speed serve Sam exactly as well as they serve Priya — better, since Sam captures more often. Only Wedge 3 (auto-context) is bug-filing-shaped, and it is the cheapest of the three. Reframing costs us one wedge's *emphasis*, not any wedge.
3. **Acquisition maths.** Integrations do not convert at install: they are a 90-second setup behind a token, and per §9 three-quarters of users never do it. Privacy and speed convert at install. Leading with Jira optimises the store listing for the smallest segment.

**What this changes, concretely:** §1's positioning statement now leads with capture and privacy and demotes integrations to a second sentence; §2's win order is re-ranked with privacy first and the last mile last; §4 gains Sam as the modal persona; §8 gains Sam's zero-config flow; §9 gains a zero-integration retention metric; and §10's cut line drops Notion and ClickUp from v1.0 without touching the thesis — which it could not have done under framing (a). The store-listing headline is **"Exact screenshots of anything on a page. Nothing leaves your machine."** — no tracker named above the fold.

**What would change our mind:** if the pre-registered decision rule in §9 shows element capture and pin going unused by the zero-integration cohort while integration-configured users are the only ones retaining, (b) is falsified and (a) is correct. That is a real test with a stated threshold, not a hedge.

---

## 4. Personas

**1. Priya — Support Engineer, B2B SaaS.** 30–50 captures/day. Lives in Jira and a customer's admin console.
*Moment of need:* A customer reports a broken invoice table. Priya reproduces it, needs the table — just the table, at exact bounds — with the customer's account ID visibly redacted, on the existing ticket, in the next 20 seconds while the customer waits on the call. Cares about: element capture, destructive redaction, Jira attach with URL.

**2. Marcus — QA Analyst.** 15–30 captures/day across staging environments.
*Moment of need:* A regression appears at step 4 of a 6-step flow. He needs a full-page stitch and a delayed capture of a hover-only tooltip that vanishes when he moves the mouse, both on a new ClickUp bug with the staging URL and viewport size recorded, because "works on my machine" is a viewport argument half the time. Cares about: full-page, delayed capture, auto-context, numbered steps.

**3. Dana — Product Designer / PM.** 5–15 captures/day.
*Moment of need:* Mid-review, she wants three annotated screens of a competitor's onboarding dropped into the Notion research page she has open in the next tab, with numbered callouts, before she loses the thread. Cares about: region select, numbered badges, Notion routing, history (she will want capture #2 again ten minutes later).

**4. Sam — the zero-integration daily user. THE MODAL USER.** 20–40 captures/day. Ops, finance, recruiting, teaching, or engineering — the common factor is that Sam screenshots constantly and pastes into Slack, Gmail, a doc, or a chat with a colleague. Sam will **never** connect a tracker: either there is no tracker, or IT owns the token policy, or it is simply not worth 90 seconds of setup. Per §9's own forecast, Sam is **~75% of active users.**
*Moment of need:* Sam is reading a dashboard and needs the revenue chart in Slack in the next fifteen seconds, with the customer name blacked out because the channel is wider than the deal team. Or: Sam is transcribing eleven values from a report into a spreadsheet in the next tab and keeps losing their place.
*Sam's complete loop, with zero configuration:* `Cmd+Shift+3` → element capture of the chart → `x` and drag to redact the customer name → `p` to pin it beside the spreadsheet, **or** `Enter` `c` to put it on the clipboard → `Cmd+V` in Slack. That loop touches no token, no network, and no account, and it is a genuinely complete product — which is only true since pin-to-screen (FR-37) landed. Before FR-37, Sam's product really was "Cmd-Shift-4 with extra steps," which is the criticism this persona exists to answer.
*Cares about:* element capture, destructive redaction, pin, clipboard, the 200 ms overlay, and the fact that nothing phones home.

Explicitly **not** a persona: the marketer making polished social images (Cleanshot/Shottr's job), and the educator recording a 12-minute walkthrough (Loom's job).

---

## 5. Functional requirements

Priorities: **P0** = blocks v1.0 launch. **P1** = v1.0 if schedule allows, else v1.1. **P2** = v1.1+.

### Capture modes

| ID | Requirement | Pri | Rationale |
|---|---|---|---|
| FR-1 | **Region drag-select, over a frozen backdrop.** Hotkey opens a full-viewport overlay in two phases. **Phase 1 (≤200 ms):** dimmer, crosshair, live px dimension readout — interactive and cancellable immediately, painted over the live page. **Phase 2 (≤450 ms):** a single `chrome.tabs.captureVisibleTab` completes and its bitmap is painted as the overlay backdrop, **freezing the page visually**; the magnifier hydrates from that bitmap and the readout switches from "approximate" to pixel-exact. Magnifier: **132×132 px at 12×** (adopting the design spec over this document's earlier "≥4×"), drawn with `imageSmoothingEnabled = false` and a 1-px centre reticle. The rect is editable per FR-34/FR-35 — never a one-shot commit. Enter confirms, Esc cancels. | P0 | Review correctly identified that a magnifier needs *page pixels*, which only `captureVisibleTab` can supply, and that a magnifier over a live page goes stale against animation, video, and scroll. The fix is not to cut the magnifier — it is to recognise that **we need that bitmap anyway** (it is the buffer the crop is cut from), so taking it eagerly at overlay-open costs one extra API call and buys three things at once: a correct magnifier, a frozen backdrop (what you see is literally what you get), and a capture of the page *as it was when the hotkey was pressed*, which is the disappearing-menu case FR-4 exists for. The cost is honest and now priced in §6 as a second, separate budget line rather than hidden inside the first. |
| FR-2 | **Full scrolling page (stitched).** Scroll-capture and stitch the full document height, freezing `position: fixed`/`sticky` elements after the first tile and re-enabling after. Must handle lazy-loaded images by pausing ≥250 ms per tile. | P0 | Table stakes; GoFullPage's entire business. |
| FR-3 | **Smart element capture.** Hovering highlights the nearest sensible DOM element with its exact border-box; `[`/`]` walk up/down the ancestor chain; click or Enter captures. Must resolve shadow-DOM hosts and iframe-embedded elements to the outer frame's coordinates or degrade gracefully to region select with a visible notice. | P0 | Wedge 1. Non-negotiable for launch. |
| FR-4 | **Delayed capture** at 3/5/10 s with a visible countdown in the toolbar badge, then auto-entering the mode chosen before the delay started. | P0 | Wedge for hover states/menus; trivial to build, high perceived value. |
| FR-5 | Element capture must correctly capture elements **taller than the viewport** by falling back to the scroll-and-stitch pipeline bounded to the element's box. | **P0** (promoted from P1 in round 3) | Review is right that this was incoherent: Priya's stated moment of need is a customer **invoice table**, which is routinely taller than the viewport, so the P0 persona's P0 job depended on a P1 requirement. Promotion is cheap — FR-2 already builds the scroll-and-stitch pipeline as P0, and bounding it to an element's box is roughly +0.5 engineer-weeks, not a new subsystem. Cheaper to promote than to weaken the persona. |
| FR-6 | All captures render at full device resolution — **`devicePixelRatio × browser zoom`**, never downscaled to CSS pixels and never assumed to equal DPR alone. See FR-40, which specifies the geometry contract this depends on. | P0 | A blurry screenshot is a broken screenshot; a *mis-cropped* one is worse. The previous wording said "DPR" and never mentioned zoom, which is under-specified enough that a literal implementation is silently wrong at any zoom ≠ 100% (FR-40). |
| FR-34 | **Selection resize and move (pointer).** The pending selection carries eight resize handles (4 corners, 4 edge midpoints); dragging a corner resizes both axes, an edge midpoint resizes one, and Shift-drag on a corner preserves aspect ratio. Dragging *inside* the rect moves it without resizing. Handles render as 8×8 px squares but carry a **24×24 px invisible hit target** (WCAG 2.2 §2.5.8, §6); on selections under 48 px in a dimension the handles move to the *outside* of the rect so they never overlap each other or occlude the content being framed. | P0 | Not a feature — a **bug fix**. Drag-to-create with no correction means one imprecise gesture forces a full restart, and at 30–50 captures/day that is the single largest tax the product could impose. Every incumbent has this; its absence would read as unfinished. |
| FR-35 | **Selection resize and move (keyboard) and edge behaviour.** Arrow = **move** 1 px; Shift+Arrow = move 10 px; **Alt/Option+Arrow = resize** the active edge by 1 px; Shift+Alt+Arrow = resize by 10 px. Tab cycles which edge/corner is the active resize anchor, announced to screen readers. A selection dragged past a viewport edge **clamps** to the viewport — it does not auto-scroll and does not silently truncate; the clamped edge flashes once so the limit is visible rather than mysterious. Resize/move remain available **after** entering annotation mode: re-entering selection mode (`s`, or Esc once from annotation) restores the handles and preserves all placed annotations, re-projecting their coordinates into the new rect and clipping any annotation that falls outside it with a warning toast naming how many were clipped. | P0 | Modifier split is the only unambiguous mapping given Arrow is already spent on move. Making resize available after annotation is the decision most tools get wrong: discovering you cropped 4 px too tight *after* placing five numbered badges must not cost the badges. Clamp-not-autoscroll because autoscroll during a drag is the classic source of accidental 8,000 px selections. |
| FR-40 | **Device-pixel geometry contract — browser zoom and DPR.** All capture geometry is computed in **device pixels** as `deviceRect = cssRect × zoom × devicePixelRatio`, where `zoom` is `chrome.tabs.getZoom(tabId)` and `devicePixelRatio` is read in the content script. Both factors are **sampled once at capture start** and carried through the whole operation. If either changes before the capture completes — the user zooms mid-capture, or the window is dragged between monitors of different scaling mid-stitch — the capture **aborts with a named error** ("Display scale changed during capture — nothing was saved, press the shortcut again") and no partial or mis-scaled image is ever presented. The zoom/DPR pair is recorded in the capture's metadata and in FR-17's auto-context. Regression gate: the R-3 fixture matrix gains zoom levels **{50, 67, 100, 150, 200, 300}%** × DPR **{1, 2, 3}**, asserting the crop is within ±1 device px of the expected rect at every combination, plus one mixed-DPI monitor case asserting the abort fires. | P0 | **The highest-severity functional defect found in review, and it was an omission rather than an error: browser zoom appeared nowhere in the previous document.** `captureVisibleTab` returns a bitmap at `zoom × DPR`, while `getBoundingClientRect()` and `innerWidth` return CSS px at the current zoom. Cropping one out of the other without the zoom factor produces a crop off by 50% in both position and size at 150% zoom — **a wrong crop presented to the user as correct**, which is precisely the failure R-3 declares unacceptable and which no user can detect until the screenshot is already in a ticket. An engineer implementing the old FR-6 literally would have shipped this bug. |
| FR-43 | **Canvas guard and streaming encode.** Before the first tile of any stitch, compute `W = viewportCSSWidth × zoom × DPR` and `H = docCSSHeight × zoom × DPR` and reject *up front* if `W > 65535`, `H > 65535`, or `W × H > AREA_CAP` (**VERIFY** the exact desktop area cap; ~268 M device px is the working figure and must be measured on the target Chrome floor, not assumed). Rejection is a named, actionable error stating the supported height for the user's current width/zoom/DPR — never a zero-sized or non-rendering canvas. Above the guard, offer the bounded alternatives: capture the viewport, capture an element, or reduce zoom. Below the guard, the stitch **never materialises one full-height canvas**: tiles are filtered and fed to a **streaming PNG encoder** that emits IDAT incrementally, holding ≈2 tiles plus the deflate window, so peak memory is independent of page height (§6). Images above **8 Mpx device** are export-only — the annotation editor is not offered for them, and the UI says so before the capture starts, not after. | P0 | Review is right that the round-2 guard was on the wrong dimension. A 30,000 **CSS** px guard misses both real Chrome limits: at DPR 3 it is 90,000 device px, over the 65,535 per-axis cap, and on an ordinary 2,560 CSS px-wide 27″ display at DPR 3 the **area** cap binds at ~11,650 CSS px — a perfectly normal long page. Exceeding either limit does not throw usefully; Chrome hands back a zero-sized or non-rendering canvas, i.e. exactly the silent failure FR-30 and CLAUDE.md's "fail loudly" forbid. Streaming encode is what makes the memory arithmetic close at all (§6); the 8 Mpx annotation ceiling is what keeps the undo stack in FR-10 affordable. |

### Annotation

| ID | Requirement | Pri | Rationale |
|---|---|---|---|
| FR-7 | Inline annotation toolbar appears at the selection edge without navigating away from the page. **v1.0 core set (P0): arrow, line, rectangle, numbered step badge, redact.** **v1.0 if schedule allows (P1): text, crop.** **v1.1 (P2): ellipse, freehand, highlight.** | P0 for the core five | Review's estimate correctly identifies a nine-tool hand-written canvas editor as "secretly the whole project" (~6 engineer-weeks), and it is right that the **text tool alone** is the sinkhole once IME composition, RTL, resize-on-edit, and caret hit-testing are real — which is why text is demoted to P1 and is the first thing out at the cut line (§10). The core five is the set a bug report, a Slack paste, and a redaction actually need; nothing in Sam's or Priya's loop uses an ellipse. |
| FR-8 | **Numbered step badges** auto-increment (1, 2, 3…) and renumber on delete. | P0 | The single most-used annotation in bug/how-to workflows. |
| FR-9 | **Destructive redaction**: the redact tool replaces the underlying pixels in the bitmap (solid fill or pixelate at ≥12 px blocks). The original pixels must not exist in the exported buffer or in history. | P0 | A CSS blur that can be un-blurred is a security incident. Testable: decode exported PNG, assert redacted region variance ≈ 0 (solid) or block-uniform (pixelate). |
| FR-10 | Every tool has a single-key shortcut; the complete, collision-checked binding table is **FR-44** and is normative — this row no longer defines keys. Undo/redo at Cmd/Ctrl+Z and Shift+Cmd/Ctrl+Z, **≥20 levels, implemented as a command list (vector operations replayed onto the baseline), not as ≥20 raster snapshots.** Destructive operations (FR-9 redaction, FR-12 crop) are the only ones that rasterise, and at most **3** destructive snapshots are retained; undoing past the oldest is refused with a named message rather than silently doing nothing. | P0 | Wedge 2. The command-list rule is a memory requirement disguised as a UX one: 20 raster snapshots of an 8 Mpx image is 640 MB and would have blown §6 by itself. Refusing a 4th destructive undo *loudly* is the CLAUDE.md-compliant behaviour; silently capping is not. |
| FR-11 | Colour and stroke weight are selectable from a fixed 6-colour palette (Digit1–Digit6) and 3 weights (BracketLeft/BracketRight). No colour picker in v1. **Cut-line fallback: 3 colours (red, yellow, near-black) and 1 weight** — see §10. | P1 | Colour pickers are a mouse tax. Six opinionated colours is a point of view. The counter-argument is stated fairly in §11 OQ-4. |
| FR-12 | **Callout crop**: crop to selection and optionally emit the cropped region as a second, separate image. | P2 | Nice, not load-bearing. |
| FR-36 | **Standalone line tool**, bound to **`L`** in scopes `S2`/`S3`, verified unique within those scopes by the exhaustive audit in `DESIGN.md` §7.2 (the `S2` bare-letter set is `A B D E F H K L M N P R T V` — 14 keys, all distinct). Distinct from arrow: no head, and it is the correct primitive for underlines, strike-throughs, table-column rules, and connecting two callouts without implying direction. **Shift-drag constrains both line and arrow to 15° increments** (0/15/30/45/…), snapping from the origin point — **flagged as an open divergence from `DESIGN.md` §7.2, which specifies 0/45/90°; see FR-44. Recommendation: 15° in both.** | P1 | An arrow is a *claim about direction*; using one where a plain rule is meant is noise. 15° rather than 45° because 45°-only snapping is useless for pointing at anything in a real UI, and unconstrained freehand lines are never straight. |

### Pin-to-screen

**Design decision: pinning is a post-capture *action*, not a destination.** Destinations (FR-13) are terminal — they consume the capture and close the overlay (FR-20). Pinning is explicitly non-terminal: the overwhelmingly common case is *pin the screenshot AND then ship it*, or *pin it and keep working*. Modelling pin as a fifth destination would force a false either/or, and the user who pinned would have to re-capture in order to also file the Jira ticket. So `p` pins from the annotation bar, the overlay stays open, and the destination row remains live underneath. A pin is also reachable *from* a shipped capture and from history (FR-25), which a destination could never be.

| ID | Requirement | Pri | Rationale |
|---|---|---|---|
| FR-37 | **Pin to screen.** `p` from the annotation toolbar (or `Cmd/Ctrl+Shift+P` on a history item) renders the finished capture — annotations flattened — as a draggable overlay injected into the current page at the top of the stacking context (`position: fixed`, `z-index` at the max 32-bit value, inside a **closed shadow root** so page CSS cannot restyle or read it). Because it is `position: fixed`, it **stays put through page scroll** and sits alongside the form the user is typing into. Affordances: drag anywhere on the image to move (snapping to viewport edges within 12 px); a bottom-right resize grip scaling 25–200% with aspect locked, `+`/`-` stepping 10% when focused; an opacity control cycling 100 / 75 / 50 / 25% via `o` or a scroll-wheel-with-Alt gesture, so the pin can be made translucent to read what is underneath rather than moved; a `↧` toggle to make the pin **click-through** (`pointer-events: none`) for when it must sit over an input, re-enabled from the toolbar popup. Dismiss: `Esc` while the pin is focused, the `×` in its corner, or "Dismiss all pins" from the popup. | P0 | The highest-value addition in this round. It converts the extension from a capture tool into a **reference** tool: transcribing values, diffing two states, and typing a bug report against a screenshot are all daily jobs currently done by alt-tabbing to Preview. The in-page advantage over a desktop always-on-top window is stated in §2 and is real, not marketing. Closed shadow root because an injected pin on a hostile page must not be scrapeable or restylable by that page. |
| FR-38 | **Pin lifecycle, multiplicity, and memory.** (a) **Navigation:** a pin **does not survive navigation within the tab** — any top-level document change (link click, `history.pushState` to a new path, reload, back/forward) destroys it, because the content script and its DOM are torn down with the document. We deliberately do **not** rehydrate pins after navigation: silently resurrecting an overlay on a page the user did not expect it on is worse than losing it. The loss is announced on the new page by a **6-second strip offering `⌥⇧R` to restore**, backed by genuinely Library-persisted state — not a toast that merely tells the user what they lost. This keeps the no-silent-resurrection rule (nothing reappears on a page the user did not expect it on) while converting the loss into **one keypress**, and it is strictly better than round 2's "reopen from History", which made the user go find it. The restore affordance is only honest if the state is actually there, which is why **FR-25 is a hard dependency of FR-37, not a nice-to-have** (see FR-25 and §10). Any pinned capture is therefore written to the Library for the lifetime of the pin plus the 6-second restore window, regardless of the FR-26 retention setting. Incognito remains excluded (FR-26): there the pin is simply gone, the strip is not offered, and the message says why. (b) **Tab close:** all pins in that tab are destroyed with no prompt and no persistence; a pin is tab-scoped state, never synced or written to `storage`. (c) **Multiple pins:** up to **4 simultaneous pins per tab**, cascade-offset 24 px on creation so a new pin never lands exactly on an existing one; clicking a pin raises it within the pin stack; a 5th pin attempt is refused with a named error offering to dismiss the oldest. Pins are per-tab, not global — the same capture may be pinned in two tabs and each is an independent instance. (d) **Memory:** each pin holds one decoded bitmap in the *tab's renderer* heap, capped at **2,000 px on the long edge** for display (the full-resolution blob stays compressed and is only re-decoded on re-ship), giving a worst case of ~16 MB per pin and a **hard 64 MB ceiling for all pins in a tab**. See §6 for how this interacts with the stitch budget. | P0 | The navigation rule is the honest one and must be written down, because "my pin vanished" will otherwise be a support theme. 4 is chosen from the memory cap, not from taste. Downscaling for display is what keeps a 20,000 px full-page stitch from being pinnable only by blowing up the tab. |

### Destinations & integrations

| ID | Requirement | Pri | Rationale |
|---|---|---|---|
| FR-13 | Destination bar offers: Copy to clipboard, Download PNG, Jira, Notion, ClickUp. It is a **modal picker (`S4`)** in which **no bare letter is bound** (FR-44 constraint (a)); rows fire on digits `1`–`5`, with `⌘C` copy, `⌘S` download, `⌘⇧M` markdown link, `⌘⇧Enter` pin, `↑`/`↓` + `Enter` for the selected row. Clipboard and download are **always present and never gated**; the destination bar renders even with zero tokens configured and never shows a nag, an upsell, or a disabled-with-lock row. Clipboard's mechanism is **FR-42** and is deliberately exempt from FR-20. | P0 | Clipboard and download must work with zero configuration — for Sam (§4) they *are* the product, and per §9 that is ~75% of users. |
| FR-14 | **Jira**: attach to an existing issue **selected from the picker in FR-41** (not by memorised key), or create a new issue in a remembered project with a templated summary. Auto-context appended to the description as ADF. | P0 | Priya's core loop. |
| FR-15 | **Notion**: append an image block to a chosen page, or create a new page in a remembered database with the image as the first block. | P0 | Dana's core loop. |
| FR-16 | **ClickUp**: attach to an existing task by ID, or create a task in a remembered list. | P0 | Marcus's core loop. |
| FR-17 | **Auto-context** — page URL, page title, viewport WxH, devicePixelRatio, user agent, ISO timestamp — is attached to the destination, and is individually toggleable in Settings (each field on by default except user agent). | P0 | Wedge 3. Per-field toggles because "user agent" is PII-adjacent in some orgs. |
| FR-18 | Ticket/page titles are generated from a user-editable template with tokens `{title}`, `{url}`, `{host}`, `{date}`, `{time}`. Default: `{title} — {date}`. | P1 | Removes the last typing step. |
| FR-19 | Last-used project / database / list per service is persisted and pre-selected. | P0 | Not remembering is a bug (see §3, killed as a *wedge*). |
| FR-20 | Ship is fire-and-forget: the overlay closes immediately, a toast reports success with a deep link to the created/updated item, or failure with the reason and a Retry action. | P0 | Blocking the user on a network call destroys the speed claim. |
| FR-39 | **Download filename template**, sharing FR-18's token vocabulary plus `{n}`: `{title}`, `{url}`, `{host}`, `{date}` (ISO `YYYY-MM-DD`), `{time}` (`HHMMSS`, 24h, local), `{n}` (per-day sequence counter, zero-padded to 3, resetting at local midnight). Invoked by `⌘S` (editor/picker). **Default: `{host}-{date}-{time}.png`** — e.g. `app-staging-acme-com-2026-09-02-142203.png`. Sanitisation, applied in this order and unit-tested as a pure function: (1) Unicode NFKC normalise; (2) replace `/ \\ : * ? " < > \|` and all C0/C1 control chars with `-`; (3) collapse runs of `-`/whitespace to a single `-` and trim leading/trailing `-` and `.`; (4) if the stem matches a Windows reserved device name (`CON`, `PRN`, `AUX`, `NUL`, `COM1-9`, `LPT1-9`, case-insensitive) prefix `_`; (5) truncate `{title}` to **64 chars** on a grapheme-cluster boundary, and the whole filename to **200 bytes** UTF-8 before the extension, preserving the `{n}` suffix if present; (6) if the result is empty, fall back to `hotshot-{date}-{time}`. Chrome's own download de-duplication (` (1)`) is left to handle true collisions — we do not implement our own. | P1 | `{title}` is the field that breaks things: page titles routinely contain `/`, `:`, `\|`, em-dashes and 180 characters of SEO. Defaulting to `{host}` rather than `{title}` because host+timestamp is stable, sorts correctly, and is what people actually search their Downloads folder by. Byte-truncation not char-truncation because the 255-byte limit on ext4/APFS is a byte limit. |
| FR-41 | **Target picker with type-ahead.** Every integration destination presents a searchable list of plausible targets, never a bare text field demanding a memorised identifier. Jira: recently-viewed and currently-assigned issues, then JQL type-ahead (**VERIFY** the current search endpoint — `/rest/api/3/search` has been deprecated in favour of `/rest/api/3/search/jql`; confirm before build). ClickUp: recent tasks in the remembered list. Notion: `POST /v1/search` results. Results are cached per token for 10 minutes and refreshed in the background; a stale cache never blocks the picker, which renders instantly from cache and updates in place. Raw-identifier entry remains available as an escape hatch for users who *do* know the key. | P0 | Review's catch: §8 counted "type or paste the key" as *(0 clicks)* while the flow banner claimed "0 app switches". In reality the user alt-tabs to Jira to find `ABC-412` — **an app switch in the middle of the flagship demo**, and the exact cost the flow claims to eliminate. Without a picker the central claim of the document is false. |
| FR-42 | **Clipboard write mechanism (image), and its exemption from FR-20.** The image clipboard write executes **in the content script, inside the user's activation gesture, while the page document is focused**, as `navigator.clipboard.write([new ClipboardItem({'image/png': blob})])`, and the overlay is **not** torn down until that promise settles. Clipboard is explicitly carved out of FR-20's fire-and-forget rule: it is not a network call, so the latency argument does not apply, and racing it against teardown loses the user's data silently. Bindings are `⌘⇧C` from the overlay (commit ladder) and `⌘C` from the editor or picker — never a bare letter (FR-44). Format is **always `image/png`** on this path regardless of §11 OQ-5's JPEG downscale policy, since `ClipboardItem` reliably carries only PNG. Acceptance tests: a page with an active `contenteditable`, a page that steals focus on `blur`, and a page with a `paste`/`copy` event listener. Documented degradation: if the in-gesture write throws, Hotshot **falls back to Download and says so in the toast** — a stated behaviour, never a discovered one. | P0 | See the mechanism note below the table. |

**Note on FR-42 — the offscreen-clipboard question, resolved.** Review asserted flatly that an image clipboard write is impossible from an offscreen document. That is *nearly* right and the nuance matters, so it is recorded rather than waved through. `chrome.offscreen` **does** define `Reason.CLIPBOARD`, and the Chrome documentation lists it without caveat — so the API surface suggests the offscreen path should work. It does not, for our case: `navigator.clipboard.*` requires a **focused document**, an offscreen document can never take focus, and the resulting `NotAllowedError: Document is not focused` is a long-standing, acknowledged limitation tracked publicly against both the Chrome extension docs and the samples repo. `Reason.CLIPBOARD` is therefore usable in practice only via the legacy `document.execCommand('copy')` path over a hidden `contenteditable`, which is workable for **text** and genuinely fragile for image blobs (**VERIFY** — do not build on it; if a spike shows `execCommand` reliably carries a PNG blob on our Chrome floor it becomes a fallback, never the primary). **Conclusion: the reviewer's mechanism is correct for images even though the premise about `Reason.CLIPBOARD` was too strong — the write happens in the content script, in-gesture, focused.** And the reviewer's downstream point stands regardless of mechanism and was the more damaging of the two: FR-20 tore the overlay down immediately, which races any clipboard write. FR-42 carves clipboard out of FR-20 explicitly.

### Settings & token management

| ID | Requirement | Pri | Rationale |
|---|---|---|---|
| FR-21 | Per-service token entry with a "Test connection" button that performs a read-only identity call and reports the authenticated account before saving. | P0 | Silent auth failure at ship time is the worst possible moment to discover a bad token. |
| FR-22 | Tokens are stored in `chrome.storage.local`, never `sync`, never logged, and are masked in the UI after save (last 4 chars only). A single "Revoke & delete" clears the token and all cached project/DB metadata for that service. | P0 | Brief constraint 2. `sync` would push tokens to Google's servers — an explicit violation of "nothing leaves the machine." |
| FR-23 | Host permissions for `*.atlassian.net`, `api.notion.com`, `api.clickup.com` are **optional permissions**, requested at token-setup time, not at install. | P0 | Install-time permission breadth is the main reason users distrust Awesome Screenshot. Also brief constraint 4. |
| FR-24 | Settings include: default capture mode, default destination, auto-context toggles, hotkey display (with a link to `chrome://extensions/shortcuts`), retention policy for history. | P1 | |

### History / library

| ID | Requirement | Pri | Rationale |
|---|---|---|---|
| FR-25 | Local Library of the last **20 captures** stored as blobs in IndexedDB, with thumbnail, source URL, timestamp, and destination outcome. Re-open in editor, re-ship (`⌘Enter`), pin to the active tab (`⌘⇧Enter`), or delete. **Priority is conditional and stated as a rule: FR-25 is P1 *in isolation* but becomes P0 the moment FR-37 ships**, because FR-38's `⌥⇧R` restore strip promises recoverable state and a promise backed by nothing is worse than no promise. If the Library is cut at the line (§10), it degrades to a **single-slot last-capture store** — enough to keep `⌥⇧R` honest — and the full 20-item Library moves to v1.1. | P1 → P0 with FR-37 | Dana's "I need capture #2 again"; Sam's pin-restore. 20 is chosen against the memory ceiling in §6. Writing the dependency down as a *rule* rather than a note is the point: round 2 called this "P1, may slip" while another P0 quietly depended on it. |
| FR-26 | History respects a user-set retention: session-only / 7 days / 30 days (default 7 days), with a one-click "Clear all". Captures taken in an Incognito window are never written to history. | P0 | Retention is a privacy promise, not a convenience feature; it ships with history but the Incognito rule ships regardless. |

### Keyboard model

| ID | Requirement | Pri | Rationale |
|---|---|---|---|
| FR-27 | Five registered commands per `DESIGN.md` §7.2 `S0` — `⌘⇧S` region, `⌘⇧P` full page, `⌘⇧E` element, `⌘⇧D` delayed, `⌘⇧U` open popup — but **Chrome permits at most four *suggested* key defaults**, so the four capture commands ship with defaults and `⌘⇧U` ships **registered but unbound**, with a one-click path to `chrome://extensions/shortcuts` in Settings. All five are user-rebindable. Onboarding detects a `⌘⇧P` clash with another extension and reports it rather than failing silently. | P0 | The four-suggested-key limit is a manifest constraint the design table cannot express; recording the resolution here keeps the two documents aligned. `⌘⇧U` being unbound is acceptable because FR-30's error surface never depends on the popup opening (badge and notification are layers 1 and 2). |
| FR-28 | Inside the overlay: `Tab` walks mode rail → selection → handles → toolbar; `Esc` disarms the current tool and, if none is armed, cancels the capture; `?` reveals the layout-aware cheat sheet. Commit is a **ladder, not a single key**: `Enter` → editor, `⌘Enter` → destination picker, `⌘⇧Enter` → pin, `⌘⇧C` → copy and close (FR-44). Pin focus cycling is `⌥⇧P` in scope `S7`; **`Cmd/Ctrl+Shift+P` is NOT used for pins** — it is full-page capture (FR-27), and round 2's assignment of it to pin focus was itself a collision, caught by the design audit. | P0 | Wedge 2. Esc-cancels-one-level rather than nuking the capture is the detail that earns trust. |
| FR-29 | The overlay must not swallow the page's own shortcuts once dismissed, and must restore focus to the previously focused element. | P0 | Fail loudly, leave nothing behind. |
| FR-44 | **The keymap is scope-partitioned and collision-checked. `DESIGN.md` §7.2 is the single normative source; this FR states the binding *constraints* and this document must not diverge from that table.** Eight scopes (`S0` Chrome commands, `S1` overlay-no-selection, `S2` overlay-selection-settled, `S3` editor, `S4` destination picker, `S5` library, `S6` pin-focused, `S7` page-focused-with-pins), with the collision rule stated formally: **two bindings collide only if they share a key *and* their scopes can be simultaneously live.** Four normative constraints: (a) **no bare letter is ever bound in the destination picker (`S4`)**; (b) **mode keys outrank tool keys** — a tool key must never depend on which state the surface is in; (c) every bare letter within a single scope is unique, verified exhaustively; (d) dispatch is on **`event.code`** (physical position), and the `?` cheat sheet renders the label the user's own keyboard prints via `navigator.keyboard.getLayoutMap()`, falling back to US labels. All bindings rebindable in Settings. | P0 | See the four resolved collisions below. Constraint (a) is the one worth arguing for: review found `c` and `n` double-bound and the obvious fix is to patch those two keys, but **a patch lets the collision return the moment a fourth destination is added — which v2 explicitly plans (Linear, GitHub Issues, Slack)**. Making "no bare letters in the picker" a rule rather than a fix means the destination list can grow without ever touching the keymap again. Constraint (b) is the same argument one level down: mode is needed before anything exists on the surface, so mode wins ties permanently. `event.code` because muscle memory is positional — `event.key` dispatch would move every tool to a different finger on AZERTY; `event.code` keeps the position and only changes the printed letter, which the layout map then displays correctly. |

#### FR-44 — adopted collision resolutions

The full by-scope table lives in `DESIGN.md` §7.2 and is not duplicated here; duplicating it is how two documents drift. What this PRD records is the set of **real collisions found and how they were resolved**, because those are product decisions, not visual ones.

| Key | Collision | Resolution |
|---|---|---|
| `R` | **Region mode vs. Redact tool** — genuinely simultaneous in `S2` | **Redact moves to `K`** ("mask"). Mode keys win: constraint (b). |
| `A` | **Select-entire-viewport vs. Arrow tool** — simultaneous in `S2` | **Viewport-select moves to `⌘A`**, matching the library's `⌘A` and the platform meaning of select-all. |
| `C` / `N` | Annotation tools vs. destination shortcuts — the pair review found | **Removed structurally, not patched.** `N` is the numbered-step tool and nothing else; `C` is never bound bare anywhere (copy is always `⌘C` / `⌘⇧C`). The picker is modal and uses digits plus modifiers only — constraint (a). |
| `M` | Magnifier vs. the picker's markdown-link action | **Markdown link moves to `⌘⇧M`**, under the same no-bare-letters rule. |

**Commit ladder — the one family worth memorising, and the reason pinning needed no new letter or `chrome.commands` slot:** `Enter` → editor · `⌘Enter` → ship · `⌘⇧Enter` → **pin** · `⌘⇧C` → copy. This supersedes round 2's `Cmd/Ctrl+Shift+P` pin-focus binding, which would have collided with `⌘⇧P` full-page capture; pin *focus cycling* is `⌥⇧P` in `S7`.

**Contested but not collisions — recorded so a future change does not silently break them.** `[` / `]` is **triple-loaded** across element-ancestor walk (`S1`), stroke weight (`S2`/`S3`) and pin opacity (`S6`); it is safe only because those three scopes are mutually exclusive, and it is **the binding that breaks first** if they ever overlap — any change that makes two of those scopes co-live must revisit `[`/`]` before anything else. The hint bar always states the current meaning. `⌘⇧P` is contested by software outside our control; onboarding detects the clash and reports it rather than failing silently. Digits `1`–`6` (colour) versus `1`–`5` (destination) look like a collision in a flat list and are not, because `S4` is modal and swallows the scope beneath it — which is exactly why the normative table is organised by scope rather than by key.

**One PRD-side constraint the design table cannot see:** `DESIGN.md` §7.2's `S0` lists **five** Chrome commands (`⌘⇧S`/`P`/`E`/`D`/`U`), but Chrome permits at most **four suggested key defaults** per extension. Resolution: the four capture commands ship with suggested defaults and **`⌘⇧U` (open popup) ships unbound**, with the settings panel offering one-click assignment via `chrome://extensions/shortcuts`. This is a manifest limit, not a design disagreement, and FR-27 is amended accordingly.

**One open divergence, flagged rather than silently reconciled:** this document specifies `⇧`-constrain on line and arrow at **15° increments** (FR-36); `DESIGN.md` §7.2 says **0/45/90°**. 45°-only snapping is close to useless for pointing at a real UI element, which is the entire job of the arrow tool. Recommendation: adopt 15° in both documents. **Owner: Design + Product, resolve before build; the two documents must not ship divergent.**

### Error states

| ID | Requirement | Pri | Rationale |
|---|---|---|---|
| FR-30 | Restricted pages (`chrome://`, Web Store, other extensions' pages, PDF viewer) must produce an explicit, named reason through a surface that **actually fires when the trigger was a keyboard command**. Three layers, in this order: (1) **always** — `chrome.action.setBadgeText("!")` with a red background plus `chrome.action.setTitle("Hotshot can't capture chrome:// pages")`, which needs no permission and cannot fail; (2) **primary** — a `chrome.notifications` toast carrying the full reason, if the `notifications` permission survives CWS review; (3) **persistent** — the popup, when the user opens it, shows the reason and the last blocked URL until dismissed. Badge and title clear on the next successful capture or after 10 s. `chrome.action.openPopup()` is **not** relied upon (**VERIFY**: generally available only from ~Chrome 127 and constrained in when it may be called; if it proves reliable on our floor it becomes a fourth, optional layer, never the only one). | P0 | Round-2 wording said "in the toolbar popup", which review correctly identified as a P0 error surface with **no delivery mechanism in the exact case it cites**: on a `chrome://` page there is no content script (no overlay, no toast), and a `chrome.commands` keypress does not open the popup. Specifying the reason and specifying no way to show it is worse than not specifying it, because it reads as done. |
| FR-31 | The 2-calls-per-second `captureVisibleTab` limit is the **design basis of the stitch scheduler, not an error condition**: the scheduler paces itself to one capture per 500 ms and therefore does not normally hit the quota at all. Quota *rejection* (which can still occur when another extension or another Hotshot tab is capturing concurrently) degrades: pause, retry with exponential backoff up to 3 attempts, and if still failing deliver the partial stitch with a visible "captured N of M tiles" banner rather than discarding work. Partial delivery is also the **normal** outcome for any page exceeding the FR-43 canvas guard. **Progress is determinate and user-interruptible**: tile count is computed from `scrollHeight / innerHeight` at tile zero and reported as `7 / 14 tiles` — never a percentage, never a spinner — alongside a running mean-based time estimate, and **`Esc` stops the stitch and keeps everything captured so far** rather than discarding it. Cancel is live from the first tile. | P0 | Review flagged a direct contradiction: §6 priced the stitch as if the quota were not binding while this FR treated exhaustion as routine. Both could not be true. Resolution: the quota is binding and is now *in the formula* (§6), which makes exhaustion genuinely exceptional — and partial delivery is promoted from error path to a documented normal path for oversized pages. The determinate-progress and stop-and-keep rules arrive from the design revision, which reached the same 5–7 s conclusion independently from the interaction side; they are **functional requirements, not visual ones** — "`Esc` discards" versus "`Esc` keeps" is a data-loss decision, and at 17 s for a long page an uninterruptible operation is unacceptable regardless of how the spinner looks. |
| FR-32 | Integration failures surface the HTTP status and the service's own error message, mapped to plain language for 401/403/404/413/429, with the image preserved in history so no capture is ever lost to a failed ship. | P0 | Never swallow errors (CLAUDE.md). |
| FR-33 | Offline / DNS failure produces a "queued locally, retry" toast; the capture stays in history. No background retry queue in v1. | P1 | Honest about what a serviceworker-only architecture can promise. |

---

## 6. Non-functional requirements

### Performance budgets

| Metric | Budget | Notes |
|---|---|---|
| Hotkey → overlay visible & interactive | **≤200 ms p50, ≤400 ms p95** (revised — see §11 OQ-1) | Pre-injection is **impossible** under `activeTab`, which is granted only *after* invocation. The budget is therefore the sum of: MV3 service-worker cold start (~50–100 ms, unavoidable and not under our control), `chrome.scripting.executeScript` of the ≤120 KB overlay chunk (~30–60 ms), and first paint (~20–40 ms). Warm-worker p50 should land near 120 ms; the published number assumes a cold worker, because that is the honest common case. |
| Pin render (capture confirmed → pin interactive) | ≤80 ms | Content script already resident at this point; no injection cost. |
| Overlay pixel-exact (frozen backdrop + magnifier live) | **≤450 ms p50, ≤700 ms p95** | Adds one `captureVisibleTab` round-trip (~50–200 ms on a large viewport) plus the SW hop. Priced as its own line rather than hidden inside row 1 — review's B2 was that FR-1's magnifier silently made row 1 unachievable. It no longer does, because the overlay is interactive and cancellable in phase 1 and only becomes pixel-exact in phase 2 (FR-1). |
| Region capture → annotation toolbar ready | ≤80 ms | The bitmap is already resident from phase 2; the crop is a `drawImage`. |
| Full-page stitch | **derived, not constant — see the formula below** | |
| Ship request initiated → toast | ≤2 s p50 for a 500 KB PNG on 20 Mbps | Network-bound; overlay already closed (FR-20). |
| Total extension bundle (unpacked, excl. source maps) | **≤450 KB**, content script chunk **≤120 KB** | No React in the content script. The overlay is hand-written DOM/Canvas. |
| Peak memory, streaming stitch (**any** page height) | **≤180 MB** — ≈2 resident tiles (2 × 16.4 MB at 2,560 device px × 1,600) + deflate window + compressed output buffer | Independent of page height **because FR-43 forbids materialising a full-height canvas.** Review's arithmetic was correct and fatal for the old row: 1,280 CSS px wide × 20,000 CSS px tall at DPR 2 is 2,560 × 40,000 = 102.4 M device px × 4 bytes = **409.6 MB for the backing store alone**, before tiles, `ImageData` copies, the undo stack, and the encode buffer — i.e. the old 350 MB budget was exceeded by ~20% at minimum and realistically 3× by the very case it named. Streaming encode is the only way the arithmetic closes. |
| Peak memory, annotation editor | **≤150 MB** — ≤8 Mpx device backing (32 MB) + ≤3 destructive snapshots (96 MB) + command list | Enforced by FR-43's 8 Mpx annotation ceiling and FR-10's command-list undo. Twenty raster undo snapshots would have been 640 MB on their own. |
| Pins, per tab | **≤64 MB total, ≤4 pins** (FR-38) | Pins live in the **tab's renderer process**; stitching runs in the **offscreen document**. Separate heaps, so the budgets are additive, not shared. Combined worst case (180 stitch + 150 editor + 64 pins + 10 history) ≈ **404 MB**, disclosed in the store listing's resource note. |
| History (FR-25) resident memory | **≤10 MB** | 20 captures are held in IndexedDB as compressed blobs; only the ≤160×120 thumbnails are decoded into memory. Full blobs are decoded on demand, one at a time, never eagerly. This is why 20 captures is affordable alongside 4 pins. |
| Idle memory (service worker asleep) | ~0; MV3 terminates it. No persistent timers. | |

#### Full-page stitch — derived from the documented throttle

`chrome.tabs.MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND` is **2**, so no scheduler can beat one capture per **500 ms**. FR-2's ≥250 ms lazy-load settle and the ~120 ms capture call both run **inside** that mandatory 500 ms gap (250 + 120 = 370 < 500), so settle is *absorbed*, not additive — this is where our numbers differ from review's, which added them and arrived at 8–10 s for an 8k page. The correction is in our favour and is still ~2× worse than the round-2 budget:

> `T ≈ tiles × 500 ms + encode`, where `tiles = ceil((docHeight − viewportHeight) / (viewportHeight − 60 px overlap)) + 1`

Reference pages at an 800 px viewport, published here **and in the store listing** so users are not surprised:

| Page height | Tiles | Predicted p50 | Round-2 claim |
|---|---|---|---|
| 2,000 px | 3 | **~2 s** | — |
| 8,000 px | 11 | **~7 s** | ~~4 s~~ (off by ~1.8×) |
| 20,000 px | 27 | **~17 s** | — |

Two consequences. First, a 20 s progress bar is a UI requirement, not a nicety: the stitch UI must show tile *N* of *M* with a working cancel from the first tile. Second, a 27-tile stitch at ~17 s sits close enough to the service worker's ~30 s idle termination that **the stitch orchestrator lives in the offscreen document, not the service worker**, with per-tile progress checkpointed to IndexedDB so a termination mid-stitch resumes rather than restarts.

#### Canvas guard — maximum supported page height (FR-43)

Guarding on CSS pixels was wrong. Guarding on device pixels against **both** the per-axis cap (65,535) and the area cap (~268 M device px, **VERIFY**) yields real limits that vary with window width and DPR — and the old 30,000 CSS px guard was wrong in both directions:

| Viewport width (CSS) | DPR | Binding cap | **Max page height (CSS px)** |
|---|---|---|---|
| 1,280 | 1 | per-axis | 65,535 |
| 1,280 | 2 | per-axis | 32,767 |
| 1,280 | 3 | per-axis | 21,845 |
| 2,560 | 1 | per-axis | 65,535 |
| 2,560 | 2 | **area** | **26,214** |
| 2,560 | 3 | **area** | **11,650** |

The last row is the one that matters: on an ordinary 2,560 CSS px-wide 27″ display at DPR 3, the ceiling is **11,650 CSS px** — a normal long article — and the round-2 guard would not have fired until 30,000, handing the user a silently non-rendering canvas. All figures assume zoom = 1 and scale by `1/zoom`.

### Privacy guarantees

1. No backend, no analytics endpoint, no crash reporter, no CDN fetch at runtime, **and no `chrome.runtime.setUninstallURL`**. All assets bundled. The uninstall survey proposed in round 2 is **deleted**: `setUninstallURL` fires an HTTP GET to a host we would have to operate, carrying the extension ID — a fourth outbound host and an analytics endpoint by any honest definition, contradicting this clause, clause 6, and the brief's no-backend rule. §9 has been re-derived from what remains. We would rather measure less than qualify the privacy claim.
2. Network egress is restricted by CSP and `host_permissions` to exactly three hosts, and only after the user has added that service's token.
3. Tokens in `chrome.storage.local` only. Never in `storage.sync`, never in a log line, never in an error message body.
4. `activeTab` + `scripting` as the base permission set; `<all_urls>` is not requested. Optional host permissions requested contextually (FR-23).
5. Image bytes never touch disk except via the user's own Download action or IndexedDB history, which the user controls (FR-26).
6. The privacy claim is verifiable: the store listing links to the repo and states that a reviewer can confirm zero outbound hosts beyond the three.

### Accessibility (WCAG 2.2 AA)

- Every function reachable by keyboard (FR-10, FR-27, FR-28); no keyboard trap — Esc always exits.
- The capture overlay is `role="application"` with `aria-label="Hotshot capture overlay"`, and announces mode changes and selection dimensions via a polite live region ("Region selected, 640 by 480"). Element mode announces the hovered element's tag and accessible name.
- Screen reader users are given element-capture as the *primary* path, since drag-select is inherently visual — this is a real accessibility advantage of Wedge 1 and should be documented.
- Contrast ≥4.5:1 for all overlay chrome against both light and dark page content; the overlay dims the page to guarantee it. Focus indicators ≥3:1 and ≥2 px.
- Respects `prefers-reduced-motion` (no overlay fade, no toast slide).
- Target size ≥24×24 CSS px for all toolbar controls **and for the eight selection-resize handles (FR-34)** — the handles are drawn at 8×8 px for visual precision but carry a 24×24 px transparent hit area, which is the WCAG 2.2 §2.5.8 conformant pattern (the *target* is what is measured, not the ink). Where two 24 px targets would overlap on a small selection, the handles relocate outside the rect rather than shrink.
- A **pin (FR-37)** is a focusable `role="dialog"` with `aria-label="Pinned screenshot, <capture title>"` and `aria-describedby` pointing at its dimensions. It is reachable via the `⌥⇧P` focus cycle and `⌥⇧1`…`⌥⇧8` direct-focus bindings (scope `S7`, FR-44) rather than being inserted into the page's natural tab order, so it never interrupts the user's progress through the form it is sitting next to — the pin must be a reference, not an obstacle. Once focused, `Tab` **leaves** the pin and continues the page's tab order: a pin is never a focus trap, and `Esc` releases focus back to the page without dismissing. Its ghost/click-through mode sets `aria-hidden="true"` to match its visual and pointer inertness.
- Selection resize/move announces the new rect to the live region on each committed change ("Selection 640 by 480, moved right 10 pixels"), throttled to 400 ms so keyboard repeat does not flood the screen reader.

### Browser & permission constraints

- **Chrome/Chromium ≥ 116**, Manifest V3. `chrome.offscreen` itself shipped in **109**; the 116 floor is set by **`chrome.runtime.getContexts()`**, which we use to manage the single-offscreen-document lifecycle below. Naming the real reason rather than misattributing it to offscreen, per review.
- **Exactly one offscreen document exists per extension**, and three things contend for it: a long stitch, an encode, and a second capture fired before the first finishes. Design rule: a single **offscreen lifecycle owner** in the service worker serialises all offscreen work through a FIFO queue, checks liveness with `getContexts()` before every `createDocument()`, and refuses a second concurrent stitch with a named error rather than queueing it invisibly behind a 17 s operation.
- Service worker is non-persistent: all state that must survive termination lives in `chrome.storage.local` or IndexedDB. No in-memory globals relied upon across events. **The stitch orchestrator lives in the offscreen document, not the SW**, with per-tile checkpoints (see the stitch derivation above).
- Cannot capture: `chrome://*`, Chrome Web Store, other extensions' pages, the built-in PDF viewer, or cross-origin iframes' internals (FR-30).
- **`activeTab` does not extend to cross-origin frames.** FR-3's promise to resolve iframe-embedded elements is therefore **narrowed**: same-origin frames are supported; cross-origin frames degrade to region select with the visible notice FR-3 already mandates. Reaching into cross-origin frames would need `all_frames` injection under host permissions, which we decline for the reasons in §2. This is a scope reduction to FR-3, recorded rather than discovered at build time.
- **Incognito:** the manifest declares `"incognito": "split"`. Extensions do not run in Incognito unless the user enables it, and in the default `spanning` mode the *same* IndexedDB is shared with the normal profile — which would silently break FR-26's promise that Incognito captures are never written to history. `split` is the only setting under which that promise is true.
- **Restrictive-CSP and Trusted-Types pages.** Content-script *execution* is exempt from page CSP, but `blob:` URLs the overlay creates live in the page origin and **are** subject to the page's `img-src`; a page with `img-src 'self'` breaks the preview. Pages with `require-trusted-types-for 'script'` break `innerHTML`. Mitigation is already the FR-37 pattern: closed shadow root, `adoptedStyleSheets`, **no `innerHTML` anywhere in the content script**, and canvas/`ImageBitmap` rather than `blob:` `<img>` for previews. Both cases join the R-3 fixture suite.
- MV3 background fetches to hosts in `host_permissions` are not subject to page CORS — this is what makes a serverless integration possible at all, and must be tested per-service (see §7).
- **Complete permission list**, each needing a written CWS justification before submission (R-6): `activeTab`, `scripting`, `storage`, `offscreen`, `commands`, `notifications` (FR-30), `downloads` (FR-39), `unlimitedStorage` (FR-25's 20 blobs), and **optional** host permissions per service. `clipboardWrite` is **not** required — FR-42 writes from the content script inside a user gesture, which the page context already permits. `<all_urls>` is never requested. Per review, `*.atlassian.net` is **not** requested as a wildcard: the token-setup flow asks for the site subdomain and requests `https://{site}.atlassian.net/*` as a runtime-specific optional permission, which is both narrower and far less likely to stall CWS review.
- **CWS single-purpose policy.** "Capture + annotate + route to third-party SaaS" can be read as multi-purpose and is a real rejection vector. The single-purpose statement is drafted now, not at submission: *"Hotshot captures images of web pages. Annotation and sending the captured image to a destination are part of capturing it; the extension does nothing unrelated to producing a screenshot."*
- **i18n position for v1: English only, no RTL overlay layout** — but all ~40 user-facing strings (FR-30..FR-33, onboarding, settings) are externalised into a message catalogue from the first commit, and FR-44's cheat sheet is already layout-aware. Stated explicitly rather than left as an omission; retrofitting externalisation later is the expensive half.

---

## 7. Integration specifications

Everything below is stated as verified or explicitly marked **VERIFY**. Nothing is invented.

### 7.1 Jira Cloud

- **Attach image:** `POST https://{site}.atlassian.net/rest/api/3/issue/{issueIdOrKey}/attachments`
  - `Authorization: Basic base64(<account-email>:<api-token>)`
  - `X-Atlassian-Token: no-check` — **required**; the request is rejected as XSRF without it.
  - `Content-Type: multipart/form-data`, single field named **`file`**.
- **Create issue:** `POST /rest/api/3/issue` with an ADF (Atlassian Document Format) `description`. Auto-context is emitted as an ADF `paragraph` + `link` marks, not raw markdown — the v3 API does not accept wiki markup in `description`.
- **Project list:** `GET /rest/api/3/project/search`. **Issue type metadata:** `GET /rest/api/3/issue/createmeta` — **VERIFY**: `createmeta` has been progressively deprecated in favour of `/rest/api/3/issue/createmeta/{projectIdOrKey}/issuetypes`; confirm which is current before implementation.
- **Identity check (FR-21):** `GET /rest/api/3/myself`.
- **Token scopes:** an Atlassian *API token* is not scoped — it carries the full permissions of the user account. There is no way to narrow it. This must be stated plainly in the token-setup UI. (Granular OAuth scopes `write:attachment:jira` / `write:issue:jira` apply only to the v2 OAuth flow deferred to §10 — **VERIFY** exact scope strings at that time.)
- **Failure modes:** 401 bad token/email pair · 403 no attach permission on the project, or attachments disabled site-wide · 404 issue key wrong or invisible to the user · 413 over the site's attachment size limit (site-configurable, commonly 10 MB) · 429 rate limited, honour `Retry-After`.

### 7.2 Notion

**The honest constraint:** for most of the public API's life, Notion did **not** accept raw file uploads — you could only reference an externally hosted URL, which for a no-backend extension meant there was nowhere to host the image. That has changed: Notion now ships a **File Upload API**, and it is a **three-step** flow, not a single multipart POST like Jira's.

1. `POST https://api.notion.com/v1/file_uploads` with body `{}` → returns `id` and `upload_url`.
2. `POST https://api.notion.com/v1/file_uploads/{id}/send`, `Content-Type: multipart/form-data`, field **`file`**.
3. Attach by referencing the upload id: `PATCH /v1/blocks/{block_id}/children` with an `image` block of type `file_upload`, or `PATCH /v1/pages/{page_id}` for cover/icon/file properties.

- **Headers on all calls:** `Authorization: Bearer <ntn_… integration token>`, `Notion-Version: <pinned version string>`. **VERIFY** the exact `Notion-Version` value to pin at implementation time — the docs currently surface `2026-03-11`; pin one version and treat a version bump as a deliberate, tested change.
- **Limits:** 20 MB for the single-part path. Larger files require a multi-part upload flow — out of scope; we will hard-cap PNG export at 20 MB and warn (a Hotshot PNG should never approach this).
- **Expiry:** an uploaded file expires in **1 hour** if never attached. Our flow attaches within seconds, but the error path must handle an expired id rather than retrying blindly.
- **Permissions:** a Notion internal integration has no granular scopes in the OAuth sense; it has capabilities (read/update/insert content) and, critically, **must be explicitly shared into each page or database by the user**. The single biggest support burden here is "404 — I forgot to invite the integration." The token-setup flow must state this in plain language and the 404 handler must say exactly this, not "not found."
- **Discovery:** `POST /v1/search` filtered to `database` / `page` for the destination picker.
- **Failure modes:** 401 bad token · 404 integration not shared with the target (see above) · 400 malformed block payload or expired `file_upload` id · 429 rate limited (Notion averages ~3 requests/second per integration — our 3-step flow costs 3 of them, which is fine for human-paced capture but must not be parallelised).
- **VERIFY:** browser-context CORS behaviour of `api.notion.com`. We expect MV3 `host_permissions` background fetches to bypass it; this must be proven with a spike before we commit Notion to v1.0 P0.

### 7.3 ClickUp

- **Attach image:** `POST https://api.clickup.com/api/v2/task/{task_id}/attachment`
  - `Authorization: <pk_… personal token>` — note: **no `Bearer` prefix** for personal tokens; the OAuth flow uses `Bearer <access_token>`.
  - `Content-Type: multipart/form-data`, field named **`attachment`**.
  - Optional query params `custom_task_ids=true` & `team_id={workspace_id}` when addressing a task by its custom ID.
- **Create task:** `POST /api/v2/list/{list_id}/task`, then attach in a second call. There is no create-with-attachment single call.
- **Discovery:** `GET /api/v2/team` → `GET /api/v2/team/{team_id}/space` → `/space/{space_id}/list` (plus folders). This is a 3–4 call chain; cache the result per token and refresh on demand, not per capture.
- **Identity check (FR-21):** `GET /api/v2/user`.
- **Token scopes:** a ClickUp personal API token is **unscoped** and carries full account permissions, same caveat as Jira. State it in the UI.
- **Attachment size limit:** **VERIFY** — not stated in the reference documentation we consulted. Do not assert a number in the UI until measured.
- **Failure modes:** 401 `OAUTH_017`-family invalid token · 404 task/list id wrong or not visible to the token owner · 400 malformed multipart · 429 rate limited (ClickUp publishes per-plan rate limits; honour `X-RateLimit-Reset`).

### 7.4 Shared contract

All three sit behind one `IntegrationProvider` interface: `testConnection()`, `listTargets()`, `createItem(meta)`, `attachImage(targetId, blob, meta)`. Every response body is validated with `zod` before use — external input is never trusted (CLAUDE.md §2). OAuth in v2 replaces only the auth header construction.

---

## 8. User flows

### Sam's flow — the modal user, zero configuration (listed first on purpose)

Per §9 this is ~75% of active users, and until round 3 the document did not contain it.

1. `⌘⇧E`. Overlay in ≤200 ms; pixel-exact at ≤450 ms. *(0 clicks)*
2. Hover the chart; exact bounds highlight. **Enter.** *(0 clicks)*
3. `k`, drag over the customer name — pixels destroyed, not blurred (FR-9). *(1 drag)*
4. `⌘⇧C` — clipboard, in-gesture, before teardown (FR-42). *(0 clicks)*
5. `Cmd+V` in Slack.

**3 interactions, ~7 seconds, no token, no account, no network call.** The reference variant substitutes step 4 with `⌘⇧Enter` (FR-37): the chart pins beside the spreadsheet and stays there through scroll while Sam transcribes. There is no OS shortcut and no incumbent extension that does either of these in three interactions.

### Priya's flow — hotkey → capture → annotate → ship

1. `⌘⇧E` (element mode). Overlay in ≤200 ms; frozen and pixel-exact at ≤450 ms. *(0 clicks)*
2. Hover the invoice table; exact bounds highlight, and because it is taller than the viewport the bounded stitch path runs (FR-5, **P0 as of round 3** — this flow previously depended on a P1 requirement). `[` / `]` adjusts the ancestor level. **Click or Enter.** *(1 click)*
3. Annotation toolbar at the selection edge; selection handles stay live, so a 4 px-tight crop is fixed with `Alt+→` rather than restarted (FR-35). `n`, then three clicks to place badges; `k`, then drag over the account ID. *(4 mouse actions)*
4. **`⌘Enter`** → destination picker (FR-44 commit ladder). The picker (FR-41) opens on recently-viewed and assigned issues with the remembered project and a templated title pre-filled; type two characters, arrow to the issue. *(0 clicks, 0 app switches)*
5. **Enter.** Overlay closes; toast confirms with a link to the issue. *(0 clicks)*

**Honest count: ~8 interactions (1 click + 4 mouse actions + 3 keystroke groups), ~18 seconds.** Round 2 banner-claimed "1 click, ≤10 s", which review correctly showed was contradicted by step 3 of its own flow — placing three badges is three clicks before anything else. The honest number still wins the argument decisively: the incumbent path is ~8 clicks **plus two app switches and a file-picker round-trip**, and measures 60–90 s. We were inflating a number we did not need to inflate, in the one flow that carries the product's central claim, in a document whose whole credibility rests on not doing that.

Two dependencies that round 2 hid and this round fixes: step 2 needed FR-5 (was P1 → now P0), and step 4 needed an issue picker that did not exist in any FR (now FR-41, P0) — without it the user alt-tabs to Jira to find the key, which is the app switch the flow claims to eliminate.

**Variant — pin while working.** At step 3, press `⌘⇧Enter` instead. The capture becomes a fixed overlay (FR-37) and the annotation bar **stays open**, so the user can pin *and* continue to step 4 in the same breath. This is the concrete reason pinning is an action and not a destination (§5, Pin-to-screen). Typical use: pin the error state, then type the bug report into the ticket form on the same page with the evidence sitting beside the textarea — no alt-tab, no second monitor.

**Pure-keyboard variant:** element chosen with `[`/`]` from the focused element, badges placed at the reticle with `Enter`, redaction sized with `Alt+Arrow` — **0 clicks, ~11 keystrokes, 0 app switches.** This is the version that justifies Wedge 2, and it is the honest ceiling of the claim.

### First run / onboarding

On install, one tab opens with a **live interactive sandbox page**, not a video. Three steps, each completed by actually doing it:
1. "Press `⌘⇧S` and drag a box." — succeeds on the onboarding page itself; also the moment we detect and report a shortcut clash with another extension (FR-27).
2. "Press `⌘⇧E` and hover a card." — teaches the wedge in ten seconds.
3. "Choose where captures go." — offers Clipboard (default, zero config) and a **Skip for now** on the integrations. Integrations are never a gate. Consistent with the §3 positioning decision, this step does **not** lead with a tracker logo.

No account, no email field, no signup. Target: usable in **under 45 seconds**, with 0 required fields.

**Cut-line note (§10):** the interactive sandbox is ~1.0 engineer-week and is on the cut list, degrading to a static page plus the FR-44 cheat sheet. Review's objection is fair and self-aware — spending a week on onboarding for a product whose central claim is that it needs none is hard to defend against, say, the element-capture fixture suite.

### Token setup

Reached from Settings or from selecting an unconfigured service in the destination picker.
1. Pick service. A short panel states, per service, what the token can do (unscoped, full-account — said plainly) and links to that service's token-creation page.
2. Paste token. → Chrome's optional-permission prompt for that one host (FR-23). *(1 click to grant)*
3. "Test connection" fires the identity call and shows the authenticated account name; only then does Save enable.
4. Pick a default project/DB/list from the discovered list.

**Target: 4 clicks + one paste, under 90 seconds** including the trip to the service to mint the token.

---

## 9. Success metrics

**The constraint, restated honestly after review.** There is no backend, so there is no telemetry — and round 2's proposed uninstall survey was not a loophole, it was a contradiction: `chrome.runtime.setUninstallURL` fires an HTTP GET to a host we would have to operate, carrying the extension ID. That is a fourth outbound host and an analytics endpoint, flatly against §6.1, §6.6 and brief constraint 2. **It is deleted.** What follows is derived only from (a) what the Chrome Web Store dashboard actually reports, and (b) instruments the user deliberately operates. Round 2 also printed targets for numbers that could never reach us; those are withdrawn rather than restated.

### Tier 1 — actually observable, no user action required

| Metric | Target (90 days) | Source |
|---|---|---|
| Installs | tracked, **no target** — see the GTM note | CWS dashboard |
| Weekly active users / installs | ≥40% at 6 months | CWS dashboard |
| Uninstalls per period | ≤20% of period installs | CWS dashboard (**note:** the dashboard reports uninstall *counts by period*, not install-cohort survival — round 2's "uninstall rate within 48 h ≤15%" was not a computable number and is withdrawn) |
| Store rating | ≥4.5 with **≥15 reviews** | CWS dashboard (round 2's "≥50 reviews at 90 days" implied 25k–50k installs at typical free-extension review rates, with no distribution plan anywhere in this document to support it) |

### Tier 2 — user-operated, small-n, and honest about it

Every in-product counter is **local, default-off, and never transmitted**. What replaces telemetry is a **"Copy my stats" button** in Settings that serialises the local counters into a short plain-text block the user can paste into a GitHub issue or a moderated session. That is opt-in twice over — the toggle and the paste — so the sample is small and self-selected, and every number derived from it carries that caveat in writing.

### Tier 3 — the wedge validation, restated as a pre-registered decision rule

Round 2 named element-capture share ≥20% "the wedge validation metric" and, by its own design, made it unmeasurable — the number that decides whether §3's thesis is right could never reach the team. Replaced with rules that are decidable with n = 10, **pre-registered here so they cannot be reinterpreted after the fact**:

- **Wedge 1 (element capture) is falsified if fewer than 6 of 10 moderated-session participants use element capture unprompted by day 7.** Consequence: §3 is rewritten, not the feature.
- **Wedge 2 (keyboard) is falsified if fewer than 3 of 10 complete a capture without touching the mouse after being shown the cheat sheet once.** Consequence: keyboard drops from a marketed wedge to an accessibility feature.
- **The §3 positioning decision (option (b), general-purpose) is falsified if the zero-integration cohort shows materially lower 7-day retention than the integration-configured cohort** across the 10 sessions plus review sentiment. Consequence: option (a) was right and §1 gets rewritten toward the professional user.
- **Pin (FR-37) is falsified if fewer than 4 of 10 pin anything twice.** Consequence: it drops from §2's win list and stops carrying Sam's persona.

**Instruments:** 10 moderated sessions at v1.0 + 30 days, recruited to the four personas including at least four Sams; a standing read of every store review and GitHub issue; and the pasted stats blocks that arrive with bug reports. Small-n and honest beats large-n and imaginary.

### GTM note — a real gap, named rather than papered over

This PRD contains no distribution plan, so every absolute install target has been withdrawn. Ratio metrics (WAU/installs, uninstalls/installs) survive because they are scale-free and are what actually tell us whether the product is good. **A GTM section is a prerequisite for setting any absolute number, and is out of scope for this document.**

---

## 10. Scope & phasing

**v1.0 — Still capture, shipped well.** *(Scope as written below is the ~44-week set; the recommended shipping scope is the ~32-week cut line that follows.)*
All four capture modes including **tall elements (FR-1..FR-6 — FR-5 promoted to P0 this round)**; **the device-pixel geometry contract and canvas guard (FR-40, FR-43)**; full selection editing (FR-34, FR-35); the **five-tool** core annotation set with numbered badges and destructive redaction (FR-7..FR-11); pin-to-screen (FR-37, FR-38); clipboard, download, and the target picker (FR-13, FR-41, FR-42, FR-39); Jira + Notion + ClickUp (FR-14..FR-20); token management (FR-21..FR-23); the scope-partitioned keymap (FR-27, FR-28, FR-44); all error states (FR-30..FR-33).

Three scope notes. First, **FR-25 is P1 in isolation but P0 the moment FR-37 ships**, because FR-38's `⌥⇧R` restore strip promises recoverable state; at the cut line it degrades to a single-slot store rather than disappearing. FR-26's Incognito rule (and the `"incognito": "split"` manifest declaration) is P0 unconditionally. Second, pin adds in-page injected UI with its own lifecycle; budget a week of cross-site hardening (closed shadow root, `adoptedStyleSheets`, no `innerHTML`, CSP and Trusted-Types pages, `z-index` and containment traps) before treating FR-37 as done. Third, **FR-40 and FR-43 are new P0s that did not exist in round 2** and are pure correctness: without them the product ships crops that are 50% wrong at 150% zoom and canvases that silently fail to render on ordinary long pages.

**v1.1 — Motion.** Video and GIF recording of a tab or region (approved in the brief, deliberately deferred). Adds: recording length cap (60 s for GIF, 5 min for video), an `offscreen` encoding path, and a hard decision on codec — WebM/VP9 for video, and GIF via a bundled encoder. Also, **everything displaced by the cut line above: Notion and ClickUp (FR-15, FR-16), the text tool, the full 20-item Library, the magnifier, the full 6-colour palette, pins 3–4 and ghost mode**, plus FR-12 (callout crop), FR-18 (title templates), FR-24. FR-36 (line tool) and FR-39 (filename template) are P1 and should be pulled into v1.0 if the schedule allows — both are under two days. Note that video changes the privacy story (audio permission) and needs its own permission review.

**v2 — OAuth.** Replace user-supplied tokens with proper OAuth apps for the three services, which fixes the "unscoped, full-account token" weakness in §7. This is the first version that requires anything server-shaped (a redirect handler); the architecture must make this a swap behind `IntegrationProvider` and nothing more. Possible additional destinations: Linear, GitHub Issues, Slack.

### Engineering estimate and the v1.0 cut line

Review's bottom-up estimate was ~42 engineer-weeks. Ours, re-derived with round-3's additions (FR-40 zoom correctness, FR-41 pickers, FR-43 streaming encode, FR-44's scope-partitioned keymap) and its subtractions (FR-7's tool set cut from nine to five), is **~44 weeks**. We are not arguing with the reviewer's number; we are agreeing with it and adding the things the round-2 document had simply left out.

| Area | FRs | Est. |
|---|---|---|
| Overlay shell, injection, focus restore, a11y live regions | FR-1, FR-28, FR-29 | 2.0 w |
| Region select + eager-freeze pipeline + magnifier | FR-1 | 1.5 w |
| Full-page stitch: sticky/fixed freeze, lazy-load, scheduler, partial delivery, determinate progress, stop-and-keep | FR-2, FR-31 | 3.5 w |
| **Streaming PNG encoder + canvas guard** *(new — the only way §6's memory closes)* | FR-43 | 1.5 w |
| **Element capture at the reliability R-3 demands** — shadow DOM, transforms, same-origin frames, canvas apps, fixture gate | FR-3 | 5.0 w |
| Bounded element stitch for tall elements | FR-5 | 0.5 w |
| Delayed capture | FR-4 | 0.5 w |
| **Zoom × DPR geometry contract + the 18-cell fixture matrix** *(new)* | FR-40, FR-6 | 1.5 w |
| **Annotation editor from scratch** — five core tools, hit-testing, command-list undo, hand-written canvas | FR-7 core, FR-8, FR-36 | 4.0 w |
| Text tool (IME, RTL, resize-on-edit, caret hit-testing) | FR-7 text | 1.5 w |
| Destructive redaction + FR-9's pixel-variance test | FR-9 | 1.0 w |
| Selection resize/move, pointer + keyboard | FR-34, FR-35 | 1.0 w |
| Pin-to-screen: shadow-root injection, lifecycle, multi-pin, restore strip, hostile-page hardening | FR-37, FR-38 | 2.5 w |
| Keymap: eight scopes, `event.code` dispatch, layout map, rebinding UI | FR-44 | 1.0 w |
| Offscreen pipeline, single-document queue, SW-termination safety | §6 | 1.5 w |
| Three integrations × (auth, discovery/caching, create, attach, zod, error mapping) | FR-14–17, FR-19, §7 | 5.5 w |
| **Target pickers with type-ahead** *(new)* | FR-41 | 1.0 w |
| Clipboard + download + filename template | FR-42, FR-39 | 1.0 w |
| Token UI, optional permissions, test-connection, revoke | FR-21–23 | 2.0 w |
| Error states, restricted-page surface, notifications | FR-30, FR-32, FR-33 | 1.5 w |
| Library / history | FR-25, FR-26 | 1.5 w |
| Interactive onboarding sandbox | §8 | 1.0 w |
| CWS submission, justifications, single-purpose statement, listing, perf benchmarking | R-6 | 2.5 w |
| **Subtotal** | | **~44 w** |

**~44 engineer-weeks ≈ 9 months solo, 5 months for two.** §10's earlier phrasing ("Still capture, shipped well") read like a quarter and was wrong.

#### The cut line — recommended v1.0-minimal

Ordered by **strategic value lost per week saved**, cheapest sacrifice first.

| # | Cut | Saves | Why it goes here |
|---|---|---|---|
| 1 | **Notion and ClickUp → v1.1. Ship Jira only.** | 4.0 w | Cut first, and it is not close. It removes the single largest schedule *variance* (R-1: Notion's 3-step upload, sharing-model 404s, and unverified extension-context CORS is a spike-sized unknown sitting in a P0 slot), and it costs the least strategy per week because **the brief says integrations are not the wedge and §3 has now committed to that** — under the round-2 positioning this cut would have gutted the product; under option (b) it does not touch the thesis. |
| 2 | **Text tool → v1.1** | 1.5 w | The named sinkhole. IME composition, RTL, and caret hit-testing are weeks of work for a tool a numbered badge usually replaces. |
| 3 | **Interactive onboarding sandbox → static page + cheat sheet** | 1.0 w | Hard to defend a week of onboarding for a product whose central claim is that it needs none. |
| 4 | **R-3 fixture suite 25 pages → 12** | 1.0 w | Keep the hard cases (shadow DOM, transforms, canvas apps, CSP, Trusted Types, zoom matrix); drop the redundant ones. Reversible, and the first thing restored if time appears. |
| 5 | **Library → single-slot last-capture store** | 1.0 w | Keeps `⌥⇧R` restore honest (FR-25/FR-38) at a fraction of the cost. Explicitly hollows out Dana's persona — an accepted, named loss. |
| 6 | **Magnifier → v1.1** | 1.0 w | The eager-freeze pipeline stays (it is required for correctness and for FR-4); only the 132×132 lens goes. |
| 7 | **FR-11 → 3 colours, 1 weight** | 0.5 w | See OQ-4. |
| 8 | **Pins 4 → 2; no ghost mode, no crop-in-pin** | 0.5 w | Core pin behaviour survives intact; the long tail goes. |
| 9 | **FR-17 per-field context toggles → one on/off** | 0.5 w | |
| 10 | **FR-12 callout crop, FR-18/FR-39 templates → v1.1** | 1.0 w | Already P1/P2; removed from the build plan, not just deprioritised. |
| | **v1.0-minimal** | | **≈ 32 w — about 4 months for two engineers.** |

**We stop at ~32 weeks and decline the reviewer's 26.** The remaining six weeks exist only in FR-3 (element-capture reliability), FR-40 (zoom correctness), FR-9 (destructive redaction) and FR-30/31/32 (error states), and every one of those is load-bearing for trust rather than for features. An element capture that is wrong 1 time in 20, or a crop that is silently 50% off at 150% zoom, does not ship a smaller product — it ships a product nobody believes, in a category where the entire pitch is "this is exact." **Cut last, in this order and only under duress: error states, redaction, zoom correctness, element-capture reliability.** The final item is not cuttable at all: it is Wedge 1, and without it we are a prettier GoFullPage.

Two consequences of cut #1 to state plainly. **Persona 3 (Dana) loses her destination and Persona 2 (Marcus) loses his**; both survive on clipboard, download, and pin, which is exactly the argument §3's positioning decision makes and a useful test of whether we believe it. And §7's Notion and ClickUp specifications stay in this document unchanged — they are v1.1 requirements now, not deleted ones, and R-1's Notion CORS spike still runs during v1.0 so the unknown is retired before it is on a critical path.

### Out of scope / will not build

- Any hosted service, account system, team plan, **uninstall-survey URL, or any other outbound host beyond the three integration APIs**.
- Hotshot-hosted share links or a media CDN.
- Cloud sync of history or settings across devices.
- Desktop/OS-level capture outside the browser.
- Safari or Firefox ports in v1.
- OCR, background removal, AI captioning, "explain this screenshot", or any LLM feature. (The brief forbids the aesthetic; we also decline the feature — it needs a backend or a bundled model, and both break the privacy promise.)
- Screen-recording with webcam bubble, transcripts, or viewer analytics — that is Loom's product.
- A colour picker, gradient tools, stickers, or emoji stamps.
- Editing a captured image after it has been shipped to a destination.

---

## 11. Risks & open questions

| # | Risk | Mitigation |
|---|---|---|
| R-1 | **Notion's file-upload path behaves differently in an extension context** (CORS, `Notion-Version` drift, or the 1-hour expiry biting on slow networks). | Spike it in week 1, before committing Notion as a P0. Fallback: ship v1.0 with Jira + ClickUp and Notion as "beta", rather than shipping a broken Notion. Pin `Notion-Version` and add a contract test that fails loudly on an unexpected schema (`zod`). |
| R-2 | **`captureVisibleTab` throttling** makes full-page stitching slow — ~7 s for an 8,000 px page, ~17 s for 20,000 px. This is not a risk we can engineer away; 2 calls/second is a hard platform limit. | Stop treating it as a risk and treat it as a specification: the derived numbers are published in §6 **and in the store listing**, progress is determinate (`7 / 14 tiles`), `Esc` stops and keeps, and the orchestrator lives in the offscreen document so a 17 s operation survives service-worker termination. The residual risk is a competitor with the same limit *appearing* faster by capturing at lower fidelity; we accept that and say why in the listing. |
| R-3 | **Element capture accuracy** on shadow DOM, canvas-rendered apps, CSS transforms, restrictive-CSP and Trusted-Types pages — the wedge fails publicly if it is 80% reliable. Cross-origin iframes are now **out of scope**, not a risk (§6: `activeTab` does not reach them). | Fixture suite of 25 real-world pages (12 at the cut line) as a regression gate, now including the **zoom × DPR matrix from FR-40** (6 zoom levels × 3 DPRs), a mixed-DPI monitor case, an `img-src 'self'` page and a Trusted-Types page. Explicit graceful degradation to region select with a visible notice (FR-3) — **never a wrong crop presented as correct**, which FR-40 makes enforceable rather than aspirational. |
| R-4 | **Unscoped personal tokens** are a genuine security downside; a compromised `chrome.storage.local` yields full Jira/ClickUp account access. | Say it plainly in the token UI (do not bury it). Make revoke one click. Prioritise v2 OAuth. Never log tokens; never include them in error surfaces. |
| R-5 | **We cannot measure what users do**, so we may optimise the wrong thing for a long time. Round 2 half-admitted this and then printed targets anyway. | Accept it as the cost of the privacy position, and pay for it with structure rather than with optimism: §9 is now cut to CWS-reported ratios plus **pre-registered falsification rules with stated n and thresholds**, decided before the data exists so they cannot be reinterpreted afterwards. Bias toward shipping opinions, since we cannot A/B test. |
| R-6 | **Chrome Web Store review** rejects or delays over permissions/justifications. | Minimum permissions by design (`activeTab`, optional hosts). Write the justification strings during development, not at submission. Budget 2 weeks of review latency. |
| R-7 | **Incumbents copy element capture — faster than round 2 admitted.** The 80% version (`elementFromPoint` + `getBoundingClientRect` + crop) is a **sprint**, and it captures the demo without paying for the hard 20% (shadow DOM, transforms, canvas apps). | Corrected from "2–3 quarters", which was generous to ourselves. The compounding defence is craft: keyboard completeness, sub-200 ms overlay latency, and in-page pinning are much harder to retrofit into their existing mouse-first, new-tab editors. Ship fast, then widen the keyboard lead. |
| R-8 | **The original 120 ms overlay budget was unachievable by construction** — it assumed pre-injection, which `activeTab` does not permit (OQ-1, now resolved). | Budget revised to ≤200 ms p50 / ≤400 ms p95 in §6, with the cost broken down so it is auditable. Remaining engineering levers, in order of preference: keep the content-script chunk ≤120 KB (biggest single lever), avoid any `await` before first paint, paint the dimmer synchronously and hydrate the toolbar after, and ship the overlay as a single self-contained file with no dynamic import. Measure on a fixed 10-page benchmark in week 2 and publish the real p50. |
| R-9 | **A pin is injected UI on someone else's page** and can break, be broken by, or be abused via that page: aggressive `z-index`, CSP that blocks our styles, `position: fixed` containment created by an ancestor `transform`/`filter`/`contain`, or a page that watches for our shadow host. | Closed shadow root with all styles inlined into it (FR-37); attach the pin to `document.documentElement` rather than `body` to escape most containment; a fallback that detects a non-viewport-fixed pin within one frame and re-parents it. If the pin still cannot be made reliable on a given origin, refuse to pin with a named error rather than render a broken overlay. Add 10 hostile pages to the R-3 fixture suite. |
| R-10 | **Pins plus a large stitch plus history could push a tab toward renderer OOM**, which presents to the user as "Chrome crashed", not "Hotshot used too much memory". | Enforce the caps in §6 as hard, tested limits (4 pins, 64 MB, 2,000 px display downscale, thumbnails-only history decode), and fail loudly at the boundary with a message that names the cause and the fix ("Dismiss a pin to capture this page"). Add a memory regression test that pins 4 full-page stitches and asserts the renderer heap stays under 64 MB. |

| R-11 | **Chrome Web Store single-purpose rejection.** "Capture + annotate + route to third-party SaaS" reads as multi-purpose to some reviewers, and R-6's 2-week latency budget did not name this specific vector. | Single-purpose statement drafted now (§6) rather than at submission; the cut line's Jira-only v1.0 also materially reduces the surface. If rejected, the fallback is to ship capture + annotate + clipboard/download and add integrations in a follow-up version once the listing is established. |
| R-12 | **The product is trivially forkable.** A free, open, backend-less extension can be re-listed on the CWS by anyone with telemetry added — using our privacy claim as the pitch. | See §12. There is no technical defence; the defences are trademark on the name, being the canonical listing, and shipping fast enough that a fork is always behind. Stated rather than wished away. |

**Open questions**

1. ~~Does `activeTab` alone permit pre-injection fast enough to hit 120 ms?~~ **RESOLVED — NO. Not an open question.** Chrome's documentation is unambiguous: `activeTab` is granted *only when the user invokes the extension*, via one of exactly four gestures — an action click, a context-menu item, a `commands` API keyboard shortcut, or an omnibox suggestion — and it is temporary, scoped to that tab, and revoked on cross-origin navigation or tab close. There is therefore **nothing to pre-inject with**: at the moment we would want the script resident, we hold no permission on that origin at all. The only ways to have a script already running are a manifest `content_scripts` block or `chrome.scripting.registerContentScripts`, and **both require host permissions for the origin** — i.e. `<all_urls>` or a broad match pattern, which the brief forbids (constraint 4) and which is the exact trust cost we are differentiating against (§2). **Decision: we do not buy 80 ms with the privacy position.** The budget is revised to ≤200 ms p50 / ≤400 ms p95 (§6) with the cost decomposed, the §2 comparison cell updated, and R-8 rewritten accordingly. We keep the honest number and keep the permission story.
2. Jira `createmeta` — which endpoint is current for issue-type discovery? (**VERIFY**, §7.1.)
3. ClickUp attachment size limit — undocumented in the reference we consulted (**VERIFY**, §7.3). Measure empirically.
4. **6-colour fixed palette (FR-11) vs. a full colour picker — decision stands, but stated fairly so it is revisitable.** *Our position:* a picker is a mouse tax that breaks Wedge 2; six keys (1–6) is one keystroke versus a pointer round-trip through a gradient square, and an opinionated palette guarantees legible contrast against arbitrary page content, which a user-chosen colour does not. *The counter-argument, which is genuine:* every serious tool in the desktop capture category — and Awesome Screenshot and Nimbus among extensions — ships a full picker, so its absence will read to some reviewers as an incomplete editor rather than a considered choice, and there are real jobs it blocks: matching a brand colour for a design handoff, annotating in a colour that does not collide with the UI being annotated, and accessibility users who need a specific high-contrast pair. A fixed palette also fails on screenshots whose dominant colour *is* one of our six. *Cheapest hedge if we are wrong:* keep the six number-key slots as the fast path and make them **user-configurable in Settings** — the keyboard model is untouched, the mouse tax stays out of the capture loop, and the "no picker" objection mostly dissolves. **Decide from the +30 day moderated sessions (§9) and store-review keyword counts, not from internal opinion.** Trigger to revisit: colour-picker requests appearing in ≥10% of reviews or ≥3 of 10 sessions.
5. ~~Should full-page stitch default to JPEG above some pixel count?~~ **RESOLVED — decided, not deferred.** Review is right that this is a P0 correctness decision for FR-14, not an open question: a DPR-2 full-page PNG of a long page routinely exceeds Jira's commonly-10 MB site limit, so leaving it open means shipping a 413 as the default experience. **Decision: on the integration path only, if the encoded PNG exceeds 8 MB, re-encode as JPEG at q=0.9; if still over, downscale in 0.85 steps until it fits, and state what happened in the toast ("Resized to fit Jira's 10 MB limit").** The clipboard path is unaffected and stays PNG (FR-42), and the download path stays PNG at full fidelity. Never silently degrade; never fail with a raw 413.
6. Should a pin be restorable across a *same-document* route change in an SPA (`pushState` within the same page shell), where the content script is **not** torn down? FR-38 currently destroys the pin on any top-level path change for predictability, but the SPA case is technically survivable and is exactly where long-lived reference is most useful (a Jira ticket form is an SPA route). Leaning: survive same-document route changes, destroy on real document unload. **Owner: Eng + Design, decide from the R-9 fixture suite in week 4.**
8. **The 15° vs. 0/45/90° line-constrain divergence between this document and `DESIGN.md` §7.2** (FR-36, FR-44). Recommendation: 15°. **Owner: Design + Product, before build — the two documents must not ship divergent.**
9. Does `execCommand('copy')` in an offscreen document reliably carry a PNG blob on our Chrome floor? (**VERIFY**, FR-42.) Not on the critical path — FR-42's content-script path is primary — but it would give us a fallback for the focus-stealing-page case.
10. What is Chrome's exact desktop canvas **area** cap on our floor? (**VERIFY**, FR-43.) ~268 M device px is the working figure; the guard table in §6 must be regenerated from a measured value before the store listing quotes it.
11. Is `chrome.action.openPopup()` reliable enough on the Chrome 116 floor to become a fourth FR-30 layer? (**VERIFY** — believed generally available only from ~Chrome 127.)
7. Is 4 simultaneous pins (FR-38) the right cap, or is 2 enough in practice? The cap is derived from the 64 MB ceiling, not from observed demand; if sessions show users never exceed 2, tighten it and reclaim the headroom for a larger display downscale (sharper pins).

---

## 12. Open source, licensing, and sustainability

§6.6 promises a public repository so that a reviewer can verify the privacy claim. That makes this an open-source product, and round 2 left every consequence of that unaddressed.

- **Licence: MIT.** A copyleft licence would be inconsistent with a repo whose purpose is to be *read* for verification, and — given brief constraint 1 — we will not adopt any GPL-derived licence for a capture tool, for the avoidance of even the appearance of lineage.
- **Provenance attestation.** `PROVENANCE.md` in the repo states, and every contributor agrees, that no code, asset, icon geometry, or string originates from any GPL-licensed capture tool; the design and implementation are original. This is written down rather than assumed, because brief constraint 1 is the one constraint whose violation is unrecoverable.
- **Forkability is real and undefendable technically (R-12).** A free, backend-less, MIT extension can be forked, have telemetry added, and be re-listed — pitched with *our* privacy claim. There is no code-level defence. The actual defences are: trademark the name, be the canonical listing with the reviews and install base, and ship faster than a fork can track. We accept this rather than compromising the licence to prevent it.
- **v1.1's GIF encoder is a licence decision to make before it constrains the codebase**: `gif.js` (MIT) is compatible; `ffmpeg.wasm` (LGPL/GPL depending on build) is not compatible with the position above. **Decision: `gif.js` or an original encoder; `ffmpeg.wasm` is excluded.**
- **Sustainability, stated as an unsolved problem.** Free, no backend, no revenue — and R-3's fixture suite implies ongoing maintenance against sites that change weekly. Year one is fine. **Year two has no funded answer**, and the options are a paid tier for integrations (which the no-backend constraint makes awkward but not impossible, since tokens are local), sponsorship, or accepting maintenance-only status. This is out of scope for v1.0 but must not stay unwritten: a product that quietly stops being maintained damages the privacy claim more than one that never shipped.
