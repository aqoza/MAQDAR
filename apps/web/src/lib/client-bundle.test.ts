import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = join(__dirname, '..')

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : []
  })
}

// '@/lib/env' validates the environment with zod; a Client Component importing it ships the zod
// runtime (about 100 KB) to read a NEXT_PUBLIC_ value that Next inlines anyway. Client
// Components read process.env.NEXT_PUBLIC_* directly.
describe('client bundles', () => {
  it('no Client Component imports the server env schema', () => {
    const offenders = sourceFiles(SRC)
      .filter((path) => /^\s*['"]use client['"]/.test(readFileSync(path, 'utf8')))
      .filter((path) =>
        /from\s+['"](@\/lib\/env|@\/lib\/env\.schema)['"]/.test(readFileSync(path, 'utf8')),
      )
      .map((path) => relative(SRC, path).replaceAll('\\', '/'))
    expect(offenders).toEqual([])
  })
})
