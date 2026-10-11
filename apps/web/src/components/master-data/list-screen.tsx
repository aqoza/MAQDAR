import { PlusIcon } from 'lucide-react'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getLocale, getTranslations } from 'next-intl/server'
import { Suspense } from 'react'
import { EmptyState } from '@/components/empty-state'
import { AreaTabs } from '@/components/master-data/area-tabs'
import { DataTable } from '@/components/master-data/data-table'
import { ListPager } from '@/components/master-data/list-pager'
import { ListToolbar, type ToolbarFilter } from '@/components/master-data/list-toolbar'
import { TableSkeleton } from '@/components/master-data/table-skeleton'
import { PageHeader } from '@/components/page-header'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { buttonVariants } from '@/components/ui/button'
import { isEditorRole } from '@/lib/auth/roles'
import {
  DEFAULT_PAGE_SIZE,
  defaultDirFor,
  firstParam,
  isFiltered,
  listHref,
  paramsKey,
  parseListParams,
  type ListParams,
  type RawSearchParams,
} from '@/lib/master-data/list-params'
import {
  getEntityTranslator,
  optionalMessage,
  type LooseTranslator,
} from '@/lib/master-data/messages'
import { fetchListPage, loadOptions, optionSourcesOf } from '@/lib/master-data/query'
import { getEntity, type EntityKey } from '@/lib/master-data/registry'
import type { EntityDefinition, OptionSourceKey } from '@/lib/master-data/types'
import { getActiveContext } from '@/lib/organizations/context'
import { createClient } from '@/lib/supabase/server'

type ListScreenProps = {
  entity: EntityKey
  /** The page's `searchParams` promise (Next 16), passed through unchanged. */
  searchParams: Promise<RawSearchParams>
}

function toolbarFilters(
  definition: EntityDefinition,
  params: ListParams,
  t: LooseTranslator,
  yes: string,
  no: string,
  options: Partial<Record<OptionSourceKey, Array<{ value: string; label: string }>>>,
): ToolbarFilter[] {
  return definition.list.filters.map((filter) => {
    const label = t(`filters.${filter.param}`)
    const value = params.filters[filter.param] ?? ''
    const optionLabel = (raw: string, fallback: string) => {
      const key = `options.${filter.column}.${raw}`
      return t.has(key) ? t(key) : fallback
    }
    switch (filter.kind) {
      case 'enum':
        return {
          param: filter.param,
          label,
          value,
          options: filter.values.map((option) => ({
            value: option,
            label: optionLabel(option, option),
          })),
        }
      case 'boolean':
        return {
          param: filter.param,
          label,
          value,
          options: [
            { value: 'true', label: optionLabel('true', yes) },
            { value: 'false', label: optionLabel('false', no) },
          ],
        }
      case 'uuid':
      case 'pattern': {
        // Options come from the filter's source (brands, currencies, …); without one, only the
        // current value can be shown.
        const source = definition.filterOptions?.[filter.param]
        const choices = source ? (options[source] ?? []) : value ? [{ value, label: value }] : []
        return { param: filter.param, label, value, options: choices }
      }
    }
  })
}

/**
 * A server-rendered master-data list: header (with "New" for editors), area tabs, a GET toolbar,
 * then the rows and pager in a Suspense boundary keyed by the URL state, so a new search or page
 * shows the skeleton instead of stale rows. One count-exact query per render.
 */
export async function ListScreen({ entity, searchParams }: ListScreenProps) {
  const context = await getActiveContext()
  if (!context) redirect('/login')
  if (!context.active) redirect('/organizations')
  const organizationId = context.active.id

  const definition = getEntity(entity)
  const raw = await searchParams
  const params = parseListParams(raw, definition.list)
  const [t, tList, tForm, locale] = await Promise.all([
    getEntityTranslator(definition.namespace),
    getTranslations('MasterData.list'),
    getTranslations('MasterData.form'),
    getLocale(),
  ])
  const canEdit = isEditorRole(context.role)

  const filterSources = optionSourcesOf(definition, 'filters')
  const options =
    filterSources.length > 0
      ? await loadOptions(await createClient(), filterSources, organizationId, locale)
      : {}

  const hidden: Record<string, string> = {}
  if (params.sort !== definition.list.defaultSort) hidden.sort = params.sort
  if (params.dir !== defaultDirFor(definition.list, params.sort)) hidden.dir = params.dir
  if (params.size !== DEFAULT_PAGE_SIZE) hidden.size = String(params.size)

  const filtered = isFiltered(params)
  const clearHref = filtered
    ? listHref(definition.basePath, definition.list, { ...params, q: '', filters: {} }, { page: 1 })
    : null
  const deleted = firstParam(raw.notice) === 'deleted'

  return (
    <>
      <PageHeader
        title={t('title')}
        description={t('description')}
        actions={
          canEdit ? (
            <Link
              href={`${definition.basePath}/new`}
              prefetch={false}
              className={buttonVariants({ size: 'sm' })}
            >
              <PlusIcon aria-hidden="true" />
              {tList('new')}
            </Link>
          ) : null
        }
      />
      <AreaTabs area={definition.area} current={definition.tab} />
      {deleted ? (
        <Alert role="status">
          <AlertDescription>{tForm('deleted')}</AlertDescription>
        </Alert>
      ) : null}
      <ListToolbar
        action={definition.basePath}
        searchable={definition.list.search}
        q={params.q}
        searchPlaceholder={optionalMessage(t, 'searchPlaceholder')}
        hidden={hidden}
        filters={toolbarFilters(definition, params, t, tList('yes'), tList('no'), options)}
        clearHref={clearHref}
        clearLabel={tList('clear')}
      />
      <Suspense
        key={paramsKey(params)}
        fallback={
          <TableSkeleton rows={Math.min(params.size, 10)} columns={definition.columns.length} />
        }
      >
        <ListResults
          definition={definition}
          params={params}
          organizationId={organizationId}
          filtered={filtered}
        />
      </Suspense>
    </>
  )
}

async function ListResults({
  definition,
  params,
  organizationId,
  filtered,
}: {
  definition: EntityDefinition
  params: ListParams
  organizationId: string
  filtered: boolean
}) {
  const supabase = await createClient()
  const [result, tList, tEmpty] = await Promise.all([
    fetchListPage(supabase, definition, organizationId, params),
    getTranslations('MasterData.list'),
    getTranslations('Empty'),
  ])

  if (!result.ok) {
    if (result.reason === 'past_end') {
      redirect(listHref(definition.basePath, definition.list, params, { page: result.page }))
    }
    return (
      <Alert variant="destructive">
        <AlertDescription>{tList('loadFailed')}</AlertDescription>
      </Alert>
    )
  }

  if (result.rows.length === 0) {
    return filtered ? (
      <EmptyState title={tList('noMatches')} description={tList('noMatchesHint')} />
    ) : (
      <EmptyState title={tEmpty('title')} description={tList('empty')} />
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <DataTable definition={definition} rows={result.rows} params={params} />
      <ListPager
        basePath={definition.basePath}
        spec={definition.list}
        params={params}
        total={result.total}
      />
    </div>
  )
}
