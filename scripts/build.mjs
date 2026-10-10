import { build } from "esbuild";
import { mkdir, copyFile, cp, rm, writeFile } from "node:fs/promises";
await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
await cp("icons", "dist/icons", { recursive: true });
const shared = {
  outdir: "dist",
  bundle: true,
  minify: true,
  define: { "process.env.NODE_ENV": '"production"' },
  target: "chrome120",
  logLevel: "info",
  jsx: "automatic",
};
// Injected content scripts and the classic service worker remain self-contained.
await build({
  ...shared,
  format: "iife",
  entryPoints: { content: "src/content.ts", background: "src/background.ts" },
});
// Extension pages/module workers can load packaged format readers on demand.
const modules = await build({
  ...shared,
  format: "esm",
  splitting: true,
  metafile: true,
  chunkNames: "chunks/[name]-[hash]",
  entryPoints: {
    app: "src/ui/App.tsx",
    "document-worker": "src/document-worker.ts",
  },
});
await mkdir(".test-core", { recursive: true });
await writeFile(".test-core/build-meta.json", JSON.stringify(modules.metafile));
await copyFile(
  "node_modules/pdfjs-dist/build/pdf.worker.mjs",
  "dist/pdf.worker.mjs",
);
for (const name of ["wasm", "standard_fonts", "cmaps"])
  await cp(`node_modules/pdfjs-dist/${name}`, `dist/${name}`, {
    recursive: true,
  });
for (const name of ["manifest.json", "popup.html", "manager.html", "popup.css"])
  await copyFile(name, `dist/${name}`);
