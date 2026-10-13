export interface DiagnosticException {
  readonly name?: string;
  readonly message?: string;
  readonly stack?: string;
}

export interface DiagnosticNotification {
  readonly message: string;
  readonly headline?: string;
  readonly severity: "blocking" | "navigationFailed" | "transient" | "actionFailed" | "info";
  readonly notificationId?: number;
  readonly detail?: string;
  readonly operation?: string;
  readonly spineIndex?: number;
  readonly pageIndex?: number;
  readonly exceptions: readonly DiagnosticException[];
  readonly causeLimitReached: boolean;
}

function bounded(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit)} [truncated]` : value;
}

export function captureDiagnosticNotification(
  notification: Omit<DiagnosticNotification, "exceptions" | "causeLimitReached">,
  error?: unknown,
): DiagnosticNotification {
  const exceptions: DiagnosticException[] = [];
  const seen = new Set<unknown>();
  let current = error;
  while (current !== undefined && current !== null && exceptions.length < 3 && !seen.has(current)) {
    seen.add(current);
    if (typeof current === "object") {
      const name = "name" in current && typeof current.name === "string" ? bounded(current.name, 128) : undefined;
      const message = "message" in current && typeof current.message === "string" ? bounded(current.message, 512) : undefined;
      const stack = "stack" in current && typeof current.stack === "string" ? bounded(current.stack, 2048) : undefined;
      if (name === undefined && message === undefined && stack === undefined) {
        current = undefined;
        break;
      }
      exceptions.push(Object.freeze({ name, message, stack }));
      current = "cause" in current ? current.cause : undefined;
    } else if (typeof current !== "function") {
      exceptions.push(Object.freeze({ message: bounded(String(current), 512) }));
      current = undefined;
    } else {
      current = undefined;
    }
  }
  return Object.freeze({
    ...notification,
    message: bounded(notification.message, 4096),
    headline: notification.headline === undefined ? undefined : bounded(notification.headline, 512),
    detail: notification.detail === undefined ? undefined : bounded(notification.detail, 4096),
    operation: notification.operation === undefined ? undefined : bounded(notification.operation, 512),
    exceptions: Object.freeze(exceptions),
    causeLimitReached: current !== undefined && current !== null,
  });
}

export function formatDiagnosticNotification(notification: DiagnosticNotification): string[] {
  const field = (name: string, value: string | number | undefined, limit = 512): string =>
    `${name}: ${value === undefined ? "unavailable" : bounded(JSON.stringify(value), limit)}`;
  return [
    "",
    "Associated notification (captured when shown; session state below may have changed):",
    field("Message", notification.message, 4096),
    field("Headline", notification.headline),
    field("Severity", notification.severity),
    field("Notification ID", notification.notificationId),
    field("Operation", notification.operation),
    field("Spine index at notification", notification.spineIndex),
    field("Page index at notification", notification.pageIndex),
    field("Technical detail", notification.detail, 4096),
    ...((notification.exceptions.length ? notification.exceptions : [{}]).flatMap((error, index) => [
      field(index === 0 ? "Exception name" : `Cause ${index} name`, error.name, 128),
      field(index === 0 ? "Exception message" : `Cause ${index} message`, error.message),
      field(index === 0 ? "Stack" : `Cause ${index} stack`, error.stack, 2048),
    ])),
    `Cause: ${notification.exceptions.length > 1 ? "included above" : notification.causeLimitReached ? "omitted (bounded or cyclic chain)" : "unavailable"}`,
    ...(notification.causeLimitReached ? ["Further cause details: omitted (bounded or cyclic chain)"] : []),
  ];
}
