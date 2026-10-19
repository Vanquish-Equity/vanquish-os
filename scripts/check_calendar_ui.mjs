// Actual Calendar components/CSS; synthetic fixtures and mocked actions only. HTTP(S) blocked.
import { build } from "esbuild";
import fs from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import assert from "node:assert/strict";
const repo = fileURLToPath(new URL("..", import.meta.url)),
  output = fs.mkdtempSync(join(tmpdir(), "calendar-ui-")),
  require = createRequire(import.meta.url);
const { chromium } = require(
  process.env.PLAYWRIGHT_MODULE_PATH ??
    process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES + "/playwright",
);
if (!process.env.CHROMIUM_EXECUTABLE_PATH)
  throw Error("Build first; set CHROMIUM_EXECUTABLE_PATH.");
const event = {
  id: "synthetic-instance",
  calendarId: "primary",
  etag: '"synthetic-v1"',
  summary: "Synthetic recurring meeting",
  description: "Synthetic event only",
  start: { dateTime: "2026-10-16T09:00:00Z", timeZone: "UTC" },
  end: { dateTime: "2026-10-16T10:00:00Z", timeZone: "UTC" },
  recurringEventId: "synthetic-master",
  attendees: [
    { email: "member@synthetic.test", self: true },
    { email: "guest@synthetic.test" },
  ],
};
const mock = `const ok=data=>({ok:true,data});export const calendarCompletionState=async()=>window.flag&&window.permission;export const listCalendars=async()=>ok({calendars:[{id:'primary',summary:'Synthetic Calendar',primary:true,timeZone:'UTC',accessRole:'owner'}],writable:true});export const listCalendarEvents=async()=>ok({events:[structuredClone(window.event)],warnings:[]});export const saveCalendarEvent=async()=>{window.writes++;return ok(window.event)};export const deleteCalendarEvent=async()=>{window.writes++;return ok(true)};export const loadCompletionEvent=async(cid,id,scope)=>ok(scope==='series'?{...structuredClone(window.event),id:'synthetic-master',recurringEventId:undefined,etag:'"master-v1"',recurrence:['RRULE:FREQ=WEEKLY;COUNT=12'],start:{dateTime:'2026-09-01T09:00:00Z',timeZone:'UTC'},end:{dateTime:'2026-09-01T10:00:00Z',timeZone:'UTC'}}:structuredClone(window.event));export const reviewCalendarChange=async change=>{window.reviews++;return ok({id:'f6000000-0000-0000-0000-000000000001',revision:'a'.repeat(64),change,before:{start:window.event.start,end:window.event.end},notified:change.sendUpdates==='all'?change.attendees:[],expiresAt:'2026-10-16T12:10:00Z',targetId:change.scope==='series'?'synthetic-master':change.id})};export const executeCalendarChange=async(id,change,confirmed)=>{if(!confirmed)throw Error('Confirmation missing');window.writes++;return window.mode==='uncertain'?{ok:false,code:'uncertain',message:'Calendar result uncertain. Do not retry.'}:window.mode==='rejected'?{ok:false,code:'rejected',message:'Google rejected this change. Make a NEW review and confirmation.'}:ok(true)};export const cancelCalendarReview=async()=>ok('cancelled');export const listCalendarReviews=async()=>ok([]);export const calendarTaskOverlay=async()=>ok({tasks:[{id:'synthetic-task',title:'Synthetic assigned CRM task',due_at:'2026-10-16'}],partial:false});export const calendarAvailability=async()=>ok([{id:'primary',status:'ready',busy:[{start:'2026-10-16T09:00:00Z',end:'2026-10-16T10:00:00Z'}]}]);`;
const baseline = execFileSync(
  "git",
  [
    "show",
    "c92a81841926bbe11a7f164f01dc776ae1838a74:src/components/calendar/CalendarWorkspace.tsx",
  ],
  { cwd: repo, encoding: "utf8" },
);
await build({
  stdin: {
    contents: `import React from'react';import{createRoot}from'react-dom/client';import Current from'./src/components/calendar/CalendarWorkspace';import Baseline from'@/BaselineCalendar';const C=window.baseline?Baseline:Current;createRoot(document.getElementById('root')).render(<main style={{padding:12}}><C connected/></main>);`,
    resolveDir: repo,
    loader: "tsx",
  },
  bundle: true,
  outfile: join(output, "ui.js"),
  jsx: "automatic",
  nodePaths: [repo + "/node_modules"],
  define: {
    "process.env.NODE_ENV": '"development"',
    "process.env": "{}",
    "process.browser": "true",
  },
  plugins: [
    {
      name: "mock-provider",
      setup(b) {
        b.onResolve(
          { filter: /^@\/lib\/google\/calendar-(actions|completion-actions)$/ },
          (a) => ({ path: a.path, namespace: "mock" }),
        );
        b.onLoad({ filter: /.*/, namespace: "mock" }, () => ({
          contents: mock,
          loader: "js",
        }));
        b.onResolve({ filter: /^@\/BaselineCalendar$/ }, () => ({
          path: "baseline",
          namespace: "baseline",
        }));
        b.onLoad({ filter: /.*/, namespace: "baseline" }, () => ({
          contents: baseline,
          loader: "tsx",
          resolveDir: repo + "/src/components/calendar",
        }));
      },
    },
  ],
});
const manifest = fs.readFileSync(
    repo +
      "/.next/server/app/(dashboard)/calendar/page_client-reference-manifest.js",
    "utf8",
  ),
  paths = [
    ...new Set(
      [...manifest.matchAll(/"path":"(static\/chunks\/[^"]+\.css)"/g)].map(
        (m) => m[1],
      ),
    ),
  ];
assert.ok(paths.length, "Active CSS missing; build first.");
const css = paths
  .map((p) => fs.readFileSync(repo + "/.next/" + p, "utf8"))
  .join("\n");
for (const mode of ["baseline", "off", "noperm", "on"])
  fs.writeFileSync(
    join(output, mode + ".html"),
    `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script>window.event=${JSON.stringify(event)};window.baseline=${mode === "baseline"};window.flag=${mode === "noperm" || mode === "on"};window.permission=${mode === "on"};window.writes=0;window.reviews=0;window.mode='uncertain';const NativeDate=Date;Date=class extends NativeDate{constructor(...args){super(...(args.length?args:['2026-10-16T12:00:00Z']))}static now(){return new NativeDate('2026-10-16T12:00:00Z').getTime()}};</script><script src="ui.js"></script></body></html>`,
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
      timezoneId: "UTC",
    });
    await context.route(/^https?:/, (r) => r.abort());
    const page = await context.newPage(),
      errors = [];
    page.on("pageerror", (e) => {
      errors.push(e.message);
      console.error("BROWSER: " + e.message);
    });
    const go = async (mode) => {
      await page.goto("file://" + join(output, mode + ".html"));
      await page
        .getByRole("button", { name: /Synthetic recurring meeting/ })
        .first()
        .waitFor();
      await page.waitForFunction(
        () =>
          document.querySelector("button") &&
          !document.body.textContent.includes("Loading events"),
      );
    };
    let html;
    for (const mode of ["baseline", "off", "noperm"]) {
      await go(mode);
      const current = await page.locator("#root").innerHTML();
      if (mode === "baseline") html = current;
      else
        assert.equal(
          current,
          html,
          `Entire previous Calendar DOM must match (${mode})`,
        );
      await page
        .getByRole("button", { name: /Synthetic recurring meeting/ })
        .first()
        .click();
      await page
        .getByRole("button", { name: "Edit event", exact: true })
        .click();
      await page
        .getByText("Changes apply to this occurrence.", { exact: false })
        .waitFor();
      assert.equal(
        await page
          .getByRole("button", { name: "Save in Google", exact: true })
          .count(),
        1,
      );
      assert.equal(
        await page
          .getByRole("button", { name: "Review save", exact: true })
          .count(),
        0,
      );
      assert.equal(await page.evaluate(() => window.writes), 0);
    }
    await go("on");
    const tasks = page.getByRole("checkbox", {
      name: "Show my CRM tasks (view only)",
    });
    if (width === 390) await tasks.tap();
    else {
      await tasks.focus();
      await page.keyboard.press("Space");
    }
    await page
      .getByText("Synthetic assigned CRM task", { exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "Check my calendars’ availability" })
      .click();
    await page.getByText("Selected calendar 1: 1 busy intervals").waitFor();
    await page.screenshot({
      path: join(output, `synthetic-calendar-${width}.png`),
      fullPage: true,
    });
    const open = async () => {
      await page
        .getByRole("button", { name: /Synthetic recurring meeting/ })
        .first()
        .click();
      await page
        .getByRole("button", { name: "Edit event", exact: true })
        .click();
    };
    await open();
    const scope = page.locator("#completion-scope");
    assert.equal(
      await page
        .getByRole("button", { name: "Review save", exact: true })
        .isDisabled(),
      true,
    );
    await scope.focus();
    await page.keyboard.press("ArrowDown");
    await page
      .getByRole("option", { name: "Whole series", exact: true })
      .waitFor();
    await page.keyboard.press("Escape");
    await page.waitForFunction(
      () =>
        document
          .querySelector("#completion-scope")
          ?.getAttribute("aria-expanded") === "false",
      null,
      { timeout: 5000 },
    );
    assert.equal(await scope.getAttribute("aria-expanded"), "false");
    await page.waitForFunction(
      () => document.activeElement?.id === "completion-scope",
    );
    assert.equal(
      await scope.evaluate((e) => e === document.activeElement),
      true,
    );
    assert.equal(
      await scope
        .locator("svg")
        .evaluate((e) => getComputedStyle(e).transitionProperty),
      "none",
    );
    await scope.click();
    await page
      .getByRole("option", { name: "Whole series", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Review save", exact: true })
      .waitFor();
    await page.waitForFunction(
      () =>
        document.querySelector('input[type="datetime-local"]')?.value ===
        "2026-09-01T09:00",
    );
    await page
      .getByRole("button", { name: "Review save", exact: true })
      .click();
    const confirm = page.getByRole("button", {
      name: "Confirm change",
      exact: true,
    });
    await confirm.waitFor();
    assert.equal(await confirm.isDisabled(), true);
    assert.equal(await page.evaluate(() => window.writes), 0);
    const check = page.getByRole("checkbox", { name: /I confirm the scope/ });
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
    await confirm.click();
    await page
      .getByRole("status")
      .filter({ hasText: "result uncertain" })
      .waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "Review save", exact: true })
        .isDisabled(),
      true,
    );
    assert.equal(await page.evaluate(() => window.writes), 1);
    // Clear definitive rejection permits a new review but never an automatic write.
    await go("on");
    await page.evaluate(() => (window.mode = "rejected"));
    await open();
    await scope.click();
    await page
      .getByRole("option", { name: "This occurrence", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Review RSVP", exact: true })
      .click();
    await check.check();
    await confirm.click();
    await page
      .getByRole("status")
      .filter({ hasText: "Google rejected" })
      .waitFor();
    assert.equal(
      await page
        .getByRole("button", { name: "Review RSVP", exact: true })
        .isEnabled(),
      true,
    );
    await page
      .getByRole("button", { name: "Review RSVP", exact: true })
      .click();
    await confirm.waitFor();
    assert.equal(await confirm.isDisabled(), true);
    assert.equal(await page.evaluate(() => window.writes), 1);
    // Pointer drag and resize keyboard alternative only propose dates, never execute.
    await go("on");
    await page.getByRole("button", { name: "Month", exact: true }).click();
    await page.getByRole("option", { name: "Day", exact: true }).click();
    const move = page.getByRole("button", {
      name: "Move or open Synthetic recurring meeting",
      exact: true,
    });
    await move.scrollIntoViewIfNeeded();
    const box = await move.boundingBox();
    await page.mouse.move(box.x + 20, box.y + 18);
    await page.mouse.down();
    await page.mouse.move(box.x + 20, box.y + 44);
    await page.mouse.up();
    await scope.waitFor();
    await scope.click();
    await page
      .getByRole("option", { name: "This occurrence", exact: true })
      .click();
    await page.waitForFunction(
      () =>
        document.querySelector('input[type="datetime-local"]')?.value ===
        "2026-10-16T09:30",
    );
    assert.equal(await page.evaluate(() => window.writes), 0);
    await page
      .getByRole("button", { name: "Close reviewed event editor", exact: true })
      .click();
    const resize = page.getByRole("button", {
      name: "Resize Synthetic recurring meeting; Alt arrows adjust duration",
      exact: true,
    });
    await resize.focus();
    await page.keyboard.press("Alt+ArrowDown");
    await scope.waitFor();
    await scope.click();
    await page
      .getByRole("option", { name: "This occurrence", exact: true })
      .click();
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll('input[type="datetime-local"]')][1]
          ?.value === "2026-10-16T10:15",
    );
    assert.equal(await page.evaluate(() => window.writes), 0);
    assert.deepEqual(errors, []);
    console.log(
      `PASS synthetic Chromium ${width}px: exact baseline DOM off/no-permission, explicit scope/master, review/confirmation, uncertainty/rejection, tasks, busy-only, pointer drag, resize keyboard, touch/reduced motion: ${output}`,
    );
    await context.close();
  }
} finally {
  await browser.close();
}
