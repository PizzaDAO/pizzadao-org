// Node module-resolution hook for the CLI scripts: lets Node 24 (which strips TypeScript types itself) load
// the app's own files, which use the "@/" alias and extensionless relative imports.
import { existsSync, statSync } from 'node:fs'
import { dirname, join, resolve as resolvePath } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), '../..')
const EXTS = ['.ts', '.tsx', '/index.ts', '/index.tsx']

function withExt(path) {
  if (existsSync(path) && statSync(path).isFile()) return path
  for (const e of EXTS) if (existsSync(path + e)) return path + e
  return null
}

export async function resolve(specifier, context, next) {
  let path = null
  if (specifier.startsWith('@/')) path = withExt(join(ROOT, specifier.slice(2)))
  else if ((specifier.startsWith('./') || specifier.startsWith('../')) && context.parentURL?.startsWith('file:')) {
    path = withExt(resolvePath(dirname(fileURLToPath(context.parentURL)), specifier))
  }
  if (path) return next(pathToFileURL(path).href, context)
  return next(specifier, context)
}
