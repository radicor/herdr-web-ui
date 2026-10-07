/**
 * Browser verification for the P0 changes, on the demo's fixture transport so it needs no
 * live herdr: what the terminal exposes to a screen reader (A1), and whether the app's own
 * Content-Security-Policy reaches the page and stays clean through a real load (S3).
 *
 * The demo transport is a stub, so this proves the client-side surface only — the access
 * gate's server side is covered by server/open-access.test.ts. Run after `bun run build:site`
 * (or `bun run build`), with CHROME_PATH pointed at a Chromium.
 */
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Page } from "playwright-core";
import { assertCspClean, watchCsp, type CspWatch } from "./csp-violations.ts";
import { serveStatic } from "../server/static.ts";

const repo = join(import.meta.dir, "..");
const app = mkdtempSync(join(tmpdir(), "herdr-p0-verify-"));
const csp: CspWatch[] = [];
const errors: string[] = [];

const SITE = join(repo, "_site");
const DEMO_APP = join(SITE, "demo", "app");

interface TerminalA11y {
  hasRegion: boolean;
  roledescription: string | null;
  label: string | null;
  /** xterm's accessibility tree, built only when screenReaderMode is on; 0 means the flag never took */
  treeRows: number;
  liveRegion: boolean;
  accessibleName: string | null;
}

const terminalA11y = (page: Page): Promise<TerminalA11y> => page.evaluate(() => {
  const host = document.querySelector(".pane-terminal");
  if (!host) return { hasRegion: false, roledescription: null, label: null, treeRows: 0, liveRegion: false, accessibleName: null };
  // xterm builds .xterm-accessibility > .xterm-accessibility-tree (role=list, one row per line)
  // plus .live-region only when screenReaderMode is set, so their presence is the flag's proof
  const tree = document.querySelector(".xterm-accessibility-tree");
  const rows = tree ? tree.querySelectorAll("[role='listitem']").length : 0;
  return {
    hasRegion: host.getAttribute("role") === "region",
    roledescription: host.getAttribute("aria-roledescription"),
    label: host.getAttribute("aria-label"),
    treeRows: rows,
    liveRegion: !!document.querySelector(".xterm-accessibility .live-region"),
    accessibleName: (host as HTMLElement).ariaLabel,
  };
});

async function main() {
  // serveStatic reads DIST_DIR (the repo's dist/), so the demo app is laid out there: its
  // index.html uses relative asset paths, which resolve the same under the real handler
  const dist = join(repo, "dist");
  rmSync(dist, { recursive: true, force: true });
  cpSync(DEMO_APP, dist, { recursive: true });
  const index = join(dist, "index.html");
  let html = readFileSync(index, "utf8");
  // the transport stub must load before the app's module so every /api and /ws call is answered
  if (!html.includes("./demo-transport.js")) {
    html = html.replace(/<script type="module"/, () => `<script src="./demo-transport.js"></script>\n    <script type="module"`);
    writeFileSync(index, html);
  }

  const browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH ?? "/opt/google/chrome/chrome",
    headless: true,
    args: ["--no-sandbox", "--accept-lang=en-US"],
  });

  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

  // serve through the real serveStatic so the CSP the app ships is the one this load sees
  const server = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    fetch: async (request) => serveStatic(new URL(request.url).pathname),
  });

  const origin = `http://127.0.0.1:${server.port}`;
  csp.push(await watchCsp(page));
  await page.goto(origin);
  await page.waitForSelector(".pane-terminal", { timeout: 15_000 });

  // --- A1: the terminal's accessible surface ---
  const a11y = await terminalA11y(page);
  console.log(JSON.stringify(a11y, null, 2));
  assert.equal(a11y.hasRegion, true, "the terminal host is a region");
  assert.equal(a11y.roledescription, "terminal", "aria-roledescription is terminal");
  assert.ok(a11y.label && a11y.label.length > 0, "the region is labelled");
  assert.ok(a11y.treeRows > 0, `screen-reader tree rows appeared (got ${a11y.treeRows}); screenReaderMode is not taking effect`);
  assert.equal(a11y.liveRegion, true, "xterm's live region exists");
  console.log(`PASS terminal is a labelled region announced as a terminal, ${a11y.treeRows} screen-reader rows and a live region`);

  // the label follows the pane: open a workspace and re-read
  await page.evaluate(async () => {
    await fetch("/api/workspace/create", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ cwd: "/tmp", agent: { kind: "claude" } }),
    });
  });
  await page.waitForTimeout(600);
  const after = await terminalA11y(page);
  assert.ok(after.label && after.label.length > 0, "the label is still set after a workspace opens");
  console.log(`PASS the label persists across a workspace open (${JSON.stringify(after.label)})`);

  // --- S3: the policy reached the page and nothing violated it ---
  await page.waitForTimeout(800);
  assertCspClean(csp, "the demo load");
  const header = (await page.evaluate(() => performance.getEntriesByType("resource").length)) > 0;
  console.log(`PASS no CSP violations through the load (${header ? "resources fetched" : "no resources observed"})`);

  if (errors.length > 0) throw new Error(`page errors: ${errors.slice(0, 5).join("; ")}`);
  console.log("PASS no page errors");

  await browser.close();
  server.stop(true);
  // dist/ is a build artefact; the next `bun run build` replaces it, and so does this
  rmSync(dist, { recursive: true, force: true });
}

await main().catch((error) => {
  console.error(String(error));
  process.exit(1);
});
