/**
 * Builds what DSH and the browser load without resolving packages:
 * - web/vendor.js: the noble and scure primitives (scripts/vendor-entry.js) as one ES module, served to the
 *   page and the service worker and imported by the Host code too;
 * - web/sw.js: the service worker (web/sw-main.js and what it imports) as one classic script;
 * - dist/index.js and dist/tools.js: the Host entries with schemastery bundled in.
 * Both are committed; CI fails when they are stale. Run `npm run build` after changing a source file.
 */
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

await build({
  entryPoints: [resolve(root, 'scripts/vendor-entry.js')],
  outfile: resolve(root, 'web/vendor.js'),
  bundle: true,
  platform: 'neutral',
  format: 'esm',
  target: 'es2022',
  minify: true,
  legalComments: 'eof',
  logLevel: 'warning',
})

// A classic script: module service workers aren't in every browser this has to reach.
await build({
  entryPoints: [resolve(root, 'web/sw-main.js')],
  outfile: resolve(root, 'web/sw.js'),
  bundle: true,
  platform: 'browser',
  format: 'iife',
  target: 'es2022',
  legalComments: 'eof',
  logLevel: 'warning',
})

await build({
  entryPoints: [resolve(root, 'index.js'), resolve(root, 'tools.js')],
  outdir: resolve(root, 'dist'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  // web/ is served to browsers as it is, so the Host imports the same files at run time instead of a copy.
  plugins: [{ name: 'web-external', setup(b) { b.onResolve({ filter: /\/web\/[a-z-]+\.js$/ }, args => ({ path: `../web/${args.path.split('/web/')[1]}`, external: true })) } }],
  legalComments: 'none',
  logLevel: 'warning',
})
