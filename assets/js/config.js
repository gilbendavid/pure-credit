/**
 * Site configuration.
 *
 * WEBHOOK_URL is normally empty in the repository. The real address is kept out
 * of git (this repo is public) and written in at deploy time from a GitHub
 * Secret named LOAN_APPLICATION_WEBHOOK_URL - see .github/workflows/static.yml.
 * That step rewrites this whole file, so anything else added here is lost on
 * deploy; keep the single WEBHOOK_URL export.
 *
 * While it is empty the form still works end to end: the submit button shows a
 * friendly error instead of sending anywhere, so the whole site can be
 * developed and tested before the webhook address exists.
 *
 * Always the PRODUCTION url (.../webhook/...). The n8n test url
 * (.../webhook-test/...) only answers for a single call right after you press
 * "Execute workflow" in the n8n editor, so it is useless as a default. To aim a
 * submission at it, load the page with ?webhook=test - app.js swaps the path.
 */
export const WEBHOOK_URL =
  "https://ben-david-automation.app.n8n.cloud/webhook/loan-application";
