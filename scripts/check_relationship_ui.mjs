// Actual Phase 4 component/controls/CSS. ALL names, dates and activity are synthetic.
import { build } from "esbuild";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import fs from "node:fs";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url);
const { chromium } = require(
  process.env.PLAYWRIGHT_MODULE_PATH ??
    process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES + "/playwright",
);
if (!process.env.CHROMIUM_EXECUTABLE_PATH)
  throw Error("Set CHROMIUM_EXECUTABLE_PATH; build first.");
const repo = fileURLToPath(new URL("..", import.meta.url)),
  output = fs.mkdtempSync(join(tmpdir(), "vanquish-relationships-ui-"));
const p = "f4000000-0000-0000-0000-000000000001",
  bridge = "f4000000-0000-0000-0000-000000000002",
  a = "a".repeat(32),
  b = "b".repeat(32);
const e = (person, member, personName, memberName) => ({
  person,
  member,
  personName,
  memberName,
  days: 4,
  meetings: 1,
  lastOn: "2026-09-30",
});
const graph = {
  status: "ready",
  asOf: "2026-10-15",
  windowDays: 180,
  version: "v1",
  root: a,
  target: p,
  nodesVisited: 4,
  edges: [
    e(bridge, a, "Synthetic shared contact", "Synthetic starting member"),
    e(bridge, b, "Synthetic shared contact", "Synthetic introducing member"),
    e(
      p,
      b,
      "Synthetic target with a long fictional display name for narrow layout",
      "Synthetic introducing member",
    ),
  ],
};
await build({
  stdin: {
    contents: `import React from'react';import{createRoot}from'react-dom/client';import Panel from'./src/components/RelationshipIntelligence';createRoot(document.getElementById('root')).render(<main style={{padding:16,maxWidth:1000,margin:'auto'}}><h1>Relationships — SYNTHETIC verification</h1><Panel allowed people={[{id:'${p}',name:'Synthetic target with a long fictional display name for narrow layout'}]} members={[{id:'${a}',name:'Synthetic starting member'},{id:'${b}',name:'Synthetic introducing member'}]}/></main>);`,
    resolveDir: repo,
    loader: "tsx",
  },
  bundle: true,
  outfile: join(output, "ui.js"),
  jsx: "automatic",
  nodePaths: [repo + "/node_modules"],
  define: { "process.env.NODE_ENV": '"development"' },
  plugins: [
    {
      name: "synthetic-actions",
      setup(b) {
        b.onResolve(
          { filter: /^@\/lib\/relationships\/intelligence-actions$/ },
          (a) => ({ path: a.path, namespace: "synthetic" }),
        );
        b.onLoad({ filter: /.*/, namespace: "synthetic" }, () => ({
          contents: `export const loadRelationshipGraph=async()=>{window.relationshipCalls++;return window.graph}`,
          loader: "js",
        }));
      },
    },
  ],
});
const css = fs
  .readdirSync(repo + "/.next/static/chunks")
  .filter((f) => f.endsWith(".css"))
  .map((f) => fs.readFileSync(repo + "/.next/static/chunks/" + f, "utf8"))
  .join("\n");
fs.writeFileSync(
  join(output, "ui.html"),
  `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script>window.relationshipCalls=0;window.graph=${JSON.stringify(graph)}</script><script src="ui.js"></script></body></html>`,
);
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  headless: true,
});
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({
        viewport: { width, height: 1100 },
        hasTouch: width === 390,
        isMobile: width === 390,
        reducedMotion: "reduce",
      }),
      page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("file://" + join(output, "ui.html"));
    const start = page.getByRole("button", {
      name: "Starting member (sharing enabled)",
      exact: true,
    });
    await start.focus();
    await page.keyboard.press("ArrowDown");
    await page
      .getByRole("option", { name: "Synthetic introducing member" })
      .waitFor();
    await page.keyboard.press("Escape");
    assert.equal(await start.getAttribute("aria-expanded"), "false");
    assert.equal(
      await start.evaluate((e) => e === document.activeElement),
      true,
    );
    const button = page.getByRole("button", {
      name: "Calculate relationships",
    });
    if (width === 390) await button.tap();
    else {
      await button.focus();
      await page.keyboard.press("Enter");
    }
    await page.getByText("57/100", { exact: true }).waitFor();
    await page
      .getByText("3 hops · weakest edge 57/100", { exact: true })
      .waitFor();
    assert.equal(
      (await page.getByText(/Reciprocity: unavailable/).count()) > 0,
      true,
    );
    const checkbox = page.getByRole("checkbox", { name: "Show path evidence" });
    if (width === 390) await checkbox.tap();
    else {
      await checkbox.focus();
      await page.keyboard.press("Space");
    }
    assert.equal(await checkbox.isChecked(), false);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    await page.screenshot({
      path: join(output, `synthetic-${width}.png`),
      fullPage: true,
    });
    // Change target: stale evidence is discarded before any new request; no automatic scan.
    const target = page.getByRole("button", {
      name: "Target person",
      exact: true,
    });
    await target.click();
    await page
      .getByRole("option", {
        name: "Synthetic target with a long fictional display name for narrow layout",
        exact: true,
      })
      .click();
    assert.equal(await page.getByText("57/100", { exact: true }).count(), 0);
    await page.evaluate(() => (window.graph.status = "partial"));
    await button.click();
    await page
      .getByRole("status")
      .filter({ hasText: "Partial result:" })
      .waitFor();
    await page.screenshot({
      path: join(output, `synthetic-partial-${width}.png`),
      fullPage: true,
    });
    await page.evaluate(
      () => (window.graph = { status: "unavailable", edges: [] }),
    );
    await button.click();
    await page
      .getByRole("status")
      .filter({ hasText: "Unavailable." })
      .waitFor();
    await page.evaluate(
      ({ a, p }) =>
        (window.graph = {
          status: "empty",
          asOf: "2026-10-15",
          version: "v1",
          windowDays: 180,
          root: a,
          target: p,
          nodesVisited: 0,
          edges: [],
        }),
      { a, p },
    );
    await button.click();
    await page.getByText(/Empty: no authorized evidence/).waitFor();
    assert.deepEqual(errors, []);
    console.log(
      `PASS synthetic Chromium ${width}px / keyboard / touch / reduced motion / ready, empty, unavailable, partial: ${output}`,
    );
    await context.close();
  }
} finally {
  await browser.close();
}
