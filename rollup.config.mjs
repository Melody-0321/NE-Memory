import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import { babel } from '@rollup/plugin-babel';
import terser from '@rollup/plugin-terser';
import replace from '@rollup/plugin-replace';
import { copyFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const isDev = process.env.NE_BUILD === 'dev';

// 将 .css 文件按字符串内联进 bundle（script 模式只加载单 JS 文件，无法引用独立 css）
function cssString() {
    return {
        name: 'css-string',
        load(id) {
            if (id.endsWith('.css')) {
                return { code: 'export default ' + JSON.stringify(readFileSync(id, 'utf8')), map: null };
            }
            return null;
        }
    };
}

const basePlugins = [
    cssString(),
    replace({
        __NE_DEV_MODE: JSON.stringify(isDev),
        preventAssignment: true,
        objectGuards: true,
    }),
    resolve({ browser: true }),
    commonjs({ include: 'node_modules/**' }),
    babel({ babelHelpers: 'bundled', presets: ['@babel/preset-env'], exclude: 'node_modules/**' }),
    terser({ compress: { drop_console: false, side_effects: false, passes: 2 } })
];

const BUILD_MODE = process.env.BUILD_MODE || 'all';

export default [
    ...(BUILD_MODE === 'script' || BUILD_MODE === 'all' ? [{
        input: 'src/adapter/index.js',
        output: {
            file: 'dist/index.js',
            format: 'iife',
            name: 'NEMemoryEngine',
            globals: { '$': '$', 'jQuery': '$' }
        },
        external: ['jQuery', '$', 'SillyTavern', 'ToolManager'],
        plugins: basePlugins
    }] : []),
    ...(BUILD_MODE === 'extension' || BUILD_MODE === 'all' ? [{
        input: 'src/adapter/extension.js',
        output: {
            file: 'dist/extension/index.js',
            format: 'es',
            banner: 'var __NE_EXTENSION_BUILD__=true;'
        },
        external: ['jQuery', '$', 'SillyTavern', 'ToolManager'],
        plugins: [
            ...basePlugins,
            {
                name: 'sync-extension-artifacts',
                writeBundle() {
                    const distExtDir = join(__dirname, 'dist', 'extension');
                    if (!existsSync(distExtDir)) mkdirSync(distExtDir, { recursive: true });
                    const distManifest = join(distExtDir, 'manifest.json');
                    const rootManifest = join(__dirname, 'manifest.json');
                    copyFileSync(rootManifest, distManifest);
                    console.log('[sync-extension-artifacts] manifest.json → dist/extension/');
                }
            }
        ]
    }] : [])
];
