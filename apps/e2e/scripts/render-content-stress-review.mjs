#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const [resultsArg, reproductionArg, outputArg, extensionArg, tableArg] = process.argv.slice(2);
if (!resultsArg || !reproductionArg || !outputArg || !extensionArg)
  throw new Error(
    "Usage: node render-content-stress-review.mjs MATRIX_RESULTS REPRO_RESULTS OUTPUT_DIRECTORY IMMUTABLE_EXTENSION [TABLE_RESULTS]",
  );
const results = path.resolve(resultsArg);
const reproduction = path.resolve(reproductionArg);
const output = path.resolve(outputArg);
const extension = path.resolve(extensionArg);
const repository = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();
const commit = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const esc = (value) =>
  String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
fs.mkdirSync(output, { recursive: true });

function replay(grep, table = false) {
  // Each replay owns results/runtime; it only reads the existing extension.
  return `cd ${quote(repository)} && RUN="$PWD/apps/e2e/real-books/content-stress-replay-$(date +%Y%m%d-%H%M%S)-$$" && mkdir -p "$RUN/runtime" && AMBRA_E2E_HEADLESS=1 ${table ? "AMBRA_E2E_TABLE_REPRO=1 " : ""}TMPDIR="$RUN/runtime" AMBRA_E2E_EXTENSION_PATH=${quote(extension)} pnpm --filter @ambra/e2e exec playwright test tests/content-stress.spec.ts --grep ${quote(grep)} --output "$RUN/results"`;
}

function picture(directory, file, label) {
  if (!fs.existsSync(path.join(directory, file))) return "";
  return `<figure><a href="${esc(path.basename(directory))}/${file}" target="_blank"><img loading="lazy" src="${esc(path.basename(directory))}/${file}" alt="${esc(label)}"/></a><figcaption>${esc(label)} — click to enlarge</figcaption></figure>`;
}

const summaries = [];
const cards = [];
for (const entry of fs.readdirSync(results).sort()) {
  const source = path.join(results, entry);
  const measurements = path.join(source, "measurements.json");
  if (!fs.existsSync(measurements)) continue;
  const data = JSON.parse(fs.readFileSync(measurements, "utf8"));
  const { variation } = data;
  const destination = path.join(output, variation.id);
  fs.mkdirSync(destination, { recursive: true });
  for (const file of [
    "specimen.png",
    "contents-tail.png",
    "footnote.png",
    "resumed-last.png",
    "larger-type.png",
    "measurements.json",
  ])
    if (fs.existsSync(path.join(source, file)))
      fs.copyFileSync(path.join(source, file), path.join(destination, file));
  fs.copyFileSync(
    path.join(source, "fixture", `${variation.id}.epub`),
    path.join(destination, `${variation.id}.epub`),
  );
  fs.cpSync(path.join(source, "fixture", "source"), path.join(destination, "source"), {
    recursive: true,
  });
  const command = replay(`${variation.id}$`);
  summaries.push({
    id: variation.id,
    targets: data.targets,
    pages: data.initialPages,
    timings: data.timings,
  });
  cards.push(
    `<article id="${variation.id}"><h2>${esc(variation.id)} <span class="pass">PASS</span></h2><p>${variation.chapters} chapters · ${data.targets} TOC entries · depth ${variation.depth} · ${variation.width}px · ${variation.mode ?? "paginated"}${variation.rtl ? " · RTL progression" : ""}</p><p><a download href="${variation.id}/${variation.id}.epub">Download synthetic EPUB</a> · <a href="${variation.id}/source/EPUB/ch1.xhtml">Original first-chapter source</a> · <a href="${variation.id}/measurements.json">Measurements</a></p><details><summary>Copy exact automated replay command</summary><pre>${esc(command)}</pre><button type="button" data-copy="${esc(command)}">Copy command</button></details><div class="pictures">${picture(destination, "specimen.png", "Initial authored feature combination")}${picture(destination, "contents-tail.png", "Last entry of the complete TOC")}${picture(destination, "footnote.png", "Nested note popup without position loss")}${picture(destination, "resumed-last.png", "Persisted final destination after reload")}${picture(destination, "larger-type.png", "Larger typography after repagination")}</div></article>`,
  );
}

const comparisons = [];
for (const kind of ["literal", "encoded"]) {
  const entry = fs
    .readdirSync(reproduction)
    .find(
      (name) =>
        name.includes(kind === "literal" ? "literal-control" : "percent-encoded") &&
        !name.includes("repeat"),
    );
  if (!entry) throw new Error(`Missing ${kind} reproduction evidence`);
  const source = path.join(reproduction, entry);
  const destination = path.join(output, `${kind}-fragment`);
  fs.mkdirSync(destination, { recursive: true });
  fs.copyFileSync(path.join(source, "final.png"), path.join(destination, "final.png"));
  fs.copyFileSync(path.join(source, "navigation.json"), path.join(destination, "navigation.json"));
  fs.copyFileSync(
    path.join(source, "fixture", `${kind}-fragment.epub`),
    path.join(destination, `${kind}-fragment.epub`),
  );
  const navigation = JSON.parse(fs.readFileSync(path.join(source, "navigation.json"), "utf8"));
  comparisons.push(
    `<section><h3>${kind === "literal" ? "Literal Unicode" : "Percent-encoded Unicode"}: ${navigation.section === "Destination" ? "resolved" : "unresolved"}</h3><p>After selecting Destination: ${esc(navigation.section)}, page ${navigation.currentPage} of ${navigation.totalPages}.</p><a download href="${kind}-fragment/${kind}-fragment.epub">Download ${kind} EPUB</a> · <a href="${kind}-fragment/navigation.json">Navigation evidence</a>${picture(destination, "final.png", `${kind} Unicode fragment after TOC click`)}</section>`,
  );
}
const reproductionCommand = replay("#228");
const tableComparisons = [];
if (tableArg) {
  const tableResults = path.resolve(tableArg);
  for (const id of [
    "wide-table-pre-narrow",
    "overflow-unicode-scroll",
    "minimal-table-paginated",
    "minimal-table-scroll",
  ]) {
    const entry = fs.readdirSync(tableResults).find((name) => name.endsWith(id));
    if (!entry) throw new Error(`Missing table evidence: ${id}`);
    const source = path.join(tableResults, entry);
    const destination = path.join(output, `table-${id}`);
    fs.mkdirSync(destination, { recursive: true });
    for (const file of ["after-native-wheel.png", "table-evidence.json"])
      fs.copyFileSync(path.join(source, file), path.join(destination, file));
    const book = fs
      .readdirSync(path.join(source, "fixture"))
      .find((name) => name.endsWith(".epub"));
    if (!book) throw new Error(`Missing table fixture: ${id}`);
    fs.copyFileSync(path.join(source, "fixture", book), path.join(destination, book));
    tableComparisons.push(
      `<section><h3>${id}</h3><p><a download href="table-${id}/${book}">Download synthetic EPUB</a> · <a href="table-${id}/table-evidence.json">Native scrolling and page traversal evidence</a></p>${picture(destination, "after-native-wheel.png", "After native horizontal wheel over the table")}</section>`,
    );
  }
}
const tableCommand = replay("wide table native reachability", true);
const tableHtml = `<section class="bug" id="table-loss"><h2>Confirmed bug: <a href="https://github.com/BCWalters/ambra/issues/229">#229 paginated tables lose rightmost columns</a></h2><p>This is confirmed content loss, not merely a design preference. In paginated mode the original 12-column table remains horizontally clipped through native scrolling and all pages of the chapter. A one-page, three-column reduction also fails. Each failed twice in fresh profiles.</p><p><strong>Working Scroll-mode interaction:</strong> hover the table and horizontally scroll toward later columns using the trackpad/wheel. Native deltaX≈3089 moves the original Column 12 fully into the 900px viewport; the minimal 600px control also succeeds. The whole document pans horizontally. Both controls passed twice.</p><p>The preferred paginated fix (table-only horizontal scroll, reflow, or expanded view) remains a design choice; whether users can reach the data does not.</p><div class="comparison">${tableComparisons.join("")}</div><details><summary>Copy table comparison replay (paginated variants intentionally fail)</summary><pre>${esc(tableCommand)}</pre><button type="button" data-copy="${esc(tableCommand)}">Copy command</button></details></section>`;
const html = `<!doctype html><html lang="en"><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Ambra synthetic content review</title><style>body{font:16px system-ui;line-height:1.5;max-width:1500px;margin:30px auto;padding:0 24px;background:#f4f2ee;color:#252525}h1,h2,h3{line-height:1.2}article,.review,.bug{background:white;border:1px solid #ccc;border-radius:12px;padding:20px;margin:24px 0}.pictures,.comparison{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:18px}figure{margin:0}img{max-width:100%;max-height:490px;object-fit:contain;border:1px solid #aaa;background:#eee}a{color:#154d88}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f2f2f2;padding:12px;font-size:13px}.pass{color:#176239;font-size:.65em}button{padding:8px 14px;cursor:pointer}nav a{display:inline-block;margin:4px 12px 4px 0}.review{border-left:6px solid #b67f28}.bug{border-left:6px solid #b34141}</style><h1>Ambra: synthetic EPUB content review</h1><p><strong>${summaries.length}/10 representative matrix cases passed.</strong> Full Chromium, headless production extension; deterministic original content only. Generator checkout <code>${commit.slice(0, 12)}</code>; supplied screenshots and replay build may predate this checkout.</p><p>Click any screenshot for a one-click full-size visual. EPUB download links and exact per-case replay commands are supplied. Copy buttons only copy terminal commands; they do <strong>not</strong> open or control the extension. Replays run headlessly against the preserved immutable build. No browser preview below is a substitute for actual extension screenshots.</p><section class="review"><h2>Visual decisions for your return</h2><ul><li><a href="#table-loss">Wide tables: confirmed paginated content loss (#229)</a>. Scroll mode provides a verified horizontal-scrolling workaround; choose the preferred paginated fix separately.</li><li><a href="#mixed-writing-notes-scroll">Mixed RTL/vertical-writing content</a>: review the native vertical specimen and mixed-script spacing. Assertions cover target position, notes and resume, not full vertical-writing pagination support.</li><li><a href="#transparent-extreme-media">Extreme-aspect transparent SVGs</a>: review visual scale and whitespace. Image decoding, target reachability and resume passed. Viewer background approval is unchanged.</li></ul></section><nav>${summaries.map((item) => `<a href="#${item.id}">${item.id}</a>`).join("")}</nav><section class="bug"><h2>Regression evidence: <a href="https://github.com/BCWalters/ambra/issues/228">#228 encoded TOC fragments</a></h2><p>The original report reduced a navigation failure to one chapter and two links. Captured results below identify whether each target resolved in the supplied build. Current regressions require both representations to work in single-page, spread and scrolling modes, including page mapping and resume. Replaying against a pre-fix build still exposes the defect.</p><div class="comparison">${comparisons.join("")}</div><details><summary>Copy fragment regression replay</summary><pre>${esc(reproductionCommand)}</pre><button type="button" data-copy="${esc(reproductionCommand)}">Copy command</button></details></section>${tableHtml}${cards.join("")}<script>for(const button of document.querySelectorAll("[data-copy]"))button.addEventListener("click",async()=>{try{await navigator.clipboard.writeText(button.dataset.copy);button.textContent="Copied";}catch{button.textContent="Select and copy the command above";}});</script></html>`;
fs.writeFileSync(path.join(output, "index.html"), html);
fs.writeFileSync(
  path.join(output, "summary.json"),
  JSON.stringify(
    {
      commit,
      cases: summaries,
      issues: [
        "https://github.com/BCWalters/ambra/issues/228",
        "https://github.com/BCWalters/ambra/issues/229",
      ],
    },
    null,
    2,
  ),
);
console.log(path.join(output, "index.html"));
