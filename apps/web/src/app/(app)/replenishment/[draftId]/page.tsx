import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getFormatter, getLocale, getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { ReplenishmentReport } from '@/components/replenishment-report'
import { getActiveContext } from '@/lib/organizations/context'
import { createClient } from '@/lib/supabase/server'
import { replenishmentReportSchema } from '@/lib/replenishment'
import { SupplierScenarioHistory } from '@/components/supplier-scenario-history'
import type { RawSearchParams } from '@/lib/master-data/list-params'

export default async function SavedDraft({
  params,
  searchParams,
}: {
  params: Promise<{ draftId: string }>
  searchParams: Promise<RawSearchParams>
}) {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  const { draftId } = await params
  if (!z.uuid().safeParse(draftId).success) notFound()
  const [db, t, locale, format] = await Promise.all([
    createClient(),
    getTranslations('Replenishment'),
    getLocale(),
    getFormatter(),
  ])
  const { data, error } = await db
    .from('replenishment_drafts')
    .select('report,created_at,submitted_by')
    .eq('organization_id', context.active.id)
    .eq('id', draftId)
    .maybeSingle()
  if (error) throw new Error('Draft unavailable')
  if (!data) notFound()
  const report = replenishmentReportSchema.parse(data.report)
  const next = new URLSearchParams({ policy: report.policy.policy_id, basis: report.policy.basis })
  if (report.policy.override_id) next.set('override', report.policy.override_id)
  return (
    <div className="space-y-5">
      <Link className="underline" href="/replenishment">
        {t('back')}
      </Link>
      <h1 className="text-2xl font-semibold">{t('saved')}</h1>
      <p>
        {t('savedBy', {
          actor: data.submitted_by === context.userId ? t('you') : data.submitted_by,
          time: format.dateTime(new Date(data.created_at), 'long'),
        })}
      </p>
      <p>{t('immutable')}</p>
      <ReplenishmentReport report={report} locale={locale} />
      {report.status === 'available' && (
        <Link
          className="inline-block underline"
          href={`/replenishment/suppliers/new?draft=${draftId}`}
        >
          {t('supplierScenario')}
        </Link>
      )}
      <SupplierScenarioHistory
        organizationId={context.active.id}
        draftId={draftId}
        locale={locale}
        raw={await searchParams}
      />
      <Link className="inline-block underline" href={`/replenishment/new?${next}`}>
        {t('newFromPolicy')}
      </Link>
    </div>
  )
}
