// Minimal React 19 streaming-Suspense + metadata-hoist bug repro.
// Plain JS (no JSX) so the server can `import` this without transpilation.
//
// Three scenarios driven by the `mode` prop (URL query ?mode=):
//   - `ok`            both server and client resolve synchronously     → expected to work
//   - `ssr-fail`      both server and client delay before resolving    → SSR streams tags into <body>
//   - `client-fail`   server resolves sync, client delays              → SSR hoists, client duplicates <title> in <head>
//
// `client-fail` mirrors a real app shape (e.g. TanStack Start + Relay):
// the server pre-resolves the meta query via the loader so SSR's Suspense
// boundary completes before the shell flushes and React 19 hoists the
// tags. On the client the same data is already in cache, but
// `use(loaderData.metaPromise)` still receives a fresh promise that
// suspends briefly during hydration — and that suspension is what causes
// React to insert a duplicate <title> in <head>.
import { createElement as h, Fragment, Suspense, use } from 'react';

const isClient = typeof window !== 'undefined';
const DEFAULT_DELAY_MS = 100;

const delayFor = (mode) => {
    if (mode === 'ok') return 0;
    if (mode === 'ssr-fail') return DEFAULT_DELAY_MS;
    if (mode === 'client-fail') return isClient ? DEFAULT_DELAY_MS : 0;
    return 0;
};

// Module-scoped per JS environment: server and client each create their own.
// The server must call resetDeferredPromise() before each render so a fresh
// suspending promise is created per request — otherwise the second and
// subsequent requests reuse the already-resolved promise and never suspend.
let deferredPromise = null;
const getDeferredPromise = (mode) => {
    if (deferredPromise) return deferredPromise;
    const ms = delayFor(mode);
    // Even ms === 0 uses setTimeout: the boundary needs to actually suspend
    // (use() always throws on first read of a fresh promise) and then resume
    // on the next tick. With a microtask tick the boundary still resolves
    // before the shell flushes, so SSR can hoist.
    deferredPromise = new Promise((resolve) => {
        setTimeout(() => resolve({ ready: true }), ms);
    });
    return deferredPromise;
};

export const resetDeferredPromise = () => {
    deferredPromise = null;
};

const DeferredHead = ({ mode }) => {
    // Suspends until the promise resolves.
    use(getDeferredPromise(mode));
    // Render the same shape (count + variety) of tags as Mixcloud's
    // showHead — title, description, robots, og:*, twitter:*, canonical,
    // alternate. Total 18 tags, matching the real-world case.
    return h(
        Fragment,
        null,
        h('title', { key: 't' }, 'Deferred title — should be in <head>'),
        h('meta', { key: 'd', name: 'description', content: 'Deferred description' }),
        h('meta', { key: 'r', name: 'robots', content: 'noai, noimageai' }),
        h('meta', { key: 'oi', property: 'og:image', content: 'https://example.test/og.jpg' }),
        h('meta', { key: 'oiw', property: 'og:image:width', content: '1200' }),
        h('meta', { key: 'oih', property: 'og:image:height', content: '628' }),
        h('meta', { key: 'ot', property: 'og:title', content: 'Deferred OG title' }),
        h('meta', { key: 'od', property: 'og:description', content: 'Deferred OG description' }),
        h('meta', { key: 'oty', property: 'og:type', content: 'website' }),
        h('meta', { key: 'ou', property: 'og:url', content: 'http://localhost:3030/' }),
        h('meta', { key: 'tc', name: 'twitter:card', content: 'summary_large_image' }),
        h('meta', { key: 'ti', name: 'twitter:image', content: 'https://example.test/og.jpg' }),
        h('meta', { key: 'tai', name: 'twitter:app:url:iphone', content: 'app://ios' }),
        h('meta', { key: 'tap', name: 'twitter:app:url:ipad', content: 'app://ipad' }),
        h('meta', { key: 'tag', name: 'twitter:app:url:googleplay', content: 'app://android' }),
        h('link', { key: 'c', rel: 'canonical', href: 'http://localhost:3030/canonical' }),
        h('link', { key: 'aa', rel: 'alternate', href: 'android-app://com.example/http/localhost:3030/' }),
        h('link', { key: 'ao', rel: 'alternate', href: 'http://localhost:3030/oembed', type: 'application/json+oembed' }),
    );
};

// Renders the same metadata as DeferredHead but without going through a
// Suspense boundary or use(promise). Used as the `ok` baseline to show
// that React 19 hoisting works correctly when there's no suspension.
const ImmediateHead = () =>
    h(
        Fragment,
        null,
        h('title', { key: 't' }, 'Deferred title — should be in <head>'),
        h('meta', { key: 'd', name: 'description', content: 'Deferred description' }),
        h('meta', { key: 'r', name: 'robots', content: 'noai, noimageai' }),
        h('meta', { key: 'oi', property: 'og:image', content: 'https://example.test/og.jpg' }),
        h('meta', { key: 'oiw', property: 'og:image:width', content: '1200' }),
        h('meta', { key: 'oih', property: 'og:image:height', content: '628' }),
        h('meta', { key: 'ot', property: 'og:title', content: 'Deferred OG title' }),
        h('meta', { key: 'od', property: 'og:description', content: 'Deferred OG description' }),
        h('meta', { key: 'oty', property: 'og:type', content: 'website' }),
        h('meta', { key: 'ou', property: 'og:url', content: 'http://localhost:3030/' }),
        h('meta', { key: 'tc', name: 'twitter:card', content: 'summary_large_image' }),
        h('meta', { key: 'ti', name: 'twitter:image', content: 'https://example.test/og.jpg' }),
        h('meta', { key: 'tai', name: 'twitter:app:url:iphone', content: 'app://ios' }),
        h('meta', { key: 'tap', name: 'twitter:app:url:ipad', content: 'app://ipad' }),
        h('meta', { key: 'tag', name: 'twitter:app:url:googleplay', content: 'app://android' }),
        h('link', { key: 'c', rel: 'canonical', href: 'http://localhost:3030/canonical' }),
        h('link', { key: 'aa', rel: 'alternate', href: 'android-app://com.example/http/localhost:3030/' }),
        h('link', { key: 'ao', rel: 'alternate', href: 'http://localhost:3030/oembed', type: 'application/json+oembed' }),
    );

const Shell = ({ mode }) =>
    h(
        'main',
        null,
        h('h1', null, `React 19 metadata hoist repro — mode: ${mode}`),
        h(
            'p',
            null,
            'Expected: <title>, <meta name="description">, <link rel="canonical"> in <head> only, with no duplicates.',
        ),
        h(
            'ul',
            null,
            h(
                'li',
                null,
                h('a', { href: '/?mode=ok' }, 'mode=ok'),
                ' — no Suspense / no use() — baseline that hoists correctly',
            ),
            h(
                'li',
                null,
                h('a', { href: '/?mode=ssr-fail' }, 'mode=ssr-fail'),
                ' — Suspense boundary suspends past shell flush — SSR streams tags into <body>',
            ),
            h(
                'li',
                null,
                h('a', { href: '/?mode=client-fail' }, 'mode=client-fail'),
                ' — server uses onAllReady (SSR hoists), client use() suspends during hydration — duplicate <title> in <head>',
            ),
        ),
        // The `ok` baseline skips Suspense entirely so the bug doesn't even
        // get a chance to fire. ssr-fail / client-fail go through the
        // Suspense + use() path that triggers the hoisting failure.
        mode === 'ok'
            ? h(ImmediateHead)
            : h(
                  Suspense,
                  { fallback: h('p', null, 'Loading deferred…') },
                  h(DeferredHead, { mode }),
              ),
    );

// Full document — hydrateRoot(document, App) needs <html>/<head>/<body>.
const App = ({ mode = 'client-fail' }) =>
    h(
        'html',
        { lang: 'en' },
        h(
            'head',
            null,
            h('meta', { key: 'charset', charSet: 'utf-8' }),
            // A static <title> rendered directly into <head>. Used as a
            // baseline to compare against the deferred title.
            h('title', { key: 'static-title' }, 'Static title'),
            // Inject mode for the client bootstrap to read post-hydration.
            h('script', {
                key: 'mode',
                dangerouslySetInnerHTML: {
                    __html: `window.__REPRO_MODE__=${JSON.stringify(mode)};`,
                },
            }),
            h('script', {
                key: 'client',
                type: 'module',
                src: '/client.js',
                defer: true,
            }),
        ),
        h('body', null, h(Shell, { mode })),
    );

export default App;
