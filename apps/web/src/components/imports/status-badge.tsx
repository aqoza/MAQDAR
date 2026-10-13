import { useTranslations } from 'next-intl'
import { Badge } from '@/components/ui/badge'
import type { ImportStatus } from '@/lib/imports/client'

const VARIANTS: Record<ImportStatus, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  staging: 'outline',
  validated: 'secondary',
  invalid: 'destructive',
  committing: 'outline',
  succeeded: 'default',
  failed: 'destructive',
  canceled: 'outline',
  expired: 'outline',
}

/** The translated status of an import as a pill. Works in server and client trees. */
export function ImportStatusBadge({ status }: { status: ImportStatus }) {
  const t = useTranslations('ImportsClient.status')
  return <Badge variant={VARIANTS[status]}>{t(status)}</Badge>
}
