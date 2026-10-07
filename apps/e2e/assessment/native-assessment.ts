import { expect, type TestInfo } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { launchReader } from "../harness.js";
import { exposeReaderController } from "../reader-controller.js";

export function requiredAssessmentPath(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for the opt-in assessment.`);
  return path.resolve(value);
}

interface Measurement {
  readonly observations: unknown;
  readonly passed: boolean;
  readonly reason: string;
  readonly trackingIssue: string;
}

export async function assessNativeCriterion(
  id: string,
  info: TestInfo,
  measure: (launched: Awaited<ReturnType<typeof launchReader>>) => Promise<Measurement>,
): Promise<void> {
  const output = requiredAssessmentPath("AMBRA_ASSESSMENT_OUTPUT");
  const worksheet: { release: unknown } = JSON.parse(
    fs.readFileSync(requiredAssessmentPath("AMBRA_ASSESSMENT_PATH"), "utf8"),
  );
  const evidence = process.env.AMBRA_ASSESSMENT_EVIDENCE_URL;
  if (
    !evidence ||
    !/^https:\/\/github\.com\/BCWalters\/ambra\/actions\/runs\/[1-9]\d*$/.test(evidence)
  )
    throw new Error("An exact GitHub assessment-run evidence URL is required.");
  fs.mkdirSync(output, { recursive: true });
  let launched: Awaited<ReturnType<typeof launchReader>> | undefined;
  let browserVersion: string | null = null;
  let observations: unknown = null;
  let result = {
    status: "not-run",
    method: "automated",
    reason: "Criterion execution did not complete.",
    evidence,
    trackingIssue: null as string | null,
  };
  try {
    launched = await launchReader(
      path.join(requiredAssessmentPath("AMBRA_EPUB_TESTS_PATH"), "tests", `${id}.epub`),
      { viewport: { width: 900, height: 900 } },
    );
    const session = await launched.context.newCDPSession(launched.readerPage);
    browserVersion = (await session.send("Browser.getVersion")).product;
    await session.detach();
    await exposeReaderController(launched.readerPage);
    const measured = await measure(launched);
    observations = measured.observations;
    result = {
      ...result,
      status: measured.passed ? "pass" : "fail",
      reason: measured.reason,
      trackingIssue: measured.passed ? null : measured.trackingIssue,
    };
    await info.attach(`${id}-observed.json`, {
      body: JSON.stringify(observations),
      contentType: "application/json",
    });
    console.log(`${id}: ${result.status}: ${JSON.stringify(observations)}`);
  } catch (error) {
    result.status = "not-run";
    result.trackingIssue = null;
    result.reason = `Execution blocked before criterion assessment: ${error instanceof Error ? error.message : String(error)}.`;
    console.error(`${id}: ${result.reason}`);
    throw error;
  } finally {
    fs.writeFileSync(
      path.join(output, `${id}.json`),
      JSON.stringify(
        {
          id,
          release: worksheet.release,
          environment: {
            testedAt: new Date().toISOString(),
            browser: { name: "Chromium", version: browserVersion },
            os: { name: os.type(), version: os.release() },
          },
          result,
          observations,
        },
        null,
        2,
      ),
    );
    if (launched) await launched.context.close();
  }
  expect(result.status, `${id}: official criterion verdict`).toBe("pass");
}
