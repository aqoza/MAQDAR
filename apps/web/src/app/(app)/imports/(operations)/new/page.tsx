import { HistoryIcon } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getMessages, getTranslations } from 'next-intl/server'
import { ImportWizardLoader } from '@/components/imports/import-wizard-loader'
import type { ColumnLabelMap, MatchLabelMap } from '@/components/imports/types'
import { PageHeader } from '@/components/page-header'
import { buttonVariants } from '@/components/ui/button'
import { ar, en } from '@/i18n/messages'
import { isEditorRole } from '@/lib/auth/roles'
import { ENTITY_NAMES, columnLabels, isEntityName } from '@/lib/imports/contract'
import { firstParam } from '@/lib/master-data/list-params'
import { getActiveContext } from '@/lib/organizations/context'
import { createClient } from '@/lib/supabase/server'
import { loadImportMemory } from '../../data'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('Imports')
  return { title: t('newTitle') }
}

/**
 * The import wizard (editors only). Column labels are resolved here, so the entity namespaces
 * never ship to the browser: one display label per column in the request's language, and every
 * English and Arabic label for matching file headers. The organization's recent file hashes and
 * mappings come along for the duplicate warning and the "as last time" matches.
 */
export default async function NewImportPage({ searchParams }: PageProps<'/imports/new'>) {
  const context = await getActiveContext()
  if (!context) redirect('/login')
  if (!context.active) redirect('/organizations')
  if (!isEditorRole(context.role)) notFound()

  const raw = await searchParams
  const entityParam = firstParam(raw.entity)
  const initialEntity = isEntityName(entityParam) ? entityParam : null

  const [t, messages, memory] = await Promise.all([
    getTranslations('Imports'),
    getMessages(),
    loadImportMemory(await createClient(), context.active.id),
  ])

  const displayLabels: ColumnLabelMap = {}
  const matchLabels: MatchLabelMap = {}
  for (const entity of ENTITY_NAMES) {
    const shown = columnLabels(entity, messages)
    displayLabels[entity] = Object.fromEntries(
      Object.entries(shown).flatMap(([column, labels]) =>
        labels[0] === undefined ? [] : [[column, labels[0]]],
      ),
    )
    matchLabels[entity] = columnLabels(entity, en, ar)
  }

  return (
    <>
      <PageHeader
        pattern="imports"
        title={t('newTitle')}
        description={t('newDescription')}
        actions={
          <Link
            href="/imports"
            prefetch={false}
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            <HistoryIcon aria-hidden="true" />
            {t('title')}
          </Link>
        }
      />
      <ImportWizardLoader
        organizationId={context.active.id}
        initialEntity={initialEntity}
        displayLabels={displayLabels}
        matchLabels={matchLabels}
        previousMappings={memory.previousMappings}
        previousFiles={memory.previousFiles}
      />
    </>
  )
}
