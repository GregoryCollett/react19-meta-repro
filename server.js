// Minimal SSR server. Streams App with renderToPipeableStream, serves the
// pre-bundled client at /client.js.
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createElement } from 'react';
import { renderToPipeableStream } from 'react-dom/server';

import App from './App.js';

const here = dirname(fileURLToPath(import.meta.url));
const CLIENT_PATH = join(here, 'public', 'client.js');

if (!existsSync(CLIENT_PATH)) {
    console.error(
        `Missing bundled client at ${CLIENT_PATH}. Run \`npm run build:client\` first.`,
    );
    process.exit(1);
}
const clientBundle = readFileSync(CLIENT_PATH);

const server = createServer((req, res) => {
    if (req.url === '/client.js') {
        res.writeHead(200, { 'content-type': 'text/javascript' });
        res.end(clientBundle);
        return;
    }

    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.write('<!DOCTYPE html>');

    const { pipe } = renderToPipeableStream(createElement(App), {
        onShellReady() {
            pipe(res);
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
