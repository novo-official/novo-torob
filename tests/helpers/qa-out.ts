import path from "node:path";

/**
 * Where automated QA runs write screenshots and JSON reports.
 * Default is the git-ignored /qa-artifacts directory (not test-results/: Playwright wipes that on every run), so a test run
 * can never modify the curated, tracked reference material under docs/qa/. Updating docs/qa is a deliberate, owner-approved act:
 *   QA_OUTPUT_DIR=docs/qa npx playwright test ...
 */
export const QA_OUT = path.resolve(process.env.QA_OUTPUT_DIR || "qa-artifacts");
export const qaPath = (...parts: string[]) => path.join(QA_OUT, ...parts);
