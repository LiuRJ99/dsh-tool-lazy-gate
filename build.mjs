/**
 * Single-entry build for dsh-tool-lazy-gate.
 *
 * One host entry (`src/index.ts` → `lib/index.js`) bundling relative imports;
 * every `@deepseek-ai/*` package stays external — the harness profile provides
 * them at runtime. Type declarations are emitted by `tsc` into `lib/types`,
 * matching the exports map.
 */
import { build } from 'esbuild'
import { mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

mkdirSync('lib', { recursive: true })

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'lib/index.js',
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: ['node22'],
  external: ['@deepseek-ai/*'],
  logLevel: 'info',
})

execFileSync(
  process.execPath,
  [fileURLToPath(import.meta.resolve('typescript/bin/tsc')), '-p', 'tsconfig.build.json'],
  { stdio: 'inherit' },
)
