# Chrome Web Store submission

Everything the listing form asks for, written before submission rather than in
the submission dialog (PRD R-6). Store review latency is budgeted at two weeks;
a rejection over a missing justification costs another two.

---

## Listing

**Name:** Hotshot

**Short description** (132 char max):
> Exact screenshots of anything on a page. Annotate, pin, and send to Jira, Notion or ClickUp. Nothing leaves your machine.

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
that renumber themselves when you delete one. Redaction removes the pixels —
it is not a blur that can be undone.

**Pin it to the page**
Keep a capture on screen while you write the bug report next to it. Drag it,
fade it, and see through it to the form underneath.

**Send it somewhere useful**
Copy, download, or send straight to a Jira issue, a Notion page, or a ClickUp
task — with the page URL, title and viewport size already attached.

**Privacy is the architecture, not a policy page**
Hotshot has no server. No account, no sign-up, no analytics, no crash
reporter. Integration tokens are stored on your own machine and never synced.
The only network requests Hotshot ever makes are to the one service you chose
to connect. The source is public: you can verify every claim on this page.

### What Hotshot does not do
- It cannot capture outside the browser — use your OS shortcut for that
- It cannot capture Chrome's own pages, the Web Store, or the built-in PDF viewer
- It does not record video (yet)
- It does not host your images or give you a share link

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
> Saves the screenshot to your Downloads folder when you choose to download it.

**`offscreen`**
> Full-page capture stitches many screenshots onto one canvas. That work needs a
> document, which a Manifest V3 service worker does not have, and can take
> several seconds — longer than a service worker is guaranteed to live.

**`notifications`**
> When you press the capture shortcut on a page Chrome does not allow extensions
> to run on, Hotshot tells you why. A keyboard shortcut does not open the popup,
> so a notification is the only way to explain rather than silently doing nothing.

**Optional host permissions** (`*.atlassian.net`, `api.notion.com`, `api.clickup.com`)
> Requested only when you connect that specific service, never at install. Each
> is used solely to upload a screenshot you explicitly chose to send there. If
> you disconnect a service, Hotshot hands the permission back.

**Remote code:** No. All code is bundled in the package. Hotshot loads no
script, stylesheet, font or asset from any remote origin at runtime.

---

## Single purpose statement

> Hotshot captures, annotates, and delivers screenshots of web pages.

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
> Jira, Notion, or ClickUp — using the token you provided. The data is then
> handled under that service's privacy policy, not this one.
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
- [ ] Screenshots: 1280×800, at least one, up to five — **outstanding**
- [ ] Small promo tile 440×280 — **outstanding**
- [ ] Demo video — optional, but element capture demonstrates in about eight
      seconds and is the whole pitch

**Suggested screenshots, in this order:**
1. Element capture mid-hover, exact bounds highlighted on a real card
2. The annotation toolbar with numbered badges over a screenshot
3. A pin sitting beside a half-filled bug-report form
4. The destination strip sending to Jira
5. Settings, showing "Not connected" and the local-storage note

---

## Pre-submission checks

- [ ] `npm run verify` passes (362 unit, 22 E2E, typecheck, budgets)
- [ ] Version in `package.json` bumped — the manifest reads it, so they cannot drift
- [ ] Console clean on every extension page (covered by an E2E test)
- [ ] `npm audit` reports zero vulnerabilities
- [ ] **Notion connector verified against the live API** — PRD R-1 is still open;
      ship Notion as beta, or not at all, until the spike passes
