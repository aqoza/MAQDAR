import { TriangleAlertIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

/**
 * Shown while a stepped commit is running or after it stopped: the rows before the cursor are
 * already saved and visible to everyone. `stopped` is for a commit that can no longer go on
 * (abandoned, expired, staging lost): its saved rows stay. Works in server and client trees.
 */
export function PartialBanner({
  done,
  total,
  stopped = false,
}: {
  done: number
  total: number
  stopped?: boolean
}) {
  const t = useTranslations('ImportsClient.partial')
  return (
    <Alert role="status">
      <TriangleAlertIcon aria-hidden="true" />
      <AlertTitle>{t('title')}</AlertTitle>
      <AlertDescription>
        {stopped ? t('stopped', { done, total }) : t('description', { done, total })}
      </AlertDescription>
    </Alert>
  )
}
