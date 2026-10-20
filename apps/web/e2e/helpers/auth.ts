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

/** The id of the organization with this slug, read with the service role. */
export async function organizationIdBySlug(slug: string): Promise<string> {
  const { data, error } = await adminClient()
    .from('organizations')
    .select('id')
    .eq('slug', slug)
    .single()
  if (error || !data) throw new Error(`No organization ${slug}: ${error?.message ?? 'not found'}`)
  return data.id as string
}

/**
 * Inserts fixture rows with the service role on the LOCAL stack (RLS does not apply), in batches
 * of `batchSize`, for volumes the UI cannot create in a test (the 50,000 items of the scale spec).
 * Rows must carry their own organization_id.
 */
export async function seedRows(
  table: string,
  rows: readonly Record<string, unknown>[],
  batchSize = 1_000,
): Promise<void> {
  const client = adminClient()
  for (let start = 0; start < rows.length; start += batchSize) {
    const batch = rows.slice(start, start + batchSize)
    const { error } = await client.from(table).insert(batch)
    if (error) {
      throw new Error(
        `Could not seed ${table} rows ${start + 1}-${start + batch.length}: ${error.message}`,
      )
    }
  }
}

/** Deletes every row of `table` that belongs to the organization (service role, local stack). */
export async function deleteOrganizationRows(table: string, organizationId: string): Promise<void> {
  const client = adminClient()
  if (table === 'demand_history') {
    const { error } = await client.from(table).delete().eq('organization_id', organizationId)
    if (error) throw new Error(`Could not delete ${table} rows: ${error.message}`)
    return
  }
  // FK checks and audit triggers also run during fixture cleanup. Bound each request so a
  // 50,000-item cleanup stays below PostgREST's statement timeout, including with stale statistics.
  for (;;) {
    const { data, error } = await client
      .from(table)
      .select('id')
      .eq('organization_id', organizationId)
      .limit(100)
    if (error) throw new Error(`Could not read ${table} cleanup rows: ${error.message}`)
    if (!data?.length) return
    const result = await client
      .from(table)
      .delete()
      .eq('organization_id', organizationId)
      .in(
        'id',
        data.map((row) => row.id),
      )
    if (result.error) throw new Error(`Could not delete ${table} rows: ${result.error.message}`)
  }
}

/** Explicitly identified local workspace fixture; production URLs are refused by adminClient. */
export async function seedWorkspaceMembership(userId: string): Promise<void> {
  const admin = adminClient()
  const organizationId = '00000000-0000-4000-8000-000000000095'
  const organization = await admin.from('organizations').upsert(
    {
      id: organizationId,
      slug: 'ote-host-fixture',
      name: 'OTE workspace fixture',
      home_country: 'OM',
      base_currency: 'OMR',
    },
    { onConflict: 'id' },
  )
  if (organization.error) throw organization.error
  const membership = await admin.from('memberships').insert({
    organization_id: organizationId,
    user_id: userId,
    role: 'owner',
  })
  if (membership.error) throw membership.error
}

/** Generates an OTP on the guarded local Auth service without sending an email. */
export async function localEmailToken(email: string, type: 'invite' | 'magiclink') {
  const { data, error } = await adminClient().auth.admin.generateLink({ type, email })
  if (error) throw error
  return data.properties.hashed_token
}
