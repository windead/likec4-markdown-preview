import * as esbuild from 'esbuild'
const out = 'probes/ext/dist'
await esbuild.build({
  entryPoints: ['probes/ext/src/extension.ts'], bundle: true, platform: 'node', format: 'cjs', target: 'node20',
  outfile: `${out}/extension.js`, external: ['vscode'], sourcemap: false, minify: true, logLevel: 'warning',
  mainFields: ['module', 'main'], conditions: ['node', 'import'],
  define: { 'import.meta.url': '__importMetaUrl' }, banner: { js: 'const __importMetaUrl=require("url").pathToFileURL(__filename).href;' },
})
await esbuild.build({
  entryPoints: ['probes/ext/src/preview.tsx'], bundle: true, platform: 'browser', format: 'iife', target: 'chrome120',
  outfile: `${out}/preview.js`, minify: true, jsx: 'automatic', logLevel: 'warning',
  define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env.DEV': 'false', 'import.meta.env.MODE': '"production"' }, loader: { '.css': 'text' },
})
