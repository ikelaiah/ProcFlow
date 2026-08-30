/* Build the self-contained v1.14.0 runtime archive from an explicit allowlist.
   The archive is local-file compatible and contains no tests, source TypeScript,
   node_modules, maps, or development tooling. */
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { writeStoreZip } from "./zip-runtime.mjs";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const version = packageJson.version;
const outputDir = join(root, ".release");
const archive = join(outputDir, `procflow-v${version}.zip`);
const checksumFile = join(outputDir, "SHA256SUMS.txt");
const runtimeReadme = [
  `ProcFlow v${version}`,
  "",
  "Open index.html in a current Chrome, Edge, Firefox, or Chromium browser.",
  "Keep index.html, styles.css, dist/, and vendor/ together after extracting.",
  "The application runs locally in the browser; it does not upload or execute SQL.",
  "Analysis is heuristic. Verify important findings against the source SQL and database.",
  ""
].join("\n");
const paths = [
  "index.html", "styles.css", "LICENSE", "vendor/mermaid/mermaid.min.js",
  "vendor/mermaid/LICENSE"
];
const distFiles = [
  "app.js", "catalogue.js", "columnflow.js", "columns.js", "dialects.js",
  "exporters.js", "ir.js", "lineage.js", "report.js", "tokenizer.js",
  "workspace.js", "analysis/confidence.js", "ui/large-input.js"
];
for (const file of distFiles) paths.push(`dist/src/${file}`);
const missing = paths.filter((path) => !existsSync(join(root, path)));
if (missing.length) throw new Error(`Missing runtime files: ${missing.join(", ")}`);
const entries = paths.map((path) => ({ name: path,
  data: readFileSync(join(root, path)) }));
entries.push({ name: "README.txt", data: Buffer.from(runtimeReadme, "utf8") });
const hash = writeStoreZip(archive, entries);
mkdirSync(outputDir, { recursive: true });
writeFileSync(checksumFile, `${hash}  ${relative(outputDir, archive).replaceAll("\\", "/")}\n`, "utf8");
console.log(`package: wrote ${archive}`);
console.log(`package: wrote ${checksumFile}`);
console.log(`package: SHA256 ${hash}`);
