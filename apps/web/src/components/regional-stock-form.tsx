'use client'
import Link from 'next/link'
import { startTransition, useActionState, useState, useSyncExternalStore } from 'react'
import { useTranslations } from 'next-intl'
import {
  previewRegionalStock,
  saveRegionalStock,
  type RegionalStockPreviewState,
} from '@/app/(app)/replenishment/regional-stock/actions'
import { regionalStockInputSchema } from '@/lib/regional-stock'
import { UNITS_OF_MEASURE } from '@/lib/master-data/schemas'
import { idleState } from '@/lib/forms'
import { ItemCodeInput } from './master-data/item-code-input'
import { LocationSetInput } from './location-set-input'
import { RegionalStockReport } from './regional-stock-report'
const subscribe = () => () => {}
const field = 'min-w-0 w-full rounded-md border bg-background px-3 py-2'
const button =
  'min-h-11 rounded-md bg-primary px-4 text-sm text-primary-foreground disabled:opacity-50'
export function RegionalStockForm({
  organizationId,
  requestId,
  today,
  locations,
  regions,
  initialRegionId,
}: {
  organizationId: string
  requestId: string
  today: string
  locations: { code: string; name: string }[]
  regions: { id: string; name: string; codes: string[] }[]
  initialRegionId: string
}) {
  const t = useTranslations('RegionalStock')
  const hydrated = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  )
  const [regionId, setRegionId] = useState(initialRegionId)
  const [name, setName] = useState(''),
    [item, setItem] = useState(''),
    [unit, setUnit] = useState('EA'),
    [day, setDay] = useState(today)
  const [codes, setCodes] = useState<string[]>([]),
    [confirmed, setConfirmed] = useState(false)
  const [state, preview, pending] = useActionState(
    previewRegionalStock,
    idleState as RegionalStockPreviewState,
  )
  const [saved, save, saving] = useActionState(saveRegionalStock, idleState)
  const [submitted, setSubmitted] = useState<string>()
  const input = {
    assessment_name: name,
    item_code: item,
    unit,
    as_of: day,
    ...(regionId ? { region_id: regionId } : { location_codes: codes }),
    confirmed,
  }
  const parsed = regionalStockInputSchema.safeParse(input)
  const current =
    parsed.success && state.input && JSON.stringify(parsed.data) === JSON.stringify(state.input)
  const disabled = !hydrated || pending || saving
  return (
    <div className="min-w-0 space-y-4">
      <form
        className="space-y-3 workspace-panel"
        onSubmit={(event) => {
          event.preventDefault()
          const form = new FormData(event.currentTarget)
          startTransition(() => preview(form))
        }}
      >
        <input type="hidden" name="organization_id" value={organizationId} />
        <input type="hidden" name="input" value={JSON.stringify(input)} />
        <fieldset disabled={disabled} className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <label className="grid min-w-0 gap-1 text-sm">
            {t('assessment_name')}
            <input
              className={field}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={200}
              required
            />
          </label>
          <label className="grid min-w-0 gap-1 text-sm">
            {t('item_code')}
            <ItemCodeInput
              className={field}
              value={item}
              onInput={(e) => setItem(e.currentTarget.value)}
              maxLength={64}
              required
            />
          </label>
          <label className="grid min-w-0 gap-1 text-sm">
            {t('unit')}
            <select className={field} value={unit} onChange={(e) => setUnit(e.target.value)}>
              {UNITS_OF_MEASURE.map((v) => (
                <option key={v}>{v}</option>
              ))}
            </select>
          </label>
          <label className="grid min-w-0 gap-1 text-sm">
            {t('as_of')}
            <input
              type="date"
              className={field}
              value={day}
              min="0001-01-01"
              max="9999-12-31"
              onChange={(e) => setDay(e.target.value)}
              required
            />
          </label>
        </fieldset>
        <label className="grid min-w-0 gap-1 text-sm">
          {t('region')}
          <select
            className={field}
            value={regionId}
            disabled={disabled}
            onChange={(e) => setRegionId(e.target.value)}
          >
            <option value="">{t('manualLocations')}</option>
            {regions.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <p className="text-xs text-muted-foreground">
          {t('regionSuggestions')}{' '}
          <Link
            className="inline-flex min-h-11 items-center underline"
            href="/replenishment/regional-stock/regions"
          >
            {t('browseRegions')}
          </Link>
        </p>
        {regionId ? (
          <p className="break-words text-sm">
            <bdi>{regions.find((r) => r.id === regionId)?.codes.join(' · ')}</bdi> ·{' '}
            {t('fixedRegion')}
          </p>
        ) : (
          <LocationSetInput
            codes={codes}
            setCodes={setCodes}
            locations={locations}
            disabled={disabled}
          />
        )}
        <label className="flex min-h-11 items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-1 shrink-0"
            checked={confirmed}
            disabled={disabled}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          <span>{t('confirmation')}</span>
        </label>
        {state.status === 'error' && (
          <p role="alert" className="text-sm text-destructive">
            {state.message}
          </p>
        )}
        <button disabled={disabled || !parsed.success} className={button}>
          {pending ? t('working') : t('preview')}
        </button>
      </form>
      {current && state.report && (
        <>
          <RegionalStockReport report={state.report} />
          {state.report.status === 'available' && (
            <form
              action={save}
              onSubmit={() => setSubmitted(state.report!.fingerprint)}
              className="space-y-3 workspace-panel"
            >
              <input type="hidden" name="organization_id" value={organizationId} />
              <input type="hidden" name="input" value={JSON.stringify(parsed.data)} />
              <input type="hidden" name="request_id" value={requestId} />
              <input type="hidden" name="fingerprint" value={state.report.fingerprint} />
              {saved.status === 'error' && submitted === state.report.fingerprint && (
                <p role="alert" className="text-sm text-destructive">
                  {saved.message}
                </p>
              )}
              <button disabled={disabled} className={button}>
                {saving ? t('working') : t('save')}
              </button>
            </form>
          )}
        </>
      )}
    </div>
  )
}
