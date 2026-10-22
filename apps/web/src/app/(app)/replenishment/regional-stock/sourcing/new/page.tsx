import Link from 'next/link'
import { randomUUID } from 'node:crypto'
import { notFound, redirect } from 'next/navigation'
import { NextIntlClientProvider } from 'next-intl'
import { getFormatter, getLocale, getMessages, getTranslations } from 'next-intl/server'
import { z } from 'zod'
import { PageHeader } from '@/components/page-header'
import { HelpDisclosure } from '@/components/help-disclosure'
import { RegionalSourcingForm } from '@/components/regional-sourcing-form'
import { getActiveContext } from '@/lib/organizations/context'
import { isEditorRole } from '@/lib/auth/roles'
import { createClient } from '@/lib/supabase/server'
import { displayName } from '@/lib/format'
import { sourcingContext, sourcingChoices } from '@/lib/regional-sourcing.server'
import { regionalSourcingPath } from '@/lib/regional-sourcing'
import { searchPatterns } from '@/lib/master-data/search'
import { firstParam, type RawSearchParams } from '@/lib/master-data/list-params'

export default async function NewRegionalSourcing({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>
}) {
  const context = await getActiveContext()
  if (!context?.active) redirect('/organizations')
  if (!isEditorRole(context.role)) notFound()
  const [db, t, locale, messages, format, raw] = await Promise.all([
    createClient(),
    getTranslations('RegionalSourcing'),
    getLocale(),
    getMessages(),
    getFormatter(),
    searchParams,
  ])
  const org = context.active.id,
    regionId = firstParam(raw.region),
    draftId = firstParam(raw.draft)
  if (
    (regionId && !z.guid().safeParse(regionId).success) ||
    (draftId && (!regionId || !z.guid().safeParse(draftId).success))
  )
    notFound()
  const header = (
    <PageHeader
      pattern="replenishment"
      title={t('new')}
      description={t('description')}
      back={
        <Link className="underline" href={regionalSourcingPath}>
          {t('title')}
        </Link>
      }
      actions={
        <HelpDisclosure label={t('methodDetails')}>
          <p>{t('method')}</p>
          <p>{t('limits')}</p>
        </HelpDisclosure>
      }
    />
  )
  if (regionId && draftId) {
    const input = await sourcingContext(org, regionId, draftId)
    if (!input) notFound()
    const sources = await Promise.all(
      input.locations
        .filter((l) => l.id !== input.draft.location_id)
        .map(async (l) => {
          const choices = await sourcingChoices(org, input, l.id)
          if (!choices) notFound()
          return { id: l.id, code: l.code, name: displayName(l, locale).primary, choices }
        }),
    )
    return (
      <div className="min-w-0 space-y-4">
        {header}
        <div className="flex flex-wrap items-center justify-between gap-3 workspace-panel">
          <p className="text-sm wrap-anywhere">
            {displayName(input.region, locale).primary} ·{' '}
            <bdi>
              {input.report.policy.item_code} · {input.report.policy.location_code} ·{' '}
              {input.report.policy.cutoff} · {input.report.gap} {input.report.policy.unit}
            </bdi>
          </p>
          <Link
            className="inline-flex min-h-11 items-center underline"
            href={`${regionalSourcingPath}/new?region=${regionId}`}
          >
            {t('changeDraft')}
          </Link>
        </div>
        <NextIntlClientProvider
          messages={{
            RegionalSourcing: messages.RegionalSourcing,
            Redistribution: messages.Redistribution,
            StockComparison: messages.StockComparison,
            StockRegion: messages.StockRegion,
          }}
        >
          <RegionalSourcingForm
            organizationId={org}
            regionId={regionId}
            draftId={draftId}
            requestId={randomUUID()}
            sources={sources}
          />
        </NextIntlClientProvider>
      </div>
    )
  }
  const q = (firstParam(raw.q) ?? '').trim().slice(0, 100)
  const requestedPage = Math.max(1, Number.parseInt(firstParam(raw.page) ?? '1', 10) || 1)
  let rows: { id: string; label: string; detail: string; href: string }[] = [],
    total = 0,
    pages = 1,
    page = 1
  if (!regionId) {
    const base = () => {
      let query = db
        .from('stock_regions')
        .select('id,name_en,name_ar,location_codes', { count: 'exact' })
        .eq('organization_id', org)
        .is('archived_at', null)
      if (q) query = query.ilike('name_en', `%${q.replace(/[\\%_]/g, '\\$&')}%`)
      return query
    }
    const count = await base().limit(0)
    if (count.error) throw new Error('Regions unavailable')
    total = count.count ?? 0
    pages = Math.max(1, Math.ceil(total / 25))
    page = Math.min(requestedPage, pages)
    const result = await base()
      .order('created_at', { ascending: false })
      .order('id')
      .range((page - 1) * 25, page * 25 - 1)
    if (result.error) throw new Error('Regions unavailable')
    rows = result.data.map((r) => ({
      id: r.id,
      label: displayName(r, locale).primary,
      detail: r.location_codes.join(' · '),
      href: `${regionalSourcingPath}/new?region=${r.id}`,
    }))
  } else {
    const region = await db
      .from('stock_regions')
      .select('required_location_ids')
      .eq('organization_id', org)
      .eq('id', regionId)
      .is('archived_at', null)
      .maybeSingle()
    if (region.error) throw new Error('Region unavailable')
    if (!region.data) notFound()
    const base = () => {
      let query = db
        .from('replenishment_draft_list')
        .select('id,item_code,location_code,cutoff,gap,unit,created_at', { count: 'exact' })
        .eq('organization_id', org)
        .in('location_id', region.data!.required_location_ids)
        .eq('status', 'available')
      for (const pattern of searchPatterns(q)) query = query.like('search_text', pattern)
      return query
    }
    const count = await base().limit(0)
    if (count.error) throw new Error('Drafts unavailable')
    total = count.count ?? 0
    pages = Math.max(1, Math.ceil(total / 25))
    page = Math.min(requestedPage, pages)
    const result = await base()
      .order('created_at', { ascending: false })
      .order('id')
      .range((page - 1) * 25, page * 25 - 1)
    if (result.error) throw new Error('Drafts unavailable')
    rows = result.data.map((r) => ({
      id: r.id!,
      label: `${r.item_code} · ${r.location_code} · ${r.gap} ${r.unit}`,
      detail: `${r.cutoff} · ${format.dateTime(new Date(r.created_at!), 'long')}`,
      href: `${regionalSourcingPath}/new?region=${regionId}&draft=${r.id}`,
    }))
  }
  const href = (p: number) =>
    `${regionalSourcingPath}/new?${new URLSearchParams({ ...(regionId ? { region: regionId } : {}), q, page: String(p) })}`
  return (
    <div className="min-w-0 space-y-4">
      {header}
      <h2 className="text-section-title">{t(regionId ? 'chooseDraft' : 'chooseRegion')}</h2>
      <form
        action={`${regionalSourcingPath}/new`}
        className="flex flex-wrap items-end gap-3 workspace-panel"
      >
        {regionId && <input type="hidden" name="region" value={regionId} />}
        <label className="grid min-w-0 grow gap-1 text-sm">
          {t(regionId ? 'draftSearch' : 'regionSearch')}
          <input
            name="q"
            defaultValue={q}
            maxLength={100}
            className="min-w-0 rounded-md border bg-background p-2"
          />
        </label>
        <button className="min-h-11 rounded-md bg-primary px-4 text-primary-foreground">
          {t('search')}
        </button>
        <Link
          className="inline-flex min-h-11 items-center underline"
          href={`${regionalSourcingPath}/new${regionId ? `?region=${regionId}` : ''}`}
        >
          {t('reset')}
        </Link>
      </form>
      <p className="text-xs text-muted-foreground">{t('count', { count: total })}</p>
      {rows.length ? (
        <ul className="divide-y workspace-panel">
          {rows.map((row) => (
            <li className="py-3" key={row.id}>
              <Link
                className="inline-flex min-h-11 items-center text-sm underline wrap-anywhere"
                href={row.href}
              >
                {row.label}
              </Link>
              <p className="text-xs text-muted-foreground wrap-anywhere">{row.detail}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p role="status" className="workspace-panel">
          {t('emptyChoices')}
        </p>
      )}
      {pages > 1 && (
        <nav className="flex flex-wrap items-center gap-3" aria-label={t('pages')}>
          <span>{t('page', { page, pages })}</span>
          {page > 1 && (
            <Link className="inline-flex min-h-11 items-center underline" href={href(page - 1)}>
              {t('previous')}
            </Link>
          )}
          {page < pages && (
            <Link className="inline-flex min-h-11 items-center underline" href={href(page + 1)}>
              {t('next')}
            </Link>
          )}
        </nav>
      )}
    </div>
  )
}
