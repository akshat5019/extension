import { build } from "esbuild";
import { mkdir, copyFile, cp, rm } from "node:fs/promises";
await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
await cp("icons", "dist/icons", { recursive: true });
await build({
  entryPoints: {
    app: "src/ui/App.tsx",
    content: "src/content.ts",
    background: "src/background.ts",
    "document-worker": "src/document-worker.ts",
  },
  outdir: "dist",
  bundle: true,
  minify: true,
  define: { "process.env.NODE_ENV": '"production"' },
  format: "iife",
  target: "chrome120",
  logLevel: "info",
  jsx: "automatic",
});
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
