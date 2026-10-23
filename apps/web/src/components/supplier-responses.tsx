import Link from 'next/link'
import { getFormatter, getTranslations } from 'next-intl/server'
import type { SupplierResponseHistory } from '@/lib/supplier-responses'
export async function SupplierResponses({
  history,
  base,
}: {
  history: SupplierResponseHistory
  base: string
}) {
  const t = await getTranslations('SupplierPortal.responses')
  const format = await getFormatter()
  return (
    <section id="responses" className="workspace-panel space-y-3" aria-label={t('history')}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-section-title">{t('history')}</h2>
        <span className="text-xs">{t('count', { count: history.total })}</span>
      </div>
      {history.latest ? (
        <p className="break-words [overflow-wrap:anywhere]">
          {t('latest', { status: t(history.latest.status), author: history.latest.author })}
        </p>
      ) : (
        <p>{t('empty')}</p>
      )}
      <ol className="space-y-2">
        {history.rows.map((event) => (
          <li key={event.id} className="min-w-0 space-y-1 rounded-lg border p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-evidence-value">{t(event.status)}</span>
              <time className="text-xs" dateTime={event.created_at}>
                {format.dateTime(new Date(event.created_at), 'long')}
              </time>
            </div>
            <p className="break-all">{event.author}</p>
            {event.reference && (
              <p className="break-words [overflow-wrap:anywhere]">
                {t('savedReference', { reference: event.reference })}
              </p>
            )}
            {event.reason && (
              <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                {event.reason}
              </p>
            )}
            <details className="text-xs">
              <summary className="min-h-11 cursor-pointer py-3 md:min-h-0 md:py-1">
                {t('eventReference')}
              </summary>
              <p className="break-all">{event.id}</p>
            </details>
          </li>
        ))}
      </ol>
      {history.total > 25 && (
        <nav className="flex flex-wrap items-center gap-4" aria-label={t('pagination')}>
          {history.page > 1 && (
            <Link
              prefetch={false}
              className="inline-flex min-h-11 items-center underline"
              href={`${base}?response_page=${history.page - 1}#responses`}
            >
              {t('previous')}
            </Link>
          )}
          <span>{t('page', { page: history.page })}</span>
          {history.page * 25 < history.total && (
            <Link
              prefetch={false}
              className="inline-flex min-h-11 items-center underline"
              href={`${base}?response_page=${history.page + 1}#responses`}
            >
              {t('next')}
            </Link>
          )}
        </nav>
      )}
      <details className="text-xs text-muted-foreground">
        <summary className="min-h-11 cursor-pointer py-3">{t('historyHelp')}</summary>
        <p>{t('independent')}</p>
      </details>
    </section>
  )
}
