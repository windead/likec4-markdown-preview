// Builds dist/extension.js (Node, CJS) and dist/preview.js (browser, IIFE).
import * as esbuild from 'esbuild'
import { fileURLToPath } from 'node:url'

const watch = process.argv.includes('--watch')
const minify = !process.argv.includes('--dev')
const stub = name => fileURLToPath(new URL(`../src/stubs/${name}.ts`, import.meta.url))

/** @type {esbuild.BuildOptions} */
const extension = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  outfile: 'dist/extension.js',
  external: ['vscode'],
  mainFields: ['module', 'main'],
  conditions: ['node', 'import'],
  alias: { 'bundle-require': stub('bundle-require'), esbuild: stub('esbuild') },
  define: { 'import.meta.url': '__importMetaUrl' },
  banner: { js: 'const __importMetaUrl = require("url").pathToFileURL(__filename).href;' },
  minify,
  sourcemap: !minify,
  metafile: true,
  logLevel: 'warning',
}

/** @type {esbuild.BuildOptions} */
const preview = {
  entryPoints: ['preview/index.tsx'],
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: 'chrome120',
  outfile: 'dist/preview.js',
  jsx: 'automatic',
  define: {
    'process.env.NODE_ENV': '"production"',
    'import.meta.env.DEV': 'false',
    'import.meta.env.MODE': '"production"',
  },
  minify,
  sourcemap: !minify,
  metafile: true,
  logLevel: 'warning',
}

if (watch) {
  for (const o of [extension, preview]) await (await esbuild.context(o)).watch()
  console.log('watching…')
} else {
  const results = await Promise.all([esbuild.build(extension), esbuild.build(preview)])
  const { writeFileSync, mkdirSync } = await import('node:fs')
  mkdirSync('dist', { recursive: true })
  writeFileSync('dist/meta.json', JSON.stringify({ extension: results[0].metafile, preview: results[1].metafile }))
  for (const r of results) for (const [f, o] of Object.entries(r.metafile.outputs)) if (f.endsWith('.js')) console.log(`${f} ${(o.bytes / 1024).toFixed(0)} KB`)
}
