// Actual Phase 3 controls/CSS, entirely synthetic data and stubbed actions.
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
  output = fs.mkdtempSync(join(tmpdir(), "vanquish-reporting-ui-"));
await build({
  stdin: {
    contents: `import React from 'react';import{createRoot}from'react-dom/client';import CrmReporting from './src/components/CrmReporting';createRoot(document.getElementById('root')).render(<main style={{padding:16}}><h1>Reporting — synthetic verification</h1><CrmReporting portfolio documents subscribed={false} funds={[{id:'f3000000-0000-0000-0000-000000000004',name:'Synthetic fund with a long fictional name for narrow layout'}]} today="2026-10-14"/></main>);`,
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
        b.onResolve({ filter: /^@\/lib\/reporting\/actions$/ }, (a) => ({
          path: a.path,
          namespace: "synthetic",
        }));
        b.onLoad({ filter: /.*/, namespace: "synthetic" }, () => ({
          contents: `export const setWeeklySubscription=async(enabled)=>{window.reportCalls.push({kind:'consent',enabled});return{ok:true}};export const requestWeekly=async(week)=>{window.reportCalls.push({kind:'reference',week});return{ok:true,id:'f3000000-0000-0000-0000-000000000005'}};export const loadFundMetrics=async(fund,asOf,basis)=>{window.reportCalls.push({kind:'metrics',fund,asOf,basis});return{status:'unavailable',reason:'Synthetic: not reconciled',asOf,basis,currency:'USD'}};`,
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
  `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script>window.reportCalls=[]</script><script src="ui.js"></script></body></html>`,
);
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  headless: true,
});
try {
  for (const width of [1440, 390]) {
    console.log("Synthetic viewport " + width + " in " + output);
    const context = await browser.newContext({
      viewport: { width, height: 1100 },
      hasTouch: width === 390,
      isMobile: width === 390,
      reducedMotion: "reduce",
    });
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("file://" + join(output, "ui.html"));
    const resource = page.locator("#report-resource");
    await resource.focus();
    await page.keyboard.press("Enter");
    await page
      .getByRole("option", { name: "Fund catalog (Portfolio)" })
      .waitFor();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Escape");
    assert.equal(await resource.getAttribute("aria-expanded"), "false");
    assert.equal(
      await resource.evaluate((e) => e === document.activeElement),
      true,
    );
    await resource.click();
    await page
      .getByRole("option", { name: "Fund catalog (Portfolio)" })
      .click();
    assert.equal(
      await page
        .getByRole("link", { name: "Download CSV", exact: true })
        .getAttribute("href"),
      "/api/reporting/export?resource=funds",
    );
    const consent = page.getByRole("checkbox", {
      name: "Opt in to my weekly report",
    });
    if (width === 390) await consent.tap();
    else {
      await consent.focus();
      await page.keyboard.press("Space");
    }
    await page
      .getByRole("button", { name: "Generate reference", exact: true })
      .waitFor();
    await page.getByLabel("Week starting Monday (UTC)").fill("2026-10-12");
    await page
      .getByRole("button", { name: "Generate reference", exact: true })
      .click();
    await page.getByRole("link", { name: "Download weekly CSV" }).waitFor();
    await consent.click();
    await page
      .getByRole("link", { name: "Download weekly CSV" })
      .waitFor({ state: "hidden" });
    assert.equal(
      await page
        .getByRole("button", { name: "Generate reference", exact: true })
        .isDisabled(),
      true,
    );
    await page.locator("#report-fund").click();
    await page
      .getByRole("option", {
        name: "Synthetic fund with a long fictional name for narrow layout",
      })
      .click();
    await page.locator("#report-basis").click();
    assert.equal(
      await page
        .getByRole("option", { name: "Gross (contract deferred)" })
        .isDisabled(),
      true,
    );
    await page.screenshot({
      path: join(output, `basis-open-${width}.png`),
      fullPage: true,
    });
    await page.getByRole("option", { name: "Net (requires approval)" }).click();
    await page.getByRole("button", { name: "Calculate metrics" }).click();
    await page.getByText("Not available: Synthetic: not reconciled").waitFor();
    assert.equal(
      await page.evaluate(
        () => matchMedia("(prefers-reduced-motion: reduce)").matches,
      ),
      true,
    );
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
      "No horizontal overflow",
    );
    assert.deepEqual(errors, []);
    assert.equal(
      (await page.evaluate(() => window.reportCalls)).filter(
        (c) => c.kind === "consent",
      ).length,
      2,
    );
    await page.screenshot({
      path: join(output, `reporting-${width}.png`),
      fullPage: true,
    });
    console.log(
      `PASS Chromium ${width}: keyboard, Escape, touch, opt-in/revoke, metrics, reduced motion, no overflow; SYNTHETIC`,
    );
    await context.close();
  }
} finally {
  await browser.close();
}
console.log("Screenshots: " + output);
