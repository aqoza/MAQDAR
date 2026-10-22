'use client'
import { startTransition, useActionState, useState, useSyncExternalStore } from 'react'
import { useTranslations } from 'next-intl'
import {
  previewRegionalStock,
  saveRegionalStock,
  type RegionalStockPreviewState,
} from '@/app/(app)/replenishment/regional-stock/actions'
import { regionalStockInputSchema } from '@/lib/regional-stock'
import { UNITS_OF_MEASURE, codeSchema } from '@/lib/master-data/schemas'
import { idleState } from '@/lib/forms'
import { ItemCodeInput } from './master-data/item-code-input'
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
}: {
  organizationId: string
  requestId: string
  today: string
  locations: { code: string; name: string }[]
}) {
  const t = useTranslations('RegionalStock')
  const hydrated = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  )
  const [name, setName] = useState(''),
    [item, setItem] = useState(''),
    [unit, setUnit] = useState('EA'),
    [day, setDay] = useState(today)
  const [codes, setCodes] = useState<string[]>([]),
    [candidate, setCandidate] = useState(''),
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
    location_codes: codes,
    confirmed,
  }
  const parsed = regionalStockInputSchema.safeParse(input)
  const current =
    parsed.success && state.input && JSON.stringify(parsed.data) === JSON.stringify(state.input)
  const disabled = !hydrated || pending || saving
  const validCode = codeSchema().safeParse(candidate)
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
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid min-w-0 flex-1 gap-1 text-sm">
            {t('location_code')}
            <input
              className={field}
              list="regional-locations"
              value={candidate}
              maxLength={64}
              disabled={disabled || codes.length === 20}
              onChange={(e) => setCandidate(e.target.value)}
            />
          </label>
          <datalist id="regional-locations">
            {locations.map((l) => (
              <option key={l.code} value={l.code}>
                {l.name}
              </option>
            ))}
          </datalist>
          <button
            type="button"
            className={button}
            disabled={
              disabled ||
              !validCode.success ||
              codes.includes(candidate.trim()) ||
              codes.length === 20
            }
            onClick={() => {
              setCodes([...codes, candidate.trim()])
              setCandidate('')
            }}
          >
            {t('add')}
          </button>
        </div>
        <p className="text-xs text-muted-foreground" role="status">
          {t('count', { count: codes.length })}
        </p>
        <ul className="flex flex-wrap gap-2">
          {codes.map((code) => (
            <li
              key={code}
              className="flex max-w-full items-center gap-2 rounded-md border ps-3 text-sm"
            >
              <bdi className="break-all">{code}</bdi>
              <button
                type="button"
                disabled={disabled}
                onClick={() => setCodes(codes.filter((c) => c !== code))}
                aria-label={t('remove', { code })}
                className="min-h-11 px-3 underline"
              >
                {t('removeShort')}
              </button>
            </li>
          ))}
        </ul>
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
