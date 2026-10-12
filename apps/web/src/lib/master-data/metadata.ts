import 'server-only'
import type { Metadata } from 'next'
import { getEntityTranslator } from './messages'
import { getEntity, type EntityKey } from './registry'

/** Page title for a master-data route: the entity title, or its "New …" title on `/new`. */
export async function entityMetadata(
  entity: EntityKey,
  page: 'list' | 'new' | 'edit' = 'list',
): Promise<Metadata> {
  const t = await getEntityTranslator(getEntity(entity).namespace)
  return { title: page === 'new' ? t('newTitle') : t('title') }
}
