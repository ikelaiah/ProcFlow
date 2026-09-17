/* Build the self-contained runtime archive from an explicit allowlist.
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
  "Open erd.html for the entity relationship diagram page built from schema DDL.",
  "Keep index.html, erd.html, styles.css, dist/, and vendor/ together after extracting.",
  "The application runs locally in the browser; it does not upload or execute SQL.",
  "Analysis is heuristic. Verify important findings against the source SQL and database.",
  ""
].join("\n");
const paths = [
  "index.html", "erd.html", "styles.css", "LICENSE", "vendor/mermaid/mermaid.min.js",
  "vendor/mermaid/LICENSE"
];
const distFiles = [
  "app.js", "catalogue.js", "columnflow.js", "columns.js", "dialects.js",
  "exporters.js", "ir.js", "lineage.js", "report.js", "schema.js",
  "tokenizer.js", "workspace.js", "erd.js", "analysis/confidence.js",
  "ui/large-input.js", "ui/erd-page.js"
];
for (const file of distFiles) paths.push(`dist/src/${file}`);
const missing = paths.filter((path) => !existsSync(join(root, path)));
if (missing.length) throw new Error(`Missing runtime files: ${missing.join(", ")}`);
/* Git checks out text files with platform-native line endings in some local
   configurations. Canonicalize the archive bytes so a release ZIP has the
   same checksum on Windows and Linux. */
function runtimeBytes(path) {
  return Buffer.from(readFileSync(join(root, path), "utf8").replace(/\r\n/g, "\n"), "utf8");
}
const entries = paths.map((path) => ({ name: path, data: runtimeBytes(path) }));
entries.push({ name: "README.txt", data: Buffer.from(runtimeReadme, "utf8") });
const hash = writeStoreZip(archive, entries);
mkdirSync(outputDir, { recursive: true });
writeFileSync(checksumFile, `${hash}  ${relative(outputDir, archive).replaceAll("\\", "/")}\n`, "utf8");
console.log(`package: wrote ${archive}`);
console.log(`package: wrote ${checksumFile}`);
console.log(`package: SHA256 ${hash}`);
