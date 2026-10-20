import Papa from 'papaparse'
import { z } from 'zod'
import { emailSchema } from './schemas'

export function parseInvitationEmails(input: string): string[] {
  if (input.length > 262144) throw new Error('invalid_recipients')
  const result = Papa.parse<string[]>(input.replace(/^\uFEFF/, ''), { delimiter: ',', skipEmptyLines: 'greedy' })
  if (result.errors.length || result.data.some((row) => row.length !== 1)) throw new Error('invalid_recipients')
  const rows = result.data[0]?.[0]?.trim().toLowerCase() === 'email' ? result.data.slice(1) : result.data
  if (rows.length < 1 || rows.length > 2000) throw new Error('invalid_recipients')
  const emails = rows.map(([cell]) => emailSchema.parse(cell.trim().toLowerCase()))
  if (new Set(emails).size !== emails.length) throw new Error('duplicate_recipients')
  return emails
}

export function directoryQuery(params: Record<string, string | string[] | undefined>, prefix: string) {
  const rawPage = params[`${prefix}_page`]
  const page = typeof rawPage === 'string' && /^\d{1,5}$/.test(rawPage) ? Number(rawPage) : 1
  const search = params[`${prefix}_search`]
  return { page: page >= 1 && page <= 10000 ? page : 1, search: typeof search === 'string' ? search.trim().slice(0, 254) : '' }
}

const memberSchema = z.object({ user_id: z.string(), email: z.string(), role: z.string(), created_at: z.string(), location_ids: z.array(z.string()) })
const invitationSchema = z.object({ id: z.string(), email: z.string(), role: z.string(), created_at: z.string(), last_sent_at: z.string(), expires_at: z.string(), send_count: z.number() })
const pageFields = { total: z.number().int().nonnegative(), page: z.number().int().positive() }
export const memberPageSchema = z.object({ ...pageFields, rows: z.array(memberSchema).max(100) })
export const invitationPageSchema = z.object({ ...pageFields, rows: z.array(invitationSchema).max(100) })
export const onboardingStatusSchema = z.object({
  enabled: z.boolean(),
  batches: z.array(z.object({ id: z.string(), created_at: z.string(), role: z.string(), total: z.number(), sent: z.number(), pending: z.number(), failed: z.number(), skipped: z.number() })),
})
export type OnboardingStatus = z.infer<typeof onboardingStatusSchema>
