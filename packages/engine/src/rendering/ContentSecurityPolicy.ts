/** Shared by the frame's required policy and XHTML's additional meta policy.
 * Frame-level enforcement also covers XML/SVG roots without an HTML head. */
export const CONTENT_SECURITY_POLICY =
  "default-src 'none'; script-src 'none'; img-src blob:; style-src blob: 'unsafe-inline'; " +
  "font-src blob:; media-src blob:; base-uri 'none'; form-action 'none';";
