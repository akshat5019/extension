// Render the actual UI with imported sample records via the integration suite.
// No live website or native extension/model verification is implied.
import { spawnSync } from "node:child_process";
const result = spawnSync(
  process.execPath,
  [
    "node_modules/@playwright/test/cli.js",
    "test",
    "--grep",
    "captures current workspace assets",
  ],
  { stdio: "inherit" },
);
process.exit(result.status ?? 1);
