# React 19 metadata hoist bug repro

Minimal repro for React 19 metadata hoisting failures around streaming SSR + hydration.

## Versions

- `react`: 19.2.6
- `react-dom`: 19.2.6
- Node: 20+ (tested on 22)
- SSR API: `renderToPipeableStream`

No router, no bundler at runtime, no other libraries. Esbuild only bundles the client.

## TL;DR

React 19 documents universal hoisting of `<title>`, `<meta>`, and `<link>` from anywhere in the JSX tree to `<head>`. This repro shows that in practice three distinct hoist failures occur:

| Mode | SSR HTML | Post-hydration DOM | Bug |
|---|---|---|---|
| `ok` | 18 deferred tags in `<head>` ✓ | 18 in `<head>`, body clean ✓, **`<title>` duplicated** ✗ | Client-side hoisting creates a duplicate `<title>` even when no Suspense / no `use()` is involved |
| `ssr-fail` | Deferred tags stream into `<body>` ✗ | 1 `<title>` re-hoists to head, the other 17 stay in `<body>` ✗ | SSR fails to hoist past shell-flush AND client doesn't recover most of them |
| `client-fail` | 18 deferred tags in `<head>` ✓ | 18 in `<head>`, body clean ✓, **`<title>` duplicated** ✗ | Same client-side duplicate-title as `ok`, triggered via client `use()` re-suspension during hydration |

## What each mode does

All three modes render the same 18 metadata tags (matching the shape of a real-world per-page SEO head: `<title>`, `<meta name="description">`, `<meta name="robots">`, `<meta property="og:*">` × 7, `<meta name="twitter:*">` × 5, `<link rel="canonical">`, `<link rel="alternate">` × 2). The only differences are how/when those tags are rendered.

- **`ok`** — tags rendered directly (no Suspense, no `use()`). Server uses `onAllReady`. The baseline.
- **`ssr-fail`** — tags rendered inside `<Suspense>`; the component calls `use(promise)` where `promise` resolves after a 100 ms delay on both server and client. Server uses `onShellReady` to flush the shell first. This is the streaming SSR case where the boundary resolves during streaming.
- **`client-fail`** — same as `ssr-fail` but the server's promise resolves at 0 ms (modeling a loader that pre-fetched data) and the server uses `onAllReady` (so the boundary completes before flush and SSR hoists). The client's promise still suspends for 100 ms during hydration (modeling a fresh promise created on the client even when data is already cached).

## Run

```bash
npm install
npm run start
```

Then:

```bash
# SSR HTML — the response curl receives
curl -s http://localhost:3030/?mode=ok        # expected: 18 deferred tags in head
curl -s http://localhost:3030/?mode=ssr-fail  # bug: 18 deferred tags in body
curl -s http://localhost:3030/?mode=client-fail # expected: 18 deferred tags in head
```

Open `http://localhost:3030/?mode=<mode>` in a browser, wait ~1.5 s for hydration, then in devtools:

```js
[...document.head.querySelectorAll('title, meta, link')].length
[...document.body.querySelectorAll('title, meta, link')].length
[...document.head.querySelectorAll('title')].length  // count of <title> in head
```

## Observed output

### `mode=ok` — baseline (no Suspense)

SSR HTML:
```
HEAD: 20 tags (charset + Static title + 18 deferred — all hoisted)
BODY: 0 tags
```

After hydration:
```
HEAD: 21 tags — 18 deferred + Static + charset + EXTRA "Deferred title"
BODY: 0 tags
3 <title> elements in head: ["Deferred…", "Static", "Deferred…"]
```

Bug: even with no Suspense and no `use()`, React 19 hydration inserts a duplicate `<title>` element in `<head>` for the body-rendered title.

### `mode=ssr-fail` — streaming SSR with suspended boundary

SSR HTML:
```
HEAD: 2 tags (charset + Static title)
BODY: 18 tags (all deferred tags streamed into body, NOT hoisted)
```

After hydration:
```
HEAD: 3 tags (charset + Static + Deferred title)
BODY: 18 tags (the 17 non-title deferred tags + 1 title — title duplicated across head and body)
```

Bug 1 (SSR): React 19 fails to hoist `<title>/<meta>/<link>` to `<head>` when the Suspense boundary resolves after the shell flushes. Tags stream into `<body>` instead. This breaks SEO for crawlers that don't run JavaScript.

Bug 2 (hydration recovery): the client doesn't move the 17 non-title deferred tags from `<body>` to `<head>` — they remain stranded in `<body>`. Only `<title>` gets a copy in `<head>`, and it duplicates the one still in body.

### `mode=client-fail` — SSR hoists, client re-suspends during hydration

SSR HTML:
```
HEAD: 20 tags (charset + Static + 18 deferred — SSR hoisted correctly)
BODY: 0 tags
```

After hydration:
```
HEAD: 21 tags — duplicate "Deferred title"
BODY: 0 tags
3 <title> elements in head: ["Deferred…", "Static", "Deferred…"]
```

Bug: client-side hydration inserts a duplicate `<title>` in `<head>` even though the SSR-hoisted tag is already there. The duplicate appears whenever the deferred component's `use(promise)` suspends during hydration — even briefly.

## Real-world impact

This is the failure mode for every per-page SEO metadata path in apps using streaming SSR with deferred data (e.g. TanStack Start + Relay, custom Vite SSR setups). The recommended React 19 pattern — render rich metadata inside a Suspense boundary so the shell can stream without waiting on the data — silently breaks SEO and creates duplicate `<title>` elements after hydration.

Related issue: [TanStack/router#3050](https://github.com/TanStack/router/issues/3050) "TanStack Start and React 19 Metadata Tags". The behavior described there is consistent with the bugs in this repro.

## File layout

- `App.js` — React tree (plain JS + `createElement`, runs on both server and client)
- `server.js` — Node HTTP server, `renderToPipeableStream`, mode-aware (`onShellReady` for `ssr-fail`, `onAllReady` otherwise)
- `client.js` — `hydrateRoot(document, ...)`, reads mode from `window.__REPRO_MODE__`
- `public/client.js` — esbuild-bundled client (built by `npm run build:client`)
