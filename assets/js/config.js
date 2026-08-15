/**
 * Site configuration.
 *
 * WEBHOOK_URL is intentionally empty in the repository. The real address is
 * kept out of git (this repo is public) and written in at deploy time from a
 * GitHub Secret named LOAN_APPLICATION_WEBHOOK_URL - see
 * .github/workflows/static.yml.
 *
 * While it is empty the form still works end to end: the submit button shows a
 * friendly error instead of sending anywhere, so the whole site can be
 * developed and tested before the webhook address exists.
 */
export const WEBHOOK_URL = '';
