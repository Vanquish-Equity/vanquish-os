// Actual composer/editor/controls/CSS; ALL content and provider actions are synthetic mocks.
// Build first. No connected accounts, provider requests or real mutations.
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
const repo = fileURLToPath(new URL("..", import.meta.url));
const output = fs.mkdtempSync(join(tmpdir(), "vanquish-mail-ui-"));
const mock = `
const ok=data=>({ok:true,data});
export const mailboxProfile=async()=>ok({email:'sender@synthetic.test'});
export const mailSignature=async()=>ok({html:''});
export const saveGmailDraft=async()=>{window.writes++;return ok({id:'draft-synthetic'})};
export const sendGmailDraft=async()=>{window.writes++;return ok({id:'sent-synthetic'})};
export const discardGmailDraft=async()=>{window.writes++;return ok(true)};
export const mailCompletionState=async()=>window.enabled;
export const mailCompletionAliases=async()=>{window.aliasReads++;return ok([{email:'sender@synthetic.test',default:true,primary:true},{email:'alias@synthetic.test',default:false,primary:false}])};
export const startMailUpload=async(files)=>{window.uploads=files;return ok({id:'upload-synthetic'})};
export const uploadMailChunk=async(id,index,offset,bytes)=>{window.chunks.push({index,offset,size:bytes.length});return ok(true)};
export const removeMailUpload=async()=>ok(true);
export const cancelMailReview=async()=>ok('cancelled');
export const listMailReviews=async()=>ok([]);
export const reviewMailMutation=async(operation,form)=>{const m=JSON.parse(form.get('message'));window.reviews++;return ok({id:'f5000000-0000-0000-0000-000000000001',operation,sender:form.get('alias'),to:[m.to],cc:[],bcc:[],subject:m.subject,html:m.html,attachments:window.uploads,expiresAt:'2026-10-16T12:10:00Z',draftRetained:operation==='send'})};
export const executeMailMutation=async(id,operation,form,confirmed)=>{if(!confirmed)throw Error('Confirmation missing');window.writes++;return window.uncertain?{ok:false,code:'uncertain',message:'Outcome uncertain. Do not retry; review Gmail.'}:ok({id:'synthetic-result',operation})};
`;
await build({
  stdin: {
    contents: `import React from'react';import{createRoot}from'react-dom/client';import Composer from'./src/components/mail/MailComposer';createRoot(document.getElementById('root')).render(<Composer seed={{draftId:'draft-synthetic',draftMessageId:'message-synthetic',to:'recipient@synthetic.test',cc:'',bcc:'',subject:'Synthetic verification only',html:'<p>Synthetic message, no real correspondence.</p>'}} contacts={[]} groups={[]} onClose={()=>window.closedComposer=true} onSent={()=>window.sent=true}/>);`,
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
      name: "mock-provider-actions",
      setup(b) {
        b.onResolve(
          { filter: /^@\/lib\/google\/mail-(actions|completion-actions)$/ },
          (a) => ({ path: a.path, namespace: "mock" }),
        );
        b.onLoad({ filter: /.*/, namespace: "mock" }, () => ({
          contents: mock,
          loader: "js",
        }));
      },
    },
  ],
});
const manifest = fs.readFileSync(
  repo +
    "/.next/server/app/(dashboard)/communications/page_client-reference-manifest.js",
  "utf8",
);
const cssPaths = [
  ...new Set(
    [...manifest.matchAll(/"path":"(static\/chunks\/[^\"]+\.css)"/g)].map(
      (m) => m[1],
    ),
  ),
];
assert.ok(cssPaths.length, "Active Communications CSS missing; rebuild first.");
const css = cssPaths
  .map((p) => fs.readFileSync(repo + "/.next/" + p, "utf8"))
  .join("\n");
for (const enabled of [false, true])
  fs.writeFileSync(
    join(output, `${enabled}.html`),
    `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script>window.enabled=${enabled};window.writes=0;window.reviews=0;window.aliasReads=0;window.uploads=[];window.chunks=[];window.uncertain=false;</script><script src="ui.js"></script></body></html>`,
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
    });
    // Fail any network call: fixtures and bundle are local files, body preview is about:srcdoc.
    await context.route(/^https?:/, (route) => route.abort());
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto("file://" + join(output, "false.html"));
    await page.getByRole("button", { name: "Send", exact: true }).waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "Save to Gmail", exact: true })
        .count(),
      1,
    );
    assert.equal(
      await page.getByText("Verified Google send-as", { exact: true }).count(),
      0,
    );
    assert.equal(
      await page.getByRole("button", { name: /Schedule send/ }).count(),
      0,
    );
    assert.equal(
      await page.evaluate(() => window.aliasReads + window.writes),
      0,
    );
    await page.screenshot({
      path: join(output, `synthetic-legacy-${width}.png`),
      fullPage: true,
    });
    await page.goto("file://" + join(output, "true.html"));
    const alias = page.locator("#mail-send-as");
    await alias.waitFor();
    assert.equal(
      await alias
        .locator("svg")
        .evaluate((e) => getComputedStyle(e).transitionProperty),
      "none",
    );
    await alias.focus();
    await page.keyboard.press("ArrowDown");
    await page
      .getByRole("option", { name: "alias@synthetic.test", exact: true })
      .waitFor();
    await page.keyboard.press("Escape");
    assert.equal(await alias.getAttribute("aria-expanded"), "false");
    assert.equal(
      await alias.evaluate((e) => e === document.activeElement),
      true,
    );
    assert.equal(
      await page.getByRole("button", { name: /Schedule send/ }).isDisabled(),
      true,
    );
    const review = page.getByRole("button", {
      name: "Review send",
      exact: true,
    });
    if (width === 390) await review.tap();
    else {
      await review.focus();
      await page.keyboard.press("Enter");
    }
    const confirm = page.getByRole("button", {
      name: "Confirm send",
      exact: true,
    });
    await confirm.waitFor();
    assert.equal(await confirm.isDisabled(), true);
    assert.equal(await page.evaluate(() => window.writes), 0);
    const check = page.getByRole("checkbox", {
      name: /I confirm these final recipients/,
    });
    if (width === 390) await check.tap();
    else {
      await check.focus();
      await page.keyboard.press("Space");
    }
    await confirm.scrollIntoViewIfNeeded();
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
      true,
    );
    await page.screenshot({
      path: join(output, `synthetic-review-${width}.png`),
      fullPage: true,
    });
    await page.evaluate(() => (window.uncertain = true));
    if (width === 390) await confirm.tap();
    else {
      await confirm.focus();
      await page.keyboard.press("Enter");
    }
    await page
      .getByRole("status")
      .filter({ hasText: "Outcome uncertain" })
      .waitFor();
    assert.equal(await review.isDisabled(), true);
    assert.equal(await page.evaluate(() => window.writes), 1);
    // A file is staged in two bounded chunks; preparing a review never writes Google.
    await page.goto("file://" + join(output, "true.html"));
    await alias.waitFor();
    await page
      .locator('input[type="file"]')
      .setInputFiles({
        name: "synthetic-attachment.txt",
        mimeType: "text/plain",
        buffer: Buffer.alloc(300000, 65),
      });
    await page
      .getByRole("button", { name: "Review save to Gmail", exact: true })
      .click();
    const save = page.getByRole("button", {
      name: "Confirm save",
      exact: true,
    });
    await save.waitFor();
    assert.deepEqual(await page.evaluate(() => window.chunks), [
      { index: 0, offset: 0, size: 262144 },
      { index: 0, offset: 262144, size: 37856 },
    ]);
    assert.equal(await page.evaluate(() => window.writes), 0);
    await page
      .getByRole("checkbox", { name: /I confirm these final recipients/ })
      .check();
    await save.click();
    await page
      .getByRole("status")
      .filter({ hasText: "Saved in Gmail. Close and reopen" })
      .waitFor();
    assert.equal(await page.evaluate(() => window.writes), 1);
    assert.equal(
      await page
        .getByRole("button", { name: "Review save to Gmail", exact: true })
        .isDisabled(),
      true,
    );
    assert.deepEqual(errors, []);
    console.log(
      `PASS synthetic Chromium ${width}px: legacy flag-off, verified alias keyboard, disabled scheduling, explicit confirmation, uncertain/no retry, chunked save, touch, reduced motion: ${output}`,
    );
    await context.close();
  }
} finally {
  await browser.close();
}
