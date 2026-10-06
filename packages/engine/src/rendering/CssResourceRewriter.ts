import postcss from "postcss";
import valueParser from "postcss-value-parser";

export type CssUrlResolver = (href: string, importing: boolean) => Promise<string | undefined>;

function decodeCssEscapes(value: string): string {
  return value.replace(/\\(?:([0-9a-f]{1,6})[ \t\r\n\f]?|(\r\n|[\r\n\f])|([\s\S]))/gi,
    (_match, hex: string | undefined, newline: string | undefined, character: string | undefined) => {
      if (hex) {
        const code = Number.parseInt(hex, 16);
        return code === 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff)
          ? "\ufffd" : String.fromCodePoint(code);
      }
      return newline ? "" : character ?? "";
    });
}

/** Parses values rather than searching CSS text: quoted strings and comments
 * containing "url(...)" must never be treated as resource requests. */
async function rewriteValue(value: string, resolve: CssUrlResolver, importing = false): Promise<string> {
  const parsed = valueParser(value);
  const urls: valueParser.FunctionNode[] = [];
  parsed.walk(node => {
    if (node.type === "function" && decodeCssEscapes(node.value).toLowerCase() === "url") {
      urls.push(node);
      return false;
    }
    return undefined;
  });
  for (const node of urls) {
    const meaningful = node.nodes.filter(child => child.type !== "comment" && child.type !== "space");
    const raw = meaningful.length === 1 && meaningful[0]?.type === "string"
      ? meaningful[0].value
      : valueParser.stringify(node.nodes).trim();
    const resolved = await resolve(decodeCssEscapes(raw), importing);
    if (resolved !== undefined) {
      node.value = "url";
      node.nodes = [{ type: "string", quote: '"', value: resolved.replace(/\\/g, "\\\\").replace(/"/g, '\\"'),
        sourceIndex: 0, sourceEndIndex: 0 }];
    }
  }
  return parsed.toString();
}

export async function rewriteCssResources(
  source: string,
  resolve: CssUrlResolver,
  declarations = false,
): Promise<string> {
  const root = postcss.parse(declarations ? `ambra-inline{${source}}` : source);
  const imports: postcss.AtRule[] = [];
  const values: postcss.Declaration[] = [];
  root.walkAtRules(rule => {
    if (decodeCssEscapes(rule.name).toLowerCase() === "import") imports.push(rule);
  });
  root.walkDecls(declaration => { values.push(declaration); });
  for (const rule of imports) {
    const parsed = valueParser(rule.params);
    const first = parsed.nodes.find(node => node.type !== "space" && node.type !== "comment");
    let missing = false;
    const resolveImport: CssUrlResolver = async href => {
      const url = await resolve(href, true);
      if (url === undefined) missing = true;
      return url;
    };
    if (first?.type === "string") {
      const url = await resolveImport(decodeCssEscapes(first.value), true);
      if (url !== undefined) {
        first.value = url.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
        first.quote = '"';
      }
      rule.params = parsed.toString();
    } else if (first?.type === "function" && decodeCssEscapes(first.value).toLowerCase() === "url") {
      const rewritten = valueParser(await rewriteValue(valueParser.stringify(first), resolveImport, true));
      const replacement = rewritten.nodes[0];
      if (replacement?.type === "function") {
        first.value = replacement.value;
        first.nodes = replacement.nodes;
      }
      rule.params = parsed.toString();
    }
    if (missing) rule.remove();
  }
  for (const declaration of values) {
    declaration.value = await rewriteValue(declaration.value, resolve);
  }
  if (!declarations) return root.toString();
  const rule = root.first;
  if (rule?.type !== "rule") throw new Error("Inline CSS declaration wrapper is unavailable.");
  return rule.nodes.map(node => node.toString()).join(";");
}
