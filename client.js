import { createElement } from 'react';
import { hydrateRoot } from 'react-dom/client';

import App from './App.js';

hydrateRoot(document, createElement(App), {
    onRecoverableError(err, info) {
        console.error('[hydration] recoverable error', err, info);
    },
});
