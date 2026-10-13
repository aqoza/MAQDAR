import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  expect,
  type APIRequestContext,
  type Browser,
  type Locator,
  type Page,
} from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { signInWithPassword } from './auth'
import { escapeRegExp } from './master-data'
import { inviteMember, type RoleLabel } from './invitations'
import { waitForEmailLink } from './mailpit'
import { DASHBOARD_URL, expectActiveOrganization } from './organizations'

/*
 * Helpers for the import wizard (src/components/imports). Labels come from en.json:
 * ImportsClient (wizard, actions, statuses), Imports (pages) and ImportErrors (error codes).
 * Database checks read with the service role on the LOCAL stack only, like helpers/auth.ts.
 */

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])
const FIXTURES = path.join(__dirname, '..', 'fixtures', 'imports')

export type UploadFile = { name: string; mimeType: string; buffer: Buffer }

const MIME_TYPES: Record<string, string> = {
  csv: 'text/csv',
  txt: 'text/plain',
  tsv: 'text/tab-separated-values',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}

function mimeTypeOf(name: string): string {
  return MIME_TYPES[path.extname(name).slice(1).toLowerCase()] ?? 'application/octet-stream'
}

/** A committed fixture from e2e/fixtures/imports, uploaded under `uploadName` (default: its own). */
export function fixtureFile(fixture: string, uploadName = fixture): UploadFile {
  return {
    name: uploadName,
    mimeType: mimeTypeOf(uploadName),
    buffer: readFileSync(path.join(FIXTURES, fixture)),
  }
}

/** The raw bytes of a fixture. */
export function fixtureBytes(fixture: string): Buffer {
  return readFileSync(path.join(FIXTURES, fixture))
}

/** A file made in the test (UTF-8 text). */
export function textFile(name: string, text: string): UploadFile {
  return { name, mimeType: mimeTypeOf(name), buffer: Buffer.from(text, 'utf8') }
}

/* ------------------------------------------------------------------------------------------ */
/* Members                                                                                     */
/* ------------------------------------------------------------------------------------------ */

/**
 * Invites an existing account from Settings (as the signed-in owner on `page`) and lets it accept
 * through the sign-in link in Mailpit, in a context of its own; it ends on the dashboard.
 */
export async function inviteAndAccept(
  page: Page,
  browser: Browser,
  request: APIRequestContext,
  email: string,
  role: RoleLabel,
  organizationName: string,
): Promise<void> {
  await inviteMember(page, email, role)
  const link = await waitForEmailLink(request, email, /\/auth\/(?:confirm|callback)\?/)
  const context = await browser.newContext()
  const memberPage = await context.newPage()
  await memberPage.goto(link)
  await memberPage.waitForURL(/\/invitations\/[0-9a-f-]{36}(?:[?#].*)?$/)
  await memberPage.getByRole('button', { name: 'Accept and continue', exact: true }).click()
  await memberPage.waitForURL(DASHBOARD_URL)
  await expectActiveOrganization(memberPage, organizationName)
  await context.close()
}

/** Signs in on a page of a new context (for a second user next to the main page). */
export async function signedInPage(browser: Browser, email: string, password: string) {
  const context = await browser.newContext({ acceptDownloads: true })
  const page = await context.newPage()
  await signInWithPassword(page, email, password)
  return { context, page }
}

/* ------------------------------------------------------------------------------------------ */
/* Wizard                                                                                      */
/* ------------------------------------------------------------------------------------------ */

export function fileInput(page: Page): Locator {
  return page.locator('input[type="file"]')
}

export function continueButton(page: Page): Locator {
  return page.getByRole('button', { name: 'Continue', exact: true })
}

/** Opens the wizard and waits until the file input is hydrated (it is disabled before). */
export async function openNewImport(page: Page, url = '/imports/new'): Promise<void> {
  await page.goto(url)
  await expect(page.getByRole('heading', { level: 1, name: 'New import' })).toBeVisible()
  await expect(fileInput(page)).toBeEnabled()
}

/**
 * Adds files (made in memory, or paths on disk for large ones) on the Files step and waits until
 * every file has been read.
 */
export async function addFiles(page: Page, files: UploadFile[] | string[]): Promise<void> {
  await expect(fileInput(page)).toBeEnabled()
  await fileInput(page).setInputFiles(files)
  for (const file of files) {
    await expect(
      fileRow(page, typeof file === 'string' ? path.basename(file) : file.name),
    ).toBeVisible()
  }
  await expect(page.getByText('Reading…')).toHaveCount(0, { timeout: 60_000 })
}

/** The Files step's row of a file, by its name. */
export function fileRow(page: Page, name: string): Locator {
  return page.locator('tbody tr').filter({ has: page.getByText(name, { exact: true }) })
}

/** The step buttons of the wizard ("1 Files", "2 Format", …). */
export function stepButton(
  page: Page,
  name: 'Files' | 'Format' | 'Map columns' | 'Check' | 'Commit',
) {
  return page.getByRole('navigation', { name: 'Import steps' }).getByRole('button', { name })
}

/** Moves from the Files step to the Check step with Continue (Format, Map columns, Check). */
export async function continueToCheck(page: Page): Promise<void> {
  for (const step of ['Format', 'Map columns', 'Check'] as const) {
    await continueButton(page).click()
    await expect(stepButton(page, step)).toHaveAttribute('aria-current', 'step')
    // The Continue button that had focus is gone: focus lands on the new step's heading.
    await expect(page.locator('[data-slot="card-title"][tabindex="-1"]')).toBeFocused()
  }
}

/** Picks the file shown on the Format or Map columns step (only offered with two or more files). */
export async function pickWizardFile(page: Page, name: string): Promise<void> {
  const select = page.getByLabel('File', { exact: true })
  // Options read `<name> — <data>`, with a warning sign first while the mapping has errors.
  const option = select.locator('option', {
    hasText: new RegExp(`^(?:⚠ )?${escapeRegExp(name)}(?: — |$)`),
  })
  await select.selectOption(await option.getAttribute('value').then((value) => value ?? ''))
}

/** The mapping select of a contract column on the Map columns step. */
export function mappingSelect(page: Page, column: string): Locator {
  return page.locator(`select[id$="-${column}"]`)
}

/** The mapping row of a contract column (its notes say how it was matched). */
export function mappingRow(page: Page, column: string): Locator {
  return page.locator('tbody tr').filter({ has: mappingSelect(page, column) })
}

/** Expects the column to be mapped to the file header `header`. */
export async function expectMapped(page: Page, column: string, header: string): Promise<void> {
  await expect(mappingSelect(page, column).locator('option:checked')).toHaveText(header)
}

export const PASSED = /Every file passed: ([\d,]+) new and ([\d,]+) existing rows\./
export const MUST_FIX = /([\d,]+) errors? must be fixed before you can commit\./

/**
 * Starts the check and waits for its outcome (every file read, staged and sealed): the alert
 * "Every file passed …" or "… must be fixed …". Returns the batch id from the create response.
 */
export async function runCheck(page: Page, timeout = 120_000): Promise<string> {
  const created = page.waitForResponse(
    (response) =>
      response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/imports',
    { timeout },
  )
  await page.getByRole('button', { name: 'Check files', exact: true }).click()
  const response = await created
  expect(response.status(), await response.text()).toBe(200)
  const { batch_id: batchId } = (await response.json()) as { batch_id: string }
  await expect(page.getByText(PASSED).or(page.getByText(MUST_FIX))).toBeVisible({ timeout })
  return batchId
}

/** From a passed check: Continue, Commit import, and wait for "Import committed.". */
export async function commitFromCheck(page: Page, timeout = 120_000): Promise<void> {
  await continueButton(page).click()
  await expect(stepButton(page, 'Commit')).toHaveAttribute('aria-current', 'step')
  await page.getByRole('button', { name: 'Commit import', exact: true }).click()
  await expect(page.getByText('Import committed.', { exact: true })).toBeVisible({ timeout })
}

export type Counts = {
  inserted?: number
  updated?: number
  unchanged?: number
  deleted?: number
  skipped?: number
}

/**
 * The commit counts of an entity (columns Added, Updated, Unchanged, Deleted, Skipped of the
 * counts table on the commit step or an import's page), compared as formatted numbers.
 */
export async function expectCounts(page: Page, entityLabel: string, counts: Counts) {
  const table = page
    .locator('table')
    .filter({ has: page.getByRole('columnheader', { name: 'Added', exact: true }) })
  const row = table
    .locator('tbody tr')
    .filter({ has: page.getByRole('cell', { name: entityLabel, exact: true }) })
  const expected = [
    entityLabel,
    ...(['inserted', 'updated', 'unchanged', 'deleted', 'skipped'] as const).map((key) =>
      (counts[key] ?? 0).toLocaleString('en-US'),
    ),
  ]
  // The five counts come first; "Parents changed" and "Preferred cleared" follow when a commit
  // reports them.
  await expect(row.locator('td:nth-child(-n+6)')).toHaveText(expected)
}

/** Clicks a link that answers with an attachment and returns the downloaded bytes and name. */
export async function download(page: Page, link: Locator) {
  const [file] = await Promise.all([page.waitForEvent('download'), link.click()])
  const filePath = await file.path()
  return { name: file.suggestedFilename(), bytes: readFileSync(filePath) }
}

/** RFC 4180 CSV (quoted fields, doubled quotes, CRLF or LF) without a leading BOM. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"'
        index += 1
      } else if (char === '"') {
        quoted = false
      } else {
        field += char
      }
    } else if (char === '"') {
      quoted = true
    } else if (char === ',') {
      row.push(field)
      field = ''
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index += 1
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else {
      field += char
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

/* ------------------------------------------------------------------------------------------ */
/* Database and Storage (service role, local stack)                                            */
/* ------------------------------------------------------------------------------------------ */

function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set. Run \`pnpm db:env\` or export it.`)
  return value
}

let service: ReturnType<typeof createClient> | null = null

/** Service-role client for the LOCAL stack only (reads import state, cleans up). */
export function serviceClient() {
  if (service) return service
  const url = requireEnv('NEXT_PUBLIC_SUPABASE_URL')
  const host = new URL(url).hostname
  if (!LOOPBACK_HOSTS.has(host)) {
    throw new Error(
      `Refusing to use the service role on ${host}: e2e helpers target the local stack.`,
    )
  }
  service = createClient(url, requireEnv('SUPABASE_SECRET_KEY'), {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  })
  return service
}

export type BatchRow = {
  id: string
  organization_id: string
  status: string
  commit_mode: string | null
  rows_total: number
  rows_staged: number
  error_count: number
  warning_count: number
  counts: Record<string, Record<string, number>>
  progress: {
    phase?: string
    steps?: number
    timings?: { unit: string; ms: number }[]
  } & Record<string, unknown>
  created_at: string
  validated_at: string | null
  finished_at: string | null
  last_step_at: string | null
  updated_at: string
}

export async function batchById(batchId: string): Promise<BatchRow | null> {
  const { data, error } = await serviceClient()
    .from('import_batches')
    .select('*')
    .eq('id', batchId)
    .maybeSingle()
  if (error) throw new Error(`Could not read import ${batchId}: ${error.message}`)
  return data as BatchRow | null
}

export type FileRow = {
  file_no: number
  entity: string
  original_name: string
  status: string
  storage_path: string
  source_stored: boolean
  rows_total: number
  merged_through_row: number
  error_count: number
  warning_count: number
}

export async function filesOf(batchId: string): Promise<FileRow[]> {
  const { data, error } = await serviceClient()
    .from('import_files')
    .select(
      'file_no, entity, original_name, status, storage_path, source_stored, rows_total, merged_through_row, error_count, warning_count',
    )
    .eq('batch_id', batchId)
    .order('file_no')
  if (error) throw new Error(`Could not read the files of ${batchId}: ${error.message}`)
  return (data ?? []) as FileRow[]
}

/** Rows of an organization's table (service role), ordered by `orderBy`. */
export async function rowsOf<T>(
  table: string,
  organizationId: string,
  columns: string,
  orderBy = 'id',
): Promise<T[]> {
  const { data, error } = await serviceClient()
    .from(table)
    .select(columns)
    .eq('organization_id', organizationId)
    .order(orderBy)
  if (error) throw new Error(`Could not read ${table}: ${error.message}`)
  return (data ?? []) as T[]
}

/** The number of an organization's rows in `table`. */
export async function countOf(table: string, organizationId: string): Promise<number> {
  const { count, error } = await serviceClient()
    .from(table)
    .select('organization_id', { count: 'exact', head: true })
    .eq('organization_id', organizationId)
  if (error) throw new Error(`Could not count ${table}: ${error.message}`)
  return count ?? 0
}

/** Object names stored under `<organization>/<batch>/` in the imports bucket. */
export async function storedOriginals(organizationId: string, batchId: string): Promise<string[]> {
  const { data, error } = await serviceClient()
    .storage.from('imports')
    .list(`${organizationId}/${batchId}`, { limit: 100 })
  if (error) throw new Error(`Could not list originals: ${error.message}`)
  return (data ?? []).map((object) => object.name)
}

/** Removes every stored original of an organization (local hygiene after a spec). */
export async function removeOriginals(organizationId: string): Promise<void> {
  const bucket = serviceClient().storage.from('imports')
  const { data: folders, error } = await bucket.list(organizationId, { limit: 1_000 })
  if (error) throw new Error(`Could not list originals: ${error.message}`)
  for (const folder of folders ?? []) {
    const prefix = `${organizationId}/${folder.name}`
    const { data: objects } = await bucket.list(prefix, { limit: 100 })
    const paths = (objects ?? []).map((object) => `${prefix}/${object.name}`)
    if (paths.length > 0) await bucket.remove(paths)
  }
}

/**
 * Deletes an organization's demand history (service role, local stack): month by month from its
 * first to its last day, and a range that runs into the statement timeout (a month of the large
 * preset holds about 400,000 rows) is split in halves down to single days.
 */
export async function deleteDemand(organizationId: string): Promise<void> {
  const edge = async (ascending: boolean) => {
    const { data, error } = await serviceClient()
      .from('demand_history')
      .select('demand_date')
      .eq('organization_id', organizationId)
      .order('demand_date', { ascending })
      .limit(1)
    if (error) throw new Error(`Could not read demand dates: ${error.message}`)
    return (data?.[0] as { demand_date: string } | undefined)?.demand_date ?? null
  }
  const first = await edge(true)
  const last = await edge(false)
  if (!first || !last) return

  const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 86_400_000
  const iso = (days: number) => new Date(days * 86_400_000).toISOString().slice(0, 10)
  const remove = async (from: number, to: number): Promise<void> => {
    const { error } = await serviceClient()
      .from('demand_history')
      .delete()
      .eq('organization_id', organizationId)
      .gte('demand_date', iso(from))
      .lt('demand_date', iso(to))
    if (!error) return
    if (error.code !== '57014' || to - from <= 1) {
      throw new Error(`Could not delete demand from ${iso(from)}: ${error.message}`)
    }
    const middle = Math.floor((from + to) / 2)
    await remove(from, middle)
    await remove(middle, to)
  }
  for (let from = day(first); from <= day(last); from += 31) {
    await remove(from, Math.min(from + 31, day(last) + 1))
  }
}

/**
 * Deletes every row of an organization's table in slices of `slice` rows by `key` order, so
 * no single statement runs into the statement timeout (service role, local stack).
 */
export async function deleteRowsInSlices(
  table: string,
  organizationId: string,
  key = 'id',
  slice = 10_000,
): Promise<void> {
  for (;;) {
    const { data, error } = await serviceClient()
      .from(table)
      .select(key)
      .eq('organization_id', organizationId)
      .order(key)
      .range(slice, slice)
    if (error) throw new Error(`Could not read ${table}: ${error.message}`)
    const boundary = (data?.[0] as Record<string, string> | undefined)?.[key]
    const query = serviceClient().from(table).delete().eq('organization_id', organizationId)
    const { error: deleteError } = await (boundary === undefined ? query : query.lt(key, boundary))
    if (deleteError) throw new Error(`Could not delete ${table} rows: ${deleteError.message}`)
    if (boundary === undefined) return
  }
}

/** Polls `read` until `done` holds for its value; returns that value. */
export async function waitFor<T>(
  read: () => Promise<T>,
  done: (value: T) => boolean,
  { timeoutMs = 60_000, intervalMs = 500, what = 'condition' } = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await read()
    if (done(value)) return value
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`)
    await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
}

/* ------------------------------------------------------------------------------------------ */
/* Demand data                                                                                 */
/* ------------------------------------------------------------------------------------------ */

export const DEMAND_LOCATIONS = ['RUH-DC', 'JED-01', 'DMM-01', 'MED-01'] as const
export const DEMAND_ITEMS = Array.from(
  { length: 25 },
  (_, index) => `D-${String(index + 1).padStart(4, '0')}`,
)
/** First day of the generated demand; 1,000 days end on 2025-09-26. */
export const DEMAND_START = '2023-01-01'

/** locations.csv: a central warehouse and three branches (parents in the same file). */
export function demandLocationsFile(): UploadFile {
  return textFile(
    'locations.csv',
    [
      'location_code,name_en,name_ar,location_type,country_code,city,timezone,parent_location_code',
      'RUH-DC,Riyadh central warehouse,مستودع الرياض المركزي,central,SA,Riyadh,Asia/Riyadh,',
      'JED-01,Jeddah branch,فرع جدة,branch,SA,Jeddah,Asia/Riyadh,RUH-DC',
      'DMM-01,Dammam branch,فرع الدمام,branch,SA,Dammam,Asia/Riyadh,RUH-DC',
      'MED-01,Madinah branch,فرع المدينة,branch,SA,Madinah,Asia/Riyadh,RUH-DC',
      '',
    ].join('\n'),
  )
}

/** items.csv: the 25 parts demand is generated for. */
export function demandItemsFile(): UploadFile {
  const lines = ['item_code,name_en,product_group,unit_of_measure,unit_cost,currency']
  DEMAND_ITEMS.forEach((code, index) => {
    lines.push(`${code},Demand part ${index + 1},filters,EA,${(index + 1) * 2}.5,SAR`)
  })
  return textFile('items.csv', `${lines.join('\n')}\n`)
}

export function isoDay(start: string, offset: number): string {
  return new Date(Date.parse(`${start}T00:00:00Z`) + offset * 86_400_000).toISOString().slice(0, 10)
}

/** The quantity the generator writes for an item, location and day (always at least 1). */
export function demandQuantity(item: number, location: number, day: number): number {
  return ((item * 7 + location * 5 + day * 3) % 9) + 1
}

/**
 * demand_history.csv with every item at every location on `days` consecutive days from `start`:
 * 25 x 4 x days rows (1,000 days = 100,000 rows), day-major so each chunk spans few dates.
 */
export function demandFile(name: string, start: string, days: number, firstDay = 0): UploadFile {
  const parts: string[] = ['item_code,location_code,demand_date,quantity,lost_sales_quantity\n']
  for (let day = firstDay; day < firstDay + days; day += 1) {
    const date = isoDay(start, day)
    let block = ''
    DEMAND_ITEMS.forEach((item, i) => {
      DEMAND_LOCATIONS.forEach((location, l) => {
        block += `${item},${location},${date},${demandQuantity(i, l, day)},${day % 5 === 0 ? 1 : 0}\n`
      })
    })
    parts.push(block)
  }
  return { name, mimeType: 'text/csv', buffer: Buffer.from(parts.join(''), 'utf8') }
}

const ARABIC_INDIC = '٠١٢٣٤٥٦٧٨٩'

/** Writes ASCII digits as Arabic-Indic digits (as Arabic Excel exports may). */
export function arabicIndic(text: string): string {
  return text.replace(/[0-9]/g, (digit) => ARABIC_INDIC[Number(digit)] ?? digit)
}
