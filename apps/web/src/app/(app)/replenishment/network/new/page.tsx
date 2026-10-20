import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { randomUUID } from 'node:crypto'
import { NextIntlClientProvider } from 'next-intl'
import { getLocale, getMessages, getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { PageHeader } from '@/components/page-header'
import { TableScrollRegion } from '@/components/table-scroll-region'
import { HelpDisclosure } from '@/components/help-disclosure'
import { NetworkAllocationReport } from '@/components/network-allocation-report'
import { NetworkAllocationSave } from '@/components/network-allocation-save'
import { getActiveContext } from '@/lib/organizations/context'
import { isEditorRole } from '@/lib/auth/roles'
import { createClient } from '@/lib/supabase/server'
import {
  networkInputSchema,
  networkParams,
  networkReportSchema,
  networkRpcInput,
} from '@/lib/network-allocation'
import { redistributionListParams } from '@/lib/redistribution'
import {
  firstParam,
  lastPage,
  nearestRange,
  type RawSearchParams,
} from '@/lib/master-data/list-params'
import { searchPatterns } from '@/lib/master-data/search'
import { formatScore } from '@/lib/forecast-quality'

const path = '/replenishment/network/new'
const field = 'w-full min-w-0 rounded-md border bg-background p-2'
export default async function NewNetworkAllocation({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>
}) {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  const org = context.active.id
  const [raw, db, t, r, locale, messages] = await Promise.all([
    searchParams,
    createClient(),
    getTranslations('NetworkAllocation'),
    getTranslations('Redistribution'),
    getLocale(),
    getMessages(),
  ])
  const values = networkParams(raw)
  const params = redistributionListParams(raw)
  const header = (
    <PageHeader
      pattern="replenishment"
      title={t('create')}
      description={t('context')}
      back={
        <Link className="underline" href="/replenishment/network">
          {t('back')}
        </Link>
      }
      help={
        <HelpDisclosure>
          <p>{t('method')}</p>
          <p>{t('planningOnly')}</p>
        </HelpDisclosure>
      }
    />
  )
  if (!values.policy) {
    const query = (head: boolean) => {
      let q = db
        .from('network_allocation_source_options')
        .select('*', { count: 'exact', head })
        .eq('organization_id', org)
      for (const pattern of searchPatterns(params.q)) q = q.like('search_text', pattern)
      return q
    }
    const count = await query(true)
    if (count.error) throw new Error('Source options unavailable')
    const pages = lastPage(count.count ?? 0, 25)
    const href = (page: number) =>
      `${path}?${new URLSearchParams({ q: params.q, page: String(page) })}`
    if (params.page > pages) redirect(href(pages))
    const range = nearestRange((params.page - 1) * 25, params.page * 25 - 1, count.count ?? 0)
    const result = await query(false)
      .order('finished_at', { ascending: range.reversed })
      .order('id', { ascending: !range.reversed })
      .range(range.from, range.to)
    if (result.error?.code === 'PGRST103') redirect(href(1))
    if (result.error) throw new Error('Source options unavailable')
    const rows = range.reversed ? (result.data ?? []).toReversed() : (result.data ?? [])
    return (
      <div className="min-w-0 space-y-4 wrap-anywhere">
        {header}
        <h2 className="text-section-title">{t('chooseSource')}</h2>
        <form className="workspace-toolbar flex flex-wrap items-end gap-3" action={path}>
          <label className="grid min-w-0 gap-1">
            {t('searchSource')}
            <input name="q" className={field} defaultValue={params.q} maxLength={100} />
          </label>
          <button className="rounded-md bg-primary px-4 py-2 text-primary-foreground">
            {t('search')}
          </button>
        </form>
        <TableScrollRegion label={t('chooseSource')}>
          <table className="w-full min-w-[38rem] text-sm">
            <thead>
              <tr>
                {(['source', 'item', 'cutoff', 'maximum', 'choose'] as const).map((key) => (
                  <th key={key} className="p-2 text-start">
                    {t(key)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id} className="border-t">
                  <th className="p-2 text-start">
                    {row.source_code}
                    <p className="text-xs font-normal">{row.id}</p>
                  </th>
                  <td className="p-2">{row.item_code}</td>
                  <td className="p-2">{row.cutoff}</td>
                  <td className="p-2">
                    {formatScore(row.maximum, locale)} {row.unit}
                  </td>
                  <td className="p-2">
                    <Link prefetch={false} className="underline" href={`${path}?policy=${row.id}`}>
                      {t('choosePolicy', { source: row.source_code ?? '—' })}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScrollRegion>
        {!result.data?.length && <p>{t('emptySources')}</p>}
        <nav className="flex flex-wrap gap-3" aria-label={t('pagination')}>
          {params.page > 1 && <Link href={href(params.page - 1)}>{t('previous')}</Link>}
          <span>{t('page', { page: params.page, pages })}</span>
          {params.page < pages && <Link href={href(params.page + 1)}>{t('next')}</Link>}
        </nav>
      </div>
    )
  }
  if (!z.guid().safeParse(values.policy).success) notFound()
  const policy = await db
    .from('network_allocation_source_options')
    .select('*')
    .eq('organization_id', org)
    .eq('id', values.policy)
    .maybeSingle()
  if (policy.error) throw new Error('Source policy unavailable')
  if (!policy.data) notFound()
  const selectedIds = z.array(z.guid()).max(20).safeParse(values.drafts)
  if (!selectedIds.success || new Set(values.drafts).size !== values.drafts.length) {
    return (
      <div className="min-w-0 space-y-4">
        {header}
        <p role="alert">{t('invalid')}</p>
        <Link className="underline" href={`${path}?policy=${values.policy}`}>
          {t('reset')}
        </Link>
      </div>
    )
  }
  const branchQuery = (head = false) =>
    db
      .from('network_allocation_branch_options')
      .select('*', { count: 'exact', head })
      .eq('organization_id', org)
      .eq('source_policy_id', values.policy!)
  const candidatesQuery = (head: boolean) => {
    let q = branchQuery(head)
    for (const pattern of searchPatterns(params.q)) q = q.like('search_text', pattern)
    if (values.drafts.length) q = q.not('id', 'in', `(${values.drafts.join(',')})`)
    return q
  }
  const [count, selected] = await Promise.all([
    candidatesQuery(true),
    values.drafts.length
      ? branchQuery().in('id', values.drafts).order('location_id').order('id')
      : Promise.resolve({ data: [], error: null }),
  ])
  if (count.error) throw new Error('Branches unavailable')
  if (selected.error) throw new Error('Selected branches unavailable')
  if (selected.data?.length !== values.drafts.length) notFound()
  const pages = lastPage(count.count ?? 0, 25)
  const selectionHref = (page: number, revisions?: number) => {
    const q = new URLSearchParams({ policy: values.policy!, q: params.q, page: String(page) })
    for (const id of values.drafts) q.append('draft', id)
    for (const key of ['maximum', 'backorders', 'commitments', 'lanes'] as const) {
      if (values[key] !== undefined) q.set(key, values[key]!)
    }
    if (revisions) q.set('revisions', String(revisions))
    return `${path}?${q}`
  }
  if (params.page > pages) redirect(selectionHref(pages))
  const range = nearestRange((params.page - 1) * 25, params.page * 25 - 1, count.count ?? 0)
  const candidates = await candidatesQuery(false)
    .order('created_at', { ascending: range.reversed })
    .order('id', { ascending: !range.reversed })
    .range(range.from, range.to)
  if (candidates.error?.code === 'PGRST103') redirect(selectionHref(1))
  if (candidates.error) throw new Error('Branches unavailable')
  const candidateRows = range.reversed
    ? (candidates.data ?? []).toReversed()
    : (candidates.data ?? [])
  const revisionPage = redistributionListParams({ page: firstParam(raw.revisions) }).page
  const revisions = await db
    .from('policy_override_history')
    .select('id,revision,order_up_to', { count: 'exact' })
    .eq('organization_id', org)
    .eq('policy_id', values.policy)
    .eq('status', 'approved')
    .order('revision', { ascending: false })
    .range((revisionPage - 1) * 25, revisionPage * 25 - 1)
  if (revisions.error && revisions.error.code !== 'PGRST103')
    throw new Error('Revisions unavailable')
  if (revisionPage > lastPage(revisions.count ?? 0, 25))
    redirect(selectionHref(params.page, lastPage(revisions.count ?? 0, 25)))
  let options = revisions.data ?? []
  if (z.guid().safeParse(values.maximum).success && !options.some((v) => v.id === values.maximum)) {
    const selectedRevision = await db
      .from('policy_override_history')
      .select('id,revision,order_up_to')
      .eq('organization_id', org)
      .eq('policy_id', values.policy)
      .eq('status', 'approved')
      .eq('id', values.maximum!)
      .maybeSingle()
    if (selectedRevision.error) throw new Error('Revision unavailable')
    if (selectedRevision.data) options = [selectedRevision.data, ...options]
  }
  const parsed = networkInputSchema.safeParse(values)
  let report = null
  let invalid = !parsed.success && firstParam(raw.preview) === 'true'
  if (parsed.success) {
    const result = await db.rpc('network_allocation_preview', {
      p_organization_id: org,
      ...networkRpcInput(parsed.data),
    })
    if (result.error?.code === 'MQ404') notFound()
    if (result.error?.code === 'MQ422') invalid = true
    else if (result.error) throw new Error('Allocation preview unavailable')
    else report = networkReportSchema.parse(result.data)
  }
  const branchRows = [...(selected.data ?? []), ...candidateRows]
  return (
    <div className="min-w-0 space-y-4 wrap-anywhere">
      {header}
      <div className="workspace-panel flex flex-wrap justify-between gap-3">
        <p className="text-evidence-value">
          {policy.data.source_code} · {policy.data.item_code} · {policy.data.cutoff} ·{' '}
          {policy.data.unit}
        </p>
        <Link className="underline" href={path}>
          {t('changeSource')}
        </Link>
      </div>
      <form action={path} className="workspace-panel min-w-0 space-y-4" key={JSON.stringify(raw)}>
        <input type="hidden" name="policy" value={values.policy} />
        <h2 className="text-section-title">{t('chooseBranches')}</h2>
        <p>{t('branchRules')}</p>
        <label className="grid min-w-0 gap-1">
          {t('searchBranches')}
          <input className={field} name="q" defaultValue={params.q} maxLength={100} />
        </label>
        <button name="page" value="1" className="rounded-md border px-3 py-2">
          {t('search')}
        </button>
        <TableScrollRegion label={t('chooseBranches')}>
          <table className="w-full min-w-[40rem] text-sm">
            <thead>
              <tr>
                {(['choose', 'branch', 'gap', 'draft'] as const).map((key) => (
                  <th key={key} className="p-2 text-start">
                    {t(key)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {branchRows.map((row) => (
                <tr key={row.id} className="border-t">
                  <td className="p-2">
                    <label className="flex min-h-11 items-center gap-2">
                      <input
                        type="checkbox"
                        name="draft"
                        value={row.id!}
                        defaultChecked={values.drafts.includes(row.id!)}
                      />
                      {t('selectBranch', { branch: row.location_code ?? '—' })}
                    </label>
                  </td>
                  <th className="p-2 text-start">{row.location_code}</th>
                  <td className="p-2">
                    {formatScore(row.gap, locale)} {row.unit}
                  </td>
                  <td className="p-2">
                    <Link prefetch={false} href={`/replenishment/${row.id}`} className="underline">
                      {row.id}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScrollRegion>
        {!branchRows.length && <p>{t('emptyBranches')}</p>}
        <nav className="flex flex-wrap items-center gap-3" aria-label={t('pagination')}>
          {params.page > 1 && (
            <button name="page" value={params.page - 1} className="rounded-md border px-3 py-2">
              {t('previous')}
            </button>
          )}
          <span>{t('page', { page: params.page, pages })}</span>
          {params.page < pages && (
            <button name="page" value={params.page + 1} className="rounded-md border px-3 py-2">
              {t('next')}
            </button>
          )}
        </nav>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="grid min-w-0 gap-1">
            {t('maximumSelection')}
            <select name="maximum" className={field} defaultValue={values.maximum ?? ''}>
              <option value="">{t('chooseMaximum')}</option>
              <option value="calculated">
                {r('calculated')} · {formatScore(policy.data.maximum, locale)} {policy.data.unit}
              </option>
              {options.map((v) => (
                <option key={v.id} value={v.id!}>
                  {r('approved', { revision: v.revision ?? 0 })} ·{' '}
                  {formatScore(v.order_up_to, locale)} {policy.data!.unit}
                </option>
              ))}
            </select>
          </label>
          <label className="grid min-w-0 gap-1">
            {t('backorders')}
            <input
              name="backorders"
              inputMode="decimal"
              maxLength={19}
              className={field}
              defaultValue={values.backorders ?? ''}
            />
          </label>
        </div>
        {revisionPage > 1 && (
          <button className="underline" name="revisions" value={revisionPage - 1}>
            {r('previous')}
          </button>
        )}
        {revisionPage < lastPage(revisions.count ?? 0, 25) && (
          <button className="underline" name="revisions" value={revisionPage + 1}>
            {r('olderRevisions')}
          </button>
        )}
        <p className="text-sm text-muted-foreground">{r('backordersHelp')}</p>
        <label className="flex min-h-11 items-center gap-2">
          <input
            type="checkbox"
            name="commitments"
            value="true"
            defaultChecked={values.commitments === 'true'}
          />
          {t('commitmentsConfirmation')}
        </label>
        <label className="flex min-h-11 items-center gap-2">
          <input
            type="checkbox"
            name="lanes"
            value="true"
            defaultChecked={values.lanes === 'true'}
          />
          {t('lanesConfirmation')}
        </label>
        <button
          name="preview"
          value="true"
          className="rounded-md bg-primary px-4 py-2 text-primary-foreground"
        >
          {t('preview')}
        </button>
      </form>
      {invalid && <p role="alert">{t('invalid')}</p>}
      {report && <NetworkAllocationReport report={report} locale={locale} />}
      {report?.status === 'available' && parsed.success && isEditorRole(context.role) && (
        <NextIntlClientProvider messages={{ NetworkAllocation: messages.NetworkAllocation }}>
          <NetworkAllocationSave
            key={report.fingerprint}
            organizationId={org}
            input={{
              ...parsed.data,
              commitments: 'true',
              lanes: 'true',
              fingerprint: report.fingerprint,
              request_id: randomUUID(),
            }}
          />
        </NextIntlClientProvider>
      )}
    </div>
  )
}
