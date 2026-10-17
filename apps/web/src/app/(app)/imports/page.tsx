import { PlusIcon } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { Suspense } from 'react'
import { EmptyState } from '@/components/empty-state'
import { ImportHistory, type HistoryRow } from '@/components/imports/import-history'
import { ListPager } from '@/components/master-data/list-pager'
import { ListToolbar } from '@/components/master-data/list-toolbar'
import { TableSkeleton } from '@/components/master-data/table-skeleton'
import { PageHeader } from '@/components/page-header'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { buttonVariants } from '@/components/ui/button'
import { isAdminRole, isEditorRole } from '@/lib/auth/roles'
import { IMPORT_STATUSES, isImportStatus, type EntityCounts } from '@/lib/imports/client'
import { compareLoadOrder, isEntityName, type EntityName } from '@/lib/imports/contract'
import {
  DEFAULT_PAGE_SIZE,
  defaultDirFor,
  firstParam,
  isFiltered,
  lastPage,
  listHref,
  paramsKey,
  parseListParams,
  toRange,
  type ListParams,
  type ListSpec,
} from '@/lib/master-data/list-params'
import { getActiveContext } from '@/lib/organizations/context'
import { createClient } from '@/lib/supabase/server'
import { IMPORT_SOURCES, historyConditions, loadMemberEmails } from './data'

/**
 * URL state of the history: newest first (index import_batches_list_idx), filter by status and by
 * source (the import wizard or the REST API).
 */
const HISTORY: ListSpec = {
  sorts: ['created_at'],
  defaultSort: 'created_at',
  defaultDir: 'desc',
  tiebreak: 'id',
  filters: [
    { param: 'status', column: 'status', kind: 'enum', values: IMPORT_STATUSES },
    { param: 'source', column: 'source', kind: 'enum', values: IMPORT_SOURCES },
  ],
  search: false,
}

const BASE_PATH = '/imports'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Imports')
  return { title: t('title') }
}

/** Import history of the active organization (owners, admins and planners only). */
export default async function ImportsPage({ searchParams }: PageProps<'/imports'>) {
  const context = await getActiveContext()
  if (!context) redirect('/login')
  if (!context.active) redirect('/organizations')
  if (!isEditorRole(context.role)) notFound()

  const raw = await searchParams
  const params = parseListParams(raw, HISTORY)
  const [t, tClient, tList] = await Promise.all([
    getTranslations('Imports'),
    getTranslations('ImportsClient'),
    getTranslations('MasterData.list'),
  ])

  const hidden: Record<string, string> = {}
  if (params.dir !== defaultDirFor(HISTORY, params.sort)) hidden.dir = params.dir
  if (params.size !== DEFAULT_PAGE_SIZE) hidden.size = String(params.size)
  const filtered = isFiltered(params)

  return (
    <>
      <PageHeader
        pattern="imports"
        title={t('title')}
        description={t('description')}
        actions={
          <Link href="/imports/new" prefetch={false} className={buttonVariants({ size: 'sm' })}>
            <PlusIcon aria-hidden="true" />
            {t('new')}
          </Link>
        }
      />
      {firstParam(raw.notice) === 'deleted' ? (
        <Alert role="status">
          <AlertDescription>{t('deleted')}</AlertDescription>
        </Alert>
      ) : null}
      <ListToolbar
        action={BASE_PATH}
        searchable={false}
        q=""
        hidden={hidden}
        filters={[
          {
            param: 'status',
            label: t('filters.status'),
            value: params.filters.status ?? '',
            options: IMPORT_STATUSES.map((status) => ({
              value: status,
              label: tClient(`status.${status}`),
            })),
          },
          {
            param: 'source',
            label: t('filters.source'),
            value: params.filters.source ?? '',
            options: IMPORT_SOURCES.map((source) => ({
              value: source,
              label: t(`sources.${source}`),
            })),
          },
        ]}
        clearHref={
          filtered ? listHref(BASE_PATH, HISTORY, { ...params, filters: {} }, { page: 1 }) : null
        }
        clearLabel={tList('clear')}
      />
      <Suspense key={paramsKey(params)} fallback={<TableSkeleton rows={8} columns={7} />}>
        <HistoryResults
          params={params}
          organizationId={context.active.id}
          userId={context.userId}
          isAdmin={isAdminRole(context.role)}
          filtered={filtered}
        />
      </Suspense>
    </>
  )
}

async function HistoryResults({
  params,
  organizationId,
  userId,
  isAdmin,
  filtered,
}: {
  params: ListParams
  organizationId: string
  userId: string
  isAdmin: boolean
  filtered: boolean
}) {
  const supabase = await createClient()
  const t = await getTranslations('Imports')
  const { from, to } = toRange(params.page, params.size)
  const ascending = params.dir === 'asc'
  let query = supabase
    .from('import_batches')
    .select(
      'id, status, source, created_at, created_by, rows_total, error_count, warning_count, counts, files:import_files!import_files_batch_fkey(entity)',
      { count: 'exact' },
    )
    .eq('organization_id', organizationId)
  for (const [column, value] of historyConditions(params.filters)) query = query.eq(column, value)
  const [{ data, error, count }, emails] = await Promise.all([
    query.order('created_at', { ascending }).order('id', { ascending }).range(from, to),
    loadMemberEmails(supabase, organizationId, isAdmin),
  ])

  if (error?.code === 'PGRST103') {
    // Past the end (imports were deleted, or the URL was edited): go to the last page.
    let countQuery = supabase
      .from('import_batches')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', organizationId)
    for (const [column, value] of historyConditions(params.filters)) {
      countQuery = countQuery.eq(column, value)
    }
    const { count: total } = await countQuery
    redirect(listHref(BASE_PATH, HISTORY, params, { page: lastPage(total ?? 0, params.size) }))
  }
  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>{t('loadFailed')}</AlertDescription>
      </Alert>
    )
  }

  const rows: HistoryRow[] = (data ?? []).flatMap((row) => {
    if (!isImportStatus(row.status)) return []
    const entities = [
      ...new Set(
        (row.files ?? [])
          .map((file) => file.entity)
          .filter((entity): entity is EntityName => isEntityName(entity)),
      ),
    ].sort(compareLoadOrder)
    const by =
      row.source === 'api'
        ? t('viaApi')
        : row.created_by === userId
          ? t('you')
          : ((row.created_by ? emails.get(row.created_by) : undefined) ?? t('someoneElse'))
    return [
      {
        id: row.id,
        status: row.status,
        created_at: row.created_at,
        entities,
        rows_total: row.rows_total,
        error_count: row.error_count,
        warning_count: row.warning_count,
        counts: (row.counts ?? {}) as Record<string, EntityCounts>,
        by,
      },
    ]
  })

  if (rows.length === 0) {
    return filtered ? (
      <EmptyState title={t('noMatches')} description={t('emptyHint')} />
    ) : (
      <EmptyState title={t('empty')} description={t('emptyHint')} />
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <ImportHistory rows={rows} />
      <ListPager basePath={BASE_PATH} spec={HISTORY} params={params} total={count ?? rows.length} />
    </div>
  )
}
