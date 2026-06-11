// Minimal SSR server. Streams App with renderToPipeableStream, serves the
// pre-bundled client at /client.js. Reads ?mode= from the request URL.
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createElement } from 'react';
import { renderToPipeableStream } from 'react-dom/server';

import App, { resetDeferredPromise } from './App.js';

const here = dirname(fileURLToPath(import.meta.url));
const CLIENT_PATH = join(here, 'public', 'client.js');

if (!existsSync(CLIENT_PATH)) {
    console.error(
        `Missing bundled client at ${CLIENT_PATH}. Run \`npm run build:client\` first.`,
    );
    process.exit(1);
}
const clientBundle = readFileSync(CLIENT_PATH);

const ALLOWED_MODES = new Set(['ok', 'ssr-fail', 'client-fail']);
const parseMode = (url) => {
    const m = /[?&]mode=([^&]+)/.exec(url);
    if (!m) return 'client-fail';
    return ALLOWED_MODES.has(m[1]) ? m[1] : 'client-fail';
};

const server = createServer((req, res) => {
    if (req.url === '/client.js') {
        res.writeHead(200, { 'content-type': 'text/javascript' });
        res.end(clientBundle);
        return;
    }

    const mode = parseMode(req.url);
    // Fresh suspending promise per request — module state would otherwise
    // leak between requests and the boundary would stop suspending.
    resetDeferredPromise();

    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.write('<!DOCTYPE html>');

    // `ok` and `client-fail` model the case where the server has the data
    // ready before SSR completes (e.g. loader pre-fetched it) — onAllReady
    // waits for the Suspense boundary before flushing, so SSR can hoist.
    // `ssr-fail` uses onShellReady to model true streaming SSR where the
    // shell flushes first and the boundary resolves while streaming — this
    // is the path that breaks SSR-side hoisting.
    let stream;
    const useStreaming = mode === 'ssr-fail';
    stream = renderToPipeableStream(createElement(App, { mode }), {
        [useStreaming ? 'onShellReady' : 'onAllReady']() {
            stream.pipe(res);
        },
        onError(err) {
            console.error('SSR error:', err);
        },
    });
});

const PORT = 3030;
server.listen(PORT, () => {
    console.log(`Listening on http://localhost:${PORT}`);
});
