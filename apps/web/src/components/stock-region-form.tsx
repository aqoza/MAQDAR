'use client'
import { startTransition, useActionState, useState, useSyncExternalStore } from 'react'
import { useTranslations } from 'next-intl'
import {
  previewStockRegion,
  saveStockRegion,
  type StockRegionPreviewState,
} from '@/app/(app)/replenishment/regional-stock/regions/actions'
import { stockRegionInputSchema } from '@/lib/stock-regions'
import { idleState } from '@/lib/forms'
import { LocationSetInput } from './location-set-input'
import { StockRegionReport } from './stock-region-report'
const subscribe = () => () => {}
const field = 'min-w-0 w-full rounded-md border bg-background px-3 py-2'
const button =
  'min-h-11 rounded-md bg-primary px-4 text-sm text-primary-foreground disabled:opacity-50'
export function StockRegionForm({
  organizationId,
  requestId,
  locations,
}: {
  organizationId: string
  requestId: string
  locations: { code: string; name: string }[]
}) {
  const t = useTranslations('StockRegion')
  const hydrated = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  )
  const [name, setName] = useState(''),
    [arabic, setArabic] = useState('')
  const [codes, setCodes] = useState<string[]>([]),
    [confirmed, setConfirmed] = useState(false)
  const [state, preview, pending] = useActionState(
    previewStockRegion,
    idleState as StockRegionPreviewState,
  )
  const [saved, save, saving] = useActionState(saveStockRegion, idleState)
  const [submitted, setSubmitted] = useState<string>()
  const input = { name_en: name, name_ar: arabic, location_codes: codes, confirmed }
  const parsed = stockRegionInputSchema.safeParse(input)
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
        <fieldset disabled={disabled} className="grid min-w-0 gap-3 sm:grid-cols-2">
          <label className="grid min-w-0 gap-1 text-sm">
            {t('name_en')}
            <input
              className={field}
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={200}
              required
            />
          </label>
          <label className="grid min-w-0 gap-1 text-sm">
            {t('name_ar')}
            <input
              className={field}
              value={arabic}
              onChange={(e) => setArabic(e.target.value)}
              maxLength={200}
            />
          </label>
        </fieldset>
        <LocationSetInput
          codes={codes}
          setCodes={setCodes}
          locations={locations}
          disabled={disabled}
        />
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
          <StockRegionReport report={state.report} />
          {
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
          }
        </>
      )}
    </div>
  )
}
