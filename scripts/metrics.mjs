/* Fixture-corpus metric publishing (v1.8.0).
   Runs tests/metrics.html headlessly, extracts the deterministic, fixture-only
   metric snapshot, and either writes it (--write) or verifies the checked-in
   snapshot is still current (default). Uses the same browser discovery and
   file:// technique as file-smoke.mjs, so nothing is ever served or uploaded. */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const metricsPage = join(repositoryRoot, "tests", "metrics.html");
const snapshotFile = join(repositoryRoot, "docs", "metrics-v1.9.0.json");
const writeMode = process.argv.includes("--write");
const explicitBrowser = (process.env.CHROME_PATH || "").trim();

function browserCandidates() {
  if (explicitBrowser) return [explicitBrowser];
  if (process.platform === "win32") {
    return [
      join(process.env["PROGRAMFILES(X86)"] || "", "Microsoft", "Edge", "Application", "msedge.exe"),
      join(process.env.PROGRAMFILES || "", "Microsoft", "Edge", "Application", "msedge.exe"),
      join(process.env.PROGRAMFILES || "", "Google", "Chrome", "Application", "chrome.exe"),
      join(process.env["PROGRAMFILES(X86)"] || "", "Google", "Chrome", "Application", "chrome.exe"),
      join(process.env.LOCALAPPDATA || "", "Google", "Chrome", "Application", "chrome.exe")
    ].filter(Boolean);
  }
  if (process.platform === "darwin") {
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Chromium.app/Contents/MacOS/Chromium"
    ];
  }
  return ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"];
}

function isUsableBrowser(candidate) {
  if (isAbsolute(candidate)) return existsSync(candidate);
  const probe = spawnSync(candidate, ["--version"], {
    encoding: "utf8", timeout: 10_000, windowsHide: true
  });
  return !probe.error && probe.status === 0;
}

function fail(message, details) {
  console.error(`metrics: ${message}`);
  if (details) console.error(details.slice(-12_000));
  process.exitCode = 1;
}

if (!existsSync(metricsPage)) {
  fail(`missing metrics page: ${metricsPage}`);
} else {
  const browser = browserCandidates().find(isUsableBrowser);
  if (!browser) {
    fail(explicitBrowser
      ? `CHROME_PATH does not point to a usable Chromium browser: ${explicitBrowser}`
      : "no Chromium browser found; install Chrome, Edge, or Chromium, or set CHROME_PATH");
    process.exit(1);
  }
  const runDirectory = mkdtempSync(join(tmpdir(), "procflow-metrics-"));
  const fileUrl = pathToFileURL(metricsPage).href;
  try {
    const result = spawnSync(browser, [
      "--headless=new", "--no-sandbox", "--disable-gpu",
      "--disable-background-networking", "--disable-component-update",
      "--disable-default-apps", "--disable-extensions", "--disable-sync",
      "--no-default-browser-check", "--no-first-run",
      "--virtual-time-budget=20000",
      `--user-data-dir=${join(runDirectory, "profile")}`,
      "--dump-dom", fileUrl
    ], {
      encoding: "utf8", maxBuffer: 16 * 1024 * 1024,
      timeout: 45_000, windowsHide: true
    });

    const output = result.stdout || "";
    if (result.error) {
      fail(`browser could not complete: ${result.error.message}`, result.stderr || output);
      process.exit(1);
    }
    if (result.status !== 0) {
      fail(`browser exited with status ${result.status}`, result.stderr || output);
      process.exit(1);
    }

    const match = /<pre id="metrics-output">([\s\S]*?)<\/pre>/.exec(output);
    if (!match || !match[1].trim()) {
      fail("metrics page produced no output (is dist/ built?)", output);
      process.exit(1);
    }
    const generated = `${match[1].trim()}\n`;
    const expected = existsSync(snapshotFile) ? readFileSync(snapshotFile, "utf8") : null;

    if (writeMode) {
      writeFileSync(snapshotFile, generated, "utf8");
      console.log(`metrics: wrote ${snapshotFile} (${Buffer.byteLength(generated, "utf8")} bytes)`);
    } else if (expected === generated) {
      console.log(`metrics: snapshot is current (${snapshotFile})`);
    } else {
      fail(
        `metric snapshot is stale: run "npm run metrics:write" and commit ${snapshotFile}.\n` +
        (expected
          ? `expected ${Buffer.byteLength(expected, "utf8")} bytes, generated ${Buffer.byteLength(generated, "utf8")} bytes`
          : `no snapshot file present`),
        generated
      );
      process.exit(1);
    }
  } finally {
    rmSync(runDirectory, { recursive: true, force: true });
  }
}
