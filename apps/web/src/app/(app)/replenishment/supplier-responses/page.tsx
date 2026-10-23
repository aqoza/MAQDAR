import Form from 'next/form'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getFormatter, getTranslations } from 'next-intl/server'
import { PageHeader } from '@/components/page-header'
import { ReplenishmentNav } from '@/components/replenishment-nav'
import { HelpDisclosure } from '@/components/help-disclosure'
import { TableScrollRegion } from '@/components/table-scroll-region'
import { getActiveContext } from '@/lib/organizations/context'
import { createClient } from '@/lib/supabase/server'
import { lastPage, type RawSearchParams } from '@/lib/master-data/list-params'
import {
  supplierWorkbenchParams,
  supplierWorkbenchHref,
  supplierWorkbenchPath,
  supplierWorkbenchResultSchema,
  supplierPublicationHref,
} from '@/lib/supplier-response-workbench'

export default async function SupplierResponseWorkbench({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>
}) {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  const params = supplierWorkbenchParams(await searchParams)
  const [db, t, format] = await Promise.all([
    createClient(),
    getTranslations('SupplierResponseWorkbench'),
    getFormatter(),
  ])
  const [response, locations] = await Promise.all([
    db.rpc('supplier_response_workbench', {
      p_organization_id: context.active.id,
      p_filters: { ...params.filters, q: params.q },
      p_page: params.page,
      p_size: params.size,
    }),
    db
      .from('locations')
      .select('code')
      .eq('organization_id', context.active.id)
      .eq('is_active', true)
      .order('code')
      .limit(100),
  ])
  if (response.error || locations.error) throw new Error('Supplier response workbench unavailable')
  const result = supplierWorkbenchResultSchema.parse(response.data)
  if (result.page !== params.page) redirect(supplierWorkbenchHref(params, result.page))
  const pages = lastPage(result.total, result.size)
  const inputClass = 'w-full min-w-0 rounded-md border bg-background p-2'
  return (
    <div className="min-w-0 space-y-4">
      <PageHeader
        pattern="replenishment"
        title={t('title')}
        description={t('context')}
        navigation={<ReplenishmentNav current="supplierResponses" />}
        help={
          <HelpDisclosure>
            <p>{t('meaning')}</p>
            <p>{t('independence')}</p>
            <p>{t('searchHelp')}</p>
          </HelpDisclosure>
        }
      />
      <Form
        action={supplierWorkbenchPath}
        key={JSON.stringify(params)}
        className="workspace-toolbar grid min-w-0 grid-cols-2 items-end gap-3 sm:grid-cols-3 xl:grid-cols-6"
      >
        <label className="col-span-2 grid min-w-0 gap-1 sm:col-span-3 xl:col-span-2">
          {t('search')}
          <input name="q" maxLength={100} defaultValue={params.q} className={inputClass} />
        </label>
        {(['supplier', 'location'] as const).map((field) => (
          <label key={field} className="grid min-w-0 gap-1">
            {t(field)}
            <input
              name={field}
              maxLength={64}
              list={field === 'location' ? 'supplier-response-locations' : undefined}
              defaultValue={params.filters[field] ?? ''}
              className={inputClass}
            />
          </label>
        ))}
        <datalist id="supplier-response-locations">
          {locations.data.map((l) => (
            <option key={l.code} value={l.code} />
          ))}
        </datalist>
        {(
          [
            ['kind', ['handoff', 'batch']],
            ['state', ['published', 'withdrawn']],
            ['status', ['received', 'declined', 'no_response']],
          ] as const
        ).map(([field, values]) => (
          <label key={field} className="grid min-w-0 gap-1">
            {t(field)}
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
        <div className="col-span-2 flex flex-wrap items-end gap-3 sm:col-span-3 xl:col-span-3">
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
          <button
            className="min-h-11 rounded-md bg-primary px-3 py-2 text-primary-foreground md:min-h-0"
            type="submit"
          >
            {t('apply')}
          </button>
          <Link
            href={supplierWorkbenchPath}
            className="inline-flex min-h-11 items-center underline md:min-h-0"
          >
            {t('clear')}
          </Link>
        </div>
      </Form>
      <p className="text-sm text-muted-foreground" role="status">
        {t('count', { count: result.total })}
      </p>
      <TableScrollRegion label={t('results')}>
        <table className="w-full text-start text-sm">
          <caption className="sr-only">{t('results')}</caption>
          <thead>
            <tr>
              {(['package', 'supplierLocation', 'state', 'status', 'evidence'] as const).map(
                (field) => (
                  <th key={field} scope="col" className="p-3 text-start font-medium">
                    {t(field)}
                  </th>
                ),
              )}
            </tr>
          </thead>
          <tbody>
            {result.rows.map((row) => (
              <tr key={`${row.kind}:${row.id}`} className="border-t align-top">
                <th scope="row" className="min-w-48 p-3 text-start font-normal">
                  <p className="text-evidence-value">{t(row.kind)}</p>
                  {row.kind === 'handoff' ? (
                    <p className="max-w-48 break-words">{row.item_codes[0]}</p>
                  ) : (
                    <details>
                      <summary className="min-h-11 cursor-pointer py-3 md:min-h-0 md:py-1">
                        {t('lines', { count: row.line_count })}
                      </summary>
                      <ul className="max-w-48 break-words">
                        {row.item_codes.map((code, i) => (
                          <li key={i}>{code}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                  <details className="text-xs text-muted-foreground">
                    <summary className="min-h-11 cursor-pointer py-3 md:min-h-0 md:py-1">
                      {t('publicationDetails')}
                    </summary>
                    <p className="max-w-48 break-all">{row.id}</p>
                    <time dateTime={row.created_at}>
                      {format.dateTime(new Date(row.created_at), 'long')}
                    </time>
                  </details>
                </th>
                <td className="min-w-40 p-3">
                  <p className="max-w-48 break-words">{row.supplier_code}</p>
                  <p className="max-w-48 break-words text-muted-foreground">{row.location_code}</p>
                </td>
                <td className="min-w-32 p-3">
                  <p>{t(row.state)}</p>
                  {row.withdrawn_at && (
                    <time className="text-xs text-muted-foreground" dateTime={row.withdrawn_at}>
                      {format.dateTime(new Date(row.withdrawn_at), 'long')}
                    </time>
                  )}
                </td>
                <td className="min-w-64 p-3">
                  <p
                    className={
                      row.status === 'declined' ? 'font-medium text-destructive' : 'font-medium'
                    }
                  >
                    {t(row.status)}
                  </p>
                  {row.response && (
                    <>
                      <p className="max-w-64 break-all">{row.response.author}</p>
                      <time
                        className="text-xs text-muted-foreground"
                        dateTime={row.response.created_at}
                      >
                        {format.dateTime(new Date(row.response.created_at), 'long')}
                      </time>
                      {row.response.reference && (
                        <p className="max-w-64 break-words [overflow-wrap:anywhere]">
                          {t('reference')}: {row.response.reference}
                        </p>
                      )}
                      {row.response.reason && (
                        <details className="max-w-80">
                          <summary className="min-h-11 cursor-pointer py-3 md:min-h-0 md:py-1">
                            {t(row.status === 'declined' ? 'declineReason' : 'note')}
                          </summary>
                          <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                            {row.response.reason}
                          </p>
                        </details>
                      )}
                    </>
                  )}
                </td>
                <td className="p-3">
                  <Link
                    prefetch={false}
                    href={supplierPublicationHref(row)}
                    className="inline-flex min-h-11 items-center underline md:min-h-0"
                  >
                    {t('open')}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScrollRegion>
      {!result.rows.length && <p>{t('empty')}</p>}
      <nav aria-label={t('pagination')} className="flex flex-wrap items-center gap-4">
        {result.page > 1 && (
          <Link
            className="inline-flex min-h-11 items-center underline md:min-h-0"
            prefetch={false}
            href={supplierWorkbenchHref(params, result.page - 1)}
          >
            {t('previous')}
          </Link>
        )}
        <span>{t('page', { page: result.page, pages })}</span>
        {result.page < pages && (
          <Link
            className="inline-flex min-h-11 items-center underline md:min-h-0"
            prefetch={false}
            href={supplierWorkbenchHref(params, result.page + 1)}
          >
            {t('next')}
          </Link>
        )}
      </nav>
    </div>
  )
}
