import postcss from "postcss";
import valueParser from "postcss-value-parser";
import type { ResourceConsumer } from "./ResourceCapabilities.js";

export type CssUrlResolver = (href: string, importing: boolean, consumer?: ResourceConsumer) => Promise<string | undefined>;

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
async function rewriteValue(value: string, resolve: CssUrlResolver, importing = false, consumer?: ResourceConsumer): Promise<string> {
  const parsed = valueParser(value);
  const urls: { node: valueParser.FunctionNode; nodes: valueParser.Node[] }[] = [];
  parsed.walk((node, _index, nodes) => {
    if (node.type === "function" && decodeCssEscapes(node.value).toLowerCase() === "url") {
      urls.push({ node, nodes });
      return false;
    }
    return undefined;
  });
  for (const { node, nodes } of urls) {
    if (!nodes.includes(node)) continue;
    const meaningful = node.nodes.filter(child => child.type !== "comment" && child.type !== "space");
    const raw = meaningful.length === 1 && meaningful[0]?.type === "string"
      ? meaningful[0].value
      : valueParser.stringify(node.nodes).trim();
    const resolved = await resolve(decodeCssEscapes(raw), importing, consumer);
    if (resolved !== undefined) {
      node.value = "url";
      node.nodes = [{ type: "string", quote: '"', value: resolved.replace(/\\/g, "\\\\").replace(/"/g, '\\"'),
        sourceIndex: 0, sourceEndIndex: 0 }];
      if (consumer === "font") {
        const index = nodes.indexOf(node);
        const next = nodes.slice(index + 1).find(child => child.type !== "space" && child.type !== "comment");
        if (next?.type === "function" && decodeCssEscapes(next.value).toLowerCase() === "format") {
          nodes.splice(nodes.indexOf(next), 1);
        }
      }
    } else {
      // Remove only this comma-delimited alternative, preserving other font
      // sources or background layers when one resource is unavailable.
      const index = nodes.indexOf(node);
      let start = index;
      let end = index + 1;
      while (start > 0 && !(nodes[start - 1]?.type === "div" && nodes[start - 1]?.value === ",")) start--;
      while (end < nodes.length && !(nodes[end]?.type === "div" && nodes[end]?.value === ",")) end++;
      if (end < nodes.length) end++;
      else if (start > 0) start--;
      nodes.splice(start, end - start);
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
    let parent = declaration.parent;
    while (parent && parent.type !== "atrule" && parent.type !== "root") parent = parent.parent;
    const font = parent?.type === "atrule" && decodeCssEscapes(parent.name).toLowerCase() === "font-face";
    declaration.value = await rewriteValue(declaration.value, resolve, false,
      font ? "font" : declaration.prop.startsWith("--") ? "auto" : "image");
    if (!declaration.value.trim()) declaration.remove();
  }
  if (!declarations) return root.toString();
  const rule = root.first;
  if (rule?.type !== "rule") throw new Error("Inline CSS declaration wrapper is unavailable.");
  return rule.nodes.map(node => node.toString()).join(";");
}
