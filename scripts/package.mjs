import "./build.mjs";
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { zipSync, unzipSync, strFromU8 } from "fflate";
const files = {};
async function collect(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await collect(path);
    else
      files[relative("dist", path).replaceAll("\\", "/")] = new Uint8Array(
        await readFile(path),
      );
  }
}
await collect("dist");
files["README.md"] = new Uint8Array(await readFile("README.md"));
for (const path of [
  "docs/COMPATIBILITY.md",
  "docs/ARCHITECTURE.md",
  "docs/TESTING.md",
  "docs/PERFORMANCE.md",
])
  files[path] = new Uint8Array(await readFile(path));
const bytes = zipSync(files, { level: 6 });
const checked = unzipSync(bytes);
const manifest = JSON.parse(strFromU8(checked["manifest.json"]));
// Lazy modules are core functionality: validate the complete built output graph.
const meta = JSON.parse(await readFile(".test-core/build-meta.json", "utf8"));
for (const [path, output] of Object.entries(meta.outputs)) {
  const entry = relative("dist", path).replaceAll("\\", "/");
  if (!checked[entry] || checked[entry].length !== output.bytes)
    throw new Error(`Package missing or truncated module ${entry}`);
}
for (const path of [
  "popup.html",
  "manager.html",
  "app.js",
  "content.js",
  "background.js",
  "document-worker.js",
  "pdf.worker.mjs",
  "icons/icon-128.png",
])
  if (!checked[path]) throw new Error(`Package missing ${path}`);
await mkdir("downloads", { recursive: true });
await writeFile("resume-assist.zip", bytes);
await writeFile("downloads/resume-assist.zip", bytes);
console.log(
  `Packaged ${manifest.name} ${manifest.version}: manifest.json at ZIP root, ${Object.keys(checked).length} verified files.`,
);
