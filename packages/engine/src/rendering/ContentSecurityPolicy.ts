/** Shared by the frame's required policy and XHTML's additional meta policy.
 * Frame-level enforcement also covers XML/SVG roots without an HTML head. */
function contentPolicy(source: "blob: data:" | "data:"): string {
  return "default-src 'none'; script-src 'none'; " +
    `img-src ${source}; style-src ${source} 'unsafe-inline'; font-src ${source}; ` +
    `media-src ${source}; frame-src ${source}; base-uri 'none'; form-action 'none';`;
}

// Opaque children inherit this policy and require generated data dependencies.
// Author-supplied data references are still rejected during resource assembly.
export const CONTENT_SECURITY_POLICY = contentPolicy("blob: data:");
export const NESTED_CONTENT_SECURITY_POLICY = contentPolicy("data:");
