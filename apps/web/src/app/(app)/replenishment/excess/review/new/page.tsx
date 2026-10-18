import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { NextIntlClientProvider } from 'next-intl'
import { getMessages, getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { PageHeader } from '@/components/page-header'
import { ExcessDispositionHelp } from '@/components/excess-disposition-help'
import { ExcessDispositionEvidence } from '@/components/excess-disposition-evidence'
import { ExcessDispositionForm } from '@/components/excess-disposition-forms'
import { getActiveContext } from '@/lib/organizations/context'
import { createClient } from '@/lib/supabase/server'
import { dispositionSourceSchema, positiveExcess } from '@/lib/excess-disposition'
import { firstParam, type RawSearchParams } from '@/lib/master-data/list-params'

export async function generateMetadata() {
  return { title: (await getTranslations('ExcessDisposition'))('propose') }
}
export default async function NewDisposition({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>
}) {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  const raw = await searchParams
  const selection = z
    .object({ assessment: z.guid(), item: z.guid() })
    .safeParse({ assessment: firstParam(raw.assessment), item: firstParam(raw.item) })
  if (!selection.success) notFound()
  const [db, t, messages] = await Promise.all([
    createClient(),
    getTranslations('ExcessDisposition'),
    getMessages(),
  ])
  const { data, error } = await db.rpc('excess_disposition_preview', {
    p_organization_id: context.active.id,
    p_assessment_id: selection.data.assessment,
    p_item_id: selection.data.item,
  })
  if (error?.code === 'MQ404') notFound()
  if (error) throw new Error('Disposition evidence unavailable')
  const source = dispositionSourceSchema.parse(data)
  const positive = positiveExcess(source.line.comparison.quantity_above)
  const editor = ['owner', 'admin', 'planner'].includes(context.active.role)
  return (
    <div className="min-w-0 space-y-4">
      <PageHeader
        pattern="replenishment"
        title={t('propose')}
        description={t('context')}
        help={<ExcessDispositionHelp />}
        back={
          <Link className="underline" href={`/replenishment/excess/${source.assessment_id}`}>
            {t('assessment')}
          </Link>
        }
      />
      <ExcessDispositionEvidence source={source} />
      {!source.matches && <p role="alert">{t('changed')}</p>}
      {!positive && <p role="alert">{t('quantityInvalid')}</p>}
      <Link
        className="underline"
        href={`/replenishment/excess/review?assessment=${source.assessment_id}&item=${selection.data.item}`}
      >
        {t('lineHistory')}
      </Link>
      {editor && positive && source.matches && (
        <NextIntlClientProvider messages={{ ExcessDisposition: messages.ExcessDisposition }}>
          <ExcessDispositionForm
            organizationId={context.active.id}
            assessmentId={source.assessment_id}
            itemId={selection.data.item}
            requestId={crypto.randomUUID()}
          />
        </NextIntlClientProvider>
      )}
    </div>
  )
}
