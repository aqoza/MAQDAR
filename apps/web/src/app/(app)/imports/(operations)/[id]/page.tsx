import { ArrowLeftIcon } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getFormatter, getMessages, getTranslations } from 'next-intl/server'
import { ImportDetail, type DetailFile } from '@/components/imports/import-detail'
import { toErrorCounts, type ColumnLabelMap } from '@/components/imports/types'
import { PageHeader } from '@/components/page-header'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { buttonVariants } from '@/components/ui/button'
import { isAdminRole, isEditorRole } from '@/lib/auth/roles'
import { isImportStatus, type CommitMode, type EntityCounts } from '@/lib/imports/client'
import { columnLabels, compareLoadOrder, isEntityName } from '@/lib/imports/contract'
import { detailOutcome, isIdleCommit } from '@/lib/imports/detail'
import { isUuid } from '@/lib/master-data/list-params'
import { getActiveContext } from '@/lib/organizations/context'
import { createClient } from '@/lib/supabase/server'
import { loadErrorExamples, loadMemberEmails } from '../../data'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Imports')
  return { title: t('title') }
}

const FILE_STATUSES = ['staging', 'sealed', 'merged'] as const

/** One import of the active organization (owners, admins and planners only). */
export default async function ImportPage({ params }: PageProps<'/imports/[id]'>) {
  const context = await getActiveContext()
  if (!context) redirect('/login')
  if (!context.active) redirect('/organizations')
  if (!isEditorRole(context.role)) notFound()
  const { id } = await params
  if (!isUuid(id)) notFound()
  const organizationId = context.active.id

  const supabase = await createClient()
  const [batchResult, filesResult] = await Promise.all([
    supabase
      .from('import_batches')
      .select(
        'id, status, commit_mode, source, api_request_id, created_by, created_at, validated_at, finished_at, expires_at, last_step_at, rows_total, rows_staged, error_count, warning_count, counts, failure_code',
      )
      .eq('organization_id', organizationId)
      .eq('id', id)
      .maybeSingle(),
    supabase
      .from('import_files')
      .select(
        'file_no, entity, original_name, status, source_stored, rows_total, rows_new, rows_existing, error_count, warning_count, errors_stored, error_counts, merged_through_row',
      )
      .eq('organization_id', organizationId)
      .eq('batch_id', id)
      .order('file_no'),
  ])
  const outcome = detailOutcome(batchResult, filesResult)
  if (outcome.kind === 'not_found') notFound()
  if (outcome.kind === 'failed') {
    // A failed read is said as such: never an import without files that claims no errors.
    const t = await getTranslations('Imports')
    return (
      <>
        <PageHeader title={t('title')} />
        <Alert variant="destructive">
          <AlertDescription>{t('loadFailed')}</AlertDescription>
        </Alert>
      </>
    )
  }
  const batch = outcome.batch
  if (!isImportStatus(batch.status)) notFound()

  const files: DetailFile[] = outcome.files.flatMap((file) =>
    isEntityName(file.entity)
      ? [
          {
            file_no: file.file_no,
            entity: file.entity,
            name: file.original_name,
            status: (FILE_STATUSES as readonly string[]).includes(file.status)
              ? (file.status as DetailFile['status'])
              : 'staging',
            source_stored: file.source_stored,
            rows_total: file.rows_total,
            rows_new: file.rows_new,
            rows_existing: file.rows_existing,
            error_count: file.error_count,
            warning_count: file.warning_count,
            errors_stored: file.errors_stored,
            error_counts: toErrorCounts(file.error_counts),
            merged_through_row: file.merged_through_row,
          },
        ]
      : [],
  )

  const [t, format, messages, examples, emails] = await Promise.all([
    getTranslations('Imports'),
    getFormatter(),
    getMessages(),
    batch.error_count + batch.warning_count > 0
      ? loadErrorExamples(supabase, organizationId, id, files)
      : Promise.resolve([]),
    batch.source !== 'api' && batch.created_by !== context.userId
      ? loadMemberEmails(supabase, organizationId, isAdminRole(context.role))
      : Promise.resolve(new Map<string, string>()),
  ])

  const labels: ColumnLabelMap = {}
  for (const entity of new Set(files.map((file) => file.entity))) {
    labels[entity] = Object.fromEntries(
      Object.entries(columnLabels(entity, messages)).flatMap(([column, texts]) =>
        texts[0] === undefined ? [] : [[column, texts[0]]],
      ),
    )
  }
  const by =
    batch.source === 'api'
      ? t('viaApi')
      : batch.created_by === context.userId
        ? t('you')
        : ((batch.created_by ? emails.get(batch.created_by) : undefined) ?? t('someoneElse'))
  const tClient = await getTranslations('ImportsClient')
  const entities = [...new Set(files.map((file) => file.entity))].sort(compareLoadOrder)

  return (
    <>
      <PageHeader
        title={t('detailTitle', { date: format.dateTime(new Date(batch.created_at), 'long') })}
        description={format.list(entities.map((entity) => tClient(`entities.${entity}`)))}
        actions={
          <Link
            href="/imports"
            prefetch={false}
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            <ArrowLeftIcon className="rtl:rotate-180" aria-hidden="true" />
            {t('detail.back')}
          </Link>
        }
      />
      <ImportDetail
        batch={{
          id: batch.id,
          status: batch.status,
          commit_mode:
            batch.commit_mode === 'atomic' || batch.commit_mode === 'stepped'
              ? (batch.commit_mode as CommitMode)
              : null,
          created_at: batch.created_at,
          validated_at: batch.validated_at,
          finished_at: batch.finished_at,
          expires_at: batch.expires_at,
          rows_total: batch.rows_total,
          rows_staged: batch.rows_staged,
          error_count: batch.error_count,
          warning_count: batch.warning_count,
          counts: (batch.counts ?? {}) as Record<string, EntityCounts>,
          failure_code: batch.failure_code,
          idle: isIdleCommit(batch.status, batch.last_step_at),
          by,
          // The X-Request-Id the API answered with (also in the Worker logs), for support.
          request_id: batch.source === 'api' ? batch.api_request_id : null,
        }}
        files={files}
        examples={examples}
        labels={labels}
      />
    </>
  )
}
