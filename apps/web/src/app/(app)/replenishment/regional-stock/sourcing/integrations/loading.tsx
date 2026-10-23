import { getTranslations } from 'next-intl/server'
import { IntegrationWorkbenchHeader } from '@/components/integration-workbench-header'

export default async function Loading() {
  const t = await getTranslations('IntegrationWorkbench')
  return (
    <div className="min-w-0 space-y-4">
      <IntegrationWorkbenchHeader family="regional" />
      <p role="status">{t('loading')}</p>
    </div>
  )
}
