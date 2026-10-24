import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getFormatter, getTranslations } from 'next-intl/server'
import { PageHeader } from '@/components/page-header'
import { getActiveContext } from '@/lib/organizations/context'
import { createClient } from '@/lib/supabase/server'
import { explanationPath, explanationStatus } from '@/lib/policy-explainer'
export default async function ExplanationHistory({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>
}) {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  const raw = (await searchParams).page
  const page = typeof raw === 'string' && /^[1-9]\d{0,4}$/.test(raw) ? Number(raw) : 1
  const [db, t, format] = await Promise.all([
    createClient(),
    getTranslations('PolicyExplainer'),
    getFormatter(),
  ])
  const { data, error, count } = await db
    .from('policy_explanations')
    .select('id,question,status,created_at,subject_kind', { count: 'exact' })
    .eq('organization_id', context.active.id)
    .order('created_at', { ascending: false })
    .order('id')
    .range((page - 1) * 25, page * 25 - 1)
  const pages = Math.max(1, Math.ceil((count ?? 0) / 25))
  if (error?.code === 'PGRST103' || page > pages) redirect(explanationPath)
  if (error) throw new Error('Explanation history unavailable')
  return (
    <div className="min-w-0 space-y-4">
      <PageHeader
        pattern="forecasts"
        title={t('history')}
        description={t('description')}
        actions={
          <>
            <Link href="/replenishment" className="underline">
              {t('chooseReplenishment')}
            </Link>
            <Link href="/forecasts/quality" className="underline">
              {t('chooseForecast')}
            </Link>
          </>
        }
        back={
          <Link href="/forecasts/workbench" className="underline">
            {t('choosePolicy')}
          </Link>
        }
      />
      {!data?.length && <p>{t('empty')}</p>}
      {data?.map((row) => (
        <article key={row.id} className="min-w-0 space-y-2 workspace-panel">
          <Link
            href={`${explanationPath}/${row.id}`}
            className="break-words font-medium underline [overflow-wrap:anywhere]"
          >
            <bdi>{row.question}</bdi>
          </Link>
          <p className="text-xs text-muted-foreground">
            {t(
              row.subject_kind === 'supplier'
                ? 'supplierKind'
                : row.subject_kind === 'replenishment'
                  ? 'replenishmentKind'
                  : row.subject_kind === 'forecast'
                    ? 'forecastKind'
                    : 'policyKind',
            )}{' '}
            · {t(`statuses.${explanationStatus(row.status, row.created_at)}`)} ·{' '}
            <time dateTime={row.created_at}>
              {format.dateTime(new Date(row.created_at), 'long')}
            </time>
          </p>
        </article>
      ))}
      <nav aria-label={t('pagination')} className="flex flex-wrap items-center gap-4">
        {page > 1 && (
          <Link href={`?page=${page - 1}`} className="min-h-11 py-3 underline">
            {t('previous')}
          </Link>
        )}
        <span>{t('page', { page, pages })}</span>
        {page < pages && (
          <Link href={`?page=${page + 1}`} className="min-h-11 py-3 underline">
            {t('next')}
          </Link>
        )}
      </nav>
    </div>
  )
}
