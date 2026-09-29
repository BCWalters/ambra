import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readdir } from "node:fs/promises";
import { once } from "node:events";
import path from "node:path";
import { pathToFileURL } from "node:url";
import yauzl from "yauzl";
import { parse } from "parse5";
import postcss from "postcss";

const MAX_MEMBER_BYTES = 16 * 1024 * 1024;
const DOCUMENT_EXTENSIONS = new Set([".xhtml", ".html", ".htm", ".svg"]);
const DEFAULT_CSS = [
  { property: "page-break-inside", value: "avoid" },
  { property: "break-inside", value: "avoid" },
  { property: "break-inside", value: "avoid-page" },
];

export const HELP = `Find local EPUBs containing CSS declarations or markup.

Usage: pnpm scan:epubs [options] <file-or-directory> [...]

Directories are searched recursively; no files are modified or uploaded.
With no filters, find page-break-inside: avoid and break-inside: avoid/avoid-page.

  --css PROPERTY[=VALUE]  Match a CSS declaration (repeatable).
  --tag TAG              Match an element, e.g. table, math, audio (repeatable).
  --class CLASS          Match a class token, e.g. note (repeatable).
  --json                 Print complete machine-readable results.
  --help                 Show this help.

Filters are ORed. CSS files, embedded <style>, and style attributes are scanned.
These are source matches, not proof that a CSS rule wins the cascade.
Identical archives are grouped by SHA-256; all their paths remain in results.
Exit 0: complete scan (including no matches); 1: partial/failed scan; 2: bad arguments.
`;

export function parseArguments(args) {
  const options = { css: [], tags: [], classes: [], paths: [], json: false, help: false };
  let positional = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (positional) options.paths.push(arg);
    else if (arg === "--") positional = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--help") options.help = true;
    else if (["--css", "--tag", "--class"].includes(arg)) {
      const value = args[++index];
      if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value.`);
      if (arg === "--css") {
        const separator = value.indexOf("=");
        const property = (separator < 0 ? value : value.slice(0, separator)).trim().toLowerCase();
        const expected = separator < 0 ? undefined : value.slice(separator + 1).trim().toLowerCase();
        if (!/^-?[a-z][a-z0-9-]*$/.test(property) || expected === "") {
          throw new Error("Use --css PROPERTY or --css PROPERTY=VALUE.");
        }
        options.css.push({ property, value: expected });
      } else {
        if (/\s/.test(value)) throw new Error(`${arg} requires one tag or class token.`);
        options[arg === "--tag" ? "tags" : "classes"].push(arg === "--tag" ? value.toLowerCase() : value);
      }
    } else if (arg.startsWith("-")) throw new Error(`Unknown option: ${arg}`);
    else options.paths.push(arg);
  }
  if (!options.help && options.paths.length === 0) throw new Error("Provide at least one EPUB file or directory.");
  if (!options.css.length && !options.tags.length && !options.classes.length) options.css = DEFAULT_CSS;
  return options;
}

function* elements(root) {
  if (root.tagName) yield root;
  for (const child of root.childNodes ?? []) yield* elements(child);
}

function attribute(node, name) {
  return node.attrs?.find((attr) => (attr.prefix ? `${attr.prefix}:${attr.name}` : attr.name) === name)?.value;
}

function text(node) {
  return node.value ?? (node.childNodes ?? []).map(text).join("");
}

function decode(bytes) {
  let encoding = "utf-8";
  if (bytes[0] === 0xff && bytes[1] === 0xfe) encoding = "utf-16le";
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) encoding = "utf-16be";
  else {
    const header = Buffer.from(bytes.subarray(0, 200)).toString("latin1");
    encoding = /^(?:<\?xml[^>]*encoding\s*=\s*|@charset\s*)["']([^"']+)/i.exec(header)?.[1] ?? encoding;
  }
  return new TextDecoder(encoding, { fatal: true }).decode(bytes);
}

function elementLabel(node) {
  const id = attribute(node, "id");
  const classes = attribute(node, "class")?.trim().split(/\s+/).filter(Boolean) ?? [];
  return `${node.tagName}${id ? `#${id}` : ""}${classes.map((name) => `.${name}`).join("")}`;
}

function scanCss(css, source, options, book) {
  if (!options.css.length) return;
  try {
    const root = postcss.parse(source.kind === "inline" ? `x{${css}}` : css, { from: source.member });
    root.walkDecls((declaration) => {
      const property = declaration.prop.toLowerCase();
      const value = declaration.value.replace(/\/\*[\s\S]*?\*\//g, "").trim().toLowerCase();
      if (!options.css.some((filter) => filter.property === property && (filter.value === undefined || filter.value === value))) return;
      let selector = source.element;
      const conditions = [];
      for (let node = declaration.parent; node; node = node.parent) {
        if (!selector && node.type === "rule") selector = node.selector;
        if (node.type === "atrule") conditions.unshift(`@${node.name} ${node.params}`);
      }
      book.matches.push({
        ...source,
        line: source.kind === "inline" ? source.line : (source.line ?? 1) + declaration.source.start.line - 1,
        selector, property, value: declaration.value, important: Boolean(declaration.important), conditions,
      });
    });
  } catch (error) {
    book.errors.push(`${source.member}: CSS parse failed: ${error.message}`);
  }
}

function isTextMember(member) {
  const extension = path.posix.extname(member).toLowerCase();
  return [".css", ".opf"].includes(extension) || DOCUMENT_EXTENSIONS.has(extension) || member === "META-INF/container.xml";
}

async function* zipMembers(filename) {
  const zip = await new Promise((resolve, reject) => {
    yauzl.open(filename, { lazyEntries: true, autoClose: false }, (error, archive) => error ? reject(error) : resolve(archive));
  });
  try {
    for (let index = 0; index < zip.entryCount; index++) {
      const next = once(zip, "entry");
      zip.readEntry();
      const [entry] = await next;
      if (!isTextMember(entry.fileName)) continue;
      if (entry.uncompressedSize > MAX_MEMBER_BYTES) throw new Error(`${entry.fileName}: text member exceeds the 16 MiB scan limit.`);
      const stream = await new Promise((resolve, reject) => {
        zip.openReadStream(entry, (error, input) => error ? reject(error) : resolve(input));
      });
      const chunks = [];
      let size = 0;
      for await (const chunk of stream) {
        size += chunk.length;
        if (size > MAX_MEMBER_BYTES) throw new Error(`${entry.fileName}: text member exceeds the 16 MiB scan limit.`);
        chunks.push(chunk);
      }
      yield [entry.fileName, Buffer.concat(chunks)];
    }
  } finally {
    zip.close();
  }
}

export async function scanMembers(members, options) {
  const book = { title: null, cssFiles: 0, documents: 0, matches: [], warnings: [], errors: [] };
  const metadata = new Map();
  for await (const [member, data] of members) {
    if (!isTextMember(member)) continue;
    if (data.length > MAX_MEMBER_BYTES) throw new Error(`${member}: text member exceeds the 16 MiB scan limit.`);
    const extension = path.posix.extname(member).toLowerCase();
    if (extension === ".opf" || member === "META-INF/container.xml") {
      metadata.set(member, data);
      continue;
    }
    if (extension !== ".css" && !DOCUMENT_EXTENSIONS.has(extension)) continue;
    try {
      const content = decode(data);
      if (extension === ".css") {
        book.cssFiles++;
        scanCss(content, { member, kind: "stylesheet" }, options, book);
        continue;
      }
      book.documents++;
      const document = parse(content, { sourceCodeLocationInfo: true });
      for (const node of elements(document)) {
        // HTML parsing tolerates the legacy .html files found in some EPUBs.
        if (!node.sourceCodeLocation) continue;
        const source = { member, line: node.sourceCodeLocation.startLine, element: elementLabel(node) };
        const classNames = (attribute(node, "class") ?? "").split(/\s+/);
        const matchedTags = options.tags.filter((tag) => tag === node.tagName.toLowerCase());
        const matchedClasses = options.classes.filter((name) => classNames.includes(name));
        if (matchedTags.length || matchedClasses.length) {
          book.matches.push({ ...source, kind: "element", tags: matchedTags, classes: matchedClasses });
        }
        const inline = attribute(node, "style");
        if (inline !== undefined) scanCss(inline, { ...source, kind: "inline" }, options, book);
        if (node.tagName === "style") {
          const css = text(node).replace(/^(\s*)<!\[CDATA\[([\s\S]*?)\]\]>(\s*)$/, "$1         $2   $3");
          scanCss(css, { member, kind: "style-block", line: node.sourceCodeLocation.startTag.endLine }, options, book);
        }
      }
    } catch (error) {
      book.errors.push(`${member}: could not scan: ${error.message}`);
    }
  }
  const container = metadata.get("META-INF/container.xml");
  if (container) {
    try {
      const packagePath = attribute([...elements(parse(decode(container)))].find((node) => node.tagName === "rootfile") ?? {}, "full-path");
      const packageData = metadata.get(packagePath);
      if (!packagePath || !packageData) throw new Error("Package document not found.");
      const title = [...elements(parse(decode(packageData)))].find((node) => node.tagName === "dc:title");
      book.title = title ? text(title).trim() : null;
      if (!book.title) book.warnings.push("No dc:title metadata found; use the filename to identify this book.");
    } catch (error) {
      book.errors.push(`Metadata could not be read: ${error.message}`);
    }
  } else book.warnings.push("No META-INF/container.xml; scanning archive members without package metadata.");
  return book;
}

export async function scanPaths(options) {
  const files = new Set();
  const errors = [];
  const warnings = [];
  async function discover(filename, explicit = false) {
    try {
      const info = await lstat(filename);
      if (info.isSymbolicLink()) {
        warnings.push(`Not following symbolic link: ${filename}`);
      } else if (info.isDirectory()) {
        for (const entry of (await readdir(filename)).sort()) await discover(path.join(filename, entry));
      } else if (info.isFile() && path.extname(filename).toLowerCase() === ".epub") {
        files.add(filename);
      } else if (explicit) throw new Error("Expected an EPUB file or directory.");
    } catch (error) {
      errors.push(`${filename}: ${error.message}`);
    }
  }
  for (const input of options.paths) await discover(path.resolve(input), true);
  const books = [];
  const hashes = new Map();
  for (const filename of [...files].sort()) {
    try {
      const before = await lstat(filename);
      const hash = createHash("sha256");
      for await (const chunk of createReadStream(filename)) hash.update(chunk);
      const sha256 = hash.digest("hex");
      if (hashes.has(sha256)) {
        hashes.get(sha256).files.push(filename);
        continue;
      }
      const book = { files: [filename], sha256, ...await scanMembers(zipMembers(filename), options) };
      const after = await lstat(filename);
      if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) {
        throw new Error("File changed during scan; retry when the download is complete.");
      }
      hashes.set(sha256, book);
      books.push(book);
    } catch (error) {
      errors.push(`${filename}: ${error.message}`);
    }
  }
  return {
    schemaVersion: 1,
    query: { css: options.css, tags: options.tags, classes: options.classes },
    filesFound: files.size,
    books,
    warnings,
    errors,
  };
}

export function formatReport(report) {
  const matching = report.books.filter((book) => book.matches.length);
  const lines = [
    `Scanned ${report.books.length} distinct EPUBs from ${report.filesFound} files; ${matching.length} distinct EPUBs matched.`,
    `CSS files: ${report.books.reduce((n, b) => n + b.cssFiles, 0)}; markup documents: ${report.books.reduce((n, b) => n + b.documents, 0)} (duplicates counted once).`,
  ];
  for (const book of matching) {
    lines.push(`\n${book.title ?? "(no title metadata)"}: ${book.matches.length} matches${book.errors.length ? " [PARTIAL SCAN]" : ""}`);
    for (const filename of book.files) lines.push(`  ${filename}`);
    for (const match of book.matches.slice(0, 5)) {
      const detail = match.kind === "element" ? match.element : `${match.selector ?? ""}: ${match.property}: ${match.value}${match.important ? " !important" : ""}`;
      lines.push(`  ${match.member}:${match.line} [${match.kind}] ${detail.replace(/\s+/g, " ")}${match.conditions?.length ? ` (${match.conditions.join("; ")})` : ""}`);
    }
    if (book.matches.length > 5) lines.push(`  ... ${book.matches.length - 5} more matches; use --json for all results.`);
  }
  return lines.join("\n");
}

async function main() {
  let options;
  try {
    options = parseArguments(process.argv.slice(2));
  } catch (error) {
    console.error(`${error.message}\n\n${HELP}`);
    process.exitCode = 2;
    return;
  }
  if (options.help) {
    console.log(HELP);
    return;
  }
  const report = await scanPaths(options);
  const warnings = [...report.warnings, ...report.books.flatMap((book) => book.warnings.map((warning) => `${book.files[0]}: ${warning}`))];
  const errors = [...report.errors, ...report.books.flatMap((book) => book.errors.map((error) => `${book.files[0]}: ${error}`))];
  console.log(options.json ? JSON.stringify(report, null, 2) : formatReport(report));
  for (const warning of warnings) console.error(`Warning: ${warning}`);
  for (const error of errors) console.error(`Error: ${error}`);
  if (errors.length) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main();
}
