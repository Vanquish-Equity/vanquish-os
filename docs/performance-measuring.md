# Measuring performance in production

The performance panel answers one question with real data: where does the time
go for one real request? It shows the server phases (session check, each
database, Google and storage call) next to the browser timeline (first byte,
paint, hydration, every client request, and how long each click takes).

It is **off by default** and adds nothing to the page, the bundle or the
request unless all three conditions below are true.

## Turn it on

1. **Environment variable (server only).** In Vercel: Project, Settings,
   Environment Variables, add `VQ_PERF_PANEL` with the value `1` for the
   environment you want to measure (Production, Preview or both), then redeploy
   so the running functions see it. Do not use a `NEXT_PUBLIC_` name: the value
   must never reach the browser.
2. **Admin account.** The signed-in member needs the `admin` permission. The
   check runs on the server before anything is written to the page.
3. **`?perf=1` in the address.** Open the page you want to measure with
   `?perf=1`, for example `/people?perf=1` or `/companies?perf=1&view=table`.
   Pages opened without it behave exactly as before, even with the variable on.

A small **Performance** button then appears in the bottom-right corner. Open it,
read it, press **Copy report** to paste a text summary into a chat, and press
**Close** (or Escape) when done.

## Turn it off

Delete `VQ_PERF_PANEL` (or set it to anything other than `1`) and redeploy.
With the variable off, the proxy, layout and data clients run the same code
paths as before: no extra header, no custom `fetch`, no timeline, no panel code
requested.

## How to read the panel

- **Where the time went** lists the three largest phases of this page load:
  - *Server wait before the first byte*: proxy, session check and the start of
    rendering, as seen from the browser.
  - *Server streaming the rest of the page*: time between the first and the last
    byte of the HTML. The page is streamed, so data that is still loading on
    the server after the shell was sent shows up here.
  - *Network before the request*: redirects, DNS and connection.
  - *JavaScript download*: scripts downloaded, with overlaps counted once.
  - *Hydration (estimate)*: from the last script to the page becoming
    interactive. It is an estimate based on a mark made when the layout hydrates.
  - *Main thread blocked*: long tasks over 50 ms. These overlap the phases above.
- **Server (this page load)** is the timeline of that one request: each row is a
  label, a bar placed by its start time, and its duration.
  - `getAccess`: who you are and what you may use (once per request).
  - `auth ...`: Supabase Auth calls made while checking the session
    (`auth user`, `auth jwks`, `auth token`).
  - `db select <table>`, `db insert`, `db update`, `db delete`, `db count`:
    Supabase REST calls, labelled by table or view name only.
  - `rpc <function>`: Supabase functions called through REST.
  - `storage <operation> <bucket>`: Supabase Storage calls.
  - `gmail.threads.list`, `calendar.events.get`, `google.oauth.token`...:
    Google calls, by generic endpoint name only.
  - `layout.start` and `layout.shell-data-ready`: when the dashboard layout
    started and when its own data was ready. Page-level marks are not recorded:
    the page's own data calls appear as `db`/`rpc`/`google` rows, and the last
    call to finish ends the timeline.
  - Durations run until the response *headers* arrive. Calls that overlap run in
    parallel; calls that start one after another are a waterfall.
  - The line above the rows gives the proxy time and, inside it, the session
    check.
- **Browser (this page load)**: first byte, first contentful paint, largest
  contentful paint, hydration estimate, DOM content loaded and load.
- **Heaviest files**: the 10 slowest downloads (file name, time, size). No
  query strings.
- **Client requests (RSC and fetch)**: the latest fetch requests of the page,
  including Next.js background prefetches of sidebar links. Each shows the total
  time, the *wait* (time until the response started, which is server think time
  plus network) and the proxy time when the server sent it.
- **Interactions**: every click, change or Enter after the page opened, from the
  action until requests and screen updates stop for 300 ms. It lists how many
  requests it caused, the slowest one and the names (not values) of URL
  parameters that changed. This is how to time the Cards/Table switch or a
  filter change.

Two limits to keep in mind:

- The server timeline belongs to the page load that carried `?perf=1`. For
  later in-page changes (soft navigations) the layout is not re-rendered, so the
  panel shows what the browser saw for each request (total, wait, proxy time)
  instead of a new server timeline. Reload the new address with `?perf=1` to get
  the full server breakdown for it.
- The page waits for the request's pending calls (at most 10 seconds) before it
  writes the timeline, so the browser `load` event of a measured page can come
  later than usual. That delay is part of measuring, not of the app.

## The `Server-Timing` header

While `VQ_PERF_PANEL=1`, every response that goes through the proxy carries a
standard `Server-Timing` header, for example
`session;dur=43;desc="proxy session check", proxy;dur=46;desc="proxy total"`.
It is visible in the browser's Network tab (Timing) without opening the panel.

It only holds proxy times. The render times cannot go in a response header:
pages stream, so the headers are sent before the page finishes rendering and
cannot be changed afterwards. The panel solves this by writing the timeline
into the HTML at the end of the stream (a `<script type="application/json"
id="vq-perf-server">`, present only for an admin with `?perf=1`).

## What it does not record

- No row values, no query strings, no URLs, no filters.
- No email addresses, names, ids, tokens, cookies or request/response bodies.
- Database calls: only the table or view name and the kind of call.
  Functions: only the function name. Storage: only the operation and bucket.
- Google: only a generic endpoint name such as `gmail.threads.list`; never
  message, thread, event or file ids, queries or addresses.
- Browser: file names without query strings; request paths with ids replaced by
  `:id`; URL parameter *names*, never values; click targets as an element kind
  (for example `button "table"`, with the text kept only for a short list of
  generic words like cards, table, filters).
- "Copy report" copies the same generic names and numbers shown on screen.

Labels pass a validator that replaces anything that is not a short identifier
(addresses, ids and URLs included) with `other`.

## Safety and cost

- No new queries, no change to query order or parallelism, no permission change.
- With the variable on but without `?perf=1`: only the `Server-Timing` header
  is added.
- With `?perf=1` and a non-admin account: calls are timed in memory until the
  server knows the account is not an admin; the recording is then discarded and
  nothing is written to the page. The browser-sent `x-vq-perf` headers are
  ignored; only the proxy can mark a request.
- Collection is capped at 400 calls per request.
- The panel code is a separate lazy chunk, requested only when it is shown.

## Where it is implemented

- `src/lib/perf/`: collector, label rules, timed `fetch`, proxy helper,
  report text and browser measurements (with tests).
- `src/lib/supabase/server.ts`: passes the timed `fetch` only while measuring.
- `src/lib/google/transport.ts`: times Google calls only while measuring.
- `src/lib/supabase/middleware.ts`: proxy session timing and `Server-Timing`.
- `src/components/perf/`: server component that writes the timeline, lazy
  loader and the panel.
