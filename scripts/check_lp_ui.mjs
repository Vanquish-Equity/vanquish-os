// Synthetic fixture harness: no auth, real Google, database or outbound mutations.
import { build } from "esbuild";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import fs from "node:fs";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url);
const { chromium: browserType } = require(
  process.env.PLAYWRIGHT_MODULE_PATH ??
    (process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES
      ? process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES + "/playwright"
      : "playwright"),
);
if (!process.env.CHROMIUM_EXECUTABLE_PATH)
  throw new Error(
    "Set CHROMIUM_EXECUTABLE_PATH to a local Chromium binary. Run npm run build first.",
  );
const repo = fileURLToPath(new URL("..", import.meta.url));
const output = fs.mkdtempSync(join(tmpdir(), "vanquish-lp-ui-"));
console.log("Synthetic UI outputs: " + output);
const id = "a0000000-0000-0000-0000-000000000001",
  fund = "b0000000-0000-0000-0000-000000000001";
const entry = `import React from '${repo}/node_modules/react/index.js';import {createRoot} from '${repo}/node_modules/react-dom/client.js';import LpScouting from '${repo}/src/components/LpScouting.tsx';import LpFundraising from '${repo}/src/components/LpFundraising.tsx';window.lpCalls=[];const data={funds:[{id:'${fund}',name:'Synthetic Fund',currency:'USD',target_amount:'1000000'}],investors:[{id:'${id}',display_name:'Synthetic LP'}],people:[{id:'${id}',name:'Ana Example'}],companies:[],entities:[],entries:[{id:'${id}',investor_id:'${id}',fund_id:'${fund}',stage:'prospect'}],commitments:[],flows:[],preferences:[],tasks:[],cards:[],history:[]};createRoot(document.getElementById('root')).render(location.search.includes('fund')?<LpFundraising data={data}/>:<LpScouting settings={{enabled:true,contact_mode:'request',share_metadata:false,window_days:30,message_cap:100,last_scanned_at:null}} suggestions={[{id:'${id}',email:'ana@synthetic.test',name:'Ana',confidence:'high',signal_count:2,last_seen_at:'2026-10-01',evidence:[{signal:'fund_material',direction:'outbound'}],status:'open'}]} companies={[]} contacts={[{id:'${id}',name:'Contact',email:'contact@synthetic.test'}]} keywords={[]} jobs={[]} admin={true}/>);`;
await build({
  stdin: { contents: entry, resolveDir: repo, loader: "tsx" },
  bundle: true,
  write: true,
  outfile: join(output, "ui.js"),
  jsx: "automatic",
  nodePaths: [repo + "/node_modules"],
  define: { "process.env.NODE_ENV": '"development"' },
  plugins: [
    {
      name: "stubs",
      setup(b) {
        b.onResolve(
          { filter: /^@\/lib\/(lp-scouting|lp-management)\/actions$/ },
          (a) => ({ path: a.path, namespace: "actions" }),
        );
        b.onLoad({ filter: /.*/, namespace: "actions" }, () => ({
          contents: `const call=(name,...args)=>{window.lpCalls.push({name,args});return Promise.resolve({ok:true,message:'Saved synthetic fixture.'})};export const saveLpScouting=(...a)=>call('settings',...a),scanLpNow=(...a)=>call('scan',...a),decideLp=(...a)=>call('decide',...a),decideLpContact=(...a)=>call('contact',...a),saveLpKeyword=(...a)=>call('keyword',...a);export const saveLpRecord=(...a)=>{window.lpCalls.push({name:'record',args:a});if(a[0]==='flow'&&!window.flowFailed){window.flowFailed=true;return Promise.resolve({ok:false,message:'Synthetic transient failure.'})}return Promise.resolve({ok:true,message:'Saved synthetic fixture.'})};`,
          loader: "js",
        }));
        b.onResolve({ filter: /^next\/link$/ }, () => ({
          path: "link",
          namespace: "link",
        }));
        b.onLoad({ filter: /.*/, namespace: "link" }, () => ({
          contents: `import React from '${repo}/node_modules/react/index.js';export default function Link(p){return React.createElement('a',p,p.children)}`,
          loader: "js",
          resolveDir: repo,
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
  `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script src="ui.js"></script></body></html>`,
);
const browser = await browserType.launch({
  executablePath: process.env.CHROMIUM_EXECUTABLE_PATH,
  args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  headless: true,
});
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({
      viewport: { width, height: 1000 },
      reducedMotion: "reduce",
      hasTouch: width === 390,
      isMobile: width === 390,
    });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("file://" + join(output, "ui.html"));
    await page
      .getByRole("heading", { name: "LP scouting", exact: true })
      .waitFor();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await page.locator("#lp-mode").focus();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Escape");
    assert.equal(
      await page.evaluate(() => document.activeElement?.id),
      "lp-mode",
    );
    await page.keyboard.press("ArrowDown");
    await page.getByRole("option", { name: "Skip contacts" }).click();
    await page
      .getByRole("button", { name: "Save settings", exact: true })
      .click();
    await page
      .getByRole("status")
      .filter({ hasText: "Saved synthetic" })
      .waitFor();
    assert.equal(await page.evaluate(() => window.lpCalls[0].args[1]), "skip");
    if (width === 390)
      await page.getByRole("button", { name: "Approve LP", exact: true }).tap();
    else
      await page
        .getByRole("button", { name: "Approve LP", exact: true })
        .click();
    await page.waitForFunction(() =>
      window.lpCalls.some((c) => c.name === "decide"),
    );
    await page.screenshot({
      path: join(output, "scouting-" + width + ".png"),
      fullPage: true,
    });
    await page.goto("file://" + join(output, "ui.html") + "?fund");
    await page
      .getByRole("heading", { name: "LP fundraising", exact: true })
      .waitFor();
    await page
      .locator("summary")
      .filter({ hasText: "Record cash flow" })
      .click();
    const form = page.locator("details").filter({
      has: page.locator("summary").filter({ hasText: "Record cash flow" }),
    });
    await form.locator('[id$="-investorId"]').click();
    await form
      .getByRole("option", { name: "Synthetic LP", exact: true })
      .click();
    await form.locator('[id$="-fundId"]').click();
    await form
      .getByRole("option", { name: "Synthetic Fund", exact: true })
      .click();
    await form.locator('[id$="-flowKind"]').click();
    await form
      .getByRole("option", { name: "contribution", exact: true })
      .click();
    await form.getByLabel("Amount (decimal; fund currency)").fill("10000");
    await form.getByLabel("Flow date").fill("2026-10-02");
    await form
      .getByRole("button", { name: "Save record", exact: true })
      .click();
    await form.getByRole("status").filter({ hasText: "transient" }).waitFor();
    await form
      .getByRole("button", { name: "Save record", exact: true })
      .click();
    await form
      .getByRole("status")
      .filter({ hasText: "Saved synthetic" })
      .waitFor();
    const flows = await page.evaluate(() =>
      window.lpCalls.filter((c) => c.name === "record" && c.args[0] === "flow"),
    );
    assert.equal(flows.length, 2);
    assert.equal(flows[0].args[1].id, flows[1].args[1].id);
    assert.match(flows[0].args[1].id, /^[0-9a-f-]{36}$/);
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await page.screenshot({
      path: join(output, "fundraising-" + width + ".png"),
      fullPage: true,
    });
    assert.deepEqual(errors, []);
    await context.close();
    console.log(
      "Chromium synthetic UI passed at " +
        width +
        "px: settings, approval, cash-flow retry identity, responsive overflow and reduced motion.",
    );
  }
} finally {
  await browser.close();
}
