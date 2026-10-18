import { getTranslations } from 'next-intl/server'
import { EmptyState } from '@/components/empty-state'
import { PageHeader } from '@/components/page-header'
import type { PageHeaderPattern } from '@/components/page-header-art'

export type PlaceholderNamespace = 'Dashboard' | 'Forecasts' | 'Replenishment'

/** Shell page for areas that are built in a later step. */
export async function PlaceholderPage({
  namespace,
  pattern,
}: {
  namespace: PlaceholderNamespace
  pattern: PageHeaderPattern
}) {
  const t = await getTranslations(namespace)
  const tEmpty = await getTranslations('Empty')
  return (
    <>
      <PageHeader pattern={pattern} title={t('title')} description={t('description')} />
      <EmptyState title={tEmpty('title')} description={t('empty')} />
    </>
  )
}
