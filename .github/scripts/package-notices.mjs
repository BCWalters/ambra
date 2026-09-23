import { spawnSync } from "node:child_process";
import { readFile, readdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";

export async function dependencyNotices(root, inventory, overrides) {
  const sections = [];
  const seen = new Set();
  const licenseName = /^(licen[cs]e|copying)([._-]|$)/i;
  const noticeName = /^notice([._-]|$)/i;
  const nodeModules = `${await realpath(path.join(root, "node_modules"))}${path.sep}`;
  for (const dependency of Object.values(inventory)
    .flat()
    .sort((a, b) => a.name.localeCompare(b.name))) {
    if (!["MIT", "Apache-2.0", "BSD-3-Clause", "0BSD"].includes(dependency.license)) {
      throw new Error(`Review the new dependency license before packaging: ${dependency.name}`);
    }
    for (const directory of dependency.paths) {
      if (!(await realpath(directory)).startsWith(nodeModules)) {
        throw new Error("Dependency licenses must come from project-local node_modules.");
      }
      const pkg = JSON.parse(await readFile(path.join(directory, "package.json"), "utf8"));
      const id = `${pkg.name}@${pkg.version}`;
      if (seen.has(id)) continue;
      seen.add(id);
      const entries = (await readdir(directory, { withFileTypes: true }))
        .filter(
          (entry) =>
            entry.isFile() && (licenseName.test(entry.name) || noticeName.test(entry.name)),
        )
        .map((entry) => entry.name)
        .sort();
      const texts = [];
      for (const entry of entries) {
        texts.push(await readFile(path.join(directory, entry), "utf8"));
      }
      if (!entries.some((entry) => licenseName.test(entry))) {
        const override = overrides[id];
        if (typeof override !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_.-]*\.txt$/.test(override)) {
          throw new Error(
            `Missing installed license text for ${id}; add a version-pinned license override.`,
          );
        }
        texts.unshift(await readFile(path.join(root, "store-assets/licenses", override), "utf8"));
      }
      if (texts.some((text) => text.trim().length < 100)) {
        throw new Error(`Incomplete dependency license/notice text for ${id}.`);
      }
      sections.push(`${id}\nLicense: ${dependency.license}\n\n${texts.join("\n\n").trim()}`);
    }
  }
  if (!sections.length) throw new Error("No installed production dependency licenses found.");
  return `Third-party license and notice texts\nIncludes installed production dependencies; some may be removed by bundling.\n\n${sections.join("\n\n========================================\n\n")}\n`;
}

export async function writeNotices(root, buildDir) {
  const result = spawnSync("pnpm", ["licenses", "list", "--prod", "--json"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) throw new Error("Production license inventory failed.");
  const overrides = JSON.parse(
    await readFile(path.join(root, "store-assets/licenses/overrides.json"), "utf8"),
  );
  const notices = await dependencyNotices(root, JSON.parse(result.stdout), overrides);
  for (const file of ["LICENSE", "THIRD_PARTY_NOTICES.md"]) {
    await writeFile(path.join(buildDir, file), await readFile(path.join(root, file)));
  }
  await writeFile(path.join(buildDir, "THIRD_PARTY_LICENSES.txt"), notices);
}
