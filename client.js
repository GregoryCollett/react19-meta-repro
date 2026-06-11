import { createElement, StrictMode } from 'react';
import { hydrateRoot } from 'react-dom/client';

import App from './App.js';

const mode = window.__REPRO_MODE__ || 'client-fail';

hydrateRoot(
    document,
    createElement(StrictMode, null, createElement(App, { mode })),
    {
        onRecoverableError(err, info) {
            console.error('[hydration] recoverable error', err, info);
        },
    },
);
