import { HelpDisclosure } from '@/components/help-disclosure'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { NextIntlClientProvider } from 'next-intl'
import { getLocale, getMessages, getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { getActiveContext } from '@/lib/organizations/context'
import { createClient } from '@/lib/supabase/server'
import { isEditorRole } from '@/lib/auth/roles'
import { PreparedForecastForm } from '@/components/prepared-forecast-form'
import {
  preparationSummarySchema,
  preparationOutputSchema,
  preparationCalendarSchema,
} from '@/lib/preparation'

export default async function PreparedResults({
  params,
  searchParams,
}: {
  params: Promise<{ runId: string }>
  searchParams: Promise<{ group?: string }>
}) {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  const { runId } = await params
  const { group } = await searchParams
  if (!z.uuid().safeParse(runId).success || (group && !z.uuid().safeParse(group).success))
    notFound()
  const [db, t, locale] = await Promise.all([
    createClient(),
    getTranslations('Preparation'),
    getLocale(),
  ])
  const { data: run, error: runError } = await db
    .from('planning_runs')
    .select('kind,status,from_date,to_date,locations(code)')
    .eq('organization_id', context.active.id)
    .eq('id', runId)
    .maybeSingle()
  if (runError) throw new Error('Preparation run unavailable')
  if (!run || run.kind !== 'preparation') notFound()
  if (run.status !== 'succeeded') redirect('/forecasts')
  const { data: rows, error } = await db
    .from('demand_preparations')
    .select('id,group_id,status,summary')
    .eq('organization_id', context.active.id)
    .eq('run_id', runId)
    .order('group_id')
    .limit(25)
  if (error) throw new Error('Preparation results unavailable')
  const formatter = new Intl.NumberFormat(locale, { maximumFractionDigits: 3 })
  const number = (value: string | number | null) =>
    value === null ? '—' : formatter.format(value as number)
  const flag = (value: boolean | null) => t(value === null ? 'unknown' : value ? 'yes' : 'no')
  let detail: z.infer<typeof preparationOutputSchema> | null = null
  let calendar: z.infer<typeof preparationCalendarSchema> | null = null
  const selected = rows?.find((row) => row.group_id === group)
  const messages = await getMessages()
  if (group) {
    // Project only computed output and the small calendar header, not raw source demand.
    const { data, error } = await db
      .from('demand_preparations')
      .select('output:evidence->output,calendar:evidence->source->calendar')
      .eq('organization_id', context.active.id)
      .eq('run_id', runId)
      .eq('group_id', group)
      .maybeSingle()
    if (error) throw new Error('Preparation evidence unavailable')
    if (!data) notFound()
    detail = preparationOutputSchema.parse(data.output)
    calendar = preparationCalendarSchema.parse(data.calendar)
  }
  return (
    <div className="space-y-5">
      <Link href="/forecasts" className="text-sm underline">
        {t('back')}
      </Link>
      <h1 className="text-page-title">{t('results')}</h1>
      <p>
        {run.locations?.code} · {run.from_date} – {run.to_date}
      </p>
      <p>{t('rules')}</p>
      <HelpDisclosure>
        <p>{t('calendarNote')}</p>
      </HelpDisclosure>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">{t('groups')}</caption>
          <thead>
            <tr>
              {(['target', 'status', 'sources', 'unit', 'sold', 'lost', 'details'] as const).map(
                (k) => (
                  <th key={k} className="p-2 text-start">
                    {t(k)}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {rows?.map((row) => {
              const summary = preparationSummarySchema.parse(row.summary)
              return (
                <tr key={row.group_id} className="border-t">
                  <td className="p-2">{summary.target_code ?? t('unresolved')}</td>
                  <td className="p-2">
                    {t(row.status === 'ready' ? 'ready' : 'blocked')}
                    {summary.issue && <p>{t(`issues.${summary.issue}`)}</p>}
                  </td>
                  <td className="p-2">{number(summary.source_count)}</td>
                  <td className="p-2">{summary.unit ?? '—'}</td>
                  <td className="p-2">{number(summary.sold)}</td>
                  <td className="p-2">{number(summary.lost)}</td>
                  <td className="p-2">
                    <Link
                      className="underline"
                      href={`/forecasts/prepared/${runId}?group=${row.group_id}`}
                    >
                      {t('inspect', { code: summary.target_code ?? t('unresolved') })}
                    </Link>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {detail && (
        <section className="space-y-4" aria-label={t('details')}>
          {selected?.status === 'ready' && isEditorRole(context.role) && (
            <NextIntlClientProvider messages={{ PreparedForecast: messages.PreparedForecast }}>
              <PreparedForecastForm
                key={selected.id}
                organizationId={context.active.id}
                preparationId={selected.id}
                requestId={crypto.randomUUID()}
              />
            </NextIntlClientProvider>
          )}
          <h2 className="text-section-title">{t('contributions')}</h2>
          <p className="text-sm">{t('contributionNote')}</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">{t('contributions')}</caption>
              <thead>
                <tr>
                  {(
                    ['item', 'factor', 'sold', 'lost', 'convertedSold', 'convertedLost'] as const
                  ).map((k) => (
                    <th key={k} className="p-2 text-start">
                      {t(k)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {detail.contributors.map((source) => (
                  <tr key={source.item_id} className="border-t">
                    <td className="p-2">{source.item_code}</td>
                    <td className="p-2">{source.factor ?? '—'}</td>
                    {[source.sold, source.lost, source.converted_sold, source.converted_lost].map(
                      (value, i) => (
                        <td key={i} className="p-2 tabular-nums">
                          {number(value)}
                        </td>
                      ),
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {calendar && (
            <p>
              {t('calendarHeader', {
                country: calendar.country,
                calendar: calendar.calendar_code ?? t('countryDefault'),
                from: calendar.coverage_from ?? t('unknown'),
                to: calendar.coverage_to ?? t('unknown'),
              })}
            </p>
          )}
          {!!detail.daily.length && (
            <>
              <h2 className="text-section-title">{t('daily')}</h2>
              <p className="text-sm">{t('lifecycleNote')}</p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <caption className="sr-only">{t('daily')}</caption>
                  <thead>
                    <tr>
                      {(
                        [
                          'date',
                          'sold',
                          'lost',
                          'activeSources',
                          'working',
                          'reason',
                          'weekend',
                          'holiday',
                          'ramadan',
                          'eid_al_fitr',
                          'arafat_day',
                          'eid_al_adha',
                        ] as const
                      ).map((k) => (
                        <th key={k} className="p-2 text-start">
                          {t(k)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {detail.daily.map((day) => (
                      <tr key={day.date} className="border-t">
                        <td className="p-2">{day.date}</td>
                        <td className="p-2">{number(day.sold)}</td>
                        <td className="p-2">{number(day.lost)}</td>
                        <td className="p-2">{number(day.active_sources)}</td>
                        <td className="p-2">{flag(day.working)}</td>
                        <td className="p-2">{t(`reasons.${day.calendar_reason}`)}</td>
                        {(
                          [
                            'weekend',
                            'holiday',
                            'ramadan',
                            'eid_al_fitr',
                            'arafat_day',
                            'eid_al_adha',
                          ] as const
                        ).map((k) => (
                          <td key={k} className="p-2">
                            {flag(day[k])}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      )}
    </div>
  )
}
