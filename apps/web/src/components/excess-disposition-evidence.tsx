import Link from 'next/link'
import { getFormatter, getLocale, getTranslations } from 'next-intl/server'
import type { DispositionSource } from '@/lib/excess-disposition'
import { formatCostDecimal } from '@/lib/purchase-costs'
export async function ExcessDispositionEvidence({ source }: { source: DispositionSource }) {
  const [t, locale, format] = await Promise.all([
    getTranslations('ExcessDisposition'),
    getLocale(),
    getFormatter(),
  ])
  const c = source.line.comparison
  const s = c.snapshot
  const number = (v: string | null) => formatCostDecimal(v, locale, 100)
  return (
    <section className="workspace-panel space-y-3">
      <h2 className="text-section-title">{t('originalEvidence')}</h2>
      <dl className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {(
          [
            ['item', c.item_code],
            ['location', source.location_code],
            [
              'cutoff',
              format.dateTime(new Date(source.cutoff), { dateStyle: 'medium', timeZone: 'UTC' }),
            ],
            ['unit', c.unit ?? '—'],
            ['above', number(c.quantity_above)],
            ['maximum', number(c.maximum)],
            ['stockAvailable', number(s?.available ?? null)],
            ['unitCost', `${number(s?.unit_cost ?? null)} ${s?.currency ?? ''}`],
          ] as const
        ).map(([key, value]) => (
          <div key={key} className="min-w-0">
            <dt className="text-xs text-muted-foreground">{t(key)}</dt>
            <dd className="break-words text-evidence-value">
              <bdi>{value}</bdi>
            </dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-wrap gap-4">
        <Link className="underline" href={`/replenishment/excess/${source.assessment_id}`}>
          {t('assessment')}
        </Link>
        <Link className="underline" href={`/forecasts/workbench/${c.policy_id}`}>
          {t('policy')}
        </Link>
      </div>
      <details>
        <summary className="cursor-pointer">{t('inputs')}</summary>
        <pre className="mt-2 max-w-full whitespace-pre-wrap break-all text-xs">
          {JSON.stringify(source.line, null, 2)}
        </pre>
      </details>
    </section>
  )
}
