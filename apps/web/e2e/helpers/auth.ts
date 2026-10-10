import { expect, type Page } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(
      `${name} is not set. Run \`pnpm db:start && pnpm db:env\` (writes apps/web/.env.local) or export it.`,
    )
  }
  return value
}

/**
 * Service-role client for the LOCAL stack only: sign-up is invitation-only, so test users are
 * seeded through the admin API the same way `pnpm db:user` does.
 */
function adminClient() {
  const url = requireEnv('NEXT_PUBLIC_SUPABASE_URL')
  const host = new URL(url).hostname
  if (!LOOPBACK_HOSTS.has(host)) {
    throw new Error(
      `Refusing to seed users on ${host}: the e2e helpers only target the local stack.`,
    )
  }
  return createClient(url, requireEnv('SUPABASE_SECRET_KEY'), {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  })
}

/** Creates a confirmed user with a password and returns its id. */
export async function createConfirmedUser(email: string, password: string): Promise<string> {
  const { data, error } = await adminClient().auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  })
  if (error) throw new Error(`Could not create ${email}: ${error.message}`)
  return data.user.id
}

/** Signs in through the /login form and waits for the post-login redirect to leave /login. */
export async function signInWithPassword(
  page: Page,
  email: string,
  password: string,
): Promise<void> {
  await page.goto('/login')
  await page.getByLabel('Email', { exact: true }).fill(email)
  await page.getByLabel('Password', { exact: true }).fill(password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/login'))
  await expect(page).not.toHaveURL(/\/login(?:[?#].*)?$/)
}

/** Signs out from the app shell and waits for the login page. */
export async function signOut(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Sign out' }).click()
  await expect(page).toHaveURL(/\/login(?:[?#].*)?$/)
}

/** The auth record of a user, read with the service role (email, pending new_email, confirmation). */
export async function getAuthUser(userId: string) {
  const { data, error } = await adminClient().auth.admin.getUserById(userId)
  if (error) throw new Error(`Could not read user ${userId}: ${error.message}`)
  return data.user
}

/** A browser-equivalent client signed in with a password, without cookies or token refresh. */
export async function signedInClient(email: string, password: string) {
  const url = requireEnv('NEXT_PUBLIC_SUPABASE_URL')
  const client = createClient(url, requireEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'), {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  })
  const { error } = await client.auth.signInWithPassword({ email, password })
  if (error) throw new Error(`Could not sign in ${email}: ${error.message}`)
  return client
}
