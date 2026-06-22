const fs = require('fs');
const path = require('path');

const src = path.resolve(__dirname, '..', 'dist', 'index.js');
const dest = path.resolve(__dirname, '..', '..', '..', 'public', 'scripts', 'extensions', 'third-party', 'ne-memory.js');

if (!fs.existsSync(src)) {
    console.error('[copy-to-st] Source not found:', src);
    process.exit(1);
}

fs.copyFileSync(src, dest);
console.log('[copy-to-st] Copied dist/index.js → ' + dest);
