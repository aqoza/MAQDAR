#!/usr/bin/env node
// Creates a confirmed user on the LOCAL Supabase stack now that sign-up is invitation-only.
//
//   pnpm db:user you@company.com [password]
//
// Reads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY from apps/web/.env.local (written by
// `pnpm db:env`) or the environment, refuses any non-loopback URL, and calls the GoTrue admin API
// directly so the root workspace needs no extra dependency. The hosted project is never touched:
// invite real users from Settings > Members instead.

import { readFileSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const here = path.dirname(fileURLToPath(import.meta.url))
const envFile = path.join(here, '..', 'apps', 'web', '.env.local')

function loadEnvFile() {
  try {
    for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)
      if (!match) continue
      const [, key, raw] = match
      if (!(key in process.env)) process.env[key] = raw.replace(/^["']|["']$/g, '')
    }
  } catch {
    // No .env.local yet: fall back to the environment only.
  }
}

function fail(message) {
  console.error(message)
  process.exit(1)
}

loadEnvFile()

const [email, passwordArg] = process.argv.slice(2)
if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  fail('usage: pnpm db:user <email> [password]')
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const secret = process.env.SUPABASE_SECRET_KEY
if (!url || !secret)
  fail(
    'NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY are missing; run `pnpm db:start && pnpm db:env` first',
  )

const host = new URL(url).hostname
if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(host)) {
  fail(`refusing to create users on ${host}: this script only targets the local stack`)
}

const password = passwordArg ?? randomBytes(12).toString('base64url')
const response = await fetch(`${url.replace(/\/$/, '')}/auth/v1/admin/users`, {
  method: 'POST',
  headers: {
    apikey: secret,
    Authorization: `Bearer ${secret}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ email: email.toLowerCase(), password, email_confirm: true }),
})

const body = await response.json().catch(() => ({}))
if (!response.ok) {
  fail(
    `GoTrue refused (${response.status}): ${body.msg ?? body.message ?? body.error_code ?? JSON.stringify(body)}`,
  )
}

console.log(`created ${body.email} (${body.id})`)
if (!passwordArg) console.log(`password: ${password}`)
console.log('Sign in at http://localhost:3000/login, then create or join an organization.')
