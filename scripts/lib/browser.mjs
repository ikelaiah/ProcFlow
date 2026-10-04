/* Shared Chromium discovery and headless flags for the Node-side scripts.
   file-smoke.mjs, metrics.mjs, and test-all.mjs all drive a local Chromium
   via --dump-dom; keeping the candidate list and flag set here means a new
   platform or a browser flag is fixed in one place. Nothing is served or
   uploaded by these helpers. */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";

export function browserCandidates(explicit) {
  const override = (explicit ?? process.env.CHROME_PATH ?? "").trim();
  if (override) return [override];

  if (process.platform === "win32") {
    return [
      join(process.env.PROGRAMFILES || "", "Google", "Chrome", "Application", "chrome.exe"),
      join(process.env["PROGRAMFILES(X86)"] || "", "Google", "Chrome", "Application", "chrome.exe"),
      join(process.env["PROGRAMFILES(X86)"] || "", "Microsoft", "Edge", "Application", "msedge.exe"),
      join(process.env.PROGRAMFILES || "", "Microsoft", "Edge", "Application", "msedge.exe"),
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

export function isUsableBrowser(candidate) {
  if (isAbsolute(candidate)) return existsSync(candidate);
  const probe = spawnSync(candidate, ["--version"], {
    encoding: "utf8",
    timeout: 10_000,
    windowsHide: true
  });
  return !probe.error && probe.status === 0;
}

export function findBrowser(explicit) {
  return browserCandidates(explicit).find(isUsableBrowser) || null;
}

/* The common offline, deterministic headless flag set. `--dump-dom` is always
   appended last so callers only pass a URL after these flags. */
export function headlessFlags({ userDataDir, virtualTimeBudget = 20_000 } = {}) {
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
    `--virtual-time-budget=${virtualTimeBudget}`
  ];
  if (userDataDir) flags.push(`--user-data-dir=${userDataDir}`);
  flags.push("--dump-dom");
  return flags;
}
