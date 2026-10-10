import "fake-indexeddb/auto";
import { build } from "esbuild";
import { readFile } from "node:fs/promises";

await build({
  entryPoints: ["src/core/repository.ts"],
  outfile: ".test-core/benchmark-repository.js",
  bundle: true,
  format: "esm",
  platform: "node",
});
const { LocalRepository } =
  await import("../.test-core/benchmark-repository.js");
const repository = new LocalRepository(`benchmark-${crypto.randomUUID()}`);
const records = Array.from({ length: 300 }, (_, i) => ({
  action: "create",
  fields: {
    fullName: `Person ${i}`,
    email: `person${i}@example.com`,
    phone: `98765${String(i).padStart(5, "0")}`,
  },
}));
try {
  await repository.commitImport("benchmark", "synthetic.csv", records, []);
  let start = performance.now();
  for (let i = 200; i < 250; i++) {
    const result = await repository.search(`person${i}@`);
    if (
      result.total !== 1 ||
      result.items[0]?.fields.email !== records[i].fields.email
    )
      throw new Error("Search benchmark returned the wrong profile.");
  }
  const searchMs = Math.round(performance.now() - start);
  start = performance.now();
  for (let i = 200; i < 250; i++) {
    const matches = await repository.matches(records[i].fields);
    if (matches.length !== 1)
      throw new Error("Duplicate benchmark returned incorrect matches.");
  }
  const matchingMs = Math.round(performance.now() - start);
  start = performance.now();
  const batch = await repository.analyze(
    records.slice(200, 250).map((row) => row.fields),
  );
  if (batch.some((matches) => matches.length !== 1))
    throw new Error("Batch review returned incorrect matches.");
  const batchMs = Math.round(performance.now() - start);
  const meta = JSON.parse(await readFile(".test-core/build-meta.json", "utf8"));
  const seen = new Set();
  function startupBytes(path) {
    if (seen.has(path)) return 0;
    seen.add(path);
    const output = meta.outputs[path];
    return (
      output.bytes +
      output.imports
        .filter((entry) => entry.kind === "import-statement" && !entry.external)
        .reduce((sum, entry) => sum + startupBytes(entry.path), 0)
    );
  }
  console.log(
    JSON.stringify(
      {
        profiles: 300,
        queries: 50,
        searchMs,
        matchingMs,
        batchMs,
        startupJavaScriptBytes: startupBytes("dist/app.js"),
        note: "Synthetic fake-indexeddb benchmark; timings vary by device. Build before running.",
      },
      null,
      2,
    ),
  );
} finally {
  await repository.delete();
}
