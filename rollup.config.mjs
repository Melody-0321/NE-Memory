import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import { babel } from '@rollup/plugin-babel';
import terser from '@rollup/plugin-terser';

export default {
    input: 'src/index.js',
    output: {
        file: 'dist/index.js',
        format: 'iife',
        name: 'NEMemoryEngine',
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
            compress: { drop_console: false }
        })
    ]
};
