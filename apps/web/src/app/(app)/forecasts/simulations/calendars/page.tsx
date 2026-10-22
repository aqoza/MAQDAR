import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { NextIntlClientProvider } from 'next-intl'
import { getMessages, getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { PageHeader } from '@/components/page-header'
import { HelpDisclosure } from '@/components/help-disclosure'
import { PolicyCalendarsForm } from '@/components/policy-calendars-form'
import { PolicyCalendarsEvidence } from '@/components/policy-calendars-evidence'
import { getActiveContext } from '@/lib/organizations/context'
import { isEditorRole } from '@/lib/auth/roles'
import { createClient } from '@/lib/supabase/server'
import { constraintsEvidenceSchema } from '@/lib/policy-constraints'
import { calendarPreviewSchema } from '@/lib/policy-calendars'
import { firstParam, type RawSearchParams } from '@/lib/master-data/list-params'

export default async function CalendarSimulation({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>
}) {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  const params = await searchParams
  const source = firstParam(params.source)
  const calendar = firstParam(params.calendar)
  if (
    !source ||
    !z.guid().safeParse(source).success ||
    (calendar && !z.guid().safeParse(calendar).success)
  )
    notFound()
  const [db, t, messages] = await Promise.all([
    createClient(),
    getTranslations('PolicyCalendars'),
    getMessages(),
  ])
  const { data, error } = await db
    .from('policy_simulations')
    .select('evidence,planning_runs!inner(status,locations!inner(is_active))')
    .eq('organization_id', context.active.id)
    .eq('run_id', source)
    .maybeSingle()
  if (error) throw new Error('Source comparison unavailable')
  if (!data) notFound()
  const parsed = constraintsEvidenceSchema.safeParse(data.evidence)
  const eligible =
    parsed.success &&
    data.planning_runs.status === 'succeeded' &&
    data.planning_runs.locations.is_active
  const editor = isEditorRole(context.role)
  const { data: calendars, error: calendarError } = await db
    .from('work_calendars')
    .select('id,code,name_en')
    .eq('organization_id', context.active.id)
    .eq('is_active', true)
    .order('code')
    .limit(1000)
  if (calendarError) throw new Error('Calendars unavailable')
  const preview =
    eligible && calendar
      ? await db.rpc('simulation_calendars_preview', {
          p_organization_id: context.active.id,
          p_source_run_id: source,
          p_calendar_id: calendar,
        })
      : null
  if (preview?.error?.code === 'MQ404') notFound()
  const evidence = preview?.data ? calendarPreviewSchema.parse(preview.data) : null
  return (
    <div className="min-w-0 space-y-4">
      <PageHeader
        pattern="forecasts"
        title={t('create')}
        description={parsed.success ? parsed.data.policy.item_code : undefined}
        back={
          <Link className="underline" href={`/forecasts/simulations/${source}`}>
            {t('source')}
          </Link>
        }
        help={
          <HelpDisclosure>
            <p className="text-xs">{t('meaning')}</p>
            <p className="text-xs">{t('scheduling')}</p>
            <p className="text-xs">{t('captureMeaning')}</p>
          </HelpDisclosure>
        }
      />
      {!eligible ? (
        <p role="status">{t('ineligible')}</p>
      ) : (
        <>
          <form
            aria-label={t('preview')}
            className="workspace-panel flex flex-wrap items-end gap-3"
          >
            <input type="hidden" name="source" value={source} />
            <label className="grid min-w-0 flex-1 basis-64 gap-1">
              {t('ordering')}
              <select
                required
                name="calendar"
                defaultValue={calendar ?? ''}
                className="min-h-11 w-full min-w-0 rounded-md border bg-background p-2"
              >
                <option value="">{t('choose')}</option>
                {calendars?.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.code} · {row.name_en}
                  </option>
                ))}
              </select>
            </label>
            <button className="min-h-11 rounded-md border px-4 py-2">{t('preview')}</button>
          </form>
          {preview?.error && <p role="alert">{t('previewError')}</p>}
          {evidence && (
            <>
              <div className="workspace-panel space-y-2">
                <h2 className="text-section-title">{t('ready')}</h2>
                <p>
                  {evidence.policy.item_code} · {evidence.policy.unit} · {evidence.from_date} –{' '}
                  {evidence.to_date}
                </p>
                <p>
                  {t('summary', {
                    count: evidence.options.configurations.length,
                    ordering: evidence.calendars.ordering.calendar_code ?? '—',
                    receiving: evidence.calendars.receiving.calendar_code ?? t('countryDefault'),
                  })}
                </p>
              </div>
              {editor ? (
                <NextIntlClientProvider messages={{ PolicyCalendars: messages.PolicyCalendars }}>
                  <PolicyCalendarsForm
                    organizationId={context.active.id}
                    source={source}
                    calendar={calendar!}
                    fingerprint={evidence.fingerprint}
                    requestId={crypto.randomUUID()}
                  />
                </NextIntlClientProvider>
              ) : (
                <p role="status">{t('readOnly')}</p>
              )}
              <PolicyCalendarsEvidence evidence={evidence} />
            </>
          )}
        </>
      )}
    </div>
  )
}
