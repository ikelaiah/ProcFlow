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

/* Suites publish their verdict as JSON in a <pre> inside the page. --dump-dom
   serialises that text HTML-escaped, so unescape before parsing. */
function unescapeHtml(text) {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
}

/* Suites use one of two result payloads: an array of {name, pass, detail}
   cases, or an object carrying a `failures` array (fuzz, security). Entries in
   a `failures` array are failures by definition and may omit `pass`. */
function failingCasesFrom(html) {
  const match = /<pre id="(?:security-)?results"[^>]*>([\s\S]*?)<\/pre>/i.exec(html);
  if (!match || !match[1].trim()) return null;
  let payload;
  try {
    payload = JSON.parse(unescapeHtml(match[1].trim()));
  } catch {
    return null;
  }
  if (Array.isArray(payload)) return payload.filter((entry) => entry && entry.pass === false);
  if (Array.isArray(payload?.failures)) return payload.failures.filter(Boolean);
  return [];
}

function describeFailure(entry) {
  const label = entry.name ?? (entry.case !== undefined ? `case ${entry.case}` : "(unnamed)");
  const rest = { ...entry };
  delete rest.name;
  delete rest.case;
  delete rest.pass;
  const detail = Object.keys(rest).length ? ` → ${JSON.stringify(rest)}` : "";
  return `${label}${detail}`;
}

function reportFailures(html) {
  const failures = failingCasesFrom(html);
  if (failures === null) {
    console.error("  (no parsable result payload in the dumped DOM)");
    return;
  }
  if (failures.length === 0) {
    console.error("  (verdict was not 'pass' but no failing case was recorded)");
    return;
  }
  for (const failure of failures) console.error(`  ✗ ${describeFailure(failure)}`);
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
        if (stdout) reportFailures(stdout);
        else console.error("  (no DOM output produced)");
        if (debug && stderr) console.error(stderr.slice(-8_000));
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
