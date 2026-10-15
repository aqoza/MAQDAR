import { getTranslations } from 'next-intl/server'
import type { z } from 'zod'
import type { unitProvenanceSchema } from '@/lib/stock-comparison'

export async function DemandUnitEvidence({
  evidence,
}: {
  evidence?: z.infer<typeof unitProvenanceSchema> | null
}) {
  const t = await getTranslations('StockComparison')
  return (
    <p className="text-sm text-muted-foreground">
      {evidence
        ? t('provenance', {
            status: t(`units.${evidence.status}`),
            unit: evidence.unit ?? '—',
            rows: evidence.rows,
            unknown: evidence.unknown_rows,
            supplied: evidence.units.join(', ') || '—',
          })
        : t('legacyUnits')}
    </p>
  )
}
