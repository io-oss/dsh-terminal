/**
 * Build the browser bundle for the dsh client module system.
 *
 * Output contract (see @deepseek-ai/dsh-client-modules):
 *   window.__ModuleLoader__.load({ id: "dsh-terminal", factory: (require) => { … } })
 *
 * The factory receives a synchronous `require` that resolves platform seed
 * words (react, react-dom, host primitives) and other registered plugin
 * bundles. Everything else is inlined by esbuild. The bundle-purity gate
 * forbids value imports across plugins, so all @deepseek-ai/* client
 * packages must stay external — they are provided by the host module table
 * at runtime.
 *
 * xterm.css is loaded with the esbuild `text` loader and emitted as a string
 * export; the client injects it as an owned <style> tag at activation time
 * (the host convention for plugin CSS), so no separate stylesheet asset is
 * needed next to the combo bundle.
 */

import { build } from 'esbuild'
import { mkdirSync } from 'node:fs'

const EXTERNALS = [
  'react',
  'react-dom',
  'react/jsx-runtime',
  'react/jsx-dev-runtime',
  '@deepseek-ai/dsh-client-ui-primitives',
]

mkdirSync(new URL('../client', import.meta.url), { recursive: true })

await build({
  entryPoints: ['src/client/index.ts'],
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: 'es2020',
  external: EXTERNALS,
  loader: { '.css': 'text' },
  banner: {
    js: [
      'window.__ModuleLoader__.load({',
      '  id: "dsh-terminal",',
      '  factory: (require) => {',
      '    var module = { exports: {} };',
      '    var exports = module.exports;',
    ].join('\n'),
  },
  footer: {
    // The loader materializes a module from the factory's RETURN VALUE
    // (see dsh-client-modules), so the bundle must hand back module.exports.
    js: '\n    return module.exports;\n  },\n});',
  },
  outfile: 'client/client.js',
  sourcemap: true,
  logLevel: 'info',
})

console.log('[dsh-terminal] client bundle written to client/client.js')
