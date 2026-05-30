import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import { babel } from '@rollup/plugin-babel';
import terser from '@rollup/plugin-terser';

const TAMPERMONKEY_HEADER = `// ==UserScript==
// @name         NE Memory Engine
// @namespace    https://github.com/yourname/ne-memory
// @version      0.2.0
// @description  Narrative Engine - Structured memory management for SillyTavern long conversations.
// @author       NE Team
// @match        */*
// @grant        none
// ==/UserScript==
`;

export default {
    input: 'src/index.js',
    output: {
        file: 'dist/index.js',
        format: 'iife',
        name: 'NEMemoryEngine',
        banner: TAMPERMONKEY_HEADER,
        globals: {
            '$': '$',
            'jQuery': '$'
        }
    },
    external: ['jQuery', '$', 'TavernHelper', 'SillyTavern', 'ToolManager'],
    plugins: [
        resolve({ browser: true }),
        commonjs(),
        babel({
            babelHelpers: 'bundled',
            presets: ['@babel/preset-env'],
            exclude: 'node_modules/**'
        }),
        terser({
            compress: { drop_console: false },
            format: { comments: /@name|@version|@description|@match|@grant/ }
        })
    ]
};
