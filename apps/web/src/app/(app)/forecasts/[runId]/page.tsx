import { PageHeader } from '@/components/page-header'
import { HelpDisclosure } from '@/components/help-disclosure'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getLocale, getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { getActiveContext } from '@/lib/organizations/context'
import { createClient } from '@/lib/supabase/server'
import {
  CLASSIFICATION_FIELDS,
  CLASSIFICATION_PATTERNS,
  classificationEvidenceSchema,
} from '@/lib/classification'

export default async function ClassificationResults({
  params,
  searchParams,
}: {
  params: Promise<{ runId: string }>
  searchParams: Promise<{ page?: string; pattern?: string }>
}) {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  const { runId } = await params
  if (!z.guid().safeParse(runId).success) notFound()
  const search = await searchParams
  const page = Math.min(1000, Math.max(1, Number.parseInt(search.page ?? '1', 10) || 1))
  const pattern = CLASSIFICATION_PATTERNS.find((p) => p === search.pattern)
  const [db, t, locale] = await Promise.all([
    createClient(),
    getTranslations('Classification'),
    getLocale(),
  ])
  const { data: run, error: runError } = await db
    .from('planning_runs')
    .select('id,kind,status,from_date,to_date,options,result,locations(code)')
    .eq('organization_id', context.active.id)
    .eq('id', runId)
    .maybeSingle()
  if (runError) throw new Error('Planning result unavailable')
  if (!run || run.kind !== 'classification') notFound()
  if (run.status !== 'succeeded') redirect('/forecasts')
  let query = db
    .from('demand_classifications')
    .select('item_id,item_code,item_name,currency,pattern,abc,xyz,evidence', { count: 'exact' })
    .eq('organization_id', context.active.id)
    .eq('run_id', runId)
  if (pattern) query = query.eq('pattern', pattern)
  const { data, error, count } = await query
    .order('item_code')
    .order('item_id')
    .range((page - 1) * 50, page * 50 - 1)
  if (error?.code === 'PGRST103') redirect(`/forecasts/${runId}`)
  if (error) throw new Error('Classification rows unavailable')
  const number = new Intl.NumberFormat(locale, { maximumFractionDigits: 3 })
  const format = (v: string | number | null) => (v === null ? '—' : number.format(v as number))
  const options = run.options as Record<string, string>
  const pageHref = (n: number) =>
    `/forecasts/${runId}?${new URLSearchParams({ page: String(n), ...(pattern ? { pattern } : {}) })}`
  return (
    <div className="space-y-4">
      <PageHeader
        pattern="forecasts"
        back={
          <Link href="/forecasts" className="text-sm underline">
            {t('back')}
          </Link>
        }
        title={t('results')}
        description={
          <>
            {run.locations?.code} · {run.from_date} – {run.to_date}
          </>
        }
        help={
          <HelpDisclosure>
            <p>{t('methodNote')}</p>
          </HelpDisclosure>
        }
      />

      <details>
        <summary className="cursor-pointer">{t('thresholds')}</summary>
        <dl className="mt-2 grid gap-2 sm:grid-cols-3">
          {CLASSIFICATION_FIELDS.map((key) => (
            <div key={key}>
              <dt>{t(`fields.${key}`)}</dt>
              <dd>{format(options[key])}</dd>
            </div>
          ))}
        </dl>
      </details>
      <form className="workspace-toolbar flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-sm">
          {t('pattern')}
          <select
            name="pattern"
            defaultValue={pattern ?? ''}
            className="rounded-md border bg-background p-2"
          >
            <option value="">{t('all')}</option>
            {CLASSIFICATION_PATTERNS.map((p) => (
              <option key={p} value={p}>
                {t(`patterns.${p}`)}
              </option>
            ))}
          </select>
        </label>
        <button className="rounded-md border px-3 py-2">{t('filter')}</button>
      </form>
      <p>{t('total', { count: count ?? 0 })}</p>
      <div className="workspace-table overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">{t('results')}</caption>
          <thead>
            <tr>
              {(
                [
                  'item',
                  'pattern',
                  'abc',
                  'xyz',
                  'adi',
                  'cv2',
                  'dailyCv',
                  'value',
                  'evidence',
                ] as const
              ).map((k) => (
                <th key={k} className="p-2 text-start">
                  {t(`columns.${k}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data?.map((row) => {
              const parsed = classificationEvidenceSchema.safeParse(row.evidence)
              if (!parsed.success) throw new Error('Classification evidence unavailable')
              const { source, metrics } = parsed.data
              return (
                <tr key={row.item_id} className="border-t">
                  <td className="p-2">
                    <div className="font-medium">{row.item_code}</div>
                    <div className="text-muted-foreground">{row.item_name}</div>
                  </td>
                  <td className="p-2">
                    {t(`patterns.${row.pattern as (typeof CLASSIFICATION_PATTERNS)[number]}`)}
                  </td>
                  <td className="p-2">{row.abc === 'N' ? t('noValue') : row.abc}</td>
                  <td className="p-2">{row.xyz === 'U' ? t('unknown') : row.xyz}</td>
                  <td className="p-2 tabular-nums">{format(metrics.adi)}</td>
                  <td className="p-2 tabular-nums">{format(metrics.cv2)}</td>
                  <td className="p-2 tabular-nums">{format(metrics.daily_cv)}</td>
                  <td className="whitespace-nowrap p-2 tabular-nums">
                    {format(metrics.value)} {row.currency}
                  </td>
                  <td className="p-2">
                    <details>
                      <summary className="cursor-pointer">{t('details')}</summary>
                      <dl className="min-w-52 space-y-1 py-2">
                        {(
                          [
                            'days',
                            'positive_days',
                            'quantity',
                            'lost_sales_quantity',
                            'unit_cost',
                            'days_since_last_sale',
                          ] as const
                        ).map((k) => (
                          <div key={k}>
                            <dt className="text-muted-foreground">{t(`evidence.${k}`)}</dt>
                            <dd>{format(source[k])}</dd>
                          </div>
                        ))}
                        <div>
                          <dt>{t('evidence.status')}</dt>
                          <dd>{t(`statuses.${source.status}`)}</dd>
                        </div>
                        {(['introduced_on', 'discontinued_on', 'last_sale'] as const).map((k) => (
                          <div key={k}>
                            <dt>{t(`evidence.${k}`)}</dt>
                            <dd>{source[k] ?? t('unknown')}</dd>
                          </div>
                        ))}
                      </dl>
                    </details>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {!data?.length && <p>{t('empty')}</p>}
      <nav aria-label={t('pages')} className="flex gap-4 text-sm underline">
        {page > 1 && <Link href={pageHref(page - 1)}>{t('previous')}</Link>}
        {page * 50 < (count ?? 0) && <Link href={pageHref(page + 1)}>{t('next')}</Link>}
      </nav>
    </div>
  )
}
