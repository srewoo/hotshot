# Chrome Web Store submission

Everything the listing form asks for, written before submission rather than in
the submission dialog (PRD R-6). Store review latency is budgeted at two weeks;
a rejection over a missing justification costs another two.

---

## Listing

**Name:** Hotshot

**Short description** (132 char max):
> Exact screenshots of anything on a page. Annotate, pin, record, and send anywhere. Nothing leaves your machine.

**Category:** Productivity · **Language:** English

### Full description

Hotshot captures exactly what you point at.

Hover any element — a card, a modal, a single table row — and Hotshot
highlights its true bounds and captures it at that box. No shaky dragging, no
cropping afterwards. A desktop screenshot tool cannot do this, because it has
no page to read.

**Four ways to capture**
- Region — drag a selection, adjust it with handles or arrow keys
- Element — hover to snap to exact bounds, `[` and `]` to select the parent or child
- Full page — scrolling capture, stitched, with real progress you can stop
- Delayed — 3, 5 or 10 seconds, for menus and hover states that vanish on click

**Mark it up without leaving the page**
Arrows, boxes, ellipses, freehand, text, highlight, and numbered step badges
that renumber themselves when you delete one. Every mark stays editable — click
to select, drag to move, resize from a corner, recolour with a number key.
Redaction removes the pixels; it is not a blur that can be undone.

**Save it as what you need**
PNG for fidelity, JPG when the bytes matter, or a paged PDF — a long full-page
capture becomes a document you can print, not one absurdly tall sheet.

**Pin it to the page**
Keep a capture on screen while you write the bug report next to it. Drag it,
fade it, and see through it to the form underneath.

**Send it somewhere useful**
Copy, download, or send straight to Jira, Linear, ClickUp, Asana, Trello,
Notion, Slack or Dropbox — with the page URL, title and viewport size already
attached. Search your own issues, tasks and channels from the capture: no
switching to another tab to look up a ticket number.

**Record when a picture is not enough**
Screen recording to WebM, or a GIF for a pull request. Pause and resume, trim
the ends before you save, and add tab audio, a microphone voice-over or a
camera bubble. Recording is encoded on your machine like everything else —
there is no upload and no share link.

**A library that remembers**
Your recent captures, searchable by title, site, tag or where you sent them.
Favourite the ones worth keeping, re-open one in the editor, pin it onto the
page you are on, or export the lot as a single file.

**Privacy is the architecture, not a policy page**
Hotshot has no server. No account, no sign-up, no analytics, no crash
reporter. Integration tokens are stored on your own machine and never synced.
The only network requests Hotshot ever makes are to the one service you chose
to connect. The source is public: you can verify every claim on this page.

### What Hotshot does not do
- It cannot capture outside the browser — use your OS shortcut for that
- It cannot capture Chrome's own pages, the Web Store, or the built-in PDF viewer
- It does not host your images, give you a share link, or transcribe anything —
  all three would need a server, and Hotshot does not have one
- It cannot send to GitHub, Google Drive or Microsoft Teams. GitHub has no API
  that accepts an image attachment, and Drive and Teams require OAuth rather
  than the tokens this version uses. Named here rather than half-shipped.

---

## Permission justifications

Paste each verbatim into the corresponding field.

**`activeTab`**
> Hotshot captures the page you are looking at only when you explicitly invoke
> it — by pressing its keyboard shortcut or clicking its toolbar icon. activeTab
> grants access to that one tab, at that moment, and nothing else. This is why
> Hotshot does not request permission to read all your websites.

**`scripting`**
> Hotshot injects its capture overlay into the current tab when you invoke it,
> and reads the page's device pixel ratio and dimensions so the screenshot is
> cropped correctly at any browser zoom level.

**`storage`**
> Stores your settings and, if you choose to connect a service, that service's
> API token. Both stay on this device — Hotshot uses local storage only, never
> Chrome sync, so a token is never copied to Google's servers.

**`downloads`**
> Saves the screenshot or recording to your Downloads folder when you choose to
> save it.

**`unlimitedStorage`**
> Your capture library is stored on this device as image files in the browser's
> own database. Without this permission Chrome may delete them when disk space
> is tight, which would lose captures you had kept deliberately. It grants no
> access to anything outside Hotshot's own storage.

**`offscreen`**
> Full-page capture stitches many screenshots onto one canvas. That work needs a
> document, which a Manifest V3 service worker does not have, and can take
> several seconds — longer than a service worker is guaranteed to live.

**`notifications`**
> When you press the capture shortcut on a page Chrome does not allow extensions
> to run on, Hotshot tells you why. A keyboard shortcut does not open the popup,
> so a notification is the only way to explain rather than silently doing nothing.

**Optional host permissions** (Atlassian, Notion, ClickUp, Slack, Linear,
Trello, Asana, Dropbox)
> Requested only when you connect that specific service, never at install. Each
> is used solely to look up your own items in that service and to upload a
> screenshot you explicitly chose to send there. If you disconnect a service,
> Hotshot hands the permission back. Hotshot never requests permission to read
> all your websites.

**Camera and microphone**
> Not manifest permissions: they are requested by the browser, at the moment
> you turn them on for a recording, and only then. Both default to off, they
> are chosen per recording rather than remembered, and the audio and video are
> composited and encoded on your own machine — there is nowhere for them to be
> sent, because Hotshot has no server.

**Remote code:** No. All code is bundled in the package. Hotshot loads no
script, stylesheet, font or asset from any remote origin at runtime.

---

## Single purpose statement

> Hotshot captures, annotates, and delivers screenshots of web pages.

If review pushes back on the destinations as a second purpose, the fuller
answer — drafted in PRD §11 rather than at submission time — is:

> Hotshot captures images of web pages. Annotating a capture and sending it to
> a destination are part of capturing it; the extension does nothing unrelated
> to producing a screenshot.

---

## Data handling disclosures

Answer **"No"** to every "Is this item collecting…" question. The accurate
statement is:

> Hotshot does not collect, transmit, or sell any user data. It has no backend
> service. Screenshots stay on your device unless you explicitly send one to a
> service you have connected, in which case the image goes directly from your
> browser to that service — never through us, because there is no "us" to route
> it through.

---

## Privacy policy

Publish at the repository, and link it from the listing.

> **Hotshot privacy policy**
>
> Hotshot does not collect any data. There is no server, no account, and no
> analytics.
>
> **What stays on your device:** your settings, your capture history (the most
> recent 20 captures, or fewer depending on the retention you choose), and any
> API tokens you enter. These are stored using Chrome's local extension storage
> and are never synchronised to any Google or third-party account.
>
> **What leaves your device:** nothing, unless you explicitly send a capture to
> a service you have connected. In that case the image and the context fields
> you enabled are sent directly from your browser to that service's own API —
> Jira, Linear, ClickUp, Asana, Trello, Notion, Slack or Dropbox — using the
> token you provided. The data is then handled under that service's privacy
> policy, not this one. When you search your own issues or channels from the
> capture, that search also goes directly to that service and its results are
> cached on this device for one minute.
>
> **Recordings, including microphone and camera:** captured, composited and
> encoded entirely on your device, and saved to your Downloads folder. They are
> never uploaded, never transcribed, and never given a share link.
>
> **Incognito:** captures taken in an Incognito window are never written to
> history.
>
> **Your control:** you can clear your history at any time from the Library, and
> disconnect any service from Settings. Disconnecting deletes the stored token
> and revokes Hotshot's permission to contact that service.
>
> **Contact:** open an issue at the repository.

---

## Assets checklist

- [x] Icons: 16, 32, 48, 128 px
- [x] Screenshots: 1280×800 — generated by `node scripts/store-assets.mjs` from
      the REAL `dist/` build, so nothing in the listing shows a feature the
      package does not have
- [x] Small promo tile 440×280 — same script
- [ ] Demo video — optional, but element capture demonstrates in about eight
      seconds and is the whole pitch

**Screenshots, in this order:**
1. Element capture mid-hover, exact bounds highlighted on a real card
2. The annotation toolbar with numbered badges over a screenshot
3. A pin sitting beside a half-filled bug-report form
4. The destination strip searching for an issue by name
5. Settings, showing "Not connected" and the local-storage note

---

## Pre-submission checks

- [ ] `npm run verify` passes — typecheck, unit suite, E2E suite, both size budgets
- [ ] Version in `package.json` bumped — the manifest reads it, so they cannot drift
- [ ] Console clean on every extension page (covered by an E2E test)
- [ ] `npm audit` reports zero vulnerabilities
- [ ] **Connectors verified against their live APIs.** Every client here is
      written from published API shapes and tested against a stub, which proves
      the request SHAPE and not that the service accepts it. Each one carries a
      `VERIFY` note saying so. Jira, Notion and ClickUp were the original three;
      Slack, Linear, Trello, Asana and Dropbox have never met a live account.
      Ship the unverified ones behind a "beta" label, or not at all, until each
      has been exercised once by hand.
- [ ] **Recording on a page with a restrictive Permissions-Policy.** Camera and
      microphone are requested from the content script, which runs in the
      page's origin — a site sending `Permissions-Policy: camera=()` can refuse
      them. The recorder degrades to screen-only and warns, but the behaviour
      should be seen once before the listing promises a camera bubble.
