# Hostile review — Hotshot PRD v1.0

**Reviewer:** VP Product · **Date:** 2026-09-02 · **Artifact:** `docs/PRD.md` against `docs/BRIEF.md`

---

## Verdict

**REWRITE.** §6's headline performance budgets are not aggressive-but-hard, they are arithmetically impossible against documented Chrome API limits; §9's measurement plan simultaneously violates §6's own privacy guarantees and produces no data; and the v1.0 P0 set is roughly four times the scope the document's tone implies. The strategy chapters (§1–§3) are good enough to keep almost verbatim — everything downstream of §5 needs to be re-derived from what Chrome actually permits.

---

## Blocking issues

Ranked by severity. Each is a "do not hand this to engineering as-is."

### B1. §6's 120 ms overlay budget rests on a pre-injection strategy that `activeTab` does not permit — and §11 Q1 files this as an open question when the API already answers it

**Hits:** §6 Performance budgets row 1 ("Content script pre-injected on tab activation where `activeTab` allows"); §11 R-8; §11 Open Question 1; §2 "Where Hotshot wins" #3; the positioning statement in §1.

`activeTab` grants a temporary host permission **only at the moment the user invokes the extension** — action click, context-menu item, or a `chrome.commands` keyboard shortcut — and it is revoked on navigation or tab close. There is no event at which `activeTab` is live "on tab activation" for a tab the user has not yet invoked the extension on. The parenthetical "where `activeTab` allows" describes a state that never exists. Pre-injection requires `host_permissions: ["<all_urls>"]` or a broad match list, which brief constraint 4 forbids and which is the exact posture §2 attacks Awesome Screenshot for.

So the real sequence on every capture is: keypress → service worker cold start (the SW is terminated after ~30 s idle, so p50 on a daily-use extension is a **cold** start) → `chrome.scripting.executeScript` + `insertCSS` → parse/execute the content script chunk (§6 permits up to 120 KB) → build the overlay DOM → first paint. On a heavy page this contends with page main-thread work you do not control. 120 ms p50 is optimistic; **250 ms p95 on "heavy pages" is not achievable** — a single long task in the page's event loop blows it by itself.

Filing this as Open Question 1 with "Owner: Eng, decide by end of week 2" is the wrong instrument. It is not an unknown; it is a constraint that invalidates the number printed in §2's competitive table and quoted in the positioning statement.

**Fix:** Delete the pre-injection clause. Re-baseline the budget as measured cold-start-to-interactive on a fixed 10-page benchmark before this PRD is approved, and publish that number in §2 rather than a target. If the honest number is ~250–400 ms p50, say so — §2 already concedes "we win on what happens next, not the first 60 ms," and that concession is strong enough to carry the positioning without a fabricated 120 ms.

### B2. FR-1's magnifier makes the 120 ms budget impossible on its own, and nothing in the PRD acknowledges why

**Hits:** FR-1 (P0), §6 row 1, §6 row 2.

A content script cannot read the page's rendered pixels. A ≥4× magnifier following the cursor therefore requires a `chrome.tabs.captureVisibleTab` bitmap **at overlay-open time**, before the user has done anything. That call is itself typically 50–200 ms on a large viewport, it must round-trip through the service worker, and it consumes one of the two calls permitted per second (see B3). So FR-1's overlay cannot be "visible and interactive" until after a capture the budget does not account for.

It also goes stale: the magnifier shows a frozen bitmap while the page underneath continues to animate, play video, or scroll. The overlay must therefore freeze the page (or accept a visibly wrong magnifier), and freezing is not specified anywhere.

**Fix:** Either (a) drop the magnifier from P0 and let FR-1 ship with the arrow-key nudge as the precision affordance — nudge is the keyboard-first answer anyway and is free — or (b) keep it, specify the eager-capture-and-freeze pipeline explicitly, and raise the §6 row-1 budget to cover a `captureVisibleTab` round-trip. You cannot have both FR-1 as written and 120 ms.

### B3. §6's full-page stitch budget contradicts FR-31's own premise and Chrome's rate limit

**Hits:** §6 row 3 ("8,000 px tall page ≤4 s p50"); FR-2; FR-31; §11 R-2.

`chrome.tabs.MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND` is **2**. An 8,000 px page at a typical ~800 px viewport is ~10 tiles → **≥5 s from throttling alone**, before scroll settle, before FR-2's mandated "≥250 ms per tile" lazy-load pause (+2.5 s), before encode and stitch. The realistic figure is 8–10 s, i.e. **2–2.5× the published budget**, and §6's own note ("dominated by Chrome's throttle, not our code") shows the author knew the mechanism and did not do the arithmetic.

Worse, §6 row 3 and FR-31 disagree about reality: FR-31 correctly treats quota exhaustion as a routine, expected condition requiring backoff and partial delivery; §6 prices the same operation as if the quota were not binding.

**Fix:** Replace row 3 with a throttle-derived formula, not a constant: `ceil(docHeight / viewportHeight) × 500 ms + tiles × settleDelay + encode`. Publish the derived numbers for three reference pages (2k / 8k / 20k px) and put the same numbers in the store listing so users are not surprised. Then reconcile FR-31: partial delivery is the *normal* long-page path, not the error path.

### B4. §6's 350 MB memory ceiling is arithmetically impossible for the exact case it names, and the canvas guard is on the wrong dimension

**Hits:** §6 row 6 ("Peak memory, full-page stitch of a 20,000 px page at DPR 2 ≤350 MB, hard-fail above 30,000 px CSS height"); §11 R-2.

Do the multiplication the row itself sets up. A 1,280 CSS px wide viewport, 20,000 CSS px tall, at DPR 2 → 2,560 × 40,000 = 102.4 M device px × 4 bytes = **409.6 MB for the backing store alone** — before the per-tile bitmaps, the `ImageData` copies annotation and redaction need, the undo stack (FR-10 demands ≥20 levels), and the PNG encode buffer. Peak will be 2–3× the backing store. The stated case exceeds the stated budget by ~20% at minimum and realistically by 3×.

The 30,000 px CSS guard is also the wrong guard:
- At DPR 3 (common on Windows scaling and high-DPI Android/ChromeOS), 30,000 CSS px = 90,000 device px, which exceeds Chrome's **maximum canvas dimension of 65,535 px**. The canvas fails before the height guard fires.
- Chrome also caps total canvas **area** (~268 M device px on desktop). A 2,560 CSS px wide window (an ordinary 27″ display) at DPR 2 is 5,120 device px wide; at 30,000 CSS px tall that is 307 M px — over the area cap. The height guard does not see this at all.
- Exceeding either limit does not throw usefully; you get a zero-sized or non-rendering canvas, i.e. exactly the silent failure FR-30 and CLAUDE.md's "fail loudly" forbid.

**Fix:** Guard on **device pixels**, in both dimensions and on area, computed as `viewportCSSWidth × zoom × DPR` by `docCSSHeight × zoom × DPR`, checked against `min(65535 per axis, ~268M area, memory budget)` — and check it *before* the first tile, not on discovery. Raise the memory budget to a defensible number or lower the supported page height until the arithmetic closes. Also specify the tiled-encode strategy (encode and release tiles incrementally rather than holding one giant canvas) if you want to keep 20,000 px supported at all.

### B5. "Copy to clipboard" — the single most-used, zero-config path — has no specified mechanism that works, and FR-20 actively breaks the one that does

**Hits:** FR-13 (P0, "must work with zero configuration"); FR-20 ("overlay closes immediately", fire-and-forget); §6 "Image encoding and stitching happen in an offscreen document."

`navigator.clipboard.write()` requires **both** a transient user activation **and** a focused document. An offscreen document is never focused, so a `ClipboardItem` image write from the offscreen doc throws `NotAllowedError: Document is not focused`. The offscreen `CLIPBOARD` reason exists for the legacy `document.execCommand('copy')` path, which is workable for text and genuinely fragile for image blobs. The reliable path is writing from the **content script, inside the user's gesture, while the page has focus** — which is precisely the moment FR-20 tears the overlay down and hands off asynchronously.

There is also a format gap: `ClipboardItem` reliably carries `image/png` only. §11 Q5 leans toward JPEG above ~8 MP for attachment-size reasons; those two decisions collide silently on the clipboard path.

**Fix:** Specify the clipboard write explicitly as a content-script, in-gesture, synchronous-blob write that happens **before** the overlay teardown, and carve clipboard out of FR-20's fire-and-forget rule (it is not a network call; the latency argument does not apply). Add an acceptance test on a page with an active `contenteditable` and on a page that steals focus. If the in-gesture write cannot be made reliable, the honest answer is that clipboard degrades to download — and that needs to be a stated behaviour, not a discovered one.

### B6. §9's uninstall survey violates §6's privacy guarantees and brief constraint 2 — and every other §9 metric is unobservable

**Hits:** §9 leading indicators rows 2–4, lagging indicators rows 2–4; §6 Privacy guarantees #1 and #6; brief constraint 2.

Three separate failures:

1. **The uninstall URL is a backend.** `chrome.runtime.setUninstallURL` fires an HTTP GET to a host you must operate, carrying the extension ID and whatever you append. §6.1 says "no analytics endpoint"; §6.6 says a reviewer "can confirm zero outbound hosts beyond the three." The uninstall URL is a fourth host and an analytics endpoint. §9 even calls it "the only 'telemetry' we ship," apparently without noticing it contradicts the section two pages earlier and the brief's "no server, no hosted service."
2. **"Uninstall rate within 48 h ≤15%" is not a number the CWS dashboard produces.** The dashboard gives installs, weekly users, and uninstall counts by period. It does not give install-cohort survival at 48 h. The metric cannot be computed.
3. **Every opt-in metric collects nothing.** §9's own design paragraph says the opt-in toggle "keeps *local* counters and shows the user their own numbers," and that wiring it to send data anywhere requires a separate consent and version bump. So onboarding completion, captures/user/week, integration-configured share, and — critically — **element-capture usage share** never reach the team. That last one is labelled "**the wedge validation metric**": the number that determines whether §3's entire thesis is right is, by construction, unmeasurable. §11 R-5 half-admits this and then §9 prints targets anyway.

Additionally, "Store rating ≥4.5 with ≥50 reviews at 90 days" implies roughly 25k–50k installs in 90 days at typical free-extension review rates (~1 review per 500–1,000 installs). There is no GTM or distribution section anywhere in the PRD to support that.

**Fix:** Cut §9 to what the CWS dashboard genuinely reports (installs, weekly users, uninstalls, rating) plus qualitative instruments. Delete the uninstall URL entirely or accept it as an explicit, documented exception and amend §6.1/§6.6 — do not leave the contradiction standing. Replace the wedge-validation metric with something actually observable: **a structured in-product "share your local stats" export** the user pastes into a GitHub issue or a moderated session, plus a pre-registered decision rule ("if fewer than 6 of 10 moderated-session participants use element capture unprompted by day 7, §3 is wrong"). Small-n and honest beats large-n and imaginary.

### B7. v1.0 scope is ~4× what the document's framing implies

**Hits:** §10 v1.0 paragraph; the entire P0 column of §5.

Bottom-up estimate of the P0 set as written, senior engineer, including tests (CLAUDE.md mandates unit tests on every change) and the 25-page fixture suite R-3 demands:

| Area | FRs | Est. |
|---|---|---|
| Overlay shell, injection, focus restore, a11y live regions | FR-1, FR-28, FR-29 | 2.0 w |
| Region select + magnifier + freeze pipeline | FR-1 | 1.5 w |
| Full-page stitch (fixed/sticky freeze, lazy-load, throttle backoff, partial delivery, tiled encode) | FR-2, FR-31 | 3.5 w |
| Element capture to the quality R-3 demands (shadow DOM, iframes, transforms, canvas apps, 25-page regression gate) | FR-3 | 5.0 w |
| Delayed capture | FR-4 | 0.5 w |
| DPR + browser-zoom + multi-monitor correctness | FR-6 | 1.0 w |
| **Annotation editor from scratch** — 9 tools, hit-testing, text tool with IME/RTL, ≥20-level undo, keyboard model, hand-written canvas (no React per §6) | FR-7, FR-8, FR-10, FR-11 | **6.0 w** |
| Destructive redaction + the pixel-variance test in FR-9 | FR-9 | 1.0 w |
| Offscreen pipeline + lifecycle + SW-termination safety | §6 | 1.5 w |
| Three integrations × (auth, discovery/caching, create, attach, zod schemas, error mapping) | FR-14–17, FR-19, FR-20, FR-32, §7 | 5.5 w |
| Token UI, optional permissions, test-connection, revoke | FR-21–23 | 2.0 w |
| Error states, restricted-page detection, notification surface | FR-30, FR-32 | 1.5 w |
| Interactive onboarding sandbox | §8 | 1.5 w |
| CWS submission, permission justifications, listing, store QA, perf benchmarking | §11 R-6 | 2.5 w |
| **Subtotal** | | **~35 w** |
| Integration-risk contingency (Notion spike, R-1/R-3 rework) | | +20–30% |

**~42 engineer-weeks.** That is roughly **9 months for one engineer, or 5 months for two** — not a 6-week build, and the §10 phrasing ("Still capture, shipped well") reads like a quarter.

The two P0s that are secretly the whole project are **FR-7 (the annotation editor)** and **FR-3 (element capture at non-embarrassing reliability)**. A from-scratch canvas editor with nine tools, hit-testing, a text tool, and 20-level undo is a product in its own right; the industry lesson is that the text tool alone consumes weeks once IME, RTL, and resize are real.

**What to cut to ship:**
- **Notion and ClickUp out of v1.0.** Ship **Jira only**. Notion's 3-step upload, sharing-model 404s, and unverified extension-context CORS (R-1) are a spike-sized unknown holding a P0 slot; ClickUp's 3–4-call discovery chain is a week of caching and invalidation work for a third integration nobody asked for at launch. This alone removes ~3.5 w and the single largest schedule variance.
- **FR-11 (palette/weights) → v1.1.** Ship one colour and one weight. Six opinionated colours is a nice line; it is not launch-blocking.
- **FR-1's magnifier → v1.1** (see B2).
- **FR-7 tool set → arrow, rectangle, text, numbered badge, redact.** Cut ellipse, freehand, highlight, crop from P0. That is ~2 w and loses nothing a bug report needs.
- **§8's interactive onboarding sandbox → a static page + the shortcut cheat-sheet.** 1.5 w for a nice-to-have on a product whose whole claim is that it needs no onboarding.
- Keep FR-25 (history) as P1 as written — but note it is Dana's core need and cutting it hollows out one of three personas.

That gets v1.0 to roughly **26 weeks of work**, which is a real 3-month two-engineer quarter with contingency.

### B8. Browser zoom is not mentioned once in the PRD, and it silently corrupts every crop

**Hits:** FR-1, FR-3, FR-6, §6 "Browser & permission constraints."

`captureVisibleTab` returns a bitmap at `zoom × devicePixelRatio`. Content-script geometry (`getBoundingClientRect`, `window.innerWidth`) is in CSS px at the current zoom. At 150 % browser zoom, cropping the element's rect out of the captured bitmap without multiplying by `chrome.tabs.getZoom()` produces a crop that is off by 50 % in both position and size — a **wrong crop presented as correct**, the exact failure R-3 says is unacceptable. FR-6 claims DPR fidelity and never mentions zoom, so the requirement as written is under-specified enough that an engineer can implement it literally and be wrong.

Related and equally absent: **multi-monitor DPR change**. Dragging the window from a Retina to a non-Retina display mid-stitch changes `devicePixelRatio` between tiles, producing tiles of different scales that will not stitch. Nothing in FR-2 or FR-31 detects or aborts on this.

**Fix:** Add an FR: "All capture geometry is computed in device pixels as `cssRect × chrome.tabs.getZoom() × devicePixelRatio`, sampled once at capture start; a change in either factor mid-capture aborts with a named error." Add zoom levels {50, 100, 150, 200 %} and a mixed-DPI monitor case to R-3's fixture matrix.

### B9. Internal contradiction: FR-13's destination keys collide with FR-10's tool keys

**Hits:** FR-10 (`c`=crop, `n`=number) vs FR-13 (`c`=copy to clipboard, `n`=Notion, `d`=download, `j`=Jira, `u`=ClickUp).

Both key sets are live during the annotation phase — §8 step 3 uses `n` for numbered badges and step 4 uses `j` for Jira in the same uninterrupted interaction. `c` and `n` are each bound to two different actions with no stated mode boundary. This is not a typo; it is the keyboard model, which is Wedge 2. Getting it wrong in the PRD means engineering invents a resolution and the wedge ships inconsistent.

Second-order: single ASCII letters as shortcuts break on AZERTY, Dvorak, and non-Latin layouts unless dispatched on `event.code` — and even then the printed cheat-sheet (`?`, FR-28) shows the wrong letters. Nothing in the PRD addresses this.

**Fix:** Introduce an explicit modal or prefixed model — e.g. tools are bare keys, destinations are `Enter`-then-key or a `Shift`-prefixed set — and print the full resolved keymap as a table in the PRD. Specify `event.code` dispatch and layout-aware cheat-sheet labels.

### B10. §8's flagship flow contradicts its own click count and depends on a P1 requirement and on knowledge the user does not have

**Hits:** §8 primary flow; FR-5 (P1); FR-14 (P0); Persona 1 (§4).

Three problems in the one flow that carries the product's central claim:

- **The arithmetic is wrong.** The flow banners "**Target: 1 click**." Step 3 places three numbered badges by clicking three times and then drags a redaction rectangle. That is at minimum 4 mouse actions on top of step 2's click. The stated total is contradicted by the steps above it.
- **It depends on a P1 FR.** Priya's moment of need (§4) is capturing a **customer invoice table** at exact bounds. Invoice tables are routinely taller than the viewport. Element capture of a taller-than-viewport element is **FR-5, priority P1, explicitly allowed to slip to v1.1**. The P0 persona's P0 job requires a P1 requirement.
- **Step 4 assumes the user has memorised a Jira key.** "Type or paste the key" is counted as *(0 clicks)*, and there is no issue search or recent-issues picker anywhere in FR-14–FR-20. In practice the user alt-tabs to Jira to find `ABC-412` — one app switch, which is the exact cost §8 claims to eliminate ("0 app switches").

**Fix:** Recount the flow honestly (it is ~5 interactions and ~15 s, which is still a large win over the stated 8-click incumbent path — the honest number wins the argument fine). Promote FR-5 to P0 or change Priya's moment of need to something that fits in a viewport. Add "recent/assigned issues picker with type-ahead" to FR-14 as P0; without it the flagship demo has an app switch in the middle.

### B11. FR-30's error surface has no mechanism on restricted pages

**Hits:** FR-30 (P0, "must show an explicit, named reason **in the toolbar popup** — never a silent no-op").

On `chrome://` pages, the Web Store, other extensions' pages, and the PDF viewer you cannot inject a content script — so no overlay and no toast. And the trigger in the flagship flow is a **keyboard command**, which does not open the popup. `chrome.action.openPopup()` exists but is recent and constrained; relying on it makes FR-30 a Chrome-version-gated behaviour. The realistic surface is `chrome.notifications` (another permission, another CWS justification, and OS-level notification settings can suppress it) or a badge + title change (weak, easily missed).

The PRD flags this as "the #1 one-star review theme in this category" and then specifies a delivery mechanism that does not fire in the case that generates those reviews.

**Fix:** Specify the surface concretely: badge text + `chrome.action.setTitle` immediately (always works, no permission), plus `chrome.notifications` as the primary if the permission survives CWS review, plus a persistent explanation in the popup when the user does open it. Add `notifications` to the permission list in §6 and write its justification now (R-6's own advice).

### B12. The "general-purpose user" positioning and the actual product are different products

**Hits:** Brief "Product decisions already made" ("general-purpose capture — anyone taking screenshots daily; integrations are a strong secondary, not the wedge") vs §1 positioning statement, §3 (two of three surviving wedges are integration- or bug-filing-shaped), §4 (all three personas are professional/technical), §9 (target: only 25 % of actives configure any integration).

The brief says integrations are **not** the wedge. The PRD's positioning statement is 90 % integrations ("into your Jira issue, Notion page, or ClickUp task"). §2's "Where Hotshot wins" leads with "The last mile." Wedge 3 is explicitly justified by "the highest-intent segment (bug filing)." Meanwhile §9 forecasts that **75 % of active users will have zero integrations configured** — and for those users, the PRD's entire stated value proposition evaluates to "a screenshot lands on your clipboard," which is Cmd-Shift-4 with extra steps and an install.

Nowhere does the PRD describe what the product *is* for that 75 %. There is no flow, no persona, no metric, and no store-listing angle for the zero-integration user, who is the modal user and the one the brief names as primary.

This also makes the differentiation argument weaker than §3 admits. Element capture at 80 % quality is a `elementFromPoint` + `getBoundingClientRect` + crop — genuinely a sprint for a competitor. The last 20 % (shadow DOM, transforms, cross-origin iframes) is the hard part, and a competitor shipping the 80 % version captures the demo without paying for the 20 %. R-7's "2–3 quarters" is generous to ourselves. Keyboard completeness is a real moat but is **invisible in a store listing** — it converts nobody at install time and only pays off at capture #50, by which point retention has already been decided.

**Fix:** Pick one and make the whole document agree. The defensible version, given the brief: **the wedge is element capture + keyboard speed + a zero-account, minimum-permission posture**, and integrations are the *upsell* for the professional tail. That means rewriting the §1 positioning statement to lead with capture quality and privacy rather than Jira; adding a fourth persona who never configures an integration and describing their loop end-to-end; and moving §2's "Privacy as a shipped property" from bullet 4 to bullet 1 — it is the only claim here that a well-funded incumbent structurally *cannot* match, because their business model requires the cloud.

---

## Non-blocking issues

- **§6 "Chrome ≥ 116 (MV3 offscreen documents)"** — `chrome.offscreen` shipped in Chrome 109. If 116 is required for a different reason, name it; if not, widening the floor is free reach.
- **Offscreen one-document limit is unmanaged.** Chrome permits exactly one offscreen document per extension. A long stitch holding it, plus a clipboard write, plus a second capture fired before the first finishes, contend for it. Specify a queue and a lifecycle owner.
- **Service-worker termination during long stitches.** The SW's 30 s idle timer is reset by events, and a 500 ms-cadence capture loop keeps resetting it — but a 30,000 px page is ~37 tiles × (500 ms throttle + 250 ms settle) ≈ 28 s, sitting right on the edge. State the design rule explicitly: the stitch orchestrator lives in the offscreen document, not the SW, and all progress is checkpointed to IndexedDB.
- **`activeTab` and cross-origin iframes.** FR-3 promises to resolve iframe-embedded elements. `activeTab` does not extend to cross-origin frames; that path needs `all_frames` injection under host permissions. Verify before FR-3 is committed as P0 — it may narrow FR-3's scope.
- **Incognito mode is under-specified.** FR-26 promises Incognito captures are never written to history. Extensions do not run in Incognito unless the user enables it, and in `spanning` mode the same IndexedDB is shared. Declare `"incognito": "split"` in the manifest and say so in the PRD.
- **Restrictive-CSP pages.** Content-script execution is exempt from page CSP, but `blob:` URLs the overlay creates for previews live in the page origin and **are** subject to the page's `img-src`. A page with `img-src 'self'` breaks the preview. Pages with `require-trusted-types-for 'script'` break `innerHTML` in content scripts. Add both to the R-3 fixture suite; build the overlay in a closed shadow root with `adoptedStyleSheets` and no `innerHTML`.
- **Jira attachment size is a live failure, not an edge case.** §7.1 notes a commonly 10 MB site limit; a DPR-2 full-page PNG of a long page routinely exceeds it. §11 Q5's downscale policy is "leaning yes" and undecided — it is a P0 correctness decision for FR-14, not an open question. Decide before build.
- **`*.atlassian.net` wildcard host permission** will draw CWS reviewer attention. Prefer prompting for the site subdomain at token setup and requesting `https://{site}.atlassian.net/*` as a runtime-specific optional permission.
- **CWS single-purpose policy risk.** "Capture + annotate + route to three third-party SaaS tools" can be read as multi-purpose. R-6 budgets 2 weeks of latency but does not name this specific rejection vector. Draft the single-purpose statement now.
- **Permission list in §6 is incomplete.** Missing at minimum `storage`, `offscreen`, `commands`, `clipboardWrite`, `notifications`, and possibly `downloads` and `unlimitedStorage` (FR-25 stores 20 blobs). Each needs a justification string.
- **i18n is entirely absent.** ~40 user-facing error strings (FR-30–33), the onboarding page, the store listing, RTL layout for the overlay, and layout-dependent single-key shortcuts (B9). At minimum state the v1 position explicitly ("English only, strings externalised from day one, no RTL") rather than leaving it unaddressed.
- **Licensing / OSS strategy is missing entirely.** §6.6 promises a public repo so reviewers can verify the privacy claim — that makes this an open-source product with no stated licence, no contribution policy, and no answer to the obvious consequence: a free, open, backend-less extension is trivially forkable and re-listable on the CWS with telemetry added. Also: brief constraint 1 (zero Flameshot lineage) needs a written provenance attestation in the repo, and v1.1's bundled GIF encoder is a licence decision (`gif.js` MIT vs `ffmpeg.wasm` LGPL/GPL) that should be made before it constrains the codebase.
- **No GTM/distribution section.** §9 assumes tens of thousands of installs in 90 days with no stated channel.
- **No sustainability model.** Free, no backend, no revenue, and R-3's 25-page fixture suite implies ongoing maintenance against sites that change weekly. Who pays for year two?
- **§2 self-inconsistency (cosmetic).** The table says Hotshot ~120 ms vs OS ~50–100 ms; §2 then says "~2× slower." Those are 1.2–2.4×. Once B1 corrects the number this paragraph needs rewriting anyway.

---

## What is genuinely good

Short, as instructed.

- **§3's KILL decisions.** Explicitly demoting annotation primitives and destination memory from "wedge" to "FR, ship it, don't market it" is the kind of discipline most PRDs never show. Keep this section's structure verbatim.
- **§7 is unusually honest for a PRD.** Naming `X-Atlassian-Token: no-check`, the ClickUp personal-token *no-`Bearer`-prefix* trap, Notion's 3-step upload and its 1-hour expiry, and — best of all — marking the ClickUp attachment limit as unknown rather than inventing a number. The **VERIFY** convention should be adopted as a house standard.
- **FR-9's testability.** "Decode exported PNG, assert redacted region variance ≈ 0" is a requirement written as an acceptance test. More FRs should read like this.
- **§6's accessibility section**, specifically the observation that element capture is the *superior* screen-reader path because drag-select is inherently visual. That is a real insight and a genuine store-listing line.
- **FR-31 and FR-32.** Partial-stitch delivery instead of discarding work, and preserving the image in history when a ship fails, are the details that earn the trust §2 claims.
- **§2's "Where we lose, and accept it."** Naming Loom, the OS shortcut, and team features as permanent losses is right and rare.

---

## The single highest-leverage change

**Re-derive §6 from Chrome's actual API limits before this PRD is approved — the arithmetic, not a spike, already disproves three of its budgets — and then rewrite §1's positioning statement to match whatever survives.**

§6 is not a nice-to-have appendix; it *is* the product thesis. "120 ms" is quoted in the competitive table, the positioning statement, and the differentiation argument. Once you accept that `activeTab` cannot pre-inject (B1), that FR-1's magnifier needs a capture before the overlay is interactive (B2), that the 2-calls-per-second throttle sets a hard floor on stitching (B3), and that a 20,000 px DPR-2 canvas is 410 MB not 350 MB (B4), the honest numbers are meaningfully worse — and the product is still worth building, because the win was never the first 60 ms. It was the last mile, element capture, and a privacy posture the incumbents' business models forbid.

Everything else in this review is downstream. Fix §6 first and §1, §2, §9, and §11's open questions rewrite themselves; leave it and engineering builds to numbers they will miss, which is how a good product acquires a reputation for being slow.
