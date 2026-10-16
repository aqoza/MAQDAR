import { getTranslations } from 'next-intl/server'
import type { z } from 'zod'
import type { stockPoolSchema } from '@/lib/stock-comparison'
import { formatScore } from '@/lib/forecast-quality'
import { DemandUnitEvidence } from './demand-unit-evidence'

export async function StockPoolReport({
  pool,
  unit,
  locale,
}: {
  pool: z.infer<typeof stockPoolSchema>
  unit: string | null
  locale: string
}) {
  const t = await getTranslations('StockComparison')
  const amount = (value: string | null) => formatScore(value, locale)
  return (
    <section className="space-y-4" aria-label={t('pool.members')}>
      <h3 className="text-lg font-semibold">{t('pool.members')}</h3>
      <p>{t('pool.description')}</p>
      <p>{t('pool.available', { value: amount(pool.available), unit: unit ?? '—' })}</p>
      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full text-start text-sm" aria-label={t('pool.members')}>
          <thead>
            <tr className="border-b">
              {(
                [
                  'item',
                  'observation',
                  'quantity',
                  'allocated',
                  'available',
                  'unit_cost',
                  'inventoryValue',
                ] as const
              ).map((key) => (
                <th key={key} className="p-3 text-start">
                  {t(`pool.columns.${key}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {pool.members.map((member) => (
              <tr key={member.item_id} className="border-b align-top">
                <th scope="row" className="p-3 text-start font-normal">
                  <strong>{member.item_code}</strong>
                  <details className="mt-2">
                    <summary>{t('identity')}</summary>
                    <p className="break-all">{t('pool.itemId', { id: member.item_id })}</p>
                    {member.snapshot && (
                      <p className="break-all">
                        {t('snapshotId', {
                          id: member.snapshot.id,
                          time: member.snapshot.updated_at,
                        })}
                      </p>
                    )}
                    <DemandUnitEvidence evidence={member.unit_provenance} />
                  </details>
                </th>
                <td className="min-w-52 p-3">
                  <p>{t(`memberStatuses.${member.status}`)}</p>
                  {member.snapshot && (
                    <p>
                      {t('snapshot', {
                        date: member.snapshot.date,
                        age: member.snapshot.age,
                        unit: member.snapshot.unit ?? '—',
                      })}
                    </p>
                  )}
                </td>
                {(['quantity', 'allocated', 'available', 'unit_cost'] as const).map((key) => (
                  <td key={key} className="p-3 tabular-nums whitespace-nowrap">
                    {amount(member.snapshot?.[key] ?? null)}
                    {key === 'unit_cost' && member.snapshot ? ` ${member.snapshot.currency}` : ''}
                  </td>
                ))}
                <td className="p-3 tabular-nums whitespace-nowrap">
                  {amount(member.inventory_value)}{' '}
                  {member.inventory_value !== null ? member.snapshot?.currency : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>{t('pool.valuation')}</p>
      {pool.inventory_values.length > 0 && (
        <dl className="flex flex-wrap gap-4 rounded-xl border p-4" aria-label={t('pool.values')}>
          {pool.inventory_values.map((value) => (
            <div key={value.currency}>
              <dt>{value.currency}</dt>
              <dd className="tabular-nums">{amount(value.value)}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  )
}
