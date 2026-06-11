# React 19 metadata hoist + Suspense streaming bug repro

## Versions

- react: 19.2.6
- react-dom: 19.2.6
- Node: tested on Node ≥ 20

No router, no bundler at runtime (esbuild only bundles the client). No other libraries.

## What this repro shows

When `<title>`, `<meta>`, or `<link>` are rendered inside a `<Suspense>` boundary that **suspends past the shell flush** (i.e. resolves while streaming), React 19 fails to hoist them to `<head>`.

Two distinct symptoms:

1. **SSR output is wrong** — the deferred metadata is streamed into `<body>`, never hoisted to `<head>`. This breaks SEO for crawlers that do not execute JavaScript.
2. **Post-hydration is also wrong** — once the client hydrates, React does move the tags into `<head>`, but **the deferred `<title>` ends up duplicated** in `<head>`.

Compare to the well-behaved baselines:

- **Static `<title>` rendered in `<head>` directly** — fine.
- **Deferred metadata when the boundary resolves before shell flush** (`setTimeout(..., 0)` in the repro) — hoisted correctly on SSR.

## Repro steps

```bash
cd /tmp/react19-meta-repro
npm install
npm run start
```

Then in another terminal:

```bash
# SSR HTML — deferred tags are in body, not head
curl -s http://localhost:3030/
```

Open `http://localhost:3030/` in a browser, wait ~1 s for hydration, then in devtools:

```js
[...document.head.querySelectorAll('title')].length  // -> 3 (one static + two duplicated deferred)
[...document.body.querySelectorAll('title, meta, link')].length  // -> 0 (good — they were moved)
```

## Observed output (100 ms boundary delay)

SSR HTML:

```html
<head>
    <meta charSet="utf-8"/>
    <title>Static title</title>
    <script type="module" src="/client.js" defer=""></script>
</head>
<body>
    <main>
        <h1>React 19 metadata hoist repro</h1>
        <p>…</p>
        <!--$?--><template id="B:0"></template><p>Loading deferred…</p><!--/$-->
    </main>
    <script id="_R_">…</script>
    <!-- DEFERRED METADATA HERE — NOT HOISTED -->
    <title>Deferred title — should be in &lt;head&gt;</title>
    <meta name="description" content="…"/>
    <link rel="canonical" href="…"/>
    <div hidden id="S:0"><div id="deferred-meta-host" style="display:none"></div></div>
    <script>$RC("B:0","S:0")</script>
</body>
```

Browser DOM after hydration:

```
<head>
    <meta charset="utf-8">
    <title>Deferred title — should be in <head></title>   ← from streamed body, moved here
    <title>Static title</title>
    <title>Deferred title — should be in <head></title>   ← DUPLICATE rendered by client
    <meta name="description" content="…">
    <link rel="canonical" href="…">
</head>
<body>
    <!-- (no stray metadata) -->
</body>
```

## Variations

- Set the boundary promise to `setTimeout(..., 0)` instead of 100 ms — SSR hoists correctly and there's no duplicate. The bug requires the boundary to actually suspend during streaming.
- Switch `onShellReady` → `onAllReady` in `server.js` — also hoists correctly (because the server waits for the boundary before flushing anything).

## Why this matters

In production apps using streaming SSR (TanStack Start, custom setups, etc.), per-page SEO metadata is typically rendered inside a route-level Suspense boundary so the rich-meta data fetch does not block TTFB. With React 19's documented universal hoisting, the expectation is:

> "React supports rendering `<title>`, `<link>`, `<meta>`, etc. anywhere in the JSX tree and hoists them to `<head>`."
> — https://react.dev/blog/2024/12/05/react-19

This expectation does not hold for content inside a streaming-suspended boundary. SEO is silently broken on every per-page metadata path.

## File layout

- `App.js` — the React tree (plain JS + `createElement`, runs in both server and client)
- `server.js` — Node HTTP server, `renderToPipeableStream` + `onShellReady`
- `client.js` — `hydrateRoot(document, …)`
- `public/client.js` — esbuild-bundled client (built by `npm run build:client`)
