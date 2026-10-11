import 'server-only'
import { getTranslations } from 'next-intl/server'
import type { EntityNamespace } from './types'

/**
 * Entity namespaces are addressed with runtime keys (`columns.<key>`, `options.<field>.<value>`),
 * which next-intl's typed translator cannot express. This translator takes plain strings; a
 * missing key logs in development and renders `Namespace.key` (see src/i18n/errors.ts).
 */
export type LooseTranslator = {
  (key: string, values?: Record<string, string | number>): string
  has(key: string): boolean
}

export async function getEntityTranslator(namespace: EntityNamespace): Promise<LooseTranslator> {
  const load = getTranslations as unknown as (namespace: string) => Promise<LooseTranslator>
  return load(namespace)
}

/** The message when it exists, else undefined (for optional keys such as hints). */
export function optionalMessage(t: LooseTranslator, key: string): string | undefined {
  return t.has(key) ? t(key) : undefined
}
