// Reads the local Supabase stack's URL and keys and writes them to apps/web/.env.local
// (gitignored). With --github-env it appends the same variables to $GITHUB_ENV instead,
// so later CI steps (build, Playwright) see them.
// Usage: pnpm db:env [--github-env]
import { execSync } from 'node:child_process'
import { appendFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const NAMES = {
  'api.url': 'NEXT_PUBLIC_SUPABASE_URL',
  'auth.publishable_key': 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'auth.secret_key': 'SUPABASE_SECRET_KEY',
  'mailpit.url': 'MAILPIT_URL',
}

const overrides = Object.entries(NAMES)
  .map(([id, name]) => `--override-name ${id}=${name}`)
  .join(' ')
const raw = execSync(`pnpm exec supabase status -o env ${overrides}`, {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'inherit'],
})

const wanted = new Set(Object.values(NAMES))
const values = {}
for (const line of raw.split(/\r?\n/)) {
  const match = /^([A-Za-z0-9_]+)=(.*)$/.exec(line.trim())
  if (!match || !wanted.has(match[1])) continue
  let value = match[2]
  if (value.startsWith('"') && value.endsWith('"')) value = JSON.parse(value)
  values[match[1]] = value
}
for (const name of wanted) {
  if (!values[name]) {
    console.error(`missing ${name} in \`supabase status\` output; is the local stack running?`)
    process.exit(1)
  }
}
values.NEXT_PUBLIC_SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'

const lines = Object.entries(values).map(([k, v]) => `${k}=${v}`)
if (process.argv.includes('--github-env')) {
  if (!process.env.GITHUB_ENV) {
    console.error('--github-env requires GITHUB_ENV to be set')
    process.exit(1)
  }
  console.log(`::add-mask::${values.SUPABASE_SECRET_KEY}`)
  appendFileSync(process.env.GITHUB_ENV, lines.join('\n') + '\n')
  console.log(`exported ${lines.length} variables to GITHUB_ENV`)
} else {
  const out = resolve(import.meta.dirname, '../apps/web/.env.local')
  writeFileSync(out, lines.join('\n') + '\n')
  console.log(`wrote ${out}`)
}
