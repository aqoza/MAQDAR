import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { NextIntlClientProvider } from 'next-intl'
import { getMessages, getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { PageHeader } from '@/components/page-header'
import { ContainerCapacityReport } from '@/components/container-capacity-report'
import { ContainerCapacitySave } from '@/components/container-capacity-save'
import { isEditorRole } from '@/lib/auth/roles'
import { getActiveContext } from '@/lib/organizations/context'
import { createClient } from '@/lib/supabase/server'
import { capacityInputSchema, capacityParams, capacityReportSchema } from '@/lib/container-capacity'
import type { RawSearchParams } from '@/lib/master-data/list-params'

export default async function NewCapacity({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>
}) {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  const [db, t, messages, raw] = await Promise.all([
    createClient(),
    getTranslations('ContainerCapacity'),
    getMessages(),
    searchParams,
  ])
  const values = capacityParams(raw)
  const batch = z.guid().safeParse(values.batch)
  if (!batch.success) notFound()
  const source = await db
    .from('purchase_handoff_batches')
    .select('id')
    .eq('organization_id', context.active.id)
    .eq('id', batch.data)
    .maybeSingle()
  if (source.error) throw new Error('Capacity source unavailable')
  if (!source.data) notFound()
  const parsed = capacityInputSchema.safeParse(values)
  let report = null
  let invalid = (values.volume !== '' || values.payload !== '') && !parsed.success
  if (parsed.success) {
    const { data, error } = await db.rpc('container_capacity_preview', {
      p_organization_id: context.active.id,
      p_batch_id: batch.data,
      p_volume: parsed.data.volume,
      p_payload: parsed.data.payload,
      p_confirmed: parsed.data.confirmed === 'true',
    })
    if (error?.code === 'MQ404') notFound()
    if (error?.code === 'MQ422') invalid = true
    else if (error) throw new Error('Capacity preview unavailable')
    else report = capacityReportSchema.parse(data)
  }
  return (
    <div className="space-y-4">
      <PageHeader
        title={t('new')}
        description={t('description')}
        actions={
          <Link className="underline" href={`/replenishment/batches/${batch.data}`}>
            {t('source')}
          </Link>
        }
      />
      <form
        action="/replenishment/capacity/new"
        method="get"
        className="space-y-3 workspace-panel"
        key={JSON.stringify(values)}
      >
        <input type="hidden" name="batch" value={batch.data} />
        <div className="grid gap-3 sm:grid-cols-2">
          {(['volume', 'payload'] as const).map((key) => (
            <label key={key} className="grid min-w-0 gap-1">
              {t(key)}
              <input
                name={key}
                required
                inputMode="decimal"
                maxLength={40}
                defaultValue={values[key]}
                className="w-full rounded-md border bg-background px-3 py-2"
              />
            </label>
          ))}
        </div>
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            name="confirmed"
            value="true"
            defaultChecked={values.confirmed === 'true'}
            className="mt-1"
          />
          {t('confirmation')}
        </label>
        <button className="rounded-md bg-primary px-4 py-2 text-primary-foreground">
          {t('preview')}
        </button>
      </form>
      {invalid && <p role="alert">{t('invalid')}</p>}
      {report && <ContainerCapacityReport report={report} />}
      {report?.status === 'available' && isEditorRole(context.role) && (
        <NextIntlClientProvider messages={{ ContainerCapacity: messages.ContainerCapacity }}>
          <ContainerCapacitySave
            key={report.fingerprint}
            organizationId={context.active.id}
            input={{
              batch: batch.data,
              volume: report.volume_limit_m3,
              payload: report.payload_limit_kg,
              confirmed: 'true',
              fingerprint: report.fingerprint,
              request_id: crypto.randomUUID(),
            }}
          />
        </NextIntlClientProvider>
      )}
    </div>
  )
}
