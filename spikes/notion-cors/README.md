# Spike: does Notion's API work from an MV3 extension?

**Status:** harness ready, NOT YET RUN — needs a Notion integration token.
**Risk it retires:** PRD R-1, the largest schedule variance in v1.0.
**Timebox:** 3 days (Architecture §8, stage 3).

## The question

`api.notion.com` sends no CORS headers for browser origins. Notion's own docs
say the API is not intended to be called from a browser. Hotshot has no
backend, so if the browser rule also binds an extension, "send to Notion"
cannot ship as specified.

The expectation is that it **does** work: an MV3 service worker fetching a host
listed in `host_permissions` is not subject to page CORS. But "expected to
work" is not an answer, and the PRD marks this **VERIFY** rather than asserting
it. This harness settles it with the real API.

## What it must prove, in order

1. **The 3-step upload completes end to end.**
   `POST /v1/file_uploads` → `POST /v1/file_uploads/{id}/send` (multipart,
   field `file`) → `PATCH /v1/blocks/{block_id}/children` with an `image` block
   of type `file_upload`.
2. **It works from the service worker**, with the host granted as an
   *optional* permission at runtime — not declared at install (FR-23).
3. **It fails the way we predict when the host is NOT granted**, which is what
   proves the permission is doing the work rather than something incidental.
4. **The `Notion-Version` we pin is accepted**, and an unknown one is rejected
   loudly rather than silently changing behaviour.
5. **The un-shared-integration case returns 404**, so FR-30's copy ("you
   haven't invited the integration to this page") is triggered by a real
   status and not a guess. This is expected to be the top support burden.

## Running it

1. Create an internal integration: <https://www.notion.so/my-integrations>.
   Capabilities needed: **insert content**. Copy the `ntn_…` token.
2. Create a Notion page for the spike. **Share it with the integration** via
   the page's ••• menu → Connections. Copy the page ID from the URL.
3. Build and load the extension, then run in the service worker console:

   ```js
   await runNotionSpike({ token: 'ntn_…', pageId: '…' })
   ```

   `runNotionSpike` is exposed on `globalThis` by `spike.ts` in dev builds only.

4. Record every result in `RESULTS.md` — including the failures. A spike that
   only records the happy path has not de-risked anything.

## Decision this feeds

- **All five pass** → Notion stays P0 in v1.0.
- **CORS blocks it even with the host permission** → Notion drops to "beta" and
  v1.0 ships Jira + ClickUp (PRD §10 cut line, cut #1). This is the outcome the
  cut line was designed around, so it costs schedule, not architecture.
- **Anything else** → bring the result back before writing the connector. Do
  not code around a surprise discovered in a spike; re-decide with it.
