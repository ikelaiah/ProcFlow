/* Validate the packaged archive's allowlist and, when a Chromium browser is
   available, run the same file:// initialization smoke against the extracted
   runtime itself. */
import { mkdtempSync, readFileSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const packageResult = spawnSync(process.execPath, [join(root, "scripts", "package-runtime.mjs")],
  { encoding: "utf8", windowsHide: true });
if (packageResult.status !== 0) {
  process.stderr.write(packageResult.stderr || packageResult.stdout || "package failed\n");
  process.exit(1);
}
const archive = join(root, ".release", `procflow-v${JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version}.zip`);
const bytes = readFileSync(archive);
function readU16(offset) { return bytes.readUInt16LE(offset); }
function readU32(offset) { return bytes.readUInt32LE(offset); }
const out = mkdtempSync(join(tmpdir(), "procflow-package-smoke-"));
const extractedRoot = resolve(out);
const names = [];
let offset = 0;
try {
  while (offset + 30 <= bytes.length && readU32(offset) === 0x04034b50) {
    const nameLength = readU16(offset + 26), extraLength = readU16(offset + 28);
    const size = readU32(offset + 18);
    const name = bytes.subarray(offset + 30, offset + 30 + nameLength).toString("utf8");
    const dataStart = offset + 30 + nameLength + extraLength;
    const target = resolve(out, name);
    if (!(target === extractedRoot || target.startsWith(`${extractedRoot}${requirePathSeparator()}`)))
      throw new Error(`unsafe archive path: ${name}`);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, bytes.subarray(dataStart, dataStart + size));
    names.push(name);
    offset = dataStart + size;
  }
  const required = ["index.html", "erd.html", "styles.css", "README.txt",
    "dist/src/app.js", "dist/src/schema.js", "dist/src/erd.js",
    "dist/src/analysis/confidence.js", "dist/src/ui/large-input.js",
    "dist/src/ui/erd-page.js", "vendor/mermaid/mermaid.min.js"];
  const missing = required.filter((name) => !names.includes(name));
  if (missing.length) throw new Error(`package missing: ${missing.join(", ")}`);
  if (names.some((name) => /^(tests|src|node_modules|package(-lock)?\.json)\//.test(name)))
    throw new Error("package contains development files");
  const smoke = spawnSync(process.execPath, [join(root, "scripts", "file-smoke.mjs")], {
    encoding: "utf8", windowsHide: true,
    env: { ...process.env, PROCFLOW_SMOKE_ROOT: out }
  });
  if (smoke.status !== 0) {
    process.stdout.write(`package: archive structure passed; browser smoke unavailable or failed\n${smoke.stderr || smoke.stdout || ""}`);
    process.exit(smoke.status || 1);
  }
  process.stdout.write(`package: archive structure and local-file smoke passed (${archive})\n`);
} finally {
  rmSync(out, { recursive: true, force: true });
}

function requirePathSeparator() {
  return process.platform === "win32" ? "\\" : "/";
}
