// Plain JS (no JSX) so the server can `import` this without a transpile step.
// Shape mirrors Mixcloud's setup: a <Suspense> boundary in <body> wrapping a
// component that calls `use(promise)` and renders <title>/<meta>/<link>.
// React 19 is supposed to hoist those to <head>. The test is whether the
// hoist survives client hydration.
import { createElement as h, Suspense, use } from 'react';

let deferredPromise = null;
const getDeferredPromise = () => {
    if (deferredPromise) return deferredPromise;
    deferredPromise = new Promise((resolve) => {
        // Slight delay on the server so the shell flushes before the
        // boundary resolves — exercises streaming.
        // 100ms — long enough that the shell flushes first and the boundary
        // streams in afterwards. This is the case that breaks.
        setTimeout(() => resolve({ ready: true }), 100);
    });
    return deferredPromise;
};

const DeferredHead = () => {
    // Suspends until the promise resolves.
    use(getDeferredPromise());
    return h(
        'div',
        { id: 'deferred-meta-host', style: { display: 'none' } },
        // These three should be hoisted by React 19 to <head>.
        h('title', { key: 't' }, 'Deferred title — should be in <head>'),
        h('meta', {
            key: 'm',
            name: 'description',
            content: 'Deferred description — should be in <head>',
        }),
        h('link', {
            key: 'l',
            rel: 'canonical',
            href: 'http://localhost:3030/canonical',
        }),
    );
};

const Shell = () =>
    h(
        'main',
        null,
        h('h1', null, 'React 19 metadata hoist repro'),
        h(
            'p',
            null,
            'Open devtools. Expected: <title>, <meta name="description">, <link rel="canonical"> all inside <head>. Bug: they appear inside <body>.',
        ),
        h(
            Suspense,
            { fallback: h('p', null, 'Loading deferred…') },
            h(DeferredHead),
        ),
    );

// Full document — hydrateRoot(document, App) needs <html>/<head>/<body>.
const App = () =>
    h(
        'html',
        { lang: 'en' },
        h(
            'head',
            null,
            // A static, non-deferred title that should remain in <head>.
            h('title', { key: 'static' }, 'Static title'),
            h('meta', { key: 'charset', charSet: 'utf-8' }),
            h('script', {
                key: 'client',
                type: 'module',
                src: '/client.js',
                defer: true,
            }),
        ),
        h('body', null, h(Shell)),
    );

export default App;
