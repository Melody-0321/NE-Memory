window.__NE_EXTENSION_MODE = true;

import { initNE } from './index.js';

export async function init() {
    console.log('[NE] Extension mode initializing...');
    await initNE();
}
