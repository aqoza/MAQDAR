import { randomUUID } from 'node:crypto'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getMessages, getTranslations } from 'next-intl/server'
import { NextIntlClientProvider } from 'next-intl'
import { ExcessStockHeader } from '@/components/excess-stock-header'
import { ExcessStockReport } from '@/components/excess-stock-report'
import { ExcessStockSave } from '@/components/excess-stock-save'
import { getActiveContext } from '@/lib/organizations/context'
import { createClient } from '@/lib/supabase/server'
import { excessChoices, excessHref, excessReportSchema, excessTokens } from '@/lib/excess-stock'
import type { RawSearchParams } from '@/lib/master-data/list-params'

export async function generateMetadata() {
  return { title: (await getTranslations('ExcessStock'))('preview') }
}
export default async function Preview({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>
}) {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  const [raw, db, t, messages] = await Promise.all([
    searchParams,
    createClient(),
    getTranslations('ExcessStock'),
    getMessages(),
  ])
  const tokens = excessTokens(raw)
  const parsed = excessChoices(tokens)
  const result = parsed.success
    ? await db.rpc('excess_stock_preview', {
        p_organization_id: context.active.id,
        p_selections: parsed.data,
      })
    : null
  if (result?.error && !['MQ404', 'MQ422'].includes(result.error.code))
    throw new Error('Assessment preview unavailable')
  const report = result?.data ? excessReportSchema.parse(result.data) : null
  return (
    <div className="min-w-0 space-y-4">
      <ExcessStockHeader detail />
      <Link
        className="inline-flex underline"
        href={parsed.success ? excessHref(tokens) : '/replenishment/excess/new'}
      >
        {t('edit')}
      </Link>
      {report ? <ExcessStockReport report={report} /> : <p role="alert">{t('invalid')}</p>}
      {report?.status === 'available' &&
        ['owner', 'admin', 'planner'].includes(context.active.role) && (
          <NextIntlClientProvider messages={{ ExcessStock: messages.ExcessStock }}>
            <ExcessStockSave
              organizationId={context.active.id}
              selections={report.selections}
              fingerprint={report.fingerprint}
              requestId={randomUUID()}
            />
          </NextIntlClientProvider>
        )}
    </div>
  )
}
