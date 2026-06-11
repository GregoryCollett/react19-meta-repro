# React 19 metadata hoist bug repro

Minimal repro for a React 19 hoisting bug: `<meta>` and `<link>` rendered inside a `<Suspense>` boundary that suspends past the shell flush are streamed into `<body>` instead of `<head>`, and client hydration does not recover them.

## Versions

- `react`: 19.2.6
- `react-dom`: 19.2.6
- Node: 20+ (tested on 22)
- SSR API: `renderToPipeableStream`

No router, no bundler at runtime, no other libraries. Esbuild only bundles the client.

## TL;DR

React 19 documents universal hoisting of `<meta>` and `<link>` from anywhere in the JSX tree to `<head>`. The `?mode=ssr-fail` case in this repro shows that hoisting silently fails when the rendering component lives inside a Suspense boundary that resolves after the shell has flushed during streaming SSR.

| Mode | SSR HTML | Post-hydration DOM | Bug |
|---|---|---|---|
| `ok` | All deferred tags in `<head>` ✓ | All in `<head>`, body clean ✓ | None (extra `<title>` is [documented React behavior](https://react.dev/reference/react-dom/components/title)) |
| `ssr-fail` | 18 deferred tags stream into `<body>` ✗ | 17 `<meta>`/`<link>` stranded in `<body>` ✗ | **Yes** — `<meta>` and `<link>` are not hoisted at SSR and not recovered at hydration |
| `client-fail` | All deferred tags in `<head>` ✓ | All in `<head>`, body clean ✓ | None (extra `<title>` is documented React behavior) |

## A note on `<title>`

This repro also surfaces a duplicate `<title>` in `<head>` after hydration in the `ok` and `client-fail` modes. This is **not** a React bug — it's [explicitly documented](https://react.dev/reference/react-dom/components/title):

> Only render a single `<title>` at a time. If more than one component renders a `<title>` tag at the same time, React will place all of those titles in the document head. When this happens, the behavior of browsers and search engines is undefined.

So the only `<title>` observation that matters is "1 title gets hoisted in `ssr-fail`, 17 non-title tags do not". The duplicate-`<title>` post-hydration observations in the other modes are out of scope.

## What each mode does

All three modes render the same 18 metadata tags inside their respective component (matching the shape of a real-world per-page SEO head: `<title>`, `<meta name="description">`, `<meta name="robots">`, `<meta property="og:*">` × 7, `<meta name="twitter:*">` × 5, `<link rel="canonical">`, `<link rel="alternate">` × 2). The only differences are how/when those tags are rendered.

- **`ok`** — tags rendered directly in body (no Suspense, no `use()`). Server uses `onAllReady`. Baseline showing hoisting works correctly when there's no suspending boundary.
- **`ssr-fail`** — tags rendered inside `<Suspense>`; the component calls `use(promise)` where `promise` resolves after a 100 ms delay on both server and client. Server uses `onShellReady` to flush the shell first. This is the streaming SSR case where the boundary resolves *after* the shell has flushed. **This is the buggy case.**
- **`client-fail`** — same as `ssr-fail` but the server's promise resolves at 0 ms (modeling a loader that pre-fetched data) and the server uses `onAllReady` (so the boundary completes before flush and SSR hoists). The client's promise still suspends for 100 ms during hydration (modeling a fresh promise on the client). Hoisting works correctly here.

## Run

```bash
npm install
npm run start
```

Then:

```bash
# SSR HTML — the response curl receives
curl -s http://localhost:3030/?mode=ok          # expected: 18 deferred tags in head
curl -s http://localhost:3030/?mode=ssr-fail    # bug:      18 deferred tags in body
curl -s http://localhost:3030/?mode=client-fail # expected: 18 deferred tags in head
```

Open `http://localhost:3030/?mode=<mode>` in a browser, wait ~1.5 s for hydration, then in devtools:

```js
[...document.head.querySelectorAll('meta, link')].length
[...document.body.querySelectorAll('meta, link')].length
```

## Observed output

### `mode=ssr-fail` — the bug

SSR HTML:

```html
<head>
    <meta charSet="utf-8"/>
    <title>Static title</title>
</head>
<body>
    <main>...</main>
    <!-- 18 deferred metadata tags stream in here — NOT hoisted -->
    <title>Deferred title</title>
    <meta name="description" content="..."/>
    <meta name="robots" content="..."/>
    <meta property="og:image" content="..."/>
    ... (17 non-title <meta>/<link> total)
    <link rel="canonical" href="..."/>
    <link rel="alternate" href="..."/>
    <div hidden id="S:0">...</div>
    <script>$RC("B:0","S:0")</script>
</body>
```

Post-hydration DOM:

```
HEAD: 3 tags (charset + Static title + 1 Deferred title)
BODY: 18 tags (17 non-title <meta>/<link> stranded + 1 <title>)
[...document.body.querySelectorAll('meta, link')].length  // -> 17
```

Bug: React 19 fails to hoist `<meta>` and `<link>` rendered inside the streaming-suspended boundary. They land in `<body>` in the SSR HTML and remain stranded there after hydration — the client does not move them to `<head>`.

### `mode=ok` and `mode=client-fail` — no bug (control cases)

SSR HTML:

```
HEAD: all 18 deferred tags hoisted correctly
BODY: 0 tags
```

Post-hydration DOM:

```
HEAD: all 18 deferred tags
BODY: 0 tags
(Extra <title> in head is documented React behavior; out of scope.)
```

## Variations that confirm scope

The bug requires *all* of:
- Tags rendered inside a `<Suspense>` boundary
- That boundary actually suspends during streaming SSR (resolves after the shell flushes)

If the boundary completes before flush (use `onAllReady` or remove the delay), hoisting works. If there is no Suspense / `use()`, hoisting works. Only the streaming-suspended case fails.

## Real-world impact

This is the failure mode for every per-page SEO `<meta>` and `<link>` path in apps using streaming SSR with deferred data (TanStack Start + Relay, custom Vite SSR setups, etc.). The recommended React 19 pattern — render rich metadata inside a Suspense boundary so the shell can stream without waiting on the data — silently breaks SEO: per-page `<meta name="description">`, `og:*`, `twitter:*`, `canonical`, `alternate` etc. end up in `<body>` and never reach `<head>`, even after hydration.

## Related

- [TanStack/router#3050](https://github.com/TanStack/router/issues/3050) — same symptom reported, originally attributed to TanStack. This repro confirms it occurs in pure React 19.
- [facebook/react#32224](https://github.com/facebook/react/pull/32224) — merged Feb 2025, handles Suspense hydration in html/head/body context. `react@19.2.6` includes this PR, so the bug here is separate.

## File layout

- `App.js` — React tree (plain JS + `createElement`, runs on both server and client)
- `server.js` — Node HTTP server, `renderToPipeableStream`, mode-aware (`onShellReady` for `ssr-fail`, `onAllReady` otherwise)
- `client.js` — `hydrateRoot(document, ...)`, reads mode from `window.__REPRO_MODE__`
- `public/client.js` — esbuild-bundled client (built by `npm run build:client`)
