import Link from 'next/link'
import { getFormatter, getTranslations } from 'next-intl/server'
import { createClient } from '@/lib/supabase/server'
import { HelpDisclosure } from '@/components/help-disclosure'

const PAGE_SIZE = 20
const FAMILIES = {
  purchase: { table: 'purchase_handoff_acknowledgements', prefix: '', meaning: 'meaning' },
  transfer: {
    table: 'transfer_handoff_acknowledgements',
    prefix: 'redistribution/',
    meaning: 'transferMeaning',
  },
  event: {
    table: 'event_purchase_handoff_acknowledgements',
    prefix: 'events/',
    meaning: 'eventMeaning',
  },
  disposition: {
    table: 'excess_disposition_handoff_acknowledgements',
    prefix: 'excess/',
    meaning: 'dispositionMeaning',
  },
} as const

export async function HandoffAcknowledgements({
  organizationId,
  recordId,
  batch = false,
  kind = 'purchase',
  pageValue,
}: {
  organizationId: string
  recordId: string
  batch?: boolean
  kind?: keyof typeof FAMILIES
  pageValue?: string | string[]
}) {
  const page =
    typeof pageValue === 'string' && /^[1-9]\d{0,5}$/.test(pageValue) ? Number(pageValue) : 1
  const [db, t, format] = await Promise.all([
    createClient(),
    getTranslations('HandoffAcknowledgements'),
    getFormatter(),
  ])
  const family = FAMILIES[kind]
  const result = await db
    .from(family.table)
    .select(
      'id,client_event_id,api_key_id,recorded_at,external_system,external_reference,status,reason',
      { count: 'exact' },
    )
    .eq('organization_id', organizationId)
    .eq(batch ? 'batch_id' : 'handoff_id', recordId)
    .order('recorded_at', { ascending: false })
    .order('id')
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1)
  if (result.error) throw new Error('Acknowledgement history unavailable')
  const base = `/replenishment/${family.prefix}${batch ? 'batches' : 'handoffs'}/${recordId}`
  return (
    <section id="acknowledgements" className="space-y-3 workspace-panel" aria-label={t('title')}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-section-title">{t('title')}</h2>
        <span className="text-xs text-muted-foreground">
          {t('count', { count: result.count ?? 0 })}
        </span>
      </div>
      <HelpDisclosure>
        <p>{t(family.meaning)}</p>
        <p>{t(batch ? 'batchNote' : 'singleNote')}</p>
      </HelpDisclosure>
      {!result.data?.length && <p className="text-muted-foreground">{t('empty')}</p>}
      <ol className="space-y-2">
        {result.data?.map((event) => (
          <li key={event.id} className="min-w-0 rounded-lg border p-3 space-y-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span
                className={
                  event.status === 'rejected' ? 'font-medium text-destructive' : 'font-medium'
                }
              >
                {t(event.status === 'rejected' ? 'rejected' : 'received')}
              </span>
              <time dateTime={event.recorded_at} className="text-xs text-muted-foreground">
                {format.dateTime(new Date(event.recorded_at), 'long')}
              </time>
            </div>
            <p className="break-all">
              {event.external_system} · {event.external_reference}
            </p>
            {event.reason && <p className="break-words [overflow-wrap:anywhere]">{event.reason}</p>}
            <details className="text-xs text-muted-foreground">
              <summary className="min-h-11 cursor-pointer py-3 md:min-h-0 md:py-1">
                {t('evidence')}
              </summary>
              <dl className="grid gap-1 pt-2 break-all">
                <div>
                  <dt className="inline">{t('eventId')}: </dt>
                  <dd className="inline">{event.id}</dd>
                </div>
                <div>
                  <dt className="inline">{t('clientEventId')}: </dt>
                  <dd className="inline">{event.client_event_id}</dd>
                </div>
                <div>
                  <dt className="inline">{t('keyId')}: </dt>
                  <dd className="inline">{event.api_key_id}</dd>
                </div>
              </dl>
            </details>
          </li>
        ))}
      </ol>
      {(page > 1 || (result.count ?? 0) > PAGE_SIZE) && (
        <nav className="flex flex-wrap items-center gap-4" aria-label={t('pagination')}>
          {page > 1 && (
            <Link
              className="inline-flex min-h-11 items-center underline md:min-h-0"
              prefetch={false}
              href={`${base}?ack_page=${page - 1}#acknowledgements`}
            >
              {t('previous')}
            </Link>
          )}
          <span>{t('page', { page })}</span>
          {page * PAGE_SIZE < (result.count ?? 0) && (
            <Link
              className="inline-flex min-h-11 items-center underline md:min-h-0"
              prefetch={false}
              href={`${base}?ack_page=${page + 1}#acknowledgements`}
            >
              {t('next')}
            </Link>
          )}
        </nav>
      )}
    </section>
  )
}
