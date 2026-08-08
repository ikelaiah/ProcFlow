import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const smokePage = join(repositoryRoot, "index.html");
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
    encoding: "utf8",
    timeout: 10_000,
    windowsHide: true
  });
  return !probe.error && probe.status === 0;
}

function fail(message, details) {
  console.error(`file smoke: ${message}`);
  if (details) console.error(details.slice(-12_000));
  process.exitCode = 1;
}

if (!existsSync(smokePage)) {
  fail(`missing test page: ${smokePage}`);
} else {
  const browser = browserCandidates().find(isUsableBrowser);
  if (!browser) {
    fail(
      explicitBrowser
        ? `CHROME_PATH does not point to a usable Chromium browser: ${explicitBrowser}`
        : "no Chromium browser found; install Chrome, Edge, or Chromium, or set CHROME_PATH"
    );
  } else {
    const runDirectory = mkdtempSync(join(tmpdir(), "procflow-file-smoke-"));
    const fileUrl = pathToFileURL(smokePage).href;
    try {
      const result = spawnSync(browser, [
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
        "--virtual-time-budget=20000",
        `--user-data-dir=${join(runDirectory, "profile")}`,
        "--dump-dom",
        fileUrl
      ], {
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
        timeout: 45_000,
        windowsHide: true
      });

      const output = result.stdout || "";
      if (result.error) {
        fail(`browser could not complete: ${result.error.message}`, result.stderr || output);
      } else if (result.status !== 0) {
        fail(`browser exited with status ${result.status}`, result.stderr || output);
      } else if (!/data-procflow-ready="true"/.test(output)) {
        fail("application did not initialize its local runtime", output || result.stderr);
      } else if (!/data-workspace-optin="1"/.test(output)) {
        /* v1.8.0 extended local-only check: the app must initialise with
           workspace persistence marked opt-in. Nothing is written to or
           restored from browser storage on load — Save/Restore/Forget are the
           only storage touchpoints and each needs an explicit user action. */
        fail("application did not declare opt-in workspace persistence (data-workspace-optin missing)", output || result.stderr);
      } else {
        console.log(`file smoke: application and local runtime loaded (${fileUrl})`);
      }
    } finally {
      rmSync(runDirectory, { recursive: true, force: true });
    }
  }
}
