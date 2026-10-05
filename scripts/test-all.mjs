/* One-command browser test runner for contributors.
   Starts a local static server (like CI) and drives each HTML suite through a
   headless Chromium with --dump-dom. Suites are served over http:// because
   the UI suites inspect an iframe; file:// iframes are treated as opaque
   origins by Chromium and their contentDocument is inaccessible.

   Usage:
     node scripts/test-all.mjs [--suite <name>] [--debug]

   Exit code is non-zero if the browser is missing, a suite reports failure, or
   a suite never reaches a verdict. The server binds to 127.0.0.1 and the run
   makes no outbound network requests. */
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findBrowser } from "./lib/browser.mjs";
import { startStaticServer } from "./lib/server.mjs";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));

const SUITES = [
  { name: "golden", path: "tests/index.html" },
  { name: "fuzz", path: "tests/fuzz.html" },
  // The UI suites drive an iframe and poll with setTimeout; they need a
  // larger virtual-time budget so the iframe finishes loading and settling.
  { name: "ui", path: "tests/ui.html", budgetMs: 60_000 },
  { name: "erd-ui", path: "tests/erd-ui.html", budgetMs: 60_000 },
  { name: "security", path: "tests/security.html" }
];

const args = process.argv.slice(2);
const debug = args.includes("--debug");
const onlyIndex = args.indexOf("--suite");
const only = onlyIndex >= 0 ? args[onlyIndex + 1] : null;
const timeoutMs = Number(process.env.SQL_CARTOGRAPHER_TEST_TIMEOUT_MS || 120_000);

const browser = findBrowser();
if (!browser) {
  console.error("test-all: no Chromium browser found; install Chrome, Edge, or Chromium, or set CHROME_PATH");
  process.exit(1);
}

const selected = only ? SUITES.filter((suite) => suite.name === only) : SUITES;
if (selected.length === 0) {
  console.error(`test-all: unknown suite "${only}" (expected one of: ${SUITES.map((s) => s.name).join(", ")})`);
  process.exit(1);
}

function runSuite(suite, runDirectory, baseUrl) {
  return new Promise((resolve) => {
    const url = `${baseUrl}/${suite.path}`;
    const budget = suite.budgetMs || timeoutMs;
    const flags = [
      "--headless=new",
      "--no-sandbox",
      "--disable-gpu",
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-default-apps",
      "--disable-extensions",
      "--disable-sync",
      "--no-default-browser-check",
      "--no-first-run",
      `--virtual-time-budget=${budget}`,
      `--user-data-dir=${join(runDirectory, `${suite.name}-profile`)}`,
      "--dump-dom",
      url
    ];
    const child = spawn(browser, flags, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => {
      console.error(`test-all: ${suite.name}: browser could not start: ${error.message}`);
      resolve(false);
    });
    const killer = setTimeout(() => child.kill(), budget + 30_000);
    child.on("close", () => {
      clearTimeout(killer);
      const body = /<body[^>]*\bclass="([^"]*)"/i.exec(stdout);
      const summary = /<p id="(?:security-)?summary"[^>]*>([^<]*)/i.exec(stdout);
      const verdict = body
        ? (/\bpass\b/.test(body[1]) ? "pass" : (/\bfail\b/.test(body[1]) ? "fail" : "unknown"))
        : "unknown";
      if (verdict === "pass") {
        console.log(`test-all: ${suite.name} passed  ${summary ? summary[1].trim() : ""}`.trimEnd());
        resolve(true);
      } else {
        console.error(`test-all: ${suite.name}: ${verdict}${summary ? ` · ${summary[1].trim()}` : ""}`);
        if (debug) {
          if (!stdout) console.error("  (no DOM output produced)");
          if (stderr) console.error(stderr.slice(-8_000));
        }
        resolve(false);
      }
    });
  });
}

const runDirectory = mkdtempSync(join(tmpdir(), "sql-cartographer-tests-"));
const server = await startStaticServer(repositoryRoot);
let failed = 0;
try {
  for (const suite of selected) {
    if (!(await runSuite(suite, runDirectory, server.url))) failed++;
  }
} finally {
  await server.close();
  rmSync(runDirectory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

if (failed > 0) {
  console.error(`test-all: ${failed} suite(s) failed`);
  process.exit(1);
}
console.log(`test-all: ${selected.length} suite(s) passed`);
