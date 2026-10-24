import { IntegrationWorkbenchHeader } from '@/components/integration-workbench-header'
import Form from 'next/form'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getFormatter, getTranslations, getLocale } from 'next-intl/server'
import { TableScrollRegion } from '@/components/table-scroll-region'
import { getActiveContext } from '@/lib/organizations/context'
import { createClient } from '@/lib/supabase/server'
import { lastPage, type RawSearchParams } from '@/lib/master-data/list-params'
import {
  integrationParams,
  integrationHref,
  integrationEvidenceHref,
  integrationResultSchema,
  transferIntegrationResultSchema,
  integrationPath,
  integrationFamilies,
  eventIntegrationResultSchema,
  dispositionIntegrationResultSchema,
  networkIntegrationResultSchema,
  regionalIntegrationResultSchema,
  returnIntegrationResultSchema,
  type IntegrationFamily,
} from '@/lib/integration-workbench'

export async function IntegrationWorkbenchScreen({
  searchParams,
  family = 'purchase',
}: {
  searchParams: Promise<RawSearchParams>
  family?: IntegrationFamily
}) {
  const returns = family === 'return'
  const regional = family === 'regional'
  const network = family === 'network'
  const transfer = family === 'transfer'
  const disposition = family === 'disposition'
  const configuration = integrationFamilies[family]
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  const params = integrationParams(await searchParams, family)
  const [db, t, format, locale] = await Promise.all([
    createClient(),
    getTranslations('IntegrationWorkbench'),
    getFormatter(),
    getLocale(),
  ])
  const response = await db.rpc(configuration.rpc, {
    p_organization_id: context.active.id,
    p_filters: { ...params.filters, q: params.q },
    p_page: params.page,
    p_size: params.size,
  })
  if (response.error) throw new Error('Integration workbench unavailable')
  const resultSchema = {
    purchase: integrationResultSchema,
    transfer: transferIntegrationResultSchema,
    event: eventIntegrationResultSchema,
    disposition: dispositionIntegrationResultSchema,
    network: networkIntegrationResultSchema,
    regional: regionalIntegrationResultSchema,
    return: returnIntegrationResultSchema,
  }[family]
  const result = resultSchema.parse(response.data)
  if (result.page !== params.page) redirect(integrationHref(params, result.page, family))
  const pages = lastPage(result.total, result.size)
  const inputClass = 'w-full min-w-0 rounded-md border bg-background p-2'
  const otherLinks = (Object.keys(integrationFamilies) as IntegrationFamily[])
    .filter((other) => other !== family)
    .map((other) => (
      <Link
        key={other}
        className="inline-flex min-h-11 items-center underline md:min-h-0"
        href={integrationPath(other)}
      >
        {t(integrationFamilies[other].link)}
      </Link>
    ))
  return (
    <div className="min-w-0 space-y-4">
      <IntegrationWorkbenchHeader family={family} />
      <div className="flex flex-wrap gap-4">
        {regional || returns ? (
          <details>
            <summary className="min-h-11 cursor-pointer py-3 md:min-h-0 md:py-0">
              {t('otherIntegrations')}
            </summary>
            <nav aria-label={t('otherIntegrations')} className="flex flex-wrap gap-4 py-2">
              {otherLinks}
            </nav>
          </details>
        ) : (
          otherLinks
        )}
        {returns && (
          <>
            <Link
              className="inline-flex min-h-11 items-center underline md:min-h-0"
              href="/replenishment/returns/handoffs"
            >
              {t('returnHandoffs')}
            </Link>
            <Link
              className="inline-flex min-h-11 items-center underline md:min-h-0"
              href="/replenishment/returns/batches"
            >
              {t('returnBatches')}
            </Link>
          </>
        )}
        {regional && (
          <>
            <Link
              className="inline-flex min-h-11 items-center underline md:min-h-0"
              href="/replenishment/regional-stock/sourcing/handoffs"
            >
              {t('regionalHandoffs')}
            </Link>
            <Link
              className="inline-flex min-h-11 items-center underline md:min-h-0"
              href="/replenishment/regional-stock/sourcing/batches"
            >
              {t('regionalBatches')}
            </Link>
          </>
        )}
        {network && (
          <>
            <Link
              className="inline-flex min-h-11 items-center underline md:min-h-0"
              href="/replenishment/network/handoffs"
            >
              {t('networkHandoffs')}
            </Link>
            <Link
              className="inline-flex min-h-11 items-center underline md:min-h-0"
              href="/replenishment/network/batches"
            >
              {t('networkBatches')}
            </Link>
          </>
        )}
        {disposition && (
          <>
            <Link
              className="inline-flex min-h-11 items-center underline md:min-h-0"
              href="/replenishment/excess/handoffs"
            >
              {t('dispositionHandoffs')}
            </Link>
            <Link
              className="inline-flex min-h-11 items-center underline md:min-h-0"
              href="/replenishment/excess/batches"
            >
              {t('dispositionBatches')}
            </Link>
          </>
        )}
        {family === 'event' && (
          <>
            <Link
              className="inline-flex min-h-11 items-center underline md:min-h-0"
              href="/replenishment/events/handoffs"
            >
              {t('eventHandoffs')}
            </Link>
            <Link
              className="inline-flex min-h-11 items-center underline md:min-h-0"
              href="/replenishment/events/batches"
            >
              {t('eventBatches')}
            </Link>
          </>
        )}
        {transfer && (
          <>
            <Link className="underline" href="/replenishment/redistribution/handoffs">
              {t('transferHandoffs')}
            </Link>
            <Link className="underline" href="/replenishment/redistribution/batches">
              {t('transferBatches')}
            </Link>
          </>
        )}
      </div>
      <Form
        action={integrationPath(family)}
        className="workspace-toolbar grid min-w-0 grid-cols-2 gap-3 xl:grid-cols-4"
        key={JSON.stringify(params)}
      >
        <label className="col-span-2 grid min-w-0 grid-rows-[1fr_auto] gap-1 sm:col-span-1">
          {t(
            returns
              ? 'returnSearch'
              : regional
                ? 'regionalSearch'
                : network
                  ? 'networkSearch'
                  : disposition
                    ? 'dispositionSearch'
                    : family === 'event'
                      ? 'eventSearch'
                      : 'search',
          )}
          <input name="q" maxLength={100} defaultValue={params.q} className={inputClass} />
        </label>
        {(regional
          ? (['region', 'location', 'source', 'system'] as const)
          : network
            ? (['source', 'branch', 'system'] as const)
            : disposition
              ? (['location', 'system'] as const)
              : ([transfer || returns ? 'source' : 'supplier', 'location', 'system'] as const)
        ).map((field) => (
          <label
            className={`grid min-w-0 grid-rows-[1fr_auto] gap-1 ${field === 'system' || field === 'region' ? 'col-span-2 sm:col-span-1' : ''}`}
            key={field}
          >
            {t(
              returns && field === 'source'
                ? 'returnSource'
                : returns && field === 'location'
                  ? 'returnReceiver'
                  : regional && field === 'source'
                    ? 'includedSource'
                    : network && field === 'source'
                      ? 'warehouse'
                      : field === 'location'
                        ? transfer
                          ? 'destination'
                          : family === 'event' || regional
                            ? 'receiver'
                            : field
                        : field,
            )}
            <input
              name={field}
              maxLength={field === 'system' ? 80 : 64}
              defaultValue={params.filters[field] ?? ''}
              className={inputClass}
            />
          </label>
        ))}
        {(
          [
            ['kind', ['handoff', 'batch']],
            [
              returns ? 'sources' : 'selection',
              returns
                ? (['available', 'unavailable'] as const)
                : disposition || network || regional
                  ? (['current', 'historical', 'unavailable'] as const)
                  : (['current', 'historical'] as const),
            ],
            ...(disposition ? [['intent', ['supplier_return', 'scrap']] as const] : []),
            ['status', ['received', 'rejected', 'no_report']],
          ] as const
        ).map(([field, values]) => (
          <label
            className={`grid min-w-0 grid-rows-[1fr_auto] gap-1 ${field === 'status' ? 'col-span-2 sm:col-span-1' : ''}`}
            key={field}
          >
            {t(
              (disposition || network || regional) && field === 'selection' ? 'liveContext' : field,
            )}
            <select name={field} defaultValue={params.filters[field] ?? ''} className={inputClass}>
              <option value="">{t('all')}</option>
              {values.map((value) => (
                <option key={value} value={value}>
                  {t(value)}
                </option>
              ))}
            </select>
          </label>
        ))}
        <div className="col-span-2 flex flex-wrap items-end gap-2 sm:col-span-1">
          <label className="grid gap-1">
            {t('size')}
            <select name="size" defaultValue={params.size} className={inputClass}>
              {[25, 50, 100].map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
          <button className="rounded-md bg-primary px-3 py-2 text-primary-foreground">
            {t('filter')}
          </button>
          <Link href={integrationPath(family)} className="py-2 underline">
            {t('reset')}
          </Link>
        </div>
      </Form>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p>{t('count', { count: result.total })}</p>
        <p className="text-xs text-muted-foreground">
          {t('asOf', { time: format.dateTime(new Date(result.as_of), 'long') })}
        </p>
      </div>
      <TableScrollRegion label={t(configuration.title)}>
        <table className="w-full text-sm">
          <caption className="sr-only">{t('tableCaption')}</caption>
          <thead>
            <tr>
              {(
                [
                  'package',
                  returns
                    ? 'returnLocations'
                    : regional
                      ? 'regionLocations'
                      : network
                        ? 'warehouseBranches'
                        : disposition
                          ? 'intentLocation'
                          : transfer
                            ? 'sourceDestination'
                            : 'supplierLocation',
                  returns
                    ? 'sources'
                    : disposition || network || regional
                      ? 'liveContext'
                      : 'selection',
                  'reportedBy',
                  'latestReport',
                  'inspect',
                ] as const
              ).map((key) => (
                <th className="p-3 text-start" key={key}>
                  {t(key)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row) => (
              <tr
                key={`${row.kind}:${row.id}:${row.external_system ?? ''}`}
                className="border-t align-top"
              >
                <th scope="row" className="min-w-36 p-3 text-start font-normal">
                  <p className="font-medium">
                    {row.kind === 'handoff'
                      ? row.item_code
                      : t('batchLines', { count: row.line_count })}
                  </p>
                  {'event_name' in row && typeof row.event_name === 'string' && row.event_name && (
                    <p className="max-w-56 break-words text-xs text-muted-foreground">
                      {row.event_name}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">{t(row.kind)}</p>
                  {returns && 'requested_date' in row && (
                    <p className="text-xs text-muted-foreground">
                      {t('returnRequestedDate')}: {row.requested_date}
                    </p>
                  )}
                  <details className="text-xs text-muted-foreground">
                    <summary className="min-h-11 cursor-pointer py-3 md:min-h-0 md:py-1">
                      {t('packageDetails')}
                    </summary>
                    <p className="max-w-56 break-all">{row.id}</p>
                    <time dateTime={row.created_at}>
                      {format.dateTime(new Date(row.created_at), 'long')}
                    </time>
                  </details>
                </th>
                <td className={regional ? 'min-w-48 p-3' : 'p-3'}>
                  <p className="max-w-48 break-words">
                    {'region_id' in row ? (
                      <Link
                        className="inline-flex min-h-11 items-center underline md:min-h-0"
                        href={integrationHref(
                          { ...params, filters: { ...params.filters, region: row.region_id } },
                          1,
                          family,
                        )}
                      >
                        {locale.startsWith('ar') && row.region_name_ar
                          ? row.region_name_ar
                          : row.region_name}
                      </Link>
                    ) : 'disposition_kind' in row ? (
                      t(row.disposition_kind)
                    ) : 'source_code' in row ? (
                      row.source_code
                    ) : (
                      row.supplier_code
                    )}
                  </p>
                  {'region_id' in row && (
                    <>
                      <p className="max-w-48 break-words text-muted-foreground">
                        {row.location_code}
                      </p>
                      <details className="max-w-56 text-xs text-muted-foreground">
                        <summary className="min-h-11 cursor-pointer py-3 md:min-h-0 md:py-1">
                          {t('regionDetails')}
                        </summary>
                        <p className="break-all">{row.region_id}</p>
                        <p>
                          {t('requestedDate')}: {row.requested_date}
                        </p>
                      </details>
                    </>
                  )}
                  {'branch_codes' in row || 'source_codes' in row ? (
                    <details className="max-w-56 text-muted-foreground">
                      <summary className="min-h-11 cursor-pointer py-3 md:min-h-0 md:py-1">
                        {t('source_codes' in row ? 'includedSources' : 'includedBranches', {
                          count: ('source_codes' in row ? row.source_codes : row.branch_codes)
                            .length,
                        })}
                      </summary>
                      <ul className="space-y-1 text-xs">
                        {('source_codes' in row ? row.source_codes : row.branch_codes).map(
                          (code) => (
                            <li className="break-words [overflow-wrap:anywhere]" key={code}>
                              {code}
                            </li>
                          ),
                        )}
                      </ul>
                    </details>
                  ) : (
                    <p className="max-w-48 break-words text-muted-foreground">
                      {row.location_code}
                    </p>
                  )}
                </td>
                <td className="p-3">
                  {t(
                    'sources_available' in row
                      ? row.sources_available
                        ? 'available'
                        : 'unavailable'
                      : 'selection' in row
                        ? row.selection
                        : row.selected
                          ? 'current'
                          : 'historical',
                  )}
                </td>
                <td className="min-w-40 p-3">
                  <p className="max-w-56 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                    {row.external_system ?? t('noSystem')}
                  </p>
                  {row.external_reference && (
                    <p className="max-w-56 break-all text-xs text-muted-foreground">
                      {row.external_reference}
                    </p>
                  )}
                </td>
                <td className="min-w-56 p-3">
                  <p
                    className={
                      row.status === 'rejected' ? 'font-medium text-destructive' : 'font-medium'
                    }
                  >
                    {t(row.status)}
                  </p>
                  {row.recorded_at && (
                    <time dateTime={row.recorded_at} className="text-xs text-muted-foreground">
                      {format.dateTime(new Date(row.recorded_at), 'long')}
                    </time>
                  )}
                  {row.reason && (
                    <p className="max-w-80 break-words [overflow-wrap:anywhere]">{row.reason}</p>
                  )}
                  {row.event_id && (
                    <details className="text-xs text-muted-foreground">
                      <summary className="min-h-11 cursor-pointer py-3 md:min-h-0 md:py-1">
                        {t('eventDetails')}
                      </summary>
                      <dl className="max-w-80 space-y-1 break-all">
                        {(['event_id', 'client_event_id', 'api_key_id'] as const).map((field) => (
                          <div key={field}>
                            <dt>{t(field)}</dt>
                            <dd>{row[field]}</dd>
                          </div>
                        ))}
                      </dl>
                    </details>
                  )}
                </td>
                <td className="p-3">
                  <Link
                    href={integrationEvidenceHref(row, family)}
                    prefetch={false}
                    className="inline-flex min-h-11 items-center py-1 underline md:min-h-0"
                  >
                    {t('openEvidence')}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScrollRegion>
      {!result.rows.length && <p>{t('empty')}</p>}
      <nav className="flex flex-wrap items-center gap-4" aria-label={t('pagination')}>
        {result.page > 1 && (
          <Link
            href={integrationHref(params, result.page - 1, family)}
            prefetch={false}
            className="inline-flex min-h-11 items-center py-1 underline md:min-h-0"
          >
            {t('previous')}
          </Link>
        )}
        <span>{t('page', { page: result.page, pages })}</span>
        {result.page < pages && (
          <Link
            href={integrationHref(params, result.page + 1, family)}
            prefetch={false}
            className="inline-flex min-h-11 items-center py-1 underline md:min-h-0"
          >
            {t('next')}
          </Link>
        )}
      </nav>
    </div>
  )
}
