import { describe, expect, it } from "vitest";
import { DiagnosticsLog } from "./DiagnosticsLog.js";
import { captureDiagnosticNotification } from "./NotificationDiagnostics.js";

describe("notification-bound local diagnostics", () => {
  it("captures the visible message, operation and exception chain without retaining mutable errors", () => {
    const cause = new Error("Underlying failure");
    cause.stack = "cause stack";
    const error = new Error("Page failure", { cause });
    error.stack = "page stack";
    Object.assign(error, { publicationText: "private passage", credentials: "private token" });
    const notification = captureDiagnosticNotification({
      message: "Couldn't open the next page.", detail: "Visible technical detail",
      severity: "transient", notificationId: 7, operation: "open the next page",
      spineIndex: 2, pageIndex: 4,
    }, error);
    error.message = "Later failure";
    error.stack = "later stack";
    cause.message = "Later cause";
    const report = new DiagnosticsLog().format({ spineIndex: "3" }, notification);
    for (const text of ["Couldn't open the next page.", "Visible technical detail", "open the next page",
      "Page failure", "page stack", "Underlying failure", "cause stack", "Spine index at notification: 2",
      "Page index at notification: 4", "Notification ID: 7"]) expect(report).toContain(text);
    expect(report).toContain("spineIndex: 3");
    expect(report).not.toMatch(/Later|later|private/);
    expect(Object.isFrozen(notification)).toBe(true);
    expect(Object.isFrozen(notification.exceptions[0])).toBe(true);
  });

  it("omits notification details in ordinary reports and explicitly marks missing optional details", () => {
    const log = new DiagnosticsLog();
    expect(log.format({})).not.toContain("Associated notification");
    const report = log.format({}, captureDiagnosticNotification({ message: "No reading order", severity: "blocking" }));
    expect(report).toContain('Message: "No reading order"');
    for (const field of ["Operation", "Technical detail", "Exception name", "Exception message", "Stack", "Cause"]) {
      expect(report).toContain(`${field}: unavailable`);
    }
    expect(report).toContain("review before sharing");
    expect(report).toContain("No automatic upload");
  });

  it("supports non-Error thrown values and foreign-realm error records without arbitrary payloads", () => {
    const input = { message: "Visible", severity: "actionFailed" as const };
    expect(new DiagnosticsLog().format({}, captureDiagnosticNotification(input, "string failure"))).toContain("string failure");
    const record = { name: "RemoteError", message: "remote failure", stack: "remote stack", text: "private passage" };
    const report = new DiagnosticsLog().format({}, captureDiagnosticNotification(input, record));
    expect(report).toContain("RemoteError");
    expect(report).toContain("remote stack");
    expect(report).not.toContain("private");
    expect(captureDiagnosticNotification(input, { text: "private passage" }).exceptions).toEqual([]);
  });

  it("bounds large error details and cyclic causes alongside the full event/context limits", () => {
    const log = new DiagnosticsLog();
    for (let index = 0; index < 600; index++) log.record("x\n".repeat(10000));
    const context = Object.fromEntries(Array.from({ length: 100 }, (_, i) =>
      [`${i}${"k".repeat(1000)}`, "v\n".repeat(10000)]));
    const error = new Error("\0".repeat(10000));
    error.stack = "\0".repeat(10000);
    const cause = new Error(error.message);
    const last = new Error(error.message);
    for (const exception of [error, cause, last]) {
      exception.name = "\0".repeat(10000);
      exception.stack = error.stack;
    }
    error.cause = cause;
    cause.cause = last;
    last.cause = error;
    const report = log.format(context, captureDiagnosticNotification({
      message: "\0".repeat(10000), detail: "\0".repeat(10000), operation: "\0".repeat(10000), severity: "blocking",
    }, error));
    expect(report).toContain("[truncated]");
    expect(report).toContain("cyclic chain");
    expect(report.length).toBeLessThan(330000);
    expect(report.match(/\] /g)).toHaveLength(500);
  });
});
