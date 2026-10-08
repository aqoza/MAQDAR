import { getTranslations } from 'next-intl/server'
import { EmptyState } from '@/components/empty-state'
import { PageHeader } from '@/components/page-header'

export type PlaceholderNamespace =
  'Dashboard' | 'Items' | 'Locations' | 'Suppliers' | 'Forecasts' | 'Replenishment'

/** Shell page for areas that are built in a later step. */
export async function PlaceholderPage({ namespace }: { namespace: PlaceholderNamespace }) {
  const t = await getTranslations(namespace)
  const tEmpty = await getTranslations('Empty')
  return (
    <>
      <PageHeader title={t('title')} description={t('description')} />
      <EmptyState title={tEmpty('title')} description={t('empty')} />
    </>
  )
}
