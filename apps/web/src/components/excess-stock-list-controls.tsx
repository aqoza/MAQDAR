import Form from 'next/form'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import type { ListParams } from '@/lib/master-data/list-params'

export async function ExcessStockFilters({
  params,
  tokens = [],
  cutoff = '',
  candidates = false,
}: {
  params: ListParams
  tokens?: string[]
  cutoff?: string
  candidates?: boolean
}) {
  const t = await getTranslations('ExcessStock')
  return (
    <Form
      action={`/replenishment/excess${candidates ? '/new' : ''}`}
      key={JSON.stringify([params, cutoff, tokens])}
      className="workspace-toolbar flex flex-wrap items-end gap-3"
    >
      {tokens.map((token) => (
        <input key={token} type="hidden" name="choice" value={token} />
      ))}
      <label className="grid min-w-0 gap-1">
        {t('search')}
        <input
          name="q"
          defaultValue={params.q}
          maxLength={100}
          className="min-w-0 rounded-md border bg-background p-2"
        />
      </label>
      <label className="grid min-w-0 gap-1">
        {t('location')}
        <input
          name="location"
          defaultValue={params.filters.location ?? ''}
          maxLength={64}
          className="min-w-0 rounded-md border bg-background p-2"
        />
      </label>
      <label className="grid gap-1">
        {t('cutoff')}
        <input
          name="cutoff"
          type="date"
          defaultValue={cutoff}
          className="rounded-md border bg-background p-2"
        />
      </label>
      <label className="grid gap-1">
        {t('size')}
        <select
          name="size"
          defaultValue={params.size}
          className="rounded-md border bg-background p-2"
        >
          {[25, 50, 100].map((size) => (
            <option key={size}>{size}</option>
          ))}
        </select>
      </label>
      <label className="grid gap-1">
        {t('sort')}
        <select
          name="dir"
          defaultValue={params.dir}
          className="rounded-md border bg-background p-2"
        >
          <option value="desc">{t('newest')}</option>
          <option value="asc">{t('oldest')}</option>
        </select>
      </label>
      <button className="rounded-md bg-primary px-4 py-2 text-primary-foreground">
        {t('filter')}
      </button>
    </Form>
  )
}
export async function ExcessStockPagination({
  page,
  pages,
  previous,
  next,
}: {
  page: number
  pages: number
  previous?: string
  next?: string
}) {
  const t = await getTranslations('ExcessStock')
  return (
    <nav aria-label={t('pagination')} className="flex flex-wrap items-center gap-4">
      {previous && (
        <Link className="underline" href={previous}>
          {t('previous')}
        </Link>
      )}
      <span>{t('page', { page, pages })}</span>
      {next && (
        <Link className="underline" href={next}>
          {t('next')}
        </Link>
      )}
    </nav>
  )
}
