'use client'
import { useActionState } from 'react'
import { useTranslations } from 'next-intl'
import { archiveStockRegion } from '@/app/(app)/replenishment/regional-stock/regions/actions'
import { idleState } from '@/lib/forms'

export function StockRegionArchive({
  organizationId,
  regionId,
}: {
  organizationId: string
  regionId: string
}) {
  const t = useTranslations('StockRegion')
  const [state, action, pending] = useActionState(archiveStockRegion, idleState)
  return (
    <form action={action} className="space-y-3 workspace-panel">
      <input type="hidden" name="organization_id" value={organizationId} />
      <input type="hidden" name="region_id" value={regionId} />
      <p className="text-sm">{t('archiveHelp')}</p>
      {state.status === 'error' && (
        <p role="alert" className="text-sm text-destructive">
          {state.message}
        </p>
      )}
      <button
        disabled={pending}
        className="min-h-11 rounded-md border px-4 text-sm disabled:opacity-50"
      >
        {pending ? t('working') : t('archive')}
      </button>
    </form>
  )
}
