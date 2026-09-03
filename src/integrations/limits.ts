import type { ProviderId } from '../storage/token-repo'

/**
 * Attachment size limits, per service (PRD §7).
 *
 * A DPR-2 full-page capture of a long page routinely exceeds every one of
 * these, and a 413 arrives at the worst possible moment — after the user has
 * annotated the capture and pressed send. The editor compresses to fit before
 * uploading rather than discovering the problem at the last step (FR-32).
 *
 * Every number here is stated with its provenance, because the PRD's §7 rule
 * is that an unknown limit is marked unknown rather than invented.
 */
export const ATTACHMENT_LIMIT_BYTES: Readonly<Record<ProviderId, number>> = {
  /**
   * Jira Cloud's default per-attachment cap is 10 MB, and site admins can
   * lower it. Assuming the default is the safe direction to be wrong in: a
   * capture that fits a stricter site also fits a laxer one.
   */
  jira: 10_000_000,
  /** Documented: the Notion file-upload API caps a single-part upload at 20 MB. */
  notion: 20_000_000,
  /**
   * UNVERIFIED. ClickUp does not document a per-attachment limit, so this is a
   * deliberately generous guard that only catches the genuinely absurd — not a
   * number pretending to be the real one. Replace it once it is measured
   * against a live account.
   */
  clickup: 50_000_000,
  /** Documented: Slack's file limit is 1 GB, far above anything a capture is. */
  slack: 50_000_000,
  /** UNVERIFIED. Linear documents no per-asset limit; guard only. */
  linear: 50_000_000,
  /** Documented: Trello's free-plan attachment limit is 10 MB. Assume the strictest. */
  trello: 10_000_000,
  /** Documented: Asana caps an attachment at 100 MB. */
  asana: 100_000_000,
  /**
   * Dropbox's single-request upload limit is 150 MB; above that needs the
   * chunked session API, which is out of scope. Capping here means a capture
   * that would need chunking is compressed rather than failing at the wall.
   */
  dropbox: 150_000_000,
}
